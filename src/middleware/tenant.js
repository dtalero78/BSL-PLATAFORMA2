const pool = require('../config/database');

/**
 * Middleware de resolución de tenant por hostname.
 *
 * Ver CLAUDE.md sección "Multi-Tenant Architecture".
 *
 * Estrategia de resolución (en orden):
 *   1. Header X-Tenant-Id (para herramientas internas / testing / APIs externas)
 *   2. Hostname de la request (ej. bsl.com.co → tenant 'bsl')
 *   3. Fallback a 'bsl' (único tenant activo durante la migración)
 *
 * Después de Sprint 7 (safety gate), el fallback a 'bsl' se convierte en error 404
 * cuando exista más de un tenant activo, para evitar leaks silenciosos.
 *
 * El tenant resuelto queda disponible como req.tenant:
 *   {
 *     id: 'bsl',
 *     nombre: 'BSL Salud Ocupacional',
 *     hostnames: ['bsl.com.co', ...],
 *     config: { usa_wix: true, ... },
 *     credenciales: { ... },
 *     activo: true
 *   }
 */

// Cache en memoria de tenants activos.
// Se refresca cada TTL ms o manualmente vía invalidateTenantCache().
const CACHE_TTL_MS = 60 * 1000; // 1 minuto
let tenantCache = null;
let tenantCacheExpiry = 0;

const BSL_FALLBACK = {
    id: 'bsl',
    nombre: 'BSL Salud Ocupacional',
    hostnames: ['bsl.com.co', 'www.bsl.com.co', 'plataforma.bsl.com.co', 'localhost'],
    config: { usa_wix: true, modulos_activos: ['todos'] },
    credenciales: {},
    activo: true,
    _fallback: true
};

async function loadTenantCache() {
    try {
        const result = await pool.query(`
            SELECT id, nombre, hostnames, config, credenciales, activo
            FROM tenants
            WHERE activo = TRUE
        `);

        const byId = new Map();
        const byHostname = new Map();

        for (const row of result.rows) {
            byId.set(row.id, row);
            const hostnames = Array.isArray(row.hostnames) ? row.hostnames : [];
            for (const host of hostnames) {
                if (host) byHostname.set(host.toLowerCase(), row);
            }
        }

        tenantCache = { byId, byHostname };
        tenantCacheExpiry = Date.now() + CACHE_TTL_MS;
    } catch (err) {
        console.error('⚠️  Error cargando tenant cache, usando fallback BSL:', err.message);
        // Si falla el cache (ej. tabla tenants no existe todavía en primer arranque),
        // dejamos que el middleware use BSL_FALLBACK sin bloquear nada.
        tenantCache = { byId: new Map(), byHostname: new Map() };
        tenantCacheExpiry = Date.now() + 5000; // retry pronto
    }
}

async function getTenantCache() {
    if (!tenantCache || Date.now() > tenantCacheExpiry) {
        await loadTenantCache();
    }
    return tenantCache;
}

function invalidateTenantCache() {
    tenantCache = null;
    tenantCacheExpiry = 0;
}

/**
 * Resuelve el tenant para un request (sin montarlo aún en req).
 * Útil para contextos fuera del ciclo HTTP (ej. crons, webhooks).
 */
async function resolveTenant({ hostname, headerTenantId } = {}) {
    const cache = await getTenantCache();

    // 1. Header explícito (mayor prioridad)
    if (headerTenantId) {
        const t = cache.byId.get(headerTenantId);
        if (t) return t;
    }

    // 2. Hostname
    if (hostname) {
        const normalized = hostname.toLowerCase();
        const t = cache.byHostname.get(normalized);
        if (t) return t;
    }

    // 3. Fallback a BSL (único tenant activo durante la migración)
    const bslFromCache = cache.byId.get('bsl');
    if (bslFromCache) return bslFromCache;

    // 4. Último fallback hardcoded (si la tabla tenants aún no tiene BSL, ej. primer arranque)
    return BSL_FALLBACK;
}

/**
 * Middleware Express. Monta req.tenant.
 */
async function tenantMiddleware(req, res, next) {
    try {
        const headerTenantId = req.headers['x-tenant-id'];
        const hostname = req.hostname || (req.headers.host || '').split(':')[0];

        const tenant = await resolveTenant({ hostname, headerTenantId });
        req.tenant = tenant;

        next();
    } catch (err) {
        console.error('Error en tenantMiddleware:', err);
        // Zero-regression: si algo falla, servimos BSL para no romper producción
        req.tenant = BSL_FALLBACK;
        next();
    }
}

module.exports = {
    tenantMiddleware,
    resolveTenant,
    invalidateTenantCache,
    BSL_FALLBACK
};
