const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { construirFechaAtencionColombia } = require('../helpers/date');
const { normalizarTelefonoConPrefijo57 } = require('../helpers/phone');
const { dispararWebhookMake, limpiarString, limpiarTelefono, mapearCiudad } = require('../helpers/webhook');
const { notificarNuevaOrden } = require('../helpers/sse');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { notificarCoordinadorNuevaOrden } = require('../services/payment');
const { HistoriaClinicaRepository, FormulariosRepository } = require('../repositories');

// Configuración de multer para uploads en memoria
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/ordenes/verificar-duplicado/:numeroId
router.get('/verificar-duplicado/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;
        const { codEmpresa } = req.query;

        if (!numeroId) {
            return res.json({ success: true, hayDuplicado: false, tipo: null });
        }

        // Use repository - buscar duplicados pendientes
        const ordenExistente = await HistoriaClinicaRepository.findDuplicadoPendiente(numeroId, codEmpresa);

        if (ordenExistente) {

            // Verificar si tiene formulario asociado - use repository
            const formExistente = await FormulariosRepository.findByWixIdOrNumeroId(ordenExistente._id, numeroId);
            const tieneFormulario = !!formExistente;

            // Verificar si la fecha de atención ya pasó
            let fechaExpirada = false;
            if (ordenExistente.fechaAtencion) {
                const fechaAtencion = new Date(ordenExistente.fechaAtencion);
                const hoy = new Date();
                // Comparar solo fechas (sin hora)
                fechaAtencion.setHours(0, 0, 0, 0);
                hoy.setHours(0, 0, 0, 0);
                fechaExpirada = fechaAtencion < hoy;
            }

            return res.json({
                success: true,
                hayDuplicado: true,
                tipo: fechaExpirada ? 'expirado' : 'pendiente',
                ordenExistente: {
                    _id: ordenExistente._id,
                    numeroId: ordenExistente.numeroId,
                    nombre: `${ordenExistente.primerNombre} ${ordenExistente.primerApellido}`,
                    empresa: ordenExistente.empresa || ordenExistente.codEmpresa,
                    tipoExamen: ordenExistente.tipoExamen,
                    fechaCreacion: ordenExistente._createdDate,
                    fechaAtencion: ordenExistente.fechaAtencion,
                    tieneFormulario
                }
            });
        }

        // Si no hay PENDIENTE, buscar ATENDIDO - use repository
        const ordenAtendida = await HistoriaClinicaRepository.findDuplicadoAtendido(numeroId, codEmpresa);

        if (ordenAtendida) {

            return res.json({
                success: true,
                hayDuplicado: true,
                tipo: 'atendido',
                ordenExistente: {
                    _id: ordenAtendida._id,
                    numeroId: ordenAtendida.numeroId,
                    nombre: `${ordenAtendida.primerNombre} ${ordenAtendida.primerApellido}`,
                    empresa: ordenAtendida.empresa || ordenAtendida.codEmpresa,
                    tipoExamen: ordenAtendida.tipoExamen,
                    fechaCreacion: ordenAtendida._createdDate,
                    fechaAtencion: ordenAtendida.fechaAtencion
                }
            });
        }

        // No hay ningún registro
        res.json({ success: true, hayDuplicado: false, tipo: null });
    } catch (error) {
        console.error('Error al verificar duplicado:', error);
        res.status(500).json({
            success: false,
            message: 'Error al verificar duplicado',
            error: error.message
        });
    }
});

// PATCH /api/ordenes/:id/fecha-atencion - Actualizar fecha de atención de una orden existente
router.patch('/:id/fecha-atencion', async (req, res) => {
    try {
        const { id } = req.params;
        const { fechaAtencion, horaAtencion, medico } = req.body;

        if (!fechaAtencion) {
            return res.status(400).json({
                success: false,
                message: 'La fecha de atención es requerida'
            });
        }

        // Actualizar en PostgreSQL - use repository
        const fechaCorrecta = construirFechaAtencionColombia(fechaAtencion, horaAtencion);
        const ordenActualizada = await HistoriaClinicaRepository.actualizarFechaAtencionConMedico(id, fechaCorrecta, medico || null);

        if (!ordenActualizada) {
            return res.status(404).json({
                success: false,
                message: 'Orden no encontrada'
            });
        }

        // Intentar actualizar en Wix también
        try {
            // Construir ISO string con hora Colombia para Wix
            let fechaAtencionWix = null;
            if (fechaAtencion && horaAtencion) {
                const fechaConHora = construirFechaAtencionColombia(fechaAtencion, horaAtencion);
                if (fechaConHora) {
                    fechaAtencionWix = fechaConHora.toISOString();
                }
            } else if (fechaAtencion) {
                const fechaConHora = construirFechaAtencionColombia(fechaAtencion, '08:00');
                if (fechaConHora) {
                    fechaAtencionWix = fechaConHora.toISOString();
                }
            }

            console.log('Fecha para Wix (actualizacion):', fechaAtencionWix);

            const wixResponse = await fetch('https://www.bsl-plataforma.com/_functions/actualizarFormulario', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    idGeneral: id,
                    fechaAtencion: fechaAtencionWix,
                    horaAtencion: horaAtencion || '',
                    medico: medico || ''
                })
            });

            if (wixResponse.ok) {
                console.log('Fecha y medico actualizados en Wix');
            }
        } catch (wixError) {
            console.error('Error al actualizar en Wix (no critico):', wixError.message);
        }

        res.json({
            success: true,
            message: 'Fecha de atención actualizada correctamente',
            orden: {
                _id: ordenActualizada._id,
                numeroId: ordenActualizada.numeroId,
                nombre: `${ordenActualizada.primerNombre} ${ordenActualizada.primerApellido}`,
                fechaAtencion: ordenActualizada.fechaAtencion,
                medico: ordenActualizada.medico
            }
        });
    } catch (error) {
        console.error('Error al actualizar fecha de atencion:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar la fecha de atención',
            error: error.message
        });
    }
});

// POST /api/ordenes - Crear nueva orden (guarda en PostgreSQL y Wix HistoriaClinica)
router.post('/', async (req, res) => {
    try {
        let {
            codEmpresa,
            numeroId,
            primerNombre,
            segundoNombre,
            primerApellido,
            segundoApellido,
            celular,
            cargo,
            ciudad,
            subempresa,
            centroDeCosto,
            tipoExamen,
            medico,
            fechaAtencion,
            horaAtencion,
            atendido,
            examenes,
            empresa,
            asignarMedicoAuto,
            modalidad
        } = req.body;

        console.log('');
        console.log('===================================================================');
        console.log('CREANDO NUEVA ORDEN');
        console.log('===================================================================');
        console.log('Datos recibidos:', JSON.stringify(req.body, null, 2));

        // Validar campos requeridos
        if (!numeroId || !primerNombre || !primerApellido || !codEmpresa || !celular) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos requeridos: numeroId, primerNombre, primerApellido, codEmpresa, celular'
            });
        }

        // Si se solicita asignación automática de médico
        if (asignarMedicoAuto && fechaAtencion && horaAtencion) {
            console.log('Asignacion automatica de medico solicitada...');
            console.log('   Fecha:', fechaAtencion, '| Hora:', horaAtencion, '| Modalidad:', modalidad || 'presencial');
            console.log('   codEmpresa:', codEmpresa);

            const fechaObj = new Date(fechaAtencion + 'T12:00:00');
            const diaSemana = fechaObj.getDay();
            const modalidadBuscar = modalidad || 'presencial';
            console.log('   Dia de semana:', diaSemana, '| Modalidad a buscar:', modalidadBuscar);

            // Buscar médicos disponibles para esa hora, fecha y modalidad (excepto NUBIA)
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
            `, [modalidadBuscar, diaSemana]);

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
                    horaInicio: row.hora_inicio,
                    horaFin: row.hora_fin
                });
            }

            // Filtrar médicos que realmente están disponibles en esa hora
            const medicosDisponibles = [];
            const [horaSelH, horaSelM] = horaAtencion.split(':').map(Number);
            const horaSelMinutos = horaSelH * 60 + horaSelM;

            console.log('   Total medicos encontrados:', Object.keys(medicosPorId).length);
            console.log('   Hora seleccionada:', horaAtencion, '| Minutos:', horaSelMinutos);

            for (const med of Object.values(medicosPorId)) {
                // Generar slots válidos para este médico (igual que en /api/turnos-disponibles)
                const tiempoConsulta = med.tiempoConsulta;
                let esSlotValido = false;

                console.log(`   Evaluando médico: ${med.nombre} | Tiempo consulta: ${tiempoConsulta} min`);

                // Generar todos los slots válidos para cada rango
                for (const rango of med.rangos) {
                    const [horaInicioH] = rango.horaInicio.split(':').map(Number);
                    const [horaFinH] = rango.horaFin.split(':').map(Number);

                    // Generar slots igual que en /api/turnos-disponibles
                    for (let hora = horaInicioH; hora < horaFinH; hora++) {
                        for (let minuto = 0; minuto < 60; minuto += tiempoConsulta) {
                            const slotMinutos = hora * 60 + minuto;
                            if (slotMinutos === horaSelMinutos) {
                                esSlotValido = true;
                                console.log(`   ✓ Slot ${hora}:${String(minuto).padStart(2, '0')} es válido`);
                                break;
                            }
                        }
                        if (esSlotValido) break;
                    }
                    if (esSlotValido) break;
                }

                if (!esSlotValido) {
                    console.log(`   ✗ ${med.nombre} descartado (slot no válido)`);
                    continue;
                }
                console.log(`   ✓ ${med.nombre} tiene slot válido`);


                // Verificar que no tenga cita a esa hora
                // EXCEPCIÓN: KM2 y SITEL pueden asignar médico aunque el turno esté ocupado
                // Se usa asignación por menor carga para distribuir pacientes equitativamente
                if (codEmpresa === 'KM2' || codEmpresa === 'SITEL') {
                    const cargaResult = await pool.query(`
                        SELECT COUNT(*) as total
                        FROM "HistoriaClinica"
                        WHERE "fechaAtencion" >= $1::timestamp
                          AND "fechaAtencion" < ($1::timestamp + interval '1 day')
                          AND "medico" = $2
                          AND "atendido" = 'PENDIENTE'
                    `, [fechaAtencion, med.nombre]);
                    const carga = parseInt(cargaResult.rows[0].total);
                    console.log(`   ${med.nombre} tiene ${carga} pacientes PENDIENTES hoy`);
                    medicosDisponibles.push({ nombre: med.nombre, carga });
                } else {
                    // Solo contar como ocupados los turnos PENDIENTES (no los ATENDIDOS)
                    const citaExistente = await pool.query(`
                        SELECT COUNT(*) as total
                        FROM "HistoriaClinica"
                        WHERE "fechaAtencion" >= $1::timestamp
                          AND "fechaAtencion" < ($1::timestamp + interval '1 day')
                          AND "medico" = $2
                          AND "horaAtencion" = $3
                          AND "atendido" = 'PENDIENTE'
                    `, [fechaAtencion, med.nombre, horaAtencion]);

                    if (parseInt(citaExistente.rows[0].total) === 0) {
                        medicosDisponibles.push(med.nombre);
                    }
                }
            }

            console.log('   Médicos disponibles encontrados:', medicosDisponibles);

            if (medicosDisponibles.length === 0) {
                console.log('   ❌ ERROR: No se encontraron médicos disponibles');
                return res.status(400).json({
                    success: false,
                    message: 'No hay médicos disponibles para el horario seleccionado'
                });
            }

            // Asignar médico: por menor carga (SITEL/KM2) o el primero disponible
            if (medicosDisponibles[0] && medicosDisponibles[0].carga !== undefined) {
                medicosDisponibles.sort((a, b) => a.carga - b.carga);
                medico = medicosDisponibles[0].nombre;
                console.log('Medico asignado por menor carga:', medico, `(${medicosDisponibles[0].carga} pendientes)`);
            } else {
                medico = medicosDisponibles[0];
                console.log('Medico asignado automaticamente:', medico);
            }
        }

        // Generar un _id único para Wix (formato UUID-like)
        const wixId = `orden_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 1. Guardar en PostgreSQL HistoriaClinica
        console.log('');
        console.log('Guardando en PostgreSQL HistoriaClinica...');

        const insertQuery = `
            INSERT INTO "HistoriaClinica" (
                "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                "celular", "codEmpresa", "empresa", "cargo", "ciudad", "subempresa", "centro_de_costo", "tipoExamen", "medico",
                "fechaAtencion", "horaAtencion", "atendido", "examenes", "_createdDate", "_updatedDate"
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW()
            )
            RETURNING "_id", "numeroId", "primerNombre", "primerApellido"
        `;

        const insertValues = [
            wixId,
            numeroId,
            primerNombre,
            segundoNombre || null,
            primerApellido,
            segundoApellido || null,
            celular,
            codEmpresa,
            empresa || null,
            cargo || null,
            ciudad || null,
            subempresa || null,
            centroDeCosto || null,
            tipoExamen || null,
            medico || null,
            construirFechaAtencionColombia(fechaAtencion, horaAtencion),
            horaAtencion || null,
            atendido || 'PENDIENTE',
            examenes || null
        ];

        const pgResult = await pool.query(insertQuery, insertValues);
        console.log('PostgreSQL: Orden guardada con _id:', wixId);

        // Gestionar registro en tabla conversaciones_whatsapp
        try {
            // Normalizar celular usando helper (formato: +57XXXXXXXXXX con +)
            const celularConPrefijo = normalizarTelefonoConPrefijo57(celular);
            // Versión sin + para búsqueda retrocompatible (conversaciones antiguas)
            const celularSinMas = celularConPrefijo ? celularConPrefijo.replace(/^\+/, '') : null;
            console.log('🔥 [FIX-V2] Gestionando conversacion WhatsApp para:', celularConPrefijo, '(retrocompat:', celularSinMas, ')');

            // Verificar si ya existe un registro con ese celular (búsqueda retrocompatible)
            // Primero buscar con +, luego sin + para conversaciones antiguas
            let conversacionExistente = await pool.query(`
                SELECT id, celular, "stopBot"
                FROM conversaciones_whatsapp
                WHERE celular = $1
            `, [celularConPrefijo]);

            // Si no encuentra con +, buscar sin + (conversaciones antiguas)
            if (conversacionExistente.rows.length === 0 && celularSinMas) {
                conversacionExistente = await pool.query(`
                    SELECT id, celular, "stopBot"
                    FROM conversaciones_whatsapp
                    WHERE celular = $1
                `, [celularSinMas]);
                if (conversacionExistente.rows.length > 0) {
                    console.log('Conversacion encontrada con formato antiguo (sin +):', celularSinMas);
                }
            }

            if (conversacionExistente.rows.length > 0) {
                // Si existe, actualizar stopBot a true, bot_activo a false y datos del paciente
                // Usar el celular tal como está en la BD para el WHERE
                const celularEnBD = conversacionExistente.rows[0].celular;
                await pool.query(`
                    UPDATE conversaciones_whatsapp
                    SET "stopBot" = true,
                        bot_activo = false,
                        paciente_id = $2,
                        nombre_paciente = $3,
                        fecha_ultima_actividad = NOW()
                    WHERE celular = $1
                `, [celularEnBD, numeroId, `${primerNombre} ${primerApellido}`]);
                console.log('Conversacion WhatsApp actualizada: stopBot = true, bot_activo = false para', celularEnBD);
            } else {
                // Si no existe, crear nuevo registro con stopBot = true (con formato +)
                await pool.query(`
                    INSERT INTO conversaciones_whatsapp (
                        celular,
                        paciente_id,
                        nombre_paciente,
                        "stopBot",
                        origen,
                        estado,
                        bot_activo,
                        fecha_inicio,
                        fecha_ultima_actividad
                    ) VALUES (
                        $1, $2, $3, true, 'POSTGRES', 'nueva', false, NOW(), NOW()
                    )
                `, [
                    celularConPrefijo,
                    numeroId,
                    `${primerNombre} ${primerApellido}`
                ]);
                console.log('Nueva conversacion WhatsApp creada con stopBot = true para', celularConPrefijo);
            }
        } catch (whatsappError) {
            console.error('Error al gestionar conversacion WhatsApp:', whatsappError.message);
            // No bloqueamos la creación de la orden si falla la gestión de WhatsApp
        }

        // Enviar mensaje de confirmación por WhatsApp con Twilio (solo si tiene fecha y hora)
        if (fechaAtencion && horaAtencion && celular) {
            try {
                console.log('Enviando mensaje de confirmacion por WhatsApp...');

                const nombreCompleto = `${primerNombre} ${primerApellido}`;

                // Formatear fecha y hora para Colombia
                const fechaObj = construirFechaAtencionColombia(fechaAtencion, horaAtencion);
                if (fechaObj) {
                    // Convertir a hora de Colombia (UTC-5)
                    const offsetColombia = -5 * 60;
                    const offsetLocal = fechaObj.getTimezoneOffset();
                    const fechaColombia = new Date(fechaObj.getTime() + (offsetLocal + offsetColombia) * 60000);

                    const fechaFormateada = fechaColombia.toLocaleDateString('es-CO', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });
                    const horaFormateada = fechaColombia.toLocaleTimeString('es-CO', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });
                    const fechaHoraCompleta = `${fechaFormateada} a las ${horaFormateada}`;

                    // Normalizar teléfono
                    const telefonoCompleto = normalizarTelefonoConPrefijo57(celular);

                    if (telefonoCompleto) {
                        // Template: confirmación de cita (HX43d06a0a97e11919c1e4b19d3e4b6957)
                        // Variables: {{1}} = nombre, {{2}} = fecha y hora
                        const templateSid = 'HX43d06a0a97e11919c1e4b19d3e4b6957';
                        const variables = {
                            "1": nombreCompleto,
                            "2": fechaHoraCompleta
                        };

                        const resultWhatsApp = await sendWhatsAppMessage(
                            telefonoCompleto,
                            null, // No hay mensaje de texto libre
                            variables,
                            templateSid
                        );

                        if (resultWhatsApp.success) {
                            console.log(`Mensaje de confirmacion enviado a ${telefonoCompleto}`);
                        } else {
                            console.error(`No se pudo enviar mensaje de confirmacion: ${resultWhatsApp.error}`);
                        }
                    }
                }
            } catch (confirmacionError) {
                console.error('Error al enviar mensaje de confirmacion:', confirmacionError.message);
                // No bloqueamos la creación de la orden si falla el envío del mensaje
            }
        }

        // Disparar webhook a Make.com (async, no bloquea) para enviar WhatsApp al paciente
        dispararWebhookMake({
            _id: wixId,
            celular,
            numeroId,
            primerNombre,
            codEmpresa,
            examenes,
            ciudad,
            fechaAtencion,
            horaAtencion,
            medico,
            modalidad
        });

        // Notificar al coordinador de agendamiento (async, no bloquea)
        notificarCoordinadorNuevaOrden({
            _id: wixId,
            numeroId,
            primerNombre,
            segundoNombre,
            primerApellido,
            segundoApellido,
            celular,
            ciudad,
            codEmpresa,
            tipoExamen,
            fechaAtencion,
            horaAtencion,
            modalidad
        });

        // 2. Sincronizar con Wix
        console.log('');
        console.log('Sincronizando con Wix...');

        try {
            // Construir fecha para Wix: debe ser ISO string con hora Colombia
            // Wix espera un Date que se serializa como ISO string
            let fechaAtencionWix = null;
            if (fechaAtencion && horaAtencion) {
                // Construir ISO string con hora Colombia (UTC-5)
                const fechaConHora = construirFechaAtencionColombia(fechaAtencion, horaAtencion);
                if (fechaConHora) {
                    fechaAtencionWix = fechaConHora.toISOString();
                }
            } else if (fechaAtencion) {
                // Solo fecha, usar hora por defecto 08:00
                const fechaConHora = construirFechaAtencionColombia(fechaAtencion, '08:00');
                if (fechaConHora) {
                    fechaAtencionWix = fechaConHora.toISOString();
                }
            }

            const wixPayload = {
                _id: wixId,
                numeroId,
                primerNombre,
                segundoNombre: segundoNombre || '',
                primerApellido,
                segundoApellido: segundoApellido || '',
                celular,
                codEmpresa,
                empresa: empresa || '',
                cargo: cargo || '',
                ciudad: ciudad || '',
                tipoExamen: tipoExamen || '',
                medico: medico || '',
                fechaAtencion: fechaAtencionWix,
                horaAtencion: horaAtencion || '',
                atendido: atendido || 'PENDIENTE',
                examenes: examenes || ''
            };

            console.log('Fecha para Wix:', fechaAtencionWix);

            const wixResponse = await fetch('https://www.bsl.com.co/_functions/crearHistoriaClinica', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(wixPayload)
            });

            if (wixResponse.ok) {
                const wixResult = await wixResponse.json();
                console.log('Wix: Sincronizado exitosamente');
                console.log('   Respuesta:', JSON.stringify(wixResult, null, 2));
            } else {
                const errorText = await wixResponse.text();
                console.error('Wix: Error al sincronizar');
                console.error('   Status:', wixResponse.status);
                console.error('   Response:', errorText);
            }
        } catch (wixError) {
            console.error('Wix: Excepcion al sincronizar:', wixError.message);
            // No bloqueamos si Wix falla
        }

        console.log('');
        console.log('===================================================================');
        console.log('ORDEN CREADA EXITOSAMENTE');
        console.log('   _id:', wixId);
        console.log('   Paciente:', primerNombre, primerApellido);
        console.log('   Cedula:', numeroId);
        console.log('===================================================================');
        console.log('');

        // Notificar a clientes SSE sobre la nueva orden
        notificarNuevaOrden({
            _id: wixId,
            numeroId,
            primerNombre,
            primerApellido,
            medico: req.body.medico
        });

        res.json({
            success: true,
            message: 'Orden creada exitosamente',
            data: {
                _id: wixId,
                numeroId,
                primerNombre,
                primerApellido
            }
        });

    } catch (error) {
        console.error('Error al crear orden:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear la orden',
            error: error.message
        });
    }
});

// POST /api/ordenes/previsualizar-csv - Previsualizar órdenes desde CSV antes de importar
router.post('/previsualizar-csv', upload.single('archivo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No se ha subido ningún archivo'
            });
        }

        console.log('');
        console.log('===================================================================');
        console.log('PREVISUALIZACION CSV DE ORDENES');
        console.log('===================================================================');

        // Parsear CSV desde buffer - strip BOM
        let csvContent = req.file.buffer.toString('utf-8');
        if (csvContent.charCodeAt(0) === 0xFEFF) csvContent = csvContent.slice(1);
        const lines = csvContent.split('\n').filter(line => line.trim());

        if (lines.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'El archivo CSV está vacío o solo tiene encabezados'
            });
        }

        // Auto-detect delimiter (comma, semicolon, or tab)
        const firstLine = lines[0];
        const semicolonCount = (firstLine.match(/;/g) || []).length;
        const commaCount = (firstLine.match(/,/g) || []).length;
        const tabCount = (firstLine.match(/\t/g) || []).length;
        let delimiter = ',';
        if (semicolonCount > commaCount && semicolonCount > tabCount) delimiter = ';';
        else if (tabCount > commaCount && tabCount > semicolonCount) delimiter = '\t';
        console.log('Delimitador detectado:', delimiter === ',' ? 'coma' : delimiter === ';' ? 'punto y coma' : 'tab');

        // Obtener encabezados (primera línea) y normalizarlos
        const headersRaw = firstLine.split(delimiter).map(h => h.trim().replace(/"/g, ''));

        // Helper: normalizar string para matching (sin acentos, minúsculas, sin espacios extra)
        const normalizarH = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim();

        // Helper: convertir hora AM/PM a formato 24h
        const convertirHora24 = (hora) => {
            if (!hora) return null;
            hora = hora.trim();
            const match = hora.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a\.?\s*m\.?|p\.?\s*m\.?)$/i);
            if (match) {
                let h = parseInt(match[1]);
                const m = match[2];
                const period = match[3].replace(/[\.\s]/g, '').toUpperCase();
                if (period === 'PM' && h < 12) h += 12;
                if (period === 'AM' && h === 12) h = 0;
                return `${h.toString().padStart(2, '0')}:${m}`;
            }
            return hora;
        };

        // Mapeo de nombres alternativos a nombres estándar
        const headerMapping = {
            'Fecha Atención': 'fechaAtencion',
            'Fecha Atencion': 'fechaAtencion',
            'fecha_atencion': 'fechaAtencion',
            'Hora Atención': 'horaAtencion',
            'Hora Atencion': 'horaAtencion',
            'hora_atencion': 'horaAtencion',
            'primer_nombre': 'primerNombre',
            'segundo_nombre': 'segundoNombre',
            'primer_apellido': 'primerApellido',
            'segundo_apellido': 'segundoApellido',
            'numero_id': 'numeroId',
            'tipo_examen': 'tipoExamen',
            'nombres': 'primerNombre',
            'apellidos': 'primerApellido',
            'cod_empresa': 'codEmpresa',
            // Mapeos para plantilla de agendamiento
            'NOMBRE': 'primerNombre',
            'APELLIDOS': 'primerApellido',
            'NÚMERO DE DOCUMENTO': 'numeroId',
            'NUMERO DE DOCUMENTO': 'numeroId',
            'NÚMERO DE CONTACTO': 'celular',
            'NUMERO DE CONTACTO': 'celular',
            'CORREO ELECTRONICO': 'correo',
            'CORREO ELECTRÓNICO': 'correo',
            'DIRECCIÓN': 'direccion',
            'DIRECCION': 'direccion',
            'FECHA': 'fechaAtencion',
            'HORA': 'horaAtencion',
            'EMPRESA': 'empresa',
            'TIPO DE EXAMEN': 'tipoExamen',
            'ROL': 'cargo',
            'OBSERVACION': 'examenes',
            'OBSERVACIÓN': 'examenes',
            'MEDICO': 'medico',
            'MÉDICO': 'medico'
        };

        // Crear mapeo normalizado (sin acentos, minúsculas) para matching flexible
        const mappingNormalizado = {};
        for (const [key, value] of Object.entries(headerMapping)) {
            mappingNormalizado[normalizarH(key)] = value;
        }
        // Agregar nombres estándar de campos al mapeo normalizado
        ['fechaAtencion', 'horaAtencion', 'primerNombre', 'segundoNombre',
         'primerApellido', 'segundoApellido', 'numeroId', 'tipoExamen',
         'codEmpresa', 'celular', 'cargo', 'ciudad', 'empresa', 'medico',
         'correo', 'direccion', 'examenes', 'atendido', 'tipoId'].forEach(f => {
            mappingNormalizado[normalizarH(f)] = f;
        });
        // Agregar variaciones adicionales comunes
        mappingNormalizado['fecha atencion'] = 'fechaAtencion';
        mappingNormalizado['hora atencion'] = 'horaAtencion';
        mappingNormalizado['fecha'] = 'fechaAtencion';
        mappingNormalizado['hora'] = 'horaAtencion';
        mappingNormalizado['tipo examen'] = 'tipoExamen';
        mappingNormalizado['tipo de examen'] = 'tipoExamen';
        mappingNormalizado['cod empresa'] = 'codEmpresa';
        mappingNormalizado['codigo empresa'] = 'codEmpresa';
        mappingNormalizado['numero id'] = 'numeroId';
        mappingNormalizado['numero de documento'] = 'numeroId';
        mappingNormalizado['numero de contacto'] = 'celular';
        mappingNormalizado['correo electronico'] = 'correo';
        mappingNormalizado['nombre'] = 'primerNombre';
        mappingNormalizado['nombres'] = 'primerNombre';
        mappingNormalizado['apellido'] = 'primerApellido';
        mappingNormalizado['apellidos'] = 'primerApellido';
        mappingNormalizado['observacion'] = 'examenes';
        mappingNormalizado['rol'] = 'cargo';
        mappingNormalizado['documento'] = 'numeroId';

        // Normalizar headers con matching flexible (primero exacto, luego normalizado)
        const headers = headersRaw.map(h => {
            if (headerMapping[h]) return headerMapping[h];
            const n = normalizarH(h);
            if (mappingNormalizado[n]) return mappingNormalizado[n];
            return h;
        });
        console.log('Encabezados originales:', headersRaw);
        console.log('Encabezados normalizados:', headers);

        // Campos requeridos
        const camposRequeridos = ['numeroId', 'primerNombre', 'primerApellido', 'codEmpresa'];
        const camposFaltantes = camposRequeridos.filter(c => !headers.includes(c));

        if (camposFaltantes.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Faltan campos requeridos en el CSV: ${camposFaltantes.join(', ')}`
            });
        }

        // Previsualizar cada fila (desde la segunda línea)
        const registros = [];
        const errores = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                // Parsear línea CSV usando delimitador detectado
                const values = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));

                // Crear objeto con los valores
                const row = {};
                headers.forEach((header, index) => {
                    row[header] = values[index] !== undefined && values[index] !== '' ? values[index] : null;
                });

                // Ignorar filas vacías o con datos inválidos
                const valoresNoVacios = values.filter(v => v && v.trim() !== '' && v.trim() !== 'CC');
                if (valoresNoVacios.length === 0) {
                    console.log(`   Fila ${i + 1} ignorada (vacia)`);
                    continue;
                }

                // Validar campos mínimos
                if (!row.numeroId || !row.primerNombre || !row.primerApellido || !row.codEmpresa) {
                    errores.push({
                        fila: i + 1,
                        error: 'Falta información requerida',
                        datos: row
                    });
                    continue;
                }

                // Normalizar fecha si existe
                let fechaFormateada = null;
                if (row.fechaAtencion) {
                    let fechaNormalizada = row.fechaAtencion.trim();

                    // Manejar separadores: /, -, .
                    const separadorMatch = fechaNormalizada.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
                    if (separadorMatch) {
                        const primero = parseInt(separadorMatch[1]);
                        const segundo = parseInt(separadorMatch[2]);
                        let anio = separadorMatch[3];
                        // Año de 2 dígitos -> 4 dígitos
                        if (anio.length === 2) anio = (parseInt(anio) > 50 ? '19' : '20') + anio;

                        if (segundo > 12) {
                            fechaNormalizada = `${anio}-${separadorMatch[1].padStart(2, '0')}-${separadorMatch[2].padStart(2, '0')}`;
                        } else if (primero > 12) {
                            fechaNormalizada = `${anio}-${separadorMatch[2].padStart(2, '0')}-${separadorMatch[1].padStart(2, '0')}`;
                        } else {
                            fechaNormalizada = `${anio}-${separadorMatch[1].padStart(2, '0')}-${separadorMatch[2].padStart(2, '0')}`;
                        }
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(fechaNormalizada)) {
                        // Ya está en formato YYYY-MM-DD, no hacer nada
                    }
                    fechaFormateada = fechaNormalizada;
                }

                // Convertir hora AM/PM a 24h
                const horaConvertida = convertirHora24(row.horaAtencion) || '08:00';

                registros.push({
                    fila: i + 1,
                    numeroId: row.numeroId,
                    primerNombre: row.primerNombre,
                    segundoNombre: row.segundoNombre,
                    primerApellido: row.primerApellido,
                    segundoApellido: row.segundoApellido,
                    celular: row.celular,
                    correo: row.correo,
                    direccion: row.direccion,
                    cargo: row.cargo,
                    ciudad: row.ciudad,
                    fechaAtencion: fechaFormateada,
                    horaAtencion: horaConvertida,
                    empresa: row.empresa || row.codEmpresa,
                    tipoExamen: row.tipoExamen,
                    medico: row.medico,
                    codEmpresa: row.codEmpresa,
                    examenes: row.examenes
                });

            } catch (error) {
                errores.push({
                    fila: i + 1,
                    error: error.message
                });
            }
        }

        console.log(`Previsualizacion completada: ${registros.length} registros validos`);

        res.json({
            success: true,
            total: registros.length,
            registros: registros,
            errores: errores
        });

    } catch (error) {
        console.error('Error en previsualizacion CSV:', error);
        res.status(500).json({
            success: false,
            message: 'Error procesando el archivo CSV',
            error: error.message
        });
    }
});

// POST /api/ordenes/importar-desde-preview - Importar órdenes aprobadas desde preview
router.post('/importar-desde-preview', async (req, res) => {
    try {
        const { registros } = req.body;

        if (!registros || !Array.isArray(registros) || registros.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No se recibieron registros para importar'
            });
        }

        console.log('');
        console.log('===================================================================');
        console.log('IMPORTACION APROBADA DESDE PREVIEW');
        console.log('===================================================================');

        const resultados = {
            total: registros.length,
            exitosos: 0,
            errores: [],
            ordenesCreadas: []
        };

        for (const registro of registros) {
            try {
                // Generar ID único para la orden
                const ordenId = `orden_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // Parsear fecha de atención (convertir AM/PM por si el usuario editó en el preview)
                let fechaAtencionParsed = null;
                if (registro.fechaAtencion) {
                    let hora = registro.horaAtencion || '08:00';
                    // Convertir hora AM/PM a 24h
                    const ampmMatch = hora.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a\.?\s*m\.?|p\.?\s*m\.?)$/i);
                    if (ampmMatch) {
                        let h = parseInt(ampmMatch[1]);
                        const m = ampmMatch[2];
                        const period = ampmMatch[3].replace(/[\.\s]/g, '').toUpperCase();
                        if (period === 'PM' && h < 12) h += 12;
                        if (period === 'AM' && h === 12) h = 0;
                        hora = `${h.toString().padStart(2, '0')}:${m}`;
                    }
                    const fechaObj = construirFechaAtencionColombia(registro.fechaAtencion, hora);
                    if (fechaObj) {
                        fechaAtencionParsed = fechaObj;
                    }
                }

                // Insertar en PostgreSQL
                const insertQuery = `
                    INSERT INTO "HistoriaClinica" (
                        "_id", "numeroId", "primerNombre", "segundoNombre",
                        "primerApellido", "segundoApellido",
                        "celular", "cargo", "ciudad", "fechaAtencion",
                        "empresa", "tipoExamen", "medico", "atendido",
                        "codEmpresa", "examenes", "_createdDate", "_updatedDate"
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW()
                    )
                    RETURNING "_id"
                `;

                const insertValues = [
                    ordenId,
                    registro.numeroId,
                    registro.primerNombre,
                    registro.segundoNombre || null,
                    registro.primerApellido,
                    registro.segundoApellido || null,
                    registro.celular || null,
                    registro.cargo || null,
                    registro.ciudad || null,
                    fechaAtencionParsed,
                    registro.empresa || registro.codEmpresa,
                    registro.tipoExamen || null,
                    registro.medico || null,
                    'PENDIENTE',
                    registro.codEmpresa,
                    registro.examenes || null
                ];

                await pool.query(insertQuery, insertValues);

                // Crear/actualizar conversación de WhatsApp si hay celular
                if (registro.celular) {
                    try {
                        const telefonoNormalizado = normalizarTelefonoConPrefijo57(registro.celular);

                        if (telefonoNormalizado) {
                            // Buscar conversación - primero con +, luego sin + (conversaciones viejas)
                            let conversacionExistente = await pool.query(
                                'SELECT id, celular FROM conversaciones_whatsapp WHERE celular = $1 AND estado != $2',
                                [telefonoNormalizado, 'cerrada']
                            );

                            // Si no se encuentra con +, buscar sin + (conversaciones antiguas)
                            if (conversacionExistente.rows.length === 0 && telefonoNormalizado.startsWith('+')) {
                                const numeroSinMas = telefonoNormalizado.substring(1);
                                conversacionExistente = await pool.query(
                                    'SELECT id, celular FROM conversaciones_whatsapp WHERE celular = $1 AND estado != $2',
                                    [numeroSinMas, 'cerrada']
                                );
                            }

                            if (conversacionExistente.rows.length === 0) {
                                // No existe conversación activa, crear una nueva
                                await pool.query(`
                                    INSERT INTO conversaciones_whatsapp (
                                        celular, paciente_id, nombre_paciente, "stopBot", bot_activo, estado, canal, fecha_inicio, fecha_ultima_actividad, origen
                                    ) VALUES ($1, $2, $3, true, false, $4, $5, NOW(), NOW(), 'POSTGRES')
                                `, [
                                    telefonoNormalizado,
                                    ordenId,
                                    `${registro.primerNombre} ${registro.primerApellido}`,
                                    'nueva',
                                    'bot'
                                ]);

                                console.log(`Conversacion WhatsApp creada para ${telefonoNormalizado} con stopBot = true`);
                            } else {
                                // Ya existe, actualizar usando el celular como está en la BD
                                const celularEnBD = conversacionExistente.rows[0].celular;
                                await pool.query(`
                                    UPDATE conversaciones_whatsapp
                                    SET "stopBot" = true, bot_activo = false, fecha_ultima_actividad = NOW()
                                    WHERE celular = $1 AND estado != 'cerrada'
                                `, [celularEnBD]);

                                console.log(`Conversacion WhatsApp actualizada para ${celularEnBD} con stopBot = true`);
                            }
                        }
                    } catch (whatsappError) {
                        console.log(`Error al crear/actualizar conversacion WhatsApp: ${whatsappError.message}`);
                        // No detener el proceso si falla la creación de la conversación
                    }
                }

                // Sincronizar con Wix
                try {
                    let examenesArray = [];
                    if (registro.examenes) {
                        examenesArray = registro.examenes
                            .split(/[;,]/)
                            .map(e => e.trim())
                            .filter(e => e.length > 0);
                    }

                    const wixPayload = {
                        _id: ordenId,
                        numeroId: registro.numeroId,
                        primerNombre: registro.primerNombre,
                        segundoNombre: registro.segundoNombre || '',
                        primerApellido: registro.primerApellido,
                        segundoApellido: registro.segundoApellido || '',
                        celular: registro.celular || '',
                        codEmpresa: registro.codEmpresa,
                        empresa: registro.empresa || registro.codEmpresa,
                        cargo: registro.cargo || '',
                        ciudad: registro.ciudad || '',
                        tipoExamen: registro.tipoExamen || '',
                        medico: registro.medico || '',
                        fechaAtencion: fechaAtencionParsed ? fechaAtencionParsed.toISOString() : null,
                        horaAtencion: registro.horaAtencion || '',
                        atendido: 'PENDIENTE',
                        examenes: examenesArray
                    };

                    const wixResponse = await fetch('https://www.bsl.com.co/_functions/crearHistoriaClinica', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(wixPayload)
                    });

                    if (wixResponse.ok) {
                        console.log(`${registro.primerNombre} ${registro.primerApellido} (${registro.numeroId}) - Sincronizado con Wix`);
                    } else {
                        console.log(`${registro.primerNombre} ${registro.primerApellido} - PostgreSQL OK, Wix fallo`);
                    }

                } catch (wixError) {
                    console.log(`${registro.primerNombre} ${registro.primerApellido} - PostgreSQL OK, Wix error: ${wixError.message}`);
                }

                resultados.exitosos++;
                resultados.ordenesCreadas.push({
                    _id: ordenId,
                    numeroId: registro.numeroId,
                    nombre: `${registro.primerNombre} ${registro.primerApellido}`
                });

            } catch (error) {
                console.error(`Error en registro ${registro.numeroId}:`, error.message);
                resultados.errores.push({
                    numeroId: registro.numeroId,
                    error: error.message
                });
            }
        }

        console.log('');
        console.log('===================================================================');
        console.log(`RESUMEN: ${resultados.exitosos}/${resultados.total} ordenes importadas`);
        if (resultados.errores.length > 0) {
            console.log(`Errores: ${resultados.errores.length}`);
        }
        console.log('===================================================================');

        res.json({
            success: true,
            message: `Se importaron ${resultados.exitosos} de ${resultados.total} órdenes`,
            resultados
        });

    } catch (error) {
        console.error('Error al importar desde preview:', error);
        res.status(500).json({
            success: false,
            message: 'Error al importar las órdenes',
            error: error.message
        });
    }
});

// POST /api/ordenes/importar-csv - Importar órdenes desde CSV
router.post('/importar-csv', upload.single('archivo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No se ha subido ningún archivo'
            });
        }

        console.log('');
        console.log('===================================================================');
        console.log('IMPORTACION CSV DE ORDENES');
        console.log('===================================================================');

        const resultados = {
            total: 0,
            exitosos: 0,
            errores: [],
            ordenesCreadas: []
        };

        // Parsear CSV desde buffer - strip BOM
        let csvContent = req.file.buffer.toString('utf-8');
        if (csvContent.charCodeAt(0) === 0xFEFF) csvContent = csvContent.slice(1);
        const lines = csvContent.split('\n').filter(line => line.trim());

        if (lines.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'El archivo CSV está vacío o solo tiene encabezados'
            });
        }

        // Auto-detect delimiter (comma, semicolon, or tab)
        const firstLine = lines[0];
        const semicolonCount = (firstLine.match(/;/g) || []).length;
        const commaCount = (firstLine.match(/,/g) || []).length;
        const tabCount = (firstLine.match(/\t/g) || []).length;
        let delimiter = ',';
        if (semicolonCount > commaCount && semicolonCount > tabCount) delimiter = ';';
        else if (tabCount > commaCount && tabCount > semicolonCount) delimiter = '\t';
        console.log('Delimitador detectado:', delimiter === ',' ? 'coma' : delimiter === ';' ? 'punto y coma' : 'tab');

        // Obtener encabezados (primera línea) y normalizarlos
        const headersRaw = firstLine.split(delimiter).map(h => h.trim().replace(/"/g, ''));

        // Helper: normalizar string para matching (sin acentos, minúsculas)
        const normalizarH = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim();

        // Helper: convertir hora AM/PM a formato 24h
        const convertirHora24 = (hora) => {
            if (!hora) return null;
            hora = hora.trim();
            const match = hora.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a\.?\s*m\.?|p\.?\s*m\.?)$/i);
            if (match) {
                let h = parseInt(match[1]);
                const m = match[2];
                const period = match[3].replace(/[\.\s]/g, '').toUpperCase();
                if (period === 'PM' && h < 12) h += 12;
                if (period === 'AM' && h === 12) h = 0;
                return `${h.toString().padStart(2, '0')}:${m}`;
            }
            return hora;
        };

        // Mapeo de nombres alternativos a nombres estándar
        const headerMapping = {
            'Fecha Atención': 'fechaAtencion',
            'Fecha Atencion': 'fechaAtencion',
            'fecha_atencion': 'fechaAtencion',
            'Hora Atención': 'horaAtencion',
            'Hora Atencion': 'horaAtencion',
            'hora_atencion': 'horaAtencion',
            'primer_nombre': 'primerNombre',
            'segundo_nombre': 'segundoNombre',
            'primer_apellido': 'primerApellido',
            'segundo_apellido': 'segundoApellido',
            'numero_id': 'numeroId',
            'tipo_examen': 'tipoExamen',
            'nombres': 'primerNombre',
            'apellidos': 'primerApellido',
            'cod_empresa': 'codEmpresa',
            // Mapeos para plantilla de agendamiento
            'NOMBRE': 'primerNombre',
            'APELLIDOS': 'primerApellido',
            'NÚMERO DE DOCUMENTO': 'numeroId',
            'NUMERO DE DOCUMENTO': 'numeroId',
            'NÚMERO DE CONTACTO': 'celular',
            'NUMERO DE CONTACTO': 'celular',
            'CORREO ELECTRONICO': 'correo',
            'CORREO ELECTRÓNICO': 'correo',
            'DIRECCIÓN': 'direccion',
            'DIRECCION': 'direccion',
            'FECHA': 'fechaAtencion',
            'HORA': 'horaAtencion',
            'EMPRESA': 'empresa',
            'TIPO DE EXAMEN': 'tipoExamen',
            'ROL': 'cargo',
            'OBSERVACION': 'examenes',
            'OBSERVACIÓN': 'examenes',
            'MEDICO': 'medico',
            'MÉDICO': 'medico'
        };

        // Crear mapeo normalizado para matching flexible
        const mappingNormalizado = {};
        for (const [key, value] of Object.entries(headerMapping)) {
            mappingNormalizado[normalizarH(key)] = value;
        }
        ['fechaAtencion', 'horaAtencion', 'primerNombre', 'segundoNombre',
         'primerApellido', 'segundoApellido', 'numeroId', 'tipoExamen',
         'codEmpresa', 'celular', 'cargo', 'ciudad', 'empresa', 'medico',
         'correo', 'direccion', 'examenes', 'atendido', 'tipoId'].forEach(f => {
            mappingNormalizado[normalizarH(f)] = f;
        });
        mappingNormalizado['fecha atencion'] = 'fechaAtencion';
        mappingNormalizado['hora atencion'] = 'horaAtencion';
        mappingNormalizado['fecha'] = 'fechaAtencion';
        mappingNormalizado['hora'] = 'horaAtencion';
        mappingNormalizado['tipo examen'] = 'tipoExamen';
        mappingNormalizado['tipo de examen'] = 'tipoExamen';
        mappingNormalizado['cod empresa'] = 'codEmpresa';
        mappingNormalizado['codigo empresa'] = 'codEmpresa';
        mappingNormalizado['numero id'] = 'numeroId';
        mappingNormalizado['numero de documento'] = 'numeroId';
        mappingNormalizado['numero de contacto'] = 'celular';
        mappingNormalizado['correo electronico'] = 'correo';
        mappingNormalizado['nombre'] = 'primerNombre';
        mappingNormalizado['nombres'] = 'primerNombre';
        mappingNormalizado['apellido'] = 'primerApellido';
        mappingNormalizado['apellidos'] = 'primerApellido';
        mappingNormalizado['observacion'] = 'examenes';
        mappingNormalizado['rol'] = 'cargo';
        mappingNormalizado['documento'] = 'numeroId';

        // Normalizar headers con matching flexible
        const headers = headersRaw.map(h => {
            if (headerMapping[h]) return headerMapping[h];
            const n = normalizarH(h);
            if (mappingNormalizado[n]) return mappingNormalizado[n];
            return h;
        });
        console.log('Encabezados originales:', headersRaw);
        console.log('Encabezados normalizados:', headers);

        // Campos requeridos
        const camposRequeridos = ['numeroId', 'primerNombre', 'primerApellido', 'codEmpresa'];
        const camposFaltantes = camposRequeridos.filter(c => !headers.includes(c));

        if (camposFaltantes.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Faltan campos requeridos en el CSV: ${camposFaltantes.join(', ')}`
            });
        }

        // Procesar cada fila (desde la segunda línea)
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                // Parsear línea CSV usando delimitador detectado
                const values = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));

                // Crear objeto con los valores
                const row = {};
                headers.forEach((header, index) => {
                    row[header] = values[index] !== undefined ? values[index] : null;
                });

                // Ignorar filas vacías o con datos inválidos
                const valoresNoVacios = values.filter(v => v && v.trim() !== '' && v.trim() !== 'CC');
                if (valoresNoVacios.length === 0) {
                    console.log(`   Fila ${i + 1} ignorada (vacia o solo tiene valores irrelevantes)`);
                    continue;
                }

                // Ignorar filas sin campos mínimos requeridos
                if (!row.numeroId || !row.primerNombre || !row.primerApellido || !row.codEmpresa) {
                    console.log(`   Fila ${i + 1} ignorada (faltan campos requeridos):`, JSON.stringify(row));
                    continue;
                }

                resultados.total++;
                console.log(`   Fila ${i + 1} parseada:`, JSON.stringify(row));

                // Generar ID único para la orden
                const ordenId = `orden_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // Parsear fecha de atención usando la función helper que maneja zona horaria Colombia
                let fechaAtencionParsed = null;
                if (row.fechaAtencion) {
                    let fechaNormalizada = row.fechaAtencion.trim();

                    // Manejar separadores: /, -, .
                    const separadorMatch = fechaNormalizada.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
                    if (separadorMatch) {
                        const primero = parseInt(separadorMatch[1]);
                        const segundo = parseInt(separadorMatch[2]);
                        let anio = separadorMatch[3];
                        if (anio.length === 2) anio = (parseInt(anio) > 50 ? '19' : '20') + anio;

                        if (segundo > 12) {
                            fechaNormalizada = `${anio}-${separadorMatch[1].padStart(2, '0')}-${separadorMatch[2].padStart(2, '0')}`;
                        } else if (primero > 12) {
                            fechaNormalizada = `${anio}-${separadorMatch[2].padStart(2, '0')}-${separadorMatch[1].padStart(2, '0')}`;
                        } else {
                            fechaNormalizada = `${anio}-${separadorMatch[1].padStart(2, '0')}-${separadorMatch[2].padStart(2, '0')}`;
                        }
                        console.log(`   Fecha convertida: ${row.fechaAtencion} -> ${fechaNormalizada}`);
                    }

                    // Convertir hora AM/PM a 24h
                    const horaAtencion = convertirHora24(row.horaAtencion) || '08:00';

                    // Usar la función helper para construir la fecha con zona horaria Colombia
                    const fechaObj = construirFechaAtencionColombia(fechaNormalizada, horaAtencion);
                    if (fechaObj) {
                        fechaAtencionParsed = fechaObj;
                        console.log(`   Fecha final: ${fechaObj.toISOString()}`);
                    } else {
                        console.log(`   Error parseando fecha: ${row.fechaAtencion}`);
                    }
                }

                // Insertar en PostgreSQL
                const insertQuery = `
                    INSERT INTO "HistoriaClinica" (
                        "_id", "numeroId", "primerNombre", "segundoNombre",
                        "primerApellido", "segundoApellido",
                        "celular", "cargo", "ciudad", "fechaAtencion",
                        "empresa", "tipoExamen", "medico", "atendido",
                        "codEmpresa", "examenes", "_createdDate", "_updatedDate"
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW()
                    )
                    RETURNING "_id"
                `;

                const insertValues = [
                    ordenId,
                    row.numeroId,
                    row.primerNombre,
                    row.segundoNombre || null,
                    row.primerApellido,
                    row.segundoApellido || null,
                    row.celular || null,
                    row.cargo || null,
                    row.ciudad || null,
                    fechaAtencionParsed,
                    row.empresa || row.codEmpresa,
                    row.tipoExamen || null,
                    row.medico || null,
                    row.atendido || 'PENDIENTE',
                    row.codEmpresa,
                    row.examenes || null
                ];

                await pool.query(insertQuery, insertValues);

                // Crear/actualizar conversación de WhatsApp si hay celular
                if (row.celular) {
                    try {
                        const telefonoNormalizado = normalizarTelefonoConPrefijo57(row.celular);

                        if (telefonoNormalizado) {
                            // Buscar conversación - primero con +, luego sin + (conversaciones viejas)
                            let conversacionExistente = await pool.query(
                                'SELECT id, celular FROM conversaciones_whatsapp WHERE celular = $1 AND estado != $2',
                                [telefonoNormalizado, 'cerrada']
                            );

                            // Si no se encuentra con +, buscar sin + (conversaciones antiguas)
                            if (conversacionExistente.rows.length === 0 && telefonoNormalizado.startsWith('+')) {
                                const numeroSinMas = telefonoNormalizado.substring(1);
                                conversacionExistente = await pool.query(
                                    'SELECT id, celular FROM conversaciones_whatsapp WHERE celular = $1 AND estado != $2',
                                    [numeroSinMas, 'cerrada']
                                );
                            }

                            if (conversacionExistente.rows.length === 0) {
                                // No existe conversación activa, crear una nueva
                                await pool.query(`
                                    INSERT INTO conversaciones_whatsapp (
                                        celular, paciente_id, nombre_paciente, bot_activo, estado, canal
                                    ) VALUES ($1, $2, $3, $4, $5, $6)
                                `, [
                                    telefonoNormalizado,
                                    ordenId,
                                    `${row.primerNombre} ${row.primerApellido}`,
                                    false, // bot_activo = false (stopBot = true)
                                    'nueva',
                                    'bot'
                                ]);

                                console.log(`Conversacion WhatsApp creada para ${telefonoNormalizado} (bot detenido)`);
                            } else {
                                // Ya existe, actualizar usando el celular como está en la BD
                                const celularEnBD = conversacionExistente.rows[0].celular;
                                await pool.query(`
                                    UPDATE conversaciones_whatsapp
                                    SET bot_activo = false, fecha_ultima_actividad = NOW()
                                    WHERE celular = $1 AND estado != 'cerrada'
                                `, [celularEnBD]);

                                console.log(`Conversacion WhatsApp actualizada para ${celularEnBD} (bot detenido)`);
                            }
                        }
                    } catch (whatsappError) {
                        console.log(`Error al crear/actualizar conversacion WhatsApp: ${whatsappError.message}`);
                        // No detener el proceso si falla la creación de la conversación
                    }
                }

                // Sincronizar con Wix
                try {
                    // Convertir examenes a array de tags (separados por ; o ,)
                    let examenesArray = [];
                    if (row.examenes) {
                        examenesArray = row.examenes
                            .split(/[;,]/)
                            .map(e => e.trim())
                            .filter(e => e.length > 0);
                    }

                    const wixPayload = {
                        _id: ordenId,
                        numeroId: row.numeroId,
                        primerNombre: row.primerNombre,
                        segundoNombre: row.segundoNombre || '',
                        primerApellido: row.primerApellido,
                        segundoApellido: row.segundoApellido || '',
                        celular: row.celular || '',
                        codEmpresa: row.codEmpresa,
                        empresa: row.empresa || row.codEmpresa,
                        cargo: row.cargo || '',
                        ciudad: row.ciudad || '',
                        tipoExamen: row.tipoExamen || '',
                        medico: row.medico || '',
                        fechaAtencion: fechaAtencionParsed ? fechaAtencionParsed.toISOString() : null,
                        horaAtencion: row.horaAtencion || '',
                        atendido: row.atendido || 'PENDIENTE',
                        examenes: examenesArray
                    };

                    const wixResponse = await fetch('https://www.bsl.com.co/_functions/crearHistoriaClinica', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(wixPayload)
                    });

                    if (wixResponse.ok) {
                        console.log(`Fila ${i + 1}: ${row.primerNombre} ${row.primerApellido} (${row.numeroId}) - Sincronizado con Wix`);
                    } else {
                        console.log(`Fila ${i + 1}: ${row.primerNombre} ${row.primerApellido} - PostgreSQL OK, Wix fallo`);
                    }
                } catch (wixError) {
                    console.log(`Fila ${i + 1}: ${row.primerNombre} ${row.primerApellido} - PostgreSQL OK, Wix error: ${wixError.message}`);
                }

                resultados.exitosos++;
                resultados.ordenesCreadas.push({
                    _id: ordenId,
                    numeroId: row.numeroId,
                    nombre: `${row.primerNombre} ${row.primerApellido}`
                });

            } catch (error) {
                console.error(`Error en fila ${i + 1}:`, error.message);
                resultados.errores.push({
                    fila: i + 1,
                    error: error.message
                });
            }
        }

        console.log('');
        console.log('===================================================================');
        console.log(`RESUMEN: ${resultados.exitosos}/${resultados.total} ordenes importadas`);
        if (resultados.errores.length > 0) {
            console.log(`Errores: ${resultados.errores.length}`);
        }
        console.log('===================================================================');

        res.json({
            success: true,
            message: `Se importaron ${resultados.exitosos} de ${resultados.total} órdenes`,
            resultados
        });

    } catch (error) {
        console.error('Error al importar CSV:', error);
        res.status(500).json({
            success: false,
            message: 'Error al procesar el archivo CSV',
            error: error.message
        });
    }
});

// GET /api/ordenes - Listar órdenes con filtros opcionales
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { codEmpresa, buscar, limit = 100, offset = 0 } = req.query;

        // Query con subquery para obtener foto_url del formulario más reciente (evita duplicados)
        let query = `
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre", h."primerApellido", h."segundoApellido",
                   h."codEmpresa", h."empresa", h."cargo", h."tipoExamen", h."medico", h."atendido",
                   h."fechaAtencion", h."horaAtencion", h."examenes", h."ciudad", h."celular",
                   h."_createdDate", h."_updatedDate", h."fechaConsulta",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado", h."mdObsParaMiDocYa",
                   h."centro_de_costo", h."aprobacion",
                   (
                       SELECT foto_url FROM formularios
                       WHERE (wix_id = h."_id" OR numero_id = h."numeroId") AND foto_url IS NOT NULL
                       ORDER BY fecha_registro DESC LIMIT 1
                   ) as foto_url
            FROM "HistoriaClinica" h
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        // Filtrar empresas excluidas para empleados
        if (req.usuario.rol === 'empleado' && req.usuario.empresas_excluidas && req.usuario.empresas_excluidas.length > 0) {
            query += ` AND h."codEmpresa" NOT IN (${req.usuario.empresas_excluidas.map((_, i) => `$${paramIndex + i}`).join(', ')})`;
            params.push(...req.usuario.empresas_excluidas);
            paramIndex += req.usuario.empresas_excluidas.length;
        }

        if (codEmpresa) {
            query += ` AND h."codEmpresa" = $${paramIndex}`;
            params.push(codEmpresa);
            paramIndex++;
        }

        if (buscar) {
            // Usar índice GIN pg_trgm para búsqueda optimizada (incluye todos los campos buscables)
            query += ` AND (
                COALESCE(h."numeroId", '') || ' ' ||
                COALESCE(h."primerNombre", '') || ' ' ||
                COALESCE(h."primerApellido", '') || ' ' ||
                COALESCE(h."codEmpresa", '') || ' ' ||
                COALESCE(h."celular", '') || ' ' ||
                COALESCE(h."empresa", '')
            ) ILIKE $${paramIndex}`;
            params.push(`%${buscar}%`);
            paramIndex++;
        }

        query += ` ORDER BY h."fechaAtencion" DESC NULLS LAST, h."_createdDate" DESC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        // Obtener el total para paginación
        let countQuery = `SELECT COUNT(*) FROM "HistoriaClinica" WHERE 1=1`;
        const countParams = [];
        let countParamIndex = 1;

        // Aplicar el mismo filtro de empresas excluidas al count
        if (req.usuario.rol === 'empleado' && req.usuario.empresas_excluidas && req.usuario.empresas_excluidas.length > 0) {
            countQuery += ` AND "codEmpresa" NOT IN (${req.usuario.empresas_excluidas.map((_, i) => `$${countParamIndex + i}`).join(', ')})`;
            countParams.push(...req.usuario.empresas_excluidas);
            countParamIndex += req.usuario.empresas_excluidas.length;
        }

        if (codEmpresa) {
            countQuery += ` AND "codEmpresa" = $${countParamIndex}`;
            countParams.push(codEmpresa);
            countParamIndex++;
        }

        if (buscar) {
            // Usar índice GIN pg_trgm para búsqueda optimizada
            countQuery += ` AND (
                COALESCE("numeroId", '') || ' ' ||
                COALESCE("primerNombre", '') || ' ' ||
                COALESCE("primerApellido", '') || ' ' ||
                COALESCE("codEmpresa", '') || ' ' ||
                COALESCE("celular", '') || ' ' ||
                COALESCE("empresa", '')
            ) ILIKE $${countParamIndex}`;
            countParams.push(`%${buscar}%`);
        }

        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);

        // Si se filtra por empresa, calcular estadísticas - use repository
        let stats = null;
        if (codEmpresa) {
            stats = await HistoriaClinicaRepository.getStatsHoy(codEmpresa);
        }

        res.json({
            success: true,
            data: result.rows,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            stats
        });
    } catch (error) {
        console.error('Error al listar ordenes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar órdenes',
            error: error.message
        });
    }
});

// NOTE: /pruebas-psicologicas/:numeroId and /ordenes-aprobador moved to ordenes-legacy.js

// GET /api/ordenes/:id - Obtener una orden específica
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Use repository
        const orden = await HistoriaClinicaRepository.findById(id);

        if (!orden) {
            return res.status(404).json({
                success: false,
                message: 'Orden no encontrada'
            });
        }

        res.json({
            success: true,
            data: orden
        });
    } catch (error) {
        console.error('Error al obtener orden:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener la orden',
            error: error.message
        });
    }
});

// PUT /api/ordenes/:id - Actualizar una orden
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            primerNombre,
            primerApellido,
            empresa,
            tipoExamen,
            medico,
            atendido,
            fechaAtencion,
            horaAtencion
        } = req.body;

        console.log('');
        console.log('===================================================================');
        console.log('ACTUALIZANDO ORDEN:', id);
        console.log('===================================================================');
        console.log('Datos recibidos:', JSON.stringify(req.body, null, 2));

        const updateQuery = `
            UPDATE "HistoriaClinica"
            SET
                "primerNombre" = COALESCE($2, "primerNombre"),
                "primerApellido" = COALESCE($3, "primerApellido"),
                "empresa" = COALESCE($4, "empresa"),
                "tipoExamen" = COALESCE($5, "tipoExamen"),
                "medico" = COALESCE($6, "medico"),
                "atendido" = COALESCE($7, "atendido"),
                "fechaAtencion" = $8,
                "horaAtencion" = $9,
                "_updatedDate" = NOW()
            WHERE "_id" = $1
            RETURNING *
        `;

        const values = [
            id,
            primerNombre || null,
            primerApellido || null,
            empresa || null,
            tipoExamen || null,
            medico || null,
            atendido || null,
            fechaAtencion ? new Date(fechaAtencion) : null,
            horaAtencion || null
        ];

        const result = await pool.query(updateQuery, values);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Orden no encontrada'
            });
        }

        console.log('Orden actualizada exitosamente');

        res.json({
            success: true,
            message: 'Orden actualizada exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error al actualizar orden:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar la orden',
            error: error.message
        });
    }
});

// NOTE: /estadisticas-ia and /marcar-atendido moved to ordenes-legacy.js (mounted at /api)

module.exports = router;
