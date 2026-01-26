const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Listar todas las empresas activas
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, cod_empresa, empresa, nit, profesiograma, activo, created_at,
                   ciudades, examenes, subempresas, centros_de_costo, cargos
            FROM empresas
            WHERE activo = true
            ORDER BY empresa
        `);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error('❌ Error al listar empresas:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar empresas',
            error: error.message
        });
    }
});

// Obtener configuración de empresa por código (para panel-empresas)
// NOTE: This route must be defined BEFORE /:id to avoid "codigo" being matched as an id
router.get('/codigo/:codEmpresa', async (req, res) => {
    try {
        const { codEmpresa } = req.params;
        const result = await pool.query(`
            SELECT id, cod_empresa, empresa, nit, profesiograma, ciudades, examenes, subempresas, centros_de_costo, cargos
            FROM empresas
            WHERE cod_empresa = $1 AND activo = true
        `, [codEmpresa]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Empresa no encontrada'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al obtener empresa por código:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener empresa',
            error: error.message
        });
    }
});

// Obtener una empresa por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM empresas WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Empresa no encontrada'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al obtener empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener empresa',
            error: error.message
        });
    }
});

// Crear una nueva empresa
router.post('/', async (req, res) => {
    try {
        const { codEmpresa, empresa, nit, profesiograma, ciudades, examenes, subempresas, centrosDeCosto, cargos } = req.body;

        if (!codEmpresa || !empresa) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: codEmpresa, empresa'
            });
        }

        const result = await pool.query(`
            INSERT INTO empresas (cod_empresa, empresa, nit, profesiograma, ciudades, examenes, subempresas, centros_de_costo, cargos)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            codEmpresa,
            empresa,
            nit || null,
            profesiograma || null,
            JSON.stringify(ciudades || []),
            JSON.stringify(examenes || []),
            JSON.stringify(subempresas || []),
            JSON.stringify(centrosDeCosto || []),
            JSON.stringify(cargos || [])
        ]);

        console.log(`✅ Empresa creada: ${empresa} (${codEmpresa})`);

        res.json({
            success: true,
            message: 'Empresa creada exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({
                success: false,
                message: 'Ya existe una empresa con ese código'
            });
        }
        console.error('❌ Error al crear empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear empresa',
            error: error.message
        });
    }
});

// Actualizar una empresa
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { codEmpresa, empresa, nit, profesiograma, activo, ciudades, examenes, subempresas, centrosDeCosto, cargos } = req.body;

        const result = await pool.query(`
            UPDATE empresas SET
                cod_empresa = COALESCE($1, cod_empresa),
                empresa = COALESCE($2, empresa),
                nit = COALESCE($3, nit),
                profesiograma = COALESCE($4, profesiograma),
                activo = COALESCE($5, activo),
                ciudades = COALESCE($6, ciudades),
                examenes = COALESCE($7, examenes),
                subempresas = COALESCE($8, subempresas),
                centros_de_costo = COALESCE($9, centros_de_costo),
                cargos = COALESCE($10, cargos),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $11
            RETURNING *
        `, [
            codEmpresa,
            empresa,
            nit,
            profesiograma,
            activo,
            ciudades ? JSON.stringify(ciudades) : null,
            examenes ? JSON.stringify(examenes) : null,
            subempresas ? JSON.stringify(subempresas) : null,
            centrosDeCosto ? JSON.stringify(centrosDeCosto) : null,
            cargos ? JSON.stringify(cargos) : null,
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Empresa no encontrada'
            });
        }

        console.log(`✅ Empresa actualizada: ID ${id}`);

        res.json({
            success: true,
            message: 'Empresa actualizada exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al actualizar empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar empresa',
            error: error.message
        });
    }
});

// Eliminar (desactivar) una empresa
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            UPDATE empresas SET activo = false, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id, cod_empresa, empresa
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Empresa no encontrada'
            });
        }

        console.log(`✅ Empresa desactivada: ID ${id}`);

        res.json({
            success: true,
            message: 'Empresa desactivada exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al desactivar empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al desactivar empresa',
            error: error.message
        });
    }
});

module.exports = router;
