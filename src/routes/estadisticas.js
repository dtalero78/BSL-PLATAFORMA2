const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const pool = require('../config/database');

/**
 * GET /api/estadisticas/movimiento
 * Obtiene estadísticas de movimiento de pacientes por rango de fechas
 * Query params: fechaInicial, fechaFinal (formato YYYY-MM-DD)
 */
router.get('/movimiento', authMiddleware, async (req, res) => {
    try {
        const { fechaInicial, fechaFinal } = req.query;

        // Validar parámetros
        if (!fechaInicial || !fechaFinal) {
            return res.status(400).json({
                success: false,
                message: 'Se requieren fechaInicial y fechaFinal'
            });
        }

        // Validar formato de fechas
        const regexFecha = /^\d{4}-\d{2}-\d{2}$/;
        if (!regexFecha.test(fechaInicial) || !regexFecha.test(fechaFinal)) {
            return res.status(400).json({
                success: false,
                message: 'Formato de fecha inválido. Use YYYY-MM-DD'
            });
        }

        // Validar que fechaInicial <= fechaFinal
        if (new Date(fechaInicial) > new Date(fechaFinal)) {
            return res.status(400).json({
                success: false,
                message: 'La fecha inicial no puede ser mayor a la fecha final'
            });
        }

        // Crear objetos Date para comparación (como en HistoriaClinicaRepository.getStatsHoy)
        const fechaInicioObj = new Date(fechaInicial + 'T00:00:00');
        const fechaFinObj = new Date(fechaFinal + 'T23:59:59');

        console.log('🔍 Buscando estadísticas:', {
            fechaInicial: fechaInicioObj.toISOString(),
            fechaFinal: fechaFinObj.toISOString()
        });

        // Consulta para obtener estadísticas generales
        const statsQuery = `
            SELECT
                COUNT(*) FILTER (WHERE "atendido" = 'AGENDADO') as agendados,
                COUNT(*) FILTER (WHERE "atendido" = 'ATENDIDO') as atendidos,
                COUNT(*) FILTER (WHERE "atendido" = 'ATENDIDO'
                    AND ("tipoExamen" IS NULL OR "tipoExamen" !~* 'virtual|teleconferencia')) as presencial,
                COUNT(*) FILTER (WHERE "atendido" = 'ATENDIDO'
                    AND "tipoExamen" ~* 'virtual|teleconferencia') as virtual,
                COUNT(*) FILTER (WHERE "atendido" NOT IN ('AGENDADO', 'ATENDIDO') OR "atendido" IS NULL) as sin_atender
            FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1 AND "fechaAtencion" <= $2
        `;

        console.log('📊 Ejecutando consulta de estadísticas...');
        const statsResult = await pool.query(statsQuery, [fechaInicioObj.toISOString(), fechaFinObj.toISOString()]);
        console.log('✅ Estadísticas obtenidas:', statsResult.rows[0]);
        const stats = statsResult.rows[0];

        // Calcular promedio de atención virtual
        const promedioVirtual = stats.atendidos > 0
            ? ((parseInt(stats.virtual) / parseInt(stats.atendidos)) * 100).toFixed(1) + '%'
            : '0%';

        // Consulta para obtener conteo por empresa
        const empresasQuery = `
            SELECT
                "codEmpresa",
                COUNT(*) as contador
            FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1 AND "fechaAtencion" <= $2
                AND "codEmpresa" IS NOT NULL
                AND "codEmpresa" != ''
            GROUP BY "codEmpresa"
            ORDER BY contador DESC
            LIMIT 20
        `;

        const empresasResult = await pool.query(empresasQuery, [fechaInicioObj.toISOString(), fechaFinObj.toISOString()]);

        // Consulta para obtener conteo por médico
        const medicosQuery = `
            SELECT
                COALESCE("mdNombre", 'Sin asignar') as medico,
                COUNT(*) as contador
            FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1 AND "fechaAtencion" <= $2
                AND "atendido" = 'ATENDIDO'
            GROUP BY "mdNombre"
            ORDER BY contador DESC
            LIMIT 20
        `;

        const medicosResult = await pool.query(medicosQuery, [fechaInicioObj.toISOString(), fechaFinObj.toISOString()]);

        // Construir respuesta
        const estadisticas = {
            agendados: parseInt(stats.agendados) || 0,
            atendidos: parseInt(stats.atendidos) || 0,
            presencial: parseInt(stats.presencial) || 0,
            virtual: parseInt(stats.virtual) || 0,
            sinAtender: parseInt(stats.sin_atender) || 0,
            promedioAtencionVirtual: promedioVirtual,
            empresas: empresasResult.rows.map(row => ({
                codEmpresa: row.codEmpresa,
                contador: parseInt(row.contador)
            })),
            medicos: medicosResult.rows.map(row => ({
                medico: row.medico,
                contador: parseInt(row.contador)
            }))
        };

        res.json({
            success: true,
            estadisticas
        });

    } catch (error) {
        console.error('❌ Error al obtener estadísticas de movimiento:', error);
        console.error('Stack trace:', error.stack);
        res.status(500).json({
            success: false,
            message: 'Error al obtener estadísticas',
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

module.exports = router;
