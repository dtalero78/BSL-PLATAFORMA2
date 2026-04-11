const BaseRepository = require('./BaseRepository');

/**
 * Repository para la tabla empresas
 * Multi-tenant (ver CLAUDE.md): todos los métodos aceptan tenantId opcional (default 'bsl').
 */
class EmpresasRepository extends BaseRepository {
    constructor() {
        super('empresas');
    }

    async findByCodigo(codigo, tenantId = 'bsl') {
        return await this.findOne({ codigo }, { tenantId });
    }

    async findByNit(nit, tenantId = 'bsl') {
        return await this.findOne({ nit }, { tenantId });
    }

    async findByNombre(nombre, tenantId = 'bsl') {
        return await this.findOne({ nombre }, { tenantId });
    }

    async findActivas(options = {}) {
        const defaultOptions = {
            orderBy: 'nombre',
            orderDir: 'ASC',
            tenantId: 'bsl',
            ...options
        };
        return await this.findAll({ activo: true }, defaultOptions);
    }

    async findInactivas(options = {}) {
        const defaultOptions = {
            orderBy: 'nombre',
            orderDir: 'ASC',
            tenantId: 'bsl',
            ...options
        };
        return await this.findAll({ activo: false }, defaultOptions);
    }

    async buscar(buscar, options = {}) {
        const { limit = 100, offset = 0, soloActivas = true, tenantId = 'bsl' } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE (
                COALESCE("nombre", '') || ' ' ||
                COALESCE("codigo", '') || ' ' ||
                COALESCE("nit", '')
            ) ILIKE $1
              AND tenant_id = $2
        `;

        const params = [`%${buscar}%`, tenantId];
        let paramIndex = 3;

        if (soloActivas) {
            query += ` AND "activo" = true`;
        }

        query += ` ORDER BY "nombre" ASC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await this.query(query, params);
        return result.rows;
    }

    async activar(id, tenantId = 'bsl') {
        return await this.update(id, { activo: true }, '_id', tenantId);
    }

    async desactivar(id, tenantId = 'bsl') {
        return await this.update(id, { activo: false }, '_id', tenantId);
    }

    async countActivas(tenantId = 'bsl') {
        return await this.count({ activo: true }, { tenantId });
    }

    async countInactivas(tenantId = 'bsl') {
        return await this.count({ activo: false }, { tenantId });
    }

    async codigoExists(codigo, excludeId = null, tenantId = 'bsl') {
        let query = `SELECT COUNT(*) FROM ${this.tableName} WHERE "codigo" = $1 AND tenant_id = $2`;
        const params = [codigo, tenantId];

        if (excludeId) {
            query += ` AND "id" != $3`;
            params.push(excludeId);
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count) > 0;
    }

    async nitExists(nit, excludeId = null, tenantId = 'bsl') {
        let query = `SELECT COUNT(*) FROM ${this.tableName} WHERE "nit" = $1 AND tenant_id = $2`;
        const params = [nit, tenantId];

        if (excludeId) {
            query += ` AND "id" != $3`;
            params.push(excludeId);
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count) > 0;
    }

    async findByCiudad(ciudad, options = {}) {
        const { limit = 100, offset = 0, soloActivas = true, tenantId = 'bsl' } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "ciudad" = $1 AND tenant_id = $2
        `;

        const params = [ciudad, tenantId];
        let paramIndex = 3;

        if (soloActivas) {
            query += ` AND "activo" = true`;
        }

        query += ` ORDER BY "nombre" ASC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await this.query(query, params);
        return result.rows;
    }

    async getCiudades(tenantId = 'bsl') {
        const query = `
            SELECT DISTINCT "ciudad"
            FROM ${this.tableName}
            WHERE "ciudad" IS NOT NULL AND "activo" = true AND tenant_id = $1
            ORDER BY "ciudad" ASC
        `;

        const result = await this.query(query, [tenantId]);
        return result.rows.map(row => row.ciudad);
    }

    async actualizarContacto(id, contacto, tenantId = 'bsl') {
        const updateData = {};

        if (contacto.telefono !== undefined) updateData.telefono = contacto.telefono;
        if (contacto.email !== undefined) updateData.email = contacto.email;
        if (contacto.direccion !== undefined) updateData.direccion = contacto.direccion;
        if (contacto.ciudad !== undefined) updateData.ciudad = contacto.ciudad;

        if (Object.keys(updateData).length === 0) {
            throw new Error('No se proporcionaron datos de contacto para actualizar');
        }

        return await this.update(id, updateData, '_id', tenantId);
    }

    async crearEmpresa(empresaData, tenantId = 'bsl') {
        const { codigo, nit } = empresaData;

        if (codigo) {
            const codigoExiste = await this.codigoExists(codigo, null, tenantId);
            if (codigoExiste) {
                throw new Error('El código de empresa ya está registrado');
            }
        }

        if (nit) {
            const nitExiste = await this.nitExists(nit, null, tenantId);
            if (nitExiste) {
                throw new Error('El NIT ya está registrado');
            }
        }

        if (empresaData.activo === undefined) {
            empresaData.activo = true;
        }

        return await this.create(empresaData, { tenantId });
    }

    async findRecientes(dias = 30, options = {}) {
        const { limit = 100, offset = 0, tenantId = 'bsl' } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "fecha_registro" >= NOW() - INTERVAL '${dias} days'
              AND tenant_id = $3
            ORDER BY "fecha_registro" DESC
            LIMIT $1 OFFSET $2
        `;

        const result = await this.query(query, [limit, offset, tenantId]);
        return result.rows;
    }
}

module.exports = new EmpresasRepository();
