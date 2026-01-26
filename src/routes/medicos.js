const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Listar todos los médicos activos
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
                   numero_licencia, tipo_licencia, fecha_vencimiento_licencia, especialidad,
                   firma, activo, created_at, COALESCE(tiempo_consulta, 10) as tiempo_consulta, alias
            FROM medicos
            WHERE activo = true
            ORDER BY primer_apellido, primer_nombre
        `);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error('Error al listar medicos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar medicos',
            error: error.message
        });
    }
});

// Obtener un medico por ID (incluye firma)
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM medicos WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Medico no encontrado'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error al obtener medico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener medico',
            error: error.message
        });
    }
});

// Crear un nuevo medico
router.post('/', async (req, res) => {
    try {
        const {
            primerNombre, segundoNombre, primerApellido, segundoApellido,
            alias, numeroLicencia, tipoLicencia, fechaVencimientoLicencia, especialidad, firma
        } = req.body;

        if (!primerNombre || !primerApellido || !numeroLicencia) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: primerNombre, primerApellido, numeroLicencia'
            });
        }

        const result = await pool.query(`
            INSERT INTO medicos (
                primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
                alias, numero_licencia, tipo_licencia, fecha_vencimiento_licencia, especialidad, firma
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `, [
            primerNombre,
            segundoNombre || null,
            primerApellido,
            segundoApellido || null,
            alias || null,
            numeroLicencia,
            tipoLicencia || null,
            fechaVencimientoLicencia ? new Date(fechaVencimientoLicencia) : null,
            especialidad || null,
            firma || null
        ]);

        console.log(`Medico creado: ${primerNombre} ${primerApellido} (Licencia: ${numeroLicencia})`);

        res.json({
            success: true,
            message: 'Medico creado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error al crear medico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear medico',
            error: error.message
        });
    }
});

// Actualizar un medico
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            primerNombre, segundoNombre, primerApellido, segundoApellido,
            alias, numeroLicencia, tipoLicencia, fechaVencimientoLicencia, especialidad, firma, activo
        } = req.body;

        const result = await pool.query(`
            UPDATE medicos SET
                primer_nombre = COALESCE($1, primer_nombre),
                segundo_nombre = COALESCE($2, segundo_nombre),
                primer_apellido = COALESCE($3, primer_apellido),
                segundo_apellido = COALESCE($4, segundo_apellido),
                alias = $5,
                numero_licencia = COALESCE($6, numero_licencia),
                tipo_licencia = COALESCE($7, tipo_licencia),
                fecha_vencimiento_licencia = COALESCE($8, fecha_vencimiento_licencia),
                especialidad = COALESCE($9, especialidad),
                firma = COALESCE($10, firma),
                activo = COALESCE($11, activo),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $12
            RETURNING *
        `, [
            primerNombre,
            segundoNombre,
            primerApellido,
            segundoApellido,
            alias || null,
            numeroLicencia,
            tipoLicencia,
            fechaVencimientoLicencia ? new Date(fechaVencimientoLicencia) : null,
            especialidad,
            firma,
            activo,
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Medico no encontrado'
            });
        }

        console.log(`Medico actualizado: ID ${id}`);

        res.json({
            success: true,
            message: 'Medico actualizado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error al actualizar medico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar medico',
            error: error.message
        });
    }
});

// Eliminar (desactivar) un medico
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            UPDATE medicos SET activo = false, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id, primer_nombre, primer_apellido
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Medico no encontrado'
            });
        }

        console.log(`Medico desactivado: ID ${id}`);

        res.json({
            success: true,
            message: 'Medico desactivado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error al desactivar medico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al desactivar medico',
            error: error.message
        });
    }
});

// Actualizar tiempo de consulta de un medico
router.put('/:id/tiempo-consulta', async (req, res) => {
    try {
        const { id } = req.params;
        const { tiempoConsulta } = req.body;

        if (!tiempoConsulta || tiempoConsulta < 5 || tiempoConsulta > 120) {
            return res.status(400).json({
                success: false,
                message: 'El tiempo de consulta debe estar entre 5 y 120 minutos'
            });
        }

        const result = await pool.query(`
            UPDATE medicos SET
                tiempo_consulta = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, primer_nombre, primer_apellido, tiempo_consulta
        `, [tiempoConsulta, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Medico no encontrado'
            });
        }

        console.log(`Tiempo de consulta actualizado para medico ID ${id}: ${tiempoConsulta} min`);

        res.json({
            success: true,
            message: 'Tiempo de consulta actualizado',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error al actualizar tiempo de consulta:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar tiempo de consulta',
            error: error.message
        });
    }
});

// ============================================
// ENDPOINTS PARA DISPONIBILIDAD DE MEDICOS
// ============================================

// GET - Obtener disponibilidad de un medico (opcionalmente filtrado por modalidad)
router.get('/:id/disponibilidad', async (req, res) => {
    try {
        const { id } = req.params;
        const { modalidad, agrupado } = req.query; // agrupado=true para agrupar rangos por dia

        let query = `
            SELECT id, medico_id, dia_semana,
                   TO_CHAR(hora_inicio, 'HH24:MI') as hora_inicio,
                   TO_CHAR(hora_fin, 'HH24:MI') as hora_fin,
                   COALESCE(modalidad, 'presencial') as modalidad,
                   activo
            FROM medicos_disponibilidad
            WHERE medico_id = $1
        `;
        const params = [id];

        if (modalidad) {
            query += ` AND modalidad = $2`;
            params.push(modalidad);
        }

        query += ` ORDER BY modalidad, dia_semana, hora_inicio`;

        const result = await pool.query(query, params);

        // Si se solicita agrupado, consolidar multiples rangos por dia
        if (agrupado === 'true') {
            const agrupados = {};
            for (const row of result.rows) {
                const key = `${row.dia_semana}-${row.modalidad}`;
                if (!agrupados[key]) {
                    agrupados[key] = {
                        dia_semana: row.dia_semana,
                        modalidad: row.modalidad,
                        activo: true,
                        rangos: []
                    };
                }
                agrupados[key].rangos.push({
                    id: row.id,
                    hora_inicio: row.hora_inicio,
                    hora_fin: row.hora_fin
                });
            }

            return res.json({
                success: true,
                data: Object.values(agrupados)
            });
        }

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error('Error al obtener disponibilidad:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener disponibilidad',
            error: error.message
        });
    }
});

// POST - Guardar disponibilidad de un medico para una modalidad especifica
router.post('/:id/disponibilidad', async (req, res) => {
    try {
        const { id } = req.params;
        const { disponibilidad, modalidad = 'presencial' } = req.body;

        if (!Array.isArray(disponibilidad)) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere un array de disponibilidad'
            });
        }

        // Verificar que el medico existe
        const medicoCheck = await pool.query('SELECT id FROM medicos WHERE id = $1', [id]);
        if (medicoCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Medico no encontrado'
            });
        }

        // Eliminar disponibilidad existente SOLO para esta modalidad
        await pool.query('DELETE FROM medicos_disponibilidad WHERE medico_id = $1 AND modalidad = $2', [id, modalidad]);

        // Insertar nueva disponibilidad
        // Ahora soporta multiples rangos por dia usando el campo 'rangos'
        for (const dia of disponibilidad) {
            if (dia.activo) {
                // Nuevo formato: { dia_semana, activo, rangos: [{hora_inicio, hora_fin}, ...] }
                if (dia.rangos && Array.isArray(dia.rangos)) {
                    for (const rango of dia.rangos) {
                        if (rango.hora_inicio && rango.hora_fin) {
                            await pool.query(`
                                INSERT INTO medicos_disponibilidad (medico_id, dia_semana, hora_inicio, hora_fin, modalidad, activo)
                                VALUES ($1, $2, $3, $4, $5, $6)
                            `, [id, dia.dia_semana, rango.hora_inicio, rango.hora_fin, modalidad, true]);
                        }
                    }
                }
                // Formato anterior: { dia_semana, activo, hora_inicio, hora_fin }
                else if (dia.hora_inicio && dia.hora_fin) {
                    await pool.query(`
                        INSERT INTO medicos_disponibilidad (medico_id, dia_semana, hora_inicio, hora_fin, modalidad, activo)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    `, [id, dia.dia_semana, dia.hora_inicio, dia.hora_fin, modalidad, dia.activo]);
                }
            }
        }

        console.log(`Disponibilidad ${modalidad} actualizada para medico ID ${id}`);

        res.json({
            success: true,
            message: `Disponibilidad ${modalidad} guardada correctamente`
        });
    } catch (error) {
        console.error('Error al guardar disponibilidad:', error);
        res.status(500).json({
            success: false,
            message: 'Error al guardar disponibilidad',
            error: error.message
        });
    }
});

// DELETE - Eliminar disponibilidad de un dia especifico y modalidad
router.delete('/:id/disponibilidad/:dia', async (req, res) => {
    try {
        const { id, dia } = req.params;
        const { modalidad } = req.query;

        let query = `DELETE FROM medicos_disponibilidad WHERE medico_id = $1 AND dia_semana = $2`;
        const params = [id, dia];

        if (modalidad) {
            query += ` AND modalidad = $3`;
            params.push(modalidad);
        }

        await pool.query(query, params);

        res.json({
            success: true,
            message: 'Disponibilidad eliminada'
        });
    } catch (error) {
        console.error('Error al eliminar disponibilidad:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar disponibilidad',
            error: error.message
        });
    }
});

module.exports = router;
