const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { OpenAI } = require('openai');

// Lazy init OpenAI
let _openai;
function getOpenAI() {
    if (!_openai) {
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}

// ==========================================
// ENDPOINTS VOXIMETRIA VIRTUAL
// ==========================================

// Obtener voximetria virtual por orden_id
router.get('/voximetria-virtual/:ordenId', async (req, res) => {
    try {
        const { ordenId } = req.params;

        const result = await pool.query(
            'SELECT * FROM voximetrias_virtual WHERE orden_id = $1',
            [ordenId]
        );

        if (result.rows.length === 0) {
            return res.json({ success: true, data: null });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Error obteniendo voximetria virtual:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Analizar audios con GPT-4o y guardar resultados
router.post('/voximetria-virtual/analizar', async (req, res) => {
    try {
        const { orden_id, numero_id, primer_nombre, primer_apellido, empresa, cod_empresa, sexo, edad, audios } = req.body;

        if (!orden_id) {
            return res.status(400).json({ success: false, message: 'orden_id es requerido' });
        }

        if (!audios || !audios.fonacion_sostenida) {
            return res.status(400).json({ success: false, message: 'Se requiere al menos el audio de fonación sostenida' });
        }

        // Build audio content parts for GPT-4o
        const audioFormat = audios.formato || 'wav';
        const audioParts = [];

        if (audios.fonacion_sostenida) {
            audioParts.push({
                type: 'input_audio',
                input_audio: {
                    data: audios.fonacion_sostenida,
                    format: audioFormat
                }
            });
        }

        if (audios.lectura) {
            audioParts.push({
                type: 'input_audio',
                input_audio: {
                    data: audios.lectura,
                    format: audioFormat
                }
            });
        }

        if (audios.conteo) {
            audioParts.push({
                type: 'input_audio',
                input_audio: {
                    data: audios.conteo,
                    format: audioFormat
                }
            });
        }

        const systemPrompt = `Eres un fonoaudiólogo especialista en salud ocupacional con amplia experiencia en análisis acústico de la voz.

Tu tarea es analizar las grabaciones de voz de un trabajador de call center y proporcionar:
1. Estimaciones de parámetros acústicos basándote en lo que escuchas
2. Un concepto clínico
3. Interpretación y recomendaciones

IMPORTANTE: Debes estimar los valores numéricos basándote en las características audibles de la voz (tono, estabilidad, ronquera, fuerza, etc.). Usa tu conocimiento de valores normativos para dar estimaciones realistas.

Responde EXCLUSIVAMENTE en formato JSON válido (sin markdown, sin bloques de código) con esta estructura exacta:
{
  "f0_mean": <número: frecuencia fundamental media estimada en Hz>,
  "f0_min": <número: F0 mínima estimada en Hz>,
  "f0_max": <número: F0 máxima estimada en Hz>,
  "jitter_percent": <número: jitter estimado en porcentaje>,
  "shimmer_percent": <número: shimmer estimado en porcentaje>,
  "hnr_db": <número: relación armónicos/ruido estimada en dB>,
  "intensidad_mean_db": <número: intensidad media estimada en dB>,
  "tiempo_maximo_fonacion_s": <número: duración de la fonación sostenida en segundos>,
  "concepto": "Normal" | "Revisión Sugerida" | "Alteración Detectada",
  "interpretacion": "<párrafo de 2-3 oraciones sobre los hallazgos>",
  "recomendaciones": "<3-5 recomendaciones separadas por punto y coma>"
}

VALORES DE REFERENCIA:
- F0 hombres: 85-155 Hz | F0 mujeres: 165-255 Hz
- Jitter normal: < 1.04%
- Shimmer normal: < 3.81%
- HNR normal: > 20 dB
- TMF normal adultos: > 15 segundos
- Intensidad conversacional: 60-70 dB`;

        const userPrompt = `Analiza estas grabaciones de voximetría ocupacional:

DATOS DEL PACIENTE:
- Sexo: ${sexo || 'No especificado'}
- Edad: ${edad || 'No especificada'}
- Empresa: ${empresa || 'No especificada'}
- Ocupación: Trabajador de call center

GRABACIONES ADJUNTAS:
1. Fonación sostenida (vocal "A" prolongada) - duración: ${audios.duracion_fonacion || 0} segundos
${audios.lectura ? `2. Lectura en voz alta de texto de atención al cliente - duración: ${audios.duracion_lectura || 0} segundos` : ''}
${audios.conteo ? `3. Conteo del 1 al 20 en una sola respiración - duración: ${audios.duracion_conteo || 0} segundos` : ''}

Por favor analiza la calidad vocal, estabilidad, presencia de ronquera o disfonía, y proporciona los parámetros acústicos estimados junto con tu interpretación clínica.`;

        const completion = await getOpenAI().chat.completions.create({
            model: 'gpt-4o-audio-preview',
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: userPrompt },
                        ...audioParts
                    ]
                }
            ],
            temperature: 0.3,
            max_tokens: 800
        });

        const responseText = completion.choices[0].message.content.trim();

        // Parse JSON (handle potential markdown wrapping)
        let parsed;
        try {
            parsed = JSON.parse(responseText);
        } catch (e) {
            // Try extracting JSON from markdown code block
            const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[1].trim());
            } else {
                throw new Error('No se pudo parsear la respuesta de IA: ' + responseText.substring(0, 200));
            }
        }

        // Override TMF with actual recorded duration if available
        if (audios.duracion_fonacion > 0) {
            parsed.tiempo_maximo_fonacion_s = Math.round(audios.duracion_fonacion * 100) / 100;
        }

        // Save to database
        const datos = {
            orden_id,
            numero_id,
            primer_nombre,
            primer_apellido,
            empresa,
            cod_empresa,
            ...parsed
        };

        // Upsert
        const existeResult = await pool.query(
            'SELECT id FROM voximetrias_virtual WHERE orden_id = $1',
            [orden_id]
        );

        let dbResult;
        if (existeResult.rows.length > 0) {
            const updateQuery = `
                UPDATE voximetrias_virtual SET
                    numero_id = $2, primer_nombre = $3, primer_apellido = $4,
                    empresa = $5, cod_empresa = $6,
                    f0_mean = $7, f0_min = $8, f0_max = $9,
                    jitter_percent = $10, shimmer_percent = $11, hnr_db = $12,
                    intensidad_mean_db = $13, tiempo_maximo_fonacion_s = $14,
                    concepto = $15, interpretacion = $16, recomendaciones = $17,
                    updated_at = CURRENT_TIMESTAMP
                WHERE orden_id = $1
                RETURNING *
            `;
            dbResult = await pool.query(updateQuery, [
                orden_id, numero_id, primer_nombre, primer_apellido, empresa, cod_empresa,
                parsed.f0_mean, parsed.f0_min, parsed.f0_max,
                parsed.jitter_percent, parsed.shimmer_percent, parsed.hnr_db,
                parsed.intensidad_mean_db, parsed.tiempo_maximo_fonacion_s,
                parsed.concepto, parsed.interpretacion, parsed.recomendaciones
            ]);
            console.log('Voximetria virtual actualizada (IA) para orden:', orden_id);
        } else {
            const insertQuery = `
                INSERT INTO voximetrias_virtual (
                    orden_id, numero_id, primer_nombre, primer_apellido, empresa, cod_empresa,
                    f0_mean, f0_min, f0_max, jitter_percent, shimmer_percent, hnr_db,
                    intensidad_mean_db, tiempo_maximo_fonacion_s,
                    concepto, interpretacion, recomendaciones
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                RETURNING *
            `;
            dbResult = await pool.query(insertQuery, [
                orden_id, numero_id, primer_nombre, primer_apellido, empresa, cod_empresa,
                parsed.f0_mean, parsed.f0_min, parsed.f0_max,
                parsed.jitter_percent, parsed.shimmer_percent, parsed.hnr_db,
                parsed.intensidad_mean_db, parsed.tiempo_maximo_fonacion_s,
                parsed.concepto, parsed.interpretacion, parsed.recomendaciones
            ]);
            console.log('Voximetria virtual creada (IA) para orden:', orden_id);
        }

        res.json({ success: true, data: dbResult.rows[0] });

    } catch (error) {
        console.error('Error analizando voximetria con IA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Crear o actualizar voximetria virtual (manual/legacy)
router.post('/voximetria-virtual', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id) {
            return res.status(400).json({ success: false, message: 'orden_id es requerido' });
        }

        const existeResult = await pool.query(
            'SELECT id FROM voximetrias_virtual WHERE orden_id = $1',
            [datos.orden_id]
        );

        if (existeResult.rows.length > 0) {
            const updateQuery = `
                UPDATE voximetrias_virtual SET
                    numero_id = $2, primer_nombre = $3, primer_apellido = $4,
                    empresa = $5, cod_empresa = $6,
                    f0_mean = $7, f0_min = $8, f0_max = $9,
                    jitter_percent = $10, shimmer_percent = $11, hnr_db = $12,
                    intensidad_mean_db = $13, tiempo_maximo_fonacion_s = $14,
                    concepto = $15, interpretacion = $16, recomendaciones = $17,
                    updated_at = CURRENT_TIMESTAMP
                WHERE orden_id = $1
                RETURNING *
            `;
            const values = [
                datos.orden_id, datos.numero_id, datos.primer_nombre, datos.primer_apellido,
                datos.empresa, datos.cod_empresa,
                datos.f0_mean, datos.f0_min, datos.f0_max,
                datos.jitter_percent, datos.shimmer_percent, datos.hnr_db,
                datos.intensidad_mean_db, datos.tiempo_maximo_fonacion_s,
                datos.concepto, datos.interpretacion, datos.recomendaciones
            ];
            const result = await pool.query(updateQuery, values);
            return res.json({ success: true, data: result.rows[0], operacion: 'UPDATE' });
        } else {
            const insertQuery = `
                INSERT INTO voximetrias_virtual (
                    orden_id, numero_id, primer_nombre, primer_apellido, empresa, cod_empresa,
                    f0_mean, f0_min, f0_max, jitter_percent, shimmer_percent, hnr_db,
                    intensidad_mean_db, tiempo_maximo_fonacion_s,
                    concepto, interpretacion, recomendaciones
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                RETURNING *
            `;
            const values = [
                datos.orden_id, datos.numero_id, datos.primer_nombre, datos.primer_apellido,
                datos.empresa, datos.cod_empresa,
                datos.f0_mean, datos.f0_min, datos.f0_max,
                datos.jitter_percent, datos.shimmer_percent, datos.hnr_db,
                datos.intensidad_mean_db, datos.tiempo_maximo_fonacion_s,
                datos.concepto, datos.interpretacion, datos.recomendaciones
            ];
            const result = await pool.query(insertQuery, values);
            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }
    } catch (error) {
        console.error('Error guardando voximetria virtual:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
