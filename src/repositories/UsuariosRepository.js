const BaseRepository = require('./BaseRepository');

/**
 * Repository para la tabla usuarios
 * Métodos específicos para gestión de usuarios y autenticación
 */
class UsuariosRepository extends BaseRepository {
    constructor() {
        super('usuarios');
    }

    /**
     * Busca usuario por email
     * @param {string} email
     * @returns {Promise<Object|null>}
     */
    async findByEmail(email) {
        return await this.findOne({ email });
    }

    /**
     * Busca usuario por username
     * @param {string} username
     * @returns {Promise<Object|null>}
     */
    async findByUsername(username) {
        return await this.findOne({ username });
    }

    /**
     * Busca usuarios por rol
     * @param {string} role - Rol del usuario (ADMIN, MEDICO, APROBADOR, EMPRESA, etc.)
     * @param {Object} options - {limit, offset, orderBy, orderDir}
     * @returns {Promise<Array>}
     */
    async findByRole(role, options = {}) {
        const defaultOptions = {
            orderBy: 'nombre',
            orderDir: 'ASC',
            ...options
        };
        return await this.findAll({ role }, defaultOptions);
    }

    /**
     * Busca usuarios activos
     * @param {Object} options - {limit, offset, orderBy, orderDir}
     * @returns {Promise<Array>}
     */
    async findActivos(options = {}) {
        const defaultOptions = {
            orderBy: 'nombre',
            orderDir: 'ASC',
            ...options
        };
        return await this.findAll({ activo: true }, defaultOptions);
    }

    /**
     * Busca usuarios inactivos
     * @param {Object} options - {limit, offset, orderBy, orderDir}
     * @returns {Promise<Array>}
     */
    async findInactivos(options = {}) {
        const defaultOptions = {
            orderBy: 'nombre',
            orderDir: 'ASC',
            ...options
        };
        return await this.findAll({ activo: false }, defaultOptions);
    }

    /**
     * Activa un usuario
     * @param {string|number} id
     * @returns {Promise<Object|null>}
     */
    async activateUser(id) {
        return await this.update(id, { activo: true }, 'id');
    }

    /**
     * Desactiva un usuario
     * @param {string|number} id
     * @returns {Promise<Object|null>}
     */
    async deactivateUser(id) {
        return await this.update(id, { activo: false }, 'id');
    }

    /**
     * Actualiza la contraseña de un usuario
     * @param {string|number} id
     * @param {string} hashedPassword - Contraseña ya hasheada
     * @returns {Promise<Object|null>}
     */
    async actualizarPassword(id, hashedPassword) {
        return await this.update(id, { password: hashedPassword }, 'id');
    }

    /**
     * Actualiza los permisos de un usuario
     * @param {string|number} id
     * @param {Array} permisos - Array de permisos
     * @returns {Promise<Object|null>}
     */
    async actualizarPermisos(id, permisos) {
        return await this.update(id, { permisos }, 'id');
    }

    /**
     * Busca usuarios por rol y empresa
     * @param {string} role
     * @param {string} codEmpresa
     * @param {Object} options - {limit, offset}
     * @returns {Promise<Array>}
     */
    async findByRoleAndEmpresa(role, codEmpresa, options = {}) {
        const { limit = 100, offset = 0 } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "role" = $1 AND "cod_empresa" = $2
            ORDER BY "nombre" ASC
            LIMIT $3 OFFSET $4
        `;

        const result = await this.query(query, [role, codEmpresa, limit, offset]);
        return result.rows;
    }

    /**
     * Busca usuarios con búsqueda general
     * @param {string} buscar - Término de búsqueda
     * @param {Object} options - {limit, offset, role}
     * @returns {Promise<Array>}
     */
    async buscar(buscar, options = {}) {
        const { limit = 100, offset = 0, role } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE (
                COALESCE("nombre", '') || ' ' ||
                COALESCE("email", '') || ' ' ||
                COALESCE("username", '')
            ) ILIKE $1
        `;

        const params = [`%${buscar}%`];
        let paramIndex = 2;

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

    /**
     * Cuenta usuarios por rol
     * @param {string} role
     * @returns {Promise<number>}
     */
    async countByRole(role) {
        return await this.count({ role });
    }

    /**
     * Verifica si un email ya está en uso (para registro)
     * @param {string} email
     * @param {string|number} excludeId - ID a excluir (para edición)
     * @returns {Promise<boolean>}
     */
    async emailExists(email, excludeId = null) {
        let query = `SELECT COUNT(*) FROM ${this.tableName} WHERE "email" = $1`;
        const params = [email];

        if (excludeId) {
            query += ` AND "id" != $2`;
            params.push(excludeId);
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count) > 0;
    }

    /**
     * Verifica si un username ya está en uso
     * @param {string} username
     * @param {string|number} excludeId - ID a excluir (para edición)
     * @returns {Promise<boolean>}
     */
    async usernameExists(username, excludeId = null) {
        let query = `SELECT COUNT(*) FROM ${this.tableName} WHERE "username" = $1`;
        const params = [username];

        if (excludeId) {
            query += ` AND "id" != $2`;
            params.push(excludeId);
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count) > 0;
    }

    /**
     * Crea un usuario con validaciones
     * @param {Object} userData
     * @returns {Promise<Object>}
     */
    async crearUsuario(userData) {
        const { email, username } = userData;

        // Validar email único
        const emailExiste = await this.emailExists(email);
        if (emailExiste) {
            throw new Error('El email ya está registrado');
        }

        // Validar username único
        const usernameExiste = await this.usernameExists(username);
        if (usernameExiste) {
            throw new Error('El username ya está en uso');
        }

        // Crear usuario
        return await this.create(userData);
    }
}

module.exports = new UsuariosRepository();
