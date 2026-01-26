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

        const { calcularAnsiedad } = require('../../calcular-ansiedad');
        const { calcularDepresion } = require('../../calcular-depresion');
        const { calcularCongruencia } = require('../../calcular-congruencia');

        const ansiedad = calcularAnsiedad(registro, codEmpresa);
        const depresion = calcularDepresion(registro, codEmpresa);
        const congruencia = calcularCongruencia(registro);

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

// Route 3 - AI statistics endpoint using OpenAI
router.post('/estadisticas-ia', async (req, res) => {
    try {
        const { codEmpresa, pregunta } = req.body;

        if (!codEmpresa || !pregunta) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere codEmpresa y pregunta'
            });
        }

        console.log('');
        console.log('===================================================================');
        console.log('CONSULTA IA - Empresa:', codEmpresa);
        console.log('Pregunta:', pregunta);
        console.log('===================================================================');

        // Use repositories - 2 lines instead of 60+
        const stats = await FormulariosRepository.getEstadisticasSalud(codEmpresa);
        const ordenes = await HistoriaClinicaRepository.getEstadisticasOrdenes(codEmpresa);

        const datosEstadisticos = `
DATOS DE SALUD DE LOS COLABORADORES:
- Total de empleados con formulario completado: ${stats.total_empleados}
- Hombres: ${stats.hombres} | Mujeres: ${stats.mujeres}
- Edad promedio: ${stats.edad_promedio || 'N/A'} anos (min: ${stats.edad_minima || 'N/A'}, max: ${stats.edad_maxima || 'N/A'})

HABITOS Y FACTORES DE RIESGO:
- Fumadores (fuman o fumaban): ${stats.fumadores}
- Con presion arterial alta: ${stats.presion_alta}
- Con problemas cardiacos: ${stats.problemas_cardiacos}
- Con diabetes o problemas de azucar: ${stats.diabetes}
- Con problemas de sueno: ${stats.problemas_sueno}

CONSUMO DE LICOR:
- Nunca consumen licor: ${stats.licor_nunca}
- Consumen ocasionalmente: ${stats.licor_ocasional}
- Consumen 1 dia a la semana: ${stats.licor_1_dia}
- Consumen 2 dias a la semana: ${stats.licor_2_dias}
- Consumen mas de 2 dias a la semana: ${stats.licor_mas_2_dias}

EJERCICIO FISICO:
- Hacen ejercicio ocasionalmente: ${stats.ejercicio_ocasional}
- Hacen ejercicio 1 dia a la semana: ${stats.ejercicio_1_dia}
- Hacen ejercicio 2 dias a la semana: ${stats.ejercicio_2_dias}
- Hacen ejercicio mas de 2 dias a la semana: ${stats.ejercicio_mas_2_dias}

SINTOMAS Y CONDICIONES:
- Con hormigueos: ${stats.hormigueos}
- Con dolor de espalda: ${stats.dolor_espalda}
- Con dolor de cabeza frecuente: ${stats.dolor_cabeza}
- Con hernias: ${stats.hernias}
- Con varices: ${stats.varices}
- Con hepatitis: ${stats.hepatitis}
- Con enfermedad del higado: ${stats.enfermedad_higado}
- Con enfermedad pulmonar: ${stats.enfermedad_pulmonar}
- Con condicion medica en tratamiento: ${stats.condicion_medica_tratamiento}
- Embarazos actuales: ${stats.embarazos}

SALUD VISUAL:
- Usan anteojos: ${stats.usa_anteojos}
- Usan lentes de contacto: ${stats.usa_lentes_contacto}
- Con cirugia ocular previa: ${stats.cirugia_ocular}

SALUD MENTAL:
- Con trastorno psicologico o psiquiatrico: ${stats.trastorno_psicologico}
- Con sintomas psicologicos recientes: ${stats.sintomas_psicologicos}

OTRAS CONDICIONES:
- Con diagnostico o sospecha de cancer: ${stats.diagnostico_cancer}
- Con enfermedades laborales o accidentes de trabajo: ${stats.enfermedades_laborales}
- Con enfermedad osteomuscular: ${stats.enfermedad_osteomuscular}
- Con enfermedad autoinmune: ${stats.enfermedad_autoinmune}

ANTECEDENTES FAMILIARES:
- Familiares con diabetes: ${stats.familia_diabetes}
- Familiares con hipertension: ${stats.familia_hipertension}
- Familiares con cancer: ${stats.familia_cancer}
- Familiares con infartos: ${stats.familia_infartos}
- Familiares con trastornos mentales: ${stats.familia_trastornos_mentales}
- Familiares con enfermedades hereditarias: ${stats.familia_enfermedades_hereditarias}
- Familiares con enfermedades geneticas: ${stats.familia_enfermedades_geneticas}

ORDENES/CITAS MEDICAS:
- Total de ordenes: ${ordenes.total_ordenes}
- Atendidos: ${ordenes.atendidos}
- Pendientes: ${ordenes.pendientes}
`;

        console.log('Datos estadisticos obtenidos');

        const fetch = (await import('node-fetch')).default;
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Eres un asistente de análisis de salud ocupacional para la empresa ${codEmpresa}.
Tu rol es ayudar al área de recursos humanos a entender la salud de sus colaboradores.

Tienes acceso a los siguientes datos estadísticos:
${datosEstadisticos}

INSTRUCCIONES:
- Responde de forma clara, concisa y profesional
- Siempre incluye números absolutos y porcentajes cuando sea relevante
- Si la pregunta no puede ser respondida con los datos disponibles, indícalo amablemente
- Usa emojis moderadamente para hacer la respuesta más visual
- Si detectas datos preocupantes, sugiere acciones preventivas
- Nunca inventes datos, solo usa los proporcionados
- Responde en español`
                    },
                    {
                        role: 'user',
                        content: pregunta
                    }
                ],
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!openaiResponse.ok) {
            const errorData = await openaiResponse.text();
            console.error('Error de OpenAI:', errorData);
            throw new Error('Error al comunicarse con OpenAI');
        }

        const openaiData = await openaiResponse.json();
        const respuestaIA = openaiData.choices[0].message.content;

        console.log('Respuesta IA generada exitosamente');

        res.json({
            success: true,
            respuesta: respuestaIA,
            datosBase: {
                totalEmpleados: parseInt(stats.total_empleados),
                totalOrdenes: parseInt(ordenes.total_ordenes)
            }
        });

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
