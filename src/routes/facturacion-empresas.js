/**
 * Endpoints para visualización de facturación por empresa
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

const EMPRESAS_EXCLUIDAS = [
    'SANITHELP-JJ', 'SITEL', 'PARTICULAR', 'EMPRESA', 'CP360', 'PHIDIAS',
    'WIKIMEDIA', 'OMEGA', 'Geocol', 'LA DISEÑO Y DECORACION', 'SIN LIMITE',
    'universidad de antioquia', 'CRAVO', 'GEMA', 'ESMERALDAS', 'AEROCIVIL',
    'NEUROAXIS', 'EBAD', 'GODRONE', '360INTEL', 'ARQUIND', 'ATR',
    'Christi SAS', 'dmental', 'INTECHSYS', 'universidad tecnológica de antioquia',
    'OBRAS', 'COLCHONES MOON', 'EKIP', 'colchones moon', 'ESMERALDA',
    'HUMA', 'INGENIERIAYDESARROLLO', 'K&G', 'OBRA Y CONSTRUCCIONES',
    'CBINGENIEROS', 'CAYENA', 'SIERGROUP', 'AQUA', 'SIIGO', 'RO LTDA'
];

/**
 * GET /api/facturacion-empresas/empresas-a-facturar
 * Retorna resumen agrupado por empresa y detalle de pacientes pendientes de facturar
 */
router.get('/empresas-a-facturar', async (req, res) => {

    try {
        const { fechaDesde, fechaHasta } = req.query;

        if (!fechaDesde || !fechaHasta) {
            return res.status(400).json({ success: false, error: 'Se requieren fechaDesde y fechaHasta' });
        }

        const placeholders = EMPRESAS_EXCLUIDAS.map((_, i) => `$${i + 3}`).join(', ');

        const params = [fechaDesde, fechaHasta, ...EMPRESAS_EXCLUIDAS];

        const resumenQuery = `
            SELECT
                "codEmpresa",
                MAX("empresa") as empresa,
                COUNT(DISTINCT "numeroId") as total_pacientes,
                COUNT(*) as total_registros
            FROM "HistoriaClinica"
            WHERE "atendido" = 'ATENDIDO'
              AND (pagado IS NULL OR pagado::text = 'false')
              AND "fechaConsulta" >= $1
              AND "fechaConsulta" <= $2
              AND "codEmpresa" NOT IN (${placeholders})
              AND "codEmpresa" IS NOT NULL
              AND "codEmpresa" != ''
            GROUP BY "codEmpresa"
            ORDER BY "codEmpresa" ASC
        `;

        const detalleQuery = `
            SELECT
                "fechaConsulta",
                "codEmpresa",
                "empresa",
                "tipoExamen",
                "ciudad",
                "numeroId",
                "primerApellido",
                "primerNombre",
                "examenes"
            FROM "HistoriaClinica"
            WHERE "atendido" = 'ATENDIDO'
              AND (pagado IS NULL OR pagado::text = 'false')
              AND "fechaConsulta" >= $1
              AND "fechaConsulta" <= $2
              AND "codEmpresa" NOT IN (${placeholders})
              AND "codEmpresa" IS NOT NULL
              AND "codEmpresa" != ''
            ORDER BY "codEmpresa" ASC, "fechaConsulta" DESC
        `;

        const [resumenResult, detalleResult] = await Promise.all([
            pool.query(resumenQuery, params),
            pool.query(detalleQuery, params)
        ]);

        const totalPacientes = resumenResult.rows.reduce((acc, r) => acc + parseInt(r.total_pacientes), 0);

        return res.json({
            success: true,
            resumen: resumenResult.rows,
            detalle: detalleResult.rows,
            total_empresas: resumenResult.rows.length,
            total_pacientes: totalPacientes
        });

    } catch (error) {
        console.error('Error en /empresas-a-facturar:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
