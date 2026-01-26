const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Obtener laboratorio por orden_id
router.get('/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        const result = await pool.query(
            'SELECT * FROM laboratorios WHERE orden_id = $1 ORDER BY created_at DESC',
            [ordenId]
        );

        if (result.rows.length === 0) {
            // No existe, devolver datos vacíos con info del paciente
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
                data: [],
                paciente: {
                    numeroId: orden.numeroId,
                    primerNombre: orden.primerNombre,
                    primerApellido: orden.primerApellido,
                    empresa: orden.empresa,
                    codEmpresa: orden.codEmpresa
                }
            });
        }

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ Error obteniendo laboratorios:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener un laboratorio específico por ID
router.get('/detalle/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'SELECT * FROM laboratorios WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Laboratorio no encontrado' });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('❌ Error obteniendo laboratorio:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener historial de laboratorios por número de identificación
router.get('/historial/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;
        const { tipoPrueba } = req.query;

        let query = 'SELECT * FROM laboratorios WHERE numero_id = $1';
        const params = [numeroId];

        if (tipoPrueba) {
            query += ' AND tipo_prueba = $2';
            params.push(tipoPrueba);
        }

        query += ' ORDER BY created_at DESC';

        const result = await pool.query(query, params);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ Error obteniendo historial de laboratorios:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear o actualizar laboratorio
router.post('/', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id || !datos.tipo_prueba) {
            return res.status(400).json({
                success: false,
                message: 'orden_id y tipo_prueba son requeridos'
            });
        }

        // Si viene un ID, actualizar; si no, crear nuevo
        if (datos.id) {
            // Actualizar existente
            const campos = [
                'numero_id', 'primer_nombre', 'primer_apellido', 'empresa', 'cod_empresa', 'tipo_prueba',
                // CUADRO HEMÁTICO
                'hematocrito', 'hemoglobina', 'conc_corpus_hb', 'plaquetas', 'sedimentacio_globular',
                'globulos_blancos', 'neutrofilos', 'linfocitos', 'monocitos', 'basofilos', 'eosinofilos',
                'cayados', 'observaciones_hemograma',
                // COPROLÓGICO
                'consistencia', 'color', 'olor', 'moco', 'sangre', 'parasitologico', 'observaciones_coprologico',
                'vegetales', 'musculares', 'celulosa', 'almidones', 'levaduras', 'hongos', 'neutras',
                'hominis', 'leucocitos', 'bacteriana',
                // PERFIL LIPÍDICO + QUÍMICA
                'glicemia_pre', 'glicemia_post', 'tsh', 'colesterol_total', 'colesterol_hdl', 'colesterol_ldl',
                'trigliceridos', 'transaminasa_gpt', 'transaminasa_got', 'bilirrubina_directa', 'bilirrubina_indirecta',
                'bilirrubina_total', 'nitrogeno_ureico_bun', 'creatinina_en_suero', 'colinesterasa',
                'quimica_observaciones', 'fosfatasa_alcalina',
                // INMUNOLOGÍA
                'grupo_sanguineo', 'factor_rh', 'inmunologia_observaciones', 'serologia_vdrl',
                'serologia_cuantitativa', 'como_reporto_a_la_empresa',
                // MICROBIOLOGÍA
                'frotis_faringeo', 'koh_en_unas', 'cultivo_faringeo', 'frotis_naso_derecha',
                'frotis_naso_izquierda', 'microbiologia_observaciones', 'coprocultivo', 'leptospira', 'baciloscopia',
                // TOXICOLOGÍA
                'alcohol_aire_respirado', 'marihuana_orina', 'morfina', 'cocaina', 'metanfetaminas',
                'alcohol_saliva', 'anfetaminas', 'alcohol_sangre', 'toxicologia_observaciones',
                'updated_by'
            ];

            const setClauses = campos.map((campo, i) => `${campo} = $${i + 2}`).join(', ');
            const updateQuery = `
                UPDATE laboratorios SET
                    ${setClauses},
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING *
            `;

            const values = [datos.id, ...campos.map(c => datos[c] || null)];
            const result = await pool.query(updateQuery, values);
            console.log('✅ Laboratorio actualizado, ID:', datos.id);
            return res.json({ success: true, data: result.rows[0], operacion: 'UPDATE' });
        } else {
            // Insertar nuevo
            const campos = [
                'orden_id', 'numero_id', 'primer_nombre', 'primer_apellido', 'empresa', 'cod_empresa', 'tipo_prueba',
                // CUADRO HEMÁTICO
                'hematocrito', 'hemoglobina', 'conc_corpus_hb', 'plaquetas', 'sedimentacio_globular',
                'globulos_blancos', 'neutrofilos', 'linfocitos', 'monocitos', 'basofilos', 'eosinofilos',
                'cayados', 'observaciones_hemograma',
                // COPROLÓGICO
                'consistencia', 'color', 'olor', 'moco', 'sangre', 'parasitologico', 'observaciones_coprologico',
                'vegetales', 'musculares', 'celulosa', 'almidones', 'levaduras', 'hongos', 'neutras',
                'hominis', 'leucocitos', 'bacteriana',
                // PERFIL LIPÍDICO + QUÍMICA
                'glicemia_pre', 'glicemia_post', 'tsh', 'colesterol_total', 'colesterol_hdl', 'colesterol_ldl',
                'trigliceridos', 'transaminasa_gpt', 'transaminasa_got', 'bilirrubina_directa', 'bilirrubina_indirecta',
                'bilirrubina_total', 'nitrogeno_ureico_bun', 'creatinina_en_suero', 'colinesterasa',
                'quimica_observaciones', 'fosfatasa_alcalina',
                // INMUNOLOGÍA
                'grupo_sanguineo', 'factor_rh', 'inmunologia_observaciones', 'serologia_vdrl',
                'serologia_cuantitativa', 'como_reporto_a_la_empresa',
                // MICROBIOLOGÍA
                'frotis_faringeo', 'koh_en_unas', 'cultivo_faringeo', 'frotis_naso_derecha',
                'frotis_naso_izquierda', 'microbiologia_observaciones', 'coprocultivo', 'leptospira', 'baciloscopia',
                // TOXICOLOGÍA
                'alcohol_aire_respirado', 'marihuana_orina', 'morfina', 'cocaina', 'metanfetaminas',
                'alcohol_saliva', 'anfetaminas', 'alcohol_sangre', 'toxicologia_observaciones',
                'created_by'
            ];

            const insertPlaceholders = campos.map((_, i) => `$${i + 1}`).join(', ');
            const insertQuery = `
                INSERT INTO laboratorios (${campos.join(', ')})
                VALUES (${insertPlaceholders})
                RETURNING *
            `;

            const values = campos.map(c => datos[c] || null);
            const result = await pool.query(insertQuery, values);
            console.log('✅ Laboratorio creado para orden:', datos.orden_id);
            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }
    } catch (error) {
        console.error('❌ Error guardando laboratorio:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Eliminar laboratorio
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM laboratorios WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Laboratorio no encontrado' });
        }

        console.log('✅ Laboratorio eliminado, ID:', id);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('❌ Error eliminando laboratorio:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
