const pool = require('../config/database');

/**
 * Clase base para todos los repositories
 * Proporciona métodos CRUD genéricos
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
     * @returns {Promise<Object|null>}
     */
    async findById(id, idColumn = '_id') {
        const query = `SELECT * FROM ${this.tableName} WHERE "${idColumn}" = $1`;
        const result = await this.pool.query(query, [id]);
        return result.rows[0] || null;
    }

    /**
     * Encuentra todos los registros con filtros opcionales
     * @param {Object} filters - Objeto con filtros {columna: valor}
     * @param {Object} options - {limit, offset, orderBy, orderDir}
     * @returns {Promise<Array>}
     */
    async findAll(filters = {}, options = {}) {
        const { limit, offset, orderBy, orderDir = 'ASC' } = options;

        let query = `SELECT * FROM ${this.tableName}`;
        const params = [];
        let paramIndex = 1;

        // Agregar filtros WHERE
        const filterKeys = Object.keys(filters);
        if (filterKeys.length > 0) {
            const whereClauses = filterKeys.map(key => {
                params.push(filters[key]);
                return `"${key}" = $${paramIndex++}`;
            });
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        // ORDER BY
        if (orderBy) {
            query += ` ORDER BY "${orderBy}" ${orderDir}`;
        }

        // LIMIT y OFFSET
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
     * @returns {Promise<Object|null>}
     */
    async findOne(filters = {}) {
        const results = await this.findAll(filters, { limit: 1 });
        return results[0] || null;
    }

    /**
     * Cuenta registros con filtros opcionales
     * @param {Object} filters - Objeto con filtros {columna: valor}
     * @returns {Promise<number>}
     */
    async count(filters = {}) {
        let query = `SELECT COUNT(*) FROM ${this.tableName}`;
        const params = [];
        let paramIndex = 1;

        const filterKeys = Object.keys(filters);
        if (filterKeys.length > 0) {
            const whereClauses = filterKeys.map(key => {
                params.push(filters[key]);
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
     * @returns {Promise<Object>} - Registro creado
     */
    async create(data) {
        const keys = Object.keys(data);
        const values = Object.values(data);

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
     * @returns {Promise<Object|null>}
     */
    async update(id, data, idColumn = '_id') {
        const keys = Object.keys(data);
        const values = Object.values(data);

        const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');

        const query = `
            UPDATE ${this.tableName}
            SET ${setClauses}
            WHERE "${idColumn}" = $${keys.length + 1}
            RETURNING *
        `;

        const result = await this.pool.query(query, [...values, id]);
        return result.rows[0] || null;
    }

    /**
     * Elimina un registro por ID
     * @param {string|number} id
     * @param {string} idColumn - Nombre de la columna ID
     * @returns {Promise<boolean>}
     */
    async delete(id, idColumn = '_id') {
        const query = `DELETE FROM ${this.tableName} WHERE "${idColumn}" = $1`;
        const result = await this.pool.query(query, [id]);
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
     * Ejecuta una query SQL personalizada
     * @param {string} query
     * @param {Array} params
     * @returns {Promise<Object>}
     */
    async query(query, params = []) {
        return await this.pool.query(query, params);
    }
}

module.exports = BaseRepository;
