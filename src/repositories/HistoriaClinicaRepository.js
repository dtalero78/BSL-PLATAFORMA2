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

    /**
     * Busca duplicados atendidos por número de documento
     * @param {string} numeroId
     * @param {string} codEmpresa - Opcional
     * @returns {Promise<Object|null>}
     */
    async findDuplicadoAtendido(numeroId, codEmpresa = null) {
        let query = `
            SELECT "_id", "numeroId", "primerNombre", "primerApellido",
                   "codEmpresa", "empresa", "tipoExamen", "atendido",
                   "_createdDate", "fechaAtencion"
            FROM ${this.tableName}
            WHERE "numeroId" = $1
            AND "atendido" = 'ATENDIDO'
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
     * Actualiza fecha de atención con médico (para PATCH)
     * @param {string} id
     * @param {Date} fechaCorrecta
     * @param {string|null} medico
     * @returns {Promise<Object|null>}
     */
    async actualizarFechaAtencionConMedico(id, fechaCorrecta, medico = null) {
        const query = `
            UPDATE ${this.tableName}
            SET "fechaAtencion" = $1,
                "horaAtencion" = NULL,
                "medico" = COALESCE($3, "medico")
            WHERE "_id" = $2
            RETURNING "_id", "numeroId", "primerNombre", "primerApellido", "fechaAtencion", "medico"
        `;
        const result = await this.query(query, [fechaCorrecta, id, medico]);
        return result.rows[0] || null;
    }

    /**
     * Obtiene estadísticas de programados/atendidos hoy por empresa
     * @param {string} codEmpresa
     * @returns {Promise<{programadosHoy: number, atendidosHoy: number}>}
     */
    async getStatsHoy(codEmpresa) {
        const hoy = new Date();
        const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
        const finHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

        const result = await this.query(`
            SELECT
                COUNT(*) FILTER (WHERE "fechaAtencion" >= $2 AND "fechaAtencion" <= $3) as programados_hoy,
                COUNT(*) FILTER (WHERE "fechaConsulta" >= $2 AND "fechaConsulta" <= $3) as atendidos_hoy
            FROM ${this.tableName}
            WHERE "codEmpresa" = $1
        `, [codEmpresa, inicioHoy.toISOString(), finHoy.toISOString()]);

        return {
            programadosHoy: parseInt(result.rows[0].programados_hoy) || 0,
            atendidosHoy: parseInt(result.rows[0].atendidos_hoy) || 0
        };
    }

    /**
     * Busca paciente por celular con normalización flexible
     * @param {string} celular
     * @returns {Promise<Object|null>}
     */
    async findByCelularFlexible(celular) {
        const celularLimpio = celular.replace(/\D/g, '');
        const celularSin57 = celularLimpio.startsWith('57') ? celularLimpio.substring(2) : celularLimpio;

        const query = `
            SELECT h.*
            FROM ${this.tableName} h
            WHERE h."celular" = $1
               OR h."celular" = $2
               OR h."celular" = $3
               OR REPLACE(h."celular", ' ', '') = $1
               OR REPLACE(h."celular", ' ', '') = $2
               OR REPLACE(h."celular", ' ', '') = $3
            ORDER BY h."_createdDate" DESC
            LIMIT 1
        `;
        const result = await this.query(query, [celular, celularLimpio, celularSin57]);
        return result.rows[0] || null;
    }

    /**
     * Lista con paginación, búsqueda y foto del formulario vinculado
     * @param {Object} options - {page, limit, buscar}
     * @returns {Promise<{rows: Array, total: number, totalPaginas: number}>}
     */
    async listWithFoto(options = {}) {
        const { page = 1, limit = 20, buscar } = options;
        const offset = (page - 1) * limit;

        let whereClause = '';
        const params = [];

        if (buscar && buscar.length >= 2) {
            whereClause = `WHERE (
                COALESCE(h."numeroId", '') || ' ' ||
                COALESCE(h."primerNombre", '') || ' ' ||
                COALESCE(h."primerApellido", '') || ' ' ||
                COALESCE(h."codEmpresa", '') || ' ' ||
                COALESCE(h."celular", '') || ' ' ||
                COALESCE(h."empresa", '')
            ) ILIKE $1`;
            params.push(`%${buscar}%`);
        }

        // Count
        let totalRegistros;
        if (buscar && buscar.length >= 2) {
            const countResult = await this.query(
                `SELECT COUNT(*) FROM ${this.tableName} h ${whereClause}`, params
            );
            totalRegistros = parseInt(countResult.rows[0].count);
        } else {
            const countResult = await this.query(
                `SELECT reltuples::bigint as estimate FROM pg_class WHERE relname = 'HistoriaClinica'`
            );
            totalRegistros = parseInt(countResult.rows[0].estimate) || 0;
        }

        const totalPaginas = Math.ceil(totalRegistros / limit);

        // Data
        const queryParams = buscar ? [...params, limit, offset] : [limit, offset];
        const limitParam = buscar ? '$2' : '$1';
        const offsetParam = buscar ? '$3' : '$2';

        const result = await this.query(`
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre", h."primerApellido", h."segundoApellido",
                   h."celular", h."cargo", h."ciudad", h."tipoExamen", h."codEmpresa", h."empresa", h."medico",
                   h."atendido", h."examenes", h."_createdDate", h."fechaConsulta", h."fechaAtencion", h."horaAtencion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado", h."mdObsParaMiDocYa",
                   h."pvEstado",
                   'historia' as origen,
                   COALESCE(f_exact.foto_url, f_fallback.foto_url) as foto_url
            FROM ${this.tableName} h
            LEFT JOIN formularios f_exact ON f_exact.wix_id = h."_id"
            LEFT JOIN LATERAL (
                SELECT foto_url FROM formularios
                WHERE numero_id = h."numeroId" AND foto_url IS NOT NULL
                ORDER BY fecha_registro DESC LIMIT 1
            ) f_fallback ON f_exact.id IS NULL
            ${whereClause}
            ORDER BY h."_createdDate" DESC
            LIMIT ${limitParam} OFFSET ${offsetParam}
        `, queryParams);

        return {
            rows: result.rows,
            total: totalRegistros,
            totalPaginas
        };
    }

    /**
     * Búsqueda con foto (para endpoint /buscar)
     * @param {string} termino
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    async buscarConFoto(termino, limit = 100) {
        const result = await this.query(`
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre",
                   h."primerApellido", h."segundoApellido", h."celular", h."cargo",
                   h."ciudad", h."tipoExamen", h."codEmpresa", h."empresa", h."medico",
                   h."atendido", h."examenes", h."_createdDate", h."fechaConsulta",
                   h."fechaAtencion", h."horaAtencion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado", h."mdObsParaMiDocYa",
                   'historia' as origen,
                   COALESCE(f_exact.foto_url, f_fallback.foto_url) as foto_url
            FROM ${this.tableName} h
            LEFT JOIN formularios f_exact ON f_exact.wix_id = h."_id"
            LEFT JOIN LATERAL (
                SELECT foto_url FROM formularios
                WHERE numero_id = h."numeroId" AND foto_url IS NOT NULL
                ORDER BY fecha_registro DESC LIMIT 1
            ) f_fallback ON f_exact.id IS NULL
            WHERE (
                COALESCE(h."numeroId", '') || ' ' ||
                COALESCE(h."primerNombre", '') || ' ' ||
                COALESCE(h."primerApellido", '') || ' ' ||
                COALESCE(h."codEmpresa", '') || ' ' ||
                COALESCE(h."celular", '') || ' ' ||
                COALESCE(h."empresa", '')
            ) ILIKE $1
            ORDER BY h."_createdDate" DESC
            LIMIT $2
        `, [`%${termino}%`, limit]);

        return result.rows;
    }

    /**
     * Toggle estado de pago
     * @param {string} id
     * @returns {Promise<{pagado: boolean, pvEstado: string, numeroId: string}>}
     */
    async togglePago(id) {
        const current = await this.query(
            `SELECT "pagado", "numeroId" FROM ${this.tableName} WHERE "_id" = $1`, [id]
        );
        if (current.rows.length === 0) return null;

        const estadoActual = current.rows[0].pagado || false;
        const nuevoEstado = !estadoActual;
        const pvEstado = nuevoEstado ? 'Pagado' : '';

        await this.query(
            `UPDATE ${this.tableName} SET "pagado" = $1, "pvEstado" = $2 WHERE "_id" = $3`,
            [nuevoEstado, pvEstado, id]
        );

        return {
            pagado: nuevoEstado,
            pvEstado,
            numeroId: current.rows[0].numeroId
        };
    }

    /**
     * Lista registros de asistencia SIIGO con paginación, búsqueda y filtros
     * @param {Object} options - {page, limit, buscar, estado, fechaDesde, fechaHasta}
     * @returns {Promise<{rows: Array, total: number, totalPaginas: number}>}
     */
    async findAsistenciaSiigo(options = {}) {
        const { page = 1, limit = 20, buscar, estado, fechaDesde, fechaHasta } = options;
        const offset = (page - 1) * limit;

        let whereClause = `WHERE "codEmpresa" = 'SIIGO'`;
        const params = [];
        let paramIndex = 1;

        if (estado === 'ATENDIDO') {
            whereClause += ` AND "atendido" = 'ATENDIDO'`;
        } else if (estado === 'PENDIENTE') {
            whereClause += ` AND ("atendido" IS NULL OR "atendido" = '' OR "atendido" = 'PENDIENTE')`;
        }

        if (fechaDesde) {
            whereClause += ` AND "fechaAtencion" >= $${paramIndex}`;
            params.push(fechaDesde);
            paramIndex++;
        }
        if (fechaHasta) {
            whereClause += ` AND "fechaAtencion" < ($${paramIndex}::date + interval '1 day')`;
            params.push(fechaHasta);
            paramIndex++;
        }

        if (buscar && buscar.length >= 2) {
            whereClause += ` AND (
                COALESCE("numeroId", '') || ' ' ||
                COALESCE("primerNombre", '') || ' ' ||
                COALESCE("primerApellido", '') || ' ' ||
                COALESCE("celular", '')
            ) ILIKE $${paramIndex}`;
            params.push(`%${buscar}%`);
            paramIndex++;
        }

        const countResult = await this.query(
            `SELECT COUNT(*) FROM ${this.tableName} ${whereClause}`, params
        );
        const total = parseInt(countResult.rows[0].count);
        const totalPaginas = Math.ceil(total / limit);

        const dataParams = [...params, limit, offset];
        const result = await this.query(`
            SELECT "_id", "numeroId", "primerNombre", "primerApellido",
                   "fechaAtencion", "fechaConsulta", "ciudad", "celular", "atendido"
            FROM ${this.tableName}
            ${whereClause}
            ORDER BY CASE WHEN "atendido" = 'PENDIENTE' OR "atendido" IS NULL OR "atendido" = '' THEN 0 ELSE 1 END,
                     "fechaAtencion" DESC NULLS LAST, "_createdDate" DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, dataParams);

        return { rows: result.rows, total, totalPaginas };
    }

    /**
     * Obtiene estadísticas de órdenes por empresa
     * @param {string} codEmpresa
     * @returns {Promise<Object>}
     */
    async getEstadisticasOrdenes(codEmpresa) {
        const query = `
            SELECT
                COUNT(*) as total_ordenes,
                COUNT(*) FILTER (WHERE "atendido" = 'ATENDIDO') as atendidos,
                COUNT(*) FILTER (WHERE "atendido" = 'PENDIENTE') as pendientes
            FROM ${this.tableName}
            WHERE UPPER("codEmpresa") = UPPER($1)
        `;
        const result = await this.query(query, [codEmpresa]);
        return result.rows[0];
    }
}

module.exports = new HistoriaClinicaRepository();
