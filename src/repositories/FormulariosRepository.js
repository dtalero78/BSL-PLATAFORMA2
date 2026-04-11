const BaseRepository = require('./BaseRepository');

/**
 * Repository para la tabla formularios
 * Métodos específicos para formularios de pacientes
 *
 * Multi-tenant (ver CLAUDE.md): todos los métodos aceptan tenantId opcional (default 'bsl').
 */
class FormulariosRepository extends BaseRepository {
    constructor() {
        super('formularios');
    }

    async findByNumeroId(numeroId, tenantId = 'bsl') {
        return await this.findOne({ numero_id: numeroId }, { tenantId });
    }

    async findAllByNumeroId(numeroId, options = {}) {
        const defaultOptions = {
            orderBy: 'fecha_registro',
            orderDir: 'DESC',
            tenantId: 'bsl',
            ...options
        };
        return await this.findAll({ numero_id: numeroId }, defaultOptions);
    }

    async findByWixId(wixId, tenantId = 'bsl') {
        return await this.findOne({ wix_id: wixId }, { tenantId });
    }

    async findByCelular(celular, tenantId = 'bsl') {
        return await this.findOne({ celular }, { tenantId });
    }

    async findAllByCelular(celular, options = {}) {
        const defaultOptions = {
            orderBy: 'fecha_registro',
            orderDir: 'DESC',
            tenantId: 'bsl',
            ...options
        };
        return await this.findAll({ celular }, defaultOptions);
    }

    async findByCodEmpresa(codEmpresa, options = {}) {
        const { limit = 100, offset = 0, buscar, tenantId = 'bsl' } = options;

        let query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "cod_empresa" = $1 AND tenant_id = $2
        `;

        const params = [codEmpresa, tenantId];
        let paramIndex = 3;

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

    async countByCodEmpresa(codEmpresa, buscar = null, tenantId = 'bsl') {
        let query = `SELECT COUNT(*) FROM ${this.tableName} WHERE "cod_empresa" = $1 AND tenant_id = $2`;
        const params = [codEmpresa, tenantId];

        if (buscar) {
            query += ` AND (
                COALESCE("numero_id", '') || ' ' ||
                COALESCE("primer_nombre", '') || ' ' ||
                COALESCE("primer_apellido", '') || ' ' ||
                COALESCE("celular", '') || ' ' ||
                COALESCE("email", '')
            ) ILIKE $3`;
            params.push(`%${buscar}%`);
        }

        const result = await this.query(query, params);
        return parseInt(result.rows[0].count);
    }

    async findRecientes(dias = 7, options = {}) {
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

    async findConFoto(filters = {}, options = {}) {
        const { limit, offset, tenantId = 'bsl' } = options;

        const mergedFilters = filters.tenant_id !== undefined
            ? filters
            : { ...filters, tenant_id: tenantId };

        let query = `SELECT * FROM ${this.tableName} WHERE "foto_url" IS NOT NULL`;
        const params = [];
        let paramIndex = 1;

        const filterKeys = Object.keys(mergedFilters);
        if (filterKeys.length > 0) {
            const whereClauses = filterKeys.map(key => {
                params.push(mergedFilters[key]);
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

    async actualizarFotoUrl(id, fotoUrl, tenantId = 'bsl') {
        return await this.update(id, { foto_url: fotoUrl }, 'id', tenantId);
    }

    async findUltimoPorNumeroId(numeroId, tenantId = 'bsl') {
        const query = `
            SELECT *
            FROM ${this.tableName}
            WHERE "numero_id" = $1 AND tenant_id = $2
            ORDER BY "fecha_registro" DESC
            LIMIT 1
        `;
        const result = await this.query(query, [numeroId, tenantId]);
        return result.rows[0] || null;
    }

    async findByWixIdOrNumeroId(wixId, numeroId, tenantId = 'bsl') {
        const query = `
            SELECT id FROM ${this.tableName}
            WHERE (wix_id = $1 OR numero_id = $2)
              AND tenant_id = $3
            LIMIT 1
        `;
        const result = await this.query(query, [wixId, numeroId, tenantId]);
        return result.rows[0] || null;
    }

    async getEstadisticasSalud(codEmpresa, tenantId = 'bsl') {
        const query = `
            SELECT
                COUNT(*) as total_empleados,
                COUNT(*) FILTER (WHERE UPPER(fuma) = 'SI') as fumadores,
                COUNT(*) FILTER (WHERE UPPER(presion_alta) = 'SI') as presion_alta,
                COUNT(*) FILTER (WHERE UPPER(problemas_cardiacos) = 'SI') as problemas_cardiacos,
                COUNT(*) FILTER (WHERE UPPER(problemas_azucar) = 'SI') as diabetes,
                COUNT(*) FILTER (WHERE UPPER(hormigueos) = 'SI') as hormigueos,
                COUNT(*) FILTER (WHERE UPPER(dolor_espalda) = 'SI') as dolor_espalda,
                COUNT(*) FILTER (WHERE UPPER(dolor_cabeza) = 'SI') as dolor_cabeza,
                COUNT(*) FILTER (WHERE UPPER(problemas_sueno) = 'SI') as problemas_sueno,
                COUNT(*) FILTER (WHERE UPPER(embarazo) = 'SI') as embarazos,
                COUNT(*) FILTER (WHERE UPPER(hernias) = 'SI') as hernias,
                COUNT(*) FILTER (WHERE UPPER(varices) = 'SI') as varices,
                COUNT(*) FILTER (WHERE UPPER(hepatitis) = 'SI') as hepatitis,
                COUNT(*) FILTER (WHERE UPPER(enfermedad_higado) = 'SI') as enfermedad_higado,
                COUNT(*) FILTER (WHERE UPPER(enfermedad_pulmonar) = 'SI') as enfermedad_pulmonar,
                COUNT(*) FILTER (WHERE UPPER(cirugia_ocular) = 'SI') as cirugia_ocular,
                COUNT(*) FILTER (WHERE UPPER(usa_anteojos) = 'SI') as usa_anteojos,
                COUNT(*) FILTER (WHERE UPPER(usa_lentes_contacto) = 'SI') as usa_lentes_contacto,
                COUNT(*) FILTER (WHERE UPPER(condicion_medica) = 'SI') as condicion_medica_tratamiento,
                COUNT(*) FILTER (WHERE UPPER(trastorno_psicologico) = 'SI') as trastorno_psicologico,
                COUNT(*) FILTER (WHERE UPPER(sintomas_psicologicos) = 'SI') as sintomas_psicologicos,
                COUNT(*) FILTER (WHERE UPPER(diagnostico_cancer) = 'SI') as diagnostico_cancer,
                COUNT(*) FILTER (WHERE UPPER(enfermedades_laborales) = 'SI') as enfermedades_laborales,
                COUNT(*) FILTER (WHERE UPPER(enfermedad_osteomuscular) = 'SI') as enfermedad_osteomuscular,
                COUNT(*) FILTER (WHERE UPPER(enfermedad_autoinmune) = 'SI') as enfermedad_autoinmune,
                COUNT(*) FILTER (WHERE UPPER(genero) = 'MASCULINO') as hombres,
                COUNT(*) FILTER (WHERE UPPER(genero) = 'FEMENINO') as mujeres,
                ROUND(AVG(edad)::numeric, 1) as edad_promedio,
                MIN(edad) as edad_minima,
                MAX(edad) as edad_maxima,
                COUNT(*) FILTER (WHERE UPPER(familia_diabetes) = 'SI') as familia_diabetes,
                COUNT(*) FILTER (WHERE UPPER(familia_hipertension) = 'SI') as familia_hipertension,
                COUNT(*) FILTER (WHERE UPPER(familia_cancer) = 'SI') as familia_cancer,
                COUNT(*) FILTER (WHERE UPPER(familia_infartos) = 'SI') as familia_infartos,
                COUNT(*) FILTER (WHERE UPPER(familia_trastornos) = 'SI') as familia_trastornos_mentales,
                COUNT(*) FILTER (WHERE UPPER(familia_hereditarias) = 'SI') as familia_enfermedades_hereditarias,
                COUNT(*) FILTER (WHERE UPPER(familia_geneticas) = 'SI') as familia_enfermedades_geneticas,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) = 'NUNCA') as licor_nunca,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) = 'OCASIONALMENTE') as licor_ocasional,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) = '1 DIA SEMANAL' OR UPPER(consumo_licor) = '1 DIA SEMANAL') as licor_1_dia,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) = '2 DIAS SEMANALES' OR UPPER(consumo_licor) = '2 DIAS SEMANALES') as licor_2_dias,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) LIKE '%+ DE 2%' OR UPPER(consumo_licor) LIKE '%MAS DE 2%') as licor_mas_2_dias,
                COUNT(*) FILTER (WHERE UPPER(ejercicio) = 'OCASIONALMENTE') as ejercicio_ocasional,
                COUNT(*) FILTER (WHERE UPPER(ejercicio) = '1 DIA SEMANAL' OR UPPER(ejercicio) = '1 DIA SEMANAL') as ejercicio_1_dia,
                COUNT(*) FILTER (WHERE UPPER(ejercicio) = '2 DIAS SEMANALES' OR UPPER(ejercicio) = '2 DIAS SEMANALES') as ejercicio_2_dias,
                COUNT(*) FILTER (WHERE UPPER(ejercicio) LIKE '%+ DE 2%' OR UPPER(ejercicio) LIKE '%MAS DE 2%') as ejercicio_mas_2_dias
            FROM ${this.tableName}
            WHERE UPPER(cod_empresa) = UPPER($1) AND tenant_id = $2
        `;
        const result = await this.query(query, [codEmpresa, tenantId]);
        return result.rows[0];
    }
}

module.exports = new FormulariosRepository();
