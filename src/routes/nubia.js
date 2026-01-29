const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { sendWhatsAppMessage, sendWhatsAppFreeText } = require('../services/whatsapp');
const { HistoriaClinicaRepository } = require('../repositories');
const { normalizarTelefonoConPrefijo57 } = require('../helpers/phone');

// ==========================================
// BARRIDO NUBIA - Enviar link médico virtual (a la hora exacta de la cita)
// ==========================================
async function barridoNubiaEnviarLink() {
    console.log("🔗 [barridoNubiaEnviarLink] Iniciando ejecución...");
    try {
        const ahora = new Date();
        // Buscar citas que están en una ventana de ±5 minutos alrededor de la hora actual
        // Esto permite capturar citas cuya hora exacta coincide con "ahora"
        const cincoMinAtras = new Date(ahora.getTime() - 5 * 60 * 1000);
        const cincoMinFuturo = new Date(ahora.getTime() + 5 * 60 * 1000);

        console.log(`📅 [barridoNubiaEnviarLink] Buscando citas de NUBIA entre ${cincoMinAtras.toISOString()} y ${cincoMinFuturo.toISOString()}`);

        // Busca registros con cita en ventana actual que no tengan el recordatorio enviado
        const result = await pool.query(`
            SELECT * FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1
              AND "fechaAtencion" <= $2
              AND "medico" ILIKE '%NUBIA%'
              AND ("recordatorioLinkEnviado" IS NULL OR "recordatorioLinkEnviado" = false)
            LIMIT 20
        `, [cincoMinAtras.toISOString(), cincoMinFuturo.toISOString()]);

        console.log(`📊 [barridoNubiaEnviarLink] Registros encontrados: ${result.rows.length}`);

        if (result.rows.length === 0) {
            console.log("⚠️ [barridoNubiaEnviarLink] No hay citas próximas de NUBIA");
            return { mensaje: 'No hay citas próximas de NUBIA.', enviados: 0 };
        }

        let enviados = 0;

        for (const registro of result.rows) {
            const { primerNombre, celular, _id: historiaId } = registro;

            if (!celular) {
                console.log(`⚠️ [barridoNubiaEnviarLink] ${primerNombre} no tiene celular`);
                continue;
            }

            const telefonoLimpio = celular.replace(/\s+/g, '').replace(/[^\d]/g, '');
            const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

            // URL del formulario médico virtual
            const url = `https://sea-lion-app-qcttp.ondigitalocean.app/?_id=${historiaId}`;
            const messageBody = `Hola ${primerNombre}, es la hora de tu cita.\n\nComunícate ya haciendo clic en este link:\n\n${url}`;

            try {
                // Usar template específico de recordatorio de cita
                // Variables: {{1}} = nombre, {{2}} = _id (para URL del botón)
                await sendWhatsAppMessage(
                    toNumber,
                    messageBody,
                    {
                        '1': primerNombre,
                        '2': historiaId
                    },
                    process.env.TWILIO_TEMPLATE_RECORDATORIO_CITA
                );

                // Marcar que ya se envió el recordatorio
                await pool.query(`
                    UPDATE "HistoriaClinica"
                    SET "recordatorioLinkEnviado" = true
                    WHERE "_id" = $1
                `, [historiaId]);

                console.log(`✅ [barridoNubiaEnviarLink] Link enviado a ${primerNombre} (${toNumber})`);
                enviados++;
            } catch (sendError) {
                console.error(`Error enviando link a ${toNumber}:`, sendError);
            }

            // Pequeño delay entre mensajes
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`✅ [barridoNubiaEnviarLink] Enviados ${enviados} links`);
        return { mensaje: `Enviados ${enviados} links de NUBIA.`, enviados };
    } catch (error) {
        console.error("❌ Error en barridoNubiaEnviarLink:", error.message);
        throw error;
    }
}

// ==========================================
// BARRIDO NUBIA - Marcar como ATENDIDO citas pasadas
// Para consultas presenciales con médico NUBIA
// ==========================================
async function barridoNubiaMarcarAtendido() {
    console.log("🚀 [barridoNubiaMarcarAtendido] Iniciando ejecución...");
    try {
        const ahora = new Date();
        // Buscar citas desde 2 horas atrás hasta 5 minutos atrás (ya pasaron)
        const dosHorasAtras = new Date(ahora.getTime() - 120 * 60 * 1000);
        const cincoMinAtras = new Date(ahora.getTime() - 5 * 60 * 1000);

        console.log(`📅 [barridoNubiaMarcarAtendido] Buscando citas de NUBIA entre ${dosHorasAtras.toISOString()} y ${cincoMinAtras.toISOString()}`);

        // Busca registros en HistoriaClinica con médico NUBIA que no estén atendidos
        // y cuya fecha de atención ya pasó (entre 2 horas atrás y 5 min atrás)
        const result = await pool.query(`
            SELECT * FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1
              AND "fechaAtencion" <= $2
              AND "medico" ILIKE '%NUBIA%'
              AND ("atendido" IS NULL OR "atendido" != 'ATENDIDO')
            LIMIT 20
        `, [dosHorasAtras.toISOString(), cincoMinAtras.toISOString()]);

        console.log(`📊 [barridoNubiaMarcarAtendido] Registros encontrados: ${result.rows.length}`);

        if (result.rows.length === 0) {
            console.log("⚠️ [barridoNubiaMarcarAtendido] No hay registros de NUBIA pendientes por marcar");
            return { mensaje: 'No hay registros de NUBIA pendientes.', procesados: 0 };
        }

        let procesados = 0;

        for (const registro of result.rows) {
            await procesarRegistroNubia(registro);
            procesados++;
            // Pequeño delay entre registros
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`✅ [barridoNubiaMarcarAtendido] Procesados ${procesados} registros`);
        return { mensaje: `Procesados ${procesados} registros de NUBIA.`, procesados };
    } catch (error) {
        console.error("❌ Error en barridoNubiaMarcarAtendido:", error.message);
        throw error;
    }
}

// ==========================================
// BARRIDO NUBIA - Recordatorio de pago (1 hora después de consulta)
// Para pacientes SANITHELP-JJ que no han pagado
// ==========================================
async function barridoNubiaRecordatorioPago() {
    console.log("💰 [barridoNubiaRecordatorioPago] Iniciando ejecución...");
    try {
        const ahora = new Date();
        // Buscar citas que fueron hace 1 hora (entre 55 y 65 minutos atrás)
        const cincuentaCincoMinAtras = new Date(ahora.getTime() - 55 * 60 * 1000);
        const sesentaCincoMinAtras = new Date(ahora.getTime() - 65 * 60 * 1000);

        console.log(`📅 [barridoNubiaRecordatorioPago] Buscando citas SANITHELP-JJ entre ${sesentaCincoMinAtras.toISOString()} y ${cincuentaCincoMinAtras.toISOString()}`);

        // Busca registros de SANITHELP-JJ que no han pagado y cuya cita fue hace ~1 hora
        const result = await pool.query(`
            SELECT * FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1
              AND "fechaAtencion" <= $2
              AND "codEmpresa" = 'SANITHELP-JJ'
              AND ("pagado" IS NULL OR "pagado" = false)
              AND ("recordatorioPagoEnviado" IS NULL OR "recordatorioPagoEnviado" = false)
            LIMIT 20
        `, [sesentaCincoMinAtras.toISOString(), cincuentaCincoMinAtras.toISOString()]);

        console.log(`📊 [barridoNubiaRecordatorioPago] Registros encontrados: ${result.rows.length}`);

        if (result.rows.length === 0) {
            console.log("⚠️ [barridoNubiaRecordatorioPago] No hay pacientes pendientes de pago");
            return { mensaje: 'No hay pacientes pendientes de pago.', enviados: 0 };
        }

        let enviados = 0;

        for (const registro of result.rows) {
            const { primerNombre, celular, _id: historiaId } = registro;

            if (!celular) {
                console.log(`⚠️ [barridoNubiaRecordatorioPago] ${primerNombre} no tiene celular`);
                continue;
            }

            const telefonoLimpio = celular.replace(/\s+/g, '').replace(/[^\d]/g, '');
            const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

            const messageBody = `Hola! Revisaste tu certificado médico?`;

            try {
                await sendWhatsAppMessage(toNumber, messageBody);

                // Marcar que ya se envió el recordatorio de pago
                await pool.query(`
                    UPDATE "HistoriaClinica"
                    SET "recordatorioPagoEnviado" = true
                    WHERE "_id" = $1
                `, [historiaId]);

                console.log(`✅ [barridoNubiaRecordatorioPago] Recordatorio enviado a ${primerNombre} (${toNumber})`);
                enviados++;
            } catch (sendError) {
                console.error(`Error enviando recordatorio de pago a ${toNumber}:`, sendError);
            }

            // Pequeño delay entre mensajes
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`✅ [barridoNubiaRecordatorioPago] Enviados ${enviados} recordatorios de pago`);
        return { mensaje: `Enviados ${enviados} recordatorios de pago.`, enviados };
    } catch (error) {
        console.error("❌ Error en barridoNubiaRecordatorioPago:", error.message);
        throw error;
    }
}

async function procesarRegistroNubia(registro) {
    const {
        primerNombre,
        primerApellido,
        celular,
        _id: historiaId,
        fechaAtencion,
        medico
    } = registro;

    const ahora = new Date();
    const fechaAtencionDate = new Date(fechaAtencion);
    const minutosDesdesCita = (ahora.getTime() - fechaAtencionDate.getTime()) / 60000;

    console.log(`👤 [procesarRegistroNubia] ${primerNombre} ${primerApellido || ''} - Médico: ${medico} - Minutos desde cita: ${minutosDesdesCita.toFixed(1)}`);

    // Si ya pasó la cita (más de 5 minutos), marcar como ATENDIDO
    if (minutosDesdesCita >= 5) {
        try {
            // Actualizar el registro en HistoriaClinica
            await pool.query(`
                UPDATE "HistoriaClinica"
                SET "atendido" = 'ATENDIDO',
                    "fechaConsulta" = COALESCE("fechaConsulta", NOW())
                WHERE "_id" = $1
            `, [historiaId]);

            console.log(`✅ [procesarRegistroNubia] Marcado como ATENDIDO: ${primerNombre} ${primerApellido || ''} (ID: ${historiaId})`);
        } catch (updateError) {
            console.error(`Error actualizando registro de NUBIA ${historiaId}:`, updateError);
        }
    } else {
        console.log(`⏳ [procesarRegistroNubia] ${primerNombre} - Aún no han pasado 5 minutos desde la cita`);
    }
}

// ==========================================
// ENDPOINTS
// ==========================================

// Endpoint para ejecutar el barrido de NUBIA manualmente o via cron
router.post('/barrido-nubia', async (req, res) => {
    try {
        const resultado = await barridoNubiaMarcarAtendido();
        res.json({ success: true, ...resultado });
    } catch (error) {
        console.error('Error en barrido NUBIA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/barrido-nubia', async (req, res) => {
    try {
        const resultado = await barridoNubiaMarcarAtendido();
        res.json({ success: true, ...resultado });
    } catch (error) {
        console.error('Error en barrido NUBIA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// API para Panel NUBIA - Listar pacientes del día
// ==========================================
router.get('/nubia/pacientes', async (req, res) => {
    try {
        const { desde, hasta } = req.query;

        // Si se proporcionan fechas, usarlas; sino usar hoy
        // Colombia es UTC-5, agregamos el offset para que las fechas sean correctas
        let inicioDelDia, finDelDia;

        if (desde) {
            // Fecha en Colombia (UTC-5): 00:00:00 Colombia = 05:00:00 UTC
            inicioDelDia = new Date(desde + 'T05:00:00.000Z');
        } else {
            // Obtener fecha actual en Colombia
            const ahora = new Date();
            const colombiaOffset = -5 * 60; // UTC-5 en minutos
            const utcTime = ahora.getTime() + (ahora.getTimezoneOffset() * 60000);
            const colombiaTime = new Date(utcTime + (colombiaOffset * 60000));
            const hoyStr = colombiaTime.toISOString().split('T')[0];
            inicioDelDia = new Date(hoyStr + 'T05:00:00.000Z');
        }

        if (hasta) {
            // Fecha en Colombia (UTC-5): 23:59:59 Colombia = 04:59:59 UTC del día siguiente
            finDelDia = new Date(hasta + 'T05:00:00.000Z');
            finDelDia.setDate(finDelDia.getDate() + 1);
            finDelDia.setMilliseconds(finDelDia.getMilliseconds() - 1);
        } else {
            // Obtener fecha actual en Colombia
            const ahora = new Date();
            const colombiaOffset = -5 * 60;
            const utcTime = ahora.getTime() + (ahora.getTimezoneOffset() * 60000);
            const colombiaTime = new Date(utcTime + (colombiaOffset * 60000));
            const hoyStr = colombiaTime.toISOString().split('T')[0];
            finDelDia = new Date(hoyStr + 'T05:00:00.000Z');
            finDelDia.setDate(finDelDia.getDate() + 1);
            finDelDia.setMilliseconds(finDelDia.getMilliseconds() - 1);
        }

        console.log(`📋 [API NUBIA] Buscando pacientes del ${inicioDelDia.toISOString()} a ${finDelDia.toISOString()}`);

        const result = await pool.query(`
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre", h."primerApellido", h."segundoApellido",
                   h."celular", h."cargo", h."ciudad", h."tipoExamen", h."codEmpresa", h."empresa", h."medico",
                   h."atendido", h."examenes", h."_createdDate", h."fechaConsulta", h."fechaAtencion", h."horaAtencion",
                   h."pvEstado", h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado",
                   h."pagado",
                   (SELECT COALESCE(f.foto_url, f.foto) FROM formularios f WHERE f.numero_id = h."numeroId" ORDER BY f.fecha_registro DESC LIMIT 1) as foto,
                   (SELECT f.email FROM formularios f WHERE f.numero_id = h."numeroId" ORDER BY f.fecha_registro DESC LIMIT 1) as email
            FROM "HistoriaClinica" h
            WHERE h."medico" ILIKE '%NUBIA%'
              AND h."codEmpresa" = 'SANITHELP-JJ'
              AND h."fechaAtencion" >= $1
              AND h."fechaAtencion" <= $2
            ORDER BY h."fechaAtencion" ASC
        `, [inicioDelDia.toISOString(), finDelDia.toISOString()]);

        // Contar atendidos y pagados
        // Un paciente está atendido si: tiene atendido='ATENDIDO' O está pagado (no se puede pagar sin atender)
        const atendidos = result.rows.filter(r => r.atendido === 'ATENDIDO' || r.pagado === true).length;
        const pagados = result.rows.filter(r => r.pagado === true).length;

        res.json({
            success: true,
            data: result.rows,
            total: result.rows.length,
            atendidos,
            pagados
        });
    } catch (error) {
        console.error('❌ Error listando pacientes NUBIA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API para cambiar estado a ATENDIDO (Panel NUBIA)
router.post('/nubia/atender/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Valores por defecto
        const RECOMENDACIONES_DEFAULT = `1. PAUSAS ACTIVAS
2. HIGIENE POSTURAL
3. MEDIDAS ERGONOMICAS
4. TÉCNICAS DE MANEJO DE ESTRÉS
5. EJERCICIO AEROBICO
6. MANTENER MEDIDAS DE BIOSEGURIDAD PARA COVID.
7. ALIMENTACIÓN BALANCEADA`;

        const OBSERVACIONES_DEFAULT = `Basándonos en los resultados obtenidos de la evaluación osteomuscular, certificamos que el paciente presenta un sistema osteomuscular en condiciones óptimas de salud. Esta condición le permite llevar a cabo una variedad de actividades físicas y cotidianas sin restricciones notables y con un riesgo mínimo de lesiones osteomusculares.`;

        // Actualizar el registro
        const result = await pool.query(`
            UPDATE "HistoriaClinica"
            SET "atendido" = 'ATENDIDO',
                "fechaConsulta" = NOW(),
                "mdConceptoFinal" = 'ELEGIBLE PARA EL CARGO SIN RECOMENDACIONES LABORALES',
                "mdRecomendacionesMedicasAdicionales" = $2,
                "mdObservacionesCertificado" = $3
            WHERE "_id" = $1
            RETURNING *
        `, [id, RECOMENDACIONES_DEFAULT, OBSERVACIONES_DEFAULT]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        const paciente = result.rows[0];

        // Enviar mensaje de WhatsApp si tiene celular
        if (paciente.celular) {
            const telefonoLimpio = paciente.celular.replace(/\s+/g, '').replace(/[^\d]/g, '');
            const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

            const mensaje = `Hola ${paciente.primerNombre}. Te escribimos de BSL. Tu certificado médico ya está listo.`;

            try {
                // Usar template aprobado para enviar mensaje de certificado listo
                const twilioResult = await sendWhatsAppMessage(
                    toNumber,
                    mensaje,
                    { '1': paciente.primerNombre, '2': id },
                    'HX87de46b685187c21e29fe09e2eaa1845'
                );
                if (twilioResult.success) {
                    console.log(`📱 [NUBIA] Mensaje de certificado enviado a ${paciente.primerNombre} (${toNumber})`);

                    // Guardar mensaje en base de datos para que aparezca en el chat
                    // NORMALIZACIÓN: Usar helper para formato consistente (57XXXXXXXXXX sin +)
                    const numeroCliente = normalizarTelefonoConPrefijo57(toNumber);

                    // Buscar o crear conversación
                    let conversacion = await pool.query(`
                        SELECT id FROM conversaciones_whatsapp WHERE celular = $1
                    `, [numeroCliente]);

                    let conversacionId;

                    if (conversacion.rows.length === 0) {
                        // Crear nueva conversación
                        const nombreCompleto = `${paciente.primerNombre} ${paciente.primerApellido || ''}`.trim();
                        const nuevaConv = await pool.query(`
                            INSERT INTO conversaciones_whatsapp (
                                celular,
                                nombre_paciente,
                                estado_actual,
                                fecha_inicio,
                                fecha_ultima_actividad,
                                bot_activo
                            )
                            VALUES ($1, $2, 'activa', NOW(), NOW(), false)
                            RETURNING id
                        `, [numeroCliente, nombreCompleto]);

                        conversacionId = nuevaConv.rows[0].id;
                        console.log(`📝 Conversación creada: ${conversacionId} para ${numeroCliente}`);
                    } else {
                        conversacionId = conversacion.rows[0].id;

                        // Actualizar última actividad
                        await pool.query(`
                            UPDATE conversaciones_whatsapp
                            SET fecha_ultima_actividad = NOW()
                            WHERE id = $1
                        `, [conversacionId]);
                    }

                    // Guardar mensaje saliente
                    await pool.query(`
                        INSERT INTO mensajes_whatsapp (
                            conversacion_id,
                            contenido,
                            direccion,
                            sid_twilio,
                            tipo_mensaje,
                            timestamp
                        )
                        VALUES ($1, $2, 'saliente', $3, 'text', NOW())
                    `, [conversacionId, mensaje, twilioResult.sid]);

                    console.log(`✅ Mensaje guardado en conversación ${conversacionId}`);

                    // Emitir evento WebSocket para actualización en tiempo real
                    if (global.emitWhatsAppEvent) {
                        global.emitWhatsAppEvent('nuevo_mensaje', {
                            conversacion_id: conversacionId,
                            numero_cliente: numeroCliente,
                            contenido: mensaje,
                            direccion: 'saliente',
                            fecha_envio: new Date().toISOString(),
                            sid_twilio: twilioResult.sid,
                            tipo_mensaje: 'text'
                        });
                    }
                } else {
                    console.error(`❌ [NUBIA] Error enviando mensaje a ${paciente.primerNombre}:`, twilioResult.error);
                }
            } catch (sendError) {
                console.error(`Error enviando mensaje:`, sendError);
            }
        }

        res.json({ success: true, data: paciente, message: 'Estado actualizado correctamente' });
    } catch (error) {
        console.error('❌ Error marcando como atendido:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API para marcar como PAGADO (Panel NUBIA)
router.post('/nubia/cobrar/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener datos del paciente - use repository
        const paciente = await HistoriaClinicaRepository.findById(id);

        if (!paciente) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        // Enviar mensaje de confirmación de continuidad del proceso
        if (paciente.celular) {
            const telefonoLimpio = paciente.celular.replace(/\s+/g, '').replace(/[^\d]/g, '');
            const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

            const nombreCompleto = `${paciente.primerNombre || ''} ${paciente.segundoNombre || ''}`.trim();
            const mensaje = `Hola ${nombreCompleto}. Necesitamos saber si continúas con el proceso o eliminamos el certificado. Gracias!`;

            try {
                // Usar template específico de confirmación de proceso
                await sendWhatsAppMessage(
                    toNumber,
                    mensaje,
                    { nombre: nombreCompleto },
                    process.env.TWILIO_TEMPLATE_CONFIRMACION_PROCESO
                );
                console.log(`📱 [NUBIA] Mensaje de confirmación enviado a ${nombreCompleto} (${toNumber})`);
            } catch (sendError) {
                console.error(`Error enviando mensaje:`, sendError);
            }
        }

        res.json({ success: true, data: paciente, message: 'Mensaje de confirmación enviado' });
    } catch (error) {
        console.error('❌ Error enviando mensaje de confirmación:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API para envío masivo de mensajes (Panel NUBIA)
router.post('/nubia/enviar-masivo', async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'IDs no válidos' });
        }

        console.log(`📱 [NUBIA] Iniciando envío masivo a ${ids.length} pacientes`);

        let enviados = 0;
        let errores = 0;

        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];

            try {
                // Obtener datos del paciente - use repository
                const paciente = await HistoriaClinicaRepository.findById(id);

                if (!paciente) {
                    console.error(`❌ [NUBIA] Paciente ${id} no encontrado`);
                    errores++;
                    continue;
                }

                // Enviar mensaje
                if (paciente.celular) {
                    const telefonoLimpio = paciente.celular.replace(/\s+/g, '').replace(/[^\d]/g, '');
                    const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

                    const nombreCompleto = `${paciente.primerNombre || ''} ${paciente.segundoNombre || ''}`.trim();
                    const mensaje = `Hola ${nombreCompleto}. Necesitamos saber si continúas con el proceso o eliminamos el certificado. Gracias!`;

                    try {
                        // Usar template específico de confirmación de proceso
                        await sendWhatsAppMessage(
                            toNumber,
                            mensaje,
                            { nombre: nombreCompleto },
                            process.env.TWILIO_TEMPLATE_CONFIRMACION_PROCESO
                        );
                        console.log(`✅ [NUBIA] ${i + 1}/${ids.length} - Mensaje enviado a ${nombreCompleto} (${toNumber})`);
                        enviados++;

                        // Timeout de 3 segundos entre cada envío (excepto el último)
                        if (i < ids.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        }
                    } catch (sendError) {
                        console.error(`❌ [NUBIA] Error enviando a ${nombreCompleto}:`, sendError);
                        errores++;
                    }
                } else {
                    console.error(`❌ [NUBIA] Paciente ${paciente.primerNombre} sin número de celular`);
                    errores++;
                }
            } catch (error) {
                console.error(`❌ [NUBIA] Error procesando paciente ${id}:`, error);
                errores++;
            }
        }

        console.log(`📊 [NUBIA] Envío masivo completado - Enviados: ${enviados}, Errores: ${errores}`);

        res.json({
            success: true,
            message: 'Envío masivo completado',
            enviados,
            errores,
            total: ids.length
        });
    } catch (error) {
        console.error('❌ Error en envío masivo:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API para eliminar registro (Panel NUBIA)
router.delete('/nubia/eliminar/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar que el registro existe - use repository
        const paciente = await HistoriaClinicaRepository.findById(id);

        if (!paciente) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        // Eliminar el registro - use repository
        await HistoriaClinicaRepository.delete(id);

        console.log(`🗑️ [NUBIA] Registro eliminado: ${paciente.primerNombre} ${paciente.primerApellido} (${paciente.numeroId})`);

        res.json({
            success: true,
            message: `Registro de ${paciente.primerNombre} ${paciente.primerApellido} eliminado correctamente`
        });
    } catch (error) {
        console.error('❌ Error eliminando registro:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API para enviar mensaje de bienvenida (Panel NUBIA)
router.post('/nubia/enviar-mensaje/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener datos del paciente - use repository
        const paciente = await HistoriaClinicaRepository.findById(id);

        if (!paciente) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        if (!paciente.celular) {
            return res.status(400).json({ success: false, message: 'El paciente no tiene celular registrado' });
        }

        const telefonoLimpio = paciente.celular.replace(/\s+/g, '').replace(/[^\d]/g, '');
        const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

        const mensaje = `Hola ${paciente.primerNombre}! Te escribimos de BSL.
Estás realizando con nosotros el examen médico virtual.

Debes realizar las siguientes pruebas:

https://www.bsl.com.co/historia-clinica2/${id}

Puedes hacerlo desde celular o computador.

¡Gracias!`;

        await sendWhatsAppMessage(toNumber, mensaje);

        res.json({ success: true, message: 'Mensaje enviado correctamente' });
    } catch (error) {
        console.error('❌ Error enviando mensaje:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API para buscar paciente por cédula (Panel NUBIA)
router.get('/nubia/buscar', async (req, res) => {
    try {
        const { q } = req.query;

        if (!q) {
            return res.status(400).json({ success: false, message: 'Parámetro de búsqueda requerido' });
        }

        const result = await pool.query(`
            SELECT "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                   "celular", "cargo", "ciudad", "tipoExamen", "codEmpresa", "empresa", "medico",
                   "atendido", "examenes", "_createdDate", "fechaConsulta", "fechaAtencion", "horaAtencion",
                   "pvEstado"
            FROM "HistoriaClinica"
            WHERE ("numeroId" ILIKE $1 OR "_id" ILIKE $1)
            ORDER BY "_createdDate" DESC
            LIMIT 20
        `, [`%${q}%`]);

        res.json({
            success: true,
            data: result.rows,
            total: result.rows.length
        });
    } catch (error) {
        console.error('❌ Error buscando paciente:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export router and barrido functions (for cron jobs)
module.exports = router;
module.exports.barridoNubiaEnviarLink = barridoNubiaEnviarLink;
module.exports.barridoNubiaMarcarAtendido = barridoNubiaMarcarAtendido;
module.exports.barridoNubiaRecordatorioPago = barridoNubiaRecordatorioPago;
