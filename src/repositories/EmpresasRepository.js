const BaseRepository = require('./BaseRepository');

/**
 * Repository para la tabla empresas
 * Métodos específicos para gestión de empresas y clientes
 */
class EmpresasRepository extends BaseRepository {
    constructor() {
        super('empresas');
    }

    /**
     * Busca empresa por código
     * @param {string} codigo
     * @returns {Promise<Object|null>}
     */
    async findByCodigo(codigo) {
        return await this.findOne({ codigo });
    }

    /**
     * Busca empresa por NIT
     * @param {string} nit
     * @returns {Promise<Object|null>}
     */
    async findByNit(nit) {
        return await this.findOne({ nit });
    }

    /**
     * Busca empresa por nombre
     * @param {string} nombre
     * @returns {Promise<Object|null>}
     */
    async findByNombre(nombre) {
        return await this.findOne({ nombre });
    }

    /**
     * Busca empresas activas
     * @param {Object} options - {limit, offset, orderBy, orderDir}
     * @returns {Promise<Array>}
     */
    async findActivas(options = {}) {
        const defaultOptions = {
            orderBy: 'nombre',
            orderDir: 'ASC',
            ...options
        };
        return await this.findAll({ activo: true }, defaultOptions);
    }

    /**
     * Busca empresas inactivas
     * @param {Object} options - {limit, offset, orderBy, orderDir}
     * @returns {Promise<Array>}
     */
    async findInactivas(options = {}) {
        const defaultOptions = {
            orderBy: 'nombre',
            orderDir: 'ASC',
            ...options
        };
        return await this.findAll({ activo: false }, defaultOptions);
    }

    /**
     * Busca empresas con búsqueda general
     * @param {string} buscar - Término de búsqueda
     * @param {Object} options - {limit, offset, soloActivas}
     * @returns {Promise<Array>}
     */
    async buscar(buscar, options = {}) {
        const { limit = 100, offset = 0, soloActivas = true } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE (
                COALESCE("nombre", '') || ' ' ||
                COALESCE("codigo", '') || ' ' ||
                COALESCE("nit", '')
            ) ILIKE $1
        `;

        const params = [`%${buscar}%`];
        let paramIndex = 2;

        if (soloActivas) {
            query += ` AND "activo" = true`;
        }

        query += ` ORDER BY "nombre" ASC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await this.query(query, params);
        return result.rows;
    }

    /**
     * Activa una empresa
     * @param {string|number} id
     * @returns {Promise<Object|null>}
     */
    async activar(id) {
        return await this.update(id, { activo: true });
    }

    /**
     * Desactiva una empresa
     * @param {string|number} id
     * @returns {Promise<Object|null>}
     */
    async desactivar(id) {
        return await this.update(id, { activo: false });
    }

    /**
     * Cuenta empresas activas
     * @returns {Promise<number>}
     */
    async countActivas() {
        return await this.count({ activo: true });
    }

    /**
     * Cuenta empresas inactivas
     * @returns {Promise<number>}
     */
    async countInactivas() {
        return await this.count({ activo: false });
    }

    /**
     * Verifica si un código de empresa ya existe
     * @param {string} codigo
     * @param {string|number} excludeId - ID a excluir (para edición)
     * @returns {Promise<boolean>}
     */
    async codigoExists(codigo, excludeId = null) {
        let query = `SELECT COUNT(*) FROM ${this.tableName} WHERE "codigo" = $1`;
        const params = [codigo];

        if (excludeId) {
            query += ` AND "id" != $2`;
            params.push(excludeId);
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count) > 0;
    }

    /**
     * Verifica si un NIT ya existe
     * @param {string} nit
     * @param {string|number} excludeId - ID a excluir (para edición)
     * @returns {Promise<boolean>}
     */
    async nitExists(nit, excludeId = null) {
        let query = `SELECT COUNT(*) FROM ${this.tableName} WHERE "nit" = $1`;
        const params = [nit];

        if (excludeId) {
            query += ` AND "id" != $2`;
            params.push(excludeId);
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count) > 0;
    }

    /**
     * Busca empresas por ciudad
     * @param {string} ciudad
     * @param {Object} options - {limit, offset, soloActivas}
     * @returns {Promise<Array>}
     */
    async findByCiudad(ciudad, options = {}) {
        const { limit = 100, offset = 0, soloActivas = true } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "ciudad" = $1
        `;

        const params = [ciudad];
        let paramIndex = 2;

        if (soloActivas) {
            query += ` AND "activo" = true`;
        }

        query += ` ORDER BY "nombre" ASC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await this.query(query, params);
        return result.rows;
    }

    /**
     * Obtiene listado de ciudades únicas de empresas activas
     * @returns {Promise<Array<string>>}
     */
    async getCiudades() {
        const query = `
            SELECT DISTINCT "ciudad"
            FROM ${this.tableName}
            WHERE "ciudad" IS NOT NULL AND "activo" = true
            ORDER BY "ciudad" ASC
        `;

        const result = await this.query(query);
        return result.rows.map(row => row.ciudad);
    }

    /**
     * Actualiza información de contacto
     * @param {string|number} id
     * @param {Object} contacto - {telefono, email, direccion, ciudad}
     * @returns {Promise<Object|null>}
     */
    async actualizarContacto(id, contacto) {
        const updateData = {};

        if (contacto.telefono !== undefined) updateData.telefono = contacto.telefono;
        if (contacto.email !== undefined) updateData.email = contacto.email;
        if (contacto.direccion !== undefined) updateData.direccion = contacto.direccion;
        if (contacto.ciudad !== undefined) updateData.ciudad = contacto.ciudad;

        if (Object.keys(updateData).length === 0) {
            throw new Error('No se proporcionaron datos de contacto para actualizar');
        }

        return await this.update(id, updateData);
    }

    /**
     * Crea una empresa con validaciones
     * @param {Object} empresaData
     * @returns {Promise<Object>}
     */
    async crearEmpresa(empresaData) {
        const { codigo, nit } = empresaData;

        // Validar código único
        if (codigo) {
            const codigoExiste = await this.codigoExists(codigo);
            if (codigoExiste) {
                throw new Error('El código de empresa ya está registrado');
            }
        }

        // Validar NIT único
        if (nit) {
            const nitExiste = await this.nitExists(nit);
            if (nitExiste) {
                throw new Error('El NIT ya está registrado');
            }
        }

        // Establecer activo por defecto si no se proporciona
        if (empresaData.activo === undefined) {
            empresaData.activo = true;
        }

        return await this.create(empresaData);
    }

    /**
     * Busca empresas recientes (últimos N días)
     * @param {number} dias - Número de días hacia atrás
     * @param {Object} options - {limit, offset}
     * @returns {Promise<Array>}
     */
    async findRecientes(dias = 30, options = {}) {
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
}

module.exports = new EmpresasRepository();
