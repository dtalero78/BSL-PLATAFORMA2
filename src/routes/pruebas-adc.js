const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { syncADCToWix } = require('../services/wix-sync');

// Obtener prueba ADC por orden_id
router.get('/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        const result = await pool.query(
            'SELECT * FROM "pruebasADC" WHERE orden_id = $1',
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
        console.error('❌ Error obteniendo prueba ADC:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear o actualizar prueba ADC
router.post('/', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id) {
            return res.status(400).json({ success: false, message: 'orden_id es requerido' });
        }

        // Verificar si ya existe
        const existeResult = await pool.query(
            'SELECT id FROM "pruebasADC" WHERE orden_id = $1',
            [datos.orden_id]
        );

        // Lista de campos de preguntas
        const camposPreguntas = [
            'de08', 'de29', 'de03', 'de04', 'de05', 'de32', 'de12', 'de06', 'de33', 'de13',
            'de07', 'de35', 'de21', 'de14', 'de15', 'de37', 'de16', 'de38', 'de40', 'de27', 'de20',
            'an07', 'an11', 'an03', 'an18', 'an19', 'an04', 'an14', 'an09', 'an20', 'an05',
            'an36', 'an26', 'an31', 'an22', 'an38', 'an27', 'an35', 'an23', 'an39', 'an30',
            'cofv01', 'corv11', 'cofc06', 'coav21', 'coov32', 'corc16', 'coac26', 'cofv02',
            'coov34', 'cofv03', 'corc17', 'coac27', 'cofc08', 'cooc39', 'cofc10', 'corv12',
            'cooc40', 'corv15', 'coac29', 'coov35', 'coav24', 'corc18', 'coav25'
        ];

        if (existeResult.rows.length > 0) {
            // Actualizar existente
            const setClauses = [
                'numero_id = $2',
                'primer_nombre = $3',
                'primer_apellido = $4',
                'empresa = $5',
                'cod_empresa = $6',
                'updated_at = CURRENT_TIMESTAMP'
            ];

            const values = [
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa
            ];

            let paramIndex = 7;
            camposPreguntas.forEach(campo => {
                setClauses.push(`${campo} = $${paramIndex}`);
                values.push(datos[campo] || null);
                paramIndex++;
            });

            const updateQuery = `
                UPDATE "pruebasADC" SET ${setClauses.join(', ')}
                WHERE orden_id = $1
                RETURNING *
            `;

            const result = await pool.query(updateQuery, values);
            console.log('✅ Prueba ADC actualizada para orden:', datos.orden_id);

            // Sincronizar con Wix
            await syncADCToWix(datos, 'UPDATE');

            return res.json({ success: true, data: result.rows[0], operacion: 'UPDATE' });
        } else {
            // Insertar nuevo
            const columns = ['orden_id', 'numero_id', 'primer_nombre', 'primer_apellido', 'empresa', 'cod_empresa', ...camposPreguntas];
            const placeholders = columns.map((_, i) => `$${i + 1}`);

            const values = [
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa,
                ...camposPreguntas.map(campo => datos[campo] || null)
            ];

            const insertQuery = `
                INSERT INTO "pruebasADC" (${columns.join(', ')})
                VALUES (${placeholders.join(', ')})
                RETURNING *
            `;

            const result = await pool.query(insertQuery, values);
            console.log('✅ Prueba ADC creada para orden:', datos.orden_id);

            // Sincronizar con Wix
            await syncADCToWix(datos, 'INSERT');

            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }
    } catch (error) {
        console.error('❌ Error guardando prueba ADC:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
