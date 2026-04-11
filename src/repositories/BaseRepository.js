const pool = require('../config/database');

/**
 * Clase base para todos los repositories
 * Proporciona métodos CRUD genéricos con soporte multi-tenant.
 *
 * Multi-tenant (ver CLAUDE.md sección "Multi-Tenant Architecture"):
 *   Todos los métodos aceptan un tenantId (default 'bsl' durante la migración).
 *   El filtro tenant_id se inyecta automáticamente en WHERE/INSERT para
 *   prevenir data leaks entre tenants.
 *
 *   Si una consulta especializada usa this.query() con SQL crudo (ej.
 *   HistoriaClinicaRepository.buscarConFoto), debe incluir tenant_id manualmente.
 */
class BaseRepository {
    constructor(tableName) {
        this.tableName = tableName;
        this.pool = pool;
    }

    /**
     * Encuentra un registro por ID
     * @param {string|number} id
     * @param {string} idColumn - Nombre de la columna ID (default: '_id')
     * @param {string} tenantId - Tenant al que pertenece el registro (default: 'bsl')
     * @returns {Promise<Object|null>}
     */
    async findById(id, idColumn = '_id', tenantId = 'bsl') {
        const query = `SELECT * FROM ${this.tableName} WHERE "${idColumn}" = $1 AND tenant_id = $2`;
        const result = await this.pool.query(query, [id, tenantId]);
        return result.rows[0] || null;
    }

    /**
     * Encuentra todos los registros con filtros opcionales
     * @param {Object} filters - Objeto con filtros {columna: valor}
     * @param {Object} options - {limit, offset, orderBy, orderDir, tenantId}
     * @returns {Promise<Array>}
     */
    async findAll(filters = {}, options = {}) {
        const { limit, offset, orderBy, orderDir = 'ASC', tenantId = 'bsl' } = options;

        // Multi-tenant: inyectar tenant_id si no está explícito en filters
        const mergedFilters = filters.tenant_id !== undefined
            ? filters
            : { ...filters, tenant_id: tenantId };

        let query = `SELECT * FROM ${this.tableName}`;
        const params = [];
        let paramIndex = 1;

        const filterKeys = Object.keys(mergedFilters);
        if (filterKeys.length > 0) {
            const whereClauses = filterKeys.map(key => {
                params.push(mergedFilters[key]);
                return `"${key}" = $${paramIndex++}`;
            });
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        if (orderBy) {
            query += ` ORDER BY "${orderBy}" ${orderDir}`;
        }

        if (limit) {
            query += ` LIMIT $${paramIndex++}`;
            params.push(limit);
        }
        if (offset !== undefined) {
            query += ` OFFSET $${paramIndex++}`;
            params.push(offset);
        }

        const result = await this.pool.query(query, params);
        return result.rows;
    }

    /**
     * Encuentra un registro con filtros
     * @param {Object} filters - Objeto con filtros {columna: valor}
     * @param {Object} options - {tenantId}
     * @returns {Promise<Object|null>}
     */
    async findOne(filters = {}, options = {}) {
        const results = await this.findAll(filters, { ...options, limit: 1 });
        return results[0] || null;
    }

    /**
     * Cuenta registros con filtros opcionales
     * @param {Object} filters - Objeto con filtros {columna: valor}
     * @param {Object} options - {tenantId}
     * @returns {Promise<number>}
     */
    async count(filters = {}, options = {}) {
        const { tenantId = 'bsl' } = options;

        const mergedFilters = filters.tenant_id !== undefined
            ? filters
            : { ...filters, tenant_id: tenantId };

        let query = `SELECT COUNT(*) FROM ${this.tableName}`;
        const params = [];
        let paramIndex = 1;

        const filterKeys = Object.keys(mergedFilters);
        if (filterKeys.length > 0) {
            const whereClauses = filterKeys.map(key => {
                params.push(mergedFilters[key]);
                return `"${key}" = $${paramIndex++}`;
            });
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        const result = await this.pool.query(query, params);
        return parseInt(result.rows[0].count);
    }

    /**
     * Crea un nuevo registro
     * @param {Object} data - Datos a insertar
     * @param {Object} options - {tenantId}
     * @returns {Promise<Object>} - Registro creado
     */
    async create(data, options = {}) {
        const { tenantId = 'bsl' } = options;

        // Multi-tenant: inyectar tenant_id si no está explícito
        const dataWithTenant = data.tenant_id !== undefined
            ? data
            : { ...data, tenant_id: tenantId };

        const keys = Object.keys(dataWithTenant);
        const values = Object.values(dataWithTenant);

        const columns = keys.map(k => `"${k}"`).join(', ');
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

        const query = `
            INSERT INTO ${this.tableName} (${columns})
            VALUES (${placeholders})
            RETURNING *
        `;

        const result = await this.pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Actualiza un registro por ID
     * @param {string|number} id
     * @param {Object} data - Datos a actualizar
     * @param {string} idColumn - Nombre de la columna ID
     * @param {string} tenantId - Tenant al que pertenece el registro (default: 'bsl')
     * @returns {Promise<Object|null>}
     */
    async update(id, data, idColumn = '_id', tenantId = 'bsl') {
        const keys = Object.keys(data);
        const values = Object.values(data);

        const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');

        const query = `
            UPDATE ${this.tableName}
            SET ${setClauses}
            WHERE "${idColumn}" = $${keys.length + 1}
              AND tenant_id = $${keys.length + 2}
            RETURNING *
        `;

        const result = await this.pool.query(query, [...values, id, tenantId]);
        return result.rows[0] || null;
    }

    /**
     * Elimina un registro por ID
     * @param {string|number} id
     * @param {string} idColumn - Nombre de la columna ID
     * @param {string} tenantId - Tenant al que pertenece el registro (default: 'bsl')
     * @returns {Promise<boolean>}
     */
    async delete(id, idColumn = '_id', tenantId = 'bsl') {
        const query = `DELETE FROM ${this.tableName} WHERE "${idColumn}" = $1 AND tenant_id = $2`;
        const result = await this.pool.query(query, [id, tenantId]);
        return result.rowCount > 0;
    }

    /**
     * Ejecuta una transacción
     * @param {Function} callback - Función async que recibe el cliente
     * @returns {Promise<any>}
     */
    async transaction(callback) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Ejecuta una query SQL personalizada.
     *
     * ⚠️  Multi-tenant: este método NO inyecta tenant_id automáticamente.
     * Las consultas que usan este método deben incluir `AND tenant_id = $N`
     * explícitamente en su WHERE/INSERT. Sprint 4 refactoriza los call sites
     * que todavía no lo hacen.
     *
     * @param {string} query
     * @param {Array} params
     * @returns {Promise<Object>}
     */
    async query(query, params = []) {
        return await this.pool.query(query, params);
    }
}

module.exports = BaseRepository;
