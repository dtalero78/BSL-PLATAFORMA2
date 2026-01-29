const twilio = require('twilio');
const pool = require('../config/database');
const { subirMediaWhatsAppASpaces } = require('./spaces-upload');
const { normalizarTelefonoConPrefijo57 } = require('../helpers/phone');

// Inicializar cliente de Twilio
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// NOTA: Ya no necesitamos un diccionario de templates hardcodeado.
// El contenido real se obtiene desde la API de Twilio despues de enviar el mensaje.

// Funcion para enviar mensajes de WhatsApp via Twilio con Content Template
// Usado para notificaciones automaticas pre-aprobadas
async function sendWhatsAppMessage(toNumber, messageBody, variables = {}, templateSid = null) {
    try {
        // Si NO se proporciona templateSid y SI hay messageBody, usar texto libre
        if (!templateSid && !process.env.TWILIO_CONTENT_TEMPLATE_SID && messageBody) {
            console.log('[MSG] Enviando mensaje de texto libre (no template)');
            return await sendWhatsAppFreeText(toNumber, messageBody);
        }

        // Si se proporciona templateSid o hay uno por defecto, usar template
        // Formatear numero: si empieza con 57, agregar whatsapp:+, si no, agregar whatsapp:+57
        let formattedNumber = toNumber;
        if (!formattedNumber.startsWith('whatsapp:')) {
            if (!formattedNumber.startsWith('+')) {
                formattedNumber = formattedNumber.startsWith('57')
                    ? `+${formattedNumber}`
                    : `+57${formattedNumber}`;
            }
            formattedNumber = `whatsapp:${formattedNumber}`;
        }

        // Determinar que template usar
        // Si se proporciona templateSid, usarlo; si no, usar el por defecto
        const contentSid = templateSid || process.env.TWILIO_CONTENT_TEMPLATE_SID;

        if (!contentSid) {
            throw new Error('No se especifico templateSid y no hay TWILIO_CONTENT_TEMPLATE_SID configurado');
        }

        // Usar Content Template para cumplir con politicas de WhatsApp
        const messageParams = {
            contentSid: contentSid,
            from: process.env.TWILIO_WHATSAPP_FROM,
            to: formattedNumber,
            statusCallback: `${process.env.BASE_URL || 'https://bsl-plataforma.com'}/api/whatsapp/status`
        };

        // Si hay variables para el template, agregarlas
        if (Object.keys(variables).length > 0) {
            messageParams.contentVariables = JSON.stringify(variables);
        }

        const message = await twilioClient.messages.create(messageParams);

        console.log(`[WA] WhatsApp template enviado a ${toNumber} (Template: ${contentSid}, SID: ${message.sid})`);

        // Guardar mensaje en base de datos automaticamente
        const numeroLimpio = toNumber.replace(/[^\d]/g, '');

        // Obtener el contenido real del mensaje desde Twilio API
        let contenidoTemplate;
        try {
            // Esperar un momento para que Twilio procese el template
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Consultar el mensaje completo desde la API de Twilio
            const mensajeCompleto = await twilioClient.messages(message.sid).fetch();

            if (mensajeCompleto.body) {
                // Twilio ya renderizo el template con las variables
                contenidoTemplate = mensajeCompleto.body;
                console.log('[OK] Contenido real obtenido desde Twilio API:', contenidoTemplate.substring(0, 100) + '...');
            } else {
                throw new Error('Body no disponible en la respuesta de Twilio');
            }
        } catch (fetchError) {
            console.warn('[WARN] No se pudo obtener el body desde Twilio API, usando fallback:', fetchError.message);

            // Fallback: construir contenido legible del template
            if (messageBody) {
                contenidoTemplate = messageBody;
            } else if (Object.keys(variables).length > 0) {
                const varsTexto = Object.entries(variables)
                    .map(([key, value]) => `{{${key}}}: ${value}`)
                    .join(', ');
                contenidoTemplate = `[TEMPLATE] Template enviado (${contentSid})\nVariables: ${varsTexto}`;
            } else {
                contenidoTemplate = `[TEMPLATE] Template enviado: ${contentSid}`;
            }
        }

        await guardarMensajeSaliente(numeroLimpio, contenidoTemplate, message.sid, 'template');

        return { success: true, sid: message.sid, status: message.status };
    } catch (err) {
        console.error(`[ERROR] Error enviando WhatsApp template a ${toNumber}:`, err.message);
        return { success: false, error: err.message };
    }
}

// Funcion para enviar mensajes de texto libre via Twilio WhatsApp
// Usado para conversaciones del panel de administracion
// IMPORTANTE: Solo funciona dentro de las 24 horas despues de que el cliente envie un mensaje
async function sendWhatsAppFreeText(toNumber, messageBody) {
    try {
        // Formatear numero: si empieza con 57, agregar whatsapp:+, si no, agregar whatsapp:+57
        let formattedNumber = toNumber;
        if (!formattedNumber.startsWith('whatsapp:')) {
            if (!formattedNumber.startsWith('+')) {
                formattedNumber = formattedNumber.startsWith('57')
                    ? `+${formattedNumber}`
                    : `+57${formattedNumber}`;
            }
            formattedNumber = `whatsapp:${formattedNumber}`;
        }

        // Log para debugging de saltos de linea
        console.log('[MSG] Mensaje a enviar (raw):', JSON.stringify(messageBody));
        console.log('[MSG] Contiene \\n?', messageBody.includes('\n'));
        console.log('[MSG] Saltos de linea encontrados:', (messageBody.match(/\n/g) || []).length);

        const messageParams = {
            body: messageBody, // Texto libre del mensaje
            from: process.env.TWILIO_WHATSAPP_FROM,
            to: formattedNumber,
            statusCallback: `${process.env.BASE_URL || 'https://bsl-plataforma.com'}/api/whatsapp/status`
        };

        const message = await twilioClient.messages.create(messageParams);

        console.log(`[WA] WhatsApp texto libre enviado a ${toNumber} (Twilio SID: ${message.sid})`);

        // Guardar mensaje en base de datos automaticamente
        const numeroLimpio = toNumber.replace(/[^\d]/g, '');
        await guardarMensajeSaliente(numeroLimpio, messageBody, message.sid, 'text');

        return { success: true, sid: message.sid, status: message.status };
    } catch (err) {
        console.error(`[ERROR] Error enviando WhatsApp texto libre a ${toNumber}:`, err.message);
        return { success: false, error: err.message };
    }
}

// Enviar WhatsApp con archivo multimedia via Twilio
async function sendWhatsAppMedia(toNumber, mediaBuffer, mediaType, fileName, caption = '') {
    try {
        // Formatear numero
        let formattedNumber = toNumber;
        if (!formattedNumber.startsWith('whatsapp:')) {
            if (!formattedNumber.startsWith('+')) {
                formattedNumber = formattedNumber.startsWith('57')
                    ? `+${formattedNumber}`
                    : `+57${formattedNumber}`;
            }
            formattedNumber = `whatsapp:${formattedNumber}`;
        }

        // Subir archivo a Spaces y obtener URL publica
        const mediaUrl = await subirMediaWhatsAppASpaces(mediaBuffer, fileName, mediaType);

        const messageParams = {
            from: process.env.TWILIO_WHATSAPP_FROM,
            to: formattedNumber,
            mediaUrl: [mediaUrl],
            statusCallback: `${process.env.BASE_URL || 'https://bsl-plataforma.com'}/api/whatsapp/status`
        };

        // Agregar caption si existe
        if (caption) {
            messageParams.body = caption;
        }

        const message = await twilioClient.messages.create(messageParams);

        console.log(`[WA] WhatsApp media enviado a ${toNumber} (Twilio SID: ${message.sid})`);
        return { success: true, sid: message.sid, status: message.status, mediaUrl };
    } catch (err) {
        console.error(`[ERROR] Error enviando WhatsApp media a ${toNumber}:`, err.message);
        return { success: false, error: err.message };
    }
}

// Helper: Guardar mensaje saliente en base de datos y emitir evento WebSocket
async function guardarMensajeSaliente(numeroCliente, contenido, twilioSid, tipoMensaje = 'text', mediaUrl = null, mediaType = null, nombrePaciente = null) {
    try {
        // Normalizar número usando helper centralizado (formato: 57XXXXXXXXXX sin +)
        const numeroNormalizado = normalizarTelefonoConPrefijo57(numeroCliente);

        // Buscar o crear conversacion
        let conversacion = await pool.query(`
            SELECT id FROM conversaciones_whatsapp WHERE celular = $1
        `, [numeroNormalizado]);

        let conversacionId;

        if (conversacion.rows.length === 0) {
            // Crear nueva conversacion
            const nombre = nombrePaciente || 'Cliente WhatsApp';
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
            `, [numeroNormalizado, nombre]);

            conversacionId = nuevaConv.rows[0].id;
            console.log(`[DB] Conversacion creada: ${conversacionId} para ${numeroNormalizado}`);
        } else {
            conversacionId = conversacion.rows[0].id;

            // Actualizar ultima actividad
            await pool.query(`
                UPDATE conversaciones_whatsapp
                SET fecha_ultima_actividad = NOW()
                WHERE id = $1
            `, [conversacionId]);
        }

        // Verificar si el mensaje ya existe
        const mensajeExiste = await pool.query(`
            SELECT id FROM mensajes_whatsapp WHERE sid_twilio = $1
        `, [twilioSid]);

        if (mensajeExiste.rows.length === 0) {
            // Guardar mensaje saliente solo si no existe
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
                VALUES ($1, $2, 'saliente', $3, $4, $5, $6, NOW())
            `, [
                conversacionId,
                contenido,
                twilioSid,
                tipoMensaje,
                mediaUrl ? JSON.stringify([mediaUrl]) : null,
                mediaType ? JSON.stringify([mediaType]) : null
            ]);

            console.log(`[OK] Mensaje guardado en conversacion ${conversacionId} (SID: ${twilioSid})`);
        } else {
            console.log(`[INFO] Mensaje ${twilioSid} ya existe, omitiendo duplicado`);
        }

        // Emitir evento WebSocket para actualizacion en tiempo real
        if (global.emitWhatsAppEvent) {
            global.emitWhatsAppEvent('nuevo_mensaje', {
                conversacion_id: conversacionId,
                numero_cliente: numeroNormalizado,
                contenido: contenido,
                direccion: 'saliente',
                fecha_envio: new Date().toISOString(),
                sid_twilio: twilioSid,
                tipo_mensaje: tipoMensaje
            });
        }

        return { success: true, conversacionId };
    } catch (error) {
        console.error('[ERROR] Error guardando mensaje saliente:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    twilioClient,
    sendWhatsAppMessage,
    sendWhatsAppFreeText,
    sendWhatsAppMedia,
    guardarMensajeSaliente
};
