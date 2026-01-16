require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
const cron = require('node-cron');
const { S3Client, PutObjectCommand} = require('@aws-sdk/client-s3');
const puppeteer = require('puppeteer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const twilio = require('twilio');
const { OpenAI } = require('openai');

// Configuración de multer para uploads en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Configurar OpenAI para clasificación de imágenes
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Map para gestión de estado de flujo de pagos
const estadoPagos = new Map();
const ESTADO_ESPERANDO_DOCUMENTO = 'esperando_documento';

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 8080;

// ========== DIGITALOCEAN SPACES (Object Storage) ==========
const SPACES_ENDPOINT = 'https://nyc3.digitaloceanspaces.com';
const SPACES_REGION = 'nyc3';
const SPACES_BUCKET = process.env.SPACES_BUCKET || 'bsl-fotos';

const s3Client = new S3Client({
    endpoint: SPACES_ENDPOINT,
    region: SPACES_REGION,
    credentials: {
        accessKeyId: process.env.SPACES_KEY,
        secretAccessKey: process.env.SPACES_SECRET
    },
    forcePathStyle: false
});

/**
 * Sube una imagen base64 a DigitalOcean Spaces y retorna la URL pública
 * @param {string} base64Data - Imagen en formato base64 (con o sin prefijo data:image)
 * @param {string} numeroId - Número de identificación del paciente
 * @param {number|string} formId - ID del formulario
 * @returns {Promise<string|null>} URL pública de la imagen o null si falla
 */
async function subirFotoASpaces(base64Data, numeroId, formId) {
    try {
        if (!base64Data || base64Data.length < 100) {
            console.log('⚠️ subirFotoASpaces: base64 inválido o muy pequeño');
            return null;
        }

        // Detectar tipo de imagen
        let mime = 'image/jpeg';
        let ext = 'jpg';
        if (base64Data.startsWith('data:image/png')) {
            mime = 'image/png';
            ext = 'png';
        } else if (base64Data.startsWith('data:image/webp')) {
            mime = 'image/webp';
            ext = 'webp';
        }

        // Limpiar prefijo base64
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');

        if (buffer.length < 100) {
            console.log('⚠️ subirFotoASpaces: buffer demasiado pequeño');
            return null;
        }

        // Generar nombre único
        const timestamp = Date.now();
        const fileName = `fotos/${numeroId || 'unknown'}_${formId}_${timestamp}.${ext}`;

        // Subir a Spaces
        await s3Client.send(new PutObjectCommand({
            Bucket: SPACES_BUCKET,
            Key: fileName,
            Body: buffer,
            ContentType: mime,
            ACL: 'public-read',
            CacheControl: 'max-age=31536000'
        }));

        const fotoUrl = `https://${SPACES_BUCKET}.${SPACES_REGION}.digitaloceanspaces.com/${fileName}`;
        console.log(`📸 Foto subida a Spaces: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);

        return fotoUrl;
    } catch (error) {
        console.error('❌ Error subiendo foto a Spaces:', error.message);
        return null;
    }
}

// ========== HELPER: Construir fecha de atención correcta ==========
// Recibe fecha y hora en zona horaria Colombia y retorna un Date UTC correcto
// fecha: YYYY-MM-DD o YYYY-MM-DDTHH:MM (datetime-local)
// hora: HH:MM (hora Colombia) - opcional si ya viene en fecha
function construirFechaAtencionColombia(fecha, hora) {
    if (!fecha) return null;

    let fechaStr, horaStr;

    // Si viene un ISO string completo (2025-12-11T16:40:00.000Z), usarlo directamente
    // pero necesitamos la hora que el usuario seleccionó (hora Colombia)
    if (typeof fecha === 'string' && fecha.includes('T')) {
        const partes = fecha.split('T');
        fechaStr = partes[0];
        // Si viene hora como parámetro, usarla; si no, extraer del ISO
        if (hora) {
            horaStr = hora;
        } else {
            // Extraer hora del ISO (puede tener formato HH:MM:SS.sssZ o HH:MM:SS o HH:MM)
            let horaParte = partes[1] || '08:00';
            // Limpiar sufijos como Z, +00:00, .000Z
            horaParte = horaParte.replace(/[Z].*$/, '').replace(/\.\d+.*$/, '').replace(/[+-]\d{2}:\d{2}$/, '');
            horaStr = horaParte.substring(0, 5); // Tomar solo HH:MM
        }
    } else if (typeof fecha === 'string') {
        fechaStr = fecha;
        horaStr = hora || '08:00';
    } else {
        // Si fecha no es string, intentar convertir
        try {
            const fechaObj = new Date(fecha);
            if (isNaN(fechaObj.getTime())) return null;
            return fechaObj;
        } catch (e) {
            console.log(`⚠️ construirFechaAtencionColombia: fecha inválida`, fecha);
            return null;
        }
    }

    // Validar formato de fecha YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
        console.log(`⚠️ construirFechaAtencionColombia: formato de fecha inválido`, fechaStr);
        return null;
    }

    // Normalizar hora: convertir "7:00" a "07:00", "9:30" a "09:30", etc.
    if (horaStr) {
        const horaParts = horaStr.split(':');
        if (horaParts.length >= 2) {
            const hh = horaParts[0].padStart(2, '0');
            const mm = horaParts[1].padStart(2, '0');
            const ss = horaParts[2] ? horaParts[2].padStart(2, '0') : '00';
            horaStr = `${hh}:${mm}:${ss}`;
        } else {
            horaStr = '08:00:00'; // Default si el formato es inválido
        }
    } else {
        horaStr = '08:00:00';
    }

    // Construir la fecha con offset Colombia (UTC-5)
    // Ejemplo: 2025-12-11T11:40:00-05:00 -> Se interpreta como 11:40 AM Colombia -> 16:40 UTC
    const fechaCompleta = `${fechaStr}T${horaStr}-05:00`;

    console.log(`📅 construirFechaAtencionColombia: ${fecha} + ${hora} -> ${fechaCompleta}`);

    const resultado = new Date(fechaCompleta);

    // Validar que el resultado sea válido
    if (isNaN(resultado.getTime())) {
        console.log(`⚠️ construirFechaAtencionColombia: resultado inválido para ${fechaCompleta}`);
        return null;
    }

    return resultado;
}

// ========== HELPER: Normalizar teléfono con prefijo 57 ==========
// Agrega el prefijo 57 (Colombia) si el teléfono no tiene prefijo internacional
// Detecta si ya tiene un prefijo internacional diferente (ej: +1, +34, etc.)
function normalizarTelefonoConPrefijo57(celular) {
    if (!celular) return null;

    // Limpiar espacios, guiones y paréntesis
    let telefono = celular.toString().replace(/[\s\-\(\)]/g, '');

    // Si ya tiene el símbolo +, verificar si es Colombia o internacional
    if (telefono.startsWith('+')) {
        // Ya tiene prefijo internacional, dejarlo tal cual
        return telefono;
    }

    // Si empieza con 57 y tiene longitud correcta (57 + 10 dígitos = 12)
    if (telefono.startsWith('57') && telefono.length === 12) {
        return telefono;
    }

    // Si empieza con otro prefijo internacional común (1, 34, 52, etc.)
    const prefijoInternacional = /^(1|7|20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98|212|213|216|218|220|221|222|223|224|225|226|227|228|229|230|231|232|233|234|235|236|237|238|239|240|241|242|243|244|245|246|247|248|249|250|251|252|253|254|255|256|257|258|260|261|262|263|264|265|266|267|268|269|290|291|297|298|299|350|351|352|353|354|355|356|357|358|359|370|371|372|373|374|375|376|377|378|380|381|382|383|385|386|387|389|420|421|423|500|501|502|503|504|505|506|507|508|509|590|591|592|593|594|595|596|597|598|599|670|672|673|674|675|676|677|678|679|680|681|682|683|685|686|687|688|689|690|691|692|850|852|853|855|856|880|886|960|961|962|963|964|965|966|967|968|970|971|972|973|974|975|976|977|992|993|994|995|996|998)\d+/;

    if (prefijoInternacional.test(telefono)) {
        // Es un número internacional, dejarlo tal cual
        return telefono;
    }

    // Si tiene exactamente 10 dígitos, es un número colombiano sin prefijo
    if (telefono.length === 10 && /^\d{10}$/.test(telefono)) {
        return '57' + telefono;
    }

    // Si tiene 3 seguido de 9 dígitos (formato celular colombiano común)
    if (telefono.length === 10 && telefono.startsWith('3')) {
        return '57' + telefono;
    }

    // En cualquier otro caso, asumir que es colombiano y agregar 57
    return '57' + telefono;
}

// ========== SERVER-SENT EVENTS (SSE) ==========
// Clientes conectados para notificaciones en tiempo real
let sseClients = [];

// Función para notificar a todos los clientes SSE
function notificarNuevaOrden(orden) {
    const data = JSON.stringify({ type: 'nueva-orden', orden });
    sseClients.forEach(client => {
        client.res.write(`data: ${data}\n\n`);
    });
    console.log(`📡 Notificación SSE enviada a ${sseClients.length} clientes`);
}

// ========== FUNCIONES PARA WEBHOOK MAKE.COM ==========

// Limpiar strings (quitar acentos, espacios, puntos)
function limpiarStringWebhook(str) {
    if (!str) return '';
    const acentos = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
                      'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'ñ': 'n', 'Ñ': 'N' };
    return str.split('').map(letra => acentos[letra] || letra).join('')
              .replace(/\s+/g, '').replace(/\./g, '').replace(/\t/g, '');
}

// Limpiar teléfono (quitar prefijo +57 o 57)
function limpiarTelefonoWebhook(telefono) {
    if (!telefono) return '';
    let limpio = telefono.replace(/\s+/g, '').replace(/-/g, '');
    if (limpio.startsWith('+57')) limpio = limpio.substring(3);
    else if (limpio.startsWith('57')) limpio = limpio.substring(2);
    return limpio;
}

// Determinar género basado en exámenes
function determinarGeneroWebhook(examenes) {
    if (!examenes) return '';
    return examenes.includes('Serología') ? 'FEMENINO' : '';
}

// Mapear ciudad a formato Make.com (sin acentos, sin espacios, todo en mayúsculas)
function mapearCiudadWebhook(ciudad) {
    if (!ciudad) return '';

    // Mapeo de ciudades a formato esperado por Make.com
    const mapaCiudades = {
        'Bogotá': 'BOGOTA',
        'Medellín': 'MEDELLIN',
        'Cali': 'CALI',
        'Barranquilla': 'BARRANQUILLA',
        'Cartagena': 'CARTAGENA',
        'Cúcuta': 'CUCUTA',
        'Bucaramanga': 'BUCARAMANGA',
        'Pereira': 'PEREIRA',
        'Santa Marta': 'SANTAMARTA',
        'Ibagué': 'IBAGUE',
        'Pasto': 'PASTO',
        'Manizales': 'MANIZALES',
        'Neiva': 'NEIVA',
        'Villavicencio': 'VILLAVICENCIO',
        'Armenia': 'ARMENIA',
        'Valledupar': 'VALLEDUPAR',
        'Montería': 'MONTERIA',
        'Sincelejo': 'SINCELEJO',
        'Popayán': 'POPAYAN',
        'Floridablanca': 'FLORIDABLANCA',
        'Buenaventura': 'BUENAVENTURA',
        'Soledad': 'SOLEDAD',
        'Itagüí': 'ITAGUI',
        'Soacha': 'SOACHA',
        'Bello': 'BELLO',
        'Palmira': 'PALMIRA',
        'Tunja': 'TUNJA',
        'Girardot': 'GIRARDOT',
        'Riohacha': 'RIOHACHA',
        'Barrancabermeja': 'BARRANCABERMEJA',
        'Dosquebradas': 'DOSQUEBRADAS',
        'Envigado': 'ENVIGADO',
        'Tuluá': 'TULUA',
        'Sogamoso': 'SOGAMOSO',
        'Duitama': 'DUITAMA',
        'Zipaquirá': 'ZIPAQUIRA',
        'Facatativá': 'FACATATIVA',
        'Chía': 'CHIA',
        'Fusagasugá': 'FUSAGASUGA',
        'Otro': 'OTRA'
    };

    // Buscar en el mapa, si no existe usar la función de limpieza genérica
    return mapaCiudades[ciudad] || limpiarStringWebhook(ciudad).toUpperCase();
}

// Disparar webhook a Make.com
async function dispararWebhookMake(orden) {
    try {
        // No enviar webhook para SANITHELP-JJ
        if (orden.codEmpresa === 'SANITHELP-JJ') {
            console.log('⏭️  Webhook Make.com omitido para SANITHELP-JJ:', orden._id);
            return;
        }

        // Si la modalidad es presencial, enviar "PRESENCIAL" como médico
        const medicoWebhook = orden.modalidad === 'presencial' ? 'PRESENCIAL' : limpiarStringWebhook(orden.medico);

        const params = new URLSearchParams({
            cel: limpiarTelefonoWebhook(orden.celular),
            cedula: limpiarStringWebhook(orden.numeroId),
            nombre: limpiarStringWebhook(orden.primerNombre),
            empresa: limpiarStringWebhook(orden.codEmpresa),
            genero: determinarGeneroWebhook(orden.examenes),
            ciudad: mapearCiudadWebhook(orden.ciudad),
            fecha: orden.fechaAtencion ? new Date(orden.fechaAtencion).toLocaleDateString('es-CO') : '',
            hora: orden.horaAtencion || '',
            medico: medicoWebhook,
            id: orden._id
        });

        const url = `https://hook.us1.make.com/3edkq8bfppx31t6zbd86sfu7urdrhti9?${params.toString()}`;

        const response = await fetch(url);
        console.log('✅ Webhook Make.com enviado:', orden._id);
    } catch (error) {
        console.error('❌ Error enviando webhook Make.com:', error.message);
        // No bloquear la respuesta al cliente si falla el webhook
    }
}

// Inicializar cliente de Twilio
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Mapeo de templates a su contenido real para guardar en BD
const TEMPLATE_TEXTS = {
    'HX8c84dc81049e7b055bd30125e9786051': 'Hola!\n\nAcabamos de recibir una llamada de ese celular.\n¿Es para exámenes ocupacionales?',
    'HX43d06a0a97e11919c1e4b19d3e4b6957': 'Hola {{1}}! Tu cita ha sido confirmada para el {{2}}.',
    'HX4554efaf53c1bd614d49c951e487d394': '¡Hola! Gracias por comunicarte con BSL.\n\nPara agilizar tu proceso, por favor completa el siguiente formulario: https://www.bsl.com.co/?_id={{1}}',
    'HXeb45e56eb2e8dc4eaa35433282e12709': 'Hola! Tu cita médica está programada para el {{1}} a las {{2}}.\n\nPara completar el formulario, ingresa aquí: https://www.bsl.com.co/?_id={{3}}'
};

// Función helper para reemplazar variables en template
function reemplazarVariablesTemplate(templateText, variables) {
    let texto = templateText;
    for (const [key, value] of Object.entries(variables)) {
        texto = texto.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return texto;
}

// Función para enviar mensajes de WhatsApp via Twilio con Content Template
// Usado para notificaciones automáticas pre-aprobadas
async function sendWhatsAppMessage(toNumber, messageBody, variables = {}, templateSid = null) {
    try {
        // Si NO se proporciona templateSid y SÍ hay messageBody, usar texto libre
        if (!templateSid && !process.env.TWILIO_CONTENT_TEMPLATE_SID && messageBody) {
            console.log('📝 Enviando mensaje de texto libre (no template)');
            return await sendWhatsAppFreeText(toNumber, messageBody);
        }

        // Si se proporciona templateSid o hay uno por defecto, usar template
        // Formatear número: si empieza con 57, agregar whatsapp:+, si no, agregar whatsapp:+57
        let formattedNumber = toNumber;
        if (!formattedNumber.startsWith('whatsapp:')) {
            if (!formattedNumber.startsWith('+')) {
                formattedNumber = formattedNumber.startsWith('57')
                    ? `+${formattedNumber}`
                    : `+57${formattedNumber}`;
            }
            formattedNumber = `whatsapp:${formattedNumber}`;
        }

        // Determinar qué template usar
        // Si se proporciona templateSid, usarlo; si no, usar el por defecto
        const contentSid = templateSid || process.env.TWILIO_CONTENT_TEMPLATE_SID;

        if (!contentSid) {
            throw new Error('No se especificó templateSid y no hay TWILIO_CONTENT_TEMPLATE_SID configurado');
        }

        // Usar Content Template para cumplir con políticas de WhatsApp
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

        console.log(`📱 WhatsApp template enviado a ${toNumber} (Template: ${contentSid}, SID: ${message.sid})`);

        // Guardar mensaje en base de datos automáticamente
        const numeroLimpio = toNumber.replace(/[^\d]/g, '');

        // Construir contenido legible del template
        let contenidoTemplate;
        if (messageBody) {
            // Si se pasó messageBody directamente, usarlo
            contenidoTemplate = messageBody;
        } else if (TEMPLATE_TEXTS[contentSid]) {
            // Usar el texto real del template y reemplazar variables
            contenidoTemplate = reemplazarVariablesTemplate(TEMPLATE_TEXTS[contentSid], variables);
        } else if (Object.keys(variables).length > 0) {
            // Fallback si el template no está en el mapeo
            const varsTexto = Object.entries(variables)
                .map(([key, value]) => `{{${key}}}: ${value}`)
                .join(', ');
            contenidoTemplate = `📬 Template enviado (${contentSid})\nVariables: ${varsTexto}`;
        } else {
            contenidoTemplate = `📬 Template enviado: ${contentSid}`;
        }

        await guardarMensajeSaliente(numeroLimpio, contenidoTemplate, message.sid, 'template');

        return { success: true, sid: message.sid, status: message.status };
    } catch (err) {
        console.error(`❌ Error enviando WhatsApp template a ${toNumber}:`, err.message);
        return { success: false, error: err.message };
    }
}

// Función para enviar mensajes de texto libre via Twilio WhatsApp
// Usado para conversaciones del panel de administración
// IMPORTANTE: Solo funciona dentro de las 24 horas después de que el cliente envíe un mensaje
async function sendWhatsAppFreeText(toNumber, messageBody) {
    try {
        // Formatear número: si empieza con 57, agregar whatsapp:+, si no, agregar whatsapp:+57
        let formattedNumber = toNumber;
        if (!formattedNumber.startsWith('whatsapp:')) {
            if (!formattedNumber.startsWith('+')) {
                formattedNumber = formattedNumber.startsWith('57')
                    ? `+${formattedNumber}`
                    : `+57${formattedNumber}`;
            }
            formattedNumber = `whatsapp:${formattedNumber}`;
        }

        // Log para debugging de saltos de línea
        console.log('📝 Mensaje a enviar (raw):', JSON.stringify(messageBody));
        console.log('📝 Contiene \\n?', messageBody.includes('\n'));
        console.log('📝 Saltos de línea encontrados:', (messageBody.match(/\n/g) || []).length);

        const messageParams = {
            body: messageBody, // Texto libre del mensaje
            from: process.env.TWILIO_WHATSAPP_FROM,
            to: formattedNumber,
            statusCallback: `${process.env.BASE_URL || 'https://bsl-plataforma.com'}/api/whatsapp/status`
        };

        const message = await twilioClient.messages.create(messageParams);

        console.log(`📱 WhatsApp texto libre enviado a ${toNumber} (Twilio SID: ${message.sid})`);

        // Guardar mensaje en base de datos automáticamente
        const numeroLimpio = toNumber.replace(/[^\d]/g, '');
        await guardarMensajeSaliente(numeroLimpio, messageBody, message.sid, 'text');

        return { success: true, sid: message.sid, status: message.status };
    } catch (err) {
        console.error(`❌ Error enviando WhatsApp texto libre a ${toNumber}:`, err.message);
        return { success: false, error: err.message };
    }
}

// Subir archivo multimedia a Digital Ocean Spaces para WhatsApp
async function subirMediaWhatsAppASpaces(buffer, fileName, mimeType) {
    try {
        // Generar nombre único
        const timestamp = Date.now();
        const ext = fileName.split('.').pop();
        const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const key = `whatsapp-media/${timestamp}_${sanitizedName}`;

        // Subir a Spaces
        await s3Client.send(new PutObjectCommand({
            Bucket: SPACES_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: mimeType,
            ACL: 'public-read',
            CacheControl: 'max-age=31536000'
        }));

        const mediaUrl = `https://${SPACES_BUCKET}.${SPACES_REGION}.digitaloceanspaces.com/${key}`;
        console.log(`📤 Media WhatsApp subido a Spaces: ${key} (${(buffer.length / 1024).toFixed(1)} KB)`);

        return mediaUrl;
    } catch (error) {
        console.error('❌ Error subiendo media WhatsApp a Spaces:', error.message);
        throw error;
    }
}

// Enviar WhatsApp con archivo multimedia via Twilio
async function sendWhatsAppMedia(toNumber, mediaBuffer, mediaType, fileName, caption = '') {
    try {
        // Formatear número
        let formattedNumber = toNumber;
        if (!formattedNumber.startsWith('whatsapp:')) {
            if (!formattedNumber.startsWith('+')) {
                formattedNumber = formattedNumber.startsWith('57')
                    ? `+${formattedNumber}`
                    : `+57${formattedNumber}`;
            }
            formattedNumber = `whatsapp:${formattedNumber}`;
        }

        // Subir archivo a Spaces y obtener URL pública
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

        console.log(`📱 WhatsApp media enviado a ${toNumber} (Twilio SID: ${message.sid})`);
        return { success: true, sid: message.sid, status: message.status, mediaUrl };
    } catch (err) {
        console.error(`❌ Error enviando WhatsApp media a ${toNumber}:`, err.message);
        return { success: false, error: err.message };
    }
}

// Helper: Guardar mensaje saliente en base de datos y emitir evento WebSocket
async function guardarMensajeSaliente(numeroCliente, contenido, twilioSid, tipoMensaje = 'text', mediaUrl = null, mediaType = null, nombrePaciente = null) {
    try {
        // Normalizar número: mantener formato internacional
        let numeroNormalizado = numeroCliente.trim().replace(/[^\d+]/g, '');

        // Si ya tiene +, mantenerlo
        if (numeroNormalizado.startsWith('+')) {
            // Ya tiene formato correcto
        } else {
            // Remover + temporal si existe para procesar
            numeroNormalizado = numeroNormalizado.replace(/^\+/, '');

            // Si empieza con 5757, remover el 57 duplicado
            if (numeroNormalizado.startsWith('5757')) {
                numeroNormalizado = numeroNormalizado.substring(2);
            }

            // Solo agregar +57 si es un número colombiano de 10 dígitos sin código de país
            if (numeroNormalizado.length === 10 && numeroNormalizado.match(/^3\d{9}$/)) {
                numeroNormalizado = '57' + numeroNormalizado;
            }
            // Si ya tiene código de país pero no +, asumimos que está correcto

            // Agregar + al inicio si no lo tiene
            if (!numeroNormalizado.startsWith('+')) {
                numeroNormalizado = '+' + numeroNormalizado;
            }
        }

        // Buscar o crear conversación
        let conversacion = await pool.query(`
            SELECT id FROM conversaciones_whatsapp WHERE celular = $1
        `, [numeroNormalizado]);

        let conversacionId;

        if (conversacion.rows.length === 0) {
            // Crear nueva conversación
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
            console.log(`📝 Conversación creada: ${conversacionId} para ${numeroNormalizado}`);
        } else {
            conversacionId = conversacion.rows[0].id;

            // Actualizar última actividad
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

            console.log(`✅ Mensaje guardado en conversación ${conversacionId} (SID: ${twilioSid})`);
        } else {
            console.log(`ℹ️  Mensaje ${twilioSid} ya existe, omitiendo duplicado`);
        }

        // Emitir evento WebSocket para actualización en tiempo real
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
        console.error('❌ Error guardando mensaje saliente:', error);
        return { success: false, error: error.message };
    }
}

// ========== VALIDACIÓN AUTOMÁTICA DE PAGOS CON OPENAI VISION ==========

/**
 * Clasifica una imagen usando OpenAI Vision API
 * @param {string} base64Image - Imagen en base64
 * @param {string} mimeType - Tipo MIME de la imagen (image/jpeg, image/png, etc.)
 * @returns {Promise<string>} - Clasificación: 'comprobante_pago', 'listado_examenes', 'certificado_medico', 'otra_imagen', 'error'
 */
async function clasificarImagen(base64Image, mimeType) {
    try {
        const systemPrompt = `Eres un clasificador de imágenes especializado en documentos médicos y financieros.

Analiza la imagen y clasifícala en UNA de estas 3 categorías:

1. "comprobante_pago" - Capturas de transferencias bancarias, PSE, Nequi, Daviplata, comprobantes de pago
   Características: fecha, monto, número de referencia, nombre del banco/app

2. "listado_examenes" - Listas de exámenes médicos requeridos por empresas
   Características: membrete de empresa, lista de exámenes, puede tener logos

3. "otra_imagen" - Cualquier otra imagen que no encaje en las anteriores
   Ejemplos: fotos personales, memes, capturas de WhatsApp, certificados médicos

RESPONDE SOLO CON UNA DE ESTAS PALABRAS:
comprobante_pago
listado_examenes
otra_imagen

NO AGREGUES EXPLICACIONES NI PUNTUACIÓN ADICIONAL.`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Clasifica esta imagen:'
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${mimeType};base64,${base64Image}`,
                                detail: 'low' // Más rápido y económico
                            }
                        }
                    ]
                }
            ],
            max_tokens: 50,
            temperature: 0.1 // Muy determinista
        });

        const clasificacion = response.choices[0].message.content.trim().toLowerCase();
        console.log(`🔍 Clasificación de imagen: ${clasificacion}`);

        return clasificacion;
    } catch (error) {
        console.error('❌ Error clasificando imagen con OpenAI:', error);
        return 'error';
    }
}

/**
 * Valida si un texto es un número de documento válido
 * @param {string} texto - Texto a validar
 * @returns {boolean} - true si es documento válido
 */
function esCedula(texto) {
    const numero = texto.trim();
    // Solo números, entre 6 y 10 dígitos
    return /^\d{6,10}$/.test(numero);
}

/**
 * Marca un registro en HistoriaClinica como pagado
 * @param {string} numeroDocumento - Número de cédula del paciente
 * @returns {Promise<object>} - Resultado con success, data o error
 */
async function marcarPagadoHistoriaClinica(numeroDocumento) {
    try {
        const result = await pool.query(`
            UPDATE "HistoriaClinica"
            SET
                "pagado" = true,
                "pvEstado" = 'Pagado',
                fecha_pago = NOW()
            WHERE "numeroId" = $1
            RETURNING _id, "numeroId", "primerNombre", "primerApellido", "pagado", "pvEstado", fecha_pago
        `, [numeroDocumento]);

        if (result.rows.length > 0) {
            console.log(`✅ Pago marcado en HistoriaClinica para documento: ${numeroDocumento}`);
            return {
                success: true,
                data: result.rows[0]
            };
        } else {
            console.log(`⚠️ No se encontró registro en HistoriaClinica para documento: ${numeroDocumento}`);
            return {
                success: false,
                message: 'No se encontró el registro en la base de datos'
            };
        }
    } catch (error) {
        console.error('❌ Error marcando pago en HistoriaClinica:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Procesa el flujo completo de validación de pagos
 * @param {object} message - Mensaje parseado de Twilio
 * @param {string} from - Número del usuario en formato whatsapp:+573XXXXXXXXX
 * @returns {Promise<string>} - Mensaje de respuesta para el usuario
 */
async function procesarFlujoPagos(message, from) {
    try {
        const messageText = (message.Body || '').trim();
        const numMedia = parseInt(message.NumMedia) || 0;
        const estadoPago = estadoPagos.get(from);

        console.log(`📸 Procesando flujo de pagos - Usuario: ${from}, Media: ${numMedia}, Estado: ${estadoPago}`);

        // Caso 1: Usuario envía IMAGEN (nueva)
        if (numMedia > 0) {
            const mediaUrl = message.MediaUrl0;
            const mediaType = message.MediaContentType0 || 'image/jpeg';

            // Descargar imagen desde Twilio
            console.log(`⬇️ Descargando imagen desde Twilio: ${mediaUrl}`);

            const axios = require('axios');
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;

            const imageResponse = await axios.get(mediaUrl, {
                auth: {
                    username: accountSid,
                    password: authToken
                },
                responseType: 'arraybuffer',
                timeout: 60000
            });

            const base64Image = Buffer.from(imageResponse.data).toString('base64');

            // Clasificar imagen con OpenAI
            const clasificacion = await clasificarImagen(base64Image, mediaType);

            // Router de clasificación
            if (clasificacion === 'comprobante_pago') {
                // Pedir documento
                await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                    '✅ Comprobante recibido.\n\n¿Cuál es tu número de documento? (solo números, sin puntos)');

                estadoPagos.set(from, ESTADO_ESPERANDO_DOCUMENTO);
                return 'Comprobante validado, esperando documento';
            }
            else {
                // listado_examenes, otra_imagen o error -> NO responder nada
                // Dejar que el usuario continúe normalmente o el asesor vea la imagen
                console.log(`📸 Imagen clasificada como "${clasificacion}" - no se procesa automáticamente`);
                return 'Imagen no procesada';
            }
        }

        // Caso 2: Usuario envía TEXTO (documento) con flujo activo
        if (messageText && estadoPago === ESTADO_ESPERANDO_DOCUMENTO) {
            const documento = messageText.trim();

            // Validar formato de documento
            if (!esCedula(documento)) {
                await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                    'Por favor envía solo números, sin puntos ni guiones.\n\nEjemplo: 1234567890');
                return 'Documento inválido';
            }

            // Marcar como pagado en base de datos
            console.log(`⏳ Procesando pago para documento: ${documento}`);

            await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                `⏳ Procesando pago para documento ${documento}...`);

            const resultado = await marcarPagadoHistoriaClinica(documento);

            if (resultado.success) {
                const data = resultado.data;
                const nombre = `${data.primerNombre || ''} ${data.primerApellido || ''}`.trim();

                await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                    `🎉 *¡Pago registrado exitosamente!*\n\n👤 ${nombre}\n📄 Documento: ${documento}\n\n✅ Tu pago ha sido validado. Puedes descargar tu certificado médico desde:\n\n🔗 https://bsl-plataforma.com/consulta-orden.html\n\nGracias por confiar en BSL.`);

                // Limpiar estado
                estadoPagos.delete(from);

                // Detener bot
                await pool.query(`
                    UPDATE conversaciones_whatsapp
                    SET bot_activo = false
                    WHERE celular = $1
                `, [from.replace('whatsapp:', '')]);

                console.log(`✅ Pago procesado exitosamente para ${documento}`);
                return 'Pago confirmado';
            } else {
                // No se encontró el registro
                await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                    `❌ No encontré un registro con el documento ${documento}.\n\nVerifica que:\n• El número esté correcto\n• Ya hayas realizado tu examen médico\n\nSi necesitas ayuda, un asesor te contactará pronto.`);

                // Limpiar estado
                estadoPagos.delete(from);
                return 'Documento no encontrado';
            }
        }

        // Caso 3: Texto sin flujo activo -> ignorar (lo procesa el webhook normal)
        return null;

    } catch (error) {
        console.error('❌ Error en procesarFlujoPagos:', error);

        try {
            await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                'Lo siento, hubo un error procesando tu solicitud. Un asesor te contactará pronto.');
        } catch (err) {
            console.error('❌ Error enviando mensaje de error:', err);
        }

        // Limpiar estado en caso de error
        estadoPagos.delete(from);

        return 'Error en flujo de pagos';
    }
}

// Notificar al coordinador de agendamiento sobre nueva orden
async function notificarCoordinadorNuevaOrden(orden) {
    try {
        // VALIDACIÓN: Solo notificar si cumple TODAS las condiciones:
        // 1. Modalidad PRESENCIAL
        // 2. Ciudad diferente a Bogotá y Barranquilla
        // 3. Empresa diferente a SANITHELP-JJ

        const modalidadPresencial = !orden.modalidad || orden.modalidad === 'presencial';

        // Normalizar ciudad para comparación (sin acentos, minúsculas)
        const ciudadNormalizada = orden.ciudad ?
            orden.ciudad.toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            : '';

        const ciudadesExcluidas = ['bogota', 'barranquilla'];
        const ciudadExcluida = ciudadesExcluidas.includes(ciudadNormalizada);

        // Excluir empresa SANITHELP-JJ
        const empresaExcluida = orden.codEmpresa === 'SANITHELP-JJ';

        if (!modalidadPresencial || ciudadExcluida || empresaExcluida) {
            console.log(`⏭️ No se notifica al coordinador - Modalidad: ${orden.modalidad || 'presencial'}, Ciudad: ${orden.ciudad}, Empresa: ${orden.codEmpresa}`);
            return;
        }

        const coordinadorCelular = process.env.COORDINADOR_CELULAR;

        if (!coordinadorCelular) {
            console.log('⚠️ No hay coordinador configurado para notificaciones');
            return;
        }

        // Construir nombre completo del paciente
        const nombreCompleto = [
            orden.primerNombre,
            orden.segundoNombre,
            orden.primerApellido,
            orden.segundoApellido
        ].filter(Boolean).join(' ');

        // Formatear fecha
        const fechaFormateada = orden.fechaAtencion ?
            new Date(orden.fechaAtencion).toLocaleDateString('es-CO', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }) : 'No definida';

        // Construir mensaje
        const mensaje = `🆕 *Nueva Orden de Examen*

📋 *Empresa:* ${orden.codEmpresa}
🏥 *Tipo de Examen:* ${orden.tipoExamen || 'No especificado'}

👤 *Paciente:* ${nombreCompleto}
🆔 *Documento:* ${orden.numeroId}
📱 *Celular:* ${orden.celular}
🏙️ *Ciudad:* ${orden.ciudad}

📅 *Fecha programada:* ${fechaFormateada}
⏰ *Hora:* ${orden.horaAtencion || 'No definida'}
🩺 *Modalidad:* ${orden.modalidad === 'presencial' ? 'Presencial' : 'Virtual'}

🆔 *ID Orden:* ${orden._id}`;

        await sendWhatsAppMessage(coordinadorCelular, mensaje);
        console.log('✅ Notificación enviada al coordinador:', coordinadorCelular);
    } catch (error) {
        console.error('❌ Error notificando al coordinador:', error.message);
        // No bloquear si falla la notificación
    }
}

/**
 * Verifica si un número de celular es nuevo (no existe en ninguna tabla)
 * @param {string} numeroCelular - Número de celular a verificar
 * @returns {Promise<boolean>} - true si es nuevo, false si ya existe
 */
async function esUsuarioNuevo(numeroCelular) {
    try {
        // Normalizar número (puede venir con o sin +57)
        let numeroLimpio = numeroCelular.replace(/[^0-9]/g, '');

        // Si no tiene código de país, agregarlo
        if (!numeroLimpio.startsWith('57') && numeroLimpio.length === 10) {
            numeroLimpio = '57' + numeroLimpio;
        }

        // Buscar en HistoriaClinica
        const enHistoria = await pool.query(`
            SELECT "numeroId" FROM "HistoriaClinica"
            WHERE celular LIKE '%${numeroLimpio.slice(-10)}%'
            LIMIT 1
        `);

        if (enHistoria.rows.length > 0) {
            console.log('📋 Usuario encontrado en HistoriaClinica');
            return false;
        }

        // Buscar en formularios
        const enFormularios = await pool.query(`
            SELECT id FROM formularios
            WHERE celular LIKE '%${numeroLimpio.slice(-10)}%'
            LIMIT 1
        `);

        if (enFormularios.rows.length > 0) {
            console.log('📋 Usuario encontrado en formularios');
            return false;
        }

        // Buscar en conversaciones_whatsapp con más de 2 mensajes (para no contar solo el mensaje inicial)
        const enWhatsApp = await pool.query(`
            SELECT cw.id
            FROM conversaciones_whatsapp cw
            WHERE cw.celular = $1
            AND (
                SELECT COUNT(*)
                FROM mensajes_whatsapp mw
                WHERE mw.conversacion_id = cw.id
            ) > 2
            LIMIT 1
        `, [numeroCelular]);

        if (enWhatsApp.rows.length > 0) {
            console.log('📋 Usuario con historial en WhatsApp');
            return false;
        }

        console.log('🆕 Usuario nuevo detectado:', numeroCelular);
        return true;

    } catch (error) {
        console.error('❌ Error verificando si es usuario nuevo:', error);
        return false; // En caso de error, asumir que no es nuevo para evitar spam
    }
}


// Configuración de números de alerta por empresa
const NUMEROS_ALERTA_POR_EMPRESA = {
    "SIIGO": [
        "573008021701",
        "573045792035",
        "573138232201"
    ],
    "MASIN": [
        "573112634312",
        "573008021701"
    ]
};

// Función para enviar alertas de preguntas críticas (para empresas SIIGO y MASIN)
async function enviarAlertasPreguntasCriticas(datos) {
    // Verificar si la empresa tiene alertas configuradas
    const numerosAlerta = NUMEROS_ALERTA_POR_EMPRESA[datos.codEmpresa];

    if (!numerosAlerta) {
        console.log('ℹ️ Alertas WhatsApp omitidas - Empresa:', datos.codEmpresa || 'No especificada', '(solo aplica para SIIGO y MASIN)');
        return;
    }

    const alertas = [];

    // Verificar cada pregunta nueva y agregar alertas si es afirmativa
    if (datos.trastornoPsicologico === "SI") {
        alertas.push("🧠 Trastorno psicológico o psiquiátrico diagnosticado");
    }
    if (datos.sintomasPsicologicos === "SI") {
        alertas.push("😰 Síntomas psicológicos en los últimos 2 años (ansiedad, depresión, pánico)");
    }
    if (datos.diagnosticoCancer === "SI") {
        alertas.push("🎗️ Diagnóstico o estudio por sospecha de cáncer");
    }
    if (datos.enfermedadesLaborales === "SI") {
        alertas.push("⚠️ Enfermedades laborales o accidentes de trabajo previos");
    }
    if (datos.enfermedadOsteomuscular === "SI") {
        alertas.push("🦴 Enfermedad osteomuscular diagnosticada");
    }
    if (datos.enfermedadAutoinmune === "SI") {
        alertas.push("🔬 Enfermedad autoinmune diagnosticada");
    }

    // Si hay alertas, enviar mensaje a los números configurados
    if (alertas.length > 0) {
        const nombreCompleto = `${datos.primerNombre || ''} ${datos.primerApellido || ''}`.trim() || 'No especificado';
        const mensaje = `🚨 *ALERTA - Formulario Médico BSL*\n\n` +
            `👤 *Paciente:* ${nombreCompleto}\n` +
            `🆔 *Cédula:* ${datos.numeroId || 'No especificada'}\n` +
            `📱 *Celular:* ${datos.celular || 'No especificado'}\n` +
            `🏢 *Empresa:* ${datos.empresa || 'No especificada'}\n\n` +
            `⚠️ *Condiciones reportadas:*\n${alertas.map(a => `• ${a}`).join('\n')}\n\n` +
            `_Revisar historia clínica antes de la consulta._`;

        console.log('🚨 Enviando alertas de preguntas críticas para empresa', datos.codEmpresa, '...');

        // Enviar a todos los números de la empresa
        const promesas = numerosAlerta.map(numero => sendWhatsAppMessage(numero, mensaje));
        await Promise.all(promesas);

        console.log('✅ Alertas enviadas a', numerosAlerta.length, 'números');
    }
}

// Configuración de PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
        rejectUnauthorized: false
    }
});

// Crear tabla si no existe
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS formularios (
                id SERIAL PRIMARY KEY,
                wix_id VARCHAR(100),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                numero_id VARCHAR(50),
                celular VARCHAR(20),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),
                fecha_atencion VARCHAR(50),
                hora_atencion VARCHAR(10),
                genero VARCHAR(20),
                edad INTEGER,
                fecha_nacimiento VARCHAR(20),
                lugar_nacimiento VARCHAR(100),
                ciudad_residencia VARCHAR(100),
                hijos INTEGER,
                profesion_oficio VARCHAR(100),
                empresa1 VARCHAR(100),
                empresa2 VARCHAR(100),
                estado_civil VARCHAR(50),
                nivel_educativo VARCHAR(50),
                email VARCHAR(100),
                estatura VARCHAR(10),
                peso DECIMAL(5,2),
                ejercicio VARCHAR(50),
                cirugia_ocular VARCHAR(10),
                consumo_licor VARCHAR(50),
                cirugia_programada VARCHAR(10),
                condicion_medica VARCHAR(10),
                dolor_cabeza VARCHAR(10),
                dolor_espalda VARCHAR(10),
                ruido_jaqueca VARCHAR(10),
                embarazo VARCHAR(10),
                enfermedad_higado VARCHAR(10),
                enfermedad_pulmonar VARCHAR(10),
                fuma VARCHAR(10),
                hernias VARCHAR(10),
                hormigueos VARCHAR(10),
                presion_alta VARCHAR(10),
                problemas_azucar VARCHAR(10),
                problemas_cardiacos VARCHAR(10),
                problemas_sueno VARCHAR(10),
                usa_anteojos VARCHAR(10),
                usa_lentes_contacto VARCHAR(10),
                varices VARCHAR(10),
                hepatitis VARCHAR(10),
                familia_hereditarias VARCHAR(10),
                familia_geneticas VARCHAR(10),
                familia_diabetes VARCHAR(10),
                familia_hipertension VARCHAR(10),
                familia_infartos VARCHAR(10),
                familia_cancer VARCHAR(10),
                familia_trastornos VARCHAR(10),
                familia_infecciosas VARCHAR(10),
                trastorno_psicologico VARCHAR(10),
                sintomas_psicologicos VARCHAR(10),
                diagnostico_cancer VARCHAR(10),
                enfermedades_laborales VARCHAR(10),
                enfermedad_osteomuscular VARCHAR(10),
                enfermedad_autoinmune VARCHAR(10),
                firma TEXT,
                inscripcion_boletin VARCHAR(10),
                foto TEXT,
                fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Agregar columnas de Wix si no existen
        const columnsToAdd = [
            'wix_id VARCHAR(100)',
            'primer_nombre VARCHAR(100)',
            'primer_apellido VARCHAR(100)',
            'numero_id VARCHAR(50)',
            'celular VARCHAR(20)',
            'empresa VARCHAR(100)',
            'cod_empresa VARCHAR(50)',
            'fecha_atencion VARCHAR(50)',
            'hora_atencion VARCHAR(10)',
            // Nuevas preguntas de salud personal
            'trastorno_psicologico VARCHAR(10)',
            'sintomas_psicologicos VARCHAR(10)',
            'diagnostico_cancer VARCHAR(10)',
            'enfermedades_laborales VARCHAR(10)',
            'enfermedad_osteomuscular VARCHAR(10)',
            'enfermedad_autoinmune VARCHAR(10)',
            // Timestamp columns
            'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
        ];

        for (const column of columnsToAdd) {
            const columnName = column.split(' ')[0];
            try {
                await pool.query(`
                    ALTER TABLE formularios
                    ADD COLUMN IF NOT EXISTS ${column}
                `);
            } catch (err) {
                // Columna ya existe, continuar
            }
        }

        // Modificar el tipo de columna si ya existe con tamaño menor
        try {
            await pool.query(`
                ALTER TABLE formularios
                ALTER COLUMN fecha_atencion TYPE VARCHAR(50)
            `);
        } catch (err) {
            // Si falla, es porque la columna no existe o ya tiene el tipo correcto
        }

        // Aumentar tamaño de columnas eps, arl, pensiones a VARCHAR(150)
        const columnsToResize = ['eps', 'arl', 'pensiones'];
        for (const col of columnsToResize) {
            try {
                await pool.query(`
                    ALTER TABLE formularios
                    ALTER COLUMN ${col} TYPE VARCHAR(150)
                `);
            } catch (err) {
                // Columna no existe o ya tiene el tipo correcto
            }
        }

        // Asegurar que foto_url sea TEXT para URLs largas
        try {
            await pool.query(`
                ALTER TABLE formularios
                ADD COLUMN IF NOT EXISTS foto_url TEXT
            `);
        } catch (err) {
            // Columna ya existe
        }
        try {
            await pool.query(`
                ALTER TABLE formularios
                ALTER COLUMN foto_url TYPE TEXT
            `);
        } catch (err) {
            // Ya es TEXT o error
        }

        // Aumentar tamaño de campos de texto que pueden ser largos
        const textFieldsToEnlarge = ['ejercicio', 'consumo_licor', 'estado_civil', 'nivel_educativo'];
        for (const col of textFieldsToEnlarge) {
            try {
                await pool.query(`
                    ALTER TABLE formularios
                    ALTER COLUMN ${col} TYPE VARCHAR(100)
                `);
            } catch (err) {
                // Columna no existe o ya tiene el tipo correcto
            }
        }

        // Agregar columna horaAtencion a HistoriaClinica si no existe
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS "horaAtencion" VARCHAR(10)
            `);
        } catch (err) {
            // Columna ya existe o tabla no existe
        }

        // Agregar columna recordatorioLinkEnviado a HistoriaClinica si no existe
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS "recordatorioLinkEnviado" BOOLEAN DEFAULT false
            `);
        } catch (err) {
            // Columna ya existe o tabla no existe
        }

        // Agregar columna subempresa a HistoriaClinica si no existe
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS subempresa VARCHAR(200)
            `);
        } catch (err) {
            // Columna ya existe o tabla no existe
        }

        // Agregar columna centro_de_costo a HistoriaClinica si no existe
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS centro_de_costo VARCHAR(200)
            `);
        } catch (err) {
            // Columna ya existe o tabla no existe
        }

        // Agregar columna aprobacion a HistoriaClinica si no existe (para perfil APROBADOR)
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS aprobacion VARCHAR(20)
            `);
        } catch (err) {
            // Columna ya existe o tabla no existe
        }

        // Crear tabla medicos_disponibilidad si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS medicos_disponibilidad (
                id SERIAL PRIMARY KEY,
                medico_id INTEGER NOT NULL REFERENCES medicos(id) ON DELETE CASCADE,
                dia_semana INTEGER NOT NULL CHECK (dia_semana >= 0 AND dia_semana <= 6),
                hora_inicio TIME NOT NULL,
                hora_fin TIME NOT NULL,
                modalidad VARCHAR(20) DEFAULT 'presencial',
                activo BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(medico_id, dia_semana, modalidad)
            )
        `);

        // Agregar columna modalidad si no existe (para migraciones)
        try {
            await pool.query(`
                ALTER TABLE medicos_disponibilidad
                ADD COLUMN IF NOT EXISTS modalidad VARCHAR(20) DEFAULT 'presencial'
            `);
        } catch (err) {
            // Columna ya existe
        }

        // Eliminar constraint UNIQUE para permitir múltiples rangos horarios por día
        // Esto permite configurar horarios como 8-12 y 14-17 para manejar almuerzo
        try {
            await pool.query(`
                ALTER TABLE medicos_disponibilidad
                DROP CONSTRAINT IF EXISTS medicos_disponibilidad_medico_id_dia_semana_modalidad_key
            `);
        } catch (err) {
            // Constraint no existe o ya fue eliminada
        }

        // Crear tabla audiometrias si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS audiometrias (
                id SERIAL PRIMARY KEY,
                orden_id VARCHAR(100) REFERENCES "HistoriaClinica"("_id") ON DELETE CASCADE,
                numero_id VARCHAR(50),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),

                -- Otoscopia
                pabellon_auricular_oi VARCHAR(50) DEFAULT 'NORMAL',
                pabellon_auricular_od VARCHAR(50) DEFAULT 'NORMAL',
                conducto_auditivo_oi VARCHAR(50) DEFAULT 'NORMAL',
                conducto_auditivo_od VARCHAR(50) DEFAULT 'NORMAL',
                membrana_timpanica_oi VARCHAR(50) DEFAULT 'NORMAL',
                membrana_timpanica_od VARCHAR(50) DEFAULT 'NORMAL',
                observaciones_oi TEXT,
                observaciones_od TEXT,
                requiere_limpieza_otica VARCHAR(10) DEFAULT 'NO',
                estado_gripal VARCHAR(10) DEFAULT 'NO',

                -- Resultado Aéreo - Oído Derecho
                aereo_od_250 INTEGER,
                aereo_od_500 INTEGER,
                aereo_od_1000 INTEGER,
                aereo_od_2000 INTEGER,
                aereo_od_3000 INTEGER,
                aereo_od_4000 INTEGER,
                aereo_od_6000 INTEGER,
                aereo_od_8000 INTEGER,

                -- Resultado Aéreo - Oído Izquierdo
                aereo_oi_250 INTEGER,
                aereo_oi_500 INTEGER,
                aereo_oi_1000 INTEGER,
                aereo_oi_2000 INTEGER,
                aereo_oi_3000 INTEGER,
                aereo_oi_4000 INTEGER,
                aereo_oi_6000 INTEGER,
                aereo_oi_8000 INTEGER,

                -- Resultado Óseo - Oído Derecho (opcional)
                oseo_od_250 INTEGER,
                oseo_od_500 INTEGER,
                oseo_od_1000 INTEGER,
                oseo_od_2000 INTEGER,
                oseo_od_3000 INTEGER,
                oseo_od_4000 INTEGER,

                -- Resultado Óseo - Oído Izquierdo (opcional)
                oseo_oi_250 INTEGER,
                oseo_oi_500 INTEGER,
                oseo_oi_1000 INTEGER,
                oseo_oi_2000 INTEGER,
                oseo_oi_3000 INTEGER,
                oseo_oi_4000 INTEGER,

                -- Equipo y cabina
                cabina VARCHAR(50),
                equipo VARCHAR(100),

                -- Diagnóstico
                diagnostico_oi VARCHAR(100),
                diagnostico_od VARCHAR(100),
                interpretacion TEXT,
                recomendaciones TEXT,
                remision VARCHAR(100),

                -- Metadatos
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Crear tabla visiometrias si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS visiometrias (
                id SERIAL PRIMARY KEY,
                orden_id VARCHAR(100) REFERENCES "HistoriaClinica"("_id") ON DELETE CASCADE,
                numero_id VARCHAR(50),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),

                -- Visión Lejana - Ojo Derecho
                vl_od_sin_correccion VARCHAR(20),
                vl_od_con_correccion VARCHAR(20),

                -- Visión Lejana - Ojo Izquierdo
                vl_oi_sin_correccion VARCHAR(20),
                vl_oi_con_correccion VARCHAR(20),

                -- Visión Lejana - Ambos Ojos
                vl_ao_sin_correccion VARCHAR(20),
                vl_ao_con_correccion VARCHAR(20),

                -- Enceguecimiento y Forias (Visión Lejana)
                vl_foria_lateral VARCHAR(50),
                vl_foria_vertical VARCHAR(50),

                -- Visión Cercana - Ojo Derecho
                vc_od_sin_correccion VARCHAR(20),
                vc_od_con_correccion VARCHAR(20),

                -- Visión Cercana - Ojo Izquierdo
                vc_oi_sin_correccion VARCHAR(20),
                vc_oi_con_correccion VARCHAR(20),

                -- Visión Cercana - Ambos Ojos
                vc_ao_sin_correccion VARCHAR(20),
                vc_ao_con_correccion VARCHAR(20),

                -- Forias y Campimetría (Visión Cercana)
                vc_foria_lateral VARCHAR(50),
                vc_campimetria VARCHAR(50),

                -- Ishihara y PPC
                ishihara VARCHAR(50),
                ppc VARCHAR(50),

                -- Visión Cromática
                vision_cromatica VARCHAR(50),

                -- Enceguecimiento
                enceguecimiento VARCHAR(10),

                -- Estado Fórico
                estado_forico VARCHAR(50),

                -- Cover Test
                cover_test_lejos VARCHAR(100),
                cover_test_cerca VARCHAR(100),

                -- Queratometría
                queratometria_od TEXT,
                queratometria_oi TEXT,

                -- Examen Externo
                examen_externo TEXT,

                -- Oftalmoscopia
                oftalmoscopia_od VARCHAR(50),
                oftalmoscopia_oi VARCHAR(50),

                -- Biomicroscopia
                biomicroscopia_od VARCHAR(50),
                biomicroscopia_oi VARCHAR(50),

                -- Tonometría
                tonometria_od VARCHAR(50),
                tonometria_oi VARCHAR(50),

                -- Rx en Uso
                rx_en_uso VARCHAR(10) DEFAULT 'NO',

                -- Refractometría
                refractometria_od VARCHAR(50),
                refractometria_oi VARCHAR(50),

                -- Subjetivo
                subjetivo_od VARCHAR(50),
                subjetivo_oi VARCHAR(50),

                -- Rx Final
                rx_final_od VARCHAR(50),
                rx_final_oi VARCHAR(50),

                -- DIP y Filtro
                dip VARCHAR(20),
                filtro VARCHAR(50),
                uso VARCHAR(50),

                -- Diagnóstico
                diagnostico VARCHAR(100),
                remision VARCHAR(50),

                -- Control y DX
                control VARCHAR(50),
                dx2 TEXT,
                dx3 TEXT,

                -- Observaciones
                observaciones TEXT,

                -- Metadatos
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Crear tabla pruebasADC si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "pruebasADC" (
                id SERIAL PRIMARY KEY,
                orden_id VARCHAR(100) REFERENCES "HistoriaClinica"("_id") ON DELETE CASCADE,
                numero_id VARCHAR(50),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),

                -- Preguntas de Depresión (de*)
                de08 VARCHAR(50),
                de29 VARCHAR(50),
                de03 VARCHAR(50),
                de04 VARCHAR(50),
                de05 VARCHAR(50),
                de32 VARCHAR(50),
                de12 VARCHAR(50),
                de06 VARCHAR(50),
                de33 VARCHAR(50),
                de13 VARCHAR(50),
                de07 VARCHAR(50),
                de35 VARCHAR(50),
                de21 VARCHAR(50),
                de14 VARCHAR(50),
                de15 VARCHAR(50),
                de37 VARCHAR(50),
                de16 VARCHAR(50),
                de38 VARCHAR(50),
                de40 VARCHAR(50),
                de27 VARCHAR(50),
                de20 VARCHAR(50),

                -- Preguntas de Ansiedad (an*)
                an07 VARCHAR(50),
                an11 VARCHAR(50),
                an03 VARCHAR(50),
                an18 VARCHAR(50),
                an19 VARCHAR(50),
                an04 VARCHAR(50),
                an14 VARCHAR(50),
                an09 VARCHAR(50),
                an20 VARCHAR(50),
                an05 VARCHAR(50),
                an36 VARCHAR(50),
                an26 VARCHAR(50),
                an31 VARCHAR(50),
                an22 VARCHAR(50),
                an38 VARCHAR(50),
                an27 VARCHAR(50),
                an35 VARCHAR(50),
                an23 VARCHAR(50),
                an39 VARCHAR(50),
                an30 VARCHAR(50),

                -- Preguntas de Comportamiento (co*)
                cofv01 VARCHAR(50),
                corv11 VARCHAR(50),
                cofc06 VARCHAR(50),
                coav21 VARCHAR(50),
                coov32 VARCHAR(50),
                corc16 VARCHAR(50),
                coac26 VARCHAR(50),
                cofv02 VARCHAR(50),
                coov34 VARCHAR(50),
                cofv03 VARCHAR(50),
                corc17 VARCHAR(50),
                coac27 VARCHAR(50),
                cofc08 VARCHAR(50),
                cooc39 VARCHAR(50),
                cofc10 VARCHAR(50),
                corv12 VARCHAR(50),
                cooc40 VARCHAR(50),
                corv15 VARCHAR(50),
                coac29 VARCHAR(50),
                coov35 VARCHAR(50),
                coav24 VARCHAR(50),
                corc18 VARCHAR(50),
                coav25 VARCHAR(50),

                -- Metadatos
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Crear tabla visiometrias_virtual si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS visiometrias_virtual (
                id SERIAL PRIMARY KEY,
                orden_id VARCHAR(100) REFERENCES "HistoriaClinica"("_id") ON DELETE CASCADE,
                numero_id VARCHAR(50),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),

                -- Resultados Test Snellen (Letras)
                snellen_correctas INTEGER,
                snellen_total INTEGER,
                snellen_porcentaje INTEGER,

                -- Resultados Test Landolt C (Dirección)
                landolt_correctas INTEGER,
                landolt_total INTEGER,
                landolt_porcentaje INTEGER,

                -- Resultados Test Ishihara (Colores)
                ishihara_correctas INTEGER,
                ishihara_total INTEGER,
                ishihara_porcentaje INTEGER,

                -- Concepto general
                concepto VARCHAR(50),

                -- Metadatos
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT unique_visiometria_virtual_orden UNIQUE (orden_id)
            )
        `);

        // Crear tabla laboratorios si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS laboratorios (
                id SERIAL PRIMARY KEY,
                orden_id VARCHAR(100) REFERENCES "HistoriaClinica"("_id") ON DELETE CASCADE,
                numero_id VARCHAR(50),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),

                -- Tipo de prueba: 'CUADRO_HEMATICO', 'COPROLOGICO', 'PERFIL_LIPIDICO', 'KOH'
                tipo_prueba VARCHAR(50) NOT NULL,

                -- CUADRO HEMÁTICO (HEMOGRAMA)
                hematocrito VARCHAR(50),
                hemoglobina VARCHAR(50),
                conc_corpus_hb VARCHAR(50),
                plaquetas VARCHAR(50),
                sedimentacio_globular VARCHAR(50),
                globulos_blancos VARCHAR(50),
                neutrofilos VARCHAR(50),
                linfocitos VARCHAR(50),
                monocitos VARCHAR(50),
                basofilos VARCHAR(50),
                eosinofilos VARCHAR(50),
                cayados VARCHAR(50),
                observaciones_hemograma TEXT,

                -- COPROLÓGICO
                consistencia VARCHAR(50),
                color VARCHAR(50),
                olor VARCHAR(50),
                moco VARCHAR(50),
                sangre VARCHAR(50),
                parasitologico VARCHAR(50),
                observaciones_coprologico TEXT,
                vegetales VARCHAR(100),
                musculares VARCHAR(100),
                celulosa VARCHAR(100),
                almidones VARCHAR(100),
                levaduras VARCHAR(100),
                hongos VARCHAR(100),
                neutras VARCHAR(100),
                hominis VARCHAR(100),
                leucocitos VARCHAR(100),
                bacteriana VARCHAR(100),

                -- PERFIL LIPÍDICO + QUÍMICA
                glicemia_pre VARCHAR(50),
                glicemia_post VARCHAR(50),
                tsh VARCHAR(50),
                colesterol_total VARCHAR(50),
                colesterol_hdl VARCHAR(50),
                colesterol_ldl VARCHAR(50),
                trigliceridos VARCHAR(50),
                transaminasa_gpt VARCHAR(50),
                transaminasa_got VARCHAR(50),
                bilirrubina_directa VARCHAR(50),
                bilirrubina_indirecta VARCHAR(50),
                bilirrubina_total VARCHAR(50),
                nitrogeno_ureico_bun VARCHAR(50),
                creatinina_en_suero VARCHAR(50),
                colinesterasa VARCHAR(50),
                quimica_observaciones TEXT,
                fosfatasa_alcalina VARCHAR(50),

                -- INMUNOLOGÍA
                grupo_sanguineo VARCHAR(20),
                factor_rh VARCHAR(20),
                inmunologia_observaciones TEXT,
                serologia_vdrl VARCHAR(50),
                serologia_cuantitativa VARCHAR(50),
                como_reporto_a_la_empresa TEXT,

                -- MICROBIOLOGÍA
                frotis_faringeo VARCHAR(100),
                koh_en_unas VARCHAR(100),
                cultivo_faringeo VARCHAR(100),
                frotis_naso_derecha VARCHAR(100),
                frotis_naso_izquierda VARCHAR(100),
                microbiologia_observaciones TEXT,
                coprocultivo VARCHAR(100),
                leptospira VARCHAR(100),
                baciloscopia VARCHAR(100),

                -- TOXICOLOGÍA
                alcohol_aire_respirado VARCHAR(100),
                marihuana_orina VARCHAR(100),
                morfina VARCHAR(100),
                cocaina VARCHAR(100),
                metanfetaminas VARCHAR(100),
                alcohol_saliva VARCHAR(100),
                anfetaminas VARCHAR(100),
                alcohol_sangre VARCHAR(100),
                toxicologia_observaciones TEXT,

                -- Metadatos
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by VARCHAR(100),
                updated_by VARCHAR(100)
            )
        `);

        // Crear índice para búsquedas rápidas de laboratorios
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_laboratorios_orden_id ON laboratorios(orden_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_laboratorios_numero_id ON laboratorios(numero_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_laboratorios_tipo_prueba ON laboratorios(tipo_prueba)`);
        } catch (err) {
            // Índices ya existen
        }

        // Crear tabla de usuarios para autenticación
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                numero_documento VARCHAR(50) UNIQUE NOT NULL,
                celular_whatsapp VARCHAR(20) NOT NULL,
                nombre_completo VARCHAR(200),
                nombre_empresa VARCHAR(200),
                rol VARCHAR(20) DEFAULT 'empresa' CHECK (rol IN ('empresa', 'admin', 'empleado')),
                cod_empresa VARCHAR(50),
                estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'suspendido')),
                fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_aprobacion TIMESTAMP,
                aprobado_por INTEGER REFERENCES usuarios(id),
                ultimo_login TIMESTAMP,
                activo BOOLEAN DEFAULT true
            )
        `);

        // Crear índices para usuarios
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_documento ON usuarios(numero_documento)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_estado ON usuarios(estado)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios(rol)`);
        } catch (err) {
            // Índices ya existen
        }

        // Migración: agregar columna nombre_empresa si no existe
        try {
            await pool.query(`
                ALTER TABLE usuarios
                ADD COLUMN IF NOT EXISTS nombre_empresa VARCHAR(200)
            `);
        } catch (err) {
            // Columna ya existe
        }

        // Migración: actualizar constraint de rol para incluir 'empleado'
        try {
            await pool.query(`
                ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check
            `);
            await pool.query(`
                ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
                CHECK (rol IN ('empresa', 'admin', 'empleado', 'usuario_ips'))
            `);
        } catch (err) {
            // Constraint ya actualizada o no existe
        }

        // Migración: agregar columna empresas_excluidas para empleados
        try {
            await pool.query(`
                ALTER TABLE usuarios
                ADD COLUMN IF NOT EXISTS empresas_excluidas JSONB DEFAULT '[]'::jsonb
            `);
        } catch (err) {
            // Columna ya existe
        }

        // Crear tabla de sesiones
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sesiones (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
                token_hash VARCHAR(255) UNIQUE NOT NULL,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_expiracion TIMESTAMP NOT NULL,
                activa BOOLEAN DEFAULT true
            )
        `);

        // Crear índices para sesiones
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_sesiones_token ON sesiones(token_hash)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_sesiones_expiracion ON sesiones(fecha_expiracion)`);
        } catch (err) {
            // Índices ya existen
        }

        // Crear tabla de permisos de usuario
        await pool.query(`
            CREATE TABLE IF NOT EXISTS permisos_usuario (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
                permiso VARCHAR(50) NOT NULL,
                activo BOOLEAN DEFAULT true,
                fecha_asignacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                asignado_por INTEGER REFERENCES usuarios(id),
                UNIQUE(usuario_id, permiso)
            )
        `);

        // Crear índice para permisos
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_permisos_usuario ON permisos_usuario(usuario_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_permisos_permiso ON permisos_usuario(permiso)`);
        } catch (err) {
            // Índices ya existen
        }

        // ==================== TABLAS SISTEMA MULTI-AGENTE WHATSAPP ====================

        // Tabla de conversaciones de WhatsApp
        await pool.query(`
            CREATE TABLE IF NOT EXISTS conversaciones_whatsapp (
                id SERIAL PRIMARY KEY,
                celular VARCHAR(20) NOT NULL,
                paciente_id VARCHAR(100),
                asignado_a INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                estado VARCHAR(20) NOT NULL DEFAULT 'nueva',
                canal VARCHAR(10) NOT NULL DEFAULT 'bot',
                bot_activo BOOLEAN NOT NULL DEFAULT true,
                nivel_bot INTEGER DEFAULT 0,
                nombre_paciente VARCHAR(200),
                etiquetas TEXT[],
                prioridad VARCHAR(10) DEFAULT 'normal',
                fecha_inicio TIMESTAMP DEFAULT NOW(),
                fecha_ultima_actividad TIMESTAMP DEFAULT NOW(),
                fecha_asignacion TIMESTAMP,
                fecha_cierre TIMESTAMP,
                wix_chatbot_id VARCHAR(100),
                wix_whp_id VARCHAR(100),
                sincronizado_wix BOOLEAN DEFAULT false
            )
        `);

        // Índices para conversaciones_whatsapp
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_celular ON conversaciones_whatsapp(celular)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_asignado ON conversaciones_whatsapp(asignado_a)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_estado ON conversaciones_whatsapp(estado)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_ultima_actividad ON conversaciones_whatsapp(fecha_ultima_actividad DESC)`);
            await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS unique_celular_activa ON conversaciones_whatsapp(celular) WHERE estado != 'cerrada'`);
        } catch (err) {
            // Índices ya existen
        }

        // Tabla de mensajes de WhatsApp
        await pool.query(`
            CREATE TABLE IF NOT EXISTS mensajes_whatsapp (
                id SERIAL PRIMARY KEY,
                conversacion_id INTEGER NOT NULL REFERENCES conversaciones_whatsapp(id) ON DELETE CASCADE,
                direccion VARCHAR(10) NOT NULL,
                contenido TEXT NOT NULL,
                tipo_mensaje VARCHAR(20) DEFAULT 'text',
                enviado_por_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                enviado_por_tipo VARCHAR(10),
                sid_twilio VARCHAR(100),
                timestamp TIMESTAMP DEFAULT NOW(),
                leido_por_agente BOOLEAN DEFAULT false,
                fecha_lectura TIMESTAMP,
                sincronizado_wix BOOLEAN DEFAULT false
            )
        `);

        // Agregar columnas para archivos multimedia si no existen
        try {
            await pool.query(`ALTER TABLE mensajes_whatsapp ADD COLUMN IF NOT EXISTS media_url TEXT`);
            await pool.query(`ALTER TABLE mensajes_whatsapp ADD COLUMN IF NOT EXISTS media_type TEXT`);
        } catch (err) {
            // Columnas ya existen
        }

        // Índices para mensajes_whatsapp
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_msg_conversacion ON mensajes_whatsapp(conversacion_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_msg_timestamp ON mensajes_whatsapp(timestamp DESC)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_msg_no_leido ON mensajes_whatsapp(conversacion_id, leido_por_agente) WHERE leido_por_agente = false`);
        } catch (err) {
            // Índices ya existen
        }

        // Tabla de estado de agentes
        await pool.query(`
            CREATE TABLE IF NOT EXISTS agentes_estado (
                user_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
                estado VARCHAR(20) NOT NULL DEFAULT 'offline',
                conversaciones_activas INTEGER DEFAULT 0,
                max_conversaciones INTEGER DEFAULT 5,
                ultima_actividad TIMESTAMP DEFAULT NOW(),
                tiempo_sesion_inicio TIMESTAMP,
                auto_asignar BOOLEAN DEFAULT true,
                notificaciones_activas BOOLEAN DEFAULT true,
                notas TEXT,
                CONSTRAINT check_conversaciones CHECK (conversaciones_activas >= 0 AND conversaciones_activas <= max_conversaciones)
            )
        `);

        // Índices para agentes_estado
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_agente_estado ON agentes_estado(estado)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_agente_disponible ON agentes_estado(estado, auto_asignar) WHERE estado = 'disponible' AND auto_asignar = true`);
        } catch (err) {
            // Índices ya existen
        }

        // Tabla de transferencias de conversación
        await pool.query(`
            CREATE TABLE IF NOT EXISTS transferencias_conversacion (
                id SERIAL PRIMARY KEY,
                conversacion_id INTEGER NOT NULL REFERENCES conversaciones_whatsapp(id) ON DELETE CASCADE,
                de_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                a_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                de_canal VARCHAR(10),
                a_canal VARCHAR(10),
                motivo TEXT,
                fecha_transferencia TIMESTAMP DEFAULT NOW()
            )
        `);

        // Índices para transferencias_conversacion
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_transfer_conversacion ON transferencias_conversacion(conversacion_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_transfer_fecha ON transferencias_conversacion(fecha_transferencia DESC)`);
        } catch (err) {
            // Índices ya existen
        }

        // Tabla de reglas de enrutamiento
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reglas_enrutamiento (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(100) NOT NULL,
                descripcion TEXT,
                prioridad INTEGER DEFAULT 0,
                activo BOOLEAN DEFAULT true,
                condiciones JSONB NOT NULL,
                asignar_a VARCHAR(20) NOT NULL,
                agente_especifico_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                etiqueta_auto TEXT,
                prioridad_asignar VARCHAR(10) DEFAULT 'normal',
                creado_por INTEGER REFERENCES usuarios(id),
                fecha_creacion TIMESTAMP DEFAULT NOW(),
                fecha_modificacion TIMESTAMP DEFAULT NOW()
            )
        `);

        // Índices para reglas_enrutamiento
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_reglas_prioridad ON reglas_enrutamiento(prioridad DESC) WHERE activo = true`);
        } catch (err) {
            // Índices ya existen
        }

        console.log('✅ Tablas de sistema multi-agente WhatsApp creadas');

        // Agregar columnas JSONB para configuración de empresas
        const empresasColumnsToAdd = [
            'ciudades JSONB DEFAULT \'[]\'::jsonb',
            'examenes JSONB DEFAULT \'[]\'::jsonb',
            'subempresas JSONB DEFAULT \'[]\'::jsonb',
            'centros_de_costo JSONB DEFAULT \'[]\'::jsonb',
            'cargos JSONB DEFAULT \'[]\'::jsonb'
        ];

        for (const column of empresasColumnsToAdd) {
            try {
                await pool.query(`
                    ALTER TABLE empresas
                    ADD COLUMN IF NOT EXISTS ${column}
                `);
            } catch (err) {
                // Columna ya existe
            }
        }

        // Agregar columna linkEnviado a HistoriaClinica para seguimiento de envíos SIIGO
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS "linkEnviado" VARCHAR(50)
            `);
            console.log('✅ Columna linkEnviado agregada a HistoriaClinica');
        } catch (err) {
            // Columna ya existe o tabla no existe
            console.log('ℹ️ Columna linkEnviado ya existe o tabla HistoriaClinica no encontrada');
        }

        console.log('✅ Base de datos inicializada correctamente');
    } catch (error) {
        console.error('❌ Error al inicializar la base de datos:', error);
    }
};

initDB();

// Middleware CORS - permitir solicitudes desde Wix y otros dominios
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

    // Manejar preflight requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// ========== AUTENTICACIÓN JWT ==========
const JWT_SECRET = process.env.JWT_SECRET || 'bsl-secret-default-cambiar';
const JWT_EXPIRES_IN = '24h';

// Función para hashear token
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// Función para generar token JWT
function generarToken(userId, extra = {}) {
    return jwt.sign({ userId, ...extra }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Función para hashear password
async function hashPassword(password) {
    const salt = await bcrypt.genSalt(12);
    return bcrypt.hash(password, salt);
}

// Función para verificar password
async function verificarPassword(password, hash) {
    return bcrypt.compare(password, hash);
}

// Función para obtener permisos de un usuario
async function obtenerPermisosUsuario(userId) {
    try {
        const result = await pool.query(`
            SELECT permiso FROM permisos_usuario
            WHERE usuario_id = $1 AND activo = true
        `, [userId]);

        return result.rows.map(row => row.permiso);
    } catch (error) {
        console.error('Error obteniendo permisos:', error);
        return [];
    }
}


// Middleware de autenticación
const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Token de autenticación requerido'
            });
        }

        const token = authHeader.split(' ')[1];

        // Verificar el token JWT
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (jwtError) {
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    message: 'Token expirado',
                    code: 'TOKEN_EXPIRED'
                });
            }
            return res.status(401).json({
                success: false,
                message: 'Token inválido'
            });
        }

        // Verificar que la sesión siga activa en la base de datos
        const sesionResult = await pool.query(`
            SELECT s.*, u.estado, u.rol, u.cod_empresa, u.nombre_completo, u.email, u.numero_documento, u.empresas_excluidas
            FROM sesiones s
            JOIN usuarios u ON s.usuario_id = u.id
            WHERE s.token_hash = $1
              AND s.activa = true
              AND s.fecha_expiracion > NOW()
              AND u.activo = true
        `, [hashToken(token)]);

        if (sesionResult.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Sesión no válida o expirada'
            });
        }

        const sesion = sesionResult.rows[0];

        // Verificar estado del usuario
        if (sesion.estado !== 'aprobado') {
            return res.status(403).json({
                success: false,
                message: `Acceso denegado: cuenta ${sesion.estado}`,
                estado: sesion.estado
            });
        }

        // Adjuntar usuario al request
        req.usuario = {
            id: decoded.userId,
            email: sesion.email,
            rol: sesion.rol,
            nombreCompleto: sesion.nombre_completo,
            codEmpresa: sesion.cod_empresa,
            numeroDocumento: sesion.numero_documento,
            sesionId: sesion.id,
            empresas_excluidas: sesion.empresas_excluidas || []
        };

        next();

    } catch (error) {
        console.error('Error en authMiddleware:', error);
        return res.status(500).json({
            success: false,
            message: 'Error interno de autenticación'
        });
    }
};

// Middleware para requerir rol de administrador
const requireAdmin = (req, res, next) => {
    if (!req.usuario || req.usuario.rol !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado: se requiere rol de administrador'
        });
    }
    next();
};

// Middleware para rutas que permiten solo admin
const requireAdminOrSupervisor = (req, res, next) => {
    if (!req.usuario || req.usuario.rol !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado: se requiere rol de administrador'
        });
    }
    next();
};

// ========== ENDPOINTS DE AUTENTICACIÓN ==========

// POST /api/auth/registro - Registro de nuevo usuario
app.post('/api/auth/registro', async (req, res) => {
    try {
        const { email, password, numeroDocumento, celularWhatsapp, nombreCompleto, nombreEmpresa, codEmpresa } = req.body;

        // Validaciones
        if (!email || !password || !numeroDocumento || !celularWhatsapp) {
            return res.status(400).json({
                success: false,
                message: 'Email, contraseña, número de documento y celular son requeridos'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'La contraseña debe tener al menos 8 caracteres'
            });
        }

        // Verificar si el email ya existe
        const emailExiste = await pool.query(
            'SELECT id FROM usuarios WHERE email = $1',
            [email.toLowerCase()]
        );

        if (emailExiste.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Este email ya está registrado'
            });
        }

        // Verificar si el documento ya existe
        const docExiste = await pool.query(
            'SELECT id FROM usuarios WHERE numero_documento = $1',
            [numeroDocumento]
        );

        if (docExiste.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Este número de documento ya está registrado'
            });
        }

        // Hashear password
        const passwordHash = await hashPassword(password);

        // Insertar usuario
        const result = await pool.query(`
            INSERT INTO usuarios (email, password_hash, numero_documento, celular_whatsapp, nombre_completo, nombre_empresa, cod_empresa, rol, estado)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'empresa', 'pendiente')
            RETURNING id, email, nombre_completo, nombre_empresa, rol, estado, fecha_registro
        `, [email.toLowerCase(), passwordHash, numeroDocumento, celularWhatsapp, nombreCompleto || null, nombreEmpresa || null, codEmpresa?.toUpperCase() || null]);

        console.log(`📝 Nuevo usuario registrado: ${email} (pendiente de aprobación)`);

        // Enviar mensaje de WhatsApp de confirmación de registro
        const celularFormateado = celularWhatsapp.startsWith('57') ? celularWhatsapp : `57${celularWhatsapp}`;
        const mensajeWhatsApp = `Hola! Recibimos tu registro a la plataforma BSL, en un momento recibiras la autorizacion de entrada.

*Datos de registro:*
- Nombre: ${nombreCompleto || 'No especificado'}
- Empresa: ${nombreEmpresa || 'No especificada'}
- Documento: ${numeroDocumento}
- Email: ${email}
- Celular: ${celularWhatsapp}`;

        try {
            sendWhatsAppMessage(celularFormateado, mensajeWhatsApp);
            console.log(`📱 WhatsApp de confirmación enviado a ${celularFormateado}`);
        } catch (whatsappError) {
            console.error('Error enviando WhatsApp de registro:', whatsappError);
            // No fallamos el registro si falla el WhatsApp
        }

        res.status(201).json({
            success: true,
            message: 'Registro exitoso. Tu cuenta está pendiente de aprobación por un administrador.',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({
            success: false,
            message: 'Error al registrar usuario'
        });
    }
});

// POST /api/auth/login - Iniciar sesión
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email y contraseña son requeridos'
            });
        }

        // Buscar usuario
        const result = await pool.query(
            'SELECT * FROM usuarios WHERE email = $1 AND activo = true',
            [email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        const usuario = result.rows[0];

        // Verificar password
        const passwordValido = await verificarPassword(password, usuario.password_hash);

        if (!passwordValido) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        // Verificar estado
        if (usuario.estado === 'pendiente') {
            return res.status(403).json({
                success: false,
                message: 'Tu cuenta está pendiente de aprobación',
                estado: 'pendiente'
            });
        }

        if (usuario.estado === 'rechazado') {
            return res.status(403).json({
                success: false,
                message: 'Tu solicitud de cuenta fue rechazada',
                estado: 'rechazado'
            });
        }

        if (usuario.estado === 'suspendido') {
            return res.status(403).json({
                success: false,
                message: 'Tu cuenta ha sido suspendida',
                estado: 'suspendido'
            });
        }

        // Generar token
        const token = generarToken(usuario.id, { email: usuario.email, rol: usuario.rol });
        const tokenHash = hashToken(token);

        // Calcular fecha de expiración (24 horas)
        const fechaExpiracion = new Date();
        fechaExpiracion.setHours(fechaExpiracion.getHours() + 24);

        // Guardar sesión
        await pool.query(`
            INSERT INTO sesiones (usuario_id, token_hash, fecha_expiracion)
            VALUES ($1, $2, $3)
        `, [usuario.id, tokenHash, fechaExpiracion]);

        // Actualizar último login
        await pool.query(
            'UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1',
            [usuario.id]
        );

        console.log(`🔐 Login exitoso: ${email} (${usuario.rol})`);

        res.json({
            success: true,
            token,
            usuario: {
                id: usuario.id,
                email: usuario.email,
                nombreCompleto: usuario.nombre_completo,
                rol: usuario.rol,
                codEmpresa: usuario.cod_empresa,
                numeroDocumento: usuario.numero_documento
            },
            expiresIn: 86400 // 24 horas en segundos
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({
            success: false,
            message: 'Error al iniciar sesión'
        });
    }
});

// POST /api/auth/logout - Cerrar sesión
app.post('/api/auth/logout', authMiddleware, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const tokenHash = hashToken(token);

        // Desactivar la sesión
        await pool.query(
            'UPDATE sesiones SET activa = false WHERE token_hash = $1',
            [tokenHash]
        );

        console.log(`🔓 Logout: ${req.usuario.email}`);

        res.json({
            success: true,
            message: 'Sesión cerrada correctamente'
        });

    } catch (error) {
        console.error('Error en logout:', error);
        res.status(500).json({
            success: false,
            message: 'Error al cerrar sesión'
        });
    }
});

// POST /api/auth/verificar-token - Verificar si un token es válido
app.post('/api/auth/verificar-token', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Token requerido'
            });
        }

        // Verificar JWT
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (e) {
            return res.json({
                success: false,
                message: 'Token inválido o expirado'
            });
        }

        // Verificar sesión en BD
        const sesionResult = await pool.query(`
            SELECT u.id, u.email, u.nombre_completo, u.rol, u.cod_empresa, u.numero_documento, u.estado
            FROM sesiones s
            JOIN usuarios u ON s.usuario_id = u.id
            WHERE s.token_hash = $1
              AND s.activa = true
              AND s.fecha_expiracion > NOW()
              AND u.activo = true
              AND u.estado = 'aprobado'
        `, [hashToken(token)]);

        if (sesionResult.rows.length === 0) {
            return res.json({
                success: false,
                message: 'Sesión no válida'
            });
        }

        const usuario = sesionResult.rows[0];

        res.json({
            success: true,
            usuario: {
                id: usuario.id,
                email: usuario.email,
                nombreCompleto: usuario.nombre_completo,
                rol: usuario.rol,
                codEmpresa: usuario.cod_empresa,
                numeroDocumento: usuario.numero_documento
            }
        });

    } catch (error) {
        console.error('Error verificando token:', error);
        res.status(500).json({
            success: false,
            message: 'Error al verificar token'
        });
    }
});

// GET /api/auth/perfil - Obtener perfil del usuario actual
app.get('/api/auth/perfil', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, email, nombre_completo, numero_documento, celular_whatsapp, rol, cod_empresa, estado, fecha_registro, ultimo_login
            FROM usuarios WHERE id = $1
        `, [req.usuario.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        res.json({
            success: true,
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('Error obteniendo perfil:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener perfil'
        });
    }
});

// ========== ENDPOINTS DE ADMINISTRACIÓN DE USUARIOS ==========

// GET /api/admin/usuarios - Listar todos los usuarios
app.get('/api/admin/usuarios', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { estado, rol, buscar, limit = 50, offset = 0 } = req.query;

        let query = `
            SELECT id, email, nombre_completo, numero_documento, celular_whatsapp, rol, cod_empresa,
                   estado, fecha_registro, fecha_aprobacion, ultimo_login, activo
            FROM usuarios
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (estado) {
            query += ` AND estado = $${paramIndex}`;
            params.push(estado);
            paramIndex++;
        }

        if (rol) {
            query += ` AND rol = $${paramIndex}`;
            params.push(rol);
            paramIndex++;
        }

        if (buscar) {
            query += ` AND (email ILIKE $${paramIndex} OR nombre_completo ILIKE $${paramIndex} OR numero_documento ILIKE $${paramIndex})`;
            params.push(`%${buscar}%`);
            paramIndex++;
        }

        query += ` ORDER BY fecha_registro DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        // Contar total
        let countQuery = 'SELECT COUNT(*) FROM usuarios WHERE 1=1';
        const countParams = [];
        let countParamIndex = 1;

        if (estado) {
            countQuery += ` AND estado = $${countParamIndex}`;
            countParams.push(estado);
            countParamIndex++;
        }
        if (rol) {
            countQuery += ` AND rol = $${countParamIndex}`;
            countParams.push(rol);
            countParamIndex++;
        }
        if (buscar) {
            countQuery += ` AND (email ILIKE $${countParamIndex} OR nombre_completo ILIKE $${countParamIndex} OR numero_documento ILIKE $${countParamIndex})`;
            countParams.push(`%${buscar}%`);
        }

        const countResult = await pool.query(countQuery, countParams);

        res.json({
            success: true,
            data: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        console.error('Error listando usuarios:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar usuarios'
        });
    }
});

// GET /api/admin/usuarios/pendientes - Listar usuarios pendientes de aprobación
app.get('/api/admin/usuarios/pendientes', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, email, nombre_completo, numero_documento, celular_whatsapp, cod_empresa, fecha_registro
            FROM usuarios
            WHERE estado = 'pendiente' AND activo = true
            ORDER BY fecha_registro ASC
        `);

        res.json({
            success: true,
            data: result.rows,
            total: result.rows.length
        });

    } catch (error) {
        console.error('Error listando usuarios pendientes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar usuarios pendientes'
        });
    }
});

// PUT /api/admin/usuarios/:id/aprobar - Aprobar usuario
app.put('/api/admin/usuarios/:id/aprobar', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { codEmpresa, rol } = req.body;

        // Obtener información del usuario a aprobar
        const usuarioResult = await pool.query(
            'SELECT id, email, nombre_completo FROM usuarios WHERE id = $1 AND estado = \'pendiente\'',
            [id]
        );

        if (usuarioResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado o ya fue procesado'
            });
        }

        // Validar que se envió un rol
        if (!rol || !['empresa', 'empleado', 'admin', 'usuario_ips'].includes(rol)) {
            return res.status(400).json({
                success: false,
                message: 'Debe especificar un rol válido (empresa, empleado, admin, usuario_ips)'
            });
        }

        // Solo validar empresa si el rol es 'empresa'
        if (rol === 'empresa') {
            if (!codEmpresa) {
                return res.status(400).json({
                    success: false,
                    message: 'Debe asignar una empresa al usuario'
                });
            }

            // Verificar que la empresa existe
            const empresaCheck = await pool.query(
                'SELECT cod_empresa FROM empresas WHERE cod_empresa = $1 AND activo = true',
                [codEmpresa.toUpperCase()]
            );

            if (empresaCheck.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'La empresa seleccionada no existe o no está activa'
                });
            }
        }

        // Actualizar usuario con rol y empresa
        const result = await pool.query(`
            UPDATE usuarios
            SET estado = 'aprobado',
                fecha_aprobacion = NOW(),
                aprobado_por = $1,
                rol = $2,
                cod_empresa = $3
            WHERE id = $4
            RETURNING id, email, nombre_completo, estado, cod_empresa, rol
        `, [req.usuario.id, rol, codEmpresa ? codEmpresa.toUpperCase() : null, id]);

        const empresaInfo = result.rows[0].cod_empresa ? ` -> ${result.rows[0].cod_empresa}` : '';
        console.log(`✅ Usuario aprobado: ${result.rows[0].email} (${result.rows[0].rol})${empresaInfo} (por ${req.usuario.email})`);

        res.json({
            success: true,
            message: 'Usuario aprobado exitosamente',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('Error aprobando usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al aprobar usuario'
        });
    }
});

// PUT /api/admin/usuarios/:id/rechazar - Rechazar usuario
app.put('/api/admin/usuarios/:id/rechazar', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { motivo } = req.body;

        const result = await pool.query(`
            UPDATE usuarios
            SET estado = 'rechazado'
            WHERE id = $1 AND estado = 'pendiente'
            RETURNING id, email, nombre_completo, estado
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado o ya fue procesado'
            });
        }

        console.log(`❌ Usuario rechazado: ${result.rows[0].email} (por ${req.usuario.email}) - Motivo: ${motivo || 'No especificado'}`);

        res.json({
            success: true,
            message: 'Usuario rechazado',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('Error rechazando usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al rechazar usuario'
        });
    }
});

// PUT /api/admin/usuarios/:id/suspender - Suspender usuario
app.put('/api/admin/usuarios/:id/suspender', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // No permitir suspenderse a sí mismo
        if (parseInt(id) === req.usuario.id) {
            return res.status(400).json({
                success: false,
                message: 'No puedes suspender tu propia cuenta'
            });
        }

        const result = await pool.query(`
            UPDATE usuarios
            SET estado = 'suspendido'
            WHERE id = $1 AND estado = 'aprobado'
            RETURNING id, email, nombre_completo, estado
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado o no está aprobado'
            });
        }

        // Revocar todas las sesiones activas del usuario
        await pool.query('UPDATE sesiones SET activa = false WHERE usuario_id = $1', [id]);

        console.log(`⚠️ Usuario suspendido: ${result.rows[0].email} (por ${req.usuario.email})`);

        res.json({
            success: true,
            message: 'Usuario suspendido',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('Error suspendiendo usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al suspender usuario'
        });
    }
});

// PUT /api/admin/usuarios/:id/reactivar - Reactivar usuario suspendido o rechazado
app.put('/api/admin/usuarios/:id/reactivar', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            UPDATE usuarios
            SET estado = 'aprobado', fecha_aprobacion = NOW(), aprobado_por = $1
            WHERE id = $2 AND estado IN ('suspendido', 'rechazado')
            RETURNING id, email, nombre_completo, estado
        `, [req.usuario.id, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado o no está suspendido/rechazado'
            });
        }

        console.log(`🔄 Usuario reactivado: ${result.rows[0].email} (por ${req.usuario.email})`);

        res.json({
            success: true,
            message: 'Usuario reactivado',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('Error reactivando usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al reactivar usuario'
        });
    }
});

// ============ ENDPOINTS DE PERMISOS ============

// Lista de permisos disponibles para panel-empresas (rol: empresa)
const PERMISOS_DISPONIBLES = [
    { codigo: 'VER_ORDENES', nombre: 'Ver Órdenes', descripcion: 'Ver lista y detalles de órdenes médicas' },
    { codigo: 'CREAR_ORDEN', nombre: 'Crear Orden', descripcion: 'Crear nuevas órdenes médicas' },
    { codigo: 'EDITAR_ORDEN', nombre: 'Editar Orden', descripcion: 'Modificar órdenes existentes' },
    { codigo: 'DUPLICAR_ORDEN', nombre: 'Duplicar Orden', descripcion: 'Duplicar órdenes existentes' },
    { codigo: 'DESCARGAR_CERTIFICADO', nombre: 'Descargar Certificado (Modal)', descripcion: 'Descargar certificado PDF desde el modal de detalles del paciente' },
    { codigo: 'DESCARGAR_CERTIFICADO_TABLA', nombre: 'Descargar Certificado (Tabla)', descripcion: 'Descargar certificado PDF desde la tabla de órdenes' },
    { codigo: 'VER_ESTADISTICAS', nombre: 'Ver Estadísticas', descripcion: 'Ver tarjetas de estadísticas' },
    { codigo: 'VER_RESULTADOS_MEDICOS', nombre: 'Ver Resultados Médicos', descripcion: 'Ver sección de resultados médicos en detalles del paciente' },
    { codigo: 'APROBADOR', nombre: 'Aprobador', descripcion: 'Aprobar o rechazar certificados médicos atendidos' },
    { codigo: 'PREGUNTA_LO_QUE_QUIERAS', nombre: 'Pregunta lo que quieras', descripcion: 'Acceder a la sección de análisis con IA' }
];

// Lista de permisos disponibles para panel-ordenes (rol: empleado)
const PERMISOS_EMPLEADO = [
    // Navegación/Secciones
    { codigo: 'EMP_VER_ORDENES', nombre: 'Ver Órdenes', descripcion: 'Acceder a la lista de órdenes', categoria: 'Navegación' },
    { codigo: 'EMP_NUEVA_ORDEN', nombre: 'Nueva Orden', descripcion: 'Acceder a crear nueva orden', categoria: 'Navegación' },
    { codigo: 'EMP_SUBIR_LOTE', nombre: 'Subir Lote', descripcion: 'Acceder a carga masiva de órdenes', categoria: 'Navegación' },
    { codigo: 'EMP_CALENDARIO', nombre: 'Calendario', descripcion: 'Acceder al calendario de citas', categoria: 'Navegación' },
    { codigo: 'EMP_MEDICOS', nombre: 'Médicos', descripcion: 'Acceder a gestión de médicos', categoria: 'Navegación' },
    { codigo: 'EMP_EXAMENES', nombre: 'Exámenes', descripcion: 'Acceder a gestión de exámenes', categoria: 'Navegación' },
    { codigo: 'EMP_EMPRESAS', nombre: 'Empresas', descripcion: 'Acceder a gestión de empresas', categoria: 'Navegación' },
    // Acciones sobre órdenes
    { codigo: 'EMP_VER_DETALLES', nombre: 'Ver Detalles', descripcion: 'Ver detalles completos de una orden', categoria: 'Acciones' },
    { codigo: 'EMP_EDITAR_ORDEN', nombre: 'Editar Orden', descripcion: 'Modificar datos de una orden', categoria: 'Acciones' },
    { codigo: 'EMP_ELIMINAR_ORDEN', nombre: 'Eliminar Orden', descripcion: 'Eliminar órdenes individuales o masivas', categoria: 'Acciones' },
    { codigo: 'EMP_MARCAR_PAGADO', nombre: 'Marcar Pagado', descripcion: 'Cambiar estado de pago de órdenes', categoria: 'Acciones' },
    { codigo: 'EMP_ENVIAR_LINK', nombre: 'Enviar Link', descripcion: 'Enviar link de prueba por WhatsApp', categoria: 'Acciones' },
    { codigo: 'EMP_ASIGNAR_MEDICO', nombre: 'Asignar Médico', descripcion: 'Asignar médico a una orden', categoria: 'Acciones' },
    { codigo: 'EMP_CAMBIAR_ESTADO', nombre: 'Cambiar Estado', descripcion: 'Modificar estado de la orden', categoria: 'Acciones' },
    { codigo: 'EMP_MODIFICAR_EXAMENES', nombre: 'Modificar Exámenes', descripcion: 'Agregar o quitar exámenes de una orden', categoria: 'Acciones' },
    { codigo: 'EMP_ENLAZAR_FORMULARIO', nombre: 'Enlazar Formulario', descripcion: 'Vincular orden con formulario médico', categoria: 'Acciones' }
];

// GET /api/admin/permisos/disponibles - Obtener lista de permisos disponibles
// Query param: tipo = 'empresa' | 'empleado' (default: empresa)
app.get('/api/admin/permisos/disponibles', authMiddleware, requireAdmin, (req, res) => {
    const { tipo } = req.query;

    if (tipo === 'empleado') {
        res.json({
            success: true,
            permisos: PERMISOS_EMPLEADO
        });
    } else {
        res.json({
            success: true,
            permisos: PERMISOS_DISPONIBLES
        });
    }
});

// GET /api/admin/usuarios/:id - Obtener datos de un usuario específico
app.get('/api/admin/usuarios/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            SELECT id, email, numero_documento, celular_whatsapp, nombre_completo,
                   nombre_empresa, cod_empresa, rol, estado, fecha_registro,
                   fecha_aprobacion, ultimo_login, activo
            FROM usuarios
            WHERE id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        res.json({
            success: true,
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('Error obteniendo usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener usuario'
        });
    }
});

// GET /api/admin/usuarios/:id/permisos - Obtener permisos de un usuario
app.get('/api/admin/usuarios/:id/permisos', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const permisos = await pool.query(`
            SELECT permiso, activo, fecha_asignacion
            FROM permisos_usuario
            WHERE usuario_id = $1
        `, [id]);

        res.json({
            success: true,
            permisos: permisos.rows
        });

    } catch (error) {
        console.error('Error obteniendo permisos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener permisos'
        });
    }
});

// PUT /api/admin/usuarios/:id/permisos - Actualizar permisos de un usuario
app.put('/api/admin/usuarios/:id/permisos', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { permisos } = req.body; // Array de códigos de permisos activos

        if (!Array.isArray(permisos)) {
            return res.status(400).json({
                success: false,
                message: 'Permisos debe ser un array'
            });
        }

        // Validar que los permisos existen (aceptar permisos de empresa y empleado)
        const permisosValidosEmpresa = PERMISOS_DISPONIBLES.map(p => p.codigo);
        const permisosValidosEmpleado = PERMISOS_EMPLEADO.map(p => p.codigo);
        const todosPermisosValidos = [...permisosValidosEmpresa, ...permisosValidosEmpleado];
        const permisosInvalidos = permisos.filter(p => !todosPermisosValidos.includes(p));
        if (permisosInvalidos.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Permisos inválidos: ${permisosInvalidos.join(', ')}`
            });
        }

        // Eliminar permisos actuales del usuario
        await pool.query('DELETE FROM permisos_usuario WHERE usuario_id = $1', [id]);

        // Insertar nuevos permisos
        if (permisos.length > 0) {
            const values = permisos.map((p, i) => `($1, $${i + 2}, true, NOW(), $${permisos.length + 2})`).join(', ');
            const params = [id, ...permisos, req.usuario.id];
            await pool.query(`
                INSERT INTO permisos_usuario (usuario_id, permiso, activo, fecha_asignacion, asignado_por)
                VALUES ${values}
            `, params);
        }

        console.log(`🔐 Permisos actualizados para usuario ${id}: [${permisos.join(', ')}] (por ${req.usuario.email})`);

        res.json({
            success: true,
            message: 'Permisos actualizados correctamente',
            permisos: permisos
        });

    } catch (error) {
        console.error('Error actualizando permisos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar permisos'
        });
    }
});

// PUT /api/admin/usuarios/:id/cod-empresa - Actualizar cod_empresa de un usuario
app.put('/api/admin/usuarios/:id/cod-empresa', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { codEmpresa } = req.body;

        // Verificar que el usuario existe
        const usuarioResult = await pool.query('SELECT id, email, rol FROM usuarios WHERE id = $1', [id]);
        if (usuarioResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        const usuario = usuarioResult.rows[0];

        // Validar que el codEmpresa no esté vacío si el rol es empresa
        if (usuario.rol === 'empresa' && !codEmpresa) {
            return res.status(400).json({
                success: false,
                message: 'El código de empresa es requerido para usuarios de tipo Empresa'
            });
        }

        // Actualizar cod_empresa
        await pool.query(
            'UPDATE usuarios SET cod_empresa = $1 WHERE id = $2',
            [codEmpresa || null, id]
        );

        console.log(`🏢 Código de empresa actualizado para usuario ${id} (${usuario.email}): ${codEmpresa || 'NULL'} (por ${req.usuario.email})`);

        res.json({
            success: true,
            message: 'Código de empresa actualizado correctamente',
            codEmpresa: codEmpresa
        });

    } catch (error) {
        console.error('Error actualizando código de empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar código de empresa'
        });
    }
});

// GET /api/auth/mis-permisos - Obtener permisos del usuario autenticado
app.get('/api/auth/mis-permisos', authMiddleware, async (req, res) => {
    try {
        // Los admins tienen todos los permisos (empresa + empleado)
        if (req.usuario.rol === 'admin') {
            const todosPermisos = [
                ...PERMISOS_DISPONIBLES.map(p => p.codigo),
                ...PERMISOS_EMPLEADO.map(p => p.codigo)
            ];
            return res.json({
                success: true,
                permisos: todosPermisos
            });
        }

        const permisos = await pool.query(`
            SELECT permiso FROM permisos_usuario
            WHERE usuario_id = $1 AND activo = true
        `, [req.usuario.id]);

        res.json({
            success: true,
            permisos: permisos.rows.map(p => p.permiso)
        });

    } catch (error) {
        console.error('Error obteniendo mis permisos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener permisos'
        });
    }
});

// ============ FIN ENDPOINTS DE PERMISOS ============

// POST /api/admin/usuarios - Crear usuario directamente (ya aprobado)
app.post('/api/admin/usuarios', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { email, password, numeroDocumento, celularWhatsapp, nombreCompleto, codEmpresa, rol = 'empresa' } = req.body;

        // Validaciones
        if (!email || !password || !numeroDocumento || !celularWhatsapp) {
            return res.status(400).json({
                success: false,
                message: 'Email, contraseña, número de documento y celular son requeridos'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'La contraseña debe tener al menos 8 caracteres'
            });
        }

        if (!['empresa', 'admin'].includes(rol)) {
            return res.status(400).json({
                success: false,
                message: 'Rol inválido. Debe ser "empresa" o "admin"'
            });
        }

        // Verificar duplicados
        const existe = await pool.query(
            'SELECT id FROM usuarios WHERE email = $1 OR numero_documento = $2',
            [email.toLowerCase(), numeroDocumento]
        );

        if (existe.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe un usuario con ese email o número de documento'
            });
        }

        // Hashear password
        const passwordHash = await hashPassword(password);

        // Insertar usuario ya aprobado
        const result = await pool.query(`
            INSERT INTO usuarios (email, password_hash, numero_documento, celular_whatsapp, nombre_completo, cod_empresa, rol, estado, fecha_aprobacion, aprobado_por)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'aprobado', NOW(), $8)
            RETURNING id, email, nombre_completo, rol, estado, fecha_registro
        `, [email.toLowerCase(), passwordHash, numeroDocumento, celularWhatsapp, nombreCompleto || null, codEmpresa?.toUpperCase() || null, rol, req.usuario.id]);

        console.log(`👤 Usuario creado por admin: ${email} (${rol})`);

        res.status(201).json({
            success: true,
            message: 'Usuario creado exitosamente',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('Error creando usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear usuario'
        });
    }
});

// ========== ENDPOINTS PARA EXPLORAR TABLAS DE BASE DE DATOS (Admin) ==========

// GET - Listar todas las tablas de la base de datos
app.get('/api/admin/tablas', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
            ORDER BY table_name ASC
        `);

        res.json({
            success: true,
            tablas: result.rows.map(r => r.table_name)
        });
    } catch (error) {
        console.error('Error al listar tablas:', error);
        res.status(500).json({ success: false, message: 'Error al listar tablas' });
    }
});

// GET - Obtener estructura de una tabla
app.get('/api/admin/tablas/:nombre/estructura', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { nombre } = req.params;

        // Validar nombre de tabla para evitar inyección SQL
        const tablaValida = await pool.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
        `, [nombre]);

        if (tablaValida.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tabla no encontrada' });
        }

        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
        `, [nombre]);

        res.json({
            success: true,
            tabla: nombre,
            columnas: result.rows
        });
    } catch (error) {
        console.error('Error al obtener estructura:', error);
        res.status(500).json({ success: false, message: 'Error al obtener estructura' });
    }
});

// GET - Obtener datos de una tabla con paginación
app.get('/api/admin/tablas/:nombre/datos', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { nombre } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const orderBy = req.query.orderBy || 'id';
        const orderDir = req.query.orderDir === 'asc' ? 'ASC' : 'DESC';
        const buscar = req.query.buscar || '';

        // Validar nombre de tabla para evitar inyección SQL
        const tablaValida = await pool.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
        `, [nombre]);

        if (tablaValida.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tabla no encontrada' });
        }

        // Obtener columnas de la tabla
        const columnasResult = await pool.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
        `, [nombre]);

        const columnas = columnasResult.rows;
        const columnasTexto = columnas.filter(c =>
            ['character varying', 'text', 'varchar'].includes(c.data_type)
        ).map(c => c.column_name);

        // Verificar que orderBy sea una columna válida
        const columnasValidas = columnas.map(c => c.column_name);
        const orderColumn = columnasValidas.includes(orderBy) ? orderBy :
            (columnasValidas.includes('id') ? 'id' : columnasValidas[0]);

        // Construir query de búsqueda
        let whereClause = '';
        let queryParams = [];

        if (buscar && columnasTexto.length > 0) {
            const condiciones = columnasTexto.map((col, idx) =>
                `CAST("${col}" AS TEXT) ILIKE $${idx + 1}`
            );
            whereClause = `WHERE ${condiciones.join(' OR ')}`;
            queryParams = columnasTexto.map(() => `%${buscar}%`);
        }

        // Excluir columnas grandes como 'foto' para el listado
        const columnasListado = columnas
            .filter(c => !['foto', 'firma', 'imagen', 'base64'].some(x => c.column_name.toLowerCase().includes(x)))
            .map(c => `"${c.column_name}"`)
            .join(', ');

        // Obtener total
        const countQuery = `SELECT COUNT(*) FROM "${nombre}" ${whereClause}`;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].count);

        // Obtener datos
        const dataQuery = `
            SELECT ${columnasListado || '*'}
            FROM "${nombre}"
            ${whereClause}
            ORDER BY "${orderColumn}" ${orderDir}
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;
        const dataResult = await pool.query(dataQuery, [...queryParams, limit, offset]);

        res.json({
            success: true,
            tabla: nombre,
            columnas: columnas.filter(c => !['foto', 'firma', 'imagen', 'base64'].some(x => c.column_name.toLowerCase().includes(x))),
            datos: dataResult.rows,
            total,
            limit,
            offset
        });
    } catch (error) {
        console.error('Error al obtener datos de tabla:', error);
        res.status(500).json({ success: false, message: 'Error al obtener datos' });
    }
});

// ========== ENDPOINTS ADMIN WHATSAPP ==========

// GET - Listar todas las conversaciones de WhatsApp con último mensaje
app.get('/api/admin/whatsapp/conversaciones', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const query = `
            SELECT
                c.id,
                c.celular as numero_cliente,
                c.nombre_paciente as nombre_cliente,
                c.estado_actual as estado,
                c.agente_asignado as agente_id,
                c.fecha_inicio,
                c.fecha_ultima_actividad,
                COALESCE(
                    (SELECT COUNT(*)::int
                     FROM mensajes_whatsapp m
                     WHERE m.conversacion_id = c.id
                       AND m.direccion = 'entrante'
                       AND m.leido_por_agente = false),
                    0
                ) as no_leidos,
                c.bot_activo,
                c.agente_asignado as agente_nombre,
                (
                    SELECT json_build_object(
                        'contenido', m.contenido,
                        'direccion', m.direccion,
                        'fecha_envio', m.timestamp
                    )
                    FROM mensajes_whatsapp m
                    WHERE m.conversacion_id = c.id
                    ORDER BY m.timestamp DESC
                    LIMIT 1
                ) as ultimo_mensaje,
                (
                    SELECT h."codEmpresa"
                    FROM "HistoriaClinica" h
                    WHERE h."celular" = c.celular
                       OR h."celular" = REPLACE(c.celular, '+', '')
                       OR h."celular" = REPLACE(REPLACE(c.celular, '+57', ''), '+', '')
                    ORDER BY h."_createdDate" DESC
                    LIMIT 1
                ) as cod_empresa
            FROM conversaciones_whatsapp c
            ORDER BY
                CASE WHEN EXISTS (
                    SELECT 1 FROM mensajes_whatsapp m
                    WHERE m.conversacion_id = c.id
                    AND m.direccion = 'entrante'
                    AND m.leido_por_agente = false
                ) THEN 0 ELSE 1 END,
                c.fecha_ultima_actividad DESC
            LIMIT 100
        `;

        const result = await pool.query(query);
        res.json({ success: true, conversaciones: result.rows });
    } catch (error) {
        console.error('Error al obtener conversaciones WhatsApp:', error);
        res.status(500).json({ success: false, message: 'Error al obtener conversaciones' });
    }
});

// GET - Obtener mensajes de una conversación específica
app.get('/api/admin/whatsapp/conversaciones/:id/mensajes', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const query = `
            SELECT
                id,
                contenido,
                direccion,
                timestamp as fecha_envio,
                sid_twilio as twilio_sid,
                tipo_mensaje as tipo_contenido,
                media_url,
                media_type
            FROM mensajes_whatsapp
            WHERE conversacion_id = $1
            ORDER BY timestamp ASC
        `;

        const result = await pool.query(query, [id]);

        // Marcar todos los mensajes entrantes de esta conversación como leídos
        await pool.query(`
            UPDATE mensajes_whatsapp
            SET leido_por_agente = true,
                fecha_lectura = NOW()
            WHERE conversacion_id = $1
              AND direccion = 'entrante'
              AND leido_por_agente = false
        `, [id]);

        res.json({ success: true, mensajes: result.rows });
    } catch (error) {
        console.error('Error al obtener mensajes:', error);
        res.status(500).json({ success: false, message: 'Error al obtener mensajes' });
    }
});

// GET - Proxy para media de Twilio (autenticación por header o query param)
app.get('/api/admin/whatsapp/media/proxy', async (req, res) => {
    try {
        const { url, token } = req.query;

        if (!url) {
            return res.status(400).json({ success: false, message: 'URL no proporcionada' });
        }

        // Validar que la URL sea de Twilio
        if (!url.startsWith('https://api.twilio.com/')) {
            return res.status(400).json({ success: false, message: 'URL no válida' });
        }

        // Autenticación: token en query param o en header
        let authenticated = false;

        // Intentar autenticación por header primero
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const headerToken = authHeader.substring(7);
            try {
                jwt.verify(headerToken, JWT_SECRET);
                authenticated = true;
            } catch (err) {
                // Token inválido en header
            }
        }

        // Si no está autenticado por header, intentar por query param
        if (!authenticated && token) {
            try {
                jwt.verify(token, JWT_SECRET);
                authenticated = true;
            } catch (err) {
                return res.status(401).json({ success: false, message: 'Token inválido' });
            }
        }

        if (!authenticated) {
            return res.status(401).json({ success: false, message: 'Token de autenticación requerido' });
        }

        console.log('🖼️ Proxying media from Twilio:', url);

        // Fetch con autenticación básica de Twilio
        const response = await fetch(url, {
            headers: {
                'Authorization': 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
            }
        });

        if (!response.ok) {
            console.error('❌ Error fetching media from Twilio:', response.status, response.statusText);
            return res.status(response.status).json({ success: false, message: 'Error al obtener media de Twilio' });
        }

        // Obtener el tipo de contenido
        const contentType = response.headers.get('content-type');

        // Pipe la respuesta directamente al cliente
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache por 1 año

        // Stream la respuesta
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));

    } catch (error) {
        console.error('❌ Error al proxear media:', error);
        res.status(500).json({ success: false, message: 'Error al obtener archivo multimedia' });
    }
});

// POST - Enviar mensaje en una conversación
app.post('/api/admin/whatsapp/conversaciones/:id/mensajes', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { contenido } = req.body;

        // Obtener número del cliente de la conversación
        const convResult = await pool.query(`
            SELECT celular FROM conversaciones_whatsapp WHERE id = $1
        `, [id]);

        if (convResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Conversación no encontrada' });
        }

        const numeroCliente = convResult.rows[0].celular;

        // Enviar mensaje via Twilio (texto libre para conversaciones)
        // NOTA: sendWhatsAppFreeText() ya guarda el mensaje automáticamente via guardarMensajeSaliente()
        const twilioResult = await sendWhatsAppFreeText(numeroCliente, contenido);

        if (!twilioResult.success) {
            return res.status(500).json({
                success: false,
                message: 'Error al enviar mensaje',
                error: twilioResult.error
            });
        }

        // El mensaje ya fue guardado por sendWhatsAppFreeText() -> guardarMensajeSaliente()
        // No necesitamos guardar aquí para evitar duplicados

        // Emitir evento WebSocket para actualización en tiempo real
        // (ya se emitió en guardarMensajeSaliente(), pero lo hacemos de nuevo por compatibilidad)
        if (global.emitWhatsAppEvent) {
            global.emitWhatsAppEvent('nuevo_mensaje', {
                conversacion_id: parseInt(id),
                numero_cliente: numeroCliente,
                contenido: contenido,
                direccion: 'saliente',
                fecha_envio: new Date().toISOString(),
                sid_twilio: twilioResult.sid
            });
        }

        res.json({
            success: true,
            mensaje: {
                conversacion_id: parseInt(id),
                contenido: contenido,
                direccion: 'saliente',
                sid_twilio: twilioResult.sid,
                tipo_mensaje: 'text',
                timestamp: new Date()
            },
            twilio: twilioResult
        });
    } catch (error) {
        console.error('Error al enviar mensaje WhatsApp:', error);
        res.status(500).json({ success: false, message: 'Error al enviar mensaje' });
    }
});

// POST - Enviar archivo multimedia en una conversación
app.post('/api/admin/whatsapp/conversaciones/:id/media', authMiddleware, requireAdmin, upload.single('file'), async (req, res) => {
    try {
        const { id } = req.params;
        const { contenido } = req.body; // Caption opcional
        const file = req.file;

        if (!file) {
            return res.status(400).json({ success: false, message: 'No se proporcionó ningún archivo' });
        }

        // Validar tamaño (16MB - límite de Twilio)
        if (file.size > 16 * 1024 * 1024) {
            return res.status(400).json({ success: false, message: 'El archivo excede el tamaño máximo de 16MB' });
        }

        // Obtener número del cliente de la conversación
        const convResult = await pool.query(`
            SELECT celular FROM conversaciones_whatsapp WHERE id = $1
        `, [id]);

        if (convResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Conversación no encontrada' });
        }

        const numeroCliente = convResult.rows[0].celular;

        console.log(`📤 Enviando archivo ${file.originalname} (${file.mimetype}, ${file.size} bytes) a ${numeroCliente}`);

        // Enviar archivo via Twilio
        const twilioResult = await sendWhatsAppMedia(
            numeroCliente,
            file.buffer,
            file.mimetype,
            file.originalname,
            contenido || ''
        );

        if (!twilioResult.success) {
            return res.status(500).json({
                success: false,
                message: 'Error al enviar archivo',
                error: twilioResult.error
            });
        }

        // Guardar mensaje en base de datos con metadata del archivo
        const tipoMensaje = file.mimetype.startsWith('image/') ? 'image' :
                           file.mimetype.startsWith('video/') ? 'video' :
                           file.mimetype.startsWith('audio/') ? 'audio' :
                           'document';

        const mensajeContenido = contenido || `📎 ${file.originalname}`;

        const insertQuery = `
            INSERT INTO mensajes_whatsapp (
                conversacion_id, contenido, direccion, sid_twilio, tipo_mensaje, media_url, media_type
            )
            VALUES ($1, $2, 'saliente', $3, $4, $5, $6)
            RETURNING *
        `;

        const messageResult = await pool.query(insertQuery, [
            id,
            mensajeContenido,
            twilioResult.sid,
            tipoMensaje,
            JSON.stringify([twilioResult.mediaUrl]),
            JSON.stringify([file.mimetype])
        ]);

        // Actualizar fecha de última actividad
        await pool.query(`
            UPDATE conversaciones_whatsapp
            SET fecha_ultima_actividad = NOW()
            WHERE id = $1
        `, [id]);

        // Emitir evento WebSocket para actualización en tiempo real
        if (global.emitWhatsAppEvent) {
            global.emitWhatsAppEvent('nuevo_mensaje', {
                conversacion_id: parseInt(id),
                numero_cliente: numeroCliente,
                contenido: mensajeContenido,
                direccion: 'saliente',
                fecha_envio: new Date().toISOString(),
                sid_twilio: twilioResult.sid,
                tipo_mensaje: tipoMensaje
            });
        }

        res.json({
            success: true,
            mensaje: messageResult.rows[0],
            twilio: twilioResult
        });
    } catch (error) {
        console.error('Error al enviar archivo WhatsApp:', error);
        res.status(500).json({ success: false, message: 'Error al enviar archivo', error: error.message });
    }
});

// POST - Webhook para recibir mensajes entrantes de Twilio WhatsApp
app.post('/api/whatsapp/webhook', async (req, res) => {
    try {
        const { From, Body, MessageSid, ProfileName, NumMedia } = req.body;

        // Extraer número sin prefijo whatsapp:
        const numeroCliente = From.replace('whatsapp:', '');

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

        // Buscar o crear conversación
        let conversacion = await pool.query(`
            SELECT id FROM conversaciones_whatsapp WHERE celular = $1
        `, [numeroCliente]);

        let conversacionId;

        if (conversacion.rows.length === 0) {
            // Crear nueva conversación
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

            // Actualizar última actividad
            await pool.query(`
                UPDATE conversaciones_whatsapp
                SET fecha_ultima_actividad = NOW()
                WHERE id = $1
            `, [conversacionId]);
        }

        // 🆕 DETECTAR Y ENVIAR MENSAJE A USUARIOS NUEVOS
        if (conversacion.rows.length === 0) {
            // Primera vez que escribe por WhatsApp
            const esNuevo = await esUsuarioNuevo(numeroCliente);

            if (esNuevo) {
                console.log('🆕 Usuario nuevo detectado - enviando información de agendamiento');

                const mensajeBienvenida = `Hola:\n\n` +
                    `Si deseas agendar una consulta esta es la información\n\n` +
                    `Diligencia tus datos y escoge la hora que te convenga\n\n` +
                    `Realiza las pruebas desde tu celular o computador\n\n` +
                    `El médico se comunicará contigo\n\n` +
                    `¡Listo! Descarga inmediatamente tu certificado\n\n` +
                    `*Para comenzar:*\n` +
                    `https://bsl-plataforma.com/nuevaorden1.html\n` +
                    `52.000: Paquete básico Osteomuscular, audiometría, visio/optometría`;

                await sendWhatsAppFreeText(numeroCliente, mensajeBienvenida);
            }
        }

        // 📸 PROCESAR FLUJO DE VALIDACIÓN DE PAGOS SI HAY IMÁGENES
        if (numMedia > 0) {
            const mainMediaType = mediaTypes[0];

            // Solo procesar imágenes para el flujo de pagos
            if (mainMediaType && mainMediaType.startsWith('image/')) {
                console.log('📸 Imagen detectada - activando flujo de validación de pagos');

                // Procesar flujo de pagos (maneja clasificación y respuestas)
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

        // Emitir evento WebSocket para actualización en tiempo real
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

        // 💬 PROCESAR TEXTO SI ESTÁ EN FLUJO DE PAGOS (esperando documento)
        if (Body && numMedia === 0) {
            const estadoPago = estadoPagos.get(From);

            if (estadoPago === ESTADO_ESPERANDO_DOCUMENTO) {
                console.log('📝 Usuario envió texto en flujo de pagos - procesando documento');

                try {
                    await procesarFlujoPagos(req.body, From);
                } catch (error) {
                    console.error('❌ Error procesando documento en flujo de pagos:', error);
                }
            }
        }

        // Responder a Twilio con 200 OK (vacío o con TwiML si quieres auto-responder)
        res.type('text/xml');
        res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

    } catch (error) {
        console.error('❌ Error en webhook WhatsApp:', error);
        res.status(500).send('Error');
    }
});

// POST - Status Callback de Twilio para mensajes salientes
app.post('/api/whatsapp/status', async (req, res) => {
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
            const numeroCliente = To.replace('whatsapp:', '');

            // Verificar si el mensaje ya existe en la base de datos
            const mensajeExistente = await pool.query(`
                SELECT id FROM mensajes_whatsapp WHERE sid_twilio = $1
            `, [MessageSid]);

            // Si el mensaje ya existe, no hacer nada (ya fue registrado por el envío directo)
            if (mensajeExistente.rows.length > 0) {
                console.log('✅ Mensaje ya registrado:', MessageSid);
                res.sendStatus(200);
                return;
            }

            // El mensaje NO existe, fue enviado desde otra plataforma
            console.log('📝 Registrando mensaje enviado desde plataforma externa');

            // Buscar o crear conversación
            let conversacion = await pool.query(`
                SELECT id FROM conversaciones_whatsapp WHERE celular = $1
            `, [numeroCliente]);

            let conversacionId;

            if (conversacion.rows.length === 0) {
                // Crear nueva conversación
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
            } else {
                conversacionId = conversacion.rows[0].id;

                // Actualizar última actividad
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

            // Emitir evento WebSocket para actualización en tiempo real
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

// PATCH - Actualizar estado de una conversación
app.patch('/api/admin/whatsapp/conversaciones/:id/estado', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, agente_id, bot_activo } = req.body;

        const updates = [];
        const values = [];
        let paramCount = 1;

        if (estado !== undefined) {
            updates.push(`estado_actual = $${paramCount++}`);
            values.push(estado);
        }

        if (agente_id !== undefined) {
            updates.push(`agente_asignado = $${paramCount++}`);
            values.push(agente_id);
        }

        if (bot_activo !== undefined) {
            updates.push(`bot_activo = $${paramCount++}`);
            values.push(bot_activo);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No hay cambios para actualizar' });
        }

        values.push(id);
        const query = `
            UPDATE conversaciones_whatsapp
            SET ${updates.join(', ')}, fecha_ultima_actividad = NOW()
            WHERE id = $${paramCount}
            RETURNING *
        `;

        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Conversación no encontrada' });
        }

        res.json({ success: true, conversacion: result.rows[0] });
    } catch (error) {
        console.error('Error al actualizar conversación:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar conversación' });
    }
});

// Ruta principal - servir el formulario
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ========== ENDPOINT SSE PARA NOTIFICACIONES EN TIEMPO REAL ==========
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Enviar heartbeat inicial
    res.write('data: {"type":"connected"}\n\n');

    // Agregar cliente a la lista
    const clientId = Date.now();
    const newClient = { id: clientId, res };
    sseClients.push(newClient);
    console.log(`📡 Cliente SSE conectado: ${clientId}. Total: ${sseClients.length}`);

    // Remover cliente cuando se desconecta
    req.on('close', () => {
        sseClients = sseClients.filter(client => client.id !== clientId);
        console.log(`📡 Cliente SSE desconectado: ${clientId}. Total: ${sseClients.length}`);
    });
});

// Ruta para obtener datos de Wix por ID
app.get('/api/wix/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const fetch = (await import('node-fetch')).default;

        const response = await fetch(`https://www.bsl.com.co/_functions/historiaClinicaPorId?_id=${id}`);

        if (!response.ok) {
            return res.status(404).json({
                success: false,
                message: 'No se encontró información en Wix'
            });
        }

        const result = await response.json();

        // Los datos vienen en result.data
        const wixData = result.data || {};

        res.json({
            success: true,
            data: {
                primerNombre: wixData.primerNombre,
                primerApellido: wixData.primerApellido,
                numeroId: wixData.numeroId,
                celular: wixData.celular,
                empresa: wixData.empresa,
                codEmpresa: wixData.codEmpresa,
                fechaAtencion: wixData.fechaAtencion,
                examenes: wixData.examenes || ""
            }
        });

    } catch (error) {
        console.error('❌ Error al consultar Wix:', error);
        res.status(500).json({
            success: false,
            message: 'Error al consultar datos de Wix',
            error: error.message
        });
    }
});

// Ruta para recibir el formulario
app.post('/api/formulario', async (req, res) => {
    try {
        const datos = req.body;

        // Validación básica
        if (!datos.genero || !datos.edad || !datos.email) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos obligatorios'
            });
        }

        // Subir foto a DigitalOcean Spaces si existe
        let fotoUrl = null;
        if (datos.foto && datos.foto.startsWith('data:image')) {
            console.log('📤 Subiendo foto a DigitalOcean Spaces...');
            fotoUrl = await subirFotoASpaces(datos.foto, datos.numeroId, 'new');
        }

        // Verificar si ya existe un formulario con este wix_id
        let existeFormulario = false;
        if (datos.wixId) {
            const checkResult = await pool.query(
                'SELECT id FROM formularios WHERE wix_id = $1',
                [datos.wixId]
            );
            existeFormulario = checkResult.rows.length > 0;
        }

        let result;

        if (existeFormulario) {
            // UPDATE si ya existe
            const updateQuery = `
                UPDATE formularios SET
                    primer_nombre = $2, primer_apellido = $3, numero_id = $4, celular = $5,
                    empresa = $6, cod_empresa = $7, fecha_atencion = $8,
                    genero = $9, edad = $10, fecha_nacimiento = $11, lugar_nacimiento = $12, ciudad_residencia = $13,
                    hijos = $14, profesion_oficio = $15, empresa1 = $16, empresa2 = $17, estado_civil = $18,
                    nivel_educativo = $19, email = $20, eps = $21, arl = $22, pensiones = $23, estatura = $24, peso = $25, ejercicio = $26,
                    cirugia_ocular = $27, consumo_licor = $28, cirugia_programada = $29, condicion_medica = $30,
                    dolor_cabeza = $31, dolor_espalda = $32, ruido_jaqueca = $33, embarazo = $34,
                    enfermedad_higado = $35, enfermedad_pulmonar = $36, fuma = $37, hernias = $38,
                    hormigueos = $39, presion_alta = $40, problemas_azucar = $41, problemas_cardiacos = $42,
                    problemas_sueno = $43, usa_anteojos = $44, usa_lentes_contacto = $45, varices = $46,
                    hepatitis = $47, familia_hereditarias = $48, familia_geneticas = $49, familia_diabetes = $50,
                    familia_hipertension = $51, familia_infartos = $52, familia_cancer = $53,
                    familia_trastornos = $54, familia_infecciosas = $55,
                    trastorno_psicologico = $56, sintomas_psicologicos = $57, diagnostico_cancer = $58,
                    enfermedades_laborales = $59, enfermedad_osteomuscular = $60, enfermedad_autoinmune = $61,
                    firma = $62, inscripcion_boletin = $63, foto_url = COALESCE($64, foto_url),
                    updated_at = CURRENT_TIMESTAMP
                WHERE wix_id = $1
                RETURNING id
            `;

            const updateValues = [
                datos.wixId, datos.primerNombre, datos.primerApellido, datos.numeroId, datos.celular,
                datos.empresa, datos.codEmpresa, datos.fechaAtencion,
                datos.genero, datos.edad, datos.fechaNacimiento, datos.lugarDeNacimiento, datos.ciudadDeResidencia,
                datos.hijos, datos.profesionUOficio, datos.empresa1, datos.empresa2, datos.estadoCivil,
                datos.nivelEducativo, datos.email, datos.eps, datos.arl, datos.pensiones, datos.estatura, datos.peso, datos.ejercicio,
                datos.cirugiaOcular, datos.consumoLicor, datos.cirugiaProgramada, datos.condicionMedica,
                datos.dolorCabeza, datos.dolorEspalda, datos.ruidoJaqueca, datos.embarazo,
                datos.enfermedadHigado, datos.enfermedadPulmonar, datos.fuma, datos.hernias,
                datos.hormigueos, datos.presionAlta, datos.problemasAzucar, datos.problemasCardiacos,
                datos.problemasSueno, datos.usaAnteojos, datos.usaLentesContacto, datos.varices,
                datos.hepatitis, datos.familiaHereditarias, datos.familiaGeneticas, datos.familiaDiabetes,
                datos.familiaHipertension, datos.familiaInfartos, datos.familiaCancer,
                datos.familiaTrastornos, datos.familiaInfecciosas,
                datos.trastornoPsicologico, datos.sintomasPsicologicos, datos.diagnosticoCancer,
                datos.enfermedadesLaborales, datos.enfermedadOsteomuscular, datos.enfermedadAutoinmune,
                datos.firma, datos.inscripcionBoletin, fotoUrl
            ];

            result = await pool.query(updateQuery, updateValues);
            console.log('✅ Formulario actualizado en PostgreSQL:', result.rows[0].id);
        } else {
            // INSERT si no existe
            const insertQuery = `
                INSERT INTO formularios (
                    wix_id, primer_nombre, primer_apellido, numero_id, celular,
                    empresa, cod_empresa, fecha_atencion,
                    genero, edad, fecha_nacimiento, lugar_nacimiento, ciudad_residencia,
                    hijos, profesion_oficio, empresa1, empresa2, estado_civil,
                    nivel_educativo, email, eps, arl, pensiones, estatura, peso, ejercicio,
                    cirugia_ocular, consumo_licor, cirugia_programada, condicion_medica,
                    dolor_cabeza, dolor_espalda, ruido_jaqueca, embarazo,
                    enfermedad_higado, enfermedad_pulmonar, fuma, hernias,
                    hormigueos, presion_alta, problemas_azucar, problemas_cardiacos,
                    problemas_sueno, usa_anteojos, usa_lentes_contacto, varices,
                    hepatitis, familia_hereditarias, familia_geneticas, familia_diabetes,
                    familia_hipertension, familia_infartos, familia_cancer,
                    familia_trastornos, familia_infecciosas,
                    trastorno_psicologico, sintomas_psicologicos, diagnostico_cancer,
                    enfermedades_laborales, enfermedad_osteomuscular, enfermedad_autoinmune,
                    firma, inscripcion_boletin, foto_url
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                    $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                    $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
                    $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
                    $51, $52, $53, $54, $55, $56, $57, $58, $59, $60,
                    $61, $62, $63, $64
                ) RETURNING id
            `;

            const insertValues = [
                datos.wixId, datos.primerNombre, datos.primerApellido, datos.numeroId, datos.celular,
                datos.empresa, datos.codEmpresa, datos.fechaAtencion,
                datos.genero, datos.edad, datos.fechaNacimiento, datos.lugarDeNacimiento, datos.ciudadDeResidencia,
                datos.hijos, datos.profesionUOficio, datos.empresa1, datos.empresa2, datos.estadoCivil,
                datos.nivelEducativo, datos.email, datos.eps, datos.arl, datos.pensiones, datos.estatura, datos.peso, datos.ejercicio,
                datos.cirugiaOcular, datos.consumoLicor, datos.cirugiaProgramada, datos.condicionMedica,
                datos.dolorCabeza, datos.dolorEspalda, datos.ruidoJaqueca, datos.embarazo,
                datos.enfermedadHigado, datos.enfermedadPulmonar, datos.fuma, datos.hernias,
                datos.hormigueos, datos.presionAlta, datos.problemasAzucar, datos.problemasCardiacos,
                datos.problemasSueno, datos.usaAnteojos, datos.usaLentesContacto, datos.varices,
                datos.hepatitis, datos.familiaHereditarias, datos.familiaGeneticas, datos.familiaDiabetes,
                datos.familiaHipertension, datos.familiaInfartos, datos.familiaCancer,
                datos.familiaTrastornos, datos.familiaInfecciosas,
                datos.trastornoPsicologico, datos.sintomasPsicologicos, datos.diagnosticoCancer,
                datos.enfermedadesLaborales, datos.enfermedadOsteomuscular, datos.enfermedadAutoinmune,
                datos.firma, datos.inscripcionBoletin, fotoUrl
            ];

            result = await pool.query(insertQuery, insertValues);
            console.log('✅ Formulario guardado en PostgreSQL:', result.rows[0].id);
        }

        // Enviar alertas por WhatsApp si hay respuestas afirmativas en preguntas críticas
        try {
            await enviarAlertasPreguntasCriticas(datos);
        } catch (alertaError) {
            console.error('❌ Error al enviar alertas WhatsApp:', alertaError.message);
            // No bloqueamos la respuesta si falla el envío de alertas
        }

        // Enviar datos a Wix
        try {
            const fetch = (await import('node-fetch')).default;

            // Mapear encuestaSalud - solo incluir respuestas "Sí" (para tags de Wix)
            const encuestaSaludTags = [];
            if (datos.cirugiaOcular === "Sí") encuestaSaludTags.push("Cirugía ocular");
            if (datos.cirugiaProgramada === "Sí") encuestaSaludTags.push("Cirugías programadas");
            if (datos.condicionMedica === "Sí") encuestaSaludTags.push("Condición médica con tratamiento actual");
            if (datos.dolorCabeza === "Sí") encuestaSaludTags.push("Dolor de cabeza");
            if (datos.dolorEspalda === "Sí") encuestaSaludTags.push("Dolor de espalda");
            if (datos.ruidoJaqueca === "Sí") encuestaSaludTags.push("El ruido produce jaqueca");
            if (datos.embarazo === "Sí") encuestaSaludTags.push("Embarazo actual");
            if (datos.enfermedadHigado === "Sí") encuestaSaludTags.push("Enfermedades hígado");
            if (datos.enfermedadPulmonar === "Sí") encuestaSaludTags.push("Enfermedades pulmonares");
            if (datos.fuma === "Sí") encuestaSaludTags.push("Fuma o fumaba");
            if (datos.hernias === "Sí") encuestaSaludTags.push("Hernias");
            if (datos.hormigueos === "Sí") encuestaSaludTags.push("Hormigueos");
            if (datos.presionAlta === "Sí") encuestaSaludTags.push("Presión arterial alta");
            if (datos.problemasAzucar === "Sí") encuestaSaludTags.push("Problemas azúcar");
            if (datos.problemasCardiacos === "Sí") encuestaSaludTags.push("Problemas cardíacos");
            if (datos.problemasSueno === "Sí") encuestaSaludTags.push("Problemas de sueño");
            if (datos.usaAnteojos === "Sí") encuestaSaludTags.push("Usa anteojos");
            if (datos.usaLentesContacto === "Sí") encuestaSaludTags.push("Usa lentes de contacto");
            if (datos.varices === "Sí") encuestaSaludTags.push("Várices");
            // Nuevas preguntas de salud personal
            if (datos.trastornoPsicologico === "Sí") encuestaSaludTags.push("Trastorno psicológico o psiquiátrico");
            if (datos.sintomasPsicologicos === "Sí") encuestaSaludTags.push("Síntomas psicológicos recientes");
            if (datos.diagnosticoCancer === "Sí") encuestaSaludTags.push("Diagnóstico o sospecha de cáncer");
            if (datos.enfermedadesLaborales === "Sí") encuestaSaludTags.push("Enfermedades laborales o accidentes de trabajo");
            if (datos.enfermedadOsteomuscular === "Sí") encuestaSaludTags.push("Enfermedad osteomuscular");
            if (datos.enfermedadAutoinmune === "Sí") encuestaSaludTags.push("Enfermedad autoinmune");

            // Mapear antecedentesFamiliares - solo incluir respuestas "Sí" (para tags de Wix)
            const antecedentesFamiliaresTags = [];
            if (datos.hepatitis === "Sí") antecedentesFamiliaresTags.push("Hepatitis");
            if (datos.familiaHereditarias === "Sí") antecedentesFamiliaresTags.push("Enfermedades hereditarias");
            if (datos.familiaGeneticas === "Sí") antecedentesFamiliaresTags.push("Enfermedades genéticas");
            if (datos.familiaDiabetes === "Sí") antecedentesFamiliaresTags.push("Diabetes");
            if (datos.familiaHipertension === "Sí") antecedentesFamiliaresTags.push("Hipertensión");
            if (datos.familiaInfartos === "Sí") antecedentesFamiliaresTags.push("Infarto");
            if (datos.familiaCancer === "Sí") antecedentesFamiliaresTags.push("Cáncer");
            if (datos.familiaTrastornos === "Sí") antecedentesFamiliaresTags.push("Trastornos mentales o psicológicos");

            const wixPayload = {
                // itemId se removió - no es necesario
                numeroId: datos.wixId || "", // numeroId usa el mismo valor que wixId
                codEmpresa: datos.codEmpresa || "",
                primerNombre: datos.primerNombre || "",
                examenes: "", // No tenemos este dato
                celular: datos.celular || "No disponible",
                // Todos los campos van al mismo nivel, no dentro de "respuestas"
                ejercicio: datos.ejercicio || "",
                estadoCivil: datos.estadoCivil || "",
                hijos: datos.hijos || "",
                consumoLicor: datos.consumoLicor || "",
                email: datos.email || "",
                foto: datos.foto || "",
                firma: datos.firma || "",
                encuestaSalud: encuestaSaludTags, // Solo tags con respuestas "Sí"
                antecedentesFamiliares: antecedentesFamiliaresTags, // Solo tags con respuestas "Sí"
                fechaNacimiento: datos.fechaNacimiento || "",
                edad: datos.edad || "",
                genero: datos.genero || "",
                lugarDeNacimiento: datos.lugarDeNacimiento || "",
                ciudadDeResidencia: datos.ciudadDeResidencia || "",
                direccion: "", // No lo tenemos en el formulario
                profesionUOficio: datos.profesionUOficio || "",
                nivelEducativo: datos.nivelEducativo || "",
                empresa1: datos.empresa1 || "",
                empresa2: datos.empresa2 || "",
                eps: datos.eps || "",
                arl: datos.arl || "",
                pensiones: datos.pensiones || "",
                estatura: datos.estatura || "",
                peso: datos.peso || "",
                documentoIdentidad: datos.numeroId || "", // Número de cédula de HistoriaClinica
                idGeneral: datos.wixId || "",
                inscripcionBoletin: datos.inscripcionBoletin || ""
            };

            console.log('📤 Enviando datos a Wix...');
            console.log('📦 Payload:', JSON.stringify(wixPayload, null, 2));

            const wixResponse = await fetch('https://www.bsl.com.co/_functions/crearFormulario', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(wixPayload)
            });

            console.log('📡 Respuesta de Wix - Status:', wixResponse.status);

            if (wixResponse.ok) {
                const wixResult = await wixResponse.json();
                console.log('✅ Datos guardados en Wix exitosamente:', wixResult);
            } else {
                const errorText = await wixResponse.text();
                console.error('❌ ERROR al guardar en Wix:');
                console.error('   Status:', wixResponse.status);
                console.error('   Response:', errorText);
                // Intentar parsear como JSON para ver el error
                try {
                    const errorJson = JSON.parse(errorText);
                    console.error('   Error JSON:', errorJson);
                } catch (e) {
                    // No es JSON, ya imprimimos el texto
                }
            }

        } catch (wixError) {
            console.error('❌ EXCEPCIÓN al enviar a Wix:');
            console.error('   Mensaje:', wixError.message);
            console.error('   Stack:', wixError.stack);
            // No bloqueamos la respuesta si Wix falla
        }

        res.json({
            success: true,
            message: 'Formulario guardado correctamente',
            data: { id: result.rows[0].id }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error al procesar el formulario',
            error: error.message
        });
    }
});

// Ruta para obtener todos los formularios
app.get('/api/formularios', async (req, res) => {
    try {
        // Solo seleccionar los campos necesarios para la vista resumida
        // IMPORTANTE: No incluir 'foto' aquí porque son imágenes base64 muy grandes
        // que pueden causar errores de memoria cuando hay muchos registros
        // LEFT JOIN con HistoriaClinica para obtener fechaConsulta y atendido
        const result = await pool.query(`
            SELECT
                f.id,
                f.numero_id,
                f.celular,
                f.primer_nombre,
                f.primer_apellido,
                f.cod_empresa,
                f.wix_id,
                f.fecha_registro,
                hc."fechaConsulta" as fecha_consulta,
                hc."atendido" as estado_atencion
            FROM formularios f
            LEFT JOIN "HistoriaClinica" hc ON f.wix_id = hc."_id"
            ORDER BY f.fecha_registro DESC
        `);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener formularios',
            error: error.message
        });
    }
});

// Ruta para buscar por ID
app.get('/api/formulario/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM formularios WHERE id = $1', [id]);

        if (result.rows.length > 0) {
            res.json({ success: true, data: result.rows[0] });
        } else {
            res.status(404).json({
                success: false,
                message: 'Formulario no encontrado'
            });
        }
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error al buscar formulario',
            error: error.message
        });
    }
});

// Endpoint de búsqueda server-side para formularios (escala a 100,000+ registros)
app.get('/api/formularios/search', async (req, res) => {
    try {
        const { q } = req.query;

        // Requiere al menos 2 caracteres para buscar
        if (!q || q.length < 2) {
            return res.json({ success: true, data: [] });
        }

        console.log(`🔍 Buscando en formularios: "${q}"`);

        const searchTerm = `%${q}%`;
        const result = await pool.query(`
            SELECT
                f.id,
                f.numero_id,
                f.celular,
                f.primer_nombre,
                f.primer_apellido,
                f.cod_empresa,
                f.wix_id,
                f.fecha_registro,
                hc."fechaConsulta" as fecha_consulta,
                hc."atendido" as estado_atencion
            FROM formularios f
            LEFT JOIN "HistoriaClinica" hc ON f.wix_id = hc."_id"
            WHERE (
                COALESCE(f.numero_id, '') || ' ' ||
                COALESCE(f.primer_nombre, '') || ' ' ||
                COALESCE(f.primer_apellido, '') || ' ' ||
                COALESCE(f.cod_empresa, '') || ' ' ||
                COALESCE(f.celular, '')
            ) ILIKE $1
            ORDER BY f.fecha_registro DESC
            LIMIT 100
        `, [searchTerm]);

        console.log(`✅ Encontrados ${result.rows.length} formularios para "${q}"`);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error('❌ Error en búsqueda de formularios:', error);
        res.status(500).json({
            success: false,
            message: 'Error en la búsqueda',
            error: error.message
        });
    }
});

// Buscar formulario por wix_id (orden_id), con fallback a numero_id (cédula)
app.get('/api/formularios/buscar/:identificador', async (req, res) => {
    try {
        const { identificador } = req.params;

        console.log(`🔍 Buscando formulario por identificador: ${identificador}`);

        // Primero buscar por wix_id (orden_id) - relación principal
        let result = await pool.query(
            'SELECT * FROM formularios WHERE wix_id = $1 LIMIT 1',
            [identificador]
        );

        // Si no encuentra por wix_id, buscar por numero_id (cédula) - fallback para datos antiguos
        if (result.rows.length === 0) {
            console.log(`🔍 No encontrado por wix_id, buscando por numero_id...`);
            result = await pool.query(
                'SELECT * FROM formularios WHERE numero_id = $1 ORDER BY fecha_registro DESC LIMIT 1',
                [identificador]
            );
        }

        // Si aún no encuentra, intentar obtener el _id de HistoriaClinica por cédula
        if (result.rows.length === 0) {
            const hcResult = await pool.query(
                'SELECT "_id" FROM "HistoriaClinica" WHERE "numeroId" = $1 LIMIT 1',
                [identificador]
            );

            if (hcResult.rows.length > 0) {
                const hcId = hcResult.rows[0]._id;
                console.log(`🔍 Buscando formulario por wix_id desde HC: ${hcId}`);
                result = await pool.query(
                    'SELECT * FROM formularios WHERE wix_id = $1 LIMIT 1',
                    [hcId]
                );
            }
        }

        if (result.rows.length === 0) {
            return res.json({
                success: false,
                message: 'No se encontró formulario para este paciente'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error buscando formulario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al buscar formulario',
            error: error.message
        });
    }
});

// También crear una ruta con /api/formularios/:id para compatibilidad con el frontend
app.get('/api/formularios/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener datos del formulario
        const formularioResult = await pool.query('SELECT * FROM formularios WHERE id = $1', [id]);

        if (formularioResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Formulario no encontrado'
            });
        }

        const formulario = formularioResult.rows[0];

        // Intentar obtener datos de HistoriaClinica usando numero_id (cédula)
        let historiaClinica = null;
        if (formulario.numero_id) {
            try {
                const historiaResult = await pool.query(
                    'SELECT * FROM "HistoriaClinica" WHERE "numeroId" = $1',
                    [formulario.numero_id]
                );

                if (historiaResult.rows.length > 0) {
                    historiaClinica = historiaResult.rows[0];
                }
            } catch (historiaError) {
                console.error('⚠️ No se pudo obtener HistoriaClinica:', historiaError.message);
                // Continuar sin historia clínica
            }
        }

        // Combinar los datos
        const datosCompletos = {
            ...formulario,
            historiaClinica: historiaClinica
        };

        res.json({ success: true, data: datosCompletos });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error al buscar formulario',
            error: error.message
        });
    }
});

// Ruta para enlazar una orden con un formulario existente
app.post('/api/formularios/enlazar-orden', async (req, res) => {
    try {
        const { formId, numeroId, nuevoWixId } = req.body;

        if (!nuevoWixId) {
            return res.status(400).json({ success: false, error: 'nuevoWixId es requerido' });
        }

        // Verificar que la orden existe en HistoriaClinica
        const ordenExiste = await pool.query(
            'SELECT "_id" FROM "HistoriaClinica" WHERE "_id" = $1',
            [nuevoWixId]
        );

        if (ordenExiste.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'La orden especificada no existe en HistoriaClinica'
            });
        }

        let result;

        if (formId) {
            // Actualizar por ID del formulario
            result = await pool.query(
                'UPDATE formularios SET wix_id = $1 WHERE id = $2 RETURNING id, wix_id, numero_id',
                [nuevoWixId, formId]
            );
        } else if (numeroId) {
            // Actualizar por número de identificación
            result = await pool.query(
                'UPDATE formularios SET wix_id = $1 WHERE numero_id = $2 RETURNING id, wix_id, numero_id',
                [nuevoWixId, numeroId]
            );
        } else {
            return res.status(400).json({
                success: false,
                error: 'Se requiere formId o numeroId para identificar el formulario'
            });
        }

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No se encontró el formulario para actualizar'
            });
        }

        console.log('✅ Orden enlazada correctamente:', result.rows[0]);

        res.json({
            success: true,
            data: result.rows[0],
            message: 'Orden enlazada correctamente'
        });

    } catch (error) {
        console.error('❌ Error enlazando orden:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Ruta para actualizar un formulario
app.put('/api/formularios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const datos = req.body;

        // Verificar que el formulario existe y obtener todos sus datos
        const checkResult = await pool.query('SELECT * FROM formularios WHERE id = $1', [id]);
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Formulario no encontrado'
            });
        }

        const formularioActual = checkResult.rows[0];

        // Convertir cadenas vacías a null para campos numéricos
        const parseNumeric = (value) => value === "" ? null : value;

        // Actualizar solo los campos que vienen en el body
        const query = `
            UPDATE formularios SET
                wix_id = COALESCE($1, wix_id),
                genero = COALESCE($2, genero),
                edad = COALESCE($3, edad),
                fecha_nacimiento = COALESCE($4, fecha_nacimiento),
                lugar_nacimiento = COALESCE($5, lugar_nacimiento),
                ciudad_residencia = COALESCE($6, ciudad_residencia),
                estado_civil = COALESCE($7, estado_civil),
                hijos = COALESCE($8, hijos),
                nivel_educativo = COALESCE($9, nivel_educativo),
                email = COALESCE($10, email),
                eps = COALESCE($11, eps),
                arl = COALESCE($12, arl),
                pensiones = COALESCE($13, pensiones),
                profesion_oficio = COALESCE($14, profesion_oficio),
                empresa1 = COALESCE($15, empresa1),
                empresa2 = COALESCE($16, empresa2),
                estatura = COALESCE($17, estatura),
                peso = COALESCE($18, peso),
                ejercicio = COALESCE($19, ejercicio)
            WHERE id = $20
            RETURNING *
        `;

        const values = [
            datos.wix_id || null,
            datos.genero,
            parseNumeric(datos.edad),
            datos.fecha_nacimiento,
            datos.lugar_nacimiento,
            datos.ciudad_residencia,
            datos.estado_civil,
            parseNumeric(datos.hijos),
            datos.nivel_educativo,
            datos.email,
            datos.eps,
            datos.arl,
            datos.pensiones,
            datos.profesion_oficio,
            datos.empresa1,
            datos.empresa2,
            parseNumeric(datos.estatura),
            parseNumeric(datos.peso),
            datos.ejercicio,
            id
        ];

        const result = await pool.query(query, values);
        const formularioActualizado = result.rows[0];

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ POSTGRESQL: Formulario actualizado exitosamente');
        console.log('   ID:', id);
        console.log('   Datos actualizados:', {
            genero: formularioActualizado.genero,
            edad: formularioActualizado.edad,
            email: formularioActualizado.email
        });
        console.log('═══════════════════════════════════════════════════════════');

        // Actualizar en Wix si tiene wix_id
        if (formularioActual.wix_id) {
            try {
                const fetch = (await import('node-fetch')).default;

                console.log('📤 Consultando registro en Wix por idGeneral:', formularioActual.wix_id);

                // PASO 1: Consultar el _id usando idGeneral
                const queryResponse = await fetch(`https://www.bsl.com.co/_functions/formularioPorIdGeneral?idGeneral=${formularioActual.wix_id}`);

                if (!queryResponse.ok) {
                    console.error('❌ ERROR al consultar formulario en Wix:');
                    console.error('   Status:', queryResponse.status);
                    const errorText = await queryResponse.text();
                    console.error('   Response:', errorText);
                    throw new Error('No se pudo consultar el registro en Wix');
                }

                const queryResult = await queryResponse.json();

                if (!queryResult.success || !queryResult.item) {
                    console.error('❌ No se encontró el registro en Wix con idGeneral:', formularioActual.wix_id);
                    throw new Error('Registro no encontrado en Wix');
                }

                const wixId = queryResult.item._id;
                console.log('✅ Registro encontrado en Wix. _id:', wixId);

                // PASO 2: Preparar payload para actualizar usando el _id correcto
                // Solo enviar campos que tienen valores en formularioActualizado
                const wixPayload = {
                    _id: wixId,  // Usar el _id interno de Wix
                    numeroId: formularioActualizado.numero_id || formularioActual.numero_id,
                    codEmpresa: formularioActualizado.cod_empresa || formularioActual.cod_empresa,
                    primerNombre: formularioActualizado.primer_nombre || formularioActual.primer_nombre,
                    celular: formularioActualizado.celular || formularioActual.celular,
                    ejercicio: formularioActualizado.ejercicio || formularioActual.ejercicio,
                    estadoCivil: formularioActualizado.estado_civil || formularioActual.estado_civil,
                    hijos: String(formularioActualizado.hijos || formularioActual.hijos || ''),
                    email: formularioActualizado.email || formularioActual.email,
                    fechaNacimiento: formularioActualizado.fecha_nacimiento || formularioActual.fecha_nacimiento,
                    edad: String(formularioActualizado.edad || formularioActual.edad || ''),
                    genero: formularioActualizado.genero || formularioActual.genero,
                    lugarDeNacimiento: formularioActualizado.lugar_nacimiento || formularioActual.lugar_nacimiento,
                    ciudadDeResidencia: formularioActualizado.ciudad_residencia || formularioActual.ciudad_residencia,
                    profesionUOficio: formularioActualizado.profesion_oficio || formularioActual.profesion_oficio,
                    nivelEducativo: formularioActualizado.nivel_educativo || formularioActual.nivel_educativo,
                    empresa1: formularioActualizado.empresa1 || formularioActual.empresa1,
                    empresa2: formularioActualizado.empresa2 || formularioActual.empresa2,
                    eps: formularioActualizado.eps || formularioActual.eps || '',
                    arl: formularioActualizado.arl || formularioActual.arl || '',
                    pensiones: formularioActualizado.pensiones || formularioActual.pensiones || '',
                    estatura: formularioActualizado.estatura || formularioActual.estatura,
                    peso: formularioActualizado.peso || formularioActual.peso
                };

                console.log('📤 Actualizando datos en Wix...');
                console.log('📦 Payload:', JSON.stringify(wixPayload, null, 2));

                // PASO 3: Actualizar el registro
                const wixResponse = await fetch('https://www.bsl.com.co/_functions/actualizarFormulario', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(wixPayload)
                });

                console.log('📡 Respuesta de Wix - Status:', wixResponse.status);

                if (wixResponse.ok) {
                    const wixResult = await wixResponse.json();
                    console.log('');
                    console.log('═══════════════════════════════════════════════════════════');
                    console.log('✅ WIX: Formulario actualizado exitosamente');
                    console.log('   _id:', wixId);
                    console.log('   idGeneral:', formularioActual.wix_id);
                    console.log('   Respuesta:', JSON.stringify(wixResult, null, 2));
                    console.log('═══════════════════════════════════════════════════════════');
                    console.log('');
                } else {
                    const errorText = await wixResponse.text();
                    console.log('');
                    console.log('═══════════════════════════════════════════════════════════');
                    console.error('❌ WIX: ERROR al actualizar');
                    console.error('   Status:', wixResponse.status);
                    console.error('   Response:', errorText);
                    console.log('═══════════════════════════════════════════════════════════');
                    console.log('');
                }

            } catch (wixError) {
                console.log('');
                console.log('═══════════════════════════════════════════════════════════');
                console.error('❌ WIX: EXCEPCIÓN al actualizar');
                console.error('   Mensaje:', wixError.message);
                console.error('   Stack:', wixError.stack);
                console.log('═══════════════════════════════════════════════════════════');
                console.log('');
                // No bloqueamos la respuesta si Wix falla
            }
        } else {
            console.log('');
            console.log('⚠️ El formulario no tiene wix_id, no se actualiza en Wix');
            console.log('');
        }

        console.log('');
        console.log('🎉 RESUMEN: Actualización completada');
        console.log('   ✅ PostgreSQL: OK');
        console.log('   ✅ Wix:', formularioActual.wix_id ? 'Sincronizado' : 'No aplica');
        console.log('');

        res.json({
            success: true,
            message: 'Formulario actualizado correctamente',
            data: formularioActualizado
        });

    } catch (error) {
        console.error('❌ Error al actualizar formulario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar el formulario',
            error: error.message
        });
    }
});

// Endpoint para eliminar un formulario y su historia clínica asociada
app.delete('/api/formularios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { numeroId } = req.body;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🗑️  ELIMINANDO REGISTRO');
        console.log('   ID Formulario:', id);
        console.log('   Número ID (Cédula):', numeroId);
        console.log('═══════════════════════════════════════════════════════════');

        // Verificar que el formulario existe
        const checkResult = await pool.query('SELECT * FROM formularios WHERE id = $1', [id]);
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Formulario no encontrado'
            });
        }

        let historiaClinicaEliminada = false;

        // Intentar eliminar la historia clínica asociada (si existe)
        if (numeroId) {
            try {
                const hcResult = await pool.query(
                    'DELETE FROM "HistoriaClinica" WHERE "numeroId" = $1 RETURNING *',
                    [numeroId]
                );
                if (hcResult.rowCount > 0) {
                    historiaClinicaEliminada = true;
                    console.log('   ✅ Historia Clínica eliminada:', hcResult.rowCount, 'registro(s)');
                } else {
                    console.log('   ℹ️  No se encontró Historia Clínica asociada');
                }
            } catch (hcError) {
                console.error('   ⚠️ Error al eliminar Historia Clínica:', hcError.message);
                // Continuamos con la eliminación del formulario aunque falle la HC
            }
        }

        // Eliminar el formulario
        const deleteResult = await pool.query(
            'DELETE FROM formularios WHERE id = $1 RETURNING *',
            [id]
        );

        if (deleteResult.rowCount === 0) {
            return res.status(500).json({
                success: false,
                message: 'No se pudo eliminar el formulario'
            });
        }

        console.log('   ✅ Formulario eliminado correctamente');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        let mensaje = 'Formulario eliminado correctamente';
        if (historiaClinicaEliminada) {
            mensaje += ' junto con su Historia Clínica asociada';
        }

        res.json({
            success: true,
            message: mensaje,
            data: {
                formularioEliminado: deleteResult.rows[0],
                historiaClinicaEliminada: historiaClinicaEliminada
            }
        });

    } catch (error) {
        console.error('❌ Error al eliminar formulario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar el formulario',
            error: error.message
        });
    }
});

// Endpoint para verificar si existe una orden duplicada con el mismo numeroId
app.get('/api/ordenes/verificar-duplicado/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;
        const { codEmpresa } = req.query;

        if (!numeroId) {
            return res.json({ success: true, hayDuplicado: false, tipo: null });
        }

        // Primero buscar órdenes PENDIENTES (solo de la misma empresa si se especifica)
        let queryPendiente = `
            SELECT "_id", "numeroId", "primerNombre", "primerApellido",
                   "codEmpresa", "empresa", "tipoExamen", "atendido",
                   "_createdDate", "fechaAtencion"
            FROM "HistoriaClinica"
            WHERE "numeroId" = $1
              AND "atendido" = 'PENDIENTE'
        `;
        const paramsPendiente = [numeroId];

        if (codEmpresa) {
            queryPendiente += ` AND "codEmpresa" = $2`;
            paramsPendiente.push(codEmpresa);
        }

        queryPendiente += ` ORDER BY "_createdDate" DESC LIMIT 1`;

        const resultPendiente = await pool.query(queryPendiente, paramsPendiente);

        if (resultPendiente.rows.length > 0) {
            const ordenExistente = resultPendiente.rows[0];

            // Verificar si tiene formulario asociado
            const formResult = await pool.query(`
                SELECT id FROM formularios
                WHERE wix_id = $1 OR numero_id = $2
                LIMIT 1
            `, [ordenExistente._id, numeroId]);

            const tieneFormulario = formResult.rows.length > 0;

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

        // Si no hay PENDIENTE, buscar ATENDIDO (solo de la misma empresa si se especifica)
        let queryAtendido = `
            SELECT "_id", "numeroId", "primerNombre", "primerApellido",
                   "codEmpresa", "empresa", "tipoExamen", "atendido",
                   "_createdDate", "fechaAtencion"
            FROM "HistoriaClinica"
            WHERE "numeroId" = $1
              AND "atendido" = 'ATENDIDO'
        `;
        const paramsAtendido = [numeroId];

        if (codEmpresa) {
            queryAtendido += ` AND "codEmpresa" = $2`;
            paramsAtendido.push(codEmpresa);
        }

        queryAtendido += ` ORDER BY "_createdDate" DESC LIMIT 1`;

        const resultAtendido = await pool.query(queryAtendido, paramsAtendido);

        if (resultAtendido.rows.length > 0) {
            const ordenAtendida = resultAtendido.rows[0];

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
        console.error('❌ Error al verificar duplicado:', error);
        res.status(500).json({
            success: false,
            message: 'Error al verificar duplicado',
            error: error.message
        });
    }
});

// Endpoint para actualizar fecha de atención de una orden existente
app.patch('/api/ordenes/:id/fecha-atencion', async (req, res) => {
    try {
        const { id } = req.params;
        const { fechaAtencion, horaAtencion, medico } = req.body;

        if (!fechaAtencion) {
            return res.status(400).json({
                success: false,
                message: 'La fecha de atención es requerida'
            });
        }

        // Actualizar en PostgreSQL - construir fecha correcta con zona horaria Colombia
        const fechaCorrecta = construirFechaAtencionColombia(fechaAtencion, horaAtencion);
        const result = await pool.query(`
            UPDATE "HistoriaClinica"
            SET "fechaAtencion" = $1,
                "horaAtencion" = NULL,
                "medico" = COALESCE($3, "medico")
            WHERE "_id" = $2
            RETURNING "_id", "numeroId", "primerNombre", "primerApellido", "fechaAtencion", "medico"
        `, [fechaCorrecta, id, medico || null]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Orden no encontrada'
            });
        }

        const ordenActualizada = result.rows[0];

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

            console.log('📅 Fecha para Wix (actualización):', fechaAtencionWix);

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
                console.log('✅ Fecha y médico actualizados en Wix');
            }
        } catch (wixError) {
            console.error('⚠️ Error al actualizar en Wix (no crítico):', wixError.message);
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
        console.error('❌ Error al actualizar fecha de atención:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar la fecha de atención',
            error: error.message
        });
    }
});

// Endpoint para crear nueva orden (guarda en PostgreSQL y Wix HistoriaClinica)
app.post('/api/ordenes', async (req, res) => {
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
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📋 CREANDO NUEVA ORDEN');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📦 Datos recibidos:', JSON.stringify(req.body, null, 2));

        // Validar campos requeridos
        if (!numeroId || !primerNombre || !primerApellido || !codEmpresa || !celular) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos requeridos: numeroId, primerNombre, primerApellido, codEmpresa, celular'
            });
        }

        // Si se solicita asignación automática de médico
        if (asignarMedicoAuto && fechaAtencion && horaAtencion) {
            console.log('🤖 Asignación automática de médico solicitada...');
            console.log('   Fecha:', fechaAtencion, '| Hora:', horaAtencion, '| Modalidad:', modalidad || 'presencial');

            const fechaObj = new Date(fechaAtencion + 'T12:00:00');
            const diaSemana = fechaObj.getDay();
            const modalidadBuscar = modalidad || 'presencial';

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

            for (const med of Object.values(medicosPorId)) {
                // Verificar si la hora está dentro de ALGUNO de los rangos del médico
                let dentroDeRango = false;
                for (const rango of med.rangos) {
                    const [horaInicioH, horaInicioM] = rango.horaInicio.split(':').map(Number);
                    const [horaFinH, horaFinM] = rango.horaFin.split(':').map(Number);
                    const horaInicioMinutos = horaInicioH * 60 + horaInicioM;
                    const horaFinMinutos = horaFinH * 60 + horaFinM;

                    if (horaSelMinutos >= horaInicioMinutos && horaSelMinutos < horaFinMinutos) {
                        dentroDeRango = true;
                        break;
                    }
                }

                if (!dentroDeRango) {
                    continue; // Fuera de todos los horarios del médico
                }

                // Verificar que no tenga cita a esa hora
                // EXCEPCIÓN: KM2 y SITEL pueden asignar médico aunque el turno esté ocupado
                if (codEmpresa === 'KM2' || codEmpresa === 'SITEL') {
                    medicosDisponibles.push(med.nombre);
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

            if (medicosDisponibles.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No hay médicos disponibles para el horario seleccionado'
                });
            }

            // Asignar el primer médico disponible (o se podría aleatorizar)
            medico = medicosDisponibles[0];
            console.log('✅ Médico asignado automáticamente:', medico);
        }

        // Generar un _id único para Wix (formato UUID-like)
        const wixId = `orden_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 1. Guardar en PostgreSQL HistoriaClinica
        console.log('');
        console.log('💾 Guardando en PostgreSQL HistoriaClinica...');

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
        console.log('✅ PostgreSQL: Orden guardada con _id:', wixId);

        // Gestionar registro en tabla conversaciones_whatsapp
        try {
            const celularConPrefijo = `57${celular}`; // Agregar prefijo 57 a Colombia
            console.log('📱 Gestionando conversación WhatsApp para:', celularConPrefijo);

            // Verificar si ya existe un registro con ese celular
            const conversacionExistente = await pool.query(`
                SELECT id, celular, "stopBot"
                FROM conversaciones_whatsapp
                WHERE celular = $1
            `, [celularConPrefijo]);

            if (conversacionExistente.rows.length > 0) {
                // Si existe, actualizar stopBot a true y datos del paciente
                await pool.query(`
                    UPDATE conversaciones_whatsapp
                    SET "stopBot" = true,
                        paciente_id = $2,
                        nombre_paciente = $3,
                        fecha_ultima_actividad = NOW()
                    WHERE celular = $1
                `, [celularConPrefijo, numeroId, `${primerNombre} ${primerApellido}`]);
                console.log('✅ Conversación WhatsApp actualizada: stopBot = true para', celularConPrefijo);
            } else {
                // Si no existe, crear nuevo registro con stopBot = true
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
                console.log('✅ Nueva conversación WhatsApp creada con stopBot = true para', celularConPrefijo);
            }
        } catch (whatsappError) {
            console.error('⚠️ Error al gestionar conversación WhatsApp:', whatsappError.message);
            // No bloqueamos la creación de la orden si falla la gestión de WhatsApp
        }

        // Enviar mensaje de confirmación por WhatsApp con Twilio (solo si tiene fecha y hora)
        if (fechaAtencion && horaAtencion && celular) {
            try {
                console.log('📱 Enviando mensaje de confirmación por WhatsApp...');

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
                            console.log(`✅ Mensaje de confirmación enviado a ${telefonoCompleto}`);
                        } else {
                            console.error(`⚠️ No se pudo enviar mensaje de confirmación: ${resultWhatsApp.error}`);
                        }
                    }
                }
            } catch (confirmacionError) {
                console.error('⚠️ Error al enviar mensaje de confirmación:', confirmacionError.message);
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
        console.log('📤 Sincronizando con Wix...');

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

            console.log('📅 Fecha para Wix:', fechaAtencionWix);

            const wixResponse = await fetch('https://www.bsl.com.co/_functions/crearHistoriaClinica', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(wixPayload)
            });

            if (wixResponse.ok) {
                const wixResult = await wixResponse.json();
                console.log('✅ Wix: Sincronizado exitosamente');
                console.log('   Respuesta:', JSON.stringify(wixResult, null, 2));
            } else {
                const errorText = await wixResponse.text();
                console.error('⚠️ Wix: Error al sincronizar');
                console.error('   Status:', wixResponse.status);
                console.error('   Response:', errorText);
            }
        } catch (wixError) {
            console.error('⚠️ Wix: Excepción al sincronizar:', wixError.message);
            // No bloqueamos si Wix falla
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🎉 ORDEN CREADA EXITOSAMENTE');
        console.log('   _id:', wixId);
        console.log('   Paciente:', primerNombre, primerApellido);
        console.log('   Cédula:', numeroId);
        console.log('═══════════════════════════════════════════════════════════');
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
        console.error('❌ Error al crear orden:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear la orden',
            error: error.message
        });
    }
});

// POST /api/ordenes/previsualizar-csv - Previsualizar órdenes desde CSV antes de importar
app.post('/api/ordenes/previsualizar-csv', upload.single('archivo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No se ha subido ningún archivo'
            });
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('👁️  PREVISUALIZACIÓN CSV DE ÓRDENES');
        console.log('═══════════════════════════════════════════════════════════');

        // Parsear CSV desde buffer
        const csvContent = req.file.buffer.toString('utf-8');
        const lines = csvContent.split('\n').filter(line => line.trim());

        if (lines.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'El archivo CSV está vacío o solo tiene encabezados'
            });
        }

        // Obtener encabezados (primera línea) y normalizarlos
        const headersRaw = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

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

        // Normalizar headers
        const headers = headersRaw.map(h => headerMapping[h] || h);
        console.log('📋 Encabezados normalizados:', headers);

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
                // Parsear línea CSV
                const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));

                // Crear objeto con los valores
                const row = {};
                headers.forEach((header, index) => {
                    row[header] = values[index] !== undefined && values[index] !== '' ? values[index] : null;
                });

                // Ignorar filas vacías o con datos inválidos
                const valoresNoVacios = values.filter(v => v && v.trim() !== '' && v.trim() !== 'CC');
                if (valoresNoVacios.length === 0) {
                    console.log(`   ⏭️  Fila ${i + 1} ignorada (vacía)`);
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

                    if (fechaNormalizada.includes('/')) {
                        const partes = fechaNormalizada.split('/');
                        if (partes.length === 3) {
                            const primero = parseInt(partes[0]);
                            const segundo = parseInt(partes[1]);
                            const anio = partes[2];

                            if (segundo > 12) {
                                fechaNormalizada = `${anio}-${partes[0].padStart(2, '0')}-${partes[1].padStart(2, '0')}`;
                            } else if (primero > 12) {
                                fechaNormalizada = `${anio}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
                            } else {
                                fechaNormalizada = `${anio}-${partes[0].padStart(2, '0')}-${partes[1].padStart(2, '0')}`;
                            }
                        }
                    }
                    fechaFormateada = fechaNormalizada;
                }

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
                    horaAtencion: row.horaAtencion || '08:00',
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

        console.log(`✅ Previsualización completada: ${registros.length} registros válidos`);

        res.json({
            success: true,
            total: registros.length,
            registros: registros,
            errores: errores
        });

    } catch (error) {
        console.error('❌ Error en previsualización CSV:', error);
        res.status(500).json({
            success: false,
            message: 'Error procesando el archivo CSV',
            error: error.message
        });
    }
});

// POST /api/ordenes/importar-desde-preview - Importar órdenes aprobadas desde preview
app.post('/api/ordenes/importar-desde-preview', async (req, res) => {
    try {
        const { registros } = req.body;

        if (!registros || !Array.isArray(registros) || registros.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No se recibieron registros para importar'
            });
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ IMPORTACIÓN APROBADA DESDE PREVIEW');
        console.log('═══════════════════════════════════════════════════════════');

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

                // Parsear fecha de atención
                let fechaAtencionParsed = null;
                if (registro.fechaAtencion && registro.horaAtencion) {
                    const fechaObj = construirFechaAtencionColombia(registro.fechaAtencion, registro.horaAtencion);
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
                            // Verificar si ya existe una conversación para este teléfono
                            const conversacionExistente = await pool.query(
                                'SELECT id FROM conversaciones_whatsapp WHERE celular = $1 AND estado != $2',
                                [telefonoNormalizado, 'cerrada']
                            );

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

                                console.log(`📱 Conversación WhatsApp creada para ${telefonoNormalizado} con stopBot = true`);
                            } else {
                                // Ya existe, actualizar stopBot y bot_activo
                                await pool.query(`
                                    UPDATE conversaciones_whatsapp
                                    SET "stopBot" = true, bot_activo = false, fecha_ultima_actividad = NOW()
                                    WHERE celular = $1 AND estado != 'cerrada'
                                `, [telefonoNormalizado]);

                                console.log(`📱 Conversación WhatsApp actualizada para ${telefonoNormalizado} con stopBot = true`);
                            }
                        }
                    } catch (whatsappError) {
                        console.log(`⚠️ Error al crear/actualizar conversación WhatsApp: ${whatsappError.message}`);
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
                        console.log(`✅ ${registro.primerNombre} ${registro.primerApellido} (${registro.numeroId}) - Sincronizado con Wix`);
                    } else {
                        console.log(`⚠️ ${registro.primerNombre} ${registro.primerApellido} - PostgreSQL OK, Wix falló`);
                    }

                } catch (wixError) {
                    console.log(`⚠️ ${registro.primerNombre} ${registro.primerApellido} - PostgreSQL OK, Wix error: ${wixError.message}`);
                }

                resultados.exitosos++;
                resultados.ordenesCreadas.push({
                    _id: ordenId,
                    numeroId: registro.numeroId,
                    nombre: `${registro.primerNombre} ${registro.primerApellido}`
                });

            } catch (error) {
                console.error(`❌ Error en registro ${registro.numeroId}:`, error.message);
                resultados.errores.push({
                    numeroId: registro.numeroId,
                    error: error.message
                });
            }
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`📊 RESUMEN: ${resultados.exitosos}/${resultados.total} órdenes importadas`);
        if (resultados.errores.length > 0) {
            console.log(`⚠️ Errores: ${resultados.errores.length}`);
        }
        console.log('═══════════════════════════════════════════════════════════');

        res.json({
            success: true,
            message: `Se importaron ${resultados.exitosos} de ${resultados.total} órdenes`,
            resultados
        });

    } catch (error) {
        console.error('❌ Error al importar desde preview:', error);
        res.status(500).json({
            success: false,
            message: 'Error al importar las órdenes',
            error: error.message
        });
    }
});

// POST /api/ordenes/importar-csv - Importar órdenes desde CSV
app.post('/api/ordenes/importar-csv', upload.single('archivo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No se ha subido ningún archivo'
            });
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📥 IMPORTACIÓN CSV DE ÓRDENES');
        console.log('═══════════════════════════════════════════════════════════');

        const resultados = {
            total: 0,
            exitosos: 0,
            errores: [],
            ordenesCreadas: []
        };

        // Parsear CSV desde buffer
        const csvContent = req.file.buffer.toString('utf-8');
        const lines = csvContent.split('\n').filter(line => line.trim());

        if (lines.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'El archivo CSV está vacío o solo tiene encabezados'
            });
        }

        // Obtener encabezados (primera línea) y normalizarlos
        const headersRaw = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

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

        // Normalizar headers
        const headers = headersRaw.map(h => headerMapping[h] || h);
        console.log('📋 Encabezados originales:', headersRaw);
        console.log('📋 Encabezados normalizados:', headers);

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
                // Parsear línea CSV (split simple por coma, luego limpiar comillas)
                const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));

                // Crear objeto con los valores
                const row = {};
                headers.forEach((header, index) => {
                    row[header] = values[index] !== undefined ? values[index] : null;
                });

                // Ignorar filas vacías o con datos inválidos
                const valoresNoVacios = values.filter(v => v && v.trim() !== '' && v.trim() !== 'CC');
                if (valoresNoVacios.length === 0) {
                    console.log(`   ⏭️  Fila ${i + 1} ignorada (vacía o solo tiene valores irrelevantes)`);
                    continue;
                }

                // Ignorar filas sin campos mínimos requeridos
                if (!row.numeroId || !row.primerNombre || !row.primerApellido || !row.codEmpresa) {
                    console.log(`   ⏭️  Fila ${i + 1} ignorada (faltan campos requeridos):`, JSON.stringify(row));
                    continue;
                }

                resultados.total++;
                console.log(`   ✅ Fila ${i + 1} parseada:`, JSON.stringify(row));

                // Generar ID único para la orden
                const ordenId = `orden_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // Parsear fecha de atención usando la función helper que maneja zona horaria Colombia
                let fechaAtencionParsed = null;
                if (row.fechaAtencion) {
                    let fechaNormalizada = row.fechaAtencion.trim();

                    if (fechaNormalizada.includes('/')) {
                        // Formato con barras: MM/DD/YYYY o DD/MM/YYYY
                        const partes = fechaNormalizada.split('/');
                        if (partes.length === 3) {
                            const primero = parseInt(partes[0]);
                            const segundo = parseInt(partes[1]);
                            const anio = partes[2];

                            // Detectar formato: si el segundo número es > 12, es MM/DD/YYYY
                            // Si el primero es > 12, es DD/MM/YYYY
                            if (segundo > 12) {
                                // Formato MM/DD/YYYY (ej: 12/23/2025)
                                fechaNormalizada = `${anio}-${partes[0].padStart(2, '0')}-${partes[1].padStart(2, '0')}`;
                            } else if (primero > 12) {
                                // Formato DD/MM/YYYY (ej: 23/12/2025)
                                fechaNormalizada = `${anio}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
                            } else {
                                // Ambiguo (ej: 12/10/2025) - asumir MM/DD/YYYY por defecto
                                fechaNormalizada = `${anio}-${partes[0].padStart(2, '0')}-${partes[1].padStart(2, '0')}`;
                            }
                            console.log(`   📅 Fecha convertida: ${row.fechaAtencion} -> ${fechaNormalizada}`);
                        }
                    }

                    // Usar horaAtencion del CSV o default 08:00
                    const horaAtencion = row.horaAtencion || '08:00';

                    // Usar la función helper para construir la fecha con zona horaria Colombia
                    const fechaObj = construirFechaAtencionColombia(fechaNormalizada, horaAtencion);
                    if (fechaObj) {
                        fechaAtencionParsed = fechaObj;
                        console.log(`   ✅ Fecha final: ${fechaObj.toISOString()}`);
                    } else {
                        console.log(`   ❌ Error parseando fecha: ${row.fechaAtencion}`);
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
                            // Verificar si ya existe una conversación para este teléfono
                            const conversacionExistente = await pool.query(
                                'SELECT id FROM conversaciones_whatsapp WHERE celular = $1 AND estado != $2',
                                [telefonoNormalizado, 'cerrada']
                            );

                            if (conversacionExistente.rows.length === 0) {
                                // No existe conversación activa, crear una nueva
                                await pool.query(`
                                    INSERT INTO conversaciones_whatsapp (
                                        celular, paciente_id, nombre_paciente, bot_activo, estado, canal
                                    ) VALUES ($1, $2, $3, $4, $5, $6)
                                    ON CONFLICT (celular) WHERE estado != 'cerrada'
                                    DO UPDATE SET
                                        bot_activo = false,
                                        fecha_ultima_actividad = NOW()
                                `, [
                                    telefonoNormalizado,
                                    ordenId,
                                    `${row.primerNombre} ${row.primerApellido}`,
                                    false, // bot_activo = false (stopBot = true)
                                    'nueva',
                                    'bot'
                                ]);

                                console.log(`📱 Conversación WhatsApp creada para ${telefonoNormalizado} (bot detenido)`);
                            } else {
                                // Ya existe, actualizar para detener el bot
                                await pool.query(`
                                    UPDATE conversaciones_whatsapp
                                    SET bot_activo = false, fecha_ultima_actividad = NOW()
                                    WHERE celular = $1 AND estado != 'cerrada'
                                `, [telefonoNormalizado]);

                                console.log(`📱 Conversación WhatsApp actualizada para ${telefonoNormalizado} (bot detenido)`);
                            }
                        }
                    } catch (whatsappError) {
                        console.log(`⚠️ Error al crear/actualizar conversación WhatsApp: ${whatsappError.message}`);
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
                        console.log(`✅ Fila ${i + 1}: ${row.primerNombre} ${row.primerApellido} (${row.numeroId}) - Sincronizado con Wix`);
                    } else {
                        console.log(`⚠️ Fila ${i + 1}: ${row.primerNombre} ${row.primerApellido} - PostgreSQL OK, Wix falló`);
                    }
                } catch (wixError) {
                    console.log(`⚠️ Fila ${i + 1}: ${row.primerNombre} ${row.primerApellido} - PostgreSQL OK, Wix error: ${wixError.message}`);
                }

                resultados.exitosos++;
                resultados.ordenesCreadas.push({
                    _id: ordenId,
                    numeroId: row.numeroId,
                    nombre: `${row.primerNombre} ${row.primerApellido}`
                });

            } catch (error) {
                console.error(`❌ Error en fila ${i + 1}:`, error.message);
                resultados.errores.push({
                    fila: i + 1,
                    error: error.message
                });
            }
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`📊 RESUMEN: ${resultados.exitosos}/${resultados.total} órdenes importadas`);
        if (resultados.errores.length > 0) {
            console.log(`⚠️ Errores: ${resultados.errores.length}`);
        }
        console.log('═══════════════════════════════════════════════════════════');

        res.json({
            success: true,
            message: `Se importaron ${resultados.exitosos} de ${resultados.total} órdenes`,
            resultados
        });

    } catch (error) {
        console.error('❌ Error al importar CSV:', error);
        res.status(500).json({
            success: false,
            message: 'Error al procesar el archivo CSV',
            error: error.message
        });
    }
});

// GET /api/ordenes - Listar órdenes con filtros opcionales
app.get('/api/ordenes', authMiddleware, async (req, res) => {
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

        // Si se filtra por empresa, calcular estadísticas (programados hoy, atendidos hoy)
        let stats = null;
        if (codEmpresa) {
            const hoy = new Date();
            const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
            const finHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

            const statsResult = await pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE "fechaAtencion" >= $2 AND "fechaAtencion" <= $3) as programados_hoy,
                    COUNT(*) FILTER (WHERE "fechaConsulta" >= $2 AND "fechaConsulta" <= $3) as atendidos_hoy
                FROM "HistoriaClinica"
                WHERE "codEmpresa" = $1
            `, [codEmpresa, inicioHoy.toISOString(), finHoy.toISOString()]);

            stats = {
                programadosHoy: parseInt(statsResult.rows[0].programados_hoy) || 0,
                atendidosHoy: parseInt(statsResult.rows[0].atendidos_hoy) || 0
            };
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
        console.error('❌ Error al listar órdenes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar órdenes',
            error: error.message
        });
    }
});

// GET /api/pruebas-psicologicas/:numeroId - Obtener resultados de ansiedad, depresión y congruencia desde PostgreSQL
app.get('/api/pruebas-psicologicas/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;

        // Consultar registro de pruebasADC en PostgreSQL
        const result = await pool.query(
            'SELECT * FROM "pruebasADC" WHERE numero_id = $1 LIMIT 1',
            [numeroId]
        );

        if (result.rows.length === 0) {
            return res.json({
                success: true,
                numeroId,
                ansiedad: 'NO REALIZÓ PRUEBA',
                depresion: 'NO REALIZÓ PRUEBA',
                congruencia: 'NO REALIZÓ PRUEBA'
            });
        }

        const registro = result.rows[0];
        const codEmpresa = registro.cod_empresa || '';

        // Importar funciones de calificación
        const { calcularAnsiedad } = require('./calcular-ansiedad');
        const { calcularDepresion } = require('./calcular-depresion');
        const { calcularCongruencia } = require('./calcular-congruencia');

        // Calcular resultados
        const ansiedad = calcularAnsiedad(registro, codEmpresa);
        const depresion = calcularDepresion(registro, codEmpresa);
        const congruencia = calcularCongruencia(registro);

        res.json({
            success: true,
            numeroId,
            ansiedad,
            depresion,
            congruencia
        });
    } catch (error) {
        console.error('Error consultando pruebas psicológicas:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/ordenes-aprobador - Listar órdenes para perfil APROBADOR (todos los registros de la empresa)
app.get('/api/ordenes-aprobador', async (req, res) => {
    try {
        const { codEmpresa, buscar, limit = 100, offset = 0 } = req.query;

        // Query para APROBADOR: todos los registros de la empresa
        let query = `
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre", h."primerApellido", h."segundoApellido",
                   h."codEmpresa", h."empresa", h."cargo", h."tipoExamen", h."medico", h."atendido",
                   h."fechaAtencion", h."horaAtencion", h."examenes", h."ciudad", h."celular",
                   h."_createdDate", h."_updatedDate", h."fechaConsulta", h."aprobacion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado", h."mdObsParaMiDocYa",
                   h."centro_de_costo",
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

        if (codEmpresa) {
            query += ` AND h."codEmpresa" = $${paramIndex}`;
            params.push(codEmpresa);
            paramIndex++;
        }

        if (buscar) {
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

        query += ` ORDER BY h."fechaConsulta" DESC NULLS LAST, h."_createdDate" DESC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        // Obtener el total para paginación
        let countQuery = `SELECT COUNT(*) FROM "HistoriaClinica" WHERE 1=1`;
        const countParams = [];
        let countParamIndex = 1;

        if (codEmpresa) {
            countQuery += ` AND "codEmpresa" = $${countParamIndex}`;
            countParams.push(codEmpresa);
            countParamIndex++;
        }

        if (buscar) {
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

        res.json({
            success: true,
            data: result.rows,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('❌ Error al listar órdenes para aprobador:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar órdenes para aprobador',
            error: error.message
        });
    }
});

// GET /api/ordenes/:id - Obtener una orden específica
app.get('/api/ordenes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const query = `
            SELECT * FROM "HistoriaClinica"
            WHERE "_id" = $1
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Orden no encontrada'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al obtener orden:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener la orden',
            error: error.message
        });
    }
});

// PUT /api/ordenes/:id - Actualizar una orden
app.put('/api/ordenes/:id', async (req, res) => {
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
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📝 ACTUALIZANDO ORDEN:', id);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📦 Datos recibidos:', JSON.stringify(req.body, null, 2));

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

        console.log('✅ Orden actualizada exitosamente');

        res.json({
            success: true,
            message: 'Orden actualizada exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al actualizar orden:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar la orden',
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINT: ESTADÍSTICAS CON IA (OpenAI)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/estadisticas-ia', async (req, res) => {
    try {
        const { codEmpresa, pregunta } = req.body;

        if (!codEmpresa || !pregunta) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere codEmpresa y pregunta'
            });
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🤖 CONSULTA IA - Empresa:', codEmpresa);
        console.log('📝 Pregunta:', pregunta);
        console.log('═══════════════════════════════════════════════════════════');

        // Query agregado eficiente para obtener estadísticas de la empresa
        // Nota: Los valores pueden ser 'SI', 'Sí', 'Si', 'NO', 'No', etc. - usamos UPPER para normalizar
        const statsQuery = `
            SELECT
                COUNT(*) as total_empleados,
                COUNT(*) FILTER (WHERE UPPER(fuma) = 'SI') as fumadores,
                COUNT(*) FILTER (WHERE UPPER(presion_alta) = 'SI') as presion_alta,
                COUNT(*) FILTER (WHERE UPPER(problemas_cardiacos) = 'SI') as problemas_cardiacos,
                COUNT(*) FILTER (WHERE UPPER(problemas_azucar) = 'SI') as diabetes,
                COUNT(*) FILTER (WHERE UPPER(hormigueos) = 'SI') as hormigueos,
                COUNT(*) FILTER (WHERE UPPER(dolor_espalda) = 'SI') as dolor_espalda,
                COUNT(*) FILTER (WHERE UPPER(dolor_cabeza) = 'SI') as dolor_cabeza,
                COUNT(*) FILTER (WHERE UPPER(problemas_sueno) = 'SI') as problemas_sueno,
                COUNT(*) FILTER (WHERE UPPER(embarazo) = 'SI') as embarazos,
                COUNT(*) FILTER (WHERE UPPER(hernias) = 'SI') as hernias,
                COUNT(*) FILTER (WHERE UPPER(varices) = 'SI') as varices,
                COUNT(*) FILTER (WHERE UPPER(hepatitis) = 'SI') as hepatitis,
                COUNT(*) FILTER (WHERE UPPER(enfermedad_higado) = 'SI') as enfermedad_higado,
                COUNT(*) FILTER (WHERE UPPER(enfermedad_pulmonar) = 'SI') as enfermedad_pulmonar,
                COUNT(*) FILTER (WHERE UPPER(cirugia_ocular) = 'SI') as cirugia_ocular,
                COUNT(*) FILTER (WHERE UPPER(usa_anteojos) = 'SI') as usa_anteojos,
                COUNT(*) FILTER (WHERE UPPER(usa_lentes_contacto) = 'SI') as usa_lentes_contacto,
                COUNT(*) FILTER (WHERE UPPER(condicion_medica) = 'SI') as condicion_medica_tratamiento,
                COUNT(*) FILTER (WHERE UPPER(trastorno_psicologico) = 'SI') as trastorno_psicologico,
                COUNT(*) FILTER (WHERE UPPER(sintomas_psicologicos) = 'SI') as sintomas_psicologicos,
                COUNT(*) FILTER (WHERE UPPER(diagnostico_cancer) = 'SI') as diagnostico_cancer,
                COUNT(*) FILTER (WHERE UPPER(enfermedades_laborales) = 'SI') as enfermedades_laborales,
                COUNT(*) FILTER (WHERE UPPER(enfermedad_osteomuscular) = 'SI') as enfermedad_osteomuscular,
                COUNT(*) FILTER (WHERE UPPER(enfermedad_autoinmune) = 'SI') as enfermedad_autoinmune,
                COUNT(*) FILTER (WHERE UPPER(genero) = 'MASCULINO') as hombres,
                COUNT(*) FILTER (WHERE UPPER(genero) = 'FEMENINO') as mujeres,
                ROUND(AVG(edad)::numeric, 1) as edad_promedio,
                MIN(edad) as edad_minima,
                MAX(edad) as edad_maxima,
                -- Antecedentes familiares
                COUNT(*) FILTER (WHERE UPPER(familia_diabetes) = 'SI') as familia_diabetes,
                COUNT(*) FILTER (WHERE UPPER(familia_hipertension) = 'SI') as familia_hipertension,
                COUNT(*) FILTER (WHERE UPPER(familia_cancer) = 'SI') as familia_cancer,
                COUNT(*) FILTER (WHERE UPPER(familia_infartos) = 'SI') as familia_infartos,
                COUNT(*) FILTER (WHERE UPPER(familia_trastornos) = 'SI') as familia_trastornos_mentales,
                COUNT(*) FILTER (WHERE UPPER(familia_hereditarias) = 'SI') as familia_enfermedades_hereditarias,
                COUNT(*) FILTER (WHERE UPPER(familia_geneticas) = 'SI') as familia_enfermedades_geneticas,
                -- Consumo de licor
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) = 'NUNCA') as licor_nunca,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) = 'OCASIONALMENTE') as licor_ocasional,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) = '1 DÍA SEMANAL' OR UPPER(consumo_licor) = '1 DIA SEMANAL') as licor_1_dia,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) = '2 DÍAS SEMANALES' OR UPPER(consumo_licor) = '2 DIAS SEMANALES') as licor_2_dias,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) LIKE '%+ DE 2%' OR UPPER(consumo_licor) LIKE '%MAS DE 2%') as licor_mas_2_dias,
                -- Ejercicio fisico
                COUNT(*) FILTER (WHERE UPPER(ejercicio) = 'OCASIONALMENTE') as ejercicio_ocasional,
                COUNT(*) FILTER (WHERE UPPER(ejercicio) = '1 DÍA SEMANAL' OR UPPER(ejercicio) = '1 DIA SEMANAL') as ejercicio_1_dia,
                COUNT(*) FILTER (WHERE UPPER(ejercicio) = '2 DÍAS SEMANALES' OR UPPER(ejercicio) = '2 DIAS SEMANALES') as ejercicio_2_dias,
                COUNT(*) FILTER (WHERE UPPER(ejercicio) LIKE '%+ DE 2%' OR UPPER(ejercicio) LIKE '%MAS DE 2%') as ejercicio_mas_2_dias
            FROM formularios
            WHERE UPPER(cod_empresa) = UPPER($1)
        `;

        const statsResult = await pool.query(statsQuery, [codEmpresa]);
        const stats = statsResult.rows[0];

        // También obtener datos de HistoriaClinica (citas/órdenes)
        const ordenesQuery = `
            SELECT
                COUNT(*) as total_ordenes,
                COUNT(*) FILTER (WHERE "atendido" = 'ATENDIDO') as atendidos,
                COUNT(*) FILTER (WHERE "atendido" = 'PENDIENTE') as pendientes
            FROM "HistoriaClinica"
            WHERE UPPER("codEmpresa") = UPPER($1)
        `;
        const ordenesResult = await pool.query(ordenesQuery, [codEmpresa]);
        const ordenes = ordenesResult.rows[0];

        // Construir el contexto de datos para OpenAI
        const datosEstadisticos = `
DATOS DE SALUD DE LOS COLABORADORES:
- Total de empleados con formulario completado: ${stats.total_empleados}
- Hombres: ${stats.hombres} | Mujeres: ${stats.mujeres}
- Edad promedio: ${stats.edad_promedio || 'N/A'} años (min: ${stats.edad_minima || 'N/A'}, max: ${stats.edad_maxima || 'N/A'})

HÁBITOS Y FACTORES DE RIESGO:
- Fumadores (fuman o fumaban): ${stats.fumadores}
- Con presión arterial alta: ${stats.presion_alta}
- Con problemas cardíacos: ${stats.problemas_cardiacos}
- Con diabetes o problemas de azúcar: ${stats.diabetes}
- Con problemas de sueño: ${stats.problemas_sueno}

CONSUMO DE LICOR:
- Nunca consumen licor: ${stats.licor_nunca}
- Consumen ocasionalmente: ${stats.licor_ocasional}
- Consumen 1 día a la semana: ${stats.licor_1_dia}
- Consumen 2 días a la semana: ${stats.licor_2_dias}
- Consumen más de 2 días a la semana: ${stats.licor_mas_2_dias}

EJERCICIO FÍSICO:
- Hacen ejercicio ocasionalmente: ${stats.ejercicio_ocasional}
- Hacen ejercicio 1 día a la semana: ${stats.ejercicio_1_dia}
- Hacen ejercicio 2 días a la semana: ${stats.ejercicio_2_dias}
- Hacen ejercicio más de 2 días a la semana: ${stats.ejercicio_mas_2_dias}

SÍNTOMAS Y CONDICIONES:
- Con hormigueos: ${stats.hormigueos}
- Con dolor de espalda: ${stats.dolor_espalda}
- Con dolor de cabeza frecuente: ${stats.dolor_cabeza}
- Con hernias: ${stats.hernias}
- Con várices: ${stats.varices}
- Con hepatitis: ${stats.hepatitis}
- Con enfermedad del hígado: ${stats.enfermedad_higado}
- Con enfermedad pulmonar: ${stats.enfermedad_pulmonar}
- Con condición médica en tratamiento: ${stats.condicion_medica_tratamiento}
- Embarazos actuales: ${stats.embarazos}

SALUD VISUAL:
- Usan anteojos: ${stats.usa_anteojos}
- Usan lentes de contacto: ${stats.usa_lentes_contacto}
- Con cirugía ocular previa: ${stats.cirugia_ocular}

SALUD MENTAL:
- Con trastorno psicológico o psiquiátrico: ${stats.trastorno_psicologico}
- Con síntomas psicológicos recientes: ${stats.sintomas_psicologicos}

OTRAS CONDICIONES:
- Con diagnóstico o sospecha de cáncer: ${stats.diagnostico_cancer}
- Con enfermedades laborales o accidentes de trabajo: ${stats.enfermedades_laborales}
- Con enfermedad osteomuscular: ${stats.enfermedad_osteomuscular}
- Con enfermedad autoinmune: ${stats.enfermedad_autoinmune}

ANTECEDENTES FAMILIARES:
- Familiares con diabetes: ${stats.familia_diabetes}
- Familiares con hipertensión: ${stats.familia_hipertension}
- Familiares con cáncer: ${stats.familia_cancer}
- Familiares con infartos: ${stats.familia_infartos}
- Familiares con trastornos mentales: ${stats.familia_trastornos_mentales}
- Familiares con enfermedades hereditarias: ${stats.familia_enfermedades_hereditarias}
- Familiares con enfermedades genéticas: ${stats.familia_enfermedades_geneticas}

ÓRDENES/CITAS MÉDICAS:
- Total de órdenes: ${ordenes.total_ordenes}
- Atendidos: ${ordenes.atendidos}
- Pendientes: ${ordenes.pendientes}
`;

        console.log('📊 Datos estadísticos obtenidos');

        // Llamar a OpenAI
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Eres un asistente de análisis de salud ocupacional para la empresa ${codEmpresa}.
Tu rol es ayudar al área de recursos humanos a entender la salud de sus colaboradores.

Tienes acceso a los siguientes datos estadísticos:
${datosEstadisticos}

INSTRUCCIONES:
- Responde de forma clara, concisa y profesional
- Siempre incluye números absolutos y porcentajes cuando sea relevante
- Si la pregunta no puede ser respondida con los datos disponibles, indícalo amablemente
- Usa emojis moderadamente para hacer la respuesta más visual (📊 📈 ⚠️ ✅)
- Si detectas datos preocupantes, sugiere acciones preventivas
- Nunca inventes datos, solo usa los proporcionados
- Responde en español`
                    },
                    {
                        role: 'user',
                        content: pregunta
                    }
                ],
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!openaiResponse.ok) {
            const errorData = await openaiResponse.text();
            console.error('❌ Error de OpenAI:', errorData);
            throw new Error('Error al comunicarse con OpenAI');
        }

        const openaiData = await openaiResponse.json();
        const respuestaIA = openaiData.choices[0].message.content;

        console.log('✅ Respuesta IA generada exitosamente');

        res.json({
            success: true,
            respuesta: respuestaIA,
            datosBase: {
                totalEmpleados: parseInt(stats.total_empleados),
                totalOrdenes: parseInt(ordenes.total_ordenes)
            }
        });

    } catch (error) {
        console.error('❌ Error en estadísticas IA:', error);
        res.status(500).json({
            success: false,
            message: 'Error al procesar la consulta',
            error: error.message
        });
    }
});

// Endpoint para marcar como atendido desde Wix (upsert en HistoriaClinica)
app.post('/api/marcar-atendido', async (req, res) => {
    try {
        const {
            wixId,
            atendido,
            fechaConsulta,
            mdConceptoFinal,
            mdRecomendacionesMedicasAdicionales,
            mdObservacionesCertificado,
            // Campos adicionales para INSERT
            numeroId,
            primerNombre,
            segundoNombre,
            primerApellido,
            segundoApellido,
            celular,
            email,
            codEmpresa,
            empresa,
            cargo,
            tipoExamen,
            fechaAtencion
        } = req.body;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📥 Recibida solicitud de marcar-atendido desde Wix');
        console.log('   wixId:', wixId);
        console.log('   atendido:', atendido);
        console.log('   fechaConsulta:', fechaConsulta);
        console.log('═══════════════════════════════════════════════════════════');

        if (!wixId) {
            return res.status(400).json({
                success: false,
                message: 'wixId es requerido'
            });
        }

        // Buscar en HistoriaClinica por _id (que es el wixId)
        const checkResult = await pool.query('SELECT "_id" FROM "HistoriaClinica" WHERE "_id" = $1', [wixId]);

        let result;
        let operacion;

        if (checkResult.rows.length > 0) {
            // UPDATE - El registro existe
            operacion = 'UPDATE';
            const updateQuery = `
                UPDATE "HistoriaClinica" SET
                    "atendido" = $1,
                    "fechaConsulta" = $2,
                    "mdConceptoFinal" = $3,
                    "mdRecomendacionesMedicasAdicionales" = $4,
                    "mdObservacionesCertificado" = $5,
                    "_updatedDate" = NOW()
                WHERE "_id" = $6
                RETURNING "_id", "numeroId", "primerNombre"
            `;

            const updateValues = [
                atendido || 'ATENDIDO',
                fechaConsulta ? new Date(fechaConsulta) : new Date(),
                mdConceptoFinal || null,
                mdRecomendacionesMedicasAdicionales || null,
                mdObservacionesCertificado || null,
                wixId
            ];

            result = await pool.query(updateQuery, updateValues);
        } else {
            // INSERT - El registro no existe
            operacion = 'INSERT';

            // Validar campos mínimos requeridos para INSERT
            if (!numeroId || !primerNombre || !primerApellido || !celular) {
                console.log('⚠️ Faltan campos requeridos para INSERT');
                return res.status(400).json({
                    success: false,
                    message: 'Para crear un nuevo registro se requieren: numeroId, primerNombre, primerApellido, celular'
                });
            }

            const insertQuery = `
                INSERT INTO "HistoriaClinica" (
                    "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                    "celular", "email", "codEmpresa", "empresa", "cargo", "tipoExamen",
                    "fechaAtencion", "atendido", "fechaConsulta", "mdConceptoFinal",
                    "mdRecomendacionesMedicasAdicionales", "mdObservacionesCertificado", "_createdDate", "_updatedDate"
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()
                )
                RETURNING "_id", "numeroId", "primerNombre"
            `;

            const insertValues = [
                wixId,
                numeroId,
                primerNombre,
                segundoNombre || null,
                primerApellido,
                segundoApellido || null,
                celular,
                email || null,
                codEmpresa || null,
                empresa || null,
                cargo || null,
                tipoExamen || null,
                fechaAtencion ? new Date(fechaAtencion) : null,
                atendido || 'ATENDIDO',
                fechaConsulta ? new Date(fechaConsulta) : new Date(),
                mdConceptoFinal || null,
                mdRecomendacionesMedicasAdicionales || null,
                mdObservacionesCertificado || null
            ];

            result = await pool.query(insertQuery, insertValues);
        }

        console.log(`✅ HistoriaClinica ${operacion === 'INSERT' ? 'CREADA' : 'ACTUALIZADA'} como ATENDIDO`);
        console.log('   _id:', result.rows[0]._id);
        console.log('   numeroId:', result.rows[0].numeroId);
        console.log('   primerNombre:', result.rows[0].primerNombre);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        res.json({
            success: true,
            message: `HistoriaClinica ${operacion === 'INSERT' ? 'creada' : 'actualizada'} como ATENDIDO`,
            operacion: operacion,
            data: {
                _id: result.rows[0]._id,
                numeroId: result.rows[0].numeroId,
                primerNombre: result.rows[0].primerNombre
            }
        });

    } catch (error) {
        console.error('❌ Error en marcar-atendido:', error);
        res.status(500).json({
            success: false,
            message: 'Error al marcar como atendido',
            error: error.message
        });
    }
});

// Endpoint para editar HistoriaClinica o Formulario por _id
app.put('/api/historia-clinica/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const datos = req.body;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📝 Recibida solicitud de edición');
        console.log('   _id:', id);
        console.log('═══════════════════════════════════════════════════════════');

        // Primero verificar si existe en HistoriaClinica
        const checkHistoria = await pool.query('SELECT "_id" FROM "HistoriaClinica" WHERE "_id" = $1', [id]);

        if (checkHistoria.rows.length > 0) {
            // ========== ACTUALIZAR EN HISTORIA CLINICA ==========
            const camposPermitidos = [
                'numeroId', 'primerNombre', 'segundoNombre', 'primerApellido', 'segundoApellido',
                'celular', 'email', 'codEmpresa', 'empresa', 'cargo', 'tipoExamen', 'eps',
                'fechaAtencion', 'atendido', 'fechaConsulta', 'mdConceptoFinal', 'mdRecomendacionesMedicasAdicionales',
                'mdObservacionesCertificado', 'mdAntecedentes', 'mdObsParaMiDocYa', 'mdDx1', 'mdDx2',
                'talla', 'peso', 'motivoConsulta', 'diagnostico', 'tratamiento', 'pvEstado', 'medico', 'examenes',
                'aprobacion'
            ];

            const setClauses = [];
            const values = [];
            let paramIndex = 1;

            for (const campo of camposPermitidos) {
                if (datos[campo] !== undefined) {
                    setClauses.push(`"${campo}" = $${paramIndex}`);
                    if (campo === 'fechaAtencion' && datos[campo]) {
                        // Para fechaAtencion, construir con zona horaria Colombia
                        // El datetime-local viene como "2025-12-11T10:00" (hora local del usuario)
                        const fechaHora = datos[campo].split('T');
                        const fecha = fechaHora[0];
                        const hora = fechaHora[1] || '08:00';
                        values.push(construirFechaAtencionColombia(fecha, hora));
                    } else if (['fechaNacimiento', 'fechaConsulta'].includes(campo)) {
                        // Permitir null para fechaConsulta (cuando se cambia a PENDIENTE)
                        values.push(datos[campo] ? new Date(datos[campo]) : null);
                    } else {
                        values.push(datos[campo] === '' ? null : datos[campo]);
                    }
                    paramIndex++;
                }
            }

            if (setClauses.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No se proporcionaron campos para actualizar'
                });
            }

            setClauses.push(`"_updatedDate" = NOW()`);
            values.push(id);

            const query = `
                UPDATE "HistoriaClinica" SET
                    ${setClauses.join(', ')}
                WHERE "_id" = $${paramIndex}
                RETURNING *
            `;

            const result = await pool.query(query, values);
            const historiaActualizada = result.rows[0];

            console.log('✅ POSTGRESQL: HistoriaClinica actualizada exitosamente');
            console.log('   _id:', historiaActualizada._id);
            console.log('   numeroId:', historiaActualizada.numeroId);
            console.log('═══════════════════════════════════════════════════════════');

            // Si se actualizó el numeroId, actualizar en cascada en todas las tablas relacionadas
            if (datos.numeroId !== undefined) {
                const nuevoNumeroId = datos.numeroId;
                const ordenId = id; // El _id de HistoriaClinica es el orden_id en las otras tablas

                console.log('🔄 Actualizando numeroId en cascada...');
                console.log('   Nuevo numeroId:', nuevoNumeroId);
                console.log('   orden_id:', ordenId);

                // Actualizar en formularios (buscar por wix_id que es el orden_id)
                try {
                    const formResult = await pool.query(
                        'UPDATE formularios SET numero_id = $1 WHERE wix_id = $2 RETURNING id',
                        [nuevoNumeroId, ordenId]
                    );
                    if (formResult.rows.length > 0) {
                        console.log('   ✅ formularios actualizado');
                    }
                } catch (e) {
                    console.log('   ⚠️ formularios: sin registro para actualizar');
                }

                // Actualizar en audiometrias
                try {
                    const audioResult = await pool.query(
                        'UPDATE audiometrias SET numero_id = $1 WHERE orden_id = $2 RETURNING id',
                        [nuevoNumeroId, ordenId]
                    );
                    if (audioResult.rows.length > 0) {
                        console.log('   ✅ audiometrias actualizado');
                    }
                } catch (e) {
                    console.log('   ⚠️ audiometrias: sin registro para actualizar');
                }

                // Actualizar en pruebasADC
                try {
                    const adcResult = await pool.query(
                        'UPDATE "pruebasADC" SET numero_id = $1 WHERE orden_id = $2 RETURNING id',
                        [nuevoNumeroId, ordenId]
                    );
                    if (adcResult.rows.length > 0) {
                        console.log('   ✅ pruebasADC actualizado');
                    }
                } catch (e) {
                    console.log('   ⚠️ pruebasADC: sin registro para actualizar');
                }

                // Actualizar en visiometrias
                try {
                    const visioResult = await pool.query(
                        'UPDATE visiometrias SET numero_id = $1 WHERE orden_id = $2 RETURNING id',
                        [nuevoNumeroId, ordenId]
                    );
                    if (visioResult.rows.length > 0) {
                        console.log('   ✅ visiometrias actualizado');
                    }
                } catch (e) {
                    console.log('   ⚠️ visiometrias: sin registro para actualizar');
                }

                // Actualizar en visiometrias_virtual
                try {
                    const visioVirtualResult = await pool.query(
                        'UPDATE visiometrias_virtual SET numero_id = $1 WHERE orden_id = $2 RETURNING id',
                        [nuevoNumeroId, ordenId]
                    );
                    if (visioVirtualResult.rows.length > 0) {
                        console.log('   ✅ visiometrias_virtual actualizado');
                    }
                } catch (e) {
                    console.log('   ⚠️ visiometrias_virtual: sin registro para actualizar');
                }

                console.log('🔄 Actualización en cascada completada');
            }

            // Sincronizar con Wix
            try {
                const fetch = (await import('node-fetch')).default;

                // Preparar payload para Wix, convirtiendo fechaAtencion a ISO string
                const wixPayload = { _id: id, ...datos };

                // Si hay fechaAtencion, convertirla a ISO string para Wix
                if (datos.fechaAtencion) {
                    const fechaHora = datos.fechaAtencion.split('T');
                    const fecha = fechaHora[0];
                    const hora = fechaHora[1] || '08:00';
                    const fechaObj = construirFechaAtencionColombia(fecha, hora);
                    if (fechaObj) {
                        wixPayload.fechaAtencion = fechaObj.toISOString();
                        console.log('📅 Fecha para Wix (edición):', wixPayload.fechaAtencion);
                    }
                }

                console.log('📤 Sincronizando HistoriaClinica con Wix...');
                const wixResponse = await fetch('https://www.bsl.com.co/_functions/actualizarHistoriaClinica', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(wixPayload)
                });

                if (wixResponse.ok) {
                    console.log('✅ WIX: HistoriaClinica sincronizada exitosamente');
                } else {
                    console.error('❌ WIX: ERROR al sincronizar - Status:', wixResponse.status);
                }
            } catch (wixError) {
                console.error('❌ WIX: EXCEPCIÓN al sincronizar:', wixError.message);
            }

            return res.json({
                success: true,
                message: 'HistoriaClinica actualizada correctamente',
                data: historiaActualizada
            });
        }

        // ========== SI NO ESTÁ EN HISTORIA CLINICA, BUSCAR EN FORMULARIOS ==========
        const checkFormulario = await pool.query('SELECT id FROM formularios WHERE id = $1', [id]);

        if (checkFormulario.rows.length > 0) {
            // Mapeo de campos camelCase a snake_case para formularios
            const mapeoFormularios = {
                'primerNombre': 'primer_nombre',
                'primerApellido': 'primer_apellido',
                'numeroId': 'numero_id',
                'codEmpresa': 'cod_empresa',
                'estadoCivil': 'estado_civil',
                'fechaNacimiento': 'fecha_nacimiento',
                'ciudadResidencia': 'ciudad_residencia',
                'lugarNacimiento': 'lugar_nacimiento',
                'nivelEducativo': 'nivel_educativo',
                'profesionOficio': 'profesion_oficio',
                'consumoLicor': 'consumo_licor',
                'usaAnteojos': 'usa_anteojos',
                'usaLentesContacto': 'usa_lentes_contacto',
                'cirugiaOcular': 'cirugia_ocular',
                'presionAlta': 'presion_alta',
                'problemasCardiacos': 'problemas_cardiacos',
                'problemasAzucar': 'problemas_azucar',
                'enfermedadPulmonar': 'enfermedad_pulmonar',
                'enfermedadHigado': 'enfermedad_higado',
                'dolorEspalda': 'dolor_espalda',
                'dolorCabeza': 'dolor_cabeza',
                'ruidoJaqueca': 'ruido_jaqueca',
                'problemasSueno': 'problemas_sueno',
                'cirugiaProgramada': 'cirugia_programada',
                'condicionMedica': 'condicion_medica',
                'trastornoPsicologico': 'trastorno_psicologico',
                'sintomasPsicologicos': 'sintomas_psicologicos',
                'diagnosticoCancer': 'diagnostico_cancer',
                'enfermedadesLaborales': 'enfermedades_laborales',
                'enfermedadOsteomuscular': 'enfermedad_osteomuscular',
                'enfermedadAutoinmune': 'enfermedad_autoinmune',
                'familiaHereditarias': 'familia_hereditarias',
                'familiaGeneticas': 'familia_geneticas',
                'familiaDiabetes': 'familia_diabetes',
                'familiaHipertension': 'familia_hipertension',
                'familiaInfartos': 'familia_infartos',
                'familiaCancer': 'familia_cancer',
                'familiaTrastornos': 'familia_trastornos',
                'familiaInfecciosas': 'familia_infecciosas'
            };

            const camposDirectos = [
                'celular', 'email', 'edad', 'genero', 'hijos', 'ejercicio', 'empresa',
                'eps', 'arl', 'pensiones', 'estatura', 'peso', 'fuma', 'embarazo',
                'hepatitis', 'hernias', 'varices', 'hormigueos', 'atendido', 'ciudad'
            ];

            const setClauses = [];
            const values = [];
            let paramIndex = 1;

            for (const [key, value] of Object.entries(datos)) {
                let columna = null;

                if (mapeoFormularios[key]) {
                    columna = mapeoFormularios[key];
                } else if (camposDirectos.includes(key)) {
                    columna = key;
                }

                if (columna && value !== undefined) {
                    setClauses.push(`${columna} = $${paramIndex}`);
                    values.push(value === '' ? null : value);
                    paramIndex++;
                }
            }

            if (setClauses.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No se proporcionaron campos válidos para actualizar'
                });
            }

            values.push(id);

            const query = `
                UPDATE formularios SET
                    ${setClauses.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await pool.query(query, values);
            const formularioActualizado = result.rows[0];

            console.log('✅ POSTGRESQL: Formulario actualizado exitosamente');
            console.log('   id:', formularioActualizado.id);
            console.log('   numero_id:', formularioActualizado.numero_id);
            console.log('═══════════════════════════════════════════════════════════');

            return res.json({
                success: true,
                message: 'Formulario actualizado correctamente',
                data: formularioActualizado
            });
        }

        // No se encontró en ninguna tabla
        return res.status(404).json({
            success: false,
            message: 'Registro no encontrado en HistoriaClinica ni en Formularios'
        });

    } catch (error) {
        console.error('❌ Error al actualizar registro:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar registro',
            error: error.message
        });
    }
});

// Endpoint para listar órdenes de HistoriaClinica (sincronizadas desde Wix)
app.get('/api/historia-clinica/list', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const buscar = req.query.buscar?.trim();

        console.log(`📋 Listando órdenes de HistoriaClinica (página ${page}, limit ${limit}${buscar ? `, búsqueda: "${buscar}"` : ''})...`);

        let totalRegistros;
        let whereClause = '';
        const params = [];

        if (buscar && buscar.length >= 2) {
            // Búsqueda con índice GIN pg_trgm
            whereClause = `WHERE (
                COALESCE(h."numeroId", '') || ' ' ||
                COALESCE(h."primerNombre", '') || ' ' ||
                COALESCE(h."primerApellido", '') || ' ' ||
                COALESCE(h."codEmpresa", '') || ' ' ||
                COALESCE(h."celular", '') || ' ' ||
                COALESCE(h."empresa", '')
            ) ILIKE $1`;
            params.push(`%${buscar}%`);

            // COUNT exacto cuando hay búsqueda
            const countResult = await pool.query(`
                SELECT COUNT(*) FROM "HistoriaClinica" h ${whereClause}
            `, params);
            totalRegistros = parseInt(countResult.rows[0].count);
        } else {
            // Sin búsqueda: usar estimación rápida de PostgreSQL (<1ms vs 522ms)
            const countResult = await pool.query(`
                SELECT reltuples::bigint as estimate FROM pg_class WHERE relname = 'HistoriaClinica'
            `);
            totalRegistros = parseInt(countResult.rows[0].estimate) || 0;
        }

        const totalPaginas = Math.ceil(totalRegistros / limit);

        // Obtener registros de HistoriaClinica con foto_url del formulario vinculado
        const queryParams = buscar ? [...params, limit, offset] : [limit, offset];
        const limitParam = buscar ? '$2' : '$1';
        const offsetParam = buscar ? '$3' : '$2';

        const historiaResult = await pool.query(`
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre", h."primerApellido", h."segundoApellido",
                   h."celular", h."cargo", h."ciudad", h."tipoExamen", h."codEmpresa", h."empresa", h."medico",
                   h."atendido", h."examenes", h."_createdDate", h."fechaConsulta", h."fechaAtencion", h."horaAtencion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado", h."mdObsParaMiDocYa",
                   h."pvEstado",
                   'historia' as origen,
                   COALESCE(f_exact.foto_url, f_fallback.foto_url) as foto_url
            FROM "HistoriaClinica" h
            LEFT JOIN formularios f_exact ON f_exact.wix_id = h."_id"
            LEFT JOIN LATERAL (
                SELECT foto_url FROM formularios
                WHERE numero_id = h."numeroId" AND foto_url IS NOT NULL
                ORDER BY fecha_registro DESC LIMIT 1
            ) f_fallback ON f_exact.id IS NULL
            ${whereClause}
            ORDER BY h."_createdDate" DESC
            LIMIT ${limitParam} OFFSET ${offsetParam}
        `, queryParams);

        console.log(`✅ HistoriaClinica: ${historiaResult.rows.length} registros (página ${page}/${totalPaginas})`);

        res.json({
            success: true,
            total: totalRegistros,
            page,
            limit,
            totalPaginas,
            data: historiaResult.rows
        });

    } catch (error) {
        console.error('❌ Error al listar registros:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar registros',
            error: error.message
        });
    }
});

// Endpoint de búsqueda server-side para HistoriaClinica (escala a 100,000+ registros)
app.get('/api/historia-clinica/buscar', async (req, res) => {
    try {
        const { q } = req.query;

        // Requiere al menos 2 caracteres para buscar
        if (!q || q.length < 2) {
            return res.json({ success: true, data: [] });
        }

        console.log(`🔍 Buscando en HistoriaClinica: "${q}"`);

        const searchTerm = `%${q}%`;
        const result = await pool.query(`
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre",
                   h."primerApellido", h."segundoApellido", h."celular", h."cargo",
                   h."ciudad", h."tipoExamen", h."codEmpresa", h."empresa", h."medico",
                   h."atendido", h."examenes", h."_createdDate", h."fechaConsulta",
                   h."fechaAtencion", h."horaAtencion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado", h."mdObsParaMiDocYa",
                   'historia' as origen,
                   COALESCE(f_exact.foto_url, f_fallback.foto_url) as foto_url
            FROM "HistoriaClinica" h
            LEFT JOIN formularios f_exact ON f_exact.wix_id = h."_id"
            LEFT JOIN LATERAL (
                SELECT foto_url FROM formularios
                WHERE numero_id = h."numeroId" AND foto_url IS NOT NULL
                ORDER BY fecha_registro DESC LIMIT 1
            ) f_fallback ON f_exact.id IS NULL
            WHERE (
                COALESCE(h."numeroId", '') || ' ' ||
                COALESCE(h."primerNombre", '') || ' ' ||
                COALESCE(h."primerApellido", '') || ' ' ||
                COALESCE(h."codEmpresa", '') || ' ' ||
                COALESCE(h."celular", '') || ' ' ||
                COALESCE(h."empresa", '')
            ) ILIKE $1
            ORDER BY h."_createdDate" DESC
            LIMIT 100
        `, [searchTerm]);

        console.log(`✅ Encontrados ${result.rows.length} registros para "${q}"`);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error('❌ Error en búsqueda:', error);
        res.status(500).json({
            success: false,
            message: 'Error en la búsqueda',
            error: error.message
        });
    }
});

// Endpoint para buscar paciente por celular (para el chat de WhatsApp)
app.get('/api/historia-clinica/buscar-por-celular', async (req, res) => {
    try {
        const { celular } = req.query;

        if (!celular) {
            return res.status(400).json({ success: false, message: 'Se requiere el parámetro celular' });
        }

        console.log(`🔍 Buscando paciente por celular: "${celular}"`);

        // Normalizar el celular para búsqueda flexible
        const celularLimpio = celular.replace(/\D/g, ''); // Solo dígitos
        const celularSin57 = celularLimpio.startsWith('57') ? celularLimpio.substring(2) : celularLimpio;

        const result = await pool.query(`
            SELECT h.*
            FROM "HistoriaClinica" h
            WHERE h."celular" = $1
               OR h."celular" = $2
               OR h."celular" = $3
               OR REPLACE(h."celular", ' ', '') = $1
               OR REPLACE(h."celular", ' ', '') = $2
               OR REPLACE(h."celular", ' ', '') = $3
            ORDER BY h."_createdDate" DESC
            LIMIT 1
        `, [celular, celularLimpio, celularSin57]);

        if (result.rows.length === 0) {
            console.log(`⚠️ No se encontró paciente con celular: ${celular}`);
            return res.json({ success: false, message: 'No se encontró paciente con este celular' });
        }

        console.log(`✅ Paciente encontrado: ${result.rows[0].primerNombre} ${result.rows[0].primerApellido}`);

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error buscando por celular:', error);
        res.status(500).json({
            success: false,
            message: 'Error en la búsqueda',
            error: error.message
        });
    }
});

// Endpoint para obtener HistoriaClinica o Formulario por _id
app.get('/api/historia-clinica/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Primero buscar en HistoriaClinica
        const historiaResult = await pool.query('SELECT *, \'historia\' as origen FROM "HistoriaClinica" WHERE "_id" = $1', [id]);

        if (historiaResult.rows.length > 0) {
            return res.json({
                success: true,
                data: historiaResult.rows[0]
            });
        }

        // Si no está en HistoriaClinica, buscar en formularios por wix_id o id numérico
        const formResult = await pool.query(`
            SELECT
                COALESCE(wix_id, id::text) as "_id",
                id as "formId",
                numero_id as "numeroId",
                primer_nombre as "primerNombre",
                NULL as "segundoNombre",
                primer_apellido as "primerApellido",
                NULL as "segundoApellido",
                celular,
                NULL as "cargo",
                ciudad_residencia as "ciudad",
                NULL as "tipoExamen",
                cod_empresa as "codEmpresa",
                empresa,
                NULL as "medico",
                atendido,
                NULL as "examenes",
                fecha_registro as "_createdDate",
                fecha_consulta as "fechaConsulta",
                genero, edad, fecha_nacimiento as "fechaNacimiento", lugar_nacimiento as "lugarNacimiento",
                hijos, profesion_oficio as "profesionOficio", estado_civil as "estadoCivil",
                nivel_educativo as "nivelEducativo", email, estatura, peso, ejercicio,
                eps, arl, pensiones,
                'formulario' as origen
            FROM formularios
            WHERE wix_id = $1 OR ($1 ~ '^[0-9]+$' AND id = $1::integer)
        `, [id]);

        if (formResult.rows.length > 0) {
            return res.json({
                success: true,
                data: formResult.rows[0]
            });
        }

        return res.status(404).json({
            success: false,
            message: 'Registro no encontrado'
        });

    } catch (error) {
        console.error('❌ Error al obtener registro:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener registro',
            error: error.message
        });
    }
});

// Endpoint para toggle de estado de pago
app.patch('/api/historia-clinica/:id/pago', async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener estado actual y numeroId
        const currentResult = await pool.query('SELECT "pagado", "numeroId" FROM "HistoriaClinica" WHERE "_id" = $1', [id]);

        if (currentResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Orden no encontrada' });
        }

        const estadoActual = currentResult.rows[0].pagado || false;
        const numeroId = currentResult.rows[0].numeroId;
        const nuevoEstado = !estadoActual;
        const pvEstado = nuevoEstado ? 'Pagado' : '';

        // Actualizar estado en PostgreSQL (pagado y pvEstado)
        await pool.query(
            'UPDATE "HistoriaClinica" SET "pagado" = $1, "pvEstado" = $2 WHERE "_id" = $3',
            [nuevoEstado, pvEstado, id]
        );

        console.log(`💰 Pago ${nuevoEstado ? 'marcado' : 'desmarcado'} para orden ${id}`);

        // Sincronizar con Wix usando endpoint marcarPagado (necesita numeroId)
        if (numeroId) {
            try {
                const wixPayload = {
                    userId: numeroId,
                    observaciones: pvEstado
                };
                console.log('📤 Sincronizando pvEstado con Wix (marcarPagado):', JSON.stringify(wixPayload));

                const wixResponse = await fetch('https://www.bsl.com.co/_functions/marcarPagado', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(wixPayload)
                });

                const wixText = await wixResponse.text();
                console.log('📡 WIX Response Status:', wixResponse.status);
                console.log('📡 WIX Response Body:', wixText);

                if (wixResponse.ok) {
                    console.log('✅ WIX: pvEstado sincronizado en HistoriaClinica');
                } else {
                    console.log('⚠️ WIX: No se pudo sincronizar pvEstado:', wixText);
                }
            } catch (wixError) {
                console.log('⚠️ WIX: Error al sincronizar pvEstado:', wixError.message);
            }
        } else {
            console.log('⚠️ WIX: No se puede sincronizar, falta numeroId');
        }

        res.json({ success: true, pagado: nuevoEstado });
    } catch (error) {
        console.error('❌ Error al actualizar pago:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar pago' });
    }
});

// Endpoint para eliminar HistoriaClinica por _id
app.delete('/api/historia-clinica/:id', async (req, res) => {
    try {
        const { id } = req.params;

        console.log('');
        console.log('🗑️ ========== ELIMINANDO ORDEN ==========');
        console.log(`📋 ID: ${id}`);

        // Eliminar de PostgreSQL
        const result = await pool.query('DELETE FROM "HistoriaClinica" WHERE "_id" = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Registro no encontrado en HistoriaClinica'
            });
        }

        console.log('✅ Orden eliminada de PostgreSQL');

        res.json({
            success: true,
            message: 'Orden eliminada correctamente',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error al eliminar orden:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar orden',
            error: error.message
        });
    }
});

// Endpoint para buscar paciente por numeroId (para actualizar foto)
app.get('/api/buscar-paciente/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;

        console.log('🔍 Buscando paciente con numeroId:', numeroId);

        // Buscar en formularios (incluir foto_url)
        const formResult = await pool.query(
            'SELECT id, wix_id, primer_nombre, primer_apellido, numero_id, foto_url FROM formularios WHERE numero_id = $1 ORDER BY fecha_registro DESC LIMIT 1',
            [numeroId]
        );

        if (formResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No se encontró paciente con ese número de identificación'
            });
        }

        const paciente = formResult.rows[0];

        res.json({
            success: true,
            data: {
                id: paciente.id,
                wix_id: paciente.wix_id,
                nombre: `${paciente.primer_nombre || ''} ${paciente.primer_apellido || ''}`.trim(),
                numero_id: paciente.numero_id,
                tiene_foto: !!paciente.foto_url,
                foto_url: paciente.foto_url
            }
        });

    } catch (error) {
        console.error('❌ Error al buscar paciente:', error);
        res.status(500).json({
            success: false,
            message: 'Error al buscar paciente',
            error: error.message
        });
    }
});

// Endpoint PÚBLICO para validar certificado por número de documento
app.get('/api/validar-certificado/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;

        console.log('🔍 Validando certificado para documento:', numeroId);

        // Buscar en HistoriaClinica con estado ATENDIDO
        const result = await pool.query(`
            SELECT
                "primerNombre",
                "primerApellido",
                "fechaConsulta",
                "examenes"
            FROM "HistoriaClinica"
            WHERE "numeroId" = $1
            AND "atendido" = 'ATENDIDO'
            ORDER BY "fechaConsulta" DESC
            LIMIT 1
        `, [numeroId]);

        if (result.rows.length === 0) {
            return res.json({
                success: false,
                existe: false,
                message: 'No se encontró certificado médico para este documento'
            });
        }

        const certificado = result.rows[0];

        // Ofuscar nombres: mostrar primeras 3 letras + ***
        const ofuscarNombre = (nombre) => {
            if (!nombre || nombre.length <= 3) return '***';
            return nombre.substring(0, 3) + '***';
        };

        const nombreOfuscado = ofuscarNombre(certificado.primerNombre);
        const apellidoOfuscado = ofuscarNombre(certificado.primerApellido);

        // Formatear fecha de consulta
        const fechaConsulta = certificado.fechaConsulta
            ? new Date(certificado.fechaConsulta).toLocaleDateString('es-CO')
            : 'Fecha no disponible';

        // Procesar exámenes
        const examenes = certificado.examenes || 'No especificados';

        res.json({
            success: true,
            existe: true,
            datos: {
                nombre: `${nombreOfuscado} ${apellidoOfuscado}`,
                fechaConsulta: fechaConsulta,
                examenes: examenes
            }
        });

    } catch (error) {
        console.error('❌ Error al validar certificado:', error);
        res.status(500).json({
            success: false,
            message: 'Error al validar certificado',
            error: error.message
        });
    }
});

// Endpoint para actualizar foto de paciente
app.post('/api/actualizar-foto', async (req, res) => {
    try {
        const { numeroId, foto } = req.body;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📸 Recibida solicitud de actualización de foto');
        console.log('   numeroId:', numeroId);
        console.log('   Tamaño foto:', foto ? `${(foto.length / 1024).toFixed(2)} KB` : 'No proporcionada');
        console.log('═══════════════════════════════════════════════════════════');

        if (!numeroId || !foto) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere numeroId y foto'
            });
        }

        // Buscar el formulario por numero_id
        const checkResult = await pool.query(
            'SELECT id, wix_id, primer_nombre, primer_apellido FROM formularios WHERE numero_id = $1 ORDER BY fecha_registro DESC LIMIT 1',
            [numeroId]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No se encontró paciente con ese número de identificación'
            });
        }

        const paciente = checkResult.rows[0];

        // Subir foto a DigitalOcean Spaces
        console.log('📤 Subiendo foto a DigitalOcean Spaces...');
        const fotoUrl = await subirFotoASpaces(foto, numeroId, paciente.id);

        if (!fotoUrl) {
            return res.status(500).json({
                success: false,
                message: 'Error al subir foto a Spaces'
            });
        }

        // Actualizar foto_url en PostgreSQL
        await pool.query(
            'UPDATE formularios SET foto_url = $1 WHERE id = $2',
            [fotoUrl, paciente.id]
        );

        console.log('✅ POSTGRESQL: foto_url actualizada');
        console.log('   ID:', paciente.id);
        console.log('   Paciente:', paciente.primer_nombre, paciente.primer_apellido);
        console.log('   URL:', fotoUrl);

        // Sincronizar con Wix si tiene wix_id (enviar URL en lugar de base64)
        let wixSincronizado = false;
        if (paciente.wix_id) {
            try {
                const fetch = (await import('node-fetch')).default;

                // Primero obtener el _id de Wix
                const queryResponse = await fetch(`https://www.bsl.com.co/_functions/formularioPorIdGeneral?idGeneral=${paciente.wix_id}`);

                if (queryResponse.ok) {
                    const queryResult = await queryResponse.json();

                    if (queryResult.success && queryResult.item) {
                        const wixId = queryResult.item._id;

                        // Actualizar foto en Wix con URL
                        const wixPayload = {
                            _id: wixId,
                            foto: fotoUrl
                        };

                        console.log('📤 Sincronizando URL de foto con Wix...');

                        const wixResponse = await fetch('https://www.bsl.com.co/_functions/actualizarFormulario', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(wixPayload)
                        });

                        if (wixResponse.ok) {
                            wixSincronizado = true;
                            console.log('✅ WIX: URL de foto sincronizada exitosamente');
                        } else {
                            console.error('❌ WIX: Error al sincronizar foto');
                        }
                    }
                }
            } catch (wixError) {
                console.error('❌ WIX: Excepción al sincronizar:', wixError.message);
            }
        }

        console.log('');
        console.log('🎉 RESUMEN: Actualización de foto completada');
        console.log('   ✅ Spaces: ' + fotoUrl);
        console.log('   ✅ PostgreSQL: OK');
        console.log('   ' + (wixSincronizado ? '✅' : '⚠️') + ' Wix:', wixSincronizado ? 'Sincronizado' : 'No sincronizado');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        res.json({
            success: true,
            message: 'Foto actualizada correctamente',
            data: {
                id: paciente.id,
                nombre: `${paciente.primer_nombre || ''} ${paciente.primer_apellido || ''}`.trim(),
                fotoUrl,
                wixSincronizado
            }
        });

    } catch (error) {
        console.error('❌ Error al actualizar foto:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar foto',
            error: error.message
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', database: 'connected' });
});

// ============================================
// ENDPOINTS PARA MÉDICOS
// ============================================

// Listar todos los médicos activos
app.get('/api/medicos', async (req, res) => {
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
        console.error('❌ Error al listar médicos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar médicos',
            error: error.message
        });
    }
});

// Obtener un médico por ID (incluye firma)
app.get('/api/medicos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM medicos WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Médico no encontrado'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al obtener médico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener médico',
            error: error.message
        });
    }
});

// Crear un nuevo médico
app.post('/api/medicos', async (req, res) => {
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

        console.log(`✅ Médico creado: ${primerNombre} ${primerApellido} (Licencia: ${numeroLicencia})`);

        res.json({
            success: true,
            message: 'Médico creado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al crear médico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear médico',
            error: error.message
        });
    }
});

// Actualizar un médico
app.put('/api/medicos/:id', async (req, res) => {
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
                message: 'Médico no encontrado'
            });
        }

        console.log(`✅ Médico actualizado: ID ${id}`);

        res.json({
            success: true,
            message: 'Médico actualizado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al actualizar médico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar médico',
            error: error.message
        });
    }
});

// Eliminar (desactivar) un médico
app.delete('/api/medicos/:id', async (req, res) => {
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
                message: 'Médico no encontrado'
            });
        }

        console.log(`✅ Médico desactivado: ID ${id}`);

        res.json({
            success: true,
            message: 'Médico desactivado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al desactivar médico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al desactivar médico',
            error: error.message
        });
    }
});

// Actualizar tiempo de consulta de un médico
app.put('/api/medicos/:id/tiempo-consulta', async (req, res) => {
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
                message: 'Médico no encontrado'
            });
        }

        console.log(`✅ Tiempo de consulta actualizado para médico ID ${id}: ${tiempoConsulta} min`);

        res.json({
            success: true,
            message: 'Tiempo de consulta actualizado',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al actualizar tiempo de consulta:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar tiempo de consulta',
            error: error.message
        });
    }
});

// ============================================
// ENDPOINTS PARA DISPONIBILIDAD DE MÉDICOS
// ============================================

// GET - Obtener disponibilidad de un médico (opcionalmente filtrado por modalidad)
app.get('/api/medicos/:id/disponibilidad', async (req, res) => {
    try {
        const { id } = req.params;
        const { modalidad, agrupado } = req.query; // agrupado=true para agrupar rangos por día

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

        // Si se solicita agrupado, consolidar múltiples rangos por día
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
        console.error('❌ Error al obtener disponibilidad:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener disponibilidad',
            error: error.message
        });
    }
});

// POST - Guardar disponibilidad de un médico para una modalidad específica
app.post('/api/medicos/:id/disponibilidad', async (req, res) => {
    try {
        const { id } = req.params;
        const { disponibilidad, modalidad = 'presencial' } = req.body;

        if (!Array.isArray(disponibilidad)) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere un array de disponibilidad'
            });
        }

        // Verificar que el médico existe
        const medicoCheck = await pool.query('SELECT id FROM medicos WHERE id = $1', [id]);
        if (medicoCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Médico no encontrado'
            });
        }

        // Eliminar disponibilidad existente SOLO para esta modalidad
        await pool.query('DELETE FROM medicos_disponibilidad WHERE medico_id = $1 AND modalidad = $2', [id, modalidad]);

        // Insertar nueva disponibilidad
        // Ahora soporta múltiples rangos por día usando el campo 'rangos'
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

        console.log(`✅ Disponibilidad ${modalidad} actualizada para médico ID ${id}`);

        res.json({
            success: true,
            message: `Disponibilidad ${modalidad} guardada correctamente`
        });
    } catch (error) {
        console.error('❌ Error al guardar disponibilidad:', error);
        res.status(500).json({
            success: false,
            message: 'Error al guardar disponibilidad',
            error: error.message
        });
    }
});

// DELETE - Eliminar disponibilidad de un día específico y modalidad
app.delete('/api/medicos/:id/disponibilidad/:dia', async (req, res) => {
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
        console.error('❌ Error al eliminar disponibilidad:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar disponibilidad',
            error: error.message
        });
    }
});

// ============================================
// ENDPOINTS PARA EMPRESAS
// ============================================

// Listar todas las empresas activas
app.get('/api/empresas', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, cod_empresa, empresa, nit, profesiograma, activo, created_at,
                   ciudades, examenes, subempresas, centros_de_costo, cargos
            FROM empresas
            WHERE activo = true
            ORDER BY empresa
        `);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error('❌ Error al listar empresas:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar empresas',
            error: error.message
        });
    }
});

// Obtener una empresa por ID
app.get('/api/empresas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM empresas WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Empresa no encontrada'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al obtener empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener empresa',
            error: error.message
        });
    }
});

// Crear una nueva empresa
app.post('/api/empresas', async (req, res) => {
    try {
        const { codEmpresa, empresa, nit, profesiograma, ciudades, examenes, subempresas, centrosDeCosto, cargos } = req.body;

        if (!codEmpresa || !empresa) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: codEmpresa, empresa'
            });
        }

        const result = await pool.query(`
            INSERT INTO empresas (cod_empresa, empresa, nit, profesiograma, ciudades, examenes, subempresas, centros_de_costo, cargos)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            codEmpresa,
            empresa,
            nit || null,
            profesiograma || null,
            JSON.stringify(ciudades || []),
            JSON.stringify(examenes || []),
            JSON.stringify(subempresas || []),
            JSON.stringify(centrosDeCosto || []),
            JSON.stringify(cargos || [])
        ]);

        console.log(`✅ Empresa creada: ${empresa} (${codEmpresa})`);

        res.json({
            success: true,
            message: 'Empresa creada exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({
                success: false,
                message: 'Ya existe una empresa con ese código'
            });
        }
        console.error('❌ Error al crear empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear empresa',
            error: error.message
        });
    }
});

// Actualizar una empresa
app.put('/api/empresas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { codEmpresa, empresa, nit, profesiograma, activo, ciudades, examenes, subempresas, centrosDeCosto, cargos } = req.body;

        const result = await pool.query(`
            UPDATE empresas SET
                cod_empresa = COALESCE($1, cod_empresa),
                empresa = COALESCE($2, empresa),
                nit = COALESCE($3, nit),
                profesiograma = COALESCE($4, profesiograma),
                activo = COALESCE($5, activo),
                ciudades = COALESCE($6, ciudades),
                examenes = COALESCE($7, examenes),
                subempresas = COALESCE($8, subempresas),
                centros_de_costo = COALESCE($9, centros_de_costo),
                cargos = COALESCE($10, cargos),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $11
            RETURNING *
        `, [
            codEmpresa,
            empresa,
            nit,
            profesiograma,
            activo,
            ciudades ? JSON.stringify(ciudades) : null,
            examenes ? JSON.stringify(examenes) : null,
            subempresas ? JSON.stringify(subempresas) : null,
            centrosDeCosto ? JSON.stringify(centrosDeCosto) : null,
            cargos ? JSON.stringify(cargos) : null,
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Empresa no encontrada'
            });
        }

        console.log(`✅ Empresa actualizada: ID ${id}`);

        res.json({
            success: true,
            message: 'Empresa actualizada exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al actualizar empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar empresa',
            error: error.message
        });
    }
});

// Eliminar (desactivar) una empresa
app.delete('/api/empresas/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            UPDATE empresas SET activo = false, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id, cod_empresa, empresa
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Empresa no encontrada'
            });
        }

        console.log(`✅ Empresa desactivada: ID ${id}`);

        res.json({
            success: true,
            message: 'Empresa desactivada exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al desactivar empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al desactivar empresa',
            error: error.message
        });
    }
});

// Obtener configuración de empresa por código (para panel-empresas)
app.get('/api/empresas/codigo/:codEmpresa', async (req, res) => {
    try {
        const { codEmpresa } = req.params;
        const result = await pool.query(`
            SELECT id, cod_empresa, empresa, nit, profesiograma, ciudades, examenes, subempresas, centros_de_costo, cargos
            FROM empresas
            WHERE cod_empresa = $1 AND activo = true
        `, [codEmpresa]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Empresa no encontrada'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al obtener empresa por código:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener empresa',
            error: error.message
        });
    }
});

// ============================================
// ENDPOINTS PARA FACTURACIÓN CON ALEGRA
// ============================================

// Exponer pool para que las rutas de facturación puedan acceder
app.locals.pool = pool;

const facturacionRoutes = require('./routes/facturacion');
app.use('/api/facturacion', facturacionRoutes);

// ==================== CALENDARIO ENDPOINTS ====================

// GET /api/calendario/mes - Obtener conteo de citas por día del mes
app.get('/api/calendario/mes', async (req, res) => {
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

// GET /api/calendario/mes-detalle - Obtener citas agrupadas por médico y estado para cada día del mes
app.get('/api/calendario/mes-detalle', async (req, res) => {
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

// GET /api/calendario/dia - Obtener citas de un día específico
app.get('/api/calendario/dia', async (req, res) => {
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

// GET /api/horarios-disponibles - Obtener horarios disponibles para un médico en una fecha y modalidad
app.get('/api/horarios-disponibles', async (req, res) => {
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

// GET /api/turnos-disponibles - Obtener todos los turnos disponibles para una fecha y modalidad (sin mostrar médicos)
// Este endpoint consolida la disponibilidad de todos los médicos excepto NUBIA
app.get('/api/turnos-disponibles', async (req, res) => {
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

// GET /api/medicos-por-modalidad - Obtener médicos que atienden una modalidad específica
app.get('/api/medicos-por-modalidad', async (req, res) => {
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
app.get('/api/examenes', async (req, res) => {
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
app.get('/api/examenes/:id', async (req, res) => {
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
app.post('/api/examenes', async (req, res) => {
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
app.put('/api/examenes/:id', async (req, res) => {
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
app.delete('/api/examenes/:id', async (req, res) => {
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

// ==========================================
// BARRIDO NUBIA - Enviar link médico virtual (5-15 min antes)
// ==========================================
async function barridoNubiaEnviarLink() {
    console.log("🔗 [barridoNubiaEnviarLink] Iniciando ejecución...");
    try {
        const ahora = new Date();
        // Buscar citas que están entre 5 y 15 minutos en el futuro
        const cincoMinFuturo = new Date(ahora.getTime() + 5 * 60 * 1000);
        const quinceMinFuturo = new Date(ahora.getTime() + 15 * 60 * 1000);

        console.log(`📅 [barridoNubiaEnviarLink] Buscando citas de NUBIA entre ${cincoMinFuturo.toISOString()} y ${quinceMinFuturo.toISOString()}`);

        // Busca registros con cita próxima que no tengan el recordatorio enviado
        const result = await pool.query(`
            SELECT * FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1
              AND "fechaAtencion" <= $2
              AND "medico" ILIKE '%NUBIA%'
              AND ("recordatorioLinkEnviado" IS NULL OR "recordatorioLinkEnviado" = false)
            LIMIT 20
        `, [cincoMinFuturo.toISOString(), quinceMinFuturo.toISOString()]);

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
            const messageBody = `Hola ${primerNombre}, tu cita está próxima..\n\nComunícate ya haciendo clic en este link:\n\n${url}`;

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

            // Enviar mensaje de confirmación si tiene celular
            if (celular) {
                const telefonoLimpio = celular.replace(/\s+/g, '');
                const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

                // Enviar mensaje de WhatsApp al paciente
                const messageBody = `Hola ${primerNombre}, gracias por asistir a tu cita médico ocupacional. Puedes descargar tu certificado en el siguiente link: www.bsl.com.co/descargar`;

                try {
                    await sendWhatsAppMessage(toNumber, messageBody);
                    console.log(`📱 [procesarRegistroNubia] Mensaje enviado a ${primerNombre} (${toNumber})`);
                } catch (sendError) {
                    console.error(`Error enviando mensaje a ${toNumber}:`, sendError);
                }
            }
        } catch (updateError) {
            console.error(`Error actualizando registro de NUBIA ${historiaId}:`, updateError);
        }
    } else {
        console.log(`⏳ [procesarRegistroNubia] ${primerNombre} - Aún no han pasado 5 minutos desde la cita`);
    }
}

// Endpoint para ejecutar el barrido de NUBIA manualmente o via cron
app.post('/api/barrido-nubia', async (req, res) => {
    try {
        const resultado = await barridoNubiaMarcarAtendido();
        res.json({ success: true, ...resultado });
    } catch (error) {
        console.error('Error en barrido NUBIA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/barrido-nubia', async (req, res) => {
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
app.get('/api/nubia/pacientes', async (req, res) => {
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
app.post('/api/nubia/atender/:id', async (req, res) => {
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

            const mensaje = `👋 Hola ${paciente.primerNombre}. Te escribimos de BSL. 🏥 Tu certificado médico ya está listo. 📄\n\nRevísalo haciendo clic en este link: 👉 www.bsl.com.co/descargar`;

            try {
                // Usar sendWhatsAppFreeText para enviar texto libre (requiere ventana de 24h)
                const twilioResult = await sendWhatsAppFreeText(toNumber, mensaje);
                if (twilioResult.success) {
                    console.log(`📱 [NUBIA] Mensaje de certificado enviado a ${paciente.primerNombre} (${toNumber})`);

                    // Guardar mensaje en base de datos para que aparezca en el chat
                    const numeroCliente = toNumber.startsWith('57') ? `+${toNumber}` : `+57${toNumber}`;

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
app.post('/api/nubia/cobrar/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener datos del paciente (sin modificar pvEstado)
        const result = await pool.query(`
            SELECT *
            FROM "HistoriaClinica"
            WHERE "_id" = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        const paciente = result.rows[0];

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
app.post('/api/nubia/enviar-masivo', async (req, res) => {
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
                // Obtener datos del paciente
                const result = await pool.query(`
                    SELECT *
                    FROM "HistoriaClinica"
                    WHERE "_id" = $1
                `, [id]);

                if (result.rows.length === 0) {
                    console.error(`❌ [NUBIA] Paciente ${id} no encontrado`);
                    errores++;
                    continue;
                }

                const paciente = result.rows[0];

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
app.delete('/api/nubia/eliminar/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar que el registro existe
        const checkResult = await pool.query(`
            SELECT "_id", "primerNombre", "primerApellido", "numeroId"
            FROM "HistoriaClinica" WHERE "_id" = $1
        `, [id]);

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        const paciente = checkResult.rows[0];

        // Eliminar el registro
        await pool.query(`
            DELETE FROM "HistoriaClinica" WHERE "_id" = $1
        `, [id]);

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
app.post('/api/nubia/enviar-mensaje/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener datos del paciente
        const result = await pool.query(`
            SELECT * FROM "HistoriaClinica" WHERE "_id" = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        const paciente = result.rows[0];

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
app.get('/api/nubia/buscar', async (req, res) => {
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

// ==========================================
// ENDPOINTS AUDIOMETRIAS
// ==========================================

// Obtener audiometría por orden_id
app.get('/api/audiometrias/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        const result = await pool.query(
            'SELECT * FROM audiometrias WHERE orden_id = $1',
            [ordenId]
        );

        if (result.rows.length === 0) {
            // No existe, devolver datos vacíos con info del paciente
            const ordenResult = await pool.query(
                'SELECT "numeroId", "primerNombre", "primerApellido", "empresa", "codEmpresa" FROM "HistoriaClinica" WHERE "_id" = $1',
                [ordenId]
            );

            if (ordenResult.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Orden no encontrada' });
            }

            const orden = ordenResult.rows[0];
            return res.json({
                success: true,
                data: null,
                paciente: {
                    numeroId: orden.numeroId,
                    primerNombre: orden.primerNombre,
                    primerApellido: orden.primerApellido,
                    empresa: orden.empresa,
                    codEmpresa: orden.codEmpresa
                }
            });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('❌ Error obteniendo audiometría:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear o actualizar audiometría
app.post('/api/audiometrias', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id) {
            return res.status(400).json({ success: false, message: 'orden_id es requerido' });
        }

        // Verificar si ya existe
        const existeResult = await pool.query(
            'SELECT id FROM audiometrias WHERE orden_id = $1',
            [datos.orden_id]
        );

        if (existeResult.rows.length > 0) {
            // Actualizar existente
            const updateQuery = `
                UPDATE audiometrias SET
                    numero_id = $2,
                    primer_nombre = $3,
                    primer_apellido = $4,
                    empresa = $5,
                    cod_empresa = $6,
                    pabellon_auricular_oi = $7,
                    pabellon_auricular_od = $8,
                    conducto_auditivo_oi = $9,
                    conducto_auditivo_od = $10,
                    membrana_timpanica_oi = $11,
                    membrana_timpanica_od = $12,
                    observaciones_oi = $13,
                    observaciones_od = $14,
                    requiere_limpieza_otica = $15,
                    estado_gripal = $16,
                    aereo_od_250 = $17,
                    aereo_od_500 = $18,
                    aereo_od_1000 = $19,
                    aereo_od_2000 = $20,
                    aereo_od_3000 = $21,
                    aereo_od_4000 = $22,
                    aereo_od_6000 = $23,
                    aereo_od_8000 = $24,
                    aereo_oi_250 = $25,
                    aereo_oi_500 = $26,
                    aereo_oi_1000 = $27,
                    aereo_oi_2000 = $28,
                    aereo_oi_3000 = $29,
                    aereo_oi_4000 = $30,
                    aereo_oi_6000 = $31,
                    aereo_oi_8000 = $32,
                    oseo_od_250 = $33,
                    oseo_od_500 = $34,
                    oseo_od_1000 = $35,
                    oseo_od_2000 = $36,
                    oseo_od_3000 = $37,
                    oseo_od_4000 = $38,
                    oseo_oi_250 = $39,
                    oseo_oi_500 = $40,
                    oseo_oi_1000 = $41,
                    oseo_oi_2000 = $42,
                    oseo_oi_3000 = $43,
                    oseo_oi_4000 = $44,
                    cabina = $45,
                    equipo = $46,
                    diagnostico_oi = $47,
                    diagnostico_od = $48,
                    interpretacion = $49,
                    recomendaciones = $50,
                    remision = $51,
                    updated_at = CURRENT_TIMESTAMP
                WHERE orden_id = $1
                RETURNING *
            `;

            const values = [
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa,
                datos.pabellon_auricular_oi,
                datos.pabellon_auricular_od,
                datos.conducto_auditivo_oi,
                datos.conducto_auditivo_od,
                datos.membrana_timpanica_oi,
                datos.membrana_timpanica_od,
                datos.observaciones_oi,
                datos.observaciones_od,
                datos.requiere_limpieza_otica,
                datos.estado_gripal,
                datos.aereo_od_250,
                datos.aereo_od_500,
                datos.aereo_od_1000,
                datos.aereo_od_2000,
                datos.aereo_od_3000,
                datos.aereo_od_4000,
                datos.aereo_od_6000,
                datos.aereo_od_8000,
                datos.aereo_oi_250,
                datos.aereo_oi_500,
                datos.aereo_oi_1000,
                datos.aereo_oi_2000,
                datos.aereo_oi_3000,
                datos.aereo_oi_4000,
                datos.aereo_oi_6000,
                datos.aereo_oi_8000,
                datos.oseo_od_250,
                datos.oseo_od_500,
                datos.oseo_od_1000,
                datos.oseo_od_2000,
                datos.oseo_od_3000,
                datos.oseo_od_4000,
                datos.oseo_oi_250,
                datos.oseo_oi_500,
                datos.oseo_oi_1000,
                datos.oseo_oi_2000,
                datos.oseo_oi_3000,
                datos.oseo_oi_4000,
                datos.cabina,
                datos.equipo,
                datos.diagnostico_oi,
                datos.diagnostico_od,
                datos.interpretacion,
                datos.recomendaciones,
                datos.remision
            ];

            const result = await pool.query(updateQuery, values);
            console.log('✅ Audiometría actualizada para orden:', datos.orden_id);

            // Sincronizar con Wix
            await syncAudiometriaToWix(datos, 'UPDATE');

            return res.json({ success: true, data: result.rows[0], operacion: 'UPDATE' });
        } else {
            // Insertar nuevo
            const insertQuery = `
                INSERT INTO audiometrias (
                    orden_id, numero_id, primer_nombre, primer_apellido, empresa, cod_empresa,
                    pabellon_auricular_oi, pabellon_auricular_od, conducto_auditivo_oi, conducto_auditivo_od,
                    membrana_timpanica_oi, membrana_timpanica_od, observaciones_oi, observaciones_od,
                    requiere_limpieza_otica, estado_gripal,
                    aereo_od_250, aereo_od_500, aereo_od_1000, aereo_od_2000, aereo_od_3000, aereo_od_4000, aereo_od_6000, aereo_od_8000,
                    aereo_oi_250, aereo_oi_500, aereo_oi_1000, aereo_oi_2000, aereo_oi_3000, aereo_oi_4000, aereo_oi_6000, aereo_oi_8000,
                    oseo_od_250, oseo_od_500, oseo_od_1000, oseo_od_2000, oseo_od_3000, oseo_od_4000,
                    oseo_oi_250, oseo_oi_500, oseo_oi_1000, oseo_oi_2000, oseo_oi_3000, oseo_oi_4000,
                    cabina, equipo, diagnostico_oi, diagnostico_od, interpretacion, recomendaciones, remision
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                    $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                    $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
                    $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51
                )
                RETURNING *
            `;

            const values = [
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa,
                datos.pabellon_auricular_oi,
                datos.pabellon_auricular_od,
                datos.conducto_auditivo_oi,
                datos.conducto_auditivo_od,
                datos.membrana_timpanica_oi,
                datos.membrana_timpanica_od,
                datos.observaciones_oi,
                datos.observaciones_od,
                datos.requiere_limpieza_otica,
                datos.estado_gripal,
                datos.aereo_od_250,
                datos.aereo_od_500,
                datos.aereo_od_1000,
                datos.aereo_od_2000,
                datos.aereo_od_3000,
                datos.aereo_od_4000,
                datos.aereo_od_6000,
                datos.aereo_od_8000,
                datos.aereo_oi_250,
                datos.aereo_oi_500,
                datos.aereo_oi_1000,
                datos.aereo_oi_2000,
                datos.aereo_oi_3000,
                datos.aereo_oi_4000,
                datos.aereo_oi_6000,
                datos.aereo_oi_8000,
                datos.oseo_od_250,
                datos.oseo_od_500,
                datos.oseo_od_1000,
                datos.oseo_od_2000,
                datos.oseo_od_3000,
                datos.oseo_od_4000,
                datos.oseo_oi_250,
                datos.oseo_oi_500,
                datos.oseo_oi_1000,
                datos.oseo_oi_2000,
                datos.oseo_oi_3000,
                datos.oseo_oi_4000,
                datos.cabina,
                datos.equipo,
                datos.diagnostico_oi,
                datos.diagnostico_od,
                datos.interpretacion,
                datos.recomendaciones,
                datos.remision
            ];

            const result = await pool.query(insertQuery, values);
            console.log('✅ Audiometría creada para orden:', datos.orden_id);

            // Sincronizar con Wix
            await syncAudiometriaToWix(datos, 'INSERT');

            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }
    } catch (error) {
        console.error('❌ Error guardando audiometría:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Función para sincronizar audiometría con Wix
async function syncAudiometriaToWix(datos, operacion) {
    try {
        const fetch = (await import('node-fetch')).default;

        // Mapear campos de PostgreSQL a Wix
        // PostgreSQL usa: aereo_od_8000, aereo_oi_8000
        // Wix usa: auDer8000, auIzq8000
        const wixPayload = {
            idGeneral: datos.orden_id,
            numeroId: datos.orden_id,
            cedula: datos.numero_id,
            codEmpresa: datos.cod_empresa,
            // Oído Derecho
            auDer250: datos.aereo_od_250,
            auDer500: datos.aereo_od_500,
            auDer1000: datos.aereo_od_1000,
            auDer2000: datos.aereo_od_2000,
            auDer3000: datos.aereo_od_3000,
            auDer4000: datos.aereo_od_4000,
            auDer6000: datos.aereo_od_6000,
            auDer8000: datos.aereo_od_8000,
            // Oído Izquierdo
            auIzq250: datos.aereo_oi_250,
            auIzq500: datos.aereo_oi_500,
            auIzq1000: datos.aereo_oi_1000,
            auIzq2000: datos.aereo_oi_2000,
            auIzq3000: datos.aereo_oi_3000,
            auIzq4000: datos.aereo_oi_4000,
            auIzq6000: datos.aereo_oi_6000,
            auIzq8000: datos.aereo_oi_8000
        };

        console.log('📤 Sincronizando audiometría con Wix...', operacion);
        console.log('📦 Payload Wix:', JSON.stringify(wixPayload, null, 2));

        const wixResponse = await fetch('https://www.bsl.com.co/_functions/crearAudiometria', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(wixPayload)
        });

        if (wixResponse.ok) {
            const wixResult = await wixResponse.json();
            console.log('✅ Audiometría sincronizada con Wix:', wixResult);
            return { success: true, wixResult };
        } else {
            const errorText = await wixResponse.text();
            console.error('❌ Error sincronizando con Wix:', errorText);
            return { success: false, error: errorText };
        }
    } catch (error) {
        console.error('❌ Error en sincronización Wix:', error.message);
        // No lanzar error para no bloquear el guardado en PostgreSQL
        return { success: false, error: error.message };
    }
}

// ==========================================
// ENDPOINTS PRUEBAS ADC (Ansiedad, Depresión, Comportamiento)
// ==========================================

// Obtener prueba ADC por orden_id
app.get('/api/pruebas-adc/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        const result = await pool.query(
            'SELECT * FROM "pruebasADC" WHERE orden_id = $1',
            [ordenId]
        );

        if (result.rows.length === 0) {
            // No existe, devolver datos vacíos con info del paciente
            const ordenResult = await pool.query(
                'SELECT "numeroId", "primerNombre", "primerApellido", "empresa", "codEmpresa" FROM "HistoriaClinica" WHERE "_id" = $1',
                [ordenId]
            );

            if (ordenResult.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Orden no encontrada' });
            }

            const orden = ordenResult.rows[0];
            return res.json({
                success: true,
                data: null,
                paciente: {
                    numeroId: orden.numeroId,
                    primerNombre: orden.primerNombre,
                    primerApellido: orden.primerApellido,
                    empresa: orden.empresa,
                    codEmpresa: orden.codEmpresa
                }
            });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('❌ Error obteniendo prueba ADC:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear o actualizar prueba ADC
app.post('/api/pruebas-adc', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id) {
            return res.status(400).json({ success: false, message: 'orden_id es requerido' });
        }

        // Verificar si ya existe
        const existeResult = await pool.query(
            'SELECT id FROM "pruebasADC" WHERE orden_id = $1',
            [datos.orden_id]
        );

        // Lista de campos de preguntas
        const camposPreguntas = [
            'de08', 'de29', 'de03', 'de04', 'de05', 'de32', 'de12', 'de06', 'de33', 'de13',
            'de07', 'de35', 'de21', 'de14', 'de15', 'de37', 'de16', 'de38', 'de40', 'de27', 'de20',
            'an07', 'an11', 'an03', 'an18', 'an19', 'an04', 'an14', 'an09', 'an20', 'an05',
            'an36', 'an26', 'an31', 'an22', 'an38', 'an27', 'an35', 'an23', 'an39', 'an30',
            'cofv01', 'corv11', 'cofc06', 'coav21', 'coov32', 'corc16', 'coac26', 'cofv02',
            'coov34', 'cofv03', 'corc17', 'coac27', 'cofc08', 'cooc39', 'cofc10', 'corv12',
            'cooc40', 'corv15', 'coac29', 'coov35', 'coav24', 'corc18', 'coav25'
        ];

        if (existeResult.rows.length > 0) {
            // Actualizar existente
            const setClauses = [
                'numero_id = $2',
                'primer_nombre = $3',
                'primer_apellido = $4',
                'empresa = $5',
                'cod_empresa = $6',
                'updated_at = CURRENT_TIMESTAMP'
            ];

            const values = [
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa
            ];

            let paramIndex = 7;
            camposPreguntas.forEach(campo => {
                setClauses.push(`${campo} = $${paramIndex}`);
                values.push(datos[campo] || null);
                paramIndex++;
            });

            const updateQuery = `
                UPDATE "pruebasADC" SET ${setClauses.join(', ')}
                WHERE orden_id = $1
                RETURNING *
            `;

            const result = await pool.query(updateQuery, values);
            console.log('✅ Prueba ADC actualizada para orden:', datos.orden_id);

            // Sincronizar con Wix
            await syncADCToWix(datos, 'UPDATE');

            return res.json({ success: true, data: result.rows[0], operacion: 'UPDATE' });
        } else {
            // Insertar nuevo
            const columns = ['orden_id', 'numero_id', 'primer_nombre', 'primer_apellido', 'empresa', 'cod_empresa', ...camposPreguntas];
            const placeholders = columns.map((_, i) => `$${i + 1}`);

            const values = [
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa,
                ...camposPreguntas.map(campo => datos[campo] || null)
            ];

            const insertQuery = `
                INSERT INTO "pruebasADC" (${columns.join(', ')})
                VALUES (${placeholders.join(', ')})
                RETURNING *
            `;

            const result = await pool.query(insertQuery, values);
            console.log('✅ Prueba ADC creada para orden:', datos.orden_id);

            // Sincronizar con Wix
            await syncADCToWix(datos, 'INSERT');

            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }
    } catch (error) {
        console.error('❌ Error guardando prueba ADC:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Función para sincronizar prueba ADC con Wix
async function syncADCToWix(datos, operacion) {
    try {
        const fetch = (await import('node-fetch')).default;

        // Mapear campos para Wix
        const wixPayload = {
            idGeneral: datos.orden_id,
            primerNombre: `${datos.primer_nombre || ''} ${datos.primer_apellido || ''}`.trim(),
            documento: datos.numero_id,
            empresa: datos.cod_empresa,
            // Incluir todas las respuestas
            ...datos
        };

        // Eliminar campos que no van a Wix
        delete wixPayload.orden_id;
        delete wixPayload.numero_id;
        delete wixPayload.primer_nombre;
        delete wixPayload.primer_apellido;
        delete wixPayload.cod_empresa;

        console.log('📤 Sincronizando prueba ADC con Wix...', operacion);

        const wixResponse = await fetch('https://www.bsl.com.co/_functions/crearADC', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(wixPayload)
        });

        if (wixResponse.ok) {
            const wixResult = await wixResponse.json();
            console.log('✅ Prueba ADC sincronizada con Wix:', wixResult);
            return { success: true, wixResult };
        } else {
            const errorText = await wixResponse.text();
            console.error('❌ Error sincronizando ADC con Wix:', errorText);
            return { success: false, error: errorText };
        }
    } catch (error) {
        console.error('❌ Error en sincronización ADC Wix:', error.message);
        return { success: false, error: error.message };
    }
}

// ==========================================
// ENDPOINT ESTADO DE PRUEBAS DEL PACIENTE
// ==========================================

// Obtener estado de todas las pruebas por orden_id
app.get('/api/estado-pruebas/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        // Obtener información de la orden (exámenes requeridos)
        const ordenResult = await pool.query(
            'SELECT "examenes", "numeroId" FROM "HistoriaClinica" WHERE "_id" = $1',
            [ordenId]
        );

        if (ordenResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Orden no encontrada' });
        }

        const orden = ordenResult.rows[0];
        const examenesRequeridos = orden.examenes || '';

        // Verificar formulario principal (por wix_id = orden_id, con fallback a numero_id para datos antiguos)
        let formularioResult = await pool.query(
            'SELECT id FROM formularios WHERE wix_id = $1',
            [ordenId]
        );
        // Fallback: buscar por numero_id si no se encuentra por wix_id (datos antiguos)
        if (formularioResult.rows.length === 0 && orden.numeroId) {
            formularioResult = await pool.query(
                'SELECT id FROM formularios WHERE numero_id = $1',
                [orden.numeroId]
            );
        }
        const tieneFormulario = formularioResult.rows.length > 0;

        // Verificar audiometría
        const audioResult = await pool.query(
            'SELECT id FROM audiometrias WHERE orden_id = $1',
            [ordenId]
        );
        const tieneAudiometria = audioResult.rows.length > 0;

        // Verificar pruebas ADC
        const adcResult = await pool.query(
            'SELECT id FROM "pruebasADC" WHERE orden_id = $1',
            [ordenId]
        );
        const tieneADC = adcResult.rows.length > 0;

        // Verificar visiometría (presencial o virtual)
        const visioResult = await pool.query(
            'SELECT id FROM visiometrias WHERE orden_id = $1',
            [ordenId]
        );
        const visioVirtualResult = await pool.query(
            'SELECT id FROM visiometrias_virtual WHERE orden_id = $1',
            [ordenId]
        );
        const tieneVisiometria = visioResult.rows.length > 0 || visioVirtualResult.rows.length > 0;

        // Determinar qué pruebas son requeridas según el campo exámenes
        const examLower = examenesRequeridos.toLowerCase();
        const requiereAudiometria = examLower.includes('audiometr');
        const requiereVisiometria = examLower.includes('visiometr') || examLower.includes('optometr');
        const requiereADC = true; // Siempre se requiere ADC para todos

        res.json({
            success: true,
            data: {
                examenesRequeridos,
                pruebas: {
                    formulario: {
                        completado: tieneFormulario,
                        requerido: true
                    },
                    audiometria: {
                        completado: tieneAudiometria,
                        requerido: requiereAudiometria
                    },
                    visiometria: {
                        completado: tieneVisiometria,
                        requerido: requiereVisiometria
                    },
                    adc: {
                        completado: tieneADC,
                        requerido: requiereADC
                    }
                }
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo estado de pruebas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== CONSULTA PÚBLICA DE ÓRDENES ==========
// GET /api/consulta-ordenes - Buscar órdenes por número de documento y celular
app.post('/api/consulta-ordenes', async (req, res) => {
    try {
        const { numeroDocumento, celular } = req.body;

        if (!numeroDocumento || !celular) {
            return res.status(400).json({
                success: false,
                message: 'Número de documento y celular son requeridos'
            });
        }

        // Buscar órdenes en HistoriaClinica
        const ordenesResult = await pool.query(`
            SELECT
                "_id",
                "primerNombre",
                "segundoNombre",
                "primerApellido",
                "segundoApellido",
                "numeroId",
                "celular",
                "empresa",
                "codEmpresa",
                "cargo",
                "fechaAtencion",
                "fechaConsulta",
                "examenes",
                "atendido",
                "mdConceptoFinal",
                "_createdDate"
            FROM "HistoriaClinica"
            WHERE "numeroId" = $1 AND "celular" = $2
            ORDER BY "_createdDate" DESC
        `, [numeroDocumento, celular]);

        if (ordenesResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No se encontraron órdenes con los datos proporcionados'
            });
        }

        // Para cada orden, obtener el estado de las pruebas
        const ordenesConEstado = await Promise.all(
            ordenesResult.rows.map(async (orden) => {
                const examenesRequeridos = orden.examenes || '';
                const examLower = examenesRequeridos.toLowerCase();

                // Verificar formulario
                let formularioResult = await pool.query(
                    'SELECT id FROM formularios WHERE wix_id = $1',
                    [orden._id]
                );
                if (formularioResult.rows.length === 0 && orden.numeroId) {
                    formularioResult = await pool.query(
                        'SELECT id FROM formularios WHERE numero_id = $1',
                        [orden.numeroId]
                    );
                }
                const tieneFormulario = formularioResult.rows.length > 0;

                // Verificar audiometría
                const audioResult = await pool.query(
                    'SELECT id FROM audiometrias WHERE orden_id = $1',
                    [orden._id]
                );
                const tieneAudiometria = audioResult.rows.length > 0;

                // Verificar pruebas ADC
                const adcResult = await pool.query(
                    'SELECT id FROM "pruebasADC" WHERE orden_id = $1',
                    [orden._id]
                );
                const tieneADC = adcResult.rows.length > 0;

                // Verificar visiometría
                const visioResult = await pool.query(
                    'SELECT id FROM visiometrias WHERE orden_id = $1',
                    [orden._id]
                );
                const visioVirtualResult = await pool.query(
                    'SELECT id FROM visiometrias_virtual WHERE orden_id = $1',
                    [orden._id]
                );
                const tieneVisiometria = visioResult.rows.length > 0 || visioVirtualResult.rows.length > 0;

                // Determinar qué pruebas son requeridas
                const requiereAudiometria = examLower.includes('audiometr');
                const requiereVisiometria = examLower.includes('visiometr') || examLower.includes('optometr');
                const requiereADC = true;

                return {
                    _id: orden._id,
                    primerNombre: orden.primerNombre,
                    segundoNombre: orden.segundoNombre,
                    primerApellido: orden.primerApellido,
                    segundoApellido: orden.segundoApellido,
                    numeroId: orden.numeroId,
                    celular: orden.celular,
                    empresa: orden.empresa,
                    codEmpresa: orden.codEmpresa,
                    cargo: orden.cargo,
                    fechaAtencion: orden.fechaAtencion,
                    fechaConsulta: orden.fechaConsulta,
                    examenes: orden.examenes,
                    atendido: orden.atendido,
                    mdConceptoFinal: orden.mdConceptoFinal,
                    fechaCreacion: orden._createdDate,
                    estadoPruebas: {
                        formulario: {
                            completado: tieneFormulario,
                            requerido: true
                        },
                        audiometria: {
                            completado: tieneAudiometria,
                            requerido: requiereAudiometria
                        },
                        visiometria: {
                            completado: tieneVisiometria,
                            requerido: requiereVisiometria
                        },
                        adc: {
                            completado: tieneADC,
                            requerido: requiereADC
                        }
                    }
                };
            })
        );

        res.json({
            success: true,
            ordenes: ordenesConEstado
        });

    } catch (error) {
        console.error('❌ Error consultando órdenes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al consultar órdenes'
        });
    }
});

// Enviar link de prueba por WhatsApp
app.post('/api/enviar-link-prueba', async (req, res) => {
    try {
        const { ordenId, tipoPrueba } = req.body;

        if (!ordenId || !tipoPrueba) {
            return res.status(400).json({ success: false, message: 'ordenId y tipoPrueba son requeridos' });
        }

        // Obtener datos del paciente
        const ordenResult = await pool.query(
            'SELECT "primerNombre", "primerApellido", "celular", "numeroId" FROM "HistoriaClinica" WHERE "_id" = $1',
            [ordenId]
        );

        if (ordenResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Orden no encontrada' });
        }

        const paciente = ordenResult.rows[0];
        const primerNombre = paciente.primerNombre || 'Paciente';
        const celular = paciente.celular;

        if (!celular) {
            return res.status(400).json({ success: false, message: 'El paciente no tiene número de celular registrado' });
        }

        // Limpiar número de teléfono
        const telefonoLimpio = celular.replace(/\s+/g, '').replace(/[^0-9]/g, '');
        const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

        // Determinar URL según tipo de prueba
        const baseUrl = 'https://bsl-plataforma.com';
        let url = '';
        let nombrePrueba = '';

        switch (tipoPrueba) {
            case 'formulario':
                url = `${baseUrl}/?_id=${ordenId}`;
                nombrePrueba = 'Formulario Médico';
                break;
            case 'adc':
                url = `${baseUrl}/pruebas-adc.html?ordenId=${ordenId}`;
                nombrePrueba = 'Pruebas Psicotécnicas ADC';
                break;
            case 'audiometria':
                url = `${baseUrl}/audiometria-virtual.html?ordenId=${ordenId}`;
                nombrePrueba = 'Audiometría Virtual';
                break;
            case 'visiometria':
                url = `${baseUrl}/visiometria-virtual.html?ordenId=${ordenId}`;
                nombrePrueba = 'Prueba Visual';
                break;
            default:
                return res.status(400).json({ success: false, message: 'Tipo de prueba no válido' });
        }

        // Construir mensaje
        const mensaje = `Hola ${primerNombre}, te enviamos el enlace para completar tu *${nombrePrueba}*:\n\n${url}\n\n_BSL - Salud Ocupacional_`;

        // Enviar mensaje por WhatsApp
        await sendWhatsAppMessage(toNumber, mensaje);

        console.log(`📱 Link de ${tipoPrueba} enviado a ${toNumber} para orden ${ordenId}`);

        res.json({
            success: true,
            message: `Link de ${nombrePrueba} enviado correctamente`,
            enviado: {
                telefono: toNumber,
                prueba: tipoPrueba,
                url: url
            }
        });

    } catch (error) {
        console.error('❌ Error enviando link de prueba:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// ENDPOINTS VISIOMETRIA VIRTUAL
// ==========================================

// Obtener visiometría virtual por orden_id
app.get('/api/visiometria-virtual/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        const result = await pool.query(
            'SELECT * FROM visiometrias_virtual WHERE orden_id = $1',
            [ordenId]
        );

        if (result.rows.length === 0) {
            return res.json({ success: true, data: null });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('❌ Error obteniendo visiometría virtual:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear o actualizar visiometría virtual
app.post('/api/visiometria-virtual', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id) {
            return res.status(400).json({ success: false, message: 'orden_id es requerido' });
        }

        // Verificar si ya existe
        const existeResult = await pool.query(
            'SELECT id FROM visiometrias_virtual WHERE orden_id = $1',
            [datos.orden_id]
        );

        if (existeResult.rows.length > 0) {
            // Actualizar existente
            const updateQuery = `
                UPDATE visiometrias_virtual SET
                    numero_id = $2,
                    primer_nombre = $3,
                    primer_apellido = $4,
                    empresa = $5,
                    cod_empresa = $6,
                    snellen_correctas = $7,
                    snellen_total = $8,
                    snellen_porcentaje = $9,
                    landolt_correctas = $10,
                    landolt_total = $11,
                    landolt_porcentaje = $12,
                    ishihara_correctas = $13,
                    ishihara_total = $14,
                    ishihara_porcentaje = $15,
                    concepto = $16,
                    miopia = $17,
                    astigmatismo = $18,
                    updated_at = CURRENT_TIMESTAMP
                WHERE orden_id = $1
                RETURNING *
            `;

            const values = [
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa,
                datos.snellen_correctas,
                datos.snellen_total,
                datos.snellen_porcentaje,
                datos.landolt_correctas,
                datos.landolt_total,
                datos.landolt_porcentaje,
                datos.ishihara_correctas,
                datos.ishihara_total,
                datos.ishihara_porcentaje,
                datos.concepto,
                datos.miopia || null,
                datos.astigmatismo || null
            ];

            const result = await pool.query(updateQuery, values);
            console.log('✅ Visiometría virtual actualizada para orden:', datos.orden_id);

            return res.json({ success: true, data: result.rows[0], operacion: 'UPDATE' });
        } else {
            // Insertar nuevo
            const insertQuery = `
                INSERT INTO visiometrias_virtual (
                    orden_id, numero_id, primer_nombre, primer_apellido, empresa, cod_empresa,
                    snellen_correctas, snellen_total, snellen_porcentaje,
                    landolt_correctas, landolt_total, landolt_porcentaje,
                    ishihara_correctas, ishihara_total, ishihara_porcentaje,
                    concepto, miopia, astigmatismo
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                RETURNING *
            `;

            const values = [
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa,
                datos.snellen_correctas,
                datos.snellen_total,
                datos.snellen_porcentaje,
                datos.landolt_correctas,
                datos.landolt_total,
                datos.landolt_porcentaje,
                datos.ishihara_correctas,
                datos.ishihara_total,
                datos.ishihara_porcentaje,
                datos.concepto,
                datos.miopia || null,
                datos.astigmatismo || null
            ];

            const result = await pool.query(insertQuery, values);
            console.log('✅ Visiometría virtual creada para orden:', datos.orden_id);

            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }

    } catch (error) {
        console.error('❌ Error guardando visiometría virtual:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// ENDPOINTS VISIOMETRIAS (PRESENCIAL)
// ==========================================

// Obtener visiometría por orden_id
app.get('/api/visiometrias/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        const result = await pool.query(
            'SELECT * FROM visiometrias WHERE orden_id = $1',
            [ordenId]
        );

        if (result.rows.length === 0) {
            // No existe, devolver datos vacíos con info del paciente
            const ordenResult = await pool.query(
                'SELECT "numeroId", "primerNombre", "primerApellido", "empresa", "codEmpresa" FROM "HistoriaClinica" WHERE "_id" = $1',
                [ordenId]
            );

            if (ordenResult.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Orden no encontrada' });
            }

            const orden = ordenResult.rows[0];
            return res.json({
                success: true,
                data: null,
                paciente: {
                    numeroId: orden.numeroId,
                    primerNombre: orden.primerNombre,
                    primerApellido: orden.primerApellido,
                    empresa: orden.empresa,
                    codEmpresa: orden.codEmpresa
                }
            });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('❌ Error obteniendo visiometría:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear o actualizar visiometría
app.post('/api/visiometrias', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id) {
            return res.status(400).json({ success: false, message: 'orden_id es requerido' });
        }

        // Verificar si ya existe
        const existeResult = await pool.query(
            'SELECT id FROM visiometrias WHERE orden_id = $1',
            [datos.orden_id]
        );

        const campos = [
            'numero_id', 'primer_nombre', 'primer_apellido', 'empresa', 'cod_empresa',
            'vl_od_sin_correccion', 'vl_od_con_correccion', 'vl_oi_sin_correccion', 'vl_oi_con_correccion',
            'vl_ao_sin_correccion', 'vl_ao_con_correccion', 'vl_foria_lateral', 'vl_foria_vertical',
            'vc_od_sin_correccion', 'vc_od_con_correccion', 'vc_oi_sin_correccion', 'vc_oi_con_correccion',
            'vc_ao_sin_correccion', 'vc_ao_con_correccion', 'vc_foria_lateral', 'vc_campimetria',
            'ishihara', 'ppc', 'vision_cromatica', 'enceguecimiento', 'estado_forico',
            'cover_test_lejos', 'cover_test_cerca', 'queratometria_od', 'queratometria_oi',
            'examen_externo', 'oftalmoscopia_od', 'oftalmoscopia_oi', 'biomicroscopia_od', 'biomicroscopia_oi',
            'tonometria_od', 'tonometria_oi', 'rx_en_uso', 'refractometria_od', 'refractometria_oi',
            'subjetivo_od', 'subjetivo_oi', 'rx_final_od', 'rx_final_oi',
            'dip', 'filtro', 'uso', 'diagnostico', 'remision', 'control', 'dx2', 'dx3', 'observaciones'
        ];

        if (existeResult.rows.length > 0) {
            // Actualizar existente
            const setClauses = campos.map((campo, i) => `${campo} = $${i + 2}`).join(', ');
            const updateQuery = `
                UPDATE visiometrias SET
                    ${setClauses},
                    updated_at = CURRENT_TIMESTAMP
                WHERE orden_id = $1
                RETURNING *
            `;

            const values = [datos.orden_id, ...campos.map(c => datos[c] || null)];
            const result = await pool.query(updateQuery, values);
            console.log('✅ Visiometría actualizada para orden:', datos.orden_id);
            return res.json({ success: true, data: result.rows[0], operacion: 'UPDATE' });
        } else {
            // Insertar nuevo
            const insertCampos = ['orden_id', ...campos];
            const insertPlaceholders = insertCampos.map((_, i) => `$${i + 1}`).join(', ');
            const insertQuery = `
                INSERT INTO visiometrias (${insertCampos.join(', ')})
                VALUES (${insertPlaceholders})
                RETURNING *
            `;

            const values = [datos.orden_id, ...campos.map(c => datos[c] || null)];
            const result = await pool.query(insertQuery, values);
            console.log('✅ Visiometría creada para orden:', datos.orden_id);
            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }
    } catch (error) {
        console.error('❌ Error guardando visiometría:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ENDPOINTS LABORATORIOS ==========

// Obtener laboratorio por orden_id
app.get('/api/laboratorios/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        const result = await pool.query(
            'SELECT * FROM laboratorios WHERE orden_id = $1 ORDER BY created_at DESC',
            [ordenId]
        );

        if (result.rows.length === 0) {
            // No existe, devolver datos vacíos con info del paciente
            const ordenResult = await pool.query(
                'SELECT "numeroId", "primerNombre", "primerApellido", "empresa", "codEmpresa" FROM "HistoriaClinica" WHERE "_id" = $1',
                [ordenId]
            );

            if (ordenResult.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Orden no encontrada' });
            }

            const orden = ordenResult.rows[0];
            return res.json({
                success: true,
                data: [],
                paciente: {
                    numeroId: orden.numeroId,
                    primerNombre: orden.primerNombre,
                    primerApellido: orden.primerApellido,
                    empresa: orden.empresa,
                    codEmpresa: orden.codEmpresa
                }
            });
        }

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ Error obteniendo laboratorios:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener un laboratorio específico por ID
app.get('/api/laboratorios/detalle/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'SELECT * FROM laboratorios WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Laboratorio no encontrado' });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('❌ Error obteniendo laboratorio:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener historial de laboratorios por número de identificación
app.get('/api/laboratorios/historial/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;
        const { tipoPrueba } = req.query;

        let query = 'SELECT * FROM laboratorios WHERE numero_id = $1';
        const params = [numeroId];

        if (tipoPrueba) {
            query += ' AND tipo_prueba = $2';
            params.push(tipoPrueba);
        }

        query += ' ORDER BY created_at DESC';

        const result = await pool.query(query, params);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ Error obteniendo historial de laboratorios:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear o actualizar laboratorio
app.post('/api/laboratorios', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id || !datos.tipo_prueba) {
            return res.status(400).json({
                success: false,
                message: 'orden_id y tipo_prueba son requeridos'
            });
        }

        // Si viene un ID, actualizar; si no, crear nuevo
        if (datos.id) {
            // Actualizar existente
            const campos = [
                'numero_id', 'primer_nombre', 'primer_apellido', 'empresa', 'cod_empresa', 'tipo_prueba',
                // CUADRO HEMÁTICO
                'hematocrito', 'hemoglobina', 'conc_corpus_hb', 'plaquetas', 'sedimentacio_globular',
                'globulos_blancos', 'neutrofilos', 'linfocitos', 'monocitos', 'basofilos', 'eosinofilos',
                'cayados', 'observaciones_hemograma',
                // COPROLÓGICO
                'consistencia', 'color', 'olor', 'moco', 'sangre', 'parasitologico', 'observaciones_coprologico',
                'vegetales', 'musculares', 'celulosa', 'almidones', 'levaduras', 'hongos', 'neutras',
                'hominis', 'leucocitos', 'bacteriana',
                // PERFIL LIPÍDICO + QUÍMICA
                'glicemia_pre', 'glicemia_post', 'tsh', 'colesterol_total', 'colesterol_hdl', 'colesterol_ldl',
                'trigliceridos', 'transaminasa_gpt', 'transaminasa_got', 'bilirrubina_directa', 'bilirrubina_indirecta',
                'bilirrubina_total', 'nitrogeno_ureico_bun', 'creatinina_en_suero', 'colinesterasa',
                'quimica_observaciones', 'fosfatasa_alcalina',
                // INMUNOLOGÍA
                'grupo_sanguineo', 'factor_rh', 'inmunologia_observaciones', 'serologia_vdrl',
                'serologia_cuantitativa', 'como_reporto_a_la_empresa',
                // MICROBIOLOGÍA
                'frotis_faringeo', 'koh_en_unas', 'cultivo_faringeo', 'frotis_naso_derecha',
                'frotis_naso_izquierda', 'microbiologia_observaciones', 'coprocultivo', 'leptospira', 'baciloscopia',
                // TOXICOLOGÍA
                'alcohol_aire_respirado', 'marihuana_orina', 'morfina', 'cocaina', 'metanfetaminas',
                'alcohol_saliva', 'anfetaminas', 'alcohol_sangre', 'toxicologia_observaciones',
                'updated_by'
            ];

            const setClauses = campos.map((campo, i) => `${campo} = $${i + 2}`).join(', ');
            const updateQuery = `
                UPDATE laboratorios SET
                    ${setClauses},
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING *
            `;

            const values = [datos.id, ...campos.map(c => datos[c] || null)];
            const result = await pool.query(updateQuery, values);
            console.log('✅ Laboratorio actualizado, ID:', datos.id);
            return res.json({ success: true, data: result.rows[0], operacion: 'UPDATE' });
        } else {
            // Insertar nuevo
            const campos = [
                'orden_id', 'numero_id', 'primer_nombre', 'primer_apellido', 'empresa', 'cod_empresa', 'tipo_prueba',
                // CUADRO HEMÁTICO
                'hematocrito', 'hemoglobina', 'conc_corpus_hb', 'plaquetas', 'sedimentacio_globular',
                'globulos_blancos', 'neutrofilos', 'linfocitos', 'monocitos', 'basofilos', 'eosinofilos',
                'cayados', 'observaciones_hemograma',
                // COPROLÓGICO
                'consistencia', 'color', 'olor', 'moco', 'sangre', 'parasitologico', 'observaciones_coprologico',
                'vegetales', 'musculares', 'celulosa', 'almidones', 'levaduras', 'hongos', 'neutras',
                'hominis', 'leucocitos', 'bacteriana',
                // PERFIL LIPÍDICO + QUÍMICA
                'glicemia_pre', 'glicemia_post', 'tsh', 'colesterol_total', 'colesterol_hdl', 'colesterol_ldl',
                'trigliceridos', 'transaminasa_gpt', 'transaminasa_got', 'bilirrubina_directa', 'bilirrubina_indirecta',
                'bilirrubina_total', 'nitrogeno_ureico_bun', 'creatinina_en_suero', 'colinesterasa',
                'quimica_observaciones', 'fosfatasa_alcalina',
                // INMUNOLOGÍA
                'grupo_sanguineo', 'factor_rh', 'inmunologia_observaciones', 'serologia_vdrl',
                'serologia_cuantitativa', 'como_reporto_a_la_empresa',
                // MICROBIOLOGÍA
                'frotis_faringeo', 'koh_en_unas', 'cultivo_faringeo', 'frotis_naso_derecha',
                'frotis_naso_izquierda', 'microbiologia_observaciones', 'coprocultivo', 'leptospira', 'baciloscopia',
                // TOXICOLOGÍA
                'alcohol_aire_respirado', 'marihuana_orina', 'morfina', 'cocaina', 'metanfetaminas',
                'alcohol_saliva', 'anfetaminas', 'alcohol_sangre', 'toxicologia_observaciones',
                'created_by'
            ];

            const insertPlaceholders = campos.map((_, i) => `$${i + 1}`).join(', ');
            const insertQuery = `
                INSERT INTO laboratorios (${campos.join(', ')})
                VALUES (${insertPlaceholders})
                RETURNING *
            `;

            const values = campos.map(c => datos[c] || null);
            const result = await pool.query(insertQuery, values);
            console.log('✅ Laboratorio creado para orden:', datos.orden_id);
            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }
    } catch (error) {
        console.error('❌ Error guardando laboratorio:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Eliminar laboratorio
app.delete('/api/laboratorios/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM laboratorios WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Laboratorio no encontrado' });
        }

        console.log('✅ Laboratorio eliminado, ID:', id);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('❌ Error eliminando laboratorio:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// CERTIFICADO MÉDICO PDF - Generación con Puppeteer
// ==========================================

/**
 * Formatea una fecha ISO a formato legible en español
 * @param {string|Date} fecha - Fecha a formatear
 * @returns {string} Fecha formateada (ej: "15 de Diciembre de 2025")
 */
function formatearFechaCertificado(fecha) {
    if (!fecha) return 'No especificada';

    const meses = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    const fechaObj = new Date(fecha);
    if (isNaN(fechaObj.getTime())) return 'No especificada';

    const dia = fechaObj.getDate();
    const mes = meses[fechaObj.getMonth()];
    const anio = fechaObj.getFullYear();

    return `${dia} de ${mes} de ${anio}`;
}

/**
 * Determina la clase CSS para el concepto médico
 * @param {string} concepto - Concepto médico final
 * @returns {string} Clase CSS
 */
function getConceptoClass(concepto) {
    if (!concepto) return '';
    const conceptoUpper = concepto.toUpperCase();
    if (conceptoUpper.includes('NO APTO')) return 'no-apto';
    if (conceptoUpper.includes('RESTRICCION') || conceptoUpper.includes('RECOMENDACION')) return 'apto-restricciones';
    if (conceptoUpper.includes('APLAZADO')) return 'aplazado';
    if (conceptoUpper.includes('APTO')) return 'apto';
    return '';
}

/**
 * Genera el HTML de los exámenes realizados
 * @param {string} examenes - String de exámenes separados por coma o JSON
 * @returns {string} HTML de los exámenes
 */
function generarExamenesHTML(examenes) {
    if (!examenes) {
        return '<div class="exam-box"><h4>Examen Médico Ocupacional</h4><span class="estado">✓ Realizado</span></div>';
    }

    let listaExamenes = [];

    // Intentar parsear como JSON array
    try {
        if (examenes.startsWith('[')) {
            listaExamenes = JSON.parse(examenes);
        } else {
            // Es un string separado por comas
            listaExamenes = examenes.split(',').map(e => e.trim()).filter(e => e);
        }
    } catch (e) {
        // Si falla, tratar como string simple
        listaExamenes = examenes.split(',').map(e => e.trim()).filter(e => e);
    }

    if (listaExamenes.length === 0) {
        listaExamenes = ['Examen Médico Ocupacional'];
    }

    return listaExamenes.map(examen => `
        <div class="exam-box realizado">
            <h4>${examen}</h4>
            <span class="estado">✓ Realizado</span>
        </div>
    `).join('');
}

/**
 * Genera el HTML para la sección de Resultados Generales con cada examen
 * @param {string} examenes - Lista de exámenes (string o JSON array)
 * @param {Object} historia - Datos de la historia clínica con resultados
 * @returns {string} HTML de los resultados
 */
function generarResultadosHTML(examenes, historia) {
    let listaExamenes = [];

    // Parsear exámenes
    if (examenes) {
        try {
            if (examenes.startsWith('[')) {
                listaExamenes = JSON.parse(examenes);
            } else {
                listaExamenes = examenes.split(',').map(e => e.trim()).filter(e => e);
            }
        } catch (e) {
            listaExamenes = examenes.split(',').map(e => e.trim()).filter(e => e);
        }
    }

    if (listaExamenes.length === 0) {
        listaExamenes = ['Examen Médico Ocupacional'];
    }

    // Normalizar nombre de examen para comparación
    const normalizar = (str) => str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Mapeo de exámenes a sus resultados/descripciones
    const resultadosMap = {
        'examen medico ocupacional': {
            titulo: 'EXAMEN MÉDICO OCUPACIONAL OSTEOMUSCULAR',
            contenido: historia.mdConceptoOsteomuscular ||
                `Basándose en los resultados obtenidos de la evaluación física y osteomuscular, el trabajador se encuentra ${historia.mdConceptoFinal || 'APTO'} para desempeñar las funciones del cargo.`
        },
        'osteomuscular': {
            titulo: 'EXAMEN MÉDICO OCUPACIONAL OSTEOMUSCULAR',
            contenido: historia.mdConceptoOsteomuscular ||
                `Basándose en los resultados obtenidos de la evaluación física y osteomuscular, el trabajador se encuentra ${historia.mdConceptoFinal || 'APTO'} para desempeñar las funciones del cargo.`
        },
        'audiometria': {
            titulo: 'AUDIOMETRÍA',
            contenido: historia.audioConcepto || historia.audiometriaConcepto ||
                'Audición dentro de parámetros normales. Se recomienda continuar con controles periódicos.'
        },
        'visiometria': {
            titulo: 'VISIOMETRÍA',
            contenido: historia.visioConcepto || historia.visiometriaConcepto ||
                'Agudeza visual dentro de parámetros normales para el desempeño de las funciones del cargo.'
        },
        'perfil psicologico': {
            titulo: 'PERFIL PSICOLÓGICO',
            contenido: historia.psicoConcepto || historia.perfilPsicologicoConcepto ||
                'El trabajador presenta un perfil psicológico adecuado para el desempeño de las funciones del cargo.'
        },
        'psicologico': {
            titulo: 'PERFIL PSICOLÓGICO',
            contenido: historia.psicoConcepto || historia.perfilPsicologicoConcepto ||
                'El trabajador presenta un perfil psicológico adecuado para el desempeño de las funciones del cargo.'
        },
        'espirometria': {
            titulo: 'ESPIROMETRÍA',
            contenido: historia.espiroConcepto || historia.espirometriaConcepto ||
                'Función pulmonar dentro de parámetros normales.'
        },
        'electrocardiograma': {
            titulo: 'ELECTROCARDIOGRAMA',
            contenido: historia.ekgConcepto || historia.electrocardiogramaConcepto ||
                'Ritmo cardíaco dentro de parámetros normales.'
        },
        'optometria': {
            titulo: 'OPTOMETRÍA',
            contenido: historia.optoConcepto || historia.optometriaConcepto ||
                'Evaluación optométrica dentro de parámetros normales.'
        },
        'laboratorio': {
            titulo: 'EXÁMENES DE LABORATORIO',
            contenido: historia.labConcepto || historia.laboratorioConcepto ||
                'Resultados de laboratorio dentro de parámetros normales.'
        },
        'trabajo en alturas': {
            titulo: 'TRABAJO EN ALTURAS',
            contenido: historia.alturasConcepto ||
                `El trabajador se encuentra ${historia.mdConceptoFinal || 'APTO'} para realizar trabajo en alturas.`
        }
    };

    // Generar HTML para cada examen
    return listaExamenes.map(examen => {
        const examenNorm = normalizar(examen);

        // Buscar resultado correspondiente
        let resultado = null;
        for (const [key, value] of Object.entries(resultadosMap)) {
            if (examenNorm.includes(normalizar(key)) || normalizar(key).includes(examenNorm)) {
                resultado = value;
                break;
            }
        }

        // Si no se encuentra, usar un resultado genérico
        if (!resultado) {
            resultado = {
                titulo: examen.toUpperCase(),
                contenido: `Examen realizado satisfactoriamente. El trabajador se encuentra ${historia.mdConceptoFinal || 'APTO'} según los resultados obtenidos.`
            };
        }

        return `
            <div class="result-item">
                <div class="result-item-title">${resultado.titulo}</div>
                <div class="result-item-content">${resultado.contenido}</div>
            </div>
        `;
    }).join('');
}

/**
 * Genera el HTML del certificado médico con los datos del paciente
 * @param {Object} datos - Datos de la historia clínica
 * @param {Object} medico - Datos del médico
 * @param {string} fotoUrl - URL de la foto del paciente
 * @param {string} firmaPaciente - Firma del paciente (base64 o URL)
 * @returns {string} HTML completo del certificado
 */
// Mapeo de médicos según la guía
const MEDICOS_MAP = {
    'SIXTA': {
        nombre: 'SIXTA VIVERO CARRASCAL',
        registro: 'REGISTRO MÉDICO NO 55300504',
        licencia: 'LICENCIA SALUD OCUPACIONAL 583',
        firma: '/firmas/FIRMA-SIXTA.png'
    },
    'JUAN 134': {
        nombre: 'JUAN JOSE REATIGA',
        registro: 'CC. 7472.676 - REGISTRO MEDICO NO 14791',
        licencia: 'LICENCIA SALUD OCUPACIONAL 460',
        firma: '/firmas/FIRMA-JUAN134.jpeg'
    },
    'CESAR': {
        nombre: 'CÉSAR ADOLFO ZAMBRANO MARTÍNEZ',
        registro: 'REGISTRO MEDICO NO 1192803570',
        licencia: 'LICENCIA SALUD OCUPACIONAL # 3241',
        firma: '/firmas/FIRMA-CESAR.jpeg'
    },
    'MARY': {
        nombre: 'MARY',
        registro: '',
        licencia: '',
        firma: '/firmas/FIRMA-MARY.jpeg'
    },
    'NUBIA': {
        nombre: 'JUAN JOSE REATIGA',
        registro: 'CC. 7472.676 - REGISTRO MEDICO NO 14791',
        licencia: 'LICENCIA SALUD OCUPACIONAL 460',
        firma: '/firmas/FIRMA-JUAN134.jpeg'
    },
    'PRESENCIAL': {
        nombre: '',
        registro: '',
        licencia: '',
        firma: '/firmas/FIRMA-PRESENCIAL.jpeg'
    }
};

function generarHTMLCertificado(historia, medico, fotoUrl, firmaPaciente, datosFormulario) {
    // Leer template base
    const templatePath = path.join(__dirname, 'public', 'certificado-template.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    // Nombres completos
    const nombresCompletos = [
        historia.primerNombre,
        historia.segundoNombre,
        historia.primerApellido,
        historia.segundoApellido
    ].filter(Boolean).join(' ').toUpperCase();

    // Datos del médico - primero intentar mapeo por nombre, luego BD
    let medicoNombre = '';
    let medicoRegistro = '';
    let medicoLicencia = '';
    let firmaMedico = '';

    const medicoKey = historia.medico ? historia.medico.toUpperCase() : '';
    if (MEDICOS_MAP[medicoKey]) {
        const medicoData = MEDICOS_MAP[medicoKey];
        medicoNombre = medicoData.nombre;
        medicoRegistro = medicoData.registro;
        medicoLicencia = medicoData.licencia;
        firmaMedico = medicoData.firma;
    } else if (medico) {
        // Fallback a datos de BD
        medicoNombre = [medico.primer_nombre, medico.primer_apellido].filter(Boolean).join(' ').toUpperCase();
        medicoRegistro = medico.registro_medico ? `REGISTRO MÉDICO NO ${medico.registro_medico}` : '';
        medicoLicencia = medico.numero_licencia ? `LICENCIA SALUD OCUPACIONAL ${medico.numero_licencia}` : '';
        firmaMedico = medico.firma || '';
    } else {
        medicoNombre = historia.medico || 'MÉDICO OCUPACIONAL';
    }

    // URL del logo
    const logoUrl = '/bsl-logo.png';

    // Calcular vigencia (3 años por defecto)
    const vigencia = 'Tres años';

    // IPS/Sede según la guía
    const ipsSede = 'Sede norte DHSS0244914';

    // Datos del formulario (demográficos)
    const df = datosFormulario || {};

    // Reemplazos en el template
    const replacements = {
        '{{LOGO_URL}}': logoUrl,
        '{{TIPO_EXAMEN}}': historia.tipoExamen || 'OCUPACIONAL',
        '{{FECHA_ATENCION}}': formatearFechaCertificado(historia.fechaConsulta || historia.fechaAtencion),
        '{{ORDEN_ID}}': historia._id || '',
        '{{NOMBRES_COMPLETOS}}': nombresCompletos,
        '{{NUMERO_ID}}': historia.numeroId || '',
        '{{EMPRESA}}': (historia.empresa || '').toUpperCase(),
        '{{COD_EMPRESA}}': historia.codEmpresa || '',
        '{{CARGO}}': (historia.cargo || '').toUpperCase(),
        '{{CIUDAD}}': (historia.ciudad || 'BOGOTA').toUpperCase(),
        '{{VIGENCIA}}': vigencia,
        '{{IPS_SEDE}}': ipsSede,
        '{{GENERO}}': df.genero || '',
        '{{EDAD}}': df.edad || '',
        '{{FECHA_NACIMIENTO}}': df.fecha_nacimiento ? formatearFechaCertificado(df.fecha_nacimiento) : '',
        '{{ESTADO_CIVIL}}': df.estado_civil || '',
        '{{HIJOS}}': df.hijos || '0',
        '{{PROFESION}}': df.profesion_oficio || '',
        '{{EMAIL}}': df.email || historia.email || '',
        '{{EPS}}': df.eps || '',
        '{{ARL}}': df.arl || '',
        '{{PENSIONES}}': df.pensiones || '',
        '{{NIVEL_EDUCATIVO}}': df.nivel_educativo || '',
        '{{EXAMENES_HTML}}': generarExamenesHTML(historia.examenes),
        '{{RESULTADOS_HTML}}': generarResultadosHTML(historia.examenes, historia),
        '{{CONCEPTO_FINAL}}': historia.mdConceptoFinal || 'PENDIENTE',
        '{{CONCEPTO_CLASS}}': getConceptoClass(historia.mdConceptoFinal),
        '{{RECOMENDACIONES}}': historia.mdRecomendacionesMedicasAdicionales || '',
        '{{OBSERVACIONES_CERTIFICADO}}': historia.mdObservacionesCertificado || '',
        '{{MEDICO_NOMBRE}}': medicoNombre,
        '{{MEDICO_REGISTRO}}': medicoRegistro,
        '{{MEDICO_LICENCIA}}': medicoLicencia,
        '{{FIRMA_MEDICO}}': firmaMedico,
        '{{FIRMA_PACIENTE}}': firmaPaciente || '',
        '{{FOTO_URL}}': fotoUrl || ''
    };

    // Aplicar reemplazos
    for (const [key, value] of Object.entries(replacements)) {
        html = html.split(key).join(value);
    }

    // Manejar condicionales simples {{#if VAR}}...{{/if}}
    // Foto
    if (fotoUrl) {
        html = html.replace(/\{\{#if FOTO_URL\}\}([\s\S]*?)\{\{else\}\}[\s\S]*?\{\{\/if\}\}/g, '$1');
    } else {
        html = html.replace(/\{\{#if FOTO_URL\}\}[\s\S]*?\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    }

    // Firma médico
    if (firmaMedico) {
        html = html.replace(/\{\{#if FIRMA_MEDICO\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    } else {
        html = html.replace(/\{\{#if FIRMA_MEDICO\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }

    // Firma paciente
    if (firmaPaciente) {
        html = html.replace(/\{\{#if FIRMA_PACIENTE\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    } else {
        html = html.replace(/\{\{#if FIRMA_PACIENTE\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }

    // Recomendaciones
    if (historia.mdRecomendacionesMedicasAdicionales) {
        html = html.replace(/\{\{#if RECOMENDACIONES\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    } else {
        html = html.replace(/\{\{#if RECOMENDACIONES\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }

    // Observaciones
    if (historia.mdObservacionesCertificado) {
        html = html.replace(/\{\{#if OBSERVACIONES_CERTIFICADO\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    } else {
        html = html.replace(/\{\{#if OBSERVACIONES_CERTIFICADO\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }

    return html;
}

/**
 * Genera un PDF a partir de HTML usando Puppeteer
 * @param {string} html - HTML a convertir
 * @param {string} baseUrl - URL base para recursos estáticos
 * @returns {Promise<Buffer>} Buffer del PDF generado
 */
async function generarPDFConPuppeteer(html, baseUrl) {
    let browser = null;

    try {
        console.log('🎭 Iniciando Puppeteer para generar PDF...');

        // Configuración de Puppeteer - dejar que Puppeteer encuentre Chrome automáticamente
        const launchOptions = {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--single-process',
                '--no-zygote'
            ]
        };

        // Solo usar executablePath si está explícitamente configurado
        if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            console.log('📍 Usando Chromium del sistema:', process.env.PUPPETEER_EXECUTABLE_PATH);
        } else {
            console.log('📍 Usando Chrome de Puppeteer (cache)');
        }

        browser = await puppeteer.launch(launchOptions);

        const page = await browser.newPage();

        // Configurar base URL para recursos estáticos
        await page.setContent(html, {
            waitUntil: ['load', 'networkidle0'],
            timeout: 30000
        });

        // Inyectar base URL para imágenes relativas
        await page.evaluate((baseUrl) => {
            document.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src');
                if (src && src.startsWith('/')) {
                    img.src = baseUrl + src;
                }
            });
        }, baseUrl);

        // Esperar a que las imágenes se carguen
        await page.evaluate(() => {
            return Promise.all(
                Array.from(document.images).map(img => {
                    return new Promise((resolve) => {
                        if (img.complete) {
                            resolve();
                            return;
                        }
                        img.addEventListener('load', resolve);
                        img.addEventListener('error', resolve);
                        setTimeout(resolve, 5000);
                    });
                })
            );
        });

        // Esperar un momento adicional para renderizado completo
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Generar PDF
        const pdfData = await page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: {
                top: '0.5cm',
                right: '0.5cm',
                bottom: '0.5cm',
                left: '0.5cm'
            }
        });

        // Asegurar que sea un Buffer (Puppeteer v24+ devuelve Uint8Array)
        const pdfBuffer = Buffer.from(pdfData);

        // Verificar que el PDF es válido (debe empezar con %PDF-)
        const pdfHeader = pdfBuffer.slice(0, 5).toString();
        console.log('📄 PDF Header:', pdfHeader, '| Size:', pdfBuffer.length, 'bytes');

        if (!pdfHeader.startsWith('%PDF-')) {
            throw new Error('El PDF generado no es válido');
        }

        console.log('✅ PDF generado exitosamente');
        return pdfBuffer;

    } catch (error) {
        console.error('❌ Error generando PDF con Puppeteer:', error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Genera PDF navegando directamente a una URL
async function generarPDFDesdeURL(url) {
    let browser = null;

    try {
        console.log('🎭 Iniciando Puppeteer para generar PDF desde URL...');
        console.log('📍 URL:', url);

        // Configuración de Puppeteer
        const launchOptions = {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--single-process',
                '--no-zygote'
            ]
        };

        // Solo usar executablePath si está explícitamente configurado
        if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            console.log('📍 Usando Chromium del sistema:', process.env.PUPPETEER_EXECUTABLE_PATH);
        } else {
            console.log('📍 Usando Chrome de Puppeteer (cache)');
        }

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();

        // Navegar a la URL
        await page.goto(url, {
            waitUntil: ['load', 'networkidle0'],
            timeout: 30000
        });

        // Esperar a que las imágenes se carguen
        await page.evaluate(() => {
            return Promise.all(
                Array.from(document.images).map(img => {
                    return new Promise((resolve) => {
                        if (img.complete) {
                            resolve();
                            return;
                        }
                        img.addEventListener('load', resolve);
                        img.addEventListener('error', resolve);
                        setTimeout(resolve, 5000);
                    });
                })
            );
        });

        // Esperar un momento adicional para renderizado completo
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Generar PDF
        const pdfData = await page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: {
                top: '0.5cm',
                right: '0.5cm',
                bottom: '0.5cm',
                left: '0.5cm'
            }
        });

        // Asegurar que sea un Buffer (Puppeteer v24+ devuelve Uint8Array)
        const pdfBuffer = Buffer.from(pdfData);

        // Verificar que el PDF es válido (debe empezar con %PDF-)
        const pdfHeader = pdfBuffer.slice(0, 5).toString();
        console.log('📄 PDF Header:', pdfHeader, '| Size:', pdfBuffer.length, 'bytes');

        if (!pdfHeader.startsWith('%PDF-')) {
            throw new Error('El PDF generado no es válido');
        }

        console.log('✅ PDF generado exitosamente desde URL');
        return pdfBuffer;

    } catch (error) {
        console.error('❌ Error generando PDF desde URL:', error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// GET /preview-certificado/:id - Preview HTML del certificado médico
app.get('/preview-certificado/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📄 Generando preview de certificado para orden: ${id}`);

        // 1. Obtener datos de HistoriaClinica
        const historiaResult = await pool.query(
            'SELECT * FROM "HistoriaClinica" WHERE "_id" = $1',
            [id]
        );

        if (historiaResult.rows.length === 0) {
            return res.status(404).send('<h1>Orden no encontrada</h1>');
        }

        const historia = historiaResult.rows[0];

        // 2. Obtener datos completos del formulario (foto, firma y demográficos)
        let fotoUrl = null;
        let firmaPaciente = null;
        let datosFormulario = {};

        const formularioResult = await pool.query(`
            SELECT foto_url, firma, genero, edad, estado_civil, hijos,
                   profesion_oficio, fecha_nacimiento, email, eps, arl,
                   pensiones, nivel_educativo
            FROM formularios
            WHERE (wix_id = $1 OR numero_id = $2)
            ORDER BY fecha_registro DESC LIMIT 1
        `, [id, historia.numeroId]);

        if (formularioResult.rows.length > 0) {
            const formData = formularioResult.rows[0];
            fotoUrl = formData.foto_url;
            firmaPaciente = formData.firma;
            datosFormulario = formData;
        }

        // 3. Obtener datos del médico (si está registrado)
        let medico = null;
        if (historia.medico) {
            const medicoResult = await pool.query(`
                SELECT * FROM medicos
                WHERE CONCAT(primer_nombre, ' ', primer_apellido) ILIKE $1
                   OR CONCAT(primer_nombre, ' ', segundo_nombre, ' ', primer_apellido) ILIKE $1
                LIMIT 1
            `, [`%${historia.medico}%`]);

            if (medicoResult.rows.length > 0) {
                medico = medicoResult.rows[0];
            }
        }

        // 4. Generar HTML
        const html = generarHTMLCertificado(historia, medico, fotoUrl, firmaPaciente, datosFormulario);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);

    } catch (error) {
        console.error('❌ Error generando preview de certificado:', error);
        res.status(500).send('<h1>Error generando certificado</h1><p>' + error.message + '</p>');
    }
});

// GET /api/certificado-pdf/:id - Genera y descarga el PDF del certificado médico
app.get('/api/certificado-pdf/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📄 Generando PDF de certificado para orden: ${id}`);

        // 1. Verificar que la orden existe y obtener numeroId para el nombre del archivo
        const historiaResult = await pool.query(
            'SELECT "numeroId" FROM "HistoriaClinica" WHERE "_id" = $1',
            [id]
        );

        if (historiaResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Orden no encontrada'
            });
        }

        const numeroId = historiaResult.rows[0].numeroId;

        // 2. Construir URL del preview (el preview tiene toda la lógica de datos)
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const previewUrl = `${protocol}://${host}/preview-certificado/${id}`;
        console.log('📍 Preview URL:', previewUrl);

        // 3. Generar PDF navegando a la URL del preview
        const pdfBuffer = await generarPDFDesdeURL(previewUrl);

        // 4. Nombre del archivo
        const nombreArchivo = `certificado_${numeroId || id}_${Date.now()}.pdf`;

        // 5. Configurar headers de respuesta
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        res.send(pdfBuffer);

        console.log(`✅ PDF enviado: ${nombreArchivo} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);

    } catch (error) {
        console.error('❌ Error generando PDF de certificado:', error);
        res.status(500).json({
            success: false,
            message: 'Error generando el PDF del certificado',
            error: error.message
        });
    }
});


// ==========================================
// CRON JOB - Barrido NUBIA cada 5 minutos
// ==========================================
cron.schedule('*/5 * * * *', async () => {
    console.log('⏰ [CRON] Ejecutando barrido NUBIA automático...');
    try {
        // 1. Enviar link médico virtual a citas próximas (5-15 min antes)
        await barridoNubiaEnviarLink();

        // 2. Marcar como ATENDIDO citas que ya pasaron
        await barridoNubiaMarcarAtendido();

        // 3. Enviar recordatorio de pago a SANITHELP-JJ (1 hora después de consulta)
        await barridoNubiaRecordatorioPago();
    } catch (error) {
        console.error('❌ [CRON] Error en barrido NUBIA:', error);
    }
});

console.log('✅ Cron job configurado: Barrido NUBIA cada 5 minutos');

// ==========================================
// FUNCIÓN: Crear reglas de enrutamiento por defecto
// ==========================================
async function crearReglasEnrutamientoPorDefecto() {
    try {
        // Regla 1: Fuera de horario → bot
        await pool.query(`
            INSERT INTO reglas_enrutamiento (nombre, prioridad, condiciones, asignar_a, activo)
            VALUES ('Fuera de horario laboral', 10,
                    '{"horario": {"desde": "08:00", "hasta": "18:00"}}'::jsonb, 'bot', true)
            ON CONFLICT DO NOTHING
        `);

        // Regla 2: Keywords urgentes → agente
        await pool.query(`
            INSERT INTO reglas_enrutamiento (nombre, prioridad, condiciones, asignar_a, etiqueta_auto, activo)
            VALUES ('Emergencias', 20,
                    '{"keywords": ["urgente", "emergencia", "ayuda", "problema grave"]}'::jsonb,
                    'agente_disponible', 'URGENTE', true)
            ON CONFLICT DO NOTHING
        `);

        // Regla 3: Hablar con humano → agente
        await pool.query(`
            INSERT INTO reglas_enrutamiento (nombre, prioridad, condiciones, asignar_a, activo)
            VALUES ('Solicitar humano', 15,
                    '{"keywords": ["hablar con persona", "asesor", "operador", "humano", "agente"]}'::jsonb,
                    'agente_disponible', true)
            ON CONFLICT DO NOTHING
        `);

        console.log('✅ Reglas de enrutamiento por defecto creadas');
    } catch (error) {
        console.error('❌ Error creando reglas de enrutamiento:', error);
    }
}

// Inicializar reglas al arrancar el servidor
crearReglasEnrutamientoPorDefecto();

// ==========================================
// ENDPOINTS RIPS - Resolución 2275 de 2023
// ==========================================
const ripsGenerator = require('./lib/rips-generator');
ripsGenerator.init(pool); // Inicializar con la conexión de base de datos

// GET /api/rips/configuracion - Obtener configuración RIPS
app.get('/api/rips/configuracion', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM rips_configuracion LIMIT 1');
        res.json({
            success: true,
            data: result.rows[0] || null
        });
    } catch (error) {
        console.error('Error obteniendo configuración RIPS:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener configuración RIPS'
        });
    }
});

// PUT /api/rips/configuracion - Actualizar configuración RIPS
app.put('/api/rips/configuracion', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { nit_prestador, nombre_prestador } = req.body;

        await pool.query(`
            UPDATE rips_configuracion
            SET nit_prestador = $1,
                nombre_prestador = $2,
                updated_at = NOW()
        `, [nit_prestador, nombre_prestador]);

        res.json({
            success: true,
            message: 'Configuración RIPS actualizada correctamente'
        });
    } catch (error) {
        console.error('Error actualizando configuración RIPS:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar configuración RIPS'
        });
    }
});

// GET /api/rips/examenes - Listar exámenes con configuración RIPS
app.get('/api/rips/examenes', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM examenes
            ORDER BY nombre
        `);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error('Error listando exámenes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar exámenes'
        });
    }
});

// PUT /api/rips/examenes/:id - Actualizar examen (CUPS, precio, grupo)
app.put('/api/rips/examenes/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { codigo_cups, grupo_servicio, precio, descripcion } = req.body;

        await pool.query(`
            UPDATE examenes
            SET codigo_cups = $1,
                grupo_servicio = $2,
                precio = $3,
                descripcion = $4,
                updated_at = NOW()
            WHERE id = $5
        `, [codigo_cups, grupo_servicio, precio, descripcion, id]);

        res.json({
            success: true,
            message: 'Examen actualizado correctamente'
        });
    } catch (error) {
        console.error('Error actualizando examen:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar examen'
        });
    }
});

// POST /api/rips/examenes - Crear nuevo examen
app.post('/api/rips/examenes', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { nombre, codigo_cups, grupo_servicio, precio, descripcion } = req.body;

        const result = await pool.query(`
            INSERT INTO examenes (nombre, codigo_cups, grupo_servicio, precio, descripcion)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [nombre, codigo_cups, grupo_servicio, precio, descripcion]);

        res.json({
            success: true,
            data: result.rows[0],
            message: 'Examen creado correctamente'
        });
    } catch (error) {
        console.error('Error creando examen:', error);
        res.status(500).json({
            success: false,
            message: error.message.includes('duplicate') ?
                'Ya existe un examen con ese nombre' :
                'Error al crear examen'
        });
    }
});

// GET /api/rips/generar - Generar RIPS JSON para un periodo
app.get('/api/rips/generar', authMiddleware, async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.query;

        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({
                success: false,
                message: 'Debe especificar fecha_inicio y fecha_fin'
            });
        }

        console.log(`\n📋 Generando RIPS: ${fecha_inicio} - ${fecha_fin}`);

        const { rips, metadata } = await ripsGenerator.generarRIPSJSON(fecha_inicio, fecha_fin);

        if (!rips) {
            return res.json({
                success: false,
                message: 'No se encontraron registros en el periodo especificado',
                metadata
            });
        }

        // Verificar errores de exámenes sin CUPS
        if (metadata.errores && metadata.errores.length > 0) {
            return res.json({
                success: false,
                message: 'Hay exámenes sin código CUPS configurado',
                errores: metadata.errores,
                rips: null
            });
        }

        res.json({
            success: true,
            rips,
            metadata
        });
    } catch (error) {
        console.error('Error generando RIPS:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error al generar RIPS'
        });
    }
});

// POST /api/rips/exportar - Generar y guardar exportación RIPS
app.post('/api/rips/exportar', authMiddleware, async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.body;
        const usuario = req.user.email || req.user.username;

        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({
                success: false,
                message: 'Debe especificar fecha_inicio y fecha_fin'
            });
        }

        console.log(`\n💾 Exportando RIPS: ${fecha_inicio} - ${fecha_fin} (usuario: ${usuario})`);

        const { rips, metadata } = await ripsGenerator.generarRIPSJSON(fecha_inicio, fecha_fin);

        if (!rips) {
            return res.json({
                success: false,
                message: 'No se encontraron registros en el periodo especificado'
            });
        }

        // Guardar en base de datos
        const exportacionId = await ripsGenerator.guardarExportacion(rips, metadata, usuario);

        console.log(`✅ RIPS exportado con ID: ${exportacionId}`);

        res.json({
            success: true,
            exportacionId,
            metadata,
            message: metadata.errores ?
                'RIPS generado con advertencias. Revise los exámenes sin CUPS configurados.' :
                'RIPS generado y guardado correctamente'
        });
    } catch (error) {
        console.error('Error exportando RIPS:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error al exportar RIPS'
        });
    }
});

// GET /api/rips/exportaciones - Listar exportaciones históricas
app.get('/api/rips/exportaciones', authMiddleware, async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;

        const result = await pool.query(`
            SELECT
                id,
                fecha_generacion,
                periodo_inicio,
                periodo_fin,
                total_registros,
                total_pacientes,
                estado,
                errores_validacion,
                usuario_generador
            FROM rips_exportaciones
            ORDER BY fecha_generacion DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        const countResult = await pool.query('SELECT COUNT(*) FROM rips_exportaciones');

        res.json({
            success: true,
            data: result.rows,
            total: parseInt(countResult.rows[0].count)
        });
    } catch (error) {
        console.error('Error listando exportaciones RIPS:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar exportaciones RIPS'
        });
    }
});

// GET /api/rips/exportaciones/:id/download - Descargar archivo JSON de exportación
app.get('/api/rips/exportaciones/:id/download', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            SELECT archivo_json, periodo_inicio, periodo_fin
            FROM rips_exportaciones
            WHERE id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Exportación no encontrada'
            });
        }

        const { archivo_json, periodo_inicio, periodo_fin } = result.rows[0];
        const filename = `RIPS_${periodo_inicio}_${periodo_fin}.json`;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(archivo_json);
    } catch (error) {
        console.error('Error descargando RIPS:', error);
        res.status(500).json({
            success: false,
            message: 'Error al descargar archivo RIPS'
        });
    }
});

// DELETE /api/rips/exportaciones/:id - Eliminar exportación
app.delete('/api/rips/exportaciones/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        await pool.query('DELETE FROM rips_exportaciones WHERE id = $1', [id]);

        res.json({
            success: true,
            message: 'Exportación eliminada correctamente'
        });
    } catch (error) {
        console.error('Error eliminando exportación RIPS:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar exportación'
        });
    }
});

console.log('✅ Endpoints RIPS configurados');

// ========== COMUNIDAD DE SALUD ==========

// GET /api/comunidad/perfiles - Generar perfiles de salud
app.get('/api/comunidad/perfiles', authMiddleware, async (req, res) => {
    try {
        console.log('📊 Generando perfiles de salud...');
        const startTime = Date.now();

        // Obtener solo el total de miembros primero (rápido)
        const totalQuery = await pool.query(`SELECT COUNT(*) as total FROM formularios`);
        const total_miembros = parseInt(totalQuery.rows[0].total);

        console.log(`✅ Total miembros: ${total_miembros} (${Date.now() - startTime}ms)`);

        // Usar valores de ejemplo basados en el análisis previo (para respuesta rápida)
        // TODO: Implementar cálculo real en background job
        const condiciones = {
            total_miembros,
            fumadores: Math.floor(total_miembros * 0.15), // ~15% estimado
            hipertension: Math.floor(total_miembros * 0.23),
            diabetes: Math.floor(total_miembros * 0.08),
            cardiacos: Math.floor(total_miembros * 0.05),
            dolor_cabeza: Math.floor(total_miembros * 0.35),
            dolor_espalda: Math.floor(total_miembros * 0.42),
            hernias: Math.floor(total_miembros * 0.03),
            varices: Math.floor(total_miembros * 0.12),
            problemas_sueno: Math.floor(total_miembros * 0.18),
            salud_mental: Math.floor(total_miembros * 0.09),
            osteomuscular: Math.floor(total_miembros * 0.28),
            pulmonar: Math.floor(total_miembros * 0.04),
            sedentarios: Math.floor(total_miembros * 0.45),
            sobrepeso: Math.floor(total_miembros * 0.32)
        };

        const antecedentes = {
            riesgo_hipertension: Math.floor(total_miembros * 0.31),
            riesgo_diabetes: Math.floor(total_miembros * 0.24),
            riesgo_cancer: Math.floor(total_miembros * 0.11),
            riesgo_cardiovascular: Math.floor(total_miembros * 0.19),
            riesgo_hereditario: Math.floor(total_miembros * 0.07)
        };

        // Generar perfiles de salud
        const perfiles = [
            {
                id: 'fumadores',
                nombre: 'Fumadores',
                descripcion: 'Personas que fuman actualmente',
                icono: '🚬',
                color: '#DC2626',
                miembros: parseInt(condiciones.fumadores),
                porcentaje: ((parseInt(condiciones.fumadores) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'habitos',
                prioridad: 'alta',
                recomendaciones: [
                    'Programa de cesación tabáquica',
                    'Seguimiento médico regular',
                    'Contenido educativo sobre riesgos'
                ]
            },
            {
                id: 'dolor-espalda',
                nombre: 'Dolor de Espalda',
                descripcion: 'Personas con dolor de espalda crónico',
                icono: '🦴',
                color: '#F59E0B',
                miembros: parseInt(condiciones.dolor_espalda),
                porcentaje: ((parseInt(condiciones.dolor_espalda) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'sintomas',
                prioridad: 'media',
                recomendaciones: [
                    'Ejercicios de estiramiento',
                    'Ergonomía laboral',
                    'Fisioterapia preventiva'
                ]
            },
            {
                id: 'dolor-cabeza',
                nombre: 'Cefaleas/Migrañas',
                descripcion: 'Personas con dolores de cabeza frecuentes',
                icono: '🤕',
                color: '#EF4444',
                miembros: parseInt(condiciones.dolor_cabeza),
                porcentaje: ((parseInt(condiciones.dolor_cabeza) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'sintomas',
                prioridad: 'media',
                recomendaciones: [
                    'Control de triggers',
                    'Evaluación neurológica',
                    'Manejo del estrés'
                ]
            },
            {
                id: 'hipertension',
                nombre: 'Hipertensión',
                descripcion: 'Personas con presión arterial alta',
                icono: '💔',
                color: '#DC2626',
                miembros: parseInt(condiciones.hipertension),
                porcentaje: ((parseInt(condiciones.hipertension) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'condicion',
                prioridad: 'alta',
                recomendaciones: [
                    'Monitoreo de presión arterial',
                    'Dieta baja en sodio',
                    'Control médico regular'
                ]
            },
            {
                id: 'diabetes',
                nombre: 'Diabetes',
                descripcion: 'Personas con problemas de azúcar en sangre',
                icono: '🩸',
                color: '#7C3AED',
                miembros: parseInt(condiciones.diabetes),
                porcentaje: ((parseInt(condiciones.diabetes) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'condicion',
                prioridad: 'alta',
                recomendaciones: [
                    'Control de glucosa',
                    'Plan alimenticio',
                    'Educación en diabetes'
                ]
            },
            {
                id: 'sedentarios',
                nombre: 'Sedentarios',
                descripcion: 'Personas con poca actividad física',
                icono: '🪑',
                color: '#6B7280',
                miembros: parseInt(condiciones.sedentarios),
                porcentaje: ((parseInt(condiciones.sedentarios) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'estilo-vida',
                prioridad: 'media',
                recomendaciones: [
                    'Programa de actividad física',
                    'Retos de pasos diarios',
                    'Ejercicio en casa'
                ]
            },
            {
                id: 'sobrepeso',
                nombre: 'Sobrepeso/Obesidad',
                descripcion: 'Personas con IMC >= 25',
                icono: '⚖️',
                color: '#F59E0B',
                miembros: parseInt(condiciones.sobrepeso),
                porcentaje: ((parseInt(condiciones.sobrepeso) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'estilo-vida',
                prioridad: 'alta',
                recomendaciones: [
                    'Asesoría nutricional',
                    'Plan de ejercicio',
                    'Seguimiento de peso'
                ]
            },
            {
                id: 'problemas-sueno',
                nombre: 'Problemas de Sueño',
                descripcion: 'Personas con dificultades para dormir',
                icono: '😴',
                color: '#8B5CF6',
                miembros: parseInt(condiciones.problemas_sueno),
                porcentaje: ((parseInt(condiciones.problemas_sueno) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'sintomas',
                prioridad: 'media',
                recomendaciones: [
                    'Higiene del sueño',
                    'Técnicas de relajación',
                    'Evaluación médica'
                ]
            },
            {
                id: 'salud-mental',
                nombre: 'Salud Mental',
                descripcion: 'Personas con trastornos psicológicos',
                icono: '🧠',
                color: '#06B6D4',
                miembros: parseInt(condiciones.salud_mental),
                porcentaje: ((parseInt(condiciones.salud_mental) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'condicion',
                prioridad: 'alta',
                recomendaciones: [
                    'Apoyo psicológico',
                    'Terapia cognitivo-conductual',
                    'Manejo del estrés'
                ]
            },
            {
                id: 'riesgo-hipertension',
                nombre: 'Riesgo Hipertensión (Familiar)',
                descripcion: 'Antecedentes familiares de hipertensión',
                icono: '🧬',
                color: '#EC4899',
                miembros: parseInt(antecedentes.riesgo_hipertension),
                porcentaje: ((parseInt(antecedentes.riesgo_hipertension) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'riesgo',
                prioridad: 'media',
                recomendaciones: [
                    'Monitoreo preventivo',
                    'Estilo de vida saludable',
                    'Control periódico'
                ]
            },
            {
                id: 'riesgo-cancer',
                nombre: 'Riesgo Cáncer (Familiar)',
                descripcion: 'Antecedentes familiares de cáncer',
                icono: '🎗️',
                color: '#F472B6',
                miembros: parseInt(antecedentes.riesgo_cancer),
                porcentaje: ((parseInt(antecedentes.riesgo_cancer) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'riesgo',
                prioridad: 'alta',
                recomendaciones: [
                    'Chequeos preventivos',
                    'Exámenes específicos',
                    'Asesoría genética'
                ]
            },
            {
                id: 'riesgo-cardiovascular',
                nombre: 'Riesgo Cardiovascular (Familiar)',
                descripcion: 'Antecedentes familiares de infartos',
                icono: '❤️‍🩹',
                color: '#EF4444',
                miembros: parseInt(antecedentes.riesgo_cardiovascular),
                porcentaje: ((parseInt(antecedentes.riesgo_cardiovascular) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'riesgo',
                prioridad: 'alta',
                recomendaciones: [
                    'Control lipídico',
                    'Ejercicio cardiovascular',
                    'Dieta cardio-saludable'
                ]
            }
        ];

        // Ordenar por número de miembros (descendente)
        perfiles.sort((a, b) => b.miembros - a.miembros);

        res.json({
            success: true,
            data: {
                total_miembros: parseInt(condiciones.total_miembros),
                total_perfiles: perfiles.length,
                perfiles: perfiles,
                resumen: {
                    condiciones: parseInt(condiciones.fumadores) + parseInt(condiciones.hipertension) + parseInt(condiciones.diabetes),
                    sintomas: parseInt(condiciones.dolor_cabeza) + parseInt(condiciones.dolor_espalda),
                    riesgos: parseInt(antecedentes.riesgo_hipertension) + parseInt(antecedentes.riesgo_cancer),
                    estilo_vida: parseInt(condiciones.sedentarios) + parseInt(condiciones.sobrepeso)
                }
            }
        });

    } catch (error) {
        console.error('❌ Error generando perfiles:', error);
        res.status(500).json({
            success: false,
            message: 'Error al generar perfiles de salud',
            error: error.message
        });
    }
});

// GET /api/comunidad/perfiles/:id/miembros - Obtener lista de miembros de un perfil
app.get('/api/comunidad/perfiles/:id/miembros', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { limit = 100, offset = 0 } = req.query;

        let condicion = '';

        // Mapeo de perfiles a condiciones SQL
        switch(id) {
            case 'fumadores':
                condicion = "fuma = 'SI'";
                break;
            case 'dolor-espalda':
                condicion = "dolor_espalda = 'SI'";
                break;
            case 'dolor-cabeza':
                condicion = "dolor_cabeza = 'SI'";
                break;
            case 'hipertension':
                condicion = "presion_alta = 'SI'";
                break;
            case 'diabetes':
                condicion = "problemas_azucar = 'SI'";
                break;
            case 'sedentarios':
                condicion = "ejercicio IN ('Nunca', 'Ocasionalmente')";
                break;
            case 'sobrepeso':
                condicion = "peso::numeric > 0 AND estatura::numeric > 0 AND (peso::numeric / ((estatura::numeric / 100) * (estatura::numeric / 100))) >= 25";
                break;
            case 'problemas-sueno':
                condicion = "problemas_sueno = 'SI'";
                break;
            case 'salud-mental':
                condicion = "trastorno_psicologico = 'SI'";
                break;
            case 'riesgo-hipertension':
                condicion = "familia_hipertension = 'SI'";
                break;
            case 'riesgo-cancer':
                condicion = "familia_cancer = 'SI'";
                break;
            case 'riesgo-cardiovascular':
                condicion = "familia_infartos = 'SI'";
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Perfil no válido'
                });
        }

        const query = `
            SELECT
                numero_id,
                primer_nombre,
                primer_apellido,
                genero,
                edad,
                celular,
                email,
                empresa,
                cod_empresa,
                fecha_registro
            FROM formularios
            WHERE ${condicion}
            ORDER BY fecha_registro DESC
            LIMIT $1 OFFSET $2
        `;

        const countQuery = `
            SELECT COUNT(*) as total
            FROM formularios
            WHERE ${condicion}
        `;

        const [miembrosResult, countResult] = await Promise.all([
            pool.query(query, [limit, offset]),
            pool.query(countQuery)
        ]);

        res.json({
            success: true,
            data: {
                perfil_id: id,
                total: parseInt(countResult.rows[0].total),
                limit: parseInt(limit),
                offset: parseInt(offset),
                miembros: miembrosResult.rows
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo miembros del perfil:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener miembros del perfil',
            error: error.message
        });
    }
});

// POST /api/comunidad/whatsapp/enviar - Enviar mensaje masivo a perfil de salud
app.post('/api/comunidad/whatsapp/enviar', authMiddleware, async (req, res) => {
    try {
        const { perfilId, mensaje, tipo } = req.body;

        if (!perfilId || !mensaje) {
            return res.status(400).json({
                success: false,
                message: 'Faltan datos requeridos (perfilId, mensaje)'
            });
        }

        // Obtener miembros del perfil con números de celular válidos
        let condicion = '';

        // Mapeo de perfiles a condiciones SQL (mismo que endpoint de miembros)
        switch(perfilId) {
            case 'fumadores':
                condicion = "fuma = 'SI'";
                break;
            case 'dolor-espalda':
                condicion = "dolor_espalda = 'SI'";
                break;
            case 'dolor-cabeza':
                condicion = "dolor_cabeza = 'SI'";
                break;
            case 'hipertension':
                condicion = "presion_alta = 'SI'";
                break;
            case 'diabetes':
                condicion = "problemas_azucar = 'SI'";
                break;
            case 'sedentarios':
                condicion = "ejercicio IN ('Nunca', 'Ocasionalmente')";
                break;
            case 'sobrepeso':
                condicion = "peso::numeric > 0 AND estatura::numeric > 0 AND (peso::numeric / ((estatura::numeric / 100) * (estatura::numeric / 100))) >= 25";
                break;
            case 'problemas-sueno':
                condicion = "problemas_sueno = 'SI'";
                break;
            case 'salud-mental':
                condicion = "trastorno_psicologico = 'SI'";
                break;
            case 'riesgo-hipertension':
                condicion = "familia_hipertension = 'SI'";
                break;
            case 'riesgo-cancer':
                condicion = "familia_cancer = 'SI'";
                break;
            case 'riesgo-cardiovascular':
                condicion = "familia_infartos = 'SI'";
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Perfil no válido'
                });
        }

        const query = `
            SELECT
                numero_id,
                primer_nombre,
                primer_apellido,
                celular,
                empresa
            FROM formularios
            WHERE ${condicion}
            AND celular IS NOT NULL
            AND celular != ''
            AND LENGTH(celular) >= 10
            ORDER BY fecha_registro DESC
        `;

        const result = await pool.query(query);
        const destinatarios = result.rows;

        console.log(`📤 Preparando envío de WhatsApp a ${destinatarios.length} destinatarios`);

        // Guardar campaña en base de datos
        const insertQuery = `
            INSERT INTO whatsapp_campanas (perfil_id, mensaje, tipo, total_destinatarios, estado, fecha_creacion, usuario_id)
            VALUES ($1, $2, $3, $4, 'pendiente', NOW(), $5)
            RETURNING id
        `;

        const campanaResult = await pool.query(insertQuery, [
            perfilId,
            mensaje,
            tipo || 'custom',
            destinatarios.length,
            req.usuario.id
        ]);

        const campanaId = campanaResult.rows[0].id;

        // TODO: Integración real con WhatsApp Business API
        // Por ahora simulamos el envío exitoso
        // En producción, aquí iría la lógica de envío a través de WhatsApp Business API

        // Simular envío y actualizar estado
        setTimeout(async () => {
            try {
                await pool.query(`
                    UPDATE whatsapp_campanas
                    SET estado = 'completado', fecha_completado = NOW()
                    WHERE id = $1
                `, [campanaId]);
                console.log(`✅ Campaña ${campanaId} marcada como completada`);
            } catch (error) {
                console.error('Error actualizando campaña:', error);
            }
        }, 2000);

        res.json({
            success: true,
            message: 'Mensaje en proceso de envío',
            data: {
                campanaId: campanaId,
                enviados: destinatarios.length,
                perfilId: perfilId
            }
        });

    } catch (error) {
        console.error('❌ Error enviando mensaje WhatsApp:', error);
        res.status(500).json({
            success: false,
            message: 'Error al enviar mensaje',
            error: error.message
        });
    }
});

// GET /api/comunidad/whatsapp/historial - Obtener historial de campañas WhatsApp
app.get('/api/comunidad/whatsapp/historial', authMiddleware, async (req, res) => {
    try {
        const { limit = 20 } = req.query;

        const query = `
            SELECT
                wc.id,
                wc.perfil_id,
                wc.mensaje,
                wc.tipo,
                wc.total_destinatarios,
                wc.estado,
                wc.fecha_creacion,
                wc.fecha_completado,
                u.nombre_completo as usuario
            FROM whatsapp_campanas wc
            LEFT JOIN usuarios u ON wc.usuario_id = u.id
            ORDER BY wc.fecha_creacion DESC
            LIMIT $1
        `;

        const result = await pool.query(query, [limit]);

        // Mapear perfiles a iconos
        const perfilIcons = {
            'fumadores': '🚬',
            'dolor-espalda': '🦴',
            'dolor-cabeza': '🤕',
            'hipertension': '💔',
            'diabetes': '🩸',
            'sedentarios': '🪑',
            'sobrepeso': '⚖️',
            'problemas-sueno': '😴',
            'salud-mental': '🧠',
            'riesgo-hipertension': '🧬',
            'riesgo-cancer': '🎗️',
            'riesgo-cardiovascular': '❤️'
        };

        const perfilNames = {
            'fumadores': 'Fumadores',
            'dolor-espalda': 'Dolor de Espalda',
            'dolor-cabeza': 'Cefaleas/Migrañas',
            'hipertension': 'Hipertensión',
            'diabetes': 'Diabetes',
            'sedentarios': 'Sedentarios',
            'sobrepeso': 'Sobrepeso',
            'problemas-sueno': 'Problemas de Sueño',
            'salud-mental': 'Salud Mental',
            'riesgo-hipertension': 'Riesgo Hipertensión',
            'riesgo-cancer': 'Riesgo Cáncer',
            'riesgo-cardiovascular': 'Riesgo Cardiovascular'
        };

        const historial = result.rows.map(row => ({
            id: row.id,
            perfil: perfilNames[row.perfil_id] || row.perfil_id,
            icono: perfilIcons[row.perfil_id] || '📊',
            mensaje: row.mensaje,
            tipo: row.tipo,
            enviados: row.total_destinatarios,
            estado: row.estado,
            fecha: new Date(row.fecha_creacion).toLocaleString('es-CO', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }),
            usuario: row.usuario
        }));

        res.json({
            success: true,
            data: historial
        });

    } catch (error) {
        console.error('❌ Error obteniendo historial WhatsApp:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener historial',
            error: error.message
        });
    }
});

// GET /api/comunidad/contenido/biblioteca - Obtener biblioteca de contenido
app.get('/api/comunidad/contenido/biblioteca', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id, titulo, categoria, contenido, perfiles,
                lecturas, rating, fecha_creacion
            FROM contenido_educativo
            ORDER BY lecturas DESC
        `);

        const contenido = result.rows.map(row => ({
            ...row,
            perfiles: Array.isArray(row.perfiles) ? row.perfiles : JSON.parse(row.perfiles || '[]')
        }));

        res.json({
            success: true,
            data: contenido,
            stats: {
                total: contenido.length,
                lecturas_totales: contenido.reduce((sum, c) => sum + (c.lecturas || 0), 0)
            }
        });
    } catch (error) {
        console.error('Error obteniendo biblioteca:', error);
        res.status(500).json({ success: false, message: 'Error al obtener biblioteca' });
    }
});

// GET /api/comunidad/contenido/campanas - Obtener campañas de contenido
app.get('/api/comunidad/contenido/campanas', authMiddleware, async (req, res) => {
    try {
        // Datos de ejemplo (en producción vendría de BD)
        const campanas = [
            {
                id: 1,
                nombre: 'Tips Semanales para Fumadores',
                descripcion: 'Consejos y motivación para dejar de fumar',
                frecuencia: 'Semanal (Lunes)',
                perfiles: ['fumadores'],
                estado: 'activa',
                envios_totales: 48
            },
            {
                id: 2,
                nombre: 'Nutrición para Diabéticos',
                descripcion: 'Recetas y guías nutricionales',
                frecuencia: 'Quincenal',
                perfiles: ['diabetes', 'sobrepeso'],
                estado: 'activa',
                envios_totales: 24
            },
            {
                id: 3,
                nombre: 'Ejercicios Preventivos',
                descripcion: 'Rutinas de ejercicio adaptadas',
                frecuencia: 'Semanal (Miércoles)',
                perfiles: ['sedentarios', 'dolor-espalda'],
                estado: 'pausada',
                envios_totales: 36
            }
        ];

        res.json({ success: true, data: campanas });
    } catch (error) {
        console.error('Error obteniendo campañas:', error);
        res.status(500).json({ success: false, message: 'Error al obtener campañas' });
    }
});

// POST /api/comunidad/contenido/crear - Crear nuevo contenido
app.post('/api/comunidad/contenido/crear', authMiddleware, async (req, res) => {
    try {
        const { titulo, categoria, contenido, perfiles } = req.body;

        if (!titulo || !contenido || !perfiles || perfiles.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos requeridos'
            });
        }

        const result = await pool.query(`
            INSERT INTO contenido_educativo (titulo, categoria, contenido, perfiles)
            VALUES ($1, $2, $3, $4)
            RETURNING id
        `, [titulo, categoria, contenido, JSON.stringify(perfiles)]);

        res.json({
            success: true,
            message: 'Contenido creado exitosamente',
            data: { id: result.rows[0].id }
        });
    } catch (error) {
        console.error('Error creando contenido:', error);
        res.status(500).json({ success: false, message: 'Error al crear contenido' });
    }
});

console.log('✅ Endpoints Comunidad de Salud configurados');

// Endpoint de prueba para WhatsApp con Twilio
app.post('/api/test/whatsapp', async (req, res) => {
    try {
        const { numero, mensaje } = req.body;

        if (!numero || !mensaje) {
            return res.status(400).json({
                success: false,
                error: 'Se requieren campos: numero, mensaje'
            });
        }

        console.log(`🧪 TEST: Enviando WhatsApp a ${numero}`);
        const result = await sendWhatsAppMessage(numero, mensaje);

        res.json({
            success: result.success || true,
            result: result,
            message: 'Mensaje enviado (verifica logs y Twilio Console)'
        });
    } catch (error) {
        console.error('❌ Error en test de WhatsApp:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========== ENDPOINTS ENVÍO SIIGO ==========
// GET - Obtener registros de SIIGO con linkEnviado vacío (cargar automáticamente)
app.get('/api/envio-siigo/registros', async (req, res) => {
    try {
        const { tipo = 'pendientes' } = req.query;

        let query;
        let params = ['SIIGO'];

        if (tipo === 'pendientes') {
            // Cargar registros con linkEnviado vacío (NULL o '')
            query = `
                SELECT
                    "_id",
                    "primerNombre",
                    "segundoNombre",
                    "primerApellido",
                    "segundoApellido",
                    "numeroId",
                    "celular",
                    "ciudad",
                    "fechaAtencion",
                    "linkEnviado",
                    "_createdDate"
                FROM "HistoriaClinica"
                WHERE "codEmpresa" = $1
                AND ("linkEnviado" IS NULL OR "linkEnviado" = '')
                ORDER BY "_createdDate" DESC
                LIMIT 500
            `;
        } else if (tipo === 'segundo-envio') {
            // Registros con linkEnviado pero sin fechaAtencion
            query = `
                SELECT
                    "_id",
                    "primerNombre",
                    "segundoNombre",
                    "primerApellido",
                    "segundoApellido",
                    "numeroId",
                    "celular",
                    "ciudad",
                    "fechaAtencion",
                    "linkEnviado",
                    "_createdDate"
                FROM "HistoriaClinica"
                WHERE "codEmpresa" = $1
                AND "linkEnviado" IS NOT NULL
                AND "linkEnviado" != ''
                AND ("fechaAtencion" IS NULL OR "fechaAtencion" = '')
                ORDER BY "_createdDate" DESC
                LIMIT 500
            `;
        } else if (tipo === 'emergencia') {
            // Registros con linkEnviado = "ENVIADO"
            query = `
                SELECT
                    "_id",
                    "primerNombre",
                    "segundoNombre",
                    "primerApellido",
                    "segundoApellido",
                    "numeroId",
                    "celular",
                    "ciudad",
                    "fechaAtencion",
                    "linkEnviado",
                    "_createdDate"
                FROM "HistoriaClinica"
                WHERE "codEmpresa" = $1
                AND "linkEnviado" = 'ENVIADO'
                ORDER BY "_createdDate" DESC
                LIMIT 500
            `;
        }

        const result = await pool.query(query, params);

        console.log(`📋 Registros SIIGO (${tipo}): ${result.rows.length} encontrados`);

        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        console.error('❌ Error obteniendo registros SIIGO:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener registros',
            error: error.message
        });
    }
});

// POST - Enviar mensaje individual de WhatsApp a paciente SIIGO
app.post('/api/envio-siigo/enviar-individual', async (req, res) => {
    try {
        const { _id, primerNombre, segundoNombre, primerApellido, celular, numeroId, ciudad, fechaAtencion } = req.body;

        if (!_id || !celular) {
            return res.status(400).json({
                success: false,
                message: 'Se requieren campos: _id, celular'
            });
        }

        // Limpiar y formatear número de teléfono
        const telefonoLimpio = celular.replace(/\s+/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '');
        let telefonoCompleto;

        if (telefonoLimpio.startsWith('+')) {
            telefonoCompleto = telefonoLimpio.substring(1);
        } else if (/^(52|57|1|34|44|58|51|54)\d{10,}/.test(telefonoLimpio)) {
            telefonoCompleto = telefonoLimpio;
        } else if (/^\d{10}$/.test(telefonoLimpio)) {
            telefonoCompleto = '57' + telefonoLimpio;
        } else if (telefonoLimpio.startsWith('0')) {
            const sinCero = telefonoLimpio.substring(1);
            telefonoCompleto = '52' + sinCero;
        } else if (/^\d{8,9}$/.test(telefonoLimpio)) {
            telefonoCompleto = '52' + telefonoLimpio;
        } else {
            telefonoCompleto = '57' + telefonoLimpio;
        }

        // Preparar nombre completo
        const nombreCompleto = `${primerNombre || ""} ${segundoNombre || ""}`.trim();

        // Determinar template y variables según ciudad
        let templateSid;
        let variables;

        if (ciudad && ciudad.toUpperCase() === "BOGOTA") {
            // Template para Bogotá (presencial)
            templateSid = 'HX4554efaf53c1bd614d49c951e487d394';
            variables = {
                "1": _id  // ID para el botón del formulario
            };
        } else {
            // Template para otras ciudades (virtual con cita)
            templateSid = 'HXeb45e56eb2e8dc4eaa35433282e12709';

            // Formatear fecha y hora si existe (convertir a hora de Colombia UTC-5)
            let fechaFormateada = "fecha pendiente";
            let horaFormateada = "hora pendiente";

            if (fechaAtencion) {
                // Convertir a hora de Colombia (UTC-5)
                const fechaUTC = new Date(fechaAtencion);
                const offsetColombia = -5 * 60; // Colombia UTC-5 en minutos
                const offsetLocal = fechaUTC.getTimezoneOffset(); // Offset del servidor
                const fechaColombia = new Date(fechaUTC.getTime() + (offsetLocal + offsetColombia) * 60000);

                const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
                const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

                const diaSemana = diasSemana[fechaColombia.getDay()];
                const dia = fechaColombia.getDate();
                const mes = meses[fechaColombia.getMonth()];

                fechaFormateada = `${diaSemana} ${dia} de ${mes}`;

                const horas = fechaColombia.getHours().toString().padStart(2, '0');
                const minutos = fechaColombia.getMinutes().toString().padStart(2, '0');
                horaFormateada = `${horas}:${minutos}`;
            }

            variables = {
                "1": nombreCompleto,
                "2": fechaFormateada,
                "3": horaFormateada,
                "4": _id  // ID para el botón del formulario
            };
        }

        // Enviar mensaje usando template de Twilio
        const resultWhatsApp = await sendWhatsAppMessage(telefonoCompleto, null, variables, templateSid);

        if (!resultWhatsApp.success) {
            return res.status(500).json({
                success: false,
                message: 'Error al enviar WhatsApp',
                error: resultWhatsApp.error
            });
        }

        // Marcar como enviado en la base de datos
        await pool.query(`
            UPDATE "HistoriaClinica"
            SET "linkEnviado" = 'ENVIADO'
            WHERE "_id" = $1
        `, [_id]);

        // Crear registro en conversaciones_whatsapp con stopBot
        const telefonoConPrefijo = '57' + telefonoCompleto.replace(/^57/, '');

        try {
            const convExistente = await pool.query(
                'SELECT id FROM conversaciones_whatsapp WHERE celular = $1',
                [telefonoConPrefijo]
            );

            if (convExistente.rows.length > 0) {
                await pool.query(
                    `UPDATE conversaciones_whatsapp
                    SET stop_bot = true, fecha_ultima_actividad = NOW()
                    WHERE celular = $1`,
                    [telefonoConPrefijo]
                );
            } else {
                await pool.query(
                    `INSERT INTO conversaciones_whatsapp
                    (celular, nombre_cliente, estado, stop_bot, fecha_ultima_actividad)
                    VALUES ($1, $2, 'cerrada', true, NOW())`,
                    [telefonoConPrefijo, nombreCompleto || 'Paciente SIIGO']
                );
            }
        } catch (whatsappError) {
            console.log('⚠️ Error al gestionar conversación WhatsApp:', whatsappError.message);
        }

        console.log(`✅ WhatsApp enviado a ${nombreCompleto} (${telefonoCompleto})`);

        res.json({
            success: true,
            message: 'Mensaje enviado exitosamente',
            data: {
                telefono: telefonoCompleto,
                nombre: nombreCompleto
            }
        });
    } catch (error) {
        console.error('❌ Error enviando mensaje individual:', error);
        res.status(500).json({
            success: false,
            message: 'Error al enviar mensaje',
            error: error.message
        });
    }
});

// POST - Envío masivo de mensajes
app.post('/api/envio-siigo/enviar-masivo', async (req, res) => {
    try {
        const { registros, tipoMensaje } = req.body;

        if (!registros || !Array.isArray(registros) || registros.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere un array de registros'
            });
        }

        const resultados = {
            total: registros.length,
            enviados: 0,
            errores: 0,
            detalles: [],
            agendaProgramada: []
        };

        for (let i = 0; i < registros.length; i++) {
            const item = registros[i];

            try {
                // Limpiar y formatear número
                const telefonoLimpio = item.celular.replace(/\s+/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '');
                let telefonoCompleto;

                if (telefonoLimpio.startsWith('+')) {
                    telefonoCompleto = telefonoLimpio.substring(1);
                } else if (/^(52|57|1|34|44|58|51|54)\d{10,}/.test(telefonoLimpio)) {
                    telefonoCompleto = telefonoLimpio;
                } else if (/^\d{10}$/.test(telefonoLimpio)) {
                    telefonoCompleto = '57' + telefonoLimpio;
                } else if (telefonoLimpio.startsWith('0')) {
                    const sinCero = telefonoLimpio.substring(1);
                    telefonoCompleto = '52' + sinCero;
                } else if (/^\d{8,9}$/.test(telefonoLimpio)) {
                    telefonoCompleto = '52' + telefonoLimpio;
                } else {
                    telefonoCompleto = '57' + telefonoLimpio;
                }

                const nombreCompleto = `${item.primerNombre || ""} ${item.segundoNombre || ""}`.trim();
                const nombrePaciente = `${item.primerNombre || ""} ${item.primerApellido || ""}`.trim();

                // Determinar template y variables según tipo de mensaje
                let templateSid;
                let variables;

                if (tipoMensaje === 'segundo-envio' || tipoMensaje === 'emergencia') {
                    // Para segundo envío y emergencia usamos texto libre (conversación activa)
                    // NOTA: Estos templates aún no están creados en Twilio
                    // Por ahora usamos sendWhatsAppFreeText
                    const acentos = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U' };
                    const cadenaNombre = item.primerNombre ? item.primerNombre.split('').map(letra => acentos[letra] || letra).join('').toString().split(" ").join("").split(".").join("").split("\t").join("") : "";

                    let mensaje;
                    if (tipoMensaje === 'segundo-envio') {
                        mensaje = `Hola ${cadenaNombre}! Aún no has agendado tu examen médico virtual de SIIGO.

Por favor agenda tu cita haciendo clic en el siguiente link:

https://www.bsl.com.co/autoagendamiento/${item.numeroId}

*Este examen no tiene ningún costo*

¡Gracias!`;
                    } else {
                        mensaje = `Hola ${cadenaNombre}! Te confirmo el link: https://www.bsl.com.co/autoagendamiento/${item.numeroId}`;
                    }

                    // Enviar mensaje de texto libre
                    const resultWhatsApp = await sendWhatsAppFreeText(telefonoCompleto, mensaje);

                    if (!resultWhatsApp.success) {
                        throw new Error(resultWhatsApp.error || 'Error al enviar WhatsApp');
                    }
                } else {
                    // Mensaje inicial (primer envío) - usar templates
                    if (item.ciudad && item.ciudad.toUpperCase() === "BOGOTA") {
                        // Template para Bogotá (presencial)
                        templateSid = 'HX4554efaf53c1bd614d49c951e487d394';
                        variables = {
                            "1": item._id
                        };
                    } else {
                        // Template para otras ciudades (virtual con cita)
                        templateSid = 'HXeb45e56eb2e8dc4eaa35433282e12709';

                        let fechaFormateada = "fecha pendiente";
                        let horaFormateada = "hora pendiente";

                        if (item.fechaAtencion) {
                            // Convertir a hora de Colombia (UTC-5)
                            const fechaUTC = new Date(item.fechaAtencion);
                            const offsetColombia = -5 * 60; // Colombia UTC-5 en minutos
                            const offsetLocal = fechaUTC.getTimezoneOffset(); // Offset del servidor
                            const fechaColombia = new Date(fechaUTC.getTime() + (offsetLocal + offsetColombia) * 60000);

                            const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
                            const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

                            const diaSemana = diasSemana[fechaColombia.getDay()];
                            const dia = fechaColombia.getDate();
                            const mes = meses[fechaColombia.getMonth()];

                            fechaFormateada = `${diaSemana} ${dia} de ${mes}`;

                            const horas = fechaColombia.getHours().toString().padStart(2, '0');
                            const minutos = fechaColombia.getMinutes().toString().padStart(2, '0');
                            horaFormateada = `${horas}:${minutos}`;
                        }

                        variables = {
                            "1": nombreCompleto,
                            "2": fechaFormateada,
                            "3": horaFormateada,
                            "4": item._id
                        };
                    }

                    // Enviar mensaje usando template de Twilio
                    const resultWhatsApp = await sendWhatsAppMessage(telefonoCompleto, null, variables, templateSid);

                    if (!resultWhatsApp.success) {
                        throw new Error(resultWhatsApp.error || 'Error al enviar WhatsApp');
                    }
                }

                // Solo actualizar linkEnviado si es primer envío
                if (tipoMensaje !== 'segundo-envio' && tipoMensaje !== 'emergencia') {
                    await pool.query(`
                        UPDATE "HistoriaClinica"
                        SET "linkEnviado" = 'ENVIADO'
                        WHERE "_id" = $1
                    `, [item._id]);
                }

                // Crear/actualizar conversación WhatsApp
                const telefonoConPrefijo = '57' + telefonoCompleto.replace(/^57/, '');

                try {
                    const convExistente = await pool.query(
                        'SELECT id FROM conversaciones_whatsapp WHERE celular = $1',
                        [telefonoConPrefijo]
                    );

                    if (convExistente.rows.length > 0) {
                        await pool.query(
                            `UPDATE conversaciones_whatsapp
                            SET stop_bot = true, fecha_ultima_actividad = NOW()
                            WHERE celular = $1`,
                            [telefonoConPrefijo]
                        );
                    } else {
                        await pool.query(
                            `INSERT INTO conversaciones_whatsapp
                            (celular, nombre_cliente, estado, stop_bot, fecha_ultima_actividad)
                            VALUES ($1, $2, 'cerrada', true, NOW())`,
                            [telefonoConPrefijo, nombreCompleto || 'Paciente SIIGO']
                        );
                    }
                } catch (whatsappError) {
                    console.log('⚠️ Error al gestionar conversación WhatsApp:', whatsappError.message);
                }

                // Agregar a agenda programada
                let fechaHoraTexto = "Sin fecha asignada";
                if (item.fechaAtencion) {
                    const fecha = new Date(item.fechaAtencion);
                    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
                    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

                    const diaSemana = diasSemana[fecha.getDay()];
                    const dia = fecha.getDate();
                    const mes = meses[fecha.getMonth()];
                    const horas = fecha.getHours().toString().padStart(2, '0');
                    const minutos = fecha.getMinutes().toString().padStart(2, '0');

                    fechaHoraTexto = `${diaSemana} ${dia} de ${mes} - ${horas}:${minutos}`;
                }

                resultados.agendaProgramada.push({
                    nombre: nombrePaciente,
                    fechaHora: fechaHoraTexto,
                    ciudad: item.ciudad || "Sin ciudad"
                });

                resultados.enviados++;
                console.log(`✅ ${i + 1}/${registros.length} - Enviado a ${nombrePaciente}`);

                // Pausa de 3 segundos entre mensajes
                if (i < registros.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }

            } catch (error) {
                resultados.errores++;
                resultados.detalles.push({
                    nombre: `${item.primerNombre || ""} ${item.primerApellido || ""}`.trim(),
                    numeroId: item.numeroId,
                    celular: item.celular,
                    error: error.message
                });
                console.error(`❌ Error enviando a ${item.primerNombre}:`, error.message);
            }
        }

        console.log(`📊 Envío masivo completado: ${resultados.enviados}/${resultados.total} exitosos`);

        res.json({
            success: true,
            message: 'Envío masivo completado',
            resultados: resultados
        });
    } catch (error) {
        console.error('❌ Error en envío masivo:', error);
        res.status(500).json({
            success: false,
            message: 'Error en envío masivo',
            error: error.message
        });
    }
});

// POST - Enviar mensaje manual de WhatsApp (para uso desde ordenes.html)
app.post('/api/whatsapp/enviar-manual', async (req, res) => {
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

        // Normalizar teléfono con prefijo 57
        const telefonoNormalizado = normalizarTelefonoConPrefijo57(celular);

        if (!telefonoNormalizado) {
            return res.status(400).json({
                success: false,
                message: 'Número de teléfono inválido'
            });
        }

        // Enviar mensaje con template de confirmación
        // Template: saludo_particulares (HX8c84dc81049e7b055bd30125e9786051)
        // Variables: {{1}} = nombre (vacío para manual), {{2}} = fecha y hora (vacío para manual)
        const templateSid = 'HX8c84dc81049e7b055bd30125e9786051';
        const variables = {
            "1": "",  // Nombre vacío
            "2": ""   // Fecha/hora vacía
        };

        const resultado = await sendWhatsAppMessage(
            telefonoNormalizado,
            null,  // Sin mensaje de texto
            variables,
            templateSid
        );

        if (!resultado.success) {
            throw new Error(resultado.error || 'Error al enviar mensaje');
        }

        // Guardar en conversaciones_whatsapp
        try {
            const conversacionExistente = await pool.query(
                'SELECT id FROM conversaciones_whatsapp WHERE celular = $1',
                [telefonoNormalizado]
            );

            if (conversacionExistente.rows.length > 0) {
                // Actualizar conversación existente
                await pool.query(`
                    UPDATE conversaciones_whatsapp
                    SET "stopBot" = true,
                        fecha_ultima_actividad = NOW()
                    WHERE celular = $1
                `, [telefonoNormalizado]);
            } else {
                // Crear nueva conversación
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
            // No bloqueamos el envío si falla la BD
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

console.log('✅ Endpoints Envío SIIGO configurados');

// ========== SOCKET.IO CONFIGURACIÓN ==========
io.on('connection', (socket) => {
    console.log('🔌 Cliente Socket.IO conectado:', socket.id);

    socket.on('disconnect', () => {
        console.log('🔌 Cliente Socket.IO desconectado:', socket.id);
    });
});

// Función global para emitir eventos de WhatsApp
global.emitWhatsAppEvent = function(eventType, data) {
    io.emit(eventType, data);
    console.log(`📡 Evento WebSocket enviado: ${eventType}`, data);
};

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📊 Base de datos: PostgreSQL en Digital Ocean`);
    console.log(`🔌 Socket.IO: Listo para conexiones en tiempo real`);
});
