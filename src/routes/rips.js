const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const ripsGenerator = require('../../lib/rips-generator');
ripsGenerator.init(pool);

// GET /configuracion - Obtener configuración RIPS
router.get('/configuracion', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM rips_configuracion LIMIT 1');
        res.json({
            success: true,
            data: result.rows[0] || null
        });
    } catch (error) {
        console.error('Error obteniendo configuración RIPS:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener configuración RIPS'
        });
    }
});

// PUT /configuracion - Actualizar configuración RIPS
router.put('/configuracion', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { nit_prestador, nombre_prestador } = req.body;

        await pool.query(`
            UPDATE rips_configuracion
            SET nit_prestador = $1,
                nombre_prestador = $2,
                updated_at = NOW()
        `, [nit_prestador, nombre_prestador]);

        res.json({
            success: true,
            message: 'Configuración RIPS actualizada correctamente'
        });
    } catch (error) {
        console.error('Error actualizando configuración RIPS:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar configuración RIPS'
        });
    }
});

// GET /examenes - Listar exámenes con configuración RIPS
router.get('/examenes', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM examenes
            ORDER BY nombre
        `);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error('Error listando exámenes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar exámenes'
        });
    }
});

// PUT /examenes/:id - Actualizar examen (CUPS, precio, grupo)
router.put('/examenes/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { codigo_cups, grupo_servicio, precio, descripcion } = req.body;

        await pool.query(`
            UPDATE examenes
            SET codigo_cups = $1,
                grupo_servicio = $2,
                precio = $3,
                descripcion = $4,
                updated_at = NOW()
            WHERE id = $5
        `, [codigo_cups, grupo_servicio, precio, descripcion, id]);

        res.json({
            success: true,
            message: 'Examen actualizado correctamente'
        });
    } catch (error) {
        console.error('Error actualizando examen:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar examen'
        });
    }
});

// POST /examenes - Crear nuevo examen
router.post('/examenes', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { nombre, codigo_cups, grupo_servicio, precio, descripcion } = req.body;

        const result = await pool.query(`
            INSERT INTO examenes (nombre, codigo_cups, grupo_servicio, precio, descripcion)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [nombre, codigo_cups, grupo_servicio, precio, descripcion]);

        res.json({
            success: true,
            data: result.rows[0],
            message: 'Examen creado correctamente'
        });
    } catch (error) {
        console.error('Error creando examen:', error);
        res.status(500).json({
            success: false,
            message: error.message.includes('duplicate') ?
                'Ya existe un examen con ese nombre' :
                'Error al crear examen'
        });
    }
});

// GET /generar - Generar RIPS JSON para un periodo
router.get('/generar', authMiddleware, async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.query;

        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({
                success: false,
                message: 'Debe especificar fecha_inicio y fecha_fin'
            });
        }

        console.log(`\n📋 Generando RIPS: ${fecha_inicio} - ${fecha_fin}`);

        const { rips, metadata } = await ripsGenerator.generarRIPSJSON(fecha_inicio, fecha_fin);

        if (!rips) {
            return res.json({
                success: false,
                message: 'No se encontraron registros en el periodo especificado',
                metadata
            });
        }

        // Verificar errores de exámenes sin CUPS
        if (metadata.errores && metadata.errores.length > 0) {
            return res.json({
                success: false,
                message: 'Hay exámenes sin código CUPS configurado',
                errores: metadata.errores,
                rips: null
            });
        }

        res.json({
            success: true,
            rips,
            metadata
        });
    } catch (error) {
        console.error('Error generando RIPS:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error al generar RIPS'
        });
    }
});

// POST /exportar - Generar y guardar exportación RIPS
router.post('/exportar', authMiddleware, async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.body;
        const usuario = req.user.email || req.user.username;

        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({
                success: false,
                message: 'Debe especificar fecha_inicio y fecha_fin'
            });
        }

        console.log(`\n💾 Exportando RIPS: ${fecha_inicio} - ${fecha_fin} (usuario: ${usuario})`);

        const { rips, metadata } = await ripsGenerator.generarRIPSJSON(fecha_inicio, fecha_fin);

        if (!rips) {
            return res.json({
                success: false,
                message: 'No se encontraron registros en el periodo especificado'
            });
        }

        // Guardar en base de datos
        const exportacionId = await ripsGenerator.guardarExportacion(rips, metadata, usuario);

        console.log(`✅ RIPS exportado con ID: ${exportacionId}`);

        res.json({
            success: true,
            exportacionId,
            metadata,
            message: metadata.errores ?
                'RIPS generado con advertencias. Revise los exámenes sin CUPS configurados.' :
                'RIPS generado y guardado correctamente'
        });
    } catch (error) {
        console.error('Error exportando RIPS:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error al exportar RIPS'
        });
    }
});

// GET /exportaciones - Listar exportaciones históricas
router.get('/exportaciones', authMiddleware, async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;

        const result = await pool.query(`
            SELECT
                id,
                fecha_generacion,
                periodo_inicio,
                periodo_fin,
                total_registros,
                total_pacientes,
                estado,
                errores_validacion,
                usuario_generador
            FROM rips_exportaciones
            ORDER BY fecha_generacion DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        const countResult = await pool.query('SELECT COUNT(*) FROM rips_exportaciones');

        res.json({
            success: true,
            data: result.rows,
            total: parseInt(countResult.rows[0].count)
        });
    } catch (error) {
        console.error('Error listando exportaciones RIPS:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar exportaciones RIPS'
        });
    }
});

// GET /exportaciones/:id/download - Descargar archivo JSON de exportación
router.get('/exportaciones/:id/download', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            SELECT archivo_json, periodo_inicio, periodo_fin
            FROM rips_exportaciones
            WHERE id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Exportación no encontrada'
            });
        }

        const { archivo_json, periodo_inicio, periodo_fin } = result.rows[0];
        const filename = `RIPS_${periodo_inicio}_${periodo_fin}.json`;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(archivo_json);
    } catch (error) {
        console.error('Error descargando RIPS:', error);
        res.status(500).json({
            success: false,
            message: 'Error al descargar archivo RIPS'
        });
    }
});

// DELETE /exportaciones/:id - Eliminar exportación
router.delete('/exportaciones/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        await pool.query('DELETE FROM rips_exportaciones WHERE id = $1', [id]);

        res.json({
            success: true,
            message: 'Exportación eliminada correctamente'
        });
    } catch (error) {
        console.error('Error eliminando exportación RIPS:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar exportación'
        });
    }
});

console.log('✅ Endpoints RIPS configurados');

module.exports = router;
