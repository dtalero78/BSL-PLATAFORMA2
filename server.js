require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const path = require('path');
const cron = require('node-cron');

// ========== APP SETUP ==========
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 8080;

// ========== DATABASE ==========
const pool = require('./src/config/database');
const initDB = require('./src/config/init-db');
initDB();

// Exponer pool para rutas de facturación (usa app.locals.pool)
app.locals.pool = pool;

// ========== MIDDLEWARE ==========

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// ========== SSE (Server-Sent Events) ==========
const { addSSEClient, removeSSEClient } = require('./src/helpers/sse');

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.write('data: {"type":"connected"}\n\n');

    const clientId = Date.now();
    const newClient = { id: clientId, res };
    addSSEClient(newClient);
    console.log(`📡 Cliente SSE conectado: ${clientId}`);

    req.on('close', () => {
        removeSSEClient(clientId);
        console.log(`📡 Cliente SSE desconectado: ${clientId}`);
    });
});

// ========== BASIC ROUTES ==========

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', database: 'connected' });
});

// Wix data proxy
app.get('/api/wix/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`https://www.bsl.com.co/_functions/historiaClinicaPorId?_id=${id}`);
        if (!response.ok) {
            return res.status(404).json({ success: false, message: 'No se encontró información en Wix' });
        }
        const result = await response.json();
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
        res.status(500).json({ success: false, message: 'Error al consultar datos de Wix', error: error.message });
    }
});

// ========== MOUNT ROUTE MODULES ==========

// Auth & Admin
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/admin', require('./src/routes/admin'));

// WhatsApp webhook (Twilio)
app.use('/api/whatsapp', require('./src/routes/whatsapp'));

// Formularios (multiple prefixes: /api/formulario, /api/formularios)
app.use('/api', require('./src/routes/formularios'));

// Órdenes
const ordenesRouter = require('./src/routes/ordenes');
app.use('/api/ordenes', ordenesRouter);

// Rutas legacy que existían en /api/ (no en /api/ordenes/) en el server.js original
app.use('/api', require('./src/routes/ordenes-legacy'));

// Historia Clínica
app.use('/api/historia-clinica', require('./src/routes/historia-clinica'));

// Calendario & Exámenes
app.use('/api', require('./src/routes/calendario'));

// Médicos
app.use('/api/medicos', require('./src/routes/medicos'));

// Empresas
app.use('/api/empresas', require('./src/routes/empresas'));

// Facturación
app.use('/api/facturacion', require('./src/routes/facturacion'));
app.use('/api/facturacion-empresas', require('./src/routes/facturacion-empresas'));
app.use('/api/planilla-sitel', require('./src/routes/planilla-sitel'));

// NUBIA
app.use('/api', require('./src/routes/nubia'));

// Audiometría
app.use('/api', require('./src/routes/audiometria'));

// Pruebas ADC
app.use('/api/pruebas-adc', require('./src/routes/pruebas-adc'));

// SCL-90
app.use('/api/scl90', require('./src/routes/scl90'));

// Estado de Pruebas
app.use('/api/estado-pruebas', require('./src/routes/estado-pruebas'));

// Consulta Pública
app.use('/api', require('./src/routes/consulta-publica'));

// Visiometría
app.use('/api', require('./src/routes/visiometria'));

// Laboratorios
app.use('/api/laboratorios', require('./src/routes/laboratorios'));

// Certificados (montado en raíz porque tiene /preview-certificado y /api/certificado-pdf)
app.use('/', require('./src/routes/certificados'));

// RIPS
app.use('/api/rips', require('./src/routes/rips'));

// Comunidad de Salud
app.use('/api/comunidad', require('./src/routes/comunidad'));

// Envío SIIGO
app.use('/api/envio-siigo', require('./src/routes/siigo'));

// Asistencia SIIGO
app.use('/api/asistencia-siigo', require('./src/routes/asistencia-siigo'));

// Envío Agendamiento Empresas
app.use('/api/envio-empresas', require('./src/routes/envio-empresas'));

// Estadísticas
app.use('/api/estadisticas', require('./src/routes/estadisticas'));

app.use('/api/external', require('./src/routes/external'));

// ========== CRON JOBS ==========

// Barrido NUBIA cada 5 minutos
const nubiaRouter = require('./src/routes/nubia');
cron.schedule('*/5 * * * *', async () => {
    console.log('⏰ [CRON] Ejecutando barrido NUBIA automático...');
    try {
        await nubiaRouter.barridoNubiaEnviarLink();
        await nubiaRouter.barridoNubiaMarcarAtendido();
        await nubiaRouter.barridoNubiaRecordatorioPago();
    } catch (error) {
        console.error('❌ [CRON] Error en barrido NUBIA:', error);
    }
});
console.log('✅ Cron job configurado: Barrido NUBIA cada 5 minutos');

// Cron: Mensaje cumpleaños 25 de marzo 2026 a las 12:00 AM (hora Colombia)
cron.schedule('0 0 25 3 *', async () => {
    const hoy = new Date();
    if (hoy.getFullYear() !== 2026) return; // Solo ejecutar en 2026
    console.log('🎂 [CRON] Enviando mensaje de cumpleaños...');
    try {
        const { sendWhapiMessage } = require('./src/services/whapi');
        const mensaje = `Princesa linda:\n\nOtro año más en el que tengo la felicidad de estar cerca de ti para celebrar tu cumpleaños. Es increíble cuando pienso en aquella primera vez que te felicité: estábamos en ese concierto en Bogotá, y recuerdo  esa sensación tan extraña de sentir algo por ti, una idea que parecía absurda pero que era completamente real. Pasé casi media hora grabando el video que Melannie estaba recopilando para sumarlo a los saludos de todos. Y me detengo ahí, porque ese recuerdo dice mucho de ti: en ese momento apenas estabas comenzando a tener tu espacio en Livingroom, y ya eras tan especial que Melannie se tomó el trabajo de reunir esos videos para hacerte sentir única. Y es que definitivamente lo eres. Te lo he dicho mil veces y lo seguiré diciendo: brillas con luz propia, y ese brillo tiene un radio de alcance cada vez más grande.\n\nYo, por supuesto, me siento privilegiado. Estoy genuinamente orgullosopor tener tu atención y tu amor. Cuando pienso en todo lo que hemos construido hasta aquí, no puedo verlo de otra forma que como un milagro y, al mismo tiempo, como una señal de amor verdadero.\n\nEste cumpleaños no viene acompañado del mismo despliegue de años anteriores: el viaje a Barú, el video cantando, la transferencia y todas esas cosas con las que intenté mostrarte mis plumas de pavo real y llamar tu atención —y que además mereces—. Este año solo tengo un detalle material sencillo, pero también los pasos concretos para avanzar hacia una relación que te dé paz y plenitud. Eso, hoy, me parece lo más valioso que puedo ofrecerte.\n\nY ya.\n\nMientras te veo, te mando un abrazo lleno de amor.\n\nFeliz cumpleaños. Te amo.`;
        const result = await sendWhapiMessage('573187639040', mensaje);
        console.log('🎂 [CRON] Resultado:', result.success ? 'Enviado ✅' : `Error: ${result.error}`);
    } catch (error) {
        console.error('❌ [CRON] Error enviando mensaje cumpleaños:', error);
    }
}, { timezone: 'America/Bogota' });
console.log('✅ Cron job configurado: Mensaje cumpleaños 25 de marzo 2026 a las 12:00 AM');

// Crear reglas de enrutamiento por defecto
async function crearReglasEnrutamientoPorDefecto() {
    try {
        await pool.query(`
            INSERT INTO reglas_enrutamiento (nombre, prioridad, condiciones, asignar_a, activo)
            VALUES ('Fuera de horario laboral', 10,
                    '{"horario": {"desde": "08:00", "hasta": "18:00"}}'::jsonb, 'bot', true)
            ON CONFLICT DO NOTHING
        `);
        await pool.query(`
            INSERT INTO reglas_enrutamiento (nombre, prioridad, condiciones, asignar_a, etiqueta_auto, activo)
            VALUES ('Emergencias', 20,
                    '{"keywords": ["urgente", "emergencia", "ayuda", "problema grave"]}'::jsonb,
                    'agente_disponible', 'URGENTE', true)
            ON CONFLICT DO NOTHING
        `);
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
crearReglasEnrutamientoPorDefecto();

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
    console.log('🔌 Cliente Socket.IO conectado:', socket.id);
    socket.on('disconnect', () => {
        console.log('🔌 Cliente Socket.IO desconectado:', socket.id);
    });
});

// Función global para emitir eventos de WhatsApp (usada por services/whatsapp.js y routes)
global.emitWhatsAppEvent = function(eventType, data) {
    io.emit(eventType, data);
    console.log(`📡 Evento WebSocket enviado: ${eventType}`, data);
};

// ========== START SERVER ==========
server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📊 Base de datos: PostgreSQL en Digital Ocean`);
    console.log(`🔌 Socket.IO: Listo para conexiones en tiempo real`);
});
