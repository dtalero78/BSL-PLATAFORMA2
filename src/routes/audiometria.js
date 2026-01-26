const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { syncAudiometriaToWix } = require('../services/wix-sync');

// ==========================================
// ENDPOINTS AUDIOMETRIA
// ==========================================

// Obtener audiometria por orden_id
router.get('/audiometrias/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        const result = await pool.query(
            'SELECT * FROM audiometrias WHERE orden_id = $1',
            [ordenId]
        );

        if (result.rows.length === 0) {
            // No existe, devolver datos vacios con info del paciente
            const ordenResult = await pool.query(
                'SELECT "numeroId", "primerNombre", "primerApellido", "empresa", "codEmpresa" FROM "HistoriaClinica" WHERE "_id" = $1',
                [ordenId]
            );

            if (ordenResult.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Orden no encontrada' });
            }

            const orden = ordenResult.rows[0];
            return res.json({
                success: true,
                data: null,
                paciente: {
                    numeroId: orden.numeroId,
                    primerNombre: orden.primerNombre,
                    primerApellido: orden.primerApellido,
                    empresa: orden.empresa,
                    codEmpresa: orden.codEmpresa
                }
            });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Error obteniendo audiometria:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear o actualizar audiometria
router.post('/audiometrias', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id) {
            return res.status(400).json({ success: false, message: 'orden_id es requerido' });
        }

        // Verificar si ya existe
        const existeResult = await pool.query(
            'SELECT id FROM audiometrias WHERE orden_id = $1',
            [datos.orden_id]
        );

        if (existeResult.rows.length > 0) {
            // Actualizar existente
            const updateQuery = `
                UPDATE audiometrias SET
                    numero_id = $2,
                    primer_nombre = $3,
                    primer_apellido = $4,
                    empresa = $5,
                    cod_empresa = $6,
                    pabellon_auricular_oi = $7,
                    pabellon_auricular_od = $8,
                    conducto_auditivo_oi = $9,
                    conducto_auditivo_od = $10,
                    membrana_timpanica_oi = $11,
                    membrana_timpanica_od = $12,
                    observaciones_oi = $13,
                    observaciones_od = $14,
                    requiere_limpieza_otica = $15,
                    estado_gripal = $16,
                    aereo_od_250 = $17,
                    aereo_od_500 = $18,
                    aereo_od_1000 = $19,
                    aereo_od_2000 = $20,
                    aereo_od_3000 = $21,
                    aereo_od_4000 = $22,
                    aereo_od_6000 = $23,
                    aereo_od_8000 = $24,
                    aereo_oi_250 = $25,
                    aereo_oi_500 = $26,
                    aereo_oi_1000 = $27,
                    aereo_oi_2000 = $28,
                    aereo_oi_3000 = $29,
                    aereo_oi_4000 = $30,
                    aereo_oi_6000 = $31,
                    aereo_oi_8000 = $32,
                    oseo_od_250 = $33,
                    oseo_od_500 = $34,
                    oseo_od_1000 = $35,
                    oseo_od_2000 = $36,
                    oseo_od_3000 = $37,
                    oseo_od_4000 = $38,
                    oseo_oi_250 = $39,
                    oseo_oi_500 = $40,
                    oseo_oi_1000 = $41,
                    oseo_oi_2000 = $42,
                    oseo_oi_3000 = $43,
                    oseo_oi_4000 = $44,
                    cabina = $45,
                    equipo = $46,
                    diagnostico_oi = $47,
                    diagnostico_od = $48,
                    interpretacion = $49,
                    recomendaciones = $50,
                    remision = $51,
                    updated_at = CURRENT_TIMESTAMP
                WHERE orden_id = $1
                RETURNING *
            `;

            const values = [
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa,
                datos.pabellon_auricular_oi,
                datos.pabellon_auricular_od,
                datos.conducto_auditivo_oi,
                datos.conducto_auditivo_od,
                datos.membrana_timpanica_oi,
                datos.membrana_timpanica_od,
                datos.observaciones_oi,
                datos.observaciones_od,
                datos.requiere_limpieza_otica,
                datos.estado_gripal,
                datos.aereo_od_250,
                datos.aereo_od_500,
                datos.aereo_od_1000,
                datos.aereo_od_2000,
                datos.aereo_od_3000,
                datos.aereo_od_4000,
                datos.aereo_od_6000,
                datos.aereo_od_8000,
                datos.aereo_oi_250,
                datos.aereo_oi_500,
                datos.aereo_oi_1000,
                datos.aereo_oi_2000,
                datos.aereo_oi_3000,
                datos.aereo_oi_4000,
                datos.aereo_oi_6000,
                datos.aereo_oi_8000,
                datos.oseo_od_250,
                datos.oseo_od_500,
                datos.oseo_od_1000,
                datos.oseo_od_2000,
                datos.oseo_od_3000,
                datos.oseo_od_4000,
                datos.oseo_oi_250,
                datos.oseo_oi_500,
                datos.oseo_oi_1000,
                datos.oseo_oi_2000,
                datos.oseo_oi_3000,
                datos.oseo_oi_4000,
                datos.cabina,
                datos.equipo,
                datos.diagnostico_oi,
                datos.diagnostico_od,
                datos.interpretacion,
                datos.recomendaciones,
                datos.remision
            ];

            const result = await pool.query(updateQuery, values);
            console.log('Audiometria actualizada para orden:', datos.orden_id);

            // Sincronizar con Wix
            await syncAudiometriaToWix(datos, 'UPDATE');

            return res.json({ success: true, data: result.rows[0], operacion: 'UPDATE' });
        } else {
            // Insertar nuevo
            const insertQuery = `
                INSERT INTO audiometrias (
                    orden_id, numero_id, primer_nombre, primer_apellido, empresa, cod_empresa,
                    pabellon_auricular_oi, pabellon_auricular_od, conducto_auditivo_oi, conducto_auditivo_od,
                    membrana_timpanica_oi, membrana_timpanica_od, observaciones_oi, observaciones_od,
                    requiere_limpieza_otica, estado_gripal,
                    aereo_od_250, aereo_od_500, aereo_od_1000, aereo_od_2000, aereo_od_3000, aereo_od_4000, aereo_od_6000, aereo_od_8000,
                    aereo_oi_250, aereo_oi_500, aereo_oi_1000, aereo_oi_2000, aereo_oi_3000, aereo_oi_4000, aereo_oi_6000, aereo_oi_8000,
                    oseo_od_250, oseo_od_500, oseo_od_1000, oseo_od_2000, oseo_od_3000, oseo_od_4000,
                    oseo_oi_250, oseo_oi_500, oseo_oi_1000, oseo_oi_2000, oseo_oi_3000, oseo_oi_4000,
                    cabina, equipo, diagnostico_oi, diagnostico_od, interpretacion, recomendaciones, remision
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                    $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                    $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
                    $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51
                )
                RETURNING *
            `;

            const values = [
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa,
                datos.pabellon_auricular_oi,
                datos.pabellon_auricular_od,
                datos.conducto_auditivo_oi,
                datos.conducto_auditivo_od,
                datos.membrana_timpanica_oi,
                datos.membrana_timpanica_od,
                datos.observaciones_oi,
                datos.observaciones_od,
                datos.requiere_limpieza_otica,
                datos.estado_gripal,
                datos.aereo_od_250,
                datos.aereo_od_500,
                datos.aereo_od_1000,
                datos.aereo_od_2000,
                datos.aereo_od_3000,
                datos.aereo_od_4000,
                datos.aereo_od_6000,
                datos.aereo_od_8000,
                datos.aereo_oi_250,
                datos.aereo_oi_500,
                datos.aereo_oi_1000,
                datos.aereo_oi_2000,
                datos.aereo_oi_3000,
                datos.aereo_oi_4000,
                datos.aereo_oi_6000,
                datos.aereo_oi_8000,
                datos.oseo_od_250,
                datos.oseo_od_500,
                datos.oseo_od_1000,
                datos.oseo_od_2000,
                datos.oseo_od_3000,
                datos.oseo_od_4000,
                datos.oseo_oi_250,
                datos.oseo_oi_500,
                datos.oseo_oi_1000,
                datos.oseo_oi_2000,
                datos.oseo_oi_3000,
                datos.oseo_oi_4000,
                datos.cabina,
                datos.equipo,
                datos.diagnostico_oi,
                datos.diagnostico_od,
                datos.interpretacion,
                datos.recomendaciones,
                datos.remision
            ];

            const result = await pool.query(insertQuery, values);
            console.log('Audiometria creada para orden:', datos.orden_id);

            // Sincronizar con Wix
            await syncAudiometriaToWix(datos, 'INSERT');

            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }
    } catch (error) {
        console.error('Error guardando audiometria:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
