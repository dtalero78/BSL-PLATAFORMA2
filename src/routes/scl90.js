const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Campos de preguntas SCL-90 (item1 a item90)
const camposPreguntas = Array.from({ length: 90 }, (_, i) => `item${i + 1}`);

// ─── Mapeo oficial de dimensiones SCL-90 ───
const dimensiones = {
    SOM: [1, 4, 12, 27, 40, 42, 48, 49, 52, 53, 56, 58],
    OBS: [3, 9, 10, 28, 38, 45, 46, 51, 55, 65],
    SI: [6, 21, 34, 36, 37, 41, 61, 69, 73],
    DEP: [5, 14, 15, 20, 22, 26, 29, 30, 31, 32, 54, 71, 79],
    ANS: [2, 17, 23, 33, 39, 57, 72, 78, 80, 86],
    HOS: [11, 24, 63, 67, 74, 81],
    FOB: [13, 25, 47, 50, 75, 82],
    PAR: [8, 18, 43, 68, 76, 83],
    PSIC: [7, 16, 35, 62, 77, 84, 85, 87, 88, 90],
    ADICIONALES: [19, 44, 59, 60, 64, 66, 89]
};

// ─── Baremos oficiales Colombia ───
const baremos = {
    MASCULINO: {
        SOM: { Pc50: 0.17, Pc85: 0.58 },
        OBS: { Pc50: 0.30, Pc85: 0.95 },
        SI: { Pc50: 0.22, Pc85: 0.78 },
        DEP: { Pc50: 0.23, Pc85: 0.69 },
        ANS: { Pc50: 0.20, Pc85: 0.70 },
        HOS: { Pc50: 0.17, Pc85: 0.67 },
        FOB: { Pc50: 0.00, Pc85: 0.57 },
        PAR: { Pc50: 0.17, Pc85: 0.83 },
        PSIC: { Pc50: 0.10, Pc85: 0.60 }
    },
    FEMENINO: {
        SOM: { Pc50: 0.33, Pc85: 1.24 },
        OBS: { Pc50: 0.55, Pc85: 1.35 },
        SI: { Pc50: 0.33, Pc85: 1.16 },
        DEP: { Pc50: 0.31, Pc85: 1.03 },
        ANS: { Pc50: 0.30, Pc85: 1.00 },
        HOS: { Pc50: 0.33, Pc85: 0.67 },
        FOB: { Pc50: 0.29, Pc85: 1.14 },
        PAR: { Pc50: 0.17, Pc85: 1.00 },
        PSIC: { Pc50: 0.10, Pc85: 0.70 }
    }
};

const dimensionesClave = ["SOM", "OBS", "SI", "DEP", "ANS", "HOS", "FOB", "PAR", "PSIC"];

function interpretarDimension(valor, pc50, pc85) {
    if (valor < pc50) return "BAJO";
    if (valor <= pc85) return "MEDIO";
    return "ALTO";
}

// Calcular e interpretar resultados SCL-90
async function calcularEInterpretar(ordenId) {
    // Obtener respuestas guardadas
    const scl90Result = await pool.query('SELECT * FROM scl90 WHERE orden_id = $1', [ordenId]);
    if (scl90Result.rows.length === 0) return null;

    const registro = scl90Result.rows[0];

    // Obtener género del paciente desde formularios
    const formResult = await pool.query(
        'SELECT genero FROM formularios WHERE wix_id = $1',
        [ordenId]
    );
    // Fallback: buscar por numero_id
    let genero = formResult.rows.length > 0 ? formResult.rows[0].genero : null;
    if (!genero && registro.numero_id) {
        const formResult2 = await pool.query(
            'SELECT genero FROM formularios WHERE numero_id = $1 ORDER BY created_at DESC LIMIT 1',
            [registro.numero_id]
        );
        genero = formResult2.rows.length > 0 ? formResult2.rows[0].genero : null;
    }

    if (!genero) {
        console.warn('⚠️ No se encontró género para orden:', ordenId, '- usando MASCULINO por defecto');
        genero = 'MASCULINO';
    }

    // Normalizar género
    const generoUpper = genero.trim().toUpperCase();
    let grupoGenero;
    if (generoUpper === 'MASCULINO' || generoUpper === 'HOMBRE') {
        grupoGenero = 'MASCULINO';
    } else if (generoUpper === 'FEMENINO' || generoUpper === 'MUJER') {
        grupoGenero = 'FEMENINO';
    } else {
        grupoGenero = 'MASCULINO'; // fallback
    }

    // 1. Calcular puntajes por dimensión (promedio de items)
    const resultado = {};
    for (const [dimension, items] of Object.entries(dimensiones)) {
        const suma = items.reduce((acc, num) => acc + (parseInt(registro[`item${num}`]) || 0), 0);
        const promedio = suma / items.length;
        resultado[dimension] = Number(promedio.toFixed(2));
    }

    // 2. Índices globales
    let sumaTotal = 0;
    let totalRespondidos = 0;
    let positivos = 0;
    for (let i = 1; i <= 90; i++) {
        const val = parseInt(registro[`item${i}`]) || 0;
        sumaTotal += val;
        totalRespondidos++;
        if (val > 0) positivos++;
    }

    resultado.GSI = totalRespondidos > 0 ? Number((sumaTotal / totalRespondidos).toFixed(2)) : 0;
    resultado.PST = positivos;
    resultado.PSDI = positivos > 0 ? Number((sumaTotal / positivos).toFixed(2)) : 0;

    // 3. Interpretar según baremos
    const baremosGenero = baremos[grupoGenero];
    const interpretacion = {};
    const baremosAplicados = {};

    for (const dim of dimensionesClave) {
        const valor = resultado[dim];
        const { Pc50, Pc85 } = baremosGenero[dim];
        interpretacion[dim] = interpretarDimension(valor, Pc50, Pc85);
        baremosAplicados[dim] = { Pc50, Pc85 };
    }

    // 4. Guardar resultados en la tabla
    await pool.query(
        `UPDATE scl90 SET genero = $1, resultado = $2, interpretacion = $3, baremos = $4, updated_at = CURRENT_TIMESTAMP WHERE orden_id = $5`,
        [grupoGenero, JSON.stringify(resultado), JSON.stringify(interpretacion), JSON.stringify(baremosAplicados), ordenId]
    );

    console.log('✅ SCL-90 calificado para orden:', ordenId, '| GSI:', resultado.GSI, '| PST:', resultado.PST);

    return { resultado, interpretacion, baremos: baremosAplicados, genero: grupoGenero };
}

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

        let operacion;

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

            await pool.query(updateQuery, values);
            operacion = 'UPDATE';
            console.log('✅ Prueba SCL-90 actualizada para orden:', datos.orden_id);
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

            await pool.query(insertQuery, values);
            operacion = 'INSERT';
            console.log('✅ Prueba SCL-90 creada para orden:', datos.orden_id);
        }

        // Calcular e interpretar resultados automáticamente
        const calificacion = await calcularEInterpretar(datos.orden_id);

        // Obtener registro completo con resultados
        const finalResult = await pool.query('SELECT * FROM scl90 WHERE orden_id = $1', [datos.orden_id]);

        return res.json({
            success: true,
            data: finalResult.rows[0],
            operacion,
            calificacion
        });
    } catch (error) {
        console.error('❌ Error guardando prueba SCL-90:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
