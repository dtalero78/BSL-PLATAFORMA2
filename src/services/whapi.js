// ========== SERVICIO WHAPI ==========
// Servicio para envío de mensajes WhatsApp mediante WHAPI

/**
 * Enviar mensaje de texto via WHAPI
 * @param {string} toNumber - Número de teléfono con formato internacional (ej: 573001234567)
 * @param {string} messageBody - Cuerpo del mensaje
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendWhapiMessage(toNumber, messageBody) {
    try {
        const fetch = (await import('node-fetch')).default;

        const WHAPI_TOKEN = process.env.WHAPI_TOKEN || 'due3eWCwuBM2Xqd6cPujuTRqSbMb68lt';
        const WHAPI_URL = 'https://gate.whapi.cloud/messages/text';

        // Formatear número: agregar @ si no lo tiene
        let formattedNumber = toNumber.replace(/\+/g, '').replace(/-/g, '').replace(/\s/g, '');
        if (!formattedNumber.includes('@')) {
            formattedNumber = formattedNumber + '@s.whatsapp.net';
        }

        const payload = {
            typing_time: 0,
            to: formattedNumber,
            body: messageBody
        };

        console.log(`📱 WHAPI: Enviando mensaje a ${formattedNumber}`);

        const response = await fetch(WHAPI_URL, {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'authorization': `Bearer ${WHAPI_TOKEN}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            console.log(`✅ WHAPI: Mensaje enviado exitosamente a ${formattedNumber}`);
            return {
                success: true,
                messageId: data.id || data.message_id,
                data: data
            };
        } else {
            console.error(`❌ WHAPI Error: ${response.status} - ${JSON.stringify(data)}`);
            return {
                success: false,
                error: data.message || data.error || `Error ${response.status}`
            };
        }

    } catch (error) {
        console.error('❌ WHAPI Exception:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Construir mensaje de agendamiento para SIIGO
 * @param {Object} paciente - Datos del paciente
 * @returns {string} - Mensaje formateado
 */
function construirMensajeSiigo(paciente) {
    const nombreCompleto = `${paciente.primerNombre || ''} ${paciente.segundoNombre || ''} ${paciente.primerApellido || ''} ${paciente.segundoApellido || ''}`.replace(/\s+/g, ' ').trim();
    const empresa = paciente.empresa || 'su empresa';

    // Formatear fecha si existe
    let fechaStr = 'fecha pendiente';
    if (paciente.fechaAtencion) {
        const fecha = new Date(paciente.fechaAtencion);
        const dia = String(fecha.getDate()).padStart(2, '0');
        const mes = String(fecha.getMonth() + 1).padStart(2, '0');
        const year = fecha.getFullYear();
        fechaStr = `${dia}/${mes}/${year}`;
    }

    const mensaje = `Hola ${nombreCompleto}!

📋 *Agendamiento de Exámenes Médicos*

${empresa} ha programado tus exámenes ocupacionales.

📅 *Fecha programada:* ${fechaStr}
🏥 *Lugar:* BSL - Salud Laboral

Por favor confirma tu asistencia respondiendo a este mensaje.

Si necesitas cambiar la fecha o tienes alguna pregunta, escríbenos.

¡Saludos!
*BSL - Salud Laboral*`;

    return mensaje;
}

module.exports = {
    sendWhapiMessage,
    construirMensajeSiigo
};
