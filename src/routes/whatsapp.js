const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { normalizarTelefonoConPrefijo57 } = require('../helpers/phone');

// Bot service: shared state maps and AI functions
const {
    estadoPagos,
    ESTADO_ESPERANDO_DOCUMENTO,
    estadoConversacion,
    MODO_BOT,
    MODO_PAGO,
    MODO_HUMANO,
    recuperarMensajesBot,
    getAIResponseBot,
    guardarParConEmbeddingRAG
} = require('../services/bot');

// Payment service: payment flow processing
const { procesarFlujoPagos } = require('../services/payment');

// WhatsApp service: Twilio message sending
const { sendWhatsAppFreeText } = require('../services/whatsapp');

// ============================================================
// POST /webhook - Twilio WhatsApp incoming message webhook
// ============================================================
router.post('/webhook', async (req, res) => {
    try {
        const { From, Body, MessageSid, ProfileName, NumMedia } = req.body;

        // Normalizar número de teléfono usando helper (formato: 57XXXXXXXXXX sin +)
        const numeroCliente = normalizarTelefonoConPrefijo57(From);

        // Capturar archivos multimedia si existen
        const numMedia = parseInt(NumMedia) || 0;
        const mediaUrls = [];
        const mediaTypes = [];

        for (let i = 0; i < numMedia; i++) {
            const mediaUrl = req.body[`MediaUrl${i}`];
            const mediaType = req.body[`MediaContentType${i}`];
            if (mediaUrl) {
                mediaUrls.push(mediaUrl);
                mediaTypes.push(mediaType || 'unknown');
            }
        }

        console.log('📩 Mensaje WhatsApp entrante:', {
            from: numeroCliente,
            body: Body,
            sid: MessageSid,
            name: ProfileName,
            numMedia,
            mediaUrls,
            mediaTypes
        });

        // Buscar conversacion - primero con formato normalizado (+), luego sin + (conversaciones viejas)
        let conversacion = await pool.query(`
            SELECT id FROM conversaciones_whatsapp WHERE celular = $1
        `, [numeroCliente]);

        // Si no se encuentra con +, buscar sin + (conversaciones antiguas)
        if (conversacion.rows.length === 0 && numeroCliente.startsWith('+')) {
            const numeroSinMas = numeroCliente.substring(1);
            conversacion = await pool.query(`
                SELECT id FROM conversaciones_whatsapp WHERE celular = $1
            `, [numeroSinMas]);
        }

        let conversacionId;

        if (conversacion.rows.length === 0) {
            // Crear nueva conversacion
            const nuevaConv = await pool.query(`
                INSERT INTO conversaciones_whatsapp (
                    celular,
                    nombre_paciente,
                    estado_actual,
                    fecha_inicio,
                    fecha_ultima_actividad,
                    bot_activo
                )
                VALUES ($1, $2, 'activa', NOW(), NOW(), true)
                RETURNING id
            `, [numeroCliente, ProfileName || 'Usuario WhatsApp']);

            conversacionId = nuevaConv.rows[0].id;
        } else {
            conversacionId = conversacion.rows[0].id;

            // Actualizar ultima actividad
            await pool.query(`
                UPDATE conversaciones_whatsapp
                SET fecha_ultima_actividad = NOW()
                WHERE id = $1
            `, [conversacionId]);
        }

        // PROCESAR FLUJO DE VALIDACION DE PAGOS SI HAY IMAGENES
        if (numMedia > 0) {
            const mainMediaType = mediaTypes[0];

            // Solo procesar imagenes para el flujo de pagos
            if (mainMediaType && mainMediaType.startsWith('image/')) {
                console.log('📸 Imagen detectada - activando flujo de validación de pagos');

                // Procesar flujo de pagos (maneja clasificacion y respuestas)
                try {
                    await procesarFlujoPagos(req.body, From);
                } catch (error) {
                    console.error('❌ Error procesando flujo de pagos:', error);
                    // Continuar con el flujo normal si falla
                }
            }
        }

        // Determinar tipo de mensaje
        let tipoMensaje = 'text';
        if (numMedia > 0) {
            const mainMediaType = mediaTypes[0];
            if (mainMediaType.startsWith('image/')) {
                tipoMensaje = 'image';
            } else if (mainMediaType.startsWith('video/')) {
                tipoMensaje = 'video';
            } else if (mainMediaType.startsWith('audio/')) {
                tipoMensaje = 'audio';
            } else if (mainMediaType === 'application/pdf') {
                tipoMensaje = 'document';
            } else {
                tipoMensaje = 'media';
            }
        }

        // Guardar mensaje entrante
        await pool.query(`
            INSERT INTO mensajes_whatsapp (
                conversacion_id,
                contenido,
                direccion,
                sid_twilio,
                tipo_mensaje,
                media_url,
                media_type,
                timestamp
            )
            VALUES ($1, $2, 'entrante', $3, $4, $5, $6, NOW())
        `, [
            conversacionId,
            Body || '📎 Archivo adjunto',
            MessageSid,
            tipoMensaje,
            mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null,
            mediaTypes.length > 0 ? JSON.stringify(mediaTypes) : null
        ]);

        console.log('✅ Mensaje guardado en conversación:', conversacionId);

        // Emitir evento WebSocket para actualizacion en tiempo real
        if (global.emitWhatsAppEvent) {
            global.emitWhatsAppEvent('nuevo_mensaje', {
                conversacion_id: conversacionId,
                numero_cliente: numeroCliente,
                contenido: Body || '📎 Archivo adjunto',
                direccion: 'entrante',
                fecha_envio: new Date().toISOString(),
                sid_twilio: MessageSid,
                nombre_cliente: ProfileName || 'Usuario WhatsApp',
                tipo_mensaje: tipoMensaje,
                media_url: mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null,
                media_type: mediaTypes.length > 0 ? JSON.stringify(mediaTypes) : null
            });
        }

        // PROCESAR TEXTO SI ESTA EN FLUJO DE PAGOS (esperando documento)
        if (Body && numMedia === 0) {
            const estadoPagoData = estadoPagos.get(From);

            // Verificar si hay estado activo Y no ha expirado (2 minutos)
            if (estadoPagoData && estadoPagoData.estado === ESTADO_ESPERANDO_DOCUMENTO) {
                const TIMEOUT_PAGO = 2 * 60 * 1000; // 2 minutos (reducido de 5)
                const tiempoTranscurrido = Date.now() - estadoPagoData.timestamp;

                if (tiempoTranscurrido > TIMEOUT_PAGO) {
                    // Estado expirado - limpiar y dejar que el bot responda
                    estadoPagos.delete(From);
                    console.log(`⏰ Estado de pago expirado para ${From} (${Math.round(tiempoTranscurrido/1000)}s) - limpiando`);
                } else {
                    // Estado valido - procesar como pago
                    console.log('📝 Usuario envió texto en flujo de pagos - procesando documento');

                    try {
                        await procesarFlujoPagos(req.body, From);
                    } catch (error) {
                        console.error('❌ Error procesando documento en flujo de pagos:', error);
                    }
                    // Si esta en flujo de pagos, no activar el bot
                    res.type('text/xml');
                    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
                    return;
                }
            }
        }

        // SISTEMA DE BOT CON IA - Respuestas automaticas cuando stopBot = false
        if (Body && numMedia === 0) {
            try {
                // Verificar el modo de conversacion actual
                const modoActual = estadoConversacion.get(From) || MODO_BOT;

                console.log(`🤖 Bot check para ${numeroCliente}: modo=${modoActual}`);

                // Verificar si el bot debe responder
                const convData = await pool.query(`
                    SELECT "stopBot", bot_activo FROM conversaciones_whatsapp
                    WHERE id = $1
                `, [conversacionId]);

                const stopBot = convData.rows[0]?.stopBot || false;

                // REGLA 1: Si stopBot = true, MODO_HUMANO o MODO_PAGO, NO responder con bot
                if (stopBot || modoActual === MODO_HUMANO || modoActual === MODO_PAGO) {
                    console.log(`👤 Bot bloqueado para ${numeroCliente} - modo=${modoActual}, stopBot=${stopBot}`);
                    return res.status(200).send('OK');
                }

                // REGLA 2: Solo si esta en MODO_BOT, responder con IA
                if (modoActual === MODO_BOT && !stopBot) {
                    // Verificar si el paciente pertenece a una empresa diferente a SANITHELP-JJ
                    const celularLimpio = numeroCliente.replace(/\D/g, '').replace(/^57/, '');
                    const celularCon57 = '57' + celularLimpio;
                    const celularConPlus = '+57' + celularLimpio;

                    const empresaCheck = await pool.query(`
                        SELECT "codEmpresa" FROM "HistoriaClinica"
                        WHERE "celular" IN ($1, $2, $3)
                        ORDER BY "_createdDate" DESC
                        LIMIT 1
                    `, [celularLimpio, celularCon57, celularConPlus]);

                    if (empresaCheck.rows.length > 0) {
                        const codEmpresa = empresaCheck.rows[0].codEmpresa;
                        if (codEmpresa && codEmpresa !== 'SANITHELP-JJ') {
                            console.log(`🚫 Bot NO responde a ${numeroCliente} - Empresa: ${codEmpresa} (solo SANITHELP-JJ)`);
                            // Detener el bot para esta conversacion
                            await pool.query(`
                                UPDATE conversaciones_whatsapp
                                SET "stopBot" = true
                                WHERE id = $1
                            `, [conversacionId]);
                            return res.status(200).send('OK');
                        }
                    }

                    console.log(`🤖 Bot ACTIVO para ${numeroCliente} - Generando respuesta con IA`);

                    // Recuperar historial de mensajes
                    const historial = await recuperarMensajesBot(pool, conversacionId, 10);

                    // Agregar mensaje del usuario al historial
                    historial.push({ role: 'user', content: Body });

                    // Generar respuesta con OpenAI (solo prompt base + historial)
                    const respuestaBot = await getAIResponseBot(historial);

                    console.log(`🤖 Respuesta del bot: ${respuestaBot.substring(0, 100)}...`);

                    // Verificar comandos especiales en la respuesta
                    if (respuestaBot.includes('...transfiriendo con asesor')) {
                        // Cambiar a MODO_HUMANO y activar stopBot
                        estadoConversacion.set(From, MODO_HUMANO);

                        await pool.query(`
                            UPDATE conversaciones_whatsapp
                            SET "stopBot" = true, bot_activo = false
                            WHERE id = $1
                        `, [conversacionId]);
                        console.log(`🛑 Bot auto-detenido para ${numeroCliente} (transferencia a asesor) - MODO_HUMANO activado`);
                    }

                    // Enviar respuesta por Twilio
                    const respuestaFinal = respuestaBot.replace('...transfiriendo con asesor', '').trim() || 'Un momento por favor, te atenderá un asesor.';
                    await sendWhatsAppFreeText(numeroCliente, respuestaFinal);
                    // NOTA: sendWhatsAppFreeText ya guarda el mensaje via guardarMensajeSaliente()

                    // Emitir evento WebSocket para la respuesta del bot
                    if (global.emitWhatsAppEvent) {
                        global.emitWhatsAppEvent('nuevo_mensaje', {
                            conversacion_id: conversacionId,
                            numero_cliente: numeroCliente,
                            contenido: respuestaFinal,
                            direccion: 'saliente',
                            fecha_envio: new Date().toISOString(),
                            tipo_mensaje: 'text',
                            es_bot: true
                        });
                    }

                    console.log(`✅ Bot respondió a ${numeroCliente}`);

                    // Guardar en RAG para aprendizaje (async, no bloquea)
                    guardarParConEmbeddingRAG(pool, {
                        userId: numeroCliente,
                        pregunta: Body,
                        respuesta: respuestaBot,
                        fuente: 'bot',
                        timestampOriginal: new Date()
                    }).catch(err => console.error('⚠️ RAG async error:', err.message));
                } else {
                    console.log(`⛔ Bot DETENIDO para ${numeroCliente} - No se genera respuesta automática`);
                }
            } catch (botError) {
                console.error('❌ Error en sistema de bot:', botError);
                // No fallar el webhook si el bot tiene error
            }
        }

        // Responder a Twilio con 200 OK (vacio o con TwiML si quieres auto-responder)
        res.type('text/xml');
        res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

    } catch (error) {
        console.error('❌ Error en webhook WhatsApp:', error);
        res.status(500).send('Error');
    }
});

// ============================================================
// POST /status - Twilio Status Callback for outgoing messages
// ============================================================
router.post('/status', async (req, res) => {
    try {
        const { MessageSid, MessageStatus, To, From, Body, NumMedia } = req.body;

        console.log('🔔 ===== STATUS CALLBACK RECIBIDO =====');
        console.log('📊 Status callback de Twilio:', {
            sid: MessageSid,
            status: MessageStatus,
            to: To,
            from: From,
            body: Body,
            numMedia: NumMedia,
            timestamp: new Date().toISOString()
        });
        console.log('🔔 =====================================');

        // Solo procesar cuando el mensaje fue enviado exitosamente
        if (MessageStatus === 'sent' || MessageStatus === 'delivered') {
            // Normalizar número usando helper
            const numeroCliente = normalizarTelefonoConPrefijo57(To);

            // Verificar si el mensaje ya existe en la base de datos
            const mensajeExistente = await pool.query(`
                SELECT id FROM mensajes_whatsapp WHERE sid_twilio = $1
            `, [MessageSid]);

            // Si el mensaje ya existe, no hacer nada (ya fue guardado al enviarlo)
            if (mensajeExistente.rows.length > 0) {
                console.log('✅ Mensaje ya registrado:', MessageSid);
                res.sendStatus(200);
                return;
            }

            // El mensaje NO existe, fue enviado desde otra plataforma
            console.log('📝 Registrando mensaje enviado desde plataforma externa');

            // Buscar conversación - primero con formato normalizado (+), luego sin + (conversaciones viejas)
            let conversacion = await pool.query(`
                SELECT id FROM conversaciones_whatsapp WHERE celular = $1
            `, [numeroCliente]);

            // Si no se encuentra con +, buscar sin + (conversaciones antiguas)
            if (conversacion.rows.length === 0 && numeroCliente.startsWith('+')) {
                const numeroSinMas = numeroCliente.substring(1);
                conversacion = await pool.query(`
                    SELECT id FROM conversaciones_whatsapp WHERE celular = $1
                `, [numeroSinMas]);
            }

            let conversacionId;

            if (conversacion.rows.length === 0) {
                // Crear nueva conversacion
                try {
                    const nuevaConv = await pool.query(`
                        INSERT INTO conversaciones_whatsapp (
                            celular,
                            nombre_paciente,
                            estado_actual,
                            fecha_inicio,
                            fecha_ultima_actividad,
                            bot_activo
                        )
                        VALUES ($1, $2, 'activa', NOW(), NOW(), true)
                        RETURNING id
                    `, [numeroCliente, 'Usuario WhatsApp']);

                    conversacionId = nuevaConv.rows[0].id;
                } catch (insertError) {
                    // Si falla por constraint único (race condition), buscar la conversación que se creó
                    if (insertError.code === '23505') {
                        console.log('⚠️ Conversación ya existe (race condition), buscando nuevamente...');
                        // Buscar con ambos formatos
                        const recuperacion = await pool.query(`
                            SELECT id FROM conversaciones_whatsapp WHERE celular = $1 OR celular = $2
                        `, [numeroCliente, numeroCliente.replace(/^\+/, '')]);

                        if (recuperacion.rows.length > 0) {
                            conversacionId = recuperacion.rows[0].id;
                            console.log(`✅ Conversación recuperada: ${conversacionId}`);
                        } else {
                            throw insertError; // Si aún no existe, re-lanzar el error original
                        }
                    } else {
                        throw insertError; // Otro tipo de error, re-lanzar
                    }
                }
            } else {
                conversacionId = conversacion.rows[0].id;

                // Actualizar ultima actividad
                await pool.query(`
                    UPDATE conversaciones_whatsapp
                    SET fecha_ultima_actividad = NOW()
                    WHERE id = $1
                `, [conversacionId]);
            }

            // Capturar multimedia si existe
            const numMedia = parseInt(NumMedia) || 0;
            const mediaUrls = [];
            const mediaTypes = [];

            for (let i = 0; i < numMedia; i++) {
                const mediaUrl = req.body[`MediaUrl${i}`];
                const mediaType = req.body[`MediaContentType${i}`];
                if (mediaUrl) {
                    mediaUrls.push(mediaUrl);
                    mediaTypes.push(mediaType || 'unknown');
                }
            }

            // Determinar tipo de mensaje
            let tipoMensaje = 'text';
            if (numMedia > 0) {
                const mainMediaType = mediaTypes[0];
                if (mainMediaType.startsWith('image/')) {
                    tipoMensaje = 'image';
                } else if (mainMediaType.startsWith('video/')) {
                    tipoMensaje = 'video';
                } else if (mainMediaType.startsWith('audio/')) {
                    tipoMensaje = 'audio';
                } else if (mainMediaType === 'application/pdf') {
                    tipoMensaje = 'document';
                } else {
                    tipoMensaje = 'media';
                }
            }

            // Determinar contenido del mensaje
            let contenidoMensaje = Body;
            if (!contenidoMensaje) {
                // Si no hay texto, verificar si hay multimedia
                if (numMedia > 0) {
                    contenidoMensaje = '📎 Archivo adjunto';
                } else {
                    // No hay ni texto ni multimedia - no guardar mensaje
                    console.log('⚠️ Mensaje sin contenido ni multimedia, ignorando:', MessageSid);
                    res.sendStatus(200);
                    return;
                }
            }

            // Guardar mensaje saliente desde plataforma externa
            const mensajeResult = await pool.query(`
                INSERT INTO mensajes_whatsapp (
                    conversacion_id,
                    contenido,
                    direccion,
                    sid_twilio,
                    tipo_mensaje,
                    media_url,
                    media_type,
                    timestamp
                )
                VALUES ($1, $2, 'saliente', $3, $4, $5, $6, NOW())
                RETURNING *
            `, [
                conversacionId,
                contenidoMensaje,
                MessageSid,
                tipoMensaje,
                mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null,
                mediaTypes.length > 0 ? JSON.stringify(mediaTypes) : null
            ]);

            console.log('✅ Mensaje externo guardado en conversación:', conversacionId);

            // Emitir evento WebSocket para actualizacion en tiempo real
            if (global.emitWhatsAppEvent) {
                global.emitWhatsAppEvent('nuevo_mensaje', {
                    conversacion_id: conversacionId,
                    numero_cliente: numeroCliente,
                    contenido: contenidoMensaje,
                    direccion: 'saliente',
                    fecha_envio: new Date().toISOString(),
                    sid_twilio: MessageSid,
                    tipo_mensaje: tipoMensaje,
                    media_url: mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null,
                    media_type: mediaTypes.length > 0 ? JSON.stringify(mediaTypes) : null
                });
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Error en status callback:', error);
        res.sendStatus(200); // Siempre responder 200 a Twilio
    }
});

// ============================================================
// POST /enviar-manual - Enviar mensaje manual de WhatsApp (usado desde ordenes.html)
// ============================================================
const { sendWhatsAppMessage } = require('../services/whatsapp');

router.post('/enviar-manual', async (req, res) => {
    try {
        const { celular } = req.body;

        if (!celular) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere celular'
            });
        }

        console.log('📱 Enviando mensaje manual de WhatsApp con template...');
        console.log('   Celular:', celular);

        const telefonoNormalizado = normalizarTelefonoConPrefijo57(celular);

        if (!telefonoNormalizado) {
            return res.status(400).json({
                success: false,
                message: 'Número de teléfono inválido'
            });
        }

        const templateSid = 'HX8c84dc81049e7b055bd30125e9786051';
        const variables = {
            "1": "",
            "2": ""
        };

        const resultado = await sendWhatsAppMessage(
            telefonoNormalizado,
            null,
            variables,
            templateSid
        );

        if (!resultado.success) {
            throw new Error(resultado.error || 'Error al enviar mensaje');
        }

        try {
            const conversacionExistente = await pool.query(
                'SELECT id FROM conversaciones_whatsapp WHERE celular = $1',
                [telefonoNormalizado]
            );

            if (conversacionExistente.rows.length > 0) {
                await pool.query(`
                    UPDATE conversaciones_whatsapp
                    SET "stopBot" = true,
                        fecha_ultima_actividad = NOW()
                    WHERE celular = $1
                `, [telefonoNormalizado]);
            } else {
                await pool.query(`
                    INSERT INTO conversaciones_whatsapp (
                        celular,
                        "stopBot",
                        origen,
                        estado,
                        bot_activo,
                        fecha_inicio,
                        fecha_ultima_actividad
                    ) VALUES ($1, true, 'MANUAL', 'nueva', false, NOW(), NOW())
                `, [telefonoNormalizado]);
            }
        } catch (dbError) {
            console.error('⚠️ Error al guardar en conversaciones_whatsapp:', dbError.message);
        }

        console.log(`✅ Mensaje manual enviado a ${telefonoNormalizado}`);

        res.json({
            success: true,
            message: 'Mensaje enviado exitosamente',
            data: {
                telefono: telefonoNormalizado
            }
        });

    } catch (error) {
        console.error('❌ Error enviando mensaje manual:', error);
        res.status(500).json({
            success: false,
            message: 'Error al enviar mensaje',
            error: error.message
        });
    }
});

module.exports = router;
