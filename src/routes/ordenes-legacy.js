const express = require('express');
const router = express.Router();
const pool = require('../config/database');

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

        let query = `
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre", h."primerApellido", h."segundoApellido",
                   h."codEmpresa", h."empresa", h."cargo", h."tipoExamen", h."medico", h."atendido",
                   h."fechaAtencion", h."horaAtencion", h."examenes", h."ciudad", h."celular",
                   h."_createdDate", h."_updatedDate", h."fechaConsulta", h."aprobacion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado", h."mdObsParaMiDocYa",
                   h."centro_de_costo",
                   (
                       SELECT foto_url FROM formularios
                       WHERE (wix_id = h."_id" OR numero_id = h."numeroId") AND foto_url IS NOT NULL
                       ORDER BY fecha_registro DESC LIMIT 1
                   ) as foto_url
            FROM "HistoriaClinica" h
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (codEmpresa) {
            query += ` AND h."codEmpresa" = $${paramIndex}`;
            params.push(codEmpresa);
            paramIndex++;
        }

        if (buscar) {
            query += ` AND (
                COALESCE(h."numeroId", '') || ' ' ||
                COALESCE(h."primerNombre", '') || ' ' ||
                COALESCE(h."primerApellido", '') || ' ' ||
                COALESCE(h."codEmpresa", '') || ' ' ||
                COALESCE(h."celular", '') || ' ' ||
                COALESCE(h."empresa", '')
            ) ILIKE $${paramIndex}`;
            params.push(`%${buscar}%`);
            paramIndex++;
        }

        query += ` ORDER BY h."fechaConsulta" DESC NULLS LAST, h."_createdDate" DESC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        let countQuery = `SELECT COUNT(*) FROM "HistoriaClinica" WHERE 1=1`;
        const countParams = [];
        let countParamIndex = 1;

        if (codEmpresa) {
            countQuery += ` AND "codEmpresa" = $${countParamIndex}`;
            countParams.push(codEmpresa);
            countParamIndex++;
        }

        if (buscar) {
            countQuery += ` AND (
                COALESCE("numeroId", '') || ' ' ||
                COALESCE("primerNombre", '') || ' ' ||
                COALESCE("primerApellido", '') || ' ' ||
                COALESCE("codEmpresa", '') || ' ' ||
                COALESCE("celular", '') || ' ' ||
                COALESCE("empresa", '')
            ) ILIKE $${countParamIndex}`;
            countParams.push(`%${buscar}%`);
        }

        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);

        res.json({
            success: true,
            data: result.rows,
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

        const statsQuery = `
            SELECT
                COUNT(*) as total_empleados,
                COUNT(*) FILTER (WHERE UPPER(fuma) = 'SI') as fumadores,
                COUNT(*) FILTER (WHERE UPPER(presion_alta) = 'SI') as presion_alta,
                COUNT(*) FILTER (WHERE UPPER(problemas_cardiacos) = 'SI') as problemas_cardiacos,
                COUNT(*) FILTER (WHERE UPPER(problemas_azucar) = 'SI') as diabetes,
                COUNT(*) FILTER (WHERE UPPER(hormigueos) = 'SI') as hormigueos,
                COUNT(*) FILTER (WHERE UPPER(dolor_espalda) = 'SI') as dolor_espalda,
                COUNT(*) FILTER (WHERE UPPER(dolor_cabeza) = 'SI') as dolor_cabeza,
                COUNT(*) FILTER (WHERE UPPER(problemas_sueno) = 'SI') as problemas_sueno,
                COUNT(*) FILTER (WHERE UPPER(embarazo) = 'SI') as embarazos,
                COUNT(*) FILTER (WHERE UPPER(hernias) = 'SI') as hernias,
                COUNT(*) FILTER (WHERE UPPER(varices) = 'SI') as varices,
                COUNT(*) FILTER (WHERE UPPER(hepatitis) = 'SI') as hepatitis,
                COUNT(*) FILTER (WHERE UPPER(enfermedad_higado) = 'SI') as enfermedad_higado,
                COUNT(*) FILTER (WHERE UPPER(enfermedad_pulmonar) = 'SI') as enfermedad_pulmonar,
                COUNT(*) FILTER (WHERE UPPER(cirugia_ocular) = 'SI') as cirugia_ocular,
                COUNT(*) FILTER (WHERE UPPER(usa_anteojos) = 'SI') as usa_anteojos,
                COUNT(*) FILTER (WHERE UPPER(usa_lentes_contacto) = 'SI') as usa_lentes_contacto,
                COUNT(*) FILTER (WHERE UPPER(condicion_medica) = 'SI') as condicion_medica_tratamiento,
                COUNT(*) FILTER (WHERE UPPER(trastorno_psicologico) = 'SI') as trastorno_psicologico,
                COUNT(*) FILTER (WHERE UPPER(sintomas_psicologicos) = 'SI') as sintomas_psicologicos,
                COUNT(*) FILTER (WHERE UPPER(diagnostico_cancer) = 'SI') as diagnostico_cancer,
                COUNT(*) FILTER (WHERE UPPER(enfermedades_laborales) = 'SI') as enfermedades_laborales,
                COUNT(*) FILTER (WHERE UPPER(enfermedad_osteomuscular) = 'SI') as enfermedad_osteomuscular,
                COUNT(*) FILTER (WHERE UPPER(enfermedad_autoinmune) = 'SI') as enfermedad_autoinmune,
                COUNT(*) FILTER (WHERE UPPER(genero) = 'MASCULINO') as hombres,
                COUNT(*) FILTER (WHERE UPPER(genero) = 'FEMENINO') as mujeres,
                ROUND(AVG(edad)::numeric, 1) as edad_promedio,
                MIN(edad) as edad_minima,
                MAX(edad) as edad_maxima,
                COUNT(*) FILTER (WHERE UPPER(familia_diabetes) = 'SI') as familia_diabetes,
                COUNT(*) FILTER (WHERE UPPER(familia_hipertension) = 'SI') as familia_hipertension,
                COUNT(*) FILTER (WHERE UPPER(familia_cancer) = 'SI') as familia_cancer,
                COUNT(*) FILTER (WHERE UPPER(familia_infartos) = 'SI') as familia_infartos,
                COUNT(*) FILTER (WHERE UPPER(familia_trastornos) = 'SI') as familia_trastornos_mentales,
                COUNT(*) FILTER (WHERE UPPER(familia_hereditarias) = 'SI') as familia_enfermedades_hereditarias,
                COUNT(*) FILTER (WHERE UPPER(familia_geneticas) = 'SI') as familia_enfermedades_geneticas,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) = 'NUNCA') as licor_nunca,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) = 'OCASIONALMENTE') as licor_ocasional,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) = '1 DIA SEMANAL' OR UPPER(consumo_licor) = '1 DIA SEMANAL') as licor_1_dia,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) = '2 DIAS SEMANALES' OR UPPER(consumo_licor) = '2 DIAS SEMANALES') as licor_2_dias,
                COUNT(*) FILTER (WHERE UPPER(consumo_licor) LIKE '%+ DE 2%' OR UPPER(consumo_licor) LIKE '%MAS DE 2%') as licor_mas_2_dias,
                COUNT(*) FILTER (WHERE UPPER(ejercicio) = 'OCASIONALMENTE') as ejercicio_ocasional,
                COUNT(*) FILTER (WHERE UPPER(ejercicio) = '1 DIA SEMANAL' OR UPPER(ejercicio) = '1 DIA SEMANAL') as ejercicio_1_dia,
                COUNT(*) FILTER (WHERE UPPER(ejercicio) = '2 DIAS SEMANALES' OR UPPER(ejercicio) = '2 DIAS SEMANALES') as ejercicio_2_dias,
                COUNT(*) FILTER (WHERE UPPER(ejercicio) LIKE '%+ DE 2%' OR UPPER(ejercicio) LIKE '%MAS DE 2%') as ejercicio_mas_2_dias
            FROM formularios
            WHERE UPPER(cod_empresa) = UPPER($1)
        `;

        const statsResult = await pool.query(statsQuery, [codEmpresa]);
        const stats = statsResult.rows[0];

        const ordenesQuery = `
            SELECT
                COUNT(*) as total_ordenes,
                COUNT(*) FILTER (WHERE "atendido" = 'ATENDIDO') as atendidos,
                COUNT(*) FILTER (WHERE "atendido" = 'PENDIENTE') as pendientes
            FROM "HistoriaClinica"
            WHERE UPPER("codEmpresa") = UPPER($1)
        `;
        const ordenesResult = await pool.query(ordenesQuery, [codEmpresa]);
        const ordenes = ordenesResult.rows[0];

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
        const {
            wixId,
            atendido,
            fechaConsulta,
            mdConceptoFinal,
            mdRecomendacionesMedicasAdicionales,
            mdObservacionesCertificado,
            numeroId,
            primerNombre,
            segundoNombre,
            primerApellido,
            segundoApellido,
            celular,
            email,
            codEmpresa,
            empresa,
            cargo,
            tipoExamen,
            fechaAtencion
        } = req.body;

        console.log('');
        console.log('===================================================================');
        console.log('Recibida solicitud de marcar-atendido desde Wix');
        console.log('   wixId:', wixId);
        console.log('   atendido:', atendido);
        console.log('   fechaConsulta:', fechaConsulta);
        console.log('===================================================================');

        if (!wixId) {
            return res.status(400).json({
                success: false,
                message: 'wixId es requerido'
            });
        }

        const checkResult = await pool.query('SELECT "_id" FROM "HistoriaClinica" WHERE "_id" = $1', [wixId]);

        let result;
        let operacion;

        if (checkResult.rows.length > 0) {
            operacion = 'UPDATE';
            const updateQuery = `
                UPDATE "HistoriaClinica" SET
                    "atendido" = $1,
                    "fechaConsulta" = $2,
                    "mdConceptoFinal" = $3,
                    "mdRecomendacionesMedicasAdicionales" = $4,
                    "mdObservacionesCertificado" = $5,
                    "_updatedDate" = NOW()
                WHERE "_id" = $6
                RETURNING "_id", "numeroId", "primerNombre"
            `;

            const updateValues = [
                atendido || 'ATENDIDO',
                fechaConsulta ? new Date(fechaConsulta) : new Date(),
                mdConceptoFinal || null,
                mdRecomendacionesMedicasAdicionales || null,
                mdObservacionesCertificado || null,
                wixId
            ];

            result = await pool.query(updateQuery, updateValues);
        } else {
            operacion = 'INSERT';

            if (!numeroId || !primerNombre || !primerApellido || !celular) {
                console.log('Faltan campos requeridos para INSERT');
                return res.status(400).json({
                    success: false,
                    message: 'Para crear un nuevo registro se requieren: numeroId, primerNombre, primerApellido, celular'
                });
            }

            const insertQuery = `
                INSERT INTO "HistoriaClinica" (
                    "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                    "celular", "email", "codEmpresa", "empresa", "cargo", "tipoExamen",
                    "fechaAtencion", "atendido", "fechaConsulta", "mdConceptoFinal",
                    "mdRecomendacionesMedicasAdicionales", "mdObservacionesCertificado", "_createdDate", "_updatedDate"
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()
                )
                RETURNING "_id", "numeroId", "primerNombre"
            `;

            const insertValues = [
                wixId,
                numeroId,
                primerNombre,
                segundoNombre || null,
                primerApellido,
                segundoApellido || null,
                celular,
                email || null,
                codEmpresa || null,
                empresa || null,
                cargo || null,
                tipoExamen || null,
                fechaAtencion ? new Date(fechaAtencion) : null,
                atendido || 'ATENDIDO',
                fechaConsulta ? new Date(fechaConsulta) : new Date(),
                mdConceptoFinal || null,
                mdRecomendacionesMedicasAdicionales || null,
                mdObservacionesCertificado || null
            ];

            result = await pool.query(insertQuery, insertValues);
        }

        console.log(`HistoriaClinica ${operacion === 'INSERT' ? 'CREADA' : 'ACTUALIZADA'} como ATENDIDO`);
        console.log('   _id:', result.rows[0]._id);
        console.log('   numeroId:', result.rows[0].numeroId);
        console.log('   primerNombre:', result.rows[0].primerNombre);
        console.log('===================================================================');
        console.log('');

        res.json({
            success: true,
            message: `HistoriaClinica ${operacion === 'INSERT' ? 'creada' : 'actualizada'} como ATENDIDO`,
            operacion: operacion,
            data: {
                _id: result.rows[0]._id,
                numeroId: result.rows[0].numeroId,
                primerNombre: result.rows[0].primerNombre
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
