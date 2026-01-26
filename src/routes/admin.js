const express = require('express');
const router = express.Router();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authMiddleware, requireAdmin, JWT_SECRET, hashPassword } = require('../middleware/auth');
const { sendWhatsAppFreeText, sendWhatsAppMedia } = require('../services/whatsapp');

const upload = multer({ storage: multer.memoryStorage() });

// ========== ENDPOINTS DE ADMINISTRACION DE USUARIOS ==========

// GET /usuarios - Listar todos los usuarios
router.get('/usuarios', authMiddleware, requireAdmin, async (req, res) => {
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

// GET /usuarios/pendientes - Listar usuarios pendientes de aprobacion
router.get('/usuarios/pendientes', authMiddleware, requireAdmin, async (req, res) => {
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

// PUT /usuarios/:id/aprobar - Aprobar usuario
router.put('/usuarios/:id/aprobar', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { codEmpresa, rol } = req.body;

        // Obtener informacion del usuario a aprobar
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

        // Validar que se envio un rol
        if (!rol || !['empresa', 'empleado', 'admin', 'usuario_ips'].includes(rol)) {
            return res.status(400).json({
                success: false,
                message: 'Debe especificar un rol valido (empresa, empleado, admin, usuario_ips)'
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
                    message: 'La empresa seleccionada no existe o no esta activa'
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
        console.log(`Usuario aprobado: ${result.rows[0].email} (${result.rows[0].rol})${empresaInfo} (por ${req.usuario.email})`);

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

// PUT /usuarios/:id/rechazar - Rechazar usuario
router.put('/usuarios/:id/rechazar', authMiddleware, requireAdmin, async (req, res) => {
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

        console.log(`Usuario rechazado: ${result.rows[0].email} (por ${req.usuario.email}) - Motivo: ${motivo || 'No especificado'}`);

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

// PUT /usuarios/:id/suspender - Suspender usuario
router.put('/usuarios/:id/suspender', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // No permitir suspenderse a si mismo
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
                message: 'Usuario no encontrado o no esta aprobado'
            });
        }

        // Revocar todas las sesiones activas del usuario
        await pool.query('UPDATE sesiones SET activa = false WHERE usuario_id = $1', [id]);

        console.log(`Usuario suspendido: ${result.rows[0].email} (por ${req.usuario.email})`);

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

// PUT /usuarios/:id/reactivar - Reactivar usuario suspendido o rechazado
router.put('/usuarios/:id/reactivar', authMiddleware, requireAdmin, async (req, res) => {
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
                message: 'Usuario no encontrado o no esta suspendido/rechazado'
            });
        }

        console.log(`Usuario reactivado: ${result.rows[0].email} (por ${req.usuario.email})`);

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
    { codigo: 'VER_ORDENES', nombre: 'Ver Ordenes', descripcion: 'Ver lista y detalles de ordenes medicas' },
    { codigo: 'CREAR_ORDEN', nombre: 'Crear Orden', descripcion: 'Crear nuevas ordenes medicas' },
    { codigo: 'EDITAR_ORDEN', nombre: 'Editar Orden', descripcion: 'Modificar ordenes existentes' },
    { codigo: 'DUPLICAR_ORDEN', nombre: 'Duplicar Orden', descripcion: 'Duplicar ordenes existentes' },
    { codigo: 'DESCARGAR_CERTIFICADO', nombre: 'Descargar Certificado (Modal)', descripcion: 'Descargar certificado PDF desde el modal de detalles del paciente' },
    { codigo: 'DESCARGAR_CERTIFICADO_TABLA', nombre: 'Descargar Certificado (Tabla)', descripcion: 'Descargar certificado PDF desde la tabla de ordenes' },
    { codigo: 'VER_ESTADISTICAS', nombre: 'Ver Estadisticas', descripcion: 'Ver tarjetas de estadisticas' },
    { codigo: 'VER_RESULTADOS_MEDICOS', nombre: 'Ver Resultados Medicos', descripcion: 'Ver seccion de resultados medicos en detalles del paciente' },
    { codigo: 'APROBADOR', nombre: 'Aprobador', descripcion: 'Aprobar o rechazar certificados medicos atendidos' },
    { codigo: 'PREGUNTA_LO_QUE_QUIERAS', nombre: 'Pregunta lo que quieras', descripcion: 'Acceder a la seccion de analisis con IA' }
];

// Lista de permisos disponibles para panel-ordenes (rol: empleado)
const PERMISOS_EMPLEADO = [
    // Navegacion/Secciones
    { codigo: 'EMP_VER_ORDENES', nombre: 'Ver Ordenes', descripcion: 'Acceder a la lista de ordenes', categoria: 'Navegacion' },
    { codigo: 'EMP_NUEVA_ORDEN', nombre: 'Nueva Orden', descripcion: 'Acceder a crear nueva orden', categoria: 'Navegacion' },
    { codigo: 'EMP_SUBIR_LOTE', nombre: 'Subir Lote', descripcion: 'Acceder a carga masiva de ordenes', categoria: 'Navegacion' },
    { codigo: 'EMP_CALENDARIO', nombre: 'Calendario', descripcion: 'Acceder al calendario de citas', categoria: 'Navegacion' },
    { codigo: 'EMP_MEDICOS', nombre: 'Medicos', descripcion: 'Acceder a gestion de medicos', categoria: 'Navegacion' },
    { codigo: 'EMP_EXAMENES', nombre: 'Examenes', descripcion: 'Acceder a gestion de examenes', categoria: 'Navegacion' },
    { codigo: 'EMP_EMPRESAS', nombre: 'Empresas', descripcion: 'Acceder a gestion de empresas', categoria: 'Navegacion' },
    // Acciones sobre ordenes
    { codigo: 'EMP_VER_DETALLES', nombre: 'Ver Detalles', descripcion: 'Ver detalles completos de una orden', categoria: 'Acciones' },
    { codigo: 'EMP_EDITAR_ORDEN', nombre: 'Editar Orden', descripcion: 'Modificar datos de una orden', categoria: 'Acciones' },
    { codigo: 'EMP_ELIMINAR_ORDEN', nombre: 'Eliminar Orden', descripcion: 'Eliminar ordenes individuales o masivas', categoria: 'Acciones' },
    { codigo: 'EMP_MARCAR_PAGADO', nombre: 'Marcar Pagado', descripcion: 'Cambiar estado de pago de ordenes', categoria: 'Acciones' },
    { codigo: 'EMP_ENVIAR_LINK', nombre: 'Enviar Link', descripcion: 'Enviar link de prueba por WhatsApp', categoria: 'Acciones' },
    { codigo: 'EMP_ASIGNAR_MEDICO', nombre: 'Asignar Medico', descripcion: 'Asignar medico a una orden', categoria: 'Acciones' },
    { codigo: 'EMP_CAMBIAR_ESTADO', nombre: 'Cambiar Estado', descripcion: 'Modificar estado de la orden', categoria: 'Acciones' },
    { codigo: 'EMP_MODIFICAR_EXAMENES', nombre: 'Modificar Examenes', descripcion: 'Agregar o quitar examenes de una orden', categoria: 'Acciones' },
    { codigo: 'EMP_ENLAZAR_FORMULARIO', nombre: 'Enlazar Formulario', descripcion: 'Vincular orden con formulario medico', categoria: 'Acciones' }
];

// GET /permisos/disponibles - Obtener lista de permisos disponibles
// Query param: tipo = 'empresa' | 'empleado' (default: empresa)
router.get('/permisos/disponibles', authMiddleware, requireAdmin, (req, res) => {
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

// GET /usuarios/:id - Obtener datos de un usuario especifico
router.get('/usuarios/:id', authMiddleware, requireAdmin, async (req, res) => {
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

// GET /usuarios/:id/permisos - Obtener permisos de un usuario
router.get('/usuarios/:id/permisos', authMiddleware, requireAdmin, async (req, res) => {
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

// PUT /usuarios/:id/permisos - Actualizar permisos de un usuario
router.put('/usuarios/:id/permisos', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { permisos } = req.body; // Array de codigos de permisos activos

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
                message: `Permisos invalidos: ${permisosInvalidos.join(', ')}`
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

        console.log(`Permisos actualizados para usuario ${id}: [${permisos.join(', ')}] (por ${req.usuario.email})`);

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

// PUT /usuarios/:id/cod-empresa - Actualizar cod_empresa de un usuario
router.put('/usuarios/:id/cod-empresa', authMiddleware, requireAdmin, async (req, res) => {
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

        // Validar que el codEmpresa no este vacio si el rol es empresa
        if (usuario.rol === 'empresa' && !codEmpresa) {
            return res.status(400).json({
                success: false,
                message: 'El codigo de empresa es requerido para usuarios de tipo Empresa'
            });
        }

        // Actualizar cod_empresa
        await pool.query(
            'UPDATE usuarios SET cod_empresa = $1 WHERE id = $2',
            [codEmpresa || null, id]
        );

        console.log(`Codigo de empresa actualizado para usuario ${id} (${usuario.email}): ${codEmpresa || 'NULL'} (por ${req.usuario.email})`);

        res.json({
            success: true,
            message: 'Codigo de empresa actualizado correctamente',
            codEmpresa: codEmpresa
        });

    } catch (error) {
        console.error('Error actualizando codigo de empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar codigo de empresa'
        });
    }
});

// ============ FIN ENDPOINTS DE PERMISOS ============

// POST /usuarios - Crear usuario directamente (ya aprobado)
router.post('/usuarios', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { email, password, numeroDocumento, celularWhatsapp, nombreCompleto, codEmpresa, rol = 'empresa' } = req.body;

        // Validaciones
        if (!email || !password || !numeroDocumento || !celularWhatsapp) {
            return res.status(400).json({
                success: false,
                message: 'Email, contrasena, numero de documento y celular son requeridos'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'La contrasena debe tener al menos 8 caracteres'
            });
        }

        if (!['empresa', 'admin'].includes(rol)) {
            return res.status(400).json({
                success: false,
                message: 'Rol invalido. Debe ser "empresa" o "admin"'
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
                message: 'Ya existe un usuario con ese email o numero de documento'
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

        console.log(`Usuario creado por admin: ${email} (${rol})`);

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

// GET /tablas - Listar todas las tablas de la base de datos
router.get('/tablas', authMiddleware, requireAdmin, async (req, res) => {
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

// GET /tablas/:nombre/estructura - Obtener estructura de una tabla
router.get('/tablas/:nombre/estructura', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { nombre } = req.params;

        // Validar nombre de tabla para evitar inyeccion SQL
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

// GET /tablas/:nombre/datos - Obtener datos de una tabla con paginacion
router.get('/tablas/:nombre/datos', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { nombre } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const orderBy = req.query.orderBy || 'id';
        const orderDir = req.query.orderDir === 'asc' ? 'ASC' : 'DESC';
        const buscar = req.query.buscar || '';

        // Validar nombre de tabla para evitar inyeccion SQL
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

        // Verificar que orderBy sea una columna valida
        const columnasValidas = columnas.map(c => c.column_name);
        const orderColumn = columnasValidas.includes(orderBy) ? orderBy :
            (columnasValidas.includes('id') ? 'id' : columnasValidas[0]);

        // Construir query de busqueda
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

// GET /whatsapp/conversaciones - Listar todas las conversaciones de WhatsApp con ultimo mensaje
router.get('/whatsapp/conversaciones', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const busqueda = req.query.busqueda || '';
        const mostrarTodas = req.query.todas === 'true';

        // Construir WHERE condicional
        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        // Si NO esta buscando y NO quiere ver todas, solo mostrar conversaciones con mensajes no leidos
        if (!busqueda && !mostrarTodas) {
            whereConditions.push(`
                EXISTS (
                    SELECT 1 FROM mensajes_whatsapp m
                    WHERE m.conversacion_id = c.id
                    AND m.direccion = 'entrante'
                    AND m.leido_por_agente = false
                )
            `);
        }

        // Si esta buscando, agregar filtro de busqueda
        if (busqueda) {
            whereConditions.push(`
                (c.nombre_paciente ILIKE $${paramIndex}
                 OR c.celular ILIKE $${paramIndex}
                 OR EXISTS (
                    SELECT 1 FROM mensajes_whatsapp m2
                    WHERE m2.conversacion_id = c.id
                    AND m2.contenido ILIKE $${paramIndex}
                 ))
            `);
            queryParams.push(`%${busqueda}%`);
            paramIndex++;
        }

        const whereClause = whereConditions.length > 0
            ? `WHERE ${whereConditions.join(' AND ')}`
            : '';

        const query = `
            WITH unread_counts AS (
                -- Pre-calcular conteo de mensajes no leidos por conversacion
                SELECT
                    conversacion_id,
                    COUNT(*)::int as no_leidos
                FROM mensajes_whatsapp
                WHERE direccion = 'entrante'
                  AND leido_por_agente = false
                GROUP BY conversacion_id
            ),
            last_messages AS (
                -- Pre-calcular ultimo mensaje por conversacion
                SELECT DISTINCT ON (conversacion_id)
                    conversacion_id,
                    json_build_object(
                        'contenido', contenido,
                        'direccion', direccion,
                        'fecha_envio', timestamp
                    ) as ultimo_mensaje
                FROM mensajes_whatsapp
                ORDER BY conversacion_id, timestamp DESC
            ),
            conversaciones_filtradas AS (
                -- Primero filtrar conversaciones
                SELECT *
                FROM conversaciones_whatsapp c
                ${whereClause}
                ORDER BY
                    c.fecha_ultima_actividad DESC
                LIMIT ${mostrarTodas ? 15 : 100}
            ),
            company_codes AS (
                -- Solo buscar codigos de empresa para las conversaciones filtradas
                -- Normalizar: quitar + y prefijo 57, dejando solo los 10 digitos del celular
                SELECT DISTINCT ON (celular_normalizado)
                    REGEXP_REPLACE(
                        REPLACE(REPLACE("celular", '+', ''), ' ', ''),
                        '^57',
                        ''
                    ) as celular_normalizado,
                    "codEmpresa",
                    atendido
                FROM "HistoriaClinica"
                WHERE "celular" IS NOT NULL
                  AND "celular" != ''
                  AND REGEXP_REPLACE(
                      REPLACE(REPLACE("celular", '+', ''), ' ', ''),
                      '^57',
                      ''
                  ) IN (
                      SELECT REGEXP_REPLACE(
                          REPLACE(REPLACE(celular, '+', ''), ' ', ''),
                          '^57',
                          ''
                      )
                      FROM conversaciones_filtradas
                  )
                ORDER BY celular_normalizado, "_createdDate" DESC
            )
            SELECT
                c.id,
                c.celular as numero_cliente,
                c.nombre_paciente as nombre_cliente,
                c.estado_actual as estado,
                c.agente_asignado as agente_id,
                c.fecha_inicio,
                c.fecha_ultima_actividad,
                COALESCE(u.no_leidos, 0) as no_leidos,
                c.bot_activo,
                c."stopBot",
                c.agente_asignado as agente_nombre,
                lm.ultimo_mensaje,
                cc."codEmpresa" as cod_empresa,
                cc.atendido as estado_atencion
            FROM conversaciones_filtradas c
            LEFT JOIN unread_counts u ON u.conversacion_id = c.id
            LEFT JOIN last_messages lm ON lm.conversacion_id = c.id
            LEFT JOIN company_codes cc ON cc.celular_normalizado = REGEXP_REPLACE(
                REPLACE(REPLACE(c.celular, '+', ''), ' ', ''),
                '^57',
                ''
            )
            ORDER BY
                COALESCE(u.no_leidos, 0) > 0 DESC,
                c.fecha_ultima_actividad DESC
        `;

        const result = await pool.query(query, queryParams);
        res.json({ success: true, conversaciones: result.rows });
    } catch (error) {
        console.error('Error al obtener conversaciones WhatsApp:', error);
        res.status(500).json({ success: false, message: 'Error al obtener conversaciones' });
    }
});

// GET /whatsapp/conversaciones/:id/mensajes - Obtener mensajes de una conversacion especifica (con paginacion)
router.get('/whatsapp/conversaciones/:id/mensajes', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const limit = parseInt(req.query.limit) || 50; // Por defecto 50 mensajes
        const offset = parseInt(req.query.offset) || 0;

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
            ORDER BY timestamp DESC
            LIMIT $2 OFFSET $3
        `;

        const result = await pool.query(query, [id, limit, offset]);

        // Obtener el total de mensajes para saber si hay mas
        const countQuery = 'SELECT COUNT(*)::int as total FROM mensajes_whatsapp WHERE conversacion_id = $1';
        const countResult = await pool.query(countQuery, [id]);
        const total = countResult.rows[0].total;

        // Marcar todos los mensajes entrantes de esta conversacion como leidos (sin bloquear la respuesta)
        pool.query(`
            UPDATE mensajes_whatsapp
            SET leido_por_agente = true,
                fecha_lectura = NOW()
            WHERE conversacion_id = $1
              AND direccion = 'entrante'
              AND leido_por_agente = false
        `, [id]).catch(err => console.error('Error marking messages as read:', err));

        // Invertir el orden para mostrar mas antiguos primero (el query DESC trae los mas recientes)
        const mensajes = result.rows.reverse();

        res.json({
            success: true,
            mensajes: mensajes,
            total: total,
            hasMore: (offset + limit) < total
        });
    } catch (error) {
        console.error('Error al obtener mensajes:', error);
        res.status(500).json({ success: false, message: 'Error al obtener mensajes' });
    }
});

// GET /whatsapp/media/proxy - Proxy para media de Twilio (autenticacion por header o query param)
router.get('/whatsapp/media/proxy', async (req, res) => {
    try {
        const { url, token } = req.query;

        if (!url) {
            return res.status(400).json({ success: false, message: 'URL no proporcionada' });
        }

        // Validar que la URL sea de Twilio
        if (!url.startsWith('https://api.twilio.com/')) {
            return res.status(400).json({ success: false, message: 'URL no valida' });
        }

        // Autenticacion: token en query param o en header
        let authenticated = false;

        // Intentar autenticacion por header primero
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const headerToken = authHeader.substring(7);
            try {
                jwt.verify(headerToken, JWT_SECRET);
                authenticated = true;
            } catch (err) {
                // Token invalido en header
            }
        }

        // Si no esta autenticado por header, intentar por query param
        if (!authenticated && token) {
            try {
                jwt.verify(token, JWT_SECRET);
                authenticated = true;
            } catch (err) {
                return res.status(401).json({ success: false, message: 'Token invalido' });
            }
        }

        if (!authenticated) {
            return res.status(401).json({ success: false, message: 'Token de autenticacion requerido' });
        }

        console.log('Proxying media from Twilio:', url);

        // Fetch con autenticacion basica de Twilio
        const response = await fetch(url, {
            headers: {
                'Authorization': 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
            }
        });

        if (!response.ok) {
            console.error('Error fetching media from Twilio:', response.status, response.statusText);
            return res.status(response.status).json({ success: false, message: 'Error al obtener media de Twilio' });
        }

        // Obtener el tipo de contenido
        const contentType = response.headers.get('content-type');

        // Pipe la respuesta directamente al cliente
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache por 1 ano

        // Stream la respuesta
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));

    } catch (error) {
        console.error('Error al proxear media:', error);
        res.status(500).json({ success: false, message: 'Error al obtener archivo multimedia' });
    }
});

// POST /whatsapp/conversaciones/:id/mensajes - Enviar mensaje en una conversacion
router.post('/whatsapp/conversaciones/:id/mensajes', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { contenido } = req.body;

        // Obtener numero del cliente de la conversacion
        const convResult = await pool.query(`
            SELECT celular FROM conversaciones_whatsapp WHERE id = $1
        `, [id]);

        if (convResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Conversacion no encontrada' });
        }

        const numeroCliente = convResult.rows[0].celular;

        // Enviar mensaje via Twilio (texto libre para conversaciones)
        // NOTA: sendWhatsAppFreeText() ya guarda el mensaje automaticamente via guardarMensajeSaliente()
        const twilioResult = await sendWhatsAppFreeText(numeroCliente, contenido);

        if (!twilioResult.success) {
            return res.status(500).json({
                success: false,
                message: 'Error al enviar mensaje',
                error: twilioResult.error
            });
        }

        // El mensaje ya fue guardado por sendWhatsAppFreeText() -> guardarMensajeSaliente()
        // No necesitamos guardar aqui para evitar duplicados

        // Emitir evento WebSocket para actualizacion en tiempo real
        // (ya se emitio en guardarMensajeSaliente(), pero lo hacemos de nuevo por compatibilidad)
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

        // OPTIMIZACION: Incluir datos actualizados en respuesta para evitar peticiones adicionales
        const ahora = new Date();
        res.json({
            success: true,
            mensaje: {
                conversacion_id: parseInt(id),
                contenido: contenido,
                direccion: 'saliente',
                sid_twilio: twilioResult.sid,
                tipo_mensaje: 'text',
                timestamp: ahora,
                fecha_envio: ahora
            },
            conversacion_actualizada: {
                id: parseInt(id),
                fecha_ultima_actividad: ahora,
                ultimo_mensaje: {
                    contenido: contenido,
                    direccion: 'saliente',
                    fecha_envio: ahora
                }
            },
            twilio: twilioResult
        });
    } catch (error) {
        console.error('Error al enviar mensaje WhatsApp:', error);
        res.status(500).json({ success: false, message: 'Error al enviar mensaje' });
    }
});

// GET /whatsapp/conversaciones/:id/paciente - Obtener datos del paciente asociado a una conversacion (para comando /i)
router.get('/whatsapp/conversaciones/:id/paciente', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener numero del cliente de la conversacion
        const convResult = await pool.query(`
            SELECT celular FROM conversaciones_whatsapp WHERE id = $1
        `, [id]);

        if (convResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Conversacion no encontrada' });
        }

        const numeroCliente = convResult.rows[0].celular;

        // Buscar paciente en HistoriaClinica
        const celularLimpio = numeroCliente.replace(/\D/g, '').replace(/^57/, '');
        const celularCon57 = '57' + celularLimpio;
        const celularConPlus = '+57' + celularLimpio;

        const pacienteResult = await pool.query(`
            SELECT
                "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                "fechaAtencion", "horaAtencion", "numeroId"
            FROM "HistoriaClinica"
            WHERE "celular" IN ($1, $2, $3)
            ORDER BY "_createdDate" DESC
            LIMIT 1
        `, [celularLimpio, celularCon57, celularConPlus]);

        if (pacienteResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No se encontro paciente asociado a este numero'
            });
        }

        const paciente = pacienteResult.rows[0];

        res.json({
            success: true,
            paciente: {
                primerNombre: paciente.primerNombre,
                segundoNombre: paciente.segundoNombre,
                primerApellido: paciente.primerApellido,
                segundoApellido: paciente.segundoApellido,
                fechaAtencion: paciente.fechaAtencion,
                horaAtencion: paciente.horaAtencion,
                numeroId: paciente.numeroId
            }
        });
    } catch (error) {
        console.error('Error al obtener datos del paciente:', error);
        res.status(500).json({ success: false, message: 'Error al obtener datos del paciente' });
    }
});

// POST /whatsapp/conversaciones/:id/media - Enviar archivo multimedia en una conversacion
router.post('/whatsapp/conversaciones/:id/media', authMiddleware, requireAdmin, upload.single('file'), async (req, res) => {
    try {
        const { id } = req.params;
        const { contenido } = req.body; // Caption opcional
        const file = req.file;

        if (!file) {
            return res.status(400).json({ success: false, message: 'No se proporciono ningun archivo' });
        }

        // Validar tamano (16MB - limite de Twilio)
        if (file.size > 16 * 1024 * 1024) {
            return res.status(400).json({ success: false, message: 'El archivo excede el tamano maximo de 16MB' });
        }

        // Obtener numero del cliente de la conversacion
        const convResult = await pool.query(`
            SELECT celular FROM conversaciones_whatsapp WHERE id = $1
        `, [id]);

        if (convResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Conversacion no encontrada' });
        }

        const numeroCliente = convResult.rows[0].celular;

        console.log(`Enviando archivo ${file.originalname} (${file.mimetype}, ${file.size} bytes) a ${numeroCliente}`);

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

        const mensajeContenido = contenido || `[Archivo] ${file.originalname}`;

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

        // Actualizar fecha de ultima actividad
        await pool.query(`
            UPDATE conversaciones_whatsapp
            SET fecha_ultima_actividad = NOW()
            WHERE id = $1
        `, [id]);

        // Emitir evento WebSocket para actualizacion en tiempo real
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

// PATCH /whatsapp/conversaciones/:id/estado - Actualizar estado de una conversacion
router.patch('/whatsapp/conversaciones/:id/estado', authMiddleware, requireAdmin, async (req, res) => {
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
            return res.status(404).json({ success: false, message: 'Conversacion no encontrada' });
        }

        res.json({ success: true, conversacion: result.rows[0] });
    } catch (error) {
        console.error('Error al actualizar conversacion:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar conversacion' });
    }
});

// POST /whatsapp/conversaciones/:id/toggle-bot - Toggle del estado del bot (stopBot) para una conversacion
router.post('/whatsapp/conversaciones/:id/toggle-bot', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { stopBot } = req.body;

        const result = await pool.query(`
            UPDATE conversaciones_whatsapp
            SET "stopBot" = $1, fecha_ultima_actividad = NOW()
            WHERE id = $2
            RETURNING id, "stopBot"
        `, [stopBot, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Conversacion no encontrada' });
        }

        console.log(`Bot ${stopBot ? 'DETENIDO' : 'ACTIVADO'} para conversacion ${id}`);

        res.json({
            success: true,
            stopBot: result.rows[0].stopBot,
            message: stopBot ? 'Bot detenido' : 'Bot activado'
        });
    } catch (error) {
        console.error('Error al cambiar estado del bot:', error);
        res.status(500).json({ success: false, message: 'Error al cambiar estado del bot' });
    }
});

// Export permission constants for use in other modules (e.g., /api/auth/mis-permisos)
router.PERMISOS_DISPONIBLES = PERMISOS_DISPONIBLES;
router.PERMISOS_EMPLEADO = PERMISOS_EMPLEADO;

module.exports = router;
