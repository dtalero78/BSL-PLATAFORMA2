/**
 * Helpers para multi-tenancy.
 * Ver CLAUDE.md sección "Multi-Tenant Architecture".
 */

const BSL_TENANT_ID = 'bsl';

/**
 * Verifica si un request pertenece al tenant BSL.
 * Si req.tenant no está montado (ej. código legacy), asume BSL para zero-regression.
 *
 * @param {object} req - Request de Express con req.tenant montado por el tenantMiddleware
 * @returns {boolean}
 */
function isBsl(req) {
    if (!req || !req.tenant) return true; // fallback: tratamos como BSL
    return req.tenant.id === BSL_TENANT_ID;
}

/**
 * Verifica si un tenantId (string) corresponde a BSL.
 * Útil para contextos fuera del ciclo HTTP (servicios, crons).
 *
 * @param {string} tenantId
 * @returns {boolean}
 */
function isBslTenantId(tenantId) {
    // Default: si no se pasa tenantId, asumimos BSL (zero-regression)
    if (!tenantId) return true;
    return tenantId === BSL_TENANT_ID;
}

/**
 * Middleware Express que bloquea la request si el tenant actual no es BSL.
 * Usar en rutas que son exclusivas de BSL (NUBIA, SIIGO, Alegra, SITEL, RIPS):
 *
 *   app.use('/api/nubia', requireBslTenant, nubiaRouter);
 */
function requireBslTenant(req, res, next) {
    if (!isBsl(req)) {
        return res.status(404).json({
            success: false,
            message: 'Recurso no disponible para este tenant'
        });
    }
    next();
}

module.exports = {
    BSL_TENANT_ID,
    isBsl,
    isBslTenantId,
    requireBslTenant
};
