const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { HistoriaClinicaRepository, FormulariosRepository } = require('../repositories');

// ============================================================
// Legacy routes that belong at /api/ level (NOT under /api/ordenes/)
// These were mistakenly placed in ordenes.js and need their own router
// ============================================================

// Route 1 - Get psychological test results
router.get('/pruebas-psicologicas/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;

        const result = await pool.query(
            'SELECT * FROM "pruebasADC" WHERE numero_id = $1 LIMIT 1',
            [numeroId]
        );

        if (result.rows.length === 0) {
            return res.json({
                success: true,
                numeroId,
                ansiedad: 'NO REALIZO PRUEBA',
                depresion: 'NO REALIZO PRUEBA',
                congruencia: 'NO REALIZO PRUEBA'
            });
        }

        const registro = result.rows[0];
        const codEmpresa = registro.cod_empresa || '';

        let ansiedad, depresion, congruencia;

        // Usar resultados almacenados si existen, sino calcular al vuelo (registros antiguos)
        if (registro.ansiedad_puntaje != null) {
            ansiedad = { valor: registro.ansiedad_puntaje, interpretacion: registro.ansiedad_interpretacion };
            depresion = { valor: registro.depresion_puntaje, interpretacion: registro.depresion_interpretacion };
            congruencia = {
                CongruenciaFamilia: registro.congruencia_familia,
                CongruenciaRelacion: registro.congruencia_relacion,
                CongruenciaAutocuidado: registro.congruencia_autocuidado,
                CongruenciaOcupacional: registro.congruencia_ocupacional
            };
        } else {
            const { calcularAnsiedad } = require('../../calcular-ansiedad');
            const { calcularDepresion } = require('../../calcular-depresion');
            const { calcularCongruencia } = require('../../calcular-congruencia');

            ansiedad = calcularAnsiedad(registro, codEmpresa);
            depresion = calcularDepresion(registro, codEmpresa);
            congruencia = calcularCongruencia(registro);
        }

        res.json({
            success: true,
            numeroId,
            ansiedad,
            depresion,
            congruencia
        });
    } catch (error) {
        console.error('Error consultando pruebas psicologicas:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Route 2 - List orders for APROBADOR profile
router.get('/ordenes-aprobador', async (req, res) => {
    try {
        const { codEmpresa, buscar, limit = 100, offset = 0 } = req.query;

        // Use repository - 2 lines instead of 90
        const data = await HistoriaClinicaRepository.findByEmpresa(codEmpresa, {
            limit,
            offset,
            buscar
        });

        const total = await HistoriaClinicaRepository.countByEmpresa(codEmpresa, buscar);

        res.json({
            success: true,
            data,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Error al listar ordenes para aprobador:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar órdenes para aprobador',
            error: error.message
        });
    }
});

// Route 3 - AI statistics endpoint (SQL-powered via OpenAI)
router.post('/estadisticas-ia', async (req, res) => {
    try {
        const { codEmpresa, pregunta, historial } = req.body;

        if (!codEmpresa || !pregunta) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere codEmpresa y pregunta'
            });
        }

        // Validate codEmpresa format (alphanumeric + hyphens only)
        if (!/^[a-zA-Z0-9\-_]+$/.test(codEmpresa)) {
            return res.status(400).json({
                success: false,
                message: 'Código de empresa inválido'
            });
        }

        const { procesarPreguntaIA } = require('../services/estadisticas-ia');
        const result = await procesarPreguntaIA(codEmpresa, pregunta, historial || []);
        res.json(result);

    } catch (error) {
        console.error('Error en estadisticas IA:', error);
        res.status(500).json({
            success: false,
            message: 'Error al procesar la consulta',
            error: error.message
        });
    }
});

// Route 4 - Mark records as attended from Wix
router.post('/marcar-atendido', async (req, res) => {
    try {
        const { wixId } = req.body;

        console.log('');
        console.log('===================================================================');
        console.log('Recibida solicitud de marcar-atendido desde Wix');
        console.log('   wixId:', wixId);
        console.log('   atendido:', req.body.atendido);
        console.log('   fechaConsulta:', req.body.fechaConsulta);
        console.log('===================================================================');

        if (!wixId) {
            return res.status(400).json({
                success: false,
                message: 'wixId es requerido'
            });
        }

        // Use repository - handles upsert logic automatically
        const result = await HistoriaClinicaRepository.marcarAtendido(req.body);

        const existente = await HistoriaClinicaRepository.findById(wixId);
        const operacion = existente ? 'UPDATE' : 'INSERT';

        console.log(`HistoriaClinica ${operacion === 'INSERT' ? 'CREADA' : 'ACTUALIZADA'} como ATENDIDO`);
        console.log('   _id:', result._id);
        console.log('   numeroId:', result.numeroId);
        console.log('   primerNombre:', result.primerNombre);
        console.log('===================================================================');
        console.log('');

        res.json({
            success: true,
            message: `HistoriaClinica ${operacion === 'INSERT' ? 'creada' : 'actualizada'} como ATENDIDO`,
            operacion: operacion,
            data: {
                _id: result._id,
                numeroId: result.numeroId,
                primerNombre: result.primerNombre
            }
        });

    } catch (error) {
        console.error('Error en marcar-atendido:', error);
        res.status(500).json({
            success: false,
            message: 'Error al marcar como atendido',
            error: error.message
        });
    }
});

module.exports = router;
