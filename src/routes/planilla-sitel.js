/**
 * Endpoint para generar planilla de la empresa SITEL
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

/**
 * GET /api/planilla-sitel?fechaDesde=YYYY-MM-DD&fechaHasta=YYYY-MM-DD
 * Retorna datos de pacientes SITEL con JOIN a formularios
 */
router.get('/', async (req, res) => {

    try {
        const { fechaDesde, fechaHasta } = req.query;

        if (!fechaDesde || !fechaHasta) {
            return res.status(400).json({ success: false, error: 'Se requieren fechaDesde y fechaHasta' });
        }

        const query = `
            SELECT
                hc."numeroId",
                hc."primerNombre",
                hc."segundoNombre",
                hc."primerApellido",
                hc."segundoApellido",
                f.genero,
                COALESCE(NULLIF(TRIM(hc."ciudad"), ''), 'Bogotá') AS ciudad,
                COALESCE(NULLIF(TRIM(hc."subempresa"), ''), 'FOUNDEVER') AS empresa,
                hc."centro_de_costo" AS subempresa,
                hc."cargo",
                UPPER(TRANSLATE(hc."tipoExamen", 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN')) AS tipo,
                hc."examenes",
                hc."fechaConsulta",
                CASE WHEN hc."medico" = 'PRESENCIAL' THEN 'PRESENCIAL' ELSE 'TELEMEDICINA' END AS tipo_atencion
            FROM "HistoriaClinica" hc
            LEFT JOIN formularios f ON f.wix_id = hc."_id"
            WHERE hc."codEmpresa" = 'SITEL'
              AND hc."fechaConsulta" >= $1
              AND hc."fechaConsulta" <= $2
            ORDER BY hc."fechaConsulta" DESC, hc."primerApellido" ASC
        `;

        const result = await pool.query(query, [fechaDesde, fechaHasta]);

        return res.json({
            success: true,
            data: result.rows,
            total: result.rows.length
        });

    } catch (error) {
        console.error('Error en planilla SITEL:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
