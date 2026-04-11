const BaseRepository = require('./BaseRepository');

/**
 * Repository para la tabla mensajes_whatsapp
 * Multi-tenant (ver CLAUDE.md): todos los métodos aceptan tenantId opcional (default 'bsl').
 */
class MensajesWhatsAppRepository extends BaseRepository {
    constructor() {
        super('mensajes_whatsapp');
    }

    async findByConversacion(conversacionId, options = {}) {
        const { limit = 100, offset = 0, orderDir = 'ASC', tenantId = 'bsl' } = options;

        // Validar orderDir para prevenir SQL injection (no es parameterizable directamente)
        const orderDirSafe = orderDir === 'DESC' ? 'DESC' : 'ASC';

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND tenant_id = $2
            ORDER BY "fecha_envio" ${orderDirSafe}
            LIMIT $3 OFFSET $4
        `;

        const result = await this.query(query, [conversacionId, tenantId, limit, offset]);
        return result.rows;
    }

    async findRecientes(conversacionId, limit = 50, tenantId = 'bsl') {
        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND tenant_id = $2
            ORDER BY "fecha_envio" DESC
            LIMIT $3
        `;

        const result = await this.query(query, [conversacionId, tenantId, limit]);
        return result.rows.reverse();
    }

    async createMensaje(conversacionId, data, tenantId = 'bsl') {
        const mensajeData = {
            conversacion_id: conversacionId,
            fecha_envio: new Date(),
            ...data
        };

        return await this.create(mensajeData, { tenantId });
    }

    async findByRemitente(conversacionId, remitente, options = {}) {
        const { limit = 100, offset = 0, tenantId = 'bsl' } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND "remitente" = $2 AND tenant_id = $3
            ORDER BY "fecha_envio" ASC
            LIMIT $4 OFFSET $5
        `;

        const result = await this.query(query, [conversacionId, remitente, tenantId, limit, offset]);
        return result.rows;
    }

    async findNoLeidos(conversacionId, tenantId = 'bsl') {
        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND "leido" = false AND tenant_id = $2
            ORDER BY "fecha_envio" ASC
        `;

        const result = await this.query(query, [conversacionId, tenantId]);
        return result.rows;
    }

    async marcarComoLeidos(conversacionId, mensajeIds = null, tenantId = 'bsl') {
        let query = `
            UPDATE ${this.tableName}
            SET "leido" = true, "fecha_lectura" = NOW()
            WHERE "conversacion_id" = $1 AND "leido" = false AND tenant_id = $2
        `;

        const params = [conversacionId, tenantId];

        if (mensajeIds && mensajeIds.length > 0) {
            query += ` AND "id" = ANY($3)`;
            params.push(mensajeIds);
        }

        const result = await this.query(query, params);
        return result.rowCount;
    }

    async countByConversacion(conversacionId, tenantId = 'bsl') {
        return await this.count({ conversacion_id: conversacionId }, { tenantId });
    }

    async countNoLeidos(conversacionId, tenantId = 'bsl') {
        const query = `
            SELECT COUNT(*) FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND "leido" = false AND tenant_id = $2
        `;
        const result = await this.query(query, [conversacionId, tenantId]);
        return parseInt(result.rows[0].count);
    }

    async findByTipo(conversacionId, tipoMensaje, options = {}) {
        const { limit = 100, offset = 0, tenantId = 'bsl' } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND "tipo_mensaje" = $2 AND tenant_id = $3
            ORDER BY "fecha_envio" DESC
            LIMIT $4 OFFSET $5
        `;

        const result = await this.query(query, [conversacionId, tipoMensaje, tenantId, limit, offset]);
        return result.rows;
    }

    async findUltimo(conversacionId, tenantId = 'bsl') {
        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND tenant_id = $2
            ORDER BY "fecha_envio" DESC
            LIMIT 1
        `;

        const result = await this.query(query, [conversacionId, tenantId]);
        return result.rows[0] || null;
    }

    async findByRangoFechas(conversacionId, fechaInicio, fechaFin, tenantId = 'bsl') {
        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1
              AND "fecha_envio" >= $2
              AND "fecha_envio" <= $3
              AND tenant_id = $4
            ORDER BY "fecha_envio" ASC
        `;

        const result = await this.query(query, [
            conversacionId,
            new Date(fechaInicio),
            new Date(fechaFin),
            tenantId
        ]);
        return result.rows;
    }

    async findConAdjuntos(conversacionId, options = {}) {
        const { limit = 100, offset = 0, tenantId = 'bsl' } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND "media_url" IS NOT NULL AND tenant_id = $2
            ORDER BY "fecha_envio" DESC
            LIMIT $3 OFFSET $4
        `;

        const result = await this.query(query, [conversacionId, tenantId, limit, offset]);
        return result.rows;
    }

    async eliminarAntiguos(dias = 90, tenantId = 'bsl') {
        // Validación: dias debe ser número para prevenir SQL injection en INTERVAL
        const diasInt = parseInt(dias);
        if (isNaN(diasInt) || diasInt < 0) {
            throw new Error('dias debe ser un número positivo');
        }

        const query = `
            DELETE FROM ${this.tableName}
            WHERE "fecha_envio" < NOW() - INTERVAL '${diasInt} days'
              AND tenant_id = $1
            RETURNING id
        `;
        const result = await this.query(query, [tenantId]);
        return result.rowCount;
    }

    async buscarEnContenido(conversacionId, buscar, options = {}) {
        const { limit = 100, offset = 0, tenantId = 'bsl' } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1
              AND "contenido" ILIKE $2
              AND tenant_id = $3
            ORDER BY "fecha_envio" DESC
            LIMIT $4 OFFSET $5
        `;

        const result = await this.query(query, [conversacionId, `%${buscar}%`, tenantId, limit, offset]);
        return result.rows;
    }
}

module.exports = new MensajesWhatsAppRepository();
