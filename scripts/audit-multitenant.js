#!/usr/bin/env node
/**
 * Auditoría mecánica de multi-tenancy y seguridad básica.
 *
 * Uso:
 *   node scripts/audit-multitenant.js              # reporte completo
 *   node scripts/audit-multitenant.js --category=queries
 *   node scripts/audit-multitenant.js --category=routes
 *   node scripts/audit-multitenant.js --category=injection
 *   node scripts/audit-multitenant.js --category=emits
 *
 * Qué detecta (mecánicamente, sin juicio semántico):
 *
 *  1. queries   — pool.query(...) sobre tablas tenant-scoped que NO mencionan tenant_id.
 *  2. routes    — router.(get|post|put|delete)(...) sin authMiddleware entre los args.
 *  3. injection — template literals con ${...} DENTRO del string SQL pasado a pool.query.
 *  4. emits     — io.emit(...) sin io.to('tenant:...') (leak cross-tenant en Socket.io).
 *
 * Es un GATILLO: reporta candidatos. Tú (o un reviewer) decides si es falso positivo.
 * Falsos positivos conocidos: queries a tablas globales (tenants, rips_configuracion sin
 * tenant_id por diseño), rutas patient-facing intencionalmente públicas, etc.
 *
 * No ejecuta nada en BD. Solo lee archivos fuente.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIRS = [path.join(ROOT, 'src'), path.join(ROOT, 'server.js')];

// Tablas con columna tenant_id (ver src/config/init-db.js — lista tenantScopedTables).
// Cualquier query contra estas tablas DEBE filtrar por tenant_id.
const TENANT_SCOPED_TABLES = [
    'formularios', 'HistoriaClinica', 'empresas', 'usuarios', 'medicos',
    'medicos_disponibilidad', 'examenes',
    'audiometrias', 'visiometrias', 'visiometrias_virtual', 'voximetrias_virtual',
    'pruebasADC', 'scl90', 'laboratorios',
    'conversaciones_whatsapp', 'mensajes_whatsapp', 'agentes_estado',
    'transferencias_conversacion', 'reglas_enrutamiento',
    'sesiones', 'permisos_usuario',
    'seguimiento_comunidad', 'certificado_envio_logs',
    'configuracion_facturacion_empresa', 'contenido_educativo', 'sistema_asignacion'
];

// Rutas públicas por diseño (patient-facing, webhooks, SSE, públicas). No se flaggean.
const PUBLIC_ROUTE_WHITELIST = [
    // Webhook Twilio (valida firma HMAC, no JWT)
    { file: 'src/routes/whatsapp.js', path: '/' },
    // Formulario del paciente (público por diseño)
    { file: 'src/routes/formularios.js', path: '/formulario' },
    // Lookup público de órdenes
    { file: 'src/routes/consulta-publica.js', path: '*' },
    // SSE connect (handshake de eventos, no trae token en EventSource)
    { file: 'server.js', path: '/api/events' },
    // Tests virtuales patient-facing
    { file: 'src/routes/voximetria.js', path: '*' },
    { file: 'src/routes/visiometria.js', path: '*' },
    { file: 'src/routes/audiometria.js', path: '*' },
    { file: 'src/routes/pruebas-adc.js', path: '*' },
    { file: 'src/routes/scl90.js', path: '*' },
    { file: 'src/routes/estado-pruebas.js', path: '*' },
    // Proxy Wix (query-only, BSL-only por diseño ya enforcado en handler)
    { file: 'server.js', path: '/api/wix/:id' },
    // Endpoints públicos de tenants (config de branding por hostname)
    { file: 'src/routes/tenants.js', path: '/config' },
    // Auth pública (login, registro, etc.)
    { file: 'src/routes/auth.js', path: '*' },
    // External API con x-api-key (no JWT)
    { file: 'src/routes/external.js', path: '*' },
    // Consulta orden
    { file: 'src/routes/ordenes.js', path: '/consulta' },
    // Certificados (incluye rutas públicas de preview/validación)
    { file: 'src/routes/certificados.js', path: '*' },
    // Descarga empresas (pública por diseño — token en URL)
    { file: 'src/routes/empresas.js', path: '/descarga' },
    // Catálogo de exámenes: GET público, usado en 6+ páginas internas para poblar
    // formularios (empresas, ordenes, nueva-orden, calendario, panel-empresas).
    // Filtrado por tenant vía hostname. Mutaciones (POST/PUT/DELETE) sí requieren auth.
    { file: 'src/routes/calendario.js', path: '/examenes', methods: ['GET'] },
    { file: 'src/routes/calendario.js', path: '/examenes/:id', methods: ['GET'] },
];

// ========== UTILIDADES ==========

function walkJs(dir) {
    const out = [];
    if (fs.statSync(dir).isFile()) return dir.endsWith('.js') ? [dir] : [];
    for (const entry of fs.readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) out.push(...walkJs(full));
        else if (entry.endsWith('.js')) out.push(full);
    }
    return out;
}

function relPath(abs) { return path.relative(ROOT, abs); }

// Extrae bloques `pool.query(...)` balanceados. Retorna [{start, end, text, line}].
function extractPoolQueries(source) {
    const out = [];
    const re = /pool\.query\s*\(/g;
    let m;
    while ((m = re.exec(source)) !== null) {
        const start = m.index;
        let depth = 0;
        let i = m.index + m[0].length - 1; // en el '('
        for (; i < source.length; i++) {
            const c = source[i];
            if (c === '(') depth++;
            else if (c === ')') {
                depth--;
                if (depth === 0) { i++; break; }
            }
        }
        const text = source.slice(start, i);
        const line = source.slice(0, start).split('\n').length;
        out.push({ start, end: i, text, line });
    }
    return out;
}

// ========== CHECKS ==========

function checkQueries(file, source) {
    const findings = [];
    const blocks = extractPoolQueries(source);
    for (const b of blocks) {
        const sqlMatch = b.text.match(/`([^`]*)`/s);
        if (!sqlMatch) continue; // query dinámica armada fuera, revisar manual
        const sql = sqlMatch[1];

        const mentionedTable = TENANT_SCOPED_TABLES.find(t => {
            const re = new RegExp(`(FROM|UPDATE|INTO|JOIN)\\s+"?${t}"?`, 'i');
            return re.test(sql);
        });
        if (!mentionedTable) continue;

        // ¿Filtra por tenant_id en algún lado (WHERE o INSERT column)?
        if (/tenant_id/i.test(sql)) continue;

        findings.push({
            file: relPath(file),
            line: b.line,
            table: mentionedTable,
            snippet: sql.trim().slice(0, 120).replace(/\s+/g, ' ')
        });
    }
    return findings;
}

function checkRoutes(file, source) {
    const findings = [];
    const rel = relPath(file);
    // router.(get|post|put|delete|patch)('path', arg1, arg2, ..., handler)
    const re = /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*([^)]*)\)/g;
    let m;
    while ((m = re.exec(source)) !== null) {
        const method = m[1].toUpperCase();
        const routePath = m[2];
        const rest = m[3];
        const line = source.slice(0, m.index).split('\n').length;

        // Whitelist — file + path + opcionalmente método HTTP
        const whitelisted = PUBLIC_ROUTE_WHITELIST.some(w => {
            if (w.file !== rel) return false;
            if (w.methods && !w.methods.includes(method)) return false;
            if (w.path === '*') return true;
            return routePath === w.path || routePath.startsWith(w.path);
        });
        if (whitelisted) continue;

        if (/authMiddleware|apiKeyAuth/.test(rest)) continue;

        findings.push({
            file: rel, line, method, path: routePath,
            snippet: `router.${m[1]}('${routePath}', ...)`
        });
    }
    return findings;
}

function checkInjection(file, source) {
    const findings = [];
    const blocks = extractPoolQueries(source);
    for (const b of blocks) {
        // Buscar `...${...}...` DENTRO del primer template literal
        const sqlMatch = b.text.match(/`([^`]*)`/s);
        if (!sqlMatch) continue;
        const sql = sqlMatch[1];
        if (!/\$\{[^}]+\}/.test(sql)) continue;

        // Excluir interpolaciones de nombres de tabla/schema aceptables (this.tableName, etc)
        // Reportamos igual — el reviewer juzga.
        findings.push({
            file: relPath(file),
            line: b.line,
            snippet: sql.trim().slice(0, 140).replace(/\s+/g, ' ')
        });
    }
    return findings;
}

function checkEmits(file, source) {
    const findings = [];
    const rel = relPath(file);
    const lines = source.split('\n');
    lines.forEach((ln, i) => {
        if (/\bio\.emit\s*\(/.test(ln)) {
            findings.push({ file: rel, line: i + 1, snippet: ln.trim().slice(0, 140) });
        }
    });
    return findings;
}

// ========== REPORTE ==========

function printSection(title, findings, formatter) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  ${title}  (${findings.length})`);
    console.log('='.repeat(70));
    if (findings.length === 0) {
        console.log('  ✅ Sin hallazgos.');
        return;
    }
    findings.forEach((f, i) => {
        console.log(`\n  ${i + 1}. ${formatter(f)}`);
    });
}

function main() {
    const args = process.argv.slice(2);
    const category = args.find(a => a.startsWith('--category='))?.split('=')[1];

    const files = [];
    for (const target of SRC_DIRS) {
        if (!fs.existsSync(target)) continue;
        files.push(...walkJs(target));
    }

    const results = { queries: [], routes: [], injection: [], emits: [] };

    for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        results.queries.push(...checkQueries(f, src));
        results.routes.push(...checkRoutes(f, src));
        results.injection.push(...checkInjection(f, src));
        results.emits.push(...checkEmits(f, src));
    }

    console.log('\n🔍 AUDIT MULTI-TENANT — BSL Plataforma');
    console.log(`   Archivos escaneados: ${files.length}`);
    console.log(`   Tablas tenant-scoped conocidas: ${TENANT_SCOPED_TABLES.length}`);

    const showAll = !category;
    if (showAll || category === 'queries') {
        printSection(
            'QUERIES sobre tablas tenant-scoped SIN filtro tenant_id',
            results.queries,
            f => `[${f.table}] ${f.file}:${f.line}\n     ${f.snippet}`
        );
    }
    if (showAll || category === 'routes') {
        printSection(
            'RUTAS sin authMiddleware (fuera del whitelist de rutas públicas)',
            results.routes,
            f => `${f.method} ${f.path}  →  ${f.file}:${f.line}`
        );
    }
    if (showAll || category === 'injection') {
        printSection(
            'TEMPLATE LITERALS con ${...} dentro de SQL (posible SQL injection)',
            results.injection,
            f => `${f.file}:${f.line}\n     ${f.snippet}`
        );
    }
    if (showAll || category === 'emits') {
        printSection(
            'io.emit() sin filtro de room (posible leak cross-tenant)',
            results.emits,
            f => `${f.file}:${f.line}\n     ${f.snippet}`
        );
    }

    const total =
        (showAll || category === 'queries' ? results.queries.length : 0) +
        (showAll || category === 'routes' ? results.routes.length : 0) +
        (showAll || category === 'injection' ? results.injection.length : 0) +
        (showAll || category === 'emits' ? results.emits.length : 0);

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  TOTAL: ${total} candidato(s) a revisar manualmente`);
    console.log('='.repeat(70));
    console.log(`  Recuerda: este script reporta CANDIDATOS. Revisa cada uno.`);
    console.log(`  Falsos positivos comunes documentados en AUDIT.md\n`);

    process.exit(total > 0 ? 1 : 0);
}

main();
