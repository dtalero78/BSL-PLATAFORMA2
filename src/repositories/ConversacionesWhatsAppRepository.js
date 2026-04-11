const BaseRepository = require('./BaseRepository');

/**
 * Repository para la tabla conversaciones_whatsapp
 * Multi-tenant (ver CLAUDE.md): todos los métodos aceptan tenantId opcional (default 'bsl').
 */
class ConversacionesWhatsAppRepository extends BaseRepository {
    constructor() {
        super('conversaciones_whatsapp');
    }

    async findByCelular(celular, tenantId = 'bsl') {
        return await this.findOne({ celular }, { tenantId });
    }

    async findAllByCelular(celular, options = {}) {
        const defaultOptions = {
            orderBy: 'fecha_inicio',
            orderDir: 'DESC',
            tenantId: 'bsl',
            ...options
        };
        return await this.findAll({ celular }, defaultOptions);
    }

    async findByEstado(estado, options = {}) {
        const defaultOptions = {
            orderBy: 'fecha_inicio',
            orderDir: 'DESC',
            tenantId: 'bsl',
            ...options
        };
        return await this.findAll({ estado }, defaultOptions);
    }

    async findActivas(options = {}) {
        const { limit = 100, offset = 0, agenteId, tenantId = 'bsl' } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "estado" = 'ACTIVA' AND tenant_id = $1
        `;

        const params = [tenantId];
        let paramIndex = 2;

        if (agenteId) {
            query += ` AND "agente_id" = $${paramIndex}`;
            params.push(agenteId);
            paramIndex++;
        }

        query += ` ORDER BY "fecha_ultimo_mensaje" DESC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await this.query(query, params);
        return result.rows;
    }

    async findPendientes(options = {}) {
        const { limit = 100, offset = 0, tenantId = 'bsl' } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "estado" = 'ACTIVA' AND "agente_id" IS NULL AND tenant_id = $3
            ORDER BY "fecha_inicio" ASC
            LIMIT $1 OFFSET $2
        `;

        const result = await this.query(query, [limit, offset, tenantId]);
        return result.rows;
    }

    async findByAgente(agenteId, options = {}) {
        const { limit = 100, offset = 0, incluirCerradas = false, tenantId = 'bsl' } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "agente_id" = $1 AND tenant_id = $2
        `;

        const params = [agenteId, tenantId];
        let paramIndex = 3;

        if (!incluirCerradas) {
            query += ` AND "estado" != 'CERRADA'`;
        }

        query += ` ORDER BY "fecha_ultimo_mensaje" DESC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await this.query(query, params);
        return result.rows;
    }

    async updateEstado(id, estado, tenantId = 'bsl') {
        const updateData = { estado };

        if (estado === 'CERRADA') {
            updateData.fecha_cierre = new Date();
        }

        return await this.update(id, updateData, '_id', tenantId);
    }

    async asignarAgente(id, agenteId, tenantId = 'bsl') {
        return await this.update(id, {
            agente_id: agenteId,
            fecha_asignacion: new Date()
        }, '_id', tenantId);
    }

    async actualizarUltimoMensaje(id, tenantId = 'bsl') {
        return await this.update(id, {
            fecha_ultimo_mensaje: new Date()
        }, '_id', tenantId);
    }

    async marcarStopBot(celular, stopBot = true, tenantId = 'bsl') {
        const query = `
            UPDATE ${this.tableName}
            SET "stop_bot" = $1
            WHERE "celular" = $2 AND tenant_id = $3
            RETURNING *
        `;
        const result = await this.query(query, [stopBot, celular, tenantId]);
        return result.rows[0] || null;
    }

    async tieneStopBot(celular, tenantId = 'bsl') {
        const conversacion = await this.findByCelular(celular, tenantId);
        return conversacion ? conversacion.stop_bot === true : false;
    }

    async countByEstado(estado, tenantId = 'bsl') {
        return await this.count({ estado }, { tenantId });
    }

    async countActivasByAgente(agenteId, tenantId = 'bsl') {
        const query = `
            SELECT COUNT(*) FROM ${this.tableName}
            WHERE "agente_id" = $1 AND "estado" = 'ACTIVA' AND tenant_id = $2
        `;
        const result = await this.query(query, [agenteId, tenantId]);
        return parseInt(result.rows[0].count);
    }

    async buscar(buscar, options = {}) {
        const { limit = 100, offset = 0, estado, tenantId = 'bsl' } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE (
                COALESCE("celular", '') || ' ' ||
                COALESCE("nombre_cliente", '')
            ) ILIKE $1
              AND tenant_id = $2
        `;

        const params = [`%${buscar}%`, tenantId];
        let paramIndex = 3;

        if (estado) {
            query += ` AND "estado" = $${paramIndex}`;
            params.push(estado);
            paramIndex++;
        }

        query += ` ORDER BY "fecha_ultimo_mensaje" DESC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await this.query(query, params);
        return result.rows;
    }

    async cerrarInactivas(horas = 24, tenantId = 'bsl') {
        // Validación: horas debe ser número para prevenir SQL injection en INTERVAL
        const horasInt = parseInt(horas);
        if (isNaN(horasInt) || horasInt < 0) {
            throw new Error('horas debe ser un número positivo');
        }

        const query = `
            UPDATE ${this.tableName}
            SET "estado" = 'CERRADA',
                "fecha_cierre" = NOW()
            WHERE "estado" = 'ACTIVA'
              AND "fecha_ultimo_mensaje" < NOW() - INTERVAL '${horasInt} hours'
              AND tenant_id = $1
            RETURNING id
        `;
        const result = await this.query(query, [tenantId]);
        return result.rowCount;
    }
}

module.exports = new ConversacionesWhatsAppRepository();
