const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Multi-tenant helper (ver CLAUDE.md)
function tenantId(req) {
    return (req.tenant && req.tenant.id) || 'bsl';
}

// Obtener estado de todas las pruebas por orden_id
router.get('/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;
        const tId = tenantId(req);

        // Obtener información de la orden (exámenes requeridos)
        const ordenResult = await pool.query(
            'SELECT "examenes", "numeroId", "codEmpresa" FROM "HistoriaClinica" WHERE "_id" = $1 AND tenant_id = $2',
            [ordenId, tId]
        );

        if (ordenResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Orden no encontrada' });
        }

        const orden = ordenResult.rows[0];
        const examenesRequeridos = orden.examenes || '';

        // Verificar formulario principal (por wix_id = orden_id, con fallback a numero_id)
        let formularioResult = await pool.query(
            'SELECT id FROM formularios WHERE wix_id = $1 AND tenant_id = $2',
            [ordenId, tId]
        );
        if (formularioResult.rows.length === 0 && orden.numeroId) {
            formularioResult = await pool.query(
                'SELECT id FROM formularios WHERE numero_id = $1 AND tenant_id = $2',
                [orden.numeroId, tId]
            );
        }
        const tieneFormulario = formularioResult.rows.length > 0;

        // Verificar audiometría
        const audioResult = await pool.query(
            'SELECT id FROM audiometrias WHERE orden_id = $1 AND tenant_id = $2',
            [ordenId, tId]
        );
        const tieneAudiometria = audioResult.rows.length > 0;

        // Verificar pruebas ADC
        const adcResult = await pool.query(
            'SELECT id FROM "pruebasADC" WHERE orden_id = $1 AND tenant_id = $2',
            [ordenId, tId]
        );
        const tieneADC = adcResult.rows.length > 0;

        // Verificar visiometría (presencial o virtual)
        const visioResult = await pool.query(
            'SELECT id FROM visiometrias WHERE orden_id = $1 AND tenant_id = $2',
            [ordenId, tId]
        );
        const visioVirtualResult = await pool.query(
            'SELECT id FROM visiometrias_virtual WHERE orden_id = $1 AND tenant_id = $2',
            [ordenId, tId]
        );
        const tieneVisiometria = visioResult.rows.length > 0 || visioVirtualResult.rows.length > 0;

        // Verificar SCL-90
        const scl90Result = await pool.query(
            'SELECT id FROM scl90 WHERE orden_id = $1 AND tenant_id = $2',
            [ordenId, tId]
        );
        const tieneScl90 = scl90Result.rows.length > 0;

        // Determinar qué pruebas son requeridas según el campo exámenes
        const examLower = examenesRequeridos.toLowerCase();
        const requiereAudiometria = examLower.includes('audiometr');
        const requiereVisiometria = examLower.includes('visiometr') || examLower.includes('optometr');
        const codEmpresa = orden.codEmpresa || '';
        const requiereADC = codEmpresa !== 'SIIGO'; // SIIGO usa SCL-90 en lugar de ADC
        const requiereScl90 = examLower.includes('scl') || codEmpresa === 'SIIGO';

        res.json({
            success: true,
            data: {
                examenesRequeridos,
                pruebas: {
                    formulario: {
                        completado: tieneFormulario,
                        requerido: true
                    },
                    audiometria: {
                        completado: tieneAudiometria,
                        requerido: requiereAudiometria
                    },
                    visiometria: {
                        completado: tieneVisiometria,
                        requerido: requiereVisiometria
                    },
                    adc: {
                        completado: tieneADC,
                        requerido: requiereADC
                    },
                    scl90: {
                        completado: tieneScl90,
                        requerido: requiereScl90
                    }
                }
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo estado de pruebas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
