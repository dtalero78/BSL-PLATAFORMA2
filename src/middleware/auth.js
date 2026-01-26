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
    requireAdminOrSupervisor
};
