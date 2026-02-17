const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Campos de preguntas SCL-90 (item1 a item90)
const camposPreguntas = Array.from({ length: 90 }, (_, i) => `item${i + 1}`);

// Obtener prueba SCL-90 por orden_id
router.get('/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        const result = await pool.query(
            'SELECT * FROM scl90 WHERE orden_id = $1',
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
        console.error('❌ Error obteniendo prueba SCL-90:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear o actualizar prueba SCL-90
router.post('/', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id) {
            return res.status(400).json({ success: false, message: 'orden_id es requerido' });
        }

        // Verificar si ya existe
        const existeResult = await pool.query(
            'SELECT id FROM scl90 WHERE orden_id = $1',
            [datos.orden_id]
        );

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
                values.push(datos[campo] != null ? String(datos[campo]) : null);
                paramIndex++;
            });

            const updateQuery = `
                UPDATE scl90 SET ${setClauses.join(', ')}
                WHERE orden_id = $1
                RETURNING *
            `;

            const result = await pool.query(updateQuery, values);
            console.log('✅ Prueba SCL-90 actualizada para orden:', datos.orden_id);

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
                ...camposPreguntas.map(campo => datos[campo] != null ? String(datos[campo]) : null)
            ];

            const insertQuery = `
                INSERT INTO scl90 (${columns.join(', ')})
                VALUES (${placeholders.join(', ')})
                RETURNING *
            `;

            const result = await pool.query(insertQuery, values);
            console.log('✅ Prueba SCL-90 creada para orden:', datos.orden_id);

            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }
    } catch (error) {
        console.error('❌ Error guardando prueba SCL-90:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
