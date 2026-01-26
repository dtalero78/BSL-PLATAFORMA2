const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { construirFechaAtencionColombia } = require('../helpers/date');

// ==================== CALENDARIO ENDPOINTS ====================

// GET /calendario/mes - Obtener conteo de citas por día del mes
router.get('/calendario/mes', async (req, res) => {
    try {
        const { year, month, medico } = req.query;

        if (!year || !month) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere year y month'
            });
        }

        // Calcular primer y último día del mes
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0).getDate();
        const endDateStr = `${year}-${String(month).padStart(2, '0')}-${endDate}`;

        let query = `
            SELECT
                fecha_atencion,
                COUNT(*) as total
            FROM formularios
            WHERE fecha_atencion IS NOT NULL
              AND fecha_atencion >= $1
              AND fecha_atencion <= $2
        `;
        const params = [startDate, endDateStr];

        if (medico) {
            query += ` AND medico = $3`;
            params.push(medico);
        }

        query += ` GROUP BY fecha_atencion ORDER BY fecha_atencion`;

        const result = await pool.query(query, params);

        // Convertir a objeto {fecha: count}
        const citasPorDia = {};
        result.rows.forEach(row => {
            if (row.fecha_atencion) {
                // Normalizar formato de fecha
                let fecha = row.fecha_atencion;
                if (fecha instanceof Date) {
                    fecha = fecha.toISOString().split('T')[0];
                } else if (typeof fecha === 'string' && fecha.includes('T')) {
                    fecha = fecha.split('T')[0];
                }
                citasPorDia[fecha] = parseInt(row.total);
            }
        });

        res.json({
            success: true,
            data: citasPorDia,
            year: parseInt(year),
            month: parseInt(month)
        });
    } catch (error) {
        console.error('❌ Error al obtener citas del mes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener citas del mes',
            error: error.message
        });
    }
});

// GET /calendario/mes-detalle - Obtener citas agrupadas por médico y estado para cada día del mes
router.get('/calendario/mes-detalle', async (req, res) => {
    try {
        const { year, month } = req.query;

        if (!year || !month) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere year y month'
            });
        }

        // Calcular primer y último día del mes
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDateStr = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

        // Buscar en HistoriaClinica (donde se guardan las órdenes) - incluir atendido
        const query = `
            SELECT
                "fechaAtencion" as fecha_atencion,
                COALESCE("medico", 'Sin asignar') as medico,
                COALESCE("atendido", 'PENDIENTE') as estado,
                COUNT(*) as total
            FROM "HistoriaClinica"
            WHERE "fechaAtencion" IS NOT NULL
              AND "fechaAtencion" >= $1::timestamp
              AND "fechaAtencion" < ($2::timestamp + interval '1 day')
            GROUP BY "fechaAtencion", "medico", "atendido"
            ORDER BY "fechaAtencion", total DESC
        `;

        const result = await pool.query(query, [startDate, endDateStr]);

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        // Convertir a objeto {fecha: {medico: {atendidos, pendientes, vencidos}, ...}}
        const citasPorDia = {};
        let totalAtendidos = 0;
        let totalPendientes = 0;
        let totalVencidos = 0;

        result.rows.forEach(row => {
            if (row.fecha_atencion) {
                // Normalizar formato de fecha
                let fecha = row.fecha_atencion;
                if (fecha instanceof Date) {
                    fecha = fecha.toISOString().split('T')[0];
                } else if (typeof fecha === 'string' && fecha.includes('T')) {
                    fecha = fecha.split('T')[0];
                }

                if (!citasPorDia[fecha]) {
                    citasPorDia[fecha] = {};
                }
                if (!citasPorDia[fecha][row.medico]) {
                    citasPorDia[fecha][row.medico] = { atendidos: 0, pendientes: 0, vencidos: 0 };
                }

                const count = parseInt(row.total);
                const fechaCita = new Date(fecha);
                fechaCita.setHours(0, 0, 0, 0);

                if (row.estado === 'ATENDIDO') {
                    citasPorDia[fecha][row.medico].atendidos += count;
                    totalAtendidos += count;
                } else if (fechaCita < hoy) {
                    // Pendiente pero fecha ya pasó = vencido
                    citasPorDia[fecha][row.medico].vencidos += count;
                    totalVencidos += count;
                } else {
                    citasPorDia[fecha][row.medico].pendientes += count;
                    totalPendientes += count;
                }
            }
        });

        res.json({
            success: true,
            data: citasPorDia,
            estadisticas: {
                atendidos: totalAtendidos,
                pendientes: totalPendientes,
                vencidos: totalVencidos,
                total: totalAtendidos + totalPendientes + totalVencidos
            },
            year: parseInt(year),
            month: parseInt(month)
        });
    } catch (error) {
        console.error('❌ Error al obtener detalle de citas del mes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener detalle de citas del mes',
            error: error.message
        });
    }
});

// GET /calendario/dia - Obtener citas de un día específico
router.get('/calendario/dia', async (req, res) => {
    try {
        const { fecha, medico } = req.query;

        if (!fecha) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere fecha (YYYY-MM-DD)'
            });
        }

        // Buscar en HistoriaClinica (donde se guardan las órdenes)
        let query = `
            SELECT
                "_id" as id,
                "numeroId" as cedula,
                CONCAT(COALESCE("primerNombre", ''), ' ', COALESCE("primerApellido", '')) as nombre,
                "tipoExamen",
                "medico",
                "fechaAtencion" as fecha_atencion,
                COALESCE(
                    "horaAtencion",
                    TO_CHAR("fechaAtencion" AT TIME ZONE 'America/Bogota', 'HH24:MI')
                ) as hora,
                "empresa",
                "atendido"
            FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1::timestamp
              AND "fechaAtencion" < ($1::timestamp + interval '1 day')
        `;
        const params = [fecha];

        if (medico) {
            if (medico === 'Sin asignar') {
                query += ` AND "medico" IS NULL`;
            } else {
                query += ` AND "medico" = $2`;
                params.push(medico);
            }
        }

        query += ` ORDER BY "fechaAtencion" ASC, "_createdDate" ASC`;

        const result = await pool.query(query, params);

        res.json({
            success: true,
            data: result.rows,
            total: result.rows.length,
            fecha
        });
    } catch (error) {
        console.error('❌ Error al obtener citas del día:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener citas del día',
            error: error.message
        });
    }
});

// GET /horarios-disponibles - Obtener horarios disponibles para un médico en una fecha y modalidad
router.get('/horarios-disponibles', async (req, res) => {
    try {
        const { fecha, medico, modalidad = 'presencial', codEmpresa } = req.query;

        if (!fecha || !medico) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere fecha (YYYY-MM-DD) y medico'
            });
        }

        // Obtener día de la semana (0=Domingo, 1=Lunes, etc.)
        const fechaObj = new Date(fecha + 'T12:00:00');
        const diaSemana = fechaObj.getDay();

        // Obtener tiempo de consulta y ID del médico
        const medicoResult = await pool.query(`
            SELECT id, COALESCE(tiempo_consulta, 10) as tiempo_consulta
            FROM medicos
            WHERE CONCAT(primer_nombre, ' ', primer_apellido) = $1
            AND activo = true
        `, [medico]);

        if (medicoResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Médico no encontrado'
            });
        }

        const medicoId = medicoResult.rows[0].id;
        const tiempoConsulta = medicoResult.rows[0].tiempo_consulta;

        // Obtener TODOS los rangos de disponibilidad para este día de la semana Y modalidad
        const disponibilidadResult = await pool.query(`
            SELECT TO_CHAR(hora_inicio, 'HH24:MI') as hora_inicio,
                   TO_CHAR(hora_fin, 'HH24:MI') as hora_fin
            FROM medicos_disponibilidad
            WHERE medico_id = $1 AND dia_semana = $2 AND modalidad = $3 AND activo = true
            ORDER BY hora_inicio
        `, [medicoId, diaSemana, modalidad]);

        // Si no hay disponibilidad configurada para este día y modalidad
        let rangosHorarios = [];
        let medicoDisponible = true;

        if (disponibilidadResult.rows.length > 0) {
            // Múltiples rangos (ej: 8-12 y 14-18)
            rangosHorarios = disponibilidadResult.rows.map(config => ({
                horaInicio: parseInt(config.hora_inicio.split(':')[0]),
                horaFin: parseInt(config.hora_fin.split(':')[0])
            }));
        } else {
            // Verificar si tiene alguna disponibilidad configurada para esta modalidad (en cualquier día)
            const tieneConfigResult = await pool.query(`
                SELECT COUNT(*) as total FROM medicos_disponibilidad
                WHERE medico_id = $1 AND modalidad = $2
            `, [medicoId, modalidad]);

            // Si tiene configuración para esta modalidad pero no para este día, no está disponible
            if (parseInt(tieneConfigResult.rows[0].total) > 0) {
                medicoDisponible = false;
            } else {
                // Si no tiene ninguna configuración para esta modalidad, usar horario por defecto (6-23)
                rangosHorarios = [{ horaInicio: 6, horaFin: 23 }];
            }
        }

        if (!medicoDisponible) {
            return res.json({
                success: true,
                fecha,
                medico,
                modalidad,
                tiempoConsulta,
                disponible: false,
                mensaje: `El médico no atiende ${modalidad} este día`,
                horarios: []
            });
        }

        // Obtener citas existentes del médico para esa fecha (todas las modalidades ocupan el mismo horario)
        // Solo contar como ocupados los turnos PENDIENTES (no los ATENDIDOS)
        const citasResult = await pool.query(`
            SELECT "horaAtencion" as hora
            FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1::timestamp
              AND "fechaAtencion" < ($1::timestamp + interval '1 day')
              AND "medico" = $2
              AND "horaAtencion" IS NOT NULL
              AND "atendido" = 'PENDIENTE'
        `, [fecha, medico]);

        const horasOcupadas = citasResult.rows.map(r => r.hora);

        // Generar horarios dentro de TODOS los rangos configurados
        const horariosDisponibles = [];
        for (const rango of rangosHorarios) {
            for (let hora = rango.horaInicio; hora < rango.horaFin; hora++) {
                for (let minuto = 0; minuto < 60; minuto += tiempoConsulta) {
                    const horaStr = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;

                    // Verificar si este horario está ocupado
                    // EXCEPCIÓN: KM2 y SITEL pueden agendar en cualquier turno aunque esté ocupado
                    let ocupado = false;
                    if (codEmpresa !== 'KM2' && codEmpresa !== 'SITEL') {
                        ocupado = horasOcupadas.some(horaOcupada => {
                            if (!horaOcupada) return false;
                            const horaOcupadaNorm = horaOcupada.substring(0, 5);
                            return horaOcupadaNorm === horaStr;
                        });
                    }

                    horariosDisponibles.push({
                        hora: horaStr,
                        disponible: !ocupado
                    });
                }
            }
        }

        // Ordenar horarios
        horariosDisponibles.sort((a, b) => a.hora.localeCompare(b.hora));

        res.json({
            success: true,
            fecha,
            medico,
            modalidad,
            tiempoConsulta,
            disponible: true,
            rangos: rangosHorarios,
            horarios: horariosDisponibles
        });
    } catch (error) {
        console.error('❌ Error al obtener horarios disponibles:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener horarios disponibles',
            error: error.message
        });
    }
});

// GET /turnos-disponibles - Obtener todos los turnos disponibles para una fecha y modalidad (sin mostrar médicos)
// Este endpoint consolida la disponibilidad de todos los médicos excepto NUBIA
router.get('/turnos-disponibles', async (req, res) => {
    try {
        const { fecha, modalidad = 'presencial', codEmpresa } = req.query;

        if (!fecha) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere fecha (YYYY-MM-DD)'
            });
        }

        // Obtener día de la semana (0=Domingo, 1=Lunes, etc.)
        const fechaObj = new Date(fecha + 'T12:00:00');
        const diaSemana = fechaObj.getDay();

        // Obtener todos los médicos activos con disponibilidad para esta modalidad y día (excepto NUBIA)
        // Ahora puede devolver múltiples filas por médico (múltiples rangos horarios)
        const medicosResult = await pool.query(`
            SELECT m.id, m.primer_nombre, m.primer_apellido, m.alias,
                   COALESCE(m.tiempo_consulta, 10) as tiempo_consulta,
                   TO_CHAR(md.hora_inicio, 'HH24:MI') as hora_inicio,
                   TO_CHAR(md.hora_fin, 'HH24:MI') as hora_fin
            FROM medicos m
            INNER JOIN medicos_disponibilidad md ON m.id = md.medico_id
            WHERE m.activo = true
              AND md.activo = true
              AND md.modalidad = $1
              AND md.dia_semana = $2
              AND UPPER(CONCAT(m.primer_nombre, ' ', m.primer_apellido)) NOT LIKE '%NUBIA%'
            ORDER BY m.primer_nombre, md.hora_inicio
        `, [modalidad, diaSemana]);

        if (medicosResult.rows.length === 0) {
            return res.json({
                success: true,
                fecha,
                modalidad,
                turnos: [],
                mensaje: 'No hay médicos disponibles para esta modalidad en este día'
            });
        }

        // Agrupar rangos horarios por médico
        const medicosPorId = {};
        for (const row of medicosResult.rows) {
            if (!medicosPorId[row.id]) {
                medicosPorId[row.id] = {
                    id: row.id,
                    nombre: row.alias || `${row.primer_nombre} ${row.primer_apellido}`,
                    tiempoConsulta: row.tiempo_consulta,
                    rangos: []
                };
            }
            medicosPorId[row.id].rangos.push({
                horaInicio: parseInt(row.hora_inicio.split(':')[0]),
                horaFin: parseInt(row.hora_fin.split(':')[0])
            });
        }

        // Para cada médico, generar sus horarios y verificar disponibilidad
        const turnosPorHora = {}; // { "08:00": [{ medicoId, nombre, disponible }], ... }

        for (const medico of Object.values(medicosPorId)) {
            const medicoNombre = medico.nombre;
            const tiempoConsulta = medico.tiempoConsulta;

            // Obtener citas existentes del médico para esa fecha
            // IMPORTANTE: Usamos horaAtencion en lugar de extraer hora de fechaAtencion
            // porque fechaAtencion está en UTC y horaAtencion está en hora Colombia
            // Solo contar como ocupados los turnos PENDIENTES (no los ATENDIDOS)
            const citasResult = await pool.query(`
                SELECT "horaAtencion" as hora
                FROM "HistoriaClinica"
                WHERE "fechaAtencion" >= $1::timestamp
                  AND "fechaAtencion" < ($1::timestamp + interval '1 day')
                  AND "medico" = $2
                  AND "horaAtencion" IS NOT NULL
                  AND "atendido" = 'PENDIENTE'
            `, [fecha, medicoNombre]);

            const horasOcupadas = citasResult.rows.map(r => {
                if (!r.hora) return null;
                // Normalizar a formato HH:MM (quitar segundos si existen)
                return r.hora.substring(0, 5);
            }).filter(Boolean);

            // Generar horarios para TODOS los rangos de este médico
            for (const rango of medico.rangos) {
                for (let hora = rango.horaInicio; hora < rango.horaFin; hora++) {
                    for (let minuto = 0; minuto < 60; minuto += tiempoConsulta) {
                        const horaStr = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;

                        // EXCEPCIÓN: KM2 y SITEL pueden agendar en cualquier turno aunque esté ocupado
                        const ocupado = (codEmpresa === 'KM2' || codEmpresa === 'SITEL') ? false : horasOcupadas.includes(horaStr);

                        if (!turnosPorHora[horaStr]) {
                            turnosPorHora[horaStr] = [];
                        }

                        // Evitar duplicar si ya existe este médico en esta hora
                        const yaExiste = turnosPorHora[horaStr].some(m => m.medicoId === medico.id);
                        if (!yaExiste) {
                            turnosPorHora[horaStr].push({
                                medicoId: medico.id,
                                medicoNombre: medicoNombre,
                                disponible: !ocupado
                            });
                        }
                    }
                }
            }
        }

        // Obtener hora actual en Colombia (UTC-5)
        const ahora = new Date();
        const colombiaTime = ahora.toLocaleString('en-US', { timeZone: 'America/Bogota' });
        const ahoraColombia = new Date(colombiaTime);
        const horaActual = ahoraColombia.getHours();
        const minutoActual = ahoraColombia.getMinutes();

        // Verificar si la fecha seleccionada es hoy
        const fechaHoyColombia = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }); // formato YYYY-MM-DD
        const esHoy = fecha === fechaHoyColombia;

        // Convertir a array de turnos consolidados (solo mostrar hora y si hay al menos un médico disponible)
        const turnos = Object.keys(turnosPorHora)
            .sort()
            .filter(hora => {
                // Si es hoy, filtrar las horas que ya pasaron
                if (esHoy) {
                    const [h, m] = hora.split(':').map(Number);
                    // Solo mostrar horas futuras (al menos 1 hora después de ahora para dar margen)
                    if (h < horaActual || (h === horaActual && m <= minutoActual)) {
                        return false;
                    }
                }
                return true;
            })
            .map(hora => {
                const medicosEnHora = turnosPorHora[hora];
                const medicosDisponibles = medicosEnHora.filter(m => m.disponible);
                // Asignar el primer médico disponible
                const medicoAsignado = medicosDisponibles.length > 0 ? medicosDisponibles[0].medicoNombre : null;
                return {
                    hora,
                    disponible: medicosDisponibles.length > 0,
                    cantidadDisponibles: medicosDisponibles.length,
                    medico: medicoAsignado,
                    // Guardamos internamente los médicos para asignar al crear la orden
                    _medicos: medicosEnHora
                };
            });

        res.json({
            success: true,
            fecha,
            modalidad,
            diaSemana,
            turnos
        });
    } catch (error) {
        console.error('❌ Error al obtener turnos disponibles:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener turnos disponibles',
            error: error.message
        });
    }
});

// GET /medicos-por-modalidad - Obtener médicos que atienden una modalidad específica
router.get('/medicos-por-modalidad', async (req, res) => {
    try {
        const { modalidad = 'presencial', fecha } = req.query;

        let query = `
            SELECT DISTINCT m.id, m.primer_nombre, m.primer_apellido, m.alias,
                   m.especialidad, COALESCE(m.tiempo_consulta, 10) as tiempo_consulta
            FROM medicos m
            INNER JOIN medicos_disponibilidad md ON m.id = md.medico_id
            WHERE m.activo = true
              AND md.activo = true
              AND md.modalidad = $1
        `;
        const params = [modalidad];

        // Si se proporciona fecha, filtrar por día de la semana
        if (fecha) {
            const fechaObj = new Date(fecha + 'T12:00:00');
            const diaSemana = fechaObj.getDay();
            query += ` AND md.dia_semana = $2`;
            params.push(diaSemana);
        }

        query += ` ORDER BY m.primer_apellido, m.primer_nombre`;

        const result = await pool.query(query, params);

        res.json({
            success: true,
            modalidad,
            data: result.rows
        });
    } catch (error) {
        console.error('❌ Error al obtener médicos por modalidad:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener médicos',
            error: error.message
        });
    }
});

// ==================== CRUD EXAMENES ====================

// GET - Listar todos los exámenes
router.get('/examenes', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, nombre, activo, created_at
            FROM examenes
            ORDER BY nombre ASC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener exámenes:', error);
        res.status(500).json({ error: 'Error al obtener exámenes' });
    }
});

// GET - Obtener un examen por ID
router.get('/examenes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT id, nombre, activo, created_at
            FROM examenes
            WHERE id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Examen no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al obtener examen:', error);
        res.status(500).json({ error: 'Error al obtener examen' });
    }
});

// POST - Crear nuevo examen
router.post('/examenes', async (req, res) => {
    try {
        const { nombre } = req.body;

        if (!nombre || nombre.trim() === '') {
            return res.status(400).json({ error: 'El nombre del examen es requerido' });
        }

        const result = await pool.query(`
            INSERT INTO examenes (nombre)
            VALUES ($1)
            RETURNING id, nombre, activo, created_at
        `, [nombre.trim()]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') { // Unique violation
            return res.status(400).json({ error: 'Ya existe un examen con ese nombre' });
        }
        console.error('Error al crear examen:', error);
        res.status(500).json({ error: 'Error al crear examen' });
    }
});

// PUT - Actualizar examen
router.put('/examenes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, activo } = req.body;

        if (!nombre || nombre.trim() === '') {
            return res.status(400).json({ error: 'El nombre del examen es requerido' });
        }

        const result = await pool.query(`
            UPDATE examenes
            SET nombre = $1, activo = $2
            WHERE id = $3
            RETURNING id, nombre, activo, created_at
        `, [nombre.trim(), activo !== false, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Examen no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Ya existe un examen con ese nombre' });
        }
        console.error('Error al actualizar examen:', error);
        res.status(500).json({ error: 'Error al actualizar examen' });
    }
});

// DELETE - Eliminar examen
router.delete('/examenes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            DELETE FROM examenes
            WHERE id = $1
            RETURNING id
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Examen no encontrado' });
        }
        res.json({ message: 'Examen eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar examen:', error);
        res.status(500).json({ error: 'Error al eliminar examen' });
    }
});

module.exports = router;
