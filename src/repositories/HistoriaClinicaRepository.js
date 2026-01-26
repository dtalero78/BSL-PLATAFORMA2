const BaseRepository = require('./BaseRepository');

/**
 * Repository para la tabla HistoriaClinica
 * Métodos específicos para consultas médicas
 */
class HistoriaClinicaRepository extends BaseRepository {
    constructor() {
        super('"HistoriaClinica"');
    }

    /**
     * Busca por número de documento
     * @param {string} numeroId
     * @returns {Promise<Object|null>}
     */
    async findByNumeroId(numeroId) {
        return await this.findOne({ numeroId });
    }

    /**
     * Busca múltiples registros por número de documento
     * @param {string} numeroId
     * @returns {Promise<Array>}
     */
    async findAllByNumeroId(numeroId) {
        return await this.findAll({ numeroId });
    }

    /**
     * Busca por código de empresa
     * @param {string} codEmpresa
     * @param {Object} options - {limit, offset, buscar}
     * @returns {Promise<Array>}
     */
    async findByEmpresa(codEmpresa, options = {}) {
        const { limit = 100, offset = 0, buscar } = options;

        let query = `
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre",
                   h."primerApellido", h."segundoApellido", h."codEmpresa", h."empresa",
                   h."cargo", h."tipoExamen", h."medico", h."atendido", h."fechaAtencion",
                   h."horaAtencion", h."examenes", h."ciudad", h."celular",
                   h."_createdDate", h."_updatedDate", h."fechaConsulta", h."aprobacion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales",
                   h."mdObservacionesCertificado", h."mdObsParaMiDocYa", h."centro_de_costo",
                   (
                       SELECT foto_url FROM formularios
                       WHERE (wix_id = h."_id" OR numero_id = h."numeroId")
                       AND foto_url IS NOT NULL
                       ORDER BY fecha_registro DESC LIMIT 1
                   ) as foto_url
            FROM ${this.tableName} h
            WHERE h."codEmpresa" = $1
        `;

        const params = [codEmpresa];
        let paramIndex = 2;

        if (buscar) {
            query += ` AND (
                COALESCE(h."numeroId", '') || ' ' ||
                COALESCE(h."primerNombre", '') || ' ' ||
                COALESCE(h."primerApellido", '') || ' ' ||
                COALESCE(h."codEmpresa", '') || ' ' ||
                COALESCE(h."celular", '') || ' ' ||
                COALESCE(h."empresa", '')
            ) ILIKE $${paramIndex}`;
            params.push(`%${buscar}%`);
            paramIndex++;
        }

        query += ` ORDER BY h."fechaConsulta" DESC NULLS LAST, h."_createdDate" DESC`;
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
    async countByEmpresa(codEmpresa, buscar = null) {
        let query = `SELECT COUNT(*) FROM ${this.tableName} WHERE "codEmpresa" = $1`;
        const params = [codEmpresa];

        if (buscar) {
            query += ` AND (
                COALESCE("numeroId", '') || ' ' ||
                COALESCE("primerNombre", '') || ' ' ||
                COALESCE("primerApellido", '') || ' ' ||
                COALESCE("codEmpresa", '') || ' ' ||
                COALESCE("celular", '') || ' ' ||
                COALESCE("empresa", '')
            ) ILIKE $2`;
            params.push(`%${buscar}%`);
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count);
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
     * Busca pacientes atendidos hoy por código de empresa
     * @param {string} codEmpresa
     * @returns {Promise<Array>}
     */
    async findAtendidosHoy(codEmpresa) {
        const query = `
            SELECT * FROM ${this.tableName}
            WHERE "codEmpresa" = $1
            AND "fechaConsulta" = CURRENT_DATE
            AND "atendido" = 'ATENDIDO'
            ORDER BY "_updatedDate" DESC
        `;
        const result = await this.query(query, [codEmpresa]);
        return result.rows;
    }

    /**
     * Marca un registro como atendido (upsert)
     * @param {Object} data - Datos del registro
     * @returns {Promise<Object>}
     */
    async marcarAtendido(data) {
        const {
            wixId,
            atendido = 'ATENDIDO',
            fechaConsulta,
            mdConceptoFinal,
            mdRecomendacionesMedicasAdicionales,
            mdObservacionesCertificado,
            // Campos para INSERT si no existe
            numeroId,
            primerNombre,
            segundoNombre,
            primerApellido,
            segundoApellido,
            celular,
            email,
            codEmpresa,
            empresa,
            cargo,
            tipoExamen,
            fechaAtencion
        } = data;

        // Verificar si existe
        const existente = await this.findById(wixId);

        if (existente) {
            // UPDATE
            const updateQuery = `
                UPDATE ${this.tableName} SET
                    "atendido" = $1,
                    "fechaConsulta" = $2,
                    "mdConceptoFinal" = $3,
                    "mdRecomendacionesMedicasAdicionales" = $4,
                    "mdObservacionesCertificado" = $5,
                    "_updatedDate" = NOW()
                WHERE "_id" = $6
                RETURNING *
            `;
            const result = await this.query(updateQuery, [
                atendido,
                fechaConsulta ? new Date(fechaConsulta) : new Date(),
                mdConceptoFinal || null,
                mdRecomendacionesMedicasAdicionales || null,
                mdObservacionesCertificado || null,
                wixId
            ]);
            return result.rows[0];
        } else {
            // INSERT
            const insertQuery = `
                INSERT INTO ${this.tableName} (
                    "_id", "numeroId", "primerNombre", "segundoNombre",
                    "primerApellido", "segundoApellido", "celular", "email",
                    "codEmpresa", "empresa", "cargo", "tipoExamen", "fechaAtencion",
                    "atendido", "fechaConsulta", "mdConceptoFinal",
                    "mdRecomendacionesMedicasAdicionales", "mdObservacionesCertificado",
                    "_createdDate", "_updatedDate"
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()
                )
                RETURNING *
            `;
            const result = await this.query(insertQuery, [
                wixId,
                numeroId,
                primerNombre,
                segundoNombre || null,
                primerApellido,
                segundoApellido || null,
                celular,
                email || null,
                codEmpresa || null,
                empresa || null,
                cargo || null,
                tipoExamen || null,
                fechaAtencion ? new Date(fechaAtencion) : null,
                atendido,
                fechaConsulta ? new Date(fechaConsulta) : new Date(),
                mdConceptoFinal || null,
                mdRecomendacionesMedicasAdicionales || null,
                mdObservacionesCertificado || null
            ]);
            return result.rows[0];
        }
    }

    /**
     * Verifica si hay duplicados pendientes
     * @param {string} numeroId
     * @param {string} codEmpresa - Opcional
     * @returns {Promise<Object|null>}
     */
    async findDuplicadoPendiente(numeroId, codEmpresa = null) {
        let query = `
            SELECT "_id", "numeroId", "primerNombre", "primerApellido",
                   "codEmpresa", "empresa", "tipoExamen", "atendido",
                   "_createdDate", "fechaAtencion"
            FROM ${this.tableName}
            WHERE "numeroId" = $1
            AND "atendido" = 'PENDIENTE'
        `;
        const params = [numeroId];

        if (codEmpresa) {
            query += ` AND "codEmpresa" = $2`;
            params.push(codEmpresa);
        }

        query += ` ORDER BY "_createdDate" DESC LIMIT 1`;

        const result = await this.query(query, params);
        return result.rows[0] || null;
    }

    /**
     * Actualiza fecha de atención
     * @param {string} id
     * @param {Date|string} fechaAtencion
     * @returns {Promise<Object|null>}
     */
    async actualizarFechaAtencion(id, fechaAtencion) {
        const query = `
            UPDATE ${this.tableName}
            SET "fechaAtencion" = $1, "_updatedDate" = NOW()
            WHERE "_id" = $2
            RETURNING *
        `;
        const result = await this.query(query, [new Date(fechaAtencion), id]);
        return result.rows[0] || null;
    }
}

module.exports = new HistoriaClinicaRepository();
