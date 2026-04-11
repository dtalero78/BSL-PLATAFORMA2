const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../config/database');
const { authMiddleware, requireSuperAdmin, hashPassword } = require('../middleware/auth');
const { subirLogoTenantASpaces } = require('../services/spaces-upload');
const { invalidateTenantCache } = require('../middleware/tenant');

// Multer en memoria, 5MB max por logo
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// Validación del id de tenant: solo letras, números, guiones bajos; 3-30 chars
function validarTenantId(id) {
    if (!id || typeof id !== 'string') return false;
    return /^[a-zA-Z0-9_]{3,30}$/.test(id);
}

// ============================================================
// GET /api/tenants/config - Config pública del tenant actual (sin auth)
// Usado por el frontend (sidebar, login) para branding dinámico según hostname.
// Devuelve SOLO datos públicos (nombre, logo, módulos); nunca credenciales.
// ============================================================
router.get('/config', (req, res) => {
    const t = req.tenant;
    if (!t) {
        return res.json({ success: true, tenant: null });
    }
    res.json({
        success: true,
        tenant: {
            id: t.id,
            nombre: t.nombre,
            logo_url: t.config?.logo_url || null,
            modulos_activos: t.config?.modulos_activos || []
        }
    });
});

// ============================================================
// GET /api/tenants - Listar todos los tenants (super-admin only)
// ============================================================
router.get('/', authMiddleware, requireSuperAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, nombre, hostnames, config, activo, created_at
            FROM tenants
            ORDER BY created_at DESC
        `);

        res.json({
            success: true,
            tenants: result.rows,
            total: result.rows.length
        });
    } catch (error) {
        console.error('❌ Error listando tenants:', error);
        res.status(500).json({ success: false, message: 'Error al listar tenants' });
    }
});

// ============================================================
// GET /api/tenants/:id - Detalle de un tenant
// ============================================================
router.get('/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT id, nombre, hostnames, config, activo, created_at FROM tenants WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tenant no encontrado' });
        }

        res.json({ success: true, tenant: result.rows[0] });
    } catch (error) {
        console.error('❌ Error obteniendo tenant:', error);
        res.status(500).json({ success: false, message: 'Error al obtener tenant' });
    }
});

// ============================================================
// POST /api/tenants - Crear nuevo tenant + usuario admin inicial
// ============================================================
// Body multipart/form-data:
//   - id (required)
//   - nombre (required)
//   - hostnames (required, comma-separated)
//   - modulos (optional, JSON array de strings)
//   - admin_email (required)
//   - admin_password (required, min 6 chars)
//   - admin_nombre (required)
//   - logo (optional, file)
router.post('/', authMiddleware, requireSuperAdmin, upload.single('logo'), async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            id,
            nombre,
            hostnames,
            modulos,
            admin_email,
            admin_password,
            admin_nombre
        } = req.body;

        // Validaciones
        if (!validarTenantId(id)) {
            return res.status(400).json({
                success: false,
                message: 'ID de tenant inválido (3-30 caracteres alfanuméricos y guión bajo)'
            });
        }

        if (!nombre || nombre.trim().length < 3) {
            return res.status(400).json({ success: false, message: 'Nombre es requerido' });
        }

        if (!hostnames || hostnames.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'Al menos un hostname es requerido' });
        }

        if (!admin_email || !admin_password || !admin_nombre) {
            return res.status(400).json({
                success: false,
                message: 'Datos del administrador inicial son requeridos (email, password, nombre)'
            });
        }

        if (admin_password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password del administrador debe tener al menos 6 caracteres'
            });
        }

        // Parsear hostnames (comma-separated → array)
        const hostnamesArray = hostnames.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
        if (hostnamesArray.length === 0) {
            return res.status(400).json({ success: false, message: 'Al menos un hostname válido es requerido' });
        }

        // Parsear módulos
        let modulosArray = [];
        if (modulos) {
            try {
                modulosArray = typeof modulos === 'string' ? JSON.parse(modulos) : modulos;
                if (!Array.isArray(modulosArray)) modulosArray = [];
            } catch (e) {
                modulosArray = [];
            }
        }

        await client.query('BEGIN');

        // 1. Verificar que el id no existe
        const existente = await client.query('SELECT id FROM tenants WHERE id = $1', [id]);
        if (existente.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: `Ya existe un tenant con id '${id}'`
            });
        }

        // 2. Verificar que los hostnames no están en uso por otros tenants
        const conflictoHost = await client.query(
            `SELECT id, hostnames FROM tenants WHERE hostnames && $1::text[]`,
            [hostnamesArray]
        );
        if (conflictoHost.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: `Uno o más hostnames ya están en uso por el tenant '${conflictoHost.rows[0].id}'`
            });
        }

        // 3. Subir logo a Spaces si se proporcionó
        let logoUrl = null;
        if (req.file) {
            const mime = req.file.mimetype;
            if (!mime.startsWith('image/')) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El logo debe ser una imagen' });
            }
            try {
                logoUrl = await subirLogoTenantASpaces(req.file.buffer, id, mime);
            } catch (uploadError) {
                await client.query('ROLLBACK');
                console.error('Error subiendo logo:', uploadError);
                return res.status(500).json({ success: false, message: 'Error al subir el logo' });
            }
        }

        // 4. Construir config JSONB con módulos y logo
        const config = {
            usa_wix: false, // Wix es BSL-only
            modulos_activos: modulosArray,
            logo_url: logoUrl
        };

        // 5. Insertar el tenant
        const tenantResult = await client.query(`
            INSERT INTO tenants (id, nombre, hostnames, config, activo, credenciales)
            VALUES ($1, $2, $3, $4::jsonb, TRUE, '{}'::jsonb)
            RETURNING id, nombre, hostnames, config, activo, created_at
        `, [id, nombre.trim(), hostnamesArray, JSON.stringify(config)]);

        // 6. Verificar que el admin_email no existe DENTRO de este tenant
        // (puede existir el mismo email en otro tenant; eso está bien)
        const emailExiste = await client.query(
            'SELECT id FROM usuarios WHERE email = $1 AND tenant_id = $2',
            [admin_email.toLowerCase(), id]
        );
        if (emailExiste.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: 'Ya existe un usuario con ese email en este tenant'
            });
        }

        // 7. Crear el usuario administrador del nuevo tenant
        const passwordHash = await hashPassword(admin_password);
        const adminResult = await client.query(`
            INSERT INTO usuarios (
                email, password_hash, numero_documento, celular_whatsapp, nombre_completo,
                rol, estado, fecha_aprobacion, aprobado_por, tenant_id, activo
            )
            VALUES ($1, $2, $3, $4, $5, 'admin', 'aprobado', NOW(), $6, $7, TRUE)
            RETURNING id, email, nombre_completo, rol, estado, tenant_id
        `, [
            admin_email.toLowerCase(),
            passwordHash,
            'N/A', // numero_documento placeholder
            'N/A', // celular_whatsapp placeholder
            admin_nombre.trim(),
            req.usuario.id,
            id
        ]);

        await client.query('COMMIT');

        // Invalidar cache del middleware de tenant para que reconozca el nuevo hostname
        invalidateTenantCache();

        console.log(`✅ Tenant creado: ${id} (${nombre}) con admin ${admin_email}`);

        res.status(201).json({
            success: true,
            message: 'Tenant creado exitosamente',
            tenant: tenantResult.rows[0],
            admin: adminResult.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('❌ Error creando tenant:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear tenant',
            error: error.message
        });
    } finally {
        client.release();
    }
});

// ============================================================
// PUT /api/tenants/:id - Actualizar tenant (nombre, hostnames, config, logo)
// ============================================================
router.put('/:id', authMiddleware, requireSuperAdmin, upload.single('logo'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, hostnames, modulos, activo } = req.body;

        // Verificar que existe
        const existente = await pool.query('SELECT config FROM tenants WHERE id = $1', [id]);
        if (existente.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tenant no encontrado' });
        }

        const configActual = existente.rows[0].config || {};
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (nombre !== undefined) {
            updates.push(`nombre = $${paramIndex++}`);
            values.push(nombre.trim());
        }

        if (hostnames !== undefined) {
            const hostnamesArray = hostnames.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
            updates.push(`hostnames = $${paramIndex++}`);
            values.push(hostnamesArray);
        }

        // Parsear módulos y mergear con config actual
        let nuevaConfig = { ...configActual };
        if (modulos !== undefined) {
            try {
                const modulosArray = typeof modulos === 'string' ? JSON.parse(modulos) : modulos;
                if (Array.isArray(modulosArray)) {
                    nuevaConfig.modulos_activos = modulosArray;
                }
            } catch (e) { /* ignore */ }
        }

        // Subir nuevo logo si se proporcionó
        if (req.file) {
            if (!req.file.mimetype.startsWith('image/')) {
                return res.status(400).json({ success: false, message: 'El logo debe ser una imagen' });
            }
            try {
                const logoUrl = await subirLogoTenantASpaces(req.file.buffer, id, req.file.mimetype);
                nuevaConfig.logo_url = logoUrl;
            } catch (uploadError) {
                console.error('Error subiendo logo:', uploadError);
                return res.status(500).json({ success: false, message: 'Error al subir el logo' });
            }
        }

        if (modulos !== undefined || req.file) {
            updates.push(`config = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(nuevaConfig));
        }

        if (activo !== undefined) {
            updates.push(`activo = $${paramIndex++}`);
            values.push(activo === 'true' || activo === true);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No hay campos para actualizar' });
        }

        values.push(id);
        const query = `
            UPDATE tenants
            SET ${updates.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING id, nombre, hostnames, config, activo, created_at
        `;

        const result = await pool.query(query, values);

        invalidateTenantCache();
        console.log(`✅ Tenant actualizado: ${id}`);

        res.json({
            success: true,
            message: 'Tenant actualizado exitosamente',
            tenant: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error actualizando tenant:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar tenant' });
    }
});

module.exports = router;
