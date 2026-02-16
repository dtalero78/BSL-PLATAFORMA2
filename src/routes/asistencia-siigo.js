const express = require('express');
const router = express.Router();
const HistoriaClinicaRepository = require('../repositories/HistoriaClinicaRepository');

// GET /list - Listar registros de asistencia SIIGO con filtros
router.get('/list', async (req, res) => {
    try {
        const { page, limit, buscar, estado, fechaDesde, fechaHasta } = req.query;

        const result = await HistoriaClinicaRepository.findAsistenciaSiigo({
            page: parseInt(page) || 1,
            limit: parseInt(limit) || 20,
            buscar: buscar?.trim() || null,
            estado: estado || null,
            fechaDesde: fechaDesde || null,
            fechaHasta: fechaHasta || null
        });

        res.json({
            success: true,
            data: result.rows,
            total: result.total,
            page: parseInt(page) || 1,
            totalPaginas: result.totalPaginas
        });
    } catch (error) {
        console.error('Error obteniendo asistencia SIIGO:', error);
        res.status(500).json({
            success: false,
            message: 'Error al cargar registros de asistencia',
            error: error.message
        });
    }
});

module.exports = router;
