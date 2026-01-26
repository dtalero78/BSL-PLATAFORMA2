const BaseRepository = require('./BaseRepository');

/**
 * Repository para la tabla mensajes_whatsapp
 * Métodos específicos para gestión de mensajes de WhatsApp
 */
class MensajesWhatsAppRepository extends BaseRepository {
    constructor() {
        super('mensajes_whatsapp');
    }

    /**
     * Busca mensajes por ID de conversación
     * @param {string|number} conversacionId
     * @param {Object} options - {limit, offset, orderDir}
     * @returns {Promise<Array>}
     */
    async findByConversacion(conversacionId, options = {}) {
        const { limit = 100, offset = 0, orderDir = 'ASC' } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1
            ORDER BY "fecha_envio" ${orderDir}
            LIMIT $2 OFFSET $3
        `;

        const result = await this.query(query, [conversacionId, limit, offset]);
        return result.rows;
    }

    /**
     * Busca mensajes recientes de una conversación
     * @param {string|number} conversacionId
     * @param {number} limit - Número de mensajes a recuperar
     * @returns {Promise<Array>}
     */
    async findRecientes(conversacionId, limit = 50) {
        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1
            ORDER BY "fecha_envio" DESC
            LIMIT $2
        `;

        const result = await this.query(query, [conversacionId, limit]);
        // Invertir el orden para mostrar cronológicamente
        return result.rows.reverse();
    }

    /**
     * Crea un nuevo mensaje en una conversación
     * @param {string|number} conversacionId
     * @param {Object} data - Datos del mensaje (contenido, remitente, tipo_mensaje, etc.)
     * @returns {Promise<Object>}
     */
    async createMensaje(conversacionId, data) {
        const mensajeData = {
            conversacion_id: conversacionId,
            fecha_envio: new Date(),
            ...data
        };

        return await this.create(mensajeData);
    }

    /**
     * Busca mensajes por remitente (CLIENTE o AGENTE)
     * @param {string|number} conversacionId
     * @param {string} remitente - CLIENTE o AGENTE
     * @param {Object} options - {limit, offset}
     * @returns {Promise<Array>}
     */
    async findByRemitente(conversacionId, remitente, options = {}) {
        const { limit = 100, offset = 0 } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND "remitente" = $2
            ORDER BY "fecha_envio" ASC
            LIMIT $3 OFFSET $4
        `;

        const result = await this.query(query, [conversacionId, remitente, limit, offset]);
        return result.rows;
    }

    /**
     * Busca mensajes no leídos de una conversación
     * @param {string|number} conversacionId
     * @returns {Promise<Array>}
     */
    async findNoLeidos(conversacionId) {
        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND "leido" = false
            ORDER BY "fecha_envio" ASC
        `;

        const result = await this.query(query, [conversacionId]);
        return result.rows;
    }

    /**
     * Marca mensajes como leídos
     * @param {string|number} conversacionId
     * @param {Array<number>} mensajeIds - IDs de mensajes a marcar (opcional, marca todos si no se proporciona)
     * @returns {Promise<number>} - Número de mensajes actualizados
     */
    async marcarComoLeidos(conversacionId, mensajeIds = null) {
        let query = `
            UPDATE ${this.tableName}
            SET "leido" = true, "fecha_lectura" = NOW()
            WHERE "conversacion_id" = $1 AND "leido" = false
        `;

        const params = [conversacionId];

        if (mensajeIds && mensajeIds.length > 0) {
            query += ` AND "id" = ANY($2)`;
            params.push(mensajeIds);
        }

        const result = await this.query(query, params);
        return result.rowCount;
    }

    /**
     * Cuenta mensajes por conversación
     * @param {string|number} conversacionId
     * @returns {Promise<number>}
     */
    async countByConversacion(conversacionId) {
        return await this.count({ conversacion_id: conversacionId });
    }

    /**
     * Cuenta mensajes no leídos por conversación
     * @param {string|number} conversacionId
     * @returns {Promise<number>}
     */
    async countNoLeidos(conversacionId) {
        const query = `
            SELECT COUNT(*) FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND "leido" = false
        `;
        const result = await this.query(query, [conversacionId]);
        return parseInt(result.rows[0].count);
    }

    /**
     * Busca mensajes por tipo (texto, imagen, documento, etc.)
     * @param {string|number} conversacionId
     * @param {string} tipoMensaje
     * @param {Object} options - {limit, offset}
     * @returns {Promise<Array>}
     */
    async findByTipo(conversacionId, tipoMensaje, options = {}) {
        const { limit = 100, offset = 0 } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND "tipo_mensaje" = $2
            ORDER BY "fecha_envio" DESC
            LIMIT $3 OFFSET $4
        `;

        const result = await this.query(query, [conversacionId, tipoMensaje, limit, offset]);
        return result.rows;
    }

    /**
     * Busca el último mensaje de una conversación
     * @param {string|number} conversacionId
     * @returns {Promise<Object|null>}
     */
    async findUltimo(conversacionId) {
        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1
            ORDER BY "fecha_envio" DESC
            LIMIT 1
        `;

        const result = await this.query(query, [conversacionId]);
        return result.rows[0] || null;
    }

    /**
     * Busca mensajes en un rango de fechas
     * @param {string|number} conversacionId
     * @param {Date|string} fechaInicio
     * @param {Date|string} fechaFin
     * @returns {Promise<Array>}
     */
    async findByRangoFechas(conversacionId, fechaInicio, fechaFin) {
        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1
            AND "fecha_envio" >= $2
            AND "fecha_envio" <= $3
            ORDER BY "fecha_envio" ASC
        `;

        const result = await this.query(query, [
            conversacionId,
            new Date(fechaInicio),
            new Date(fechaFin)
        ]);
        return result.rows;
    }

    /**
     * Busca mensajes con adjuntos (media_url no null)
     * @param {string|number} conversacionId
     * @param {Object} options - {limit, offset}
     * @returns {Promise<Array>}
     */
    async findConAdjuntos(conversacionId, options = {}) {
        const { limit = 100, offset = 0 } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1 AND "media_url" IS NOT NULL
            ORDER BY "fecha_envio" DESC
            LIMIT $2 OFFSET $3
        `;

        const result = await this.query(query, [conversacionId, limit, offset]);
        return result.rows;
    }

    /**
     * Elimina mensajes antiguos (limpieza de datos)
     * @param {number} dias - Días de antigüedad
     * @returns {Promise<number>} - Número de mensajes eliminados
     */
    async eliminarAntiguos(dias = 90) {
        const query = `
            DELETE FROM ${this.tableName}
            WHERE "fecha_envio" < NOW() - INTERVAL '${dias} days'
            RETURNING id
        `;
        const result = await this.query(query);
        return result.rowCount;
    }

    /**
     * Busca mensajes con búsqueda de texto en contenido
     * @param {string|number} conversacionId
     * @param {string} buscar - Término de búsqueda
     * @param {Object} options - {limit, offset}
     * @returns {Promise<Array>}
     */
    async buscarEnContenido(conversacionId, buscar, options = {}) {
        const { limit = 100, offset = 0 } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "conversacion_id" = $1
            AND "contenido" ILIKE $2
            ORDER BY "fecha_envio" DESC
            LIMIT $3 OFFSET $4
        `;

        const result = await this.query(query, [conversacionId, `%${buscar}%`, limit, offset]);
        return result.rows;
    }
}

module.exports = new MensajesWhatsAppRepository();
