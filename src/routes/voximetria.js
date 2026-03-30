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

// Interpretar resultados con OpenAI
router.post('/voximetria-virtual/interpretar', async (req, res) => {
    try {
        const { f0_mean, f0_min, f0_max, jitter_percent, shimmer_percent, hnr_db, intensidad_mean_db, tiempo_maximo_fonacion_s, sexo, edad } = req.body;

        const prompt = `Eres un especialista en fonoaudiología ocupacional. Analiza estos resultados de voximetría de un trabajador de call center.

DATOS DEL PACIENTE:
- Sexo: ${sexo || 'No especificado'}
- Edad: ${edad || 'No especificada'}

RESULTADOS:
- Frecuencia fundamental (F0) media: ${f0_mean} Hz (rango: ${f0_min}-${f0_max} Hz)
- Jitter: ${jitter_percent}%
- Shimmer: ${shimmer_percent}%
- Relación armónicos/ruido (HNR): ${hnr_db} dB
- Intensidad media: ${intensidad_mean_db} dB
- Tiempo máximo de fonación (TMF): ${tiempo_maximo_fonacion_s} segundos

VALORES DE REFERENCIA:
- F0 hombres: 85-155 Hz | F0 mujeres: 165-255 Hz
- Jitter normal: < 1.04%
- Shimmer normal: < 3.81%
- HNR normal: > 20 dB
- TMF normal adultos: > 15 segundos
- Intensidad conversacional: 60-70 dB

Responde EXCLUSIVAMENTE en formato JSON con esta estructura:
{
  "concepto": "Normal" | "Revisión Sugerida" | "Alteración Detectada",
  "interpretacion": "Párrafo de 2-3 oraciones explicando los hallazgos principales",
  "recomendaciones": "Lista de 3-5 recomendaciones específicas para trabajador de call center, separadas por punto y coma"
}`;

        const completion = await getOpenAI().chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'Eres un fonoaudiólogo especialista en salud ocupacional. Responde SOLO en JSON válido, sin markdown ni bloques de código.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 500
        });

        const responseText = completion.choices[0].message.content.trim();
        const parsed = JSON.parse(responseText);

        res.json({ success: true, data: parsed });
    } catch (error) {
        console.error('Error interpretando voximetria con IA:', error);
        // Fallback si OpenAI falla
        res.json({
            success: true,
            data: {
                concepto: 'Revisión Sugerida',
                interpretacion: 'No fue posible generar la interpretación automática. Se recomienda revisión por fonoaudiólogo.',
                recomendaciones: 'Consultar con fonoaudiólogo para evaluación presencial; Realizar pausas vocales cada 45 minutos; Mantener hidratación constante durante la jornada'
            }
        });
    }
});

// Crear o actualizar voximetria virtual
router.post('/voximetria-virtual', async (req, res) => {
    try {
        const datos = req.body;

        if (!datos.orden_id) {
            return res.status(400).json({ success: false, message: 'orden_id es requerido' });
        }

        // Verificar si ya existe
        const existeResult = await pool.query(
            'SELECT id FROM voximetrias_virtual WHERE orden_id = $1',
            [datos.orden_id]
        );

        if (existeResult.rows.length > 0) {
            // Actualizar existente
            const updateQuery = `
                UPDATE voximetrias_virtual SET
                    numero_id = $2,
                    primer_nombre = $3,
                    primer_apellido = $4,
                    empresa = $5,
                    cod_empresa = $6,
                    f0_mean = $7,
                    f0_min = $8,
                    f0_max = $9,
                    jitter_percent = $10,
                    shimmer_percent = $11,
                    hnr_db = $12,
                    intensidad_mean_db = $13,
                    tiempo_maximo_fonacion_s = $14,
                    concepto = $15,
                    interpretacion = $16,
                    recomendaciones = $17,
                    updated_at = CURRENT_TIMESTAMP
                WHERE orden_id = $1
                RETURNING *
            `;

            const values = [
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa,
                datos.f0_mean,
                datos.f0_min,
                datos.f0_max,
                datos.jitter_percent,
                datos.shimmer_percent,
                datos.hnr_db,
                datos.intensidad_mean_db,
                datos.tiempo_maximo_fonacion_s,
                datos.concepto,
                datos.interpretacion,
                datos.recomendaciones
            ];

            const result = await pool.query(updateQuery, values);
            console.log('Voximetria virtual actualizada para orden:', datos.orden_id);

            return res.json({ success: true, data: result.rows[0], operacion: 'UPDATE' });
        } else {
            // Insertar nuevo
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
                datos.orden_id,
                datos.numero_id,
                datos.primer_nombre,
                datos.primer_apellido,
                datos.empresa,
                datos.cod_empresa,
                datos.f0_mean,
                datos.f0_min,
                datos.f0_max,
                datos.jitter_percent,
                datos.shimmer_percent,
                datos.hnr_db,
                datos.intensidad_mean_db,
                datos.tiempo_maximo_fonacion_s,
                datos.concepto,
                datos.interpretacion,
                datos.recomendaciones
            ];

            const result = await pool.query(insertQuery, values);
            console.log('Voximetria virtual creada para orden:', datos.orden_id);

            return res.json({ success: true, data: result.rows[0], operacion: 'INSERT' });
        }

    } catch (error) {
        console.error('Error guardando voximetria virtual:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
