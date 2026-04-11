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

// initDB corre en background al arranque. Las rutas que dependen de columnas nuevas
// (ej. tenant_id en tablas recién agregadas) se protegen por sí solas — el middleware
// de tenant tiene fallback a BSL si el cache falla durante los primeros ms del boot.
// Para evitar race conditions críticas en deploys con schema changes, esperamos a
// que initDB complete ANTES de empezar a aceptar tráfico (ver bloque START SERVER).
const initDBPromise = initDB();

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

app.use(bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '25mb' }));
// index: false → no auto-servir public/index.html (formulario del paciente) en "/".
// El handler GET / más abajo se encarga de servir login.html.
app.use(express.static('public', { index: false }));

// ========== MULTI-TENANT ==========
// Resuelve el tenant por hostname y lo monta en req.tenant.
// Durante la migración (un solo tenant activo), hace fallback a 'bsl' — BSL sigue idéntico.
// Ver CLAUDE.md sección "Multi-Tenant Architecture".
const { tenantMiddleware } = require('./src/middleware/tenant');
app.use(tenantMiddleware);

// ========== SSE (Server-Sent Events) ==========
const { addSSEClient, removeSSEClient } = require('./src/helpers/sse');

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.write('data: {"type":"connected"}\n\n');

    // Multi-tenant: asociar cada cliente SSE al tenant resuelto por hostname.
    // Así notificarNuevaOrden(orden, tenantId) solo envía a clientes del mismo tenant.
    const tenantId = (req.tenant && req.tenant.id) || 'bsl';
    const clientId = Date.now() + Math.random();
    const newClient = { id: clientId, tenantId, res };
    addSSEClient(newClient);
    console.log(`📡 Cliente SSE conectado: ${clientId} (tenant: ${tenantId})`);

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

// Wix data proxy (Multi-tenant: BSL-only, ver CLAUDE.md)
const { isBsl: isBslReq } = require('./src/helpers/tenant');
app.get('/api/wix/:id', async (req, res) => {
    try {
        if (!isBslReq(req)) {
            return res.status(404).json({ success: false, message: 'Wix no disponible para este tenant' });
        }
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

// Multi-tenant management (super-admin only)
app.use('/api/tenants', require('./src/routes/tenants'));

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

// Multi-tenant: middleware que bloquea rutas BSL-only con 404 si el tenant no es bsl
const { requireBslTenant } = require('./src/helpers/tenant');

// Facturación (BSL-only: Alegra + SITEL)
app.use('/api/facturacion', requireBslTenant, require('./src/routes/facturacion'));
app.use('/api/facturacion-empresas', requireBslTenant, require('./src/routes/facturacion-empresas'));
app.use('/api/planilla-sitel', requireBslTenant, require('./src/routes/planilla-sitel'));

// NUBIA (BSL-only: telemedicina SANITHELP-JJ)
app.use('/api', requireBslTenant, require('./src/routes/nubia'));

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

// Voximetría
app.use('/api', require('./src/routes/voximetria'));

// Laboratorios
app.use('/api/laboratorios', require('./src/routes/laboratorios'));

// Certificados (montado en raíz porque tiene /preview-certificado y /api/certificado-pdf)
app.use('/', require('./src/routes/certificados'));

// RIPS (BSL-only: reportes colombianos salud)
app.use('/api/rips', requireBslTenant, require('./src/routes/rips'));

// Comunidad de Salud
app.use('/api/comunidad', require('./src/routes/comunidad'));

// Envío SIIGO (BSL-only: integración SIIGO)
app.use('/api/envio-siigo', requireBslTenant, require('./src/routes/siigo'));

// Asistencia SIIGO (BSL-only)
app.use('/api/asistencia-siigo', requireBslTenant, require('./src/routes/asistencia-siigo'));

// Envío Agendamiento Empresas
app.use('/api/envio-empresas', require('./src/routes/envio-empresas'));

// Estadísticas
app.use('/api/estadisticas', require('./src/routes/estadisticas'));

// /api/external es BSL-only (integración SIIGO). Envuelto con requireBslTenant para
// prevenir creación de órdenes huérfanas en tenants equivocados si alguien llamara
// al endpoint desde otro hostname con la API key válida.
app.use('/api/external', requireBslTenant, require('./src/routes/external'));

// ========== CRON JOBS ==========

// Barrido NUBIA cada 5 minutos (BSL-only por diseño: telemedicina SANITHELP-JJ).
// Las funciones internas usan queries directas contra HistoriaClinica sin filtro
// explícito de tenant, pero en la práctica solo afectan registros de BSL porque
// ningún otro tenant tiene pacientes SANITHELP-JJ ni NUBIA. Si algún día otro
// tenant necesita telemedicina, habría que refactorizar nubia.js para iterar
// por tenant activo.
const nubiaRouter = require('./src/routes/nubia');
cron.schedule('*/5 * * * *', async () => {
    console.log('⏰ [CRON] Ejecutando barrido NUBIA automático (BSL-only)...');
    try {
        await nubiaRouter.barridoNubiaEnviarLink();
        await nubiaRouter.barridoNubiaMarcarAtendido();
        await nubiaRouter.barridoNubiaRecordatorioPago();
        await nubiaRouter.barridoRecordatorio1h();
    } catch (error) {
        console.error('❌ [CRON] Error en barrido NUBIA:', error);
    }
});
console.log('✅ Cron job configurado: Barrido NUBIA + recordatorios cada 5 minutos');

// Crear reglas de enrutamiento por defecto para cada tenant activo.
// Multi-tenant: cada tenant necesita sus propias reglas porque el filtro de
// reglas_enrutamiento es por tenant_id. Al arrancar, garantizamos que todos
// los tenants activos tengan las 3 reglas básicas.
async function crearReglasEnrutamientoPorDefecto() {
    try {
        // Obtener lista de tenants activos
        const tenantsResult = await pool.query(`SELECT id FROM tenants WHERE activo = TRUE`);
        const tenantIds = tenantsResult.rows.map(r => r.id);

        if (tenantIds.length === 0) {
            // Fallback: si la tabla tenants aún no existe o está vacía, crear para bsl
            tenantIds.push('bsl');
        }

        for (const tId of tenantIds) {
            await pool.query(`
                INSERT INTO reglas_enrutamiento (nombre, prioridad, condiciones, asignar_a, activo, tenant_id)
                VALUES ('Fuera de horario laboral', 10,
                        '{"horario": {"desde": "08:00", "hasta": "18:00"}}'::jsonb, 'bot', true, $1)
                ON CONFLICT DO NOTHING
            `, [tId]);
            await pool.query(`
                INSERT INTO reglas_enrutamiento (nombre, prioridad, condiciones, asignar_a, etiqueta_auto, activo, tenant_id)
                VALUES ('Emergencias', 20,
                        '{"keywords": ["urgente", "emergencia", "ayuda", "problema grave"]}'::jsonb,
                        'agente_disponible', 'URGENTE', true, $1)
                ON CONFLICT DO NOTHING
            `, [tId]);
            await pool.query(`
                INSERT INTO reglas_enrutamiento (nombre, prioridad, condiciones, asignar_a, activo, tenant_id)
                VALUES ('Solicitar humano', 15,
                        '{"keywords": ["hablar con persona", "asesor", "operador", "humano", "agente"]}'::jsonb,
                        'agente_disponible', true, $1)
                ON CONFLICT DO NOTHING
            `, [tId]);
        }

        console.log(`✅ Reglas de enrutamiento por defecto creadas para ${tenantIds.length} tenant(s): ${tenantIds.join(', ')}`);
    } catch (error) {
        console.error('❌ Error creando reglas de enrutamiento:', error);
    }
}
crearReglasEnrutamientoPorDefecto();

// ========== SOCKET.IO (Multi-tenant rooms) ==========
// Cada cliente se une a una room "tenant:X" basada en el hostname de su
// handshake. Los emits deben ir a io.to('tenant:X') para no leakear eventos
// entre tenants. Ver CLAUDE.md sección "Multi-Tenant Architecture".
const { resolveTenant } = require('./src/middleware/tenant');

io.on('connection', async (socket) => {
    try {
        // Resuelve el tenant del cliente por hostname del handshake
        const hostname = (socket.handshake.headers.host || '').split(':')[0];
        const tenant = await resolveTenant({ hostname });
        const tenantId = (tenant && tenant.id) || 'bsl';

        socket.data.tenantId = tenantId;
        socket.join('tenant:' + tenantId);

        console.log(`🔌 Cliente Socket.IO conectado: ${socket.id} (tenant: ${tenantId}, host: ${hostname})`);

        socket.on('disconnect', () => {
            console.log(`🔌 Cliente Socket.IO desconectado: ${socket.id} (tenant: ${tenantId})`);
        });
    } catch (err) {
        console.error('Error en handshake Socket.IO:', err.message);
        // Fallback: joinear a room bsl para no bloquear conexión
        socket.data.tenantId = 'bsl';
        socket.join('tenant:bsl');
    }
});

/**
 * Emite evento WebSocket solo a clientes del tenant indicado en data.tenant_id.
 * Los payloads de eventos ya incluyen tenant_id desde Sprint 4 wave 4.
 * Si no hay tenant_id (legacy), emite global con warning.
 */
global.emitWhatsAppEvent = function(eventType, data) {
    const tenantId = data && data.tenant_id;
    if (tenantId) {
        io.to('tenant:' + tenantId).emit(eventType, data);
        console.log(`📡 Evento WS [${eventType}] → tenant:${tenantId}`);
    } else {
        // Fallback legacy: evento sin tenant_id, emite a todos.
        // Idealmente nunca debería pasar — significa que un caller viejo
        // no agregó tenant_id al payload. Log de warning para detectar.
        console.warn(`⚠️  [WS] Evento ${eventType} sin tenant_id, emit global`);
        io.emit(eventType, data);
    }
};

// ========== START SERVER ==========
// Esperamos a que initDB (schema migration) termine antes de aceptar tráfico.
// Si falla initDB el servidor igual arranca (para no bloquear deploys por DB issues
// transitorias), pero quedará un warning en el log.
initDBPromise
    .catch(err => console.error('⚠️  initDB falló, arrancando igualmente:', err.message))
    .finally(() => {
        server.listen(PORT, () => {
            console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
            console.log(`📊 Base de datos: PostgreSQL en Digital Ocean`);
            console.log(`🔌 Socket.IO: Listo para conexiones en tiempo real`);
        });
    });
