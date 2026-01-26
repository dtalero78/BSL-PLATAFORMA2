const BaseRepository = require('./BaseRepository');

/**
 * Repository para la tabla conversaciones_whatsapp
 * Métodos específicos para gestión de conversaciones de WhatsApp
 */
class ConversacionesWhatsAppRepository extends BaseRepository {
    constructor() {
        super('conversaciones_whatsapp');
    }

    /**
     * Busca conversación por celular
     * @param {string} celular
     * @returns {Promise<Object|null>}
     */
    async findByCelular(celular) {
        return await this.findOne({ celular });
    }

    /**
     * Busca múltiples conversaciones por celular
     * @param {string} celular
     * @param {Object} options - {limit, offset, orderBy, orderDir}
     * @returns {Promise<Array>}
     */
    async findAllByCelular(celular, options = {}) {
        const defaultOptions = {
            orderBy: 'fecha_inicio',
            orderDir: 'DESC',
            ...options
        };
        return await this.findAll({ celular }, defaultOptions);
    }

    /**
     * Busca conversaciones por estado
     * @param {string} estado - ACTIVA, CERRADA, TRANSFERIDA, etc.
     * @param {Object} options - {limit, offset, orderBy, orderDir}
     * @returns {Promise<Array>}
     */
    async findByEstado(estado, options = {}) {
        const defaultOptions = {
            orderBy: 'fecha_inicio',
            orderDir: 'DESC',
            ...options
        };
        return await this.findAll({ estado }, defaultOptions);
    }

    /**
     * Busca conversaciones activas (ACTIVA)
     * @param {Object} options - {limit, offset, agenteId}
     * @returns {Promise<Array>}
     */
    async findActivas(options = {}) {
        const { limit = 100, offset = 0, agenteId } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "estado" = 'ACTIVA'
        `;

        const params = [];
        let paramIndex = 1;

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

    /**
     * Busca conversaciones pendientes (sin agente asignado)
     * @param {Object} options - {limit, offset}
     * @returns {Promise<Array>}
     */
    async findPendientes(options = {}) {
        const { limit = 100, offset = 0 } = options;

        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "estado" = 'ACTIVA' AND "agente_id" IS NULL
            ORDER BY "fecha_inicio" ASC
            LIMIT $1 OFFSET $2
        `;

        const result = await this.query(query, [limit, offset]);
        return result.rows;
    }

    /**
     * Busca conversaciones asignadas a un agente
     * @param {string|number} agenteId
     * @param {Object} options - {limit, offset, incluirCerradas}
     * @returns {Promise<Array>}
     */
    async findByAgente(agenteId, options = {}) {
        const { limit = 100, offset = 0, incluirCerradas = false } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "agente_id" = $1
        `;

        const params = [agenteId];
        let paramIndex = 2;

        if (!incluirCerradas) {
            query += ` AND "estado" != 'CERRADA'`;
        }

        query += ` ORDER BY "fecha_ultimo_mensaje" DESC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await this.query(query, params);
        return result.rows;
    }

    /**
     * Actualiza el estado de una conversación
     * @param {string|number} id
     * @param {string} estado - Nuevo estado (ACTIVA, CERRADA, TRANSFERIDA, etc.)
     * @returns {Promise<Object|null>}
     */
    async updateEstado(id, estado) {
        const updateData = { estado };

        if (estado === 'CERRADA') {
            updateData.fecha_cierre = new Date();
        }

        return await this.update(id, updateData);
    }

    /**
     * Asigna una conversación a un agente
     * @param {string|number} id
     * @param {string|number} agenteId
     * @returns {Promise<Object|null>}
     */
    async asignarAgente(id, agenteId) {
        return await this.update(id, {
            agente_id: agenteId,
            fecha_asignacion: new Date()
        });
    }

    /**
     * Actualiza la fecha del último mensaje
     * @param {string|number} id
     * @returns {Promise<Object|null>}
     */
    async actualizarUltimoMensaje(id) {
        return await this.update(id, {
            fecha_ultimo_mensaje: new Date()
        });
    }

    /**
     * Marca o desmarca el stop_bot de una conversación por celular
     * @param {string} celular
     * @param {boolean} stopBot
     * @returns {Promise<Object|null>}
     */
    async marcarStopBot(celular, stopBot = true) {
        const query = `
            UPDATE ${this.tableName}
            SET "stop_bot" = $1
            WHERE "celular" = $2
            RETURNING *
        `;
        const result = await this.query(query, [stopBot, celular]);
        return result.rows[0] || null;
    }

    /**
     * Verifica si una conversación tiene stop_bot activo
     * @param {string} celular
     * @returns {Promise<boolean>}
     */
    async tieneStopBot(celular) {
        const conversacion = await this.findByCelular(celular);
        return conversacion ? conversacion.stop_bot === true : false;
    }

    /**
     * Cuenta conversaciones por estado
     * @param {string} estado
     * @returns {Promise<number>}
     */
    async countByEstado(estado) {
        return await this.count({ estado });
    }

    /**
     * Cuenta conversaciones activas por agente
     * @param {string|number} agenteId
     * @returns {Promise<number>}
     */
    async countActivasByAgente(agenteId) {
        const query = `
            SELECT COUNT(*) FROM ${this.tableName}
            WHERE "agente_id" = $1 AND "estado" = 'ACTIVA'
        `;
        const result = await this.query(query, [agenteId]);
        return parseInt(result.rows[0].count);
    }

    /**
     * Busca conversaciones con búsqueda general
     * @param {string} buscar - Término de búsqueda
     * @param {Object} options - {limit, offset, estado}
     * @returns {Promise<Array>}
     */
    async buscar(buscar, options = {}) {
        const { limit = 100, offset = 0, estado } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE (
                COALESCE("celular", '') || ' ' ||
                COALESCE("nombre_cliente", '')
            ) ILIKE $1
        `;

        const params = [`%${buscar}%`];
        let paramIndex = 2;

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

    /**
     * Cierra conversaciones inactivas (sin mensajes en X horas)
     * @param {number} horas - Horas de inactividad
     * @returns {Promise<number>} - Número de conversaciones cerradas
     */
    async cerrarInactivas(horas = 24) {
        const query = `
            UPDATE ${this.tableName}
            SET "estado" = 'CERRADA',
                "fecha_cierre" = NOW()
            WHERE "estado" = 'ACTIVA'
            AND "fecha_ultimo_mensaje" < NOW() - INTERVAL '${horas} hours'
            RETURNING id
        `;
        const result = await this.query(query);
        return result.rowCount;
    }
}

module.exports = new ConversacionesWhatsAppRepository();
