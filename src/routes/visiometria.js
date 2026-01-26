const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==========================================
// ENDPOINTS VISIOMETRIA VIRTUAL
// ==========================================

// Obtener visiometria virtual por orden_id
router.get('/visiometria-virtual/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        const result = await pool.query(
            'SELECT * FROM visiometrias_virtual WHERE orden_id = $1',
            [ordenId]
        );

        if (result.rows.length === 0) {
            return res.json({ success: true, data: null });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Error obteniendo visiometria virtual:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear o actualizar visiometria virtual
router.post('/visiometria-virtual', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id) {
            return res.status(400).json({ success: false, message: 'orden_id es requerido' });
        }

        // Verificar si ya existe
        const existeResult = await pool.query(
            'SELECT id FROM visiometrias_virtual WHERE orden_id = $1',
            [datos.orden_id]
        );

        if (existeResult.rows.length > 0) {
            // Actualizar existente
            const updateQuery = `
                UPDATE visiometrias_virtual SET
                    numero_id = $2,
                    primer_nombre = $3,
                    primer_apellido = $4,
                    empresa = $5,
                    cod_empresa = $6,
                    snellen_correctas = $7,
                    snellen_total = $8,
                    snellen_porcentaje = $9,
                    landolt_correctas = $10,
                    landolt_total = $11,
                    landolt_porcentaje = $12,
                    ishihara_correctas = $13,
                    ishihara_total = $14,
                    ishihara_porcentaje = $15,
                    concepto = $16,
                    miopia = $17,
                    astigmatismo = $18,
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
                datos.snellen_correctas,
                datos.snellen_total,
                datos.snellen_porcentaje,
                datos.landolt_correctas,
                datos.landolt_total,
                datos.landolt_porcentaje,
                datos.ishihara_correctas,
                datos.ishihara_total,
                datos.ishihara_porcentaje,
                datos.concepto,
                datos.miopia || null,
                datos.astigmatismo || null
            ];

            const result = await pool.query(updateQuery, values);
            console.log('Visiometria virtual actualizada para orden:', datos.orden_id);

            return res.json({ success: true, data: result.rows[0], operacion: 'UPDATE' });
        } else {
            // Insertar nuevo
            const insertQuery = `
                INSERT INTO visiometrias_virtual (
                    orden_id, numero_id, primer_nombre, primer_apellido, empresa, cod_empresa,
                    snellen_correctas, snellen_total, snellen_porcentaje,
                    landolt_correctas, landolt_total, landolt_porcentaje,
                    ishihara_correctas, ishihara_total, ishihara_porcentaje,
                    concepto, miopia, astigmatismo
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                RETURNING *
            `;

            const values = [
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa,
                datos.snellen_correctas,
                datos.snellen_total,
                datos.snellen_porcentaje,
                datos.landolt_correctas,
                datos.landolt_total,
                datos.landolt_porcentaje,
                datos.ishihara_correctas,
                datos.ishihara_total,
                datos.ishihara_porcentaje,
                datos.concepto,
                datos.miopia || null,
                datos.astigmatismo || null
            ];

            const result = await pool.query(insertQuery, values);
            console.log('Visiometria virtual creada para orden:', datos.orden_id);

            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }

    } catch (error) {
        console.error('Error guardando visiometria virtual:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// ENDPOINTS VISIOMETRIAS (PRESENCIAL)
// ==========================================

// Obtener visiometria por orden_id
router.get('/visiometrias/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        const result = await pool.query(
            'SELECT * FROM visiometrias WHERE orden_id = $1',
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
        console.error('Error obteniendo visiometria:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear o actualizar visiometria
router.post('/visiometrias', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id) {
            return res.status(400).json({ success: false, message: 'orden_id es requerido' });
        }

        // Verificar si ya existe
        const existeResult = await pool.query(
            'SELECT id FROM visiometrias WHERE orden_id = $1',
            [datos.orden_id]
        );

        const campos = [
            'numero_id', 'primer_nombre', 'primer_apellido', 'empresa', 'cod_empresa',
            'vl_od_sin_correccion', 'vl_od_con_correccion', 'vl_oi_sin_correccion', 'vl_oi_con_correccion',
            'vl_ao_sin_correccion', 'vl_ao_con_correccion', 'vl_foria_lateral', 'vl_foria_vertical',
            'vc_od_sin_correccion', 'vc_od_con_correccion', 'vc_oi_sin_correccion', 'vc_oi_con_correccion',
            'vc_ao_sin_correccion', 'vc_ao_con_correccion', 'vc_foria_lateral', 'vc_campimetria',
            'ishihara', 'ppc', 'vision_cromatica', 'enceguecimiento', 'estado_forico',
            'cover_test_lejos', 'cover_test_cerca', 'queratometria_od', 'queratometria_oi',
            'examen_externo', 'oftalmoscopia_od', 'oftalmoscopia_oi', 'biomicroscopia_od', 'biomicroscopia_oi',
            'tonometria_od', 'tonometria_oi', 'rx_en_uso', 'refractometria_od', 'refractometria_oi',
            'subjetivo_od', 'subjetivo_oi', 'rx_final_od', 'rx_final_oi',
            'dip', 'filtro', 'uso', 'diagnostico', 'remision', 'control', 'dx2', 'dx3', 'observaciones'
        ];

        if (existeResult.rows.length > 0) {
            // Actualizar existente
            const setClauses = campos.map((campo, i) => `${campo} = $${i + 2}`).join(', ');
            const updateQuery = `
                UPDATE visiometrias SET
                    ${setClauses},
                    updated_at = CURRENT_TIMESTAMP
                WHERE orden_id = $1
                RETURNING *
            `;

            const values = [datos.orden_id, ...campos.map(c => datos[c] || null)];
            const result = await pool.query(updateQuery, values);
            console.log('Visiometria actualizada para orden:', datos.orden_id);
            return res.json({ success: true, data: result.rows[0], operacion: 'UPDATE' });
        } else {
            // Insertar nuevo
            const insertCampos = ['orden_id', ...campos];
            const insertPlaceholders = insertCampos.map((_, i) => `$${i + 1}`).join(', ');
            const insertQuery = `
                INSERT INTO visiometrias (${insertCampos.join(', ')})
                VALUES (${insertPlaceholders})
                RETURNING *
            `;

            const values = [datos.orden_id, ...campos.map(c => datos[c] || null)];
            const result = await pool.query(insertQuery, values);
            console.log('Visiometria creada para orden:', datos.orden_id);
            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }
    } catch (error) {
        console.error('Error guardando visiometria:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
