const BaseRepository = require('./BaseRepository');

/**
 * Repository para la tabla formularios
 * Métodos específicos para formularios de pacientes
 */
class FormulariosRepository extends BaseRepository {
    constructor() {
        super('formularios');
    }

    /**
     * Busca por número de documento
     * @param {string} numeroId
     * @returns {Promise<Object|null>}
     */
    async findByNumeroId(numeroId) {
        return await this.findOne({ numero_id: numeroId });
    }

    /**
     * Busca múltiples formularios por número de documento
     * @param {string} numeroId
     * @param {Object} options - {limit, offset, orderBy, orderDir}
     * @returns {Promise<Array>}
     */
    async findAllByNumeroId(numeroId, options = {}) {
        const defaultOptions = {
            orderBy: 'fecha_registro',
            orderDir: 'DESC',
            ...options
        };
        return await this.findAll({ numero_id: numeroId }, defaultOptions);
    }

    /**
     * Busca por Wix ID
     * @param {string} wixId
     * @returns {Promise<Object|null>}
     */
    async findByWixId(wixId) {
        return await this.findOne({ wix_id: wixId });
    }

    /**
     * Busca por celular
     * @param {string} celular
     * @returns {Promise<Object|null>}
     */
    async findByCelular(celular) {
        return await this.findOne({ celular });
    }

    /**
     * Busca múltiples formularios por celular
     * @param {string} celular
     * @param {Object} options - {limit, offset, orderBy, orderDir}
     * @returns {Promise<Array>}
     */
    async findAllByCelular(celular, options = {}) {
        const defaultOptions = {
            orderBy: 'fecha_registro',
            orderDir: 'DESC',
            ...options
        };
        return await this.findAll({ celular }, defaultOptions);
    }

    /**
     * Busca por código de empresa con paginación y búsqueda
     * @param {string} codEmpresa
     * @param {Object} options - {limit, offset, buscar}
     * @returns {Promise<Array>}
     */
    async findByCodEmpresa(codEmpresa, options = {}) {
        const { limit = 100, offset = 0, buscar } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "cod_empresa" = $1
        `;

        const params = [codEmpresa];
        let paramIndex = 2;

        if (buscar) {
            query += ` AND (
                COALESCE("numero_id", '') || ' ' ||
                COALESCE("primer_nombre", '') || ' ' ||
                COALESCE("primer_apellido", '') || ' ' ||
                COALESCE("celular", '') || ' ' ||
                COALESCE("email", '')
            ) ILIKE $${paramIndex}`;
            params.push(`%${buscar}%`);
            paramIndex++;
        }

        query += ` ORDER BY "fecha_registro" DESC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await this.query(query, params);
        return result.rows;
    }

    /**
     * Cuenta registros por empresa con búsqueda opcional
     * @param {string} codEmpresa
     * @param {string} buscar - Término de búsqueda opcional
     * @returns {Promise<number>}
     */
    async countByCodEmpresa(codEmpresa, buscar = null) {
        let query = `SELECT COUNT(*) FROM ${this.tableName} WHERE "cod_empresa" = $1`;
        const params = [codEmpresa];

        if (buscar) {
            query += ` AND (
                COALESCE("numero_id", '') || ' ' ||
                COALESCE("primer_nombre", '') || ' ' ||
                COALESCE("primer_apellido", '') || ' ' ||
                COALESCE("celular", '') || ' ' ||
                COALESCE("email", '')
            ) ILIKE $2`;
            params.push(`%${buscar}%`);
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count);
    }

    /**
     * Busca formularios recientes (últimos N días)
     * @param {number} dias - Número de días hacia atrás
     * @param {Object} options - {limit, offset}
     * @returns {Promise<Array>}
     */
    async findRecientes(dias = 7, options = {}) {
        const { limit = 100, offset = 0 } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "fecha_registro" >= NOW() - INTERVAL '${dias} days'
            ORDER BY "fecha_registro" DESC
            LIMIT $1 OFFSET $2
        `;

        const result = await this.query(query, [limit, offset]);
        return result.rows;
    }

    /**
     * Busca formularios con foto URL
     * @param {Object} filters - Filtros adicionales
     * @param {Object} options - {limit, offset}
     * @returns {Promise<Array>}
     */
    async findConFoto(filters = {}, options = {}) {
        const { limit, offset } = options;

        let query = `SELECT * FROM ${this.tableName} WHERE "foto_url" IS NOT NULL`;
        const params = [];
        let paramIndex = 1;

        // Agregar filtros adicionales
        const filterKeys = Object.keys(filters);
        if (filterKeys.length > 0) {
            const whereClauses = filterKeys.map(key => {
                params.push(filters[key]);
                return `"${key}" = $${paramIndex++}`;
            });
            query += ` AND ${whereClauses.join(' AND ')}`;
        }

        query += ` ORDER BY "fecha_registro" DESC`;

        if (limit) {
            query += ` LIMIT $${paramIndex++}`;
            params.push(limit);
        }
        if (offset !== undefined) {
            query += ` OFFSET $${paramIndex++}`;
            params.push(offset);
        }

        const result = await this.query(query, params);
        return result.rows;
    }

    /**
     * Actualiza la foto URL de un formulario
     * @param {string|number} id
     * @param {string} fotoUrl
     * @returns {Promise<Object|null>}
     */
    async actualizarFotoUrl(id, fotoUrl) {
        return await this.update(id, { foto_url: fotoUrl }, 'id');
    }

    /**
     * Encuentra el último formulario de un paciente
     * @param {string} numeroId
     * @returns {Promise<Object|null>}
     */
    async findUltimoPorNumeroId(numeroId) {
        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "numero_id" = $1
            ORDER BY "fecha_registro" DESC
            LIMIT 1
        `;
        const result = await this.query(query, [numeroId]);
        return result.rows[0] || null;
    }
}

module.exports = new FormulariosRepository();
