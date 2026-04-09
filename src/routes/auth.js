const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { hashToken, generarToken, hashPassword, verificarPassword, obtenerPermisosUsuario, authMiddleware, JWT_SECRET } = require('../middleware/auth');
const { sendWhapiMessage } = require('../services/whapi');

// POST /registro - Registro de nuevo usuario
router.post('/registro', async (req, res) => {
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
            sendWhapiMessage(celularFormateado, mensajeWhatsApp);
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

// POST /login - Iniciar sesión
router.post('/login', async (req, res) => {
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

// POST /logout - Cerrar sesión
router.post('/logout', authMiddleware, async (req, res) => {
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

// POST /verificar-token - Verificar si un token es válido
router.post('/verificar-token', async (req, res) => {
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

// GET /perfil - Obtener perfil del usuario actual
router.get('/perfil', authMiddleware, async (req, res) => {
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

// GET /mis-permisos - Obtener permisos del usuario autenticado
router.get('/mis-permisos', authMiddleware, async (req, res) => {
    try {
        const permisos = await obtenerPermisosUsuario(req.usuario.id);

        res.json({
            success: true,
            permisos: permisos
        });

    } catch (error) {
        console.error('Error obteniendo permisos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener permisos',
            permisos: []
        });
    }
});

module.exports = router;
