const BaseRepository = require('./BaseRepository');

/**
 * Repository para la tabla HistoriaClinica
 * Métodos específicos para consultas médicas
 *
 * Multi-tenant (ver CLAUDE.md sección "Multi-Tenant Architecture"):
 * Todos los métodos aceptan un tenantId opcional (default 'bsl' para
 * zero-regression). Las queries raw incluyen AND tenant_id = $N en WHERE
 * y tenant_id en INSERT/UPDATE.
 */
class HistoriaClinicaRepository extends BaseRepository {
    constructor() {
        super('"HistoriaClinica"');
    }

    /**
     * Busca por número de documento
     */
    async findByNumeroId(numeroId, tenantId = 'bsl') {
        return await this.findOne({ numeroId }, { tenantId });
    }

    /**
     * Busca múltiples registros por número de documento
     */
    async findAllByNumeroId(numeroId, tenantId = 'bsl') {
        return await this.findAll({ numeroId }, { tenantId });
    }

    /**
     * Busca por código de empresa
     */
    async findByEmpresa(codEmpresa, options = {}) {
        const { limit = 100, offset = 0, buscar, tenantId = 'bsl' } = options;

        let query = `
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre",
                   h."primerApellido", h."segundoApellido", h."codEmpresa", h."empresa",
                   h."cargo", h."tipoExamen", h."medico", h."atendido", h."fechaAtencion",
                   h."horaAtencion", h."examenes", h."ciudad", h."celular",
                   h."_createdDate", h."_updatedDate", h."fechaConsulta", h."aprobacion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales",
                   h."mdObservacionesCertificado", h."mdObsParaMiDocYa", h."centro_de_costo",
                   COALESCE(
                       (SELECT foto_url FROM formularios
                        WHERE (wix_id = h."_id" OR numero_id = h."numeroId")
                        AND foto_url IS NOT NULL
                        AND tenant_id = $2
                        ORDER BY fecha_registro DESC LIMIT 1),
                       h."foto_url"
                   ) as foto_url
            FROM ${this.tableName} h
            WHERE h."codEmpresa" = $1 AND h.tenant_id = $2
        `;

        const params = [codEmpresa, tenantId];
        let paramIndex = 3;

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
     */
    async countByEmpresa(codEmpresa, buscar = null, tenantId = 'bsl') {
        let query = `SELECT COUNT(*) FROM ${this.tableName} WHERE "codEmpresa" = $1 AND tenant_id = $2`;
        const params = [codEmpresa, tenantId];

        if (buscar) {
            query += ` AND (
                COALESCE("numeroId", '') || ' ' ||
                COALESCE("primerNombre", '') || ' ' ||
                COALESCE("primerApellido", '') || ' ' ||
                COALESCE("codEmpresa", '') || ' ' ||
                COALESCE("celular", '') || ' ' ||
                COALESCE("empresa", '')
            ) ILIKE $3`;
            params.push(`%${buscar}%`);
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count);
    }

    /**
     * Busca por celular
     */
    async findByCelular(celular, tenantId = 'bsl') {
        return await this.findOne({ celular }, { tenantId });
    }

    /**
     * Busca pacientes atendidos hoy por código de empresa
     */
    async findAtendidosHoy(codEmpresa, tenantId = 'bsl') {
        const query = `
            SELECT * FROM ${this.tableName}
            WHERE "codEmpresa" = $1
            AND "fechaConsulta" = CURRENT_DATE
            AND "atendido" = 'ATENDIDO'
            AND tenant_id = $2
            ORDER BY "_updatedDate" DESC
        `;
        const result = await this.query(query, [codEmpresa, tenantId]);
        return result.rows;
    }

    /**
     * Marca un registro como atendido (upsert)
     * @param {Object} data - Datos del registro
     * @param {string} tenantId - Tenant id (default 'bsl' — este método es BSL-only en la práctica,
     *                            usado por el flujo de sincronización con Wix)
     */
    async marcarAtendido(data, tenantId = 'bsl') {
        const {
            wixId,
            atendido = 'ATENDIDO',
            fechaConsulta,
            mdConceptoFinal,
            mdRecomendacionesMedicasAdicionales,
            mdObservacionesCertificado,
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
        const existente = await this.findById(wixId, '_id', tenantId);

        if (existente) {
            const updateQuery = `
                UPDATE ${this.tableName} SET
                    "atendido" = $1,
                    "fechaConsulta" = $2,
                    "mdConceptoFinal" = $3,
                    "mdRecomendacionesMedicasAdicionales" = $4,
                    "mdObservacionesCertificado" = $5,
                    "_updatedDate" = NOW()
                WHERE "_id" = $6 AND tenant_id = $7
                RETURNING *
            `;
            const result = await this.query(updateQuery, [
                atendido,
                fechaConsulta ? new Date(fechaConsulta) : new Date(),
                mdConceptoFinal || null,
                mdRecomendacionesMedicasAdicionales || null,
                mdObservacionesCertificado || null,
                wixId,
                tenantId
            ]);
            return result.rows[0];
        } else {
            const insertQuery = `
                INSERT INTO ${this.tableName} (
                    "_id", "numeroId", "primerNombre", "segundoNombre",
                    "primerApellido", "segundoApellido", "celular", "email",
                    "codEmpresa", "empresa", "cargo", "tipoExamen", "fechaAtencion",
                    "atendido", "fechaConsulta", "mdConceptoFinal",
                    "mdRecomendacionesMedicasAdicionales", "mdObservacionesCertificado",
                    "_createdDate", "_updatedDate", tenant_id
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW(), $19
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
                mdObservacionesCertificado || null,
                tenantId
            ]);
            return result.rows[0];
        }
    }

    /**
     * Verifica si hay duplicados pendientes
     */
    async findDuplicadoPendiente(numeroId, codEmpresa = null, tenantId = 'bsl') {
        let query = `
            SELECT "_id", "numeroId", "primerNombre", "primerApellido",
                   "codEmpresa", "empresa", "tipoExamen", "atendido",
                   "_createdDate", "fechaAtencion"
            FROM ${this.tableName}
            WHERE "numeroId" = $1
            AND "atendido" = 'PENDIENTE'
            AND tenant_id = $2
        `;
        const params = [numeroId, tenantId];

        if (codEmpresa) {
            query += ` AND "codEmpresa" = $3`;
            params.push(codEmpresa);
        }

        query += ` ORDER BY "_createdDate" DESC LIMIT 1`;

        const result = await this.query(query, params);
        return result.rows[0] || null;
    }

    /**
     * Actualiza fecha de atención
     */
    async actualizarFechaAtencion(id, fechaAtencion, tenantId = 'bsl') {
        const query = `
            UPDATE ${this.tableName}
            SET "fechaAtencion" = $1, "_updatedDate" = NOW()
            WHERE "_id" = $2 AND tenant_id = $3
            RETURNING *
        `;
        const result = await this.query(query, [new Date(fechaAtencion), id, tenantId]);
        return result.rows[0] || null;
    }

    /**
     * Busca duplicados atendidos por número de documento
     */
    async findDuplicadoAtendido(numeroId, codEmpresa = null, tenantId = 'bsl') {
        let query = `
            SELECT "_id", "numeroId", "primerNombre", "primerApellido",
                   "codEmpresa", "empresa", "tipoExamen", "atendido",
                   "_createdDate", "fechaAtencion"
            FROM ${this.tableName}
            WHERE "numeroId" = $1
            AND "atendido" = 'ATENDIDO'
            AND tenant_id = $2
        `;
        const params = [numeroId, tenantId];

        if (codEmpresa) {
            query += ` AND "codEmpresa" = $3`;
            params.push(codEmpresa);
        }

        query += ` ORDER BY "_createdDate" DESC LIMIT 1`;

        const result = await this.query(query, params);
        return result.rows[0] || null;
    }

    /**
     * Actualiza fecha de atención con médico (para PATCH)
     */
    async actualizarFechaAtencionConMedico(id, fechaCorrecta, medico = null, tenantId = 'bsl') {
        const query = `
            UPDATE ${this.tableName}
            SET "fechaAtencion" = $1,
                "horaAtencion" = NULL,
                "medico" = COALESCE($3, "medico")
            WHERE "_id" = $2 AND tenant_id = $4
            RETURNING "_id", "numeroId", "primerNombre", "primerApellido", "fechaAtencion", "medico"
        `;
        const result = await this.query(query, [fechaCorrecta, id, medico, tenantId]);
        return result.rows[0] || null;
    }

    /**
     * Obtiene estadísticas de programados/atendidos hoy por empresa
     */
    async getStatsHoy(codEmpresa, tenantId = 'bsl') {
        const hoy = new Date();
        const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
        const finHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

        const result = await this.query(`
            SELECT
                COUNT(*) FILTER (WHERE "fechaAtencion" >= $2 AND "fechaAtencion" <= $3) as programados_hoy,
                COUNT(*) FILTER (WHERE "fechaConsulta" >= $2 AND "fechaConsulta" <= $3) as atendidos_hoy
            FROM ${this.tableName}
            WHERE "codEmpresa" = $1 AND tenant_id = $4
        `, [codEmpresa, inicioHoy.toISOString(), finHoy.toISOString(), tenantId]);

        return {
            programadosHoy: parseInt(result.rows[0].programados_hoy) || 0,
            atendidosHoy: parseInt(result.rows[0].atendidos_hoy) || 0
        };
    }

    /**
     * Busca paciente por celular con normalización flexible
     */
    async findByCelularFlexible(celular, tenantId = 'bsl') {
        const celularLimpio = celular.replace(/\D/g, '');
        const celularSin57 = celularLimpio.startsWith('57') ? celularLimpio.substring(2) : celularLimpio;

        const query = `
            SELECT h.*
            FROM ${this.tableName} h
            WHERE (h."celular" = $1
               OR h."celular" = $2
               OR h."celular" = $3
               OR REPLACE(h."celular", ' ', '') = $1
               OR REPLACE(h."celular", ' ', '') = $2
               OR REPLACE(h."celular", ' ', '') = $3)
               AND h.tenant_id = $4
            ORDER BY h."_createdDate" DESC
            LIMIT 1
        `;
        const result = await this.query(query, [celular, celularLimpio, celularSin57, tenantId]);
        return result.rows[0] || null;
    }

    /**
     * Lista con paginación, búsqueda y foto del formulario vinculado
     */
    async listWithFoto(options = {}) {
        const { page = 1, limit = 20, buscar, cedulas, tenantId = 'bsl' } = options;
        const offset = (page - 1) * limit;

        let whereClause = `WHERE h.tenant_id = $1`;
        const params = [tenantId];
        let paramIndex = 2;

        if (cedulas && cedulas.length > 0) {
            whereClause += ` AND h."numeroId" = ANY($${paramIndex})`;
            params.push(cedulas);
            paramIndex++;
        } else if (buscar && buscar.length >= 2) {
            whereClause += ` AND (
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

        // Count
        let totalRegistros;
        if ((cedulas && cedulas.length > 0) || (buscar && buscar.length >= 2)) {
            const countResult = await this.query(
                `SELECT COUNT(*) FROM ${this.tableName} h ${whereClause}`, params
            );
            totalRegistros = parseInt(countResult.rows[0].count);
        } else {
            // Sin filtros: usar COUNT real scoped por tenant (no pg_class estimate,
            // porque esa estimación no puede filtrarse por tenant_id).
            const countResult = await this.query(
                `SELECT COUNT(*) FROM ${this.tableName} WHERE tenant_id = $1`, [tenantId]
            );
            totalRegistros = parseInt(countResult.rows[0].count);
        }

        const totalPaginas = Math.ceil(totalRegistros / limit);

        // Data
        params.push(limit, offset);
        const limitParam = `$${paramIndex}`;
        const offsetParam = `$${paramIndex + 1}`;

        const result = await this.query(`
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre", h."primerApellido", h."segundoApellido",
                   h."celular", h."cargo", h."ciudad", h."tipoExamen", h."codEmpresa", h."empresa", h."medico",
                   h."atendido", h."examenes", h."_createdDate", h."fechaConsulta", h."fechaAtencion", h."horaAtencion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado", h."mdObsParaMiDocYa",
                   h."pvEstado",
                   'historia' as origen,
                   COALESCE(f_exact.foto_url, f_fallback.foto_url, h."foto_url") as foto_url
            FROM ${this.tableName} h
            LEFT JOIN formularios f_exact ON f_exact.wix_id = h."_id" AND f_exact.tenant_id = h.tenant_id
            LEFT JOIN LATERAL (
                SELECT foto_url FROM formularios
                WHERE numero_id = h."numeroId" AND foto_url IS NOT NULL AND tenant_id = h.tenant_id
                ORDER BY fecha_registro DESC LIMIT 1
            ) f_fallback ON f_exact.id IS NULL
            ${whereClause}
            ORDER BY h."_createdDate" DESC
            LIMIT ${limitParam} OFFSET ${offsetParam}
        `, params);

        return {
            rows: result.rows,
            total: totalRegistros,
            totalPaginas
        };
    }

    /**
     * Búsqueda con foto (para endpoint /buscar)
     */
    async buscarConFoto(termino, limit = 100, tenantId = 'bsl') {
        const result = await this.query(`
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre",
                   h."primerApellido", h."segundoApellido", h."celular", h."cargo",
                   h."ciudad", h."tipoExamen", h."codEmpresa", h."empresa", h."medico",
                   h."atendido", h."examenes", h."_createdDate", h."fechaConsulta",
                   h."fechaAtencion", h."horaAtencion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado", h."mdObsParaMiDocYa",
                   'historia' as origen,
                   COALESCE(f_exact.foto_url, f_fallback.foto_url, h."foto_url") as foto_url
            FROM ${this.tableName} h
            LEFT JOIN formularios f_exact ON f_exact.wix_id = h."_id" AND f_exact.tenant_id = h.tenant_id
            LEFT JOIN LATERAL (
                SELECT foto_url FROM formularios
                WHERE numero_id = h."numeroId" AND foto_url IS NOT NULL AND tenant_id = h.tenant_id
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
            AND h.tenant_id = $3
            ORDER BY h."_createdDate" DESC
            LIMIT $2
        `, [`%${termino}%`, limit, tenantId]);

        return result.rows;
    }

    /**
     * Toggle estado de pago
     */
    async togglePago(id, tenantId = 'bsl') {
        const current = await this.query(
            `SELECT "pagado", "numeroId" FROM ${this.tableName} WHERE "_id" = $1 AND tenant_id = $2`,
            [id, tenantId]
        );
        if (current.rows.length === 0) return null;

        const estadoActual = current.rows[0].pagado || false;
        const nuevoEstado = !estadoActual;
        const pvEstado = nuevoEstado ? 'Pagado' : '';

        await this.query(
            `UPDATE ${this.tableName} SET "pagado" = $1, "pvEstado" = $2 WHERE "_id" = $3 AND tenant_id = $4`,
            [nuevoEstado, pvEstado, id, tenantId]
        );

        return {
            pagado: nuevoEstado,
            pvEstado,
            numeroId: current.rows[0].numeroId
        };
    }

    /**
     * Lista registros de asistencia SIIGO con paginación (BSL-only)
     */
    async findAsistenciaSiigo(options = {}) {
        const { page = 1, limit = 20, buscar, estado, fechaDesde, fechaHasta, tenantId = 'bsl' } = options;
        const offset = (page - 1) * limit;

        let whereClause = `WHERE "codEmpresa" = 'SIIGO' AND "fechaAtencion" < CURRENT_DATE AND tenant_id = $1`;
        const params = [tenantId];
        let paramIndex = 2;

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
                   "fechaAtencion", "fechaConsulta", "ciudad", "celular", "atendido",
                   "observaciones_siigo"
            FROM ${this.tableName}
            ${whereClause}
            ORDER BY CASE WHEN "atendido" = 'PENDIENTE' OR "atendido" IS NULL OR "atendido" = '' THEN 0 ELSE 1 END,
                     "fechaAtencion" DESC NULLS LAST, "_createdDate" DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, dataParams);

        return { rows: result.rows, total, totalPaginas };
    }

    /**
     * Upsert de registros de asistencia SIIGO (BSL-only)
     */
    async upsertAsistenciaSiigo(registros, tenantId = 'bsl') {
        let creados = 0;
        let actualizados = 0;
        const errores = [];

        for (const reg of registros) {
            try {
                if (!reg.numeroId) {
                    errores.push({ numeroId: reg.numeroId, error: 'Sin número de documento' });
                    continue;
                }

                const existente = await this.query(`
                    SELECT "_id" FROM ${this.tableName}
                    WHERE "numeroId" = $1 AND "codEmpresa" = 'SIIGO' AND tenant_id = $2
                    ORDER BY "_createdDate" DESC LIMIT 1
                `, [reg.numeroId, tenantId]);

                if (existente.rows.length > 0) {
                    await this.query(`
                        UPDATE ${this.tableName} SET
                            "primerNombre" = COALESCE($1, "primerNombre"),
                            "primerApellido" = COALESCE($2, "primerApellido"),
                            "ciudad" = COALESCE($3, "ciudad"),
                            "celular" = COALESCE($4, "celular"),
                            "fechaAtencion" = COALESCE($5, "fechaAtencion"),
                            "atendido" = COALESCE($6, "atendido"),
                            "cargo" = COALESCE($7, "cargo"),
                            "email" = COALESCE($8, "email"),
                            "observaciones_siigo" = COALESCE($9, "observaciones_siigo"),
                            "_updatedDate" = NOW()
                        WHERE "_id" = $10 AND tenant_id = $11
                    `, [
                        reg.primerNombre || null,
                        reg.primerApellido || null,
                        reg.ciudad || null,
                        reg.celular || null,
                        reg.fechaAtencion || null,
                        reg.atendido || null,
                        reg.cargo || null,
                        reg.email || null,
                        reg.observaciones_siigo || null,
                        existente.rows[0]._id,
                        tenantId
                    ]);
                    actualizados++;
                } else {
                    const id = `siigo_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    await this.query(`
                        INSERT INTO ${this.tableName} (
                            "_id", "numeroId", "primerNombre", "primerApellido",
                            "ciudad", "celular", "fechaAtencion",
                            "atendido", "cargo", "email", "observaciones_siigo",
                            "codEmpresa", "_createdDate", "_updatedDate", tenant_id
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'SIIGO', NOW(), NOW(), $12)
                    `, [
                        id,
                        reg.numeroId,
                        reg.primerNombre || null,
                        reg.primerApellido || null,
                        reg.ciudad || null,
                        reg.celular || null,
                        reg.fechaAtencion || null,
                        reg.atendido || 'PENDIENTE',
                        reg.cargo || null,
                        reg.email || null,
                        reg.observaciones_siigo || null,
                        tenantId
                    ]);
                    creados++;
                }
            } catch (error) {
                errores.push({ numeroId: reg.numeroId, error: error.message });
            }
        }

        return { creados, actualizados, errores };
    }

    /**
     * Obtiene estadísticas de órdenes por empresa
     */
    async getEstadisticasOrdenes(codEmpresa, tenantId = 'bsl') {
        const query = `
            SELECT
                COUNT(*) as total_ordenes,
                COUNT(*) FILTER (WHERE "atendido" = 'ATENDIDO') as atendidos,
                COUNT(*) FILTER (WHERE "atendido" = 'PENDIENTE') as pendientes
            FROM ${this.tableName}
            WHERE UPPER("codEmpresa") = UPPER($1) AND tenant_id = $2
        `;
        const result = await this.query(query, [codEmpresa, tenantId]);
        return result.rows[0];
    }
}

module.exports = new HistoriaClinicaRepository();
