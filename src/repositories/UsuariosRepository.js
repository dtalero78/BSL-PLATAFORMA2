const BaseRepository = require('./BaseRepository');

/**
 * Repository para la tabla usuarios
 * Multi-tenant (ver CLAUDE.md): todos los métodos aceptan tenantId opcional (default 'bsl').
 */
class UsuariosRepository extends BaseRepository {
    constructor() {
        super('usuarios');
    }

    async findByEmail(email, tenantId = 'bsl') {
        return await this.findOne({ email }, { tenantId });
    }

    async findByUsername(username, tenantId = 'bsl') {
        return await this.findOne({ username }, { tenantId });
    }

    async findByRole(role, options = {}) {
        const defaultOptions = {
            orderBy: 'nombre',
            orderDir: 'ASC',
            tenantId: 'bsl',
            ...options
        };
        return await this.findAll({ role }, defaultOptions);
    }

    async findActivos(options = {}) {
        const defaultOptions = {
            orderBy: 'nombre',
            orderDir: 'ASC',
            tenantId: 'bsl',
            ...options
        };
        return await this.findAll({ activo: true }, defaultOptions);
    }

    async findInactivos(options = {}) {
        const defaultOptions = {
            orderBy: 'nombre',
            orderDir: 'ASC',
            tenantId: 'bsl',
            ...options
        };
        return await this.findAll({ activo: false }, defaultOptions);
    }

    async activateUser(id, tenantId = 'bsl') {
        return await this.update(id, { activo: true }, 'id', tenantId);
    }

    async deactivateUser(id, tenantId = 'bsl') {
        return await this.update(id, { activo: false }, 'id', tenantId);
    }

    async actualizarPassword(id, hashedPassword, tenantId = 'bsl') {
        return await this.update(id, { password: hashedPassword }, 'id', tenantId);
    }

    async actualizarPermisos(id, permisos, tenantId = 'bsl') {
        return await this.update(id, { permisos }, 'id', tenantId);
    }

    async findByRoleAndEmpresa(role, codEmpresa, options = {}) {
        const { limit = 100, offset = 0, tenantId = 'bsl' } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "role" = $1 AND "cod_empresa" = $2 AND tenant_id = $3
            ORDER BY "nombre" ASC
            LIMIT $4 OFFSET $5
        `;

        const result = await this.query(query, [role, codEmpresa, tenantId, limit, offset]);
        return result.rows;
    }

    async buscar(buscar, options = {}) {
        const { limit = 100, offset = 0, role, tenantId = 'bsl' } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE (
                COALESCE("nombre", '') || ' ' ||
                COALESCE("email", '') || ' ' ||
                COALESCE("username", '')
            ) ILIKE $1
              AND tenant_id = $2
        `;

        const params = [`%${buscar}%`, tenantId];
        let paramIndex = 3;

        if (role) {
            query += ` AND "role" = $${paramIndex}`;
            params.push(role);
            paramIndex++;
        }

        query += ` ORDER BY "nombre" ASC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await this.query(query, params);
        return result.rows;
    }

    async countByRole(role, tenantId = 'bsl') {
        return await this.count({ role }, { tenantId });
    }

    async emailExists(email, excludeId = null, tenantId = 'bsl') {
        let query = `SELECT COUNT(*) FROM ${this.tableName} WHERE "email" = $1 AND tenant_id = $2`;
        const params = [email, tenantId];

        if (excludeId) {
            query += ` AND "id" != $3`;
            params.push(excludeId);
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count) > 0;
    }

    async usernameExists(username, excludeId = null, tenantId = 'bsl') {
        let query = `SELECT COUNT(*) FROM ${this.tableName} WHERE "username" = $1 AND tenant_id = $2`;
        const params = [username, tenantId];

        if (excludeId) {
            query += ` AND "id" != $3`;
            params.push(excludeId);
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count) > 0;
    }

    async crearUsuario(userData, tenantId = 'bsl') {
        const { email, username } = userData;

        const emailExiste = await this.emailExists(email, null, tenantId);
        if (emailExiste) {
            throw new Error('El email ya está registrado');
        }

        const usernameExiste = await this.usernameExists(username, null, tenantId);
        if (usernameExiste) {
            throw new Error('El username ya está en uso');
        }

        return await this.create(userData, { tenantId });
    }

    /**
     * Lista usuarios con filtros múltiples (para admin)
     */
    async findWithFilters(filters = {}, options = {}) {
        const { estado, rol, buscar } = filters;
        const { limit = 50, offset = 0, tenantId = 'bsl' } = options;

        let query = `
            SELECT id, email, nombre_completo, numero_documento, celular_whatsapp, rol, cod_empresa,
                   estado, fecha_registro, fecha_aprobacion, ultimo_login, activo
            FROM ${this.tableName}
            WHERE tenant_id = $1
        `;
        const params = [tenantId];
        let paramIndex = 2;

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

        const result = await this.query(query, params);
        return result.rows;
    }

    async countWithFilters(filters = {}, tenantId = 'bsl') {
        const { estado, rol, buscar } = filters;

        let query = 'SELECT COUNT(*) FROM usuarios WHERE tenant_id = $1';
        const params = [tenantId];
        let paramIndex = 2;

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
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count);
    }

    async findPendientes(tenantId = 'bsl') {
        const query = `
            SELECT id, email, nombre_completo, numero_documento, celular_whatsapp, cod_empresa, fecha_registro
            FROM ${this.tableName}
            WHERE estado = 'pendiente' AND activo = true AND tenant_id = $1
            ORDER BY fecha_registro ASC
        `;
        const result = await this.query(query, [tenantId]);
        return result.rows;
    }

    async aprobarUsuario(id, aprobadoPor, tenantId = 'bsl') {
        const query = `
            UPDATE ${this.tableName}
            SET estado = 'aprobado',
                fecha_aprobacion = NOW(),
                aprobado_por = $1
            WHERE id = $2 AND tenant_id = $3
            RETURNING *
        `;
        const result = await this.query(query, [aprobadoPor, id, tenantId]);
        return result.rows[0] || null;
    }

    async rechazarUsuario(id, tenantId = 'bsl') {
        const query = `
            UPDATE ${this.tableName}
            SET estado = 'rechazado',
                activo = false
            WHERE id = $1 AND tenant_id = $2
            RETURNING *
        `;
        const result = await this.query(query, [id, tenantId]);
        return result.rows[0] || null;
    }

    async desactivarUsuario(id, tenantId = 'bsl') {
        return await this.transaction(async (client) => {
            // Cerrar sesiones (scoped por tenant)
            await client.query(
                'UPDATE sesiones SET activa = false WHERE usuario_id = $1 AND tenant_id = $2',
                [id, tenantId]
            );

            // Desactivar usuario (scoped por tenant)
            const result = await client.query(
                'UPDATE usuarios SET activo = false WHERE id = $1 AND tenant_id = $2 RETURNING *',
                [id, tenantId]
            );
            return result.rows[0] || null;
        });
    }

    async actualizarCodEmpresa(id, codEmpresa, tenantId = 'bsl') {
        return await this.update(id, { cod_empresa: codEmpresa }, 'id', tenantId);
    }

    async findByEmailOrDocumento(email, numeroDocumento, tenantId = 'bsl') {
        const query = `
            SELECT id FROM ${this.tableName}
            WHERE (email = $1 OR numero_documento = $2)
              AND tenant_id = $3
        `;
        const result = await this.query(query, [email, numeroDocumento, tenantId]);
        return result.rows[0] || null;
    }
}

module.exports = new UsuariosRepository();
