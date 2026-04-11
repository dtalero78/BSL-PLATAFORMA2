const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'bsl-secret-default-cambiar';
const JWT_EXPIRES_IN = '24h';

// Función para hashear token
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// Función para generar token JWT
// Multi-tenant: el claim tenant_id viaja en el token. Default 'bsl' para zero-regression
// (tokens generados antes del cambio también son válidos — al decodificarse, tenant_id ausente
// se trata como 'bsl' en el authMiddleware).
function generarToken(userId, extra = {}) {
    const payload = { userId, tenant_id: extra.tenant_id || 'bsl', ...extra };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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

// Función para obtener permisos de un usuario.
// Multi-tenant: filtra por tenant_id para defense-in-depth. Aunque usuario.id es
// único global, la tabla permisos_usuario tiene tenant_id y debe respetarse.
async function obtenerPermisosUsuario(userId, tenantId = 'bsl') {
    try {
        const result = await pool.query(`
            SELECT permiso FROM permisos_usuario
            WHERE usuario_id = $1 AND activo = true AND tenant_id = $2
        `, [userId, tenantId]);

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

        // Verificar que la sesión siga activa en la base de datos.
        // Multi-tenant: traemos u.tenant_id como fuente de verdad (la BD es autoritativa,
        // no el JWT). Filtrar por tenant en la query también previene que un token de un
        // tenant resuelva sesión cruzada si por alguna razón el hashToken colisionara.
        const reqTenantId = (req.tenant && req.tenant.id) || null;
        const sesionResult = await pool.query(`
            SELECT s.*, u.estado, u.rol, u.cod_empresa, u.nombre_completo, u.email, u.numero_documento, u.empresas_excluidas, u.tenant_id AS user_tenant_id
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

        // Multi-tenant: la BD es la fuente de verdad para tenant_id (no el JWT).
        // Esto previene escalación si alguien manipulara el claim del token o si tokens
        // legacy sin claim cayeran en el fallback débil 'bsl'.
        const dbTenantId = sesion.user_tenant_id || 'bsl';

        // Si el JWT trae tenant_id explícito y NO coincide con la BD → token corrupto/stale.
        if (decoded.tenant_id && decoded.tenant_id !== dbTenantId) {
            return res.status(403).json({
                success: false,
                message: 'Token no válido para este usuario',
                code: 'TENANT_MISMATCH'
            });
        }

        // Si el hostname resolvió un tenant y NO coincide con el del usuario → cross-domain.
        // (Evita que un usuario de tenant A use su token en el dominio de tenant B.)
        if (reqTenantId && reqTenantId !== dbTenantId) {
            return res.status(403).json({
                success: false,
                message: 'Token no válido para este dominio',
                code: 'TENANT_MISMATCH'
            });
        }

        req.usuario = {
            id: decoded.userId,
            email: sesion.email,
            rol: sesion.rol,
            nombreCompleto: sesion.nombre_completo,
            codEmpresa: sesion.cod_empresa,
            numeroDocumento: sesion.numero_documento,
            sesionId: sesion.id,
            empresas_excluidas: sesion.empresas_excluidas || [],
            tenant_id: dbTenantId
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

// Middleware para rutas que solo puede usar el super-admin (admin del tenant BSL).
// Previene que admins de otras IPS puedan crear tenants o gestionar el sistema global.
const requireSuperAdmin = (req, res, next) => {
    if (!req.usuario || req.usuario.rol !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado: se requiere rol de administrador'
        });
    }
    // Solo admins del tenant 'bsl' pueden ser super-admin.
    // tenant_id viene de la BD (authMiddleware), nunca del JWT — sin fallback laxo.
    if (req.usuario.tenant_id !== 'bsl') {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado: se requiere super-administrador (BSL)'
        });
    }
    next();
};

module.exports = {
    JWT_SECRET,
    JWT_EXPIRES_IN,
    hashToken,
    generarToken,
    hashPassword,
    verificarPassword,
    obtenerPermisosUsuario,
    authMiddleware,
    requireAdmin,
    requireAdminOrSupervisor,
    requireSuperAdmin
};
