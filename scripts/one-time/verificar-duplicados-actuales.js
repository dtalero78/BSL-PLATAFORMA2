require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
});

async function verificarDuplicados() {
    try {
        console.log('🔍 Verificando duplicados actuales en conversaciones_whatsapp...\n');

        // Buscar duplicados con y sin +
        const duplicados = await pool.query(`
            WITH numeros_normalizados AS (
                SELECT
                    id,
                    celular,
                    REPLACE(REPLACE(celular, '+', ''), 'whatsapp:', '') as celular_normalizado,
                    fecha_ultima_actividad
                FROM conversaciones_whatsapp
            ),
            duplicados_count AS (
                SELECT
                    celular_normalizado,
                    COUNT(*) as total,
                    array_agg(id ORDER BY fecha_ultima_actividad DESC) as ids,
                    array_agg(celular ORDER BY fecha_ultima_actividad DESC) as celulares_originales
                FROM numeros_normalizados
                GROUP BY celular_normalizado
                HAVING COUNT(*) > 1
            )
            SELECT
                celular_normalizado,
                total,
                ids,
                celulares_originales
            FROM duplicados_count
            ORDER BY total DESC, celular_normalizado
            LIMIT 20
        `);

        if (duplicados.rows.length === 0) {
            console.log('✅ NO hay duplicados. Todos los números están únicos.');
        } else {
            console.log(`⚠️  Se encontraron ${duplicados.rows.length} números con duplicados:\n`);

            duplicados.rows.forEach((dup, i) => {
                console.log(`${i + 1}. Número: ${dup.celular_normalizado}`);
                console.log(`   Total de registros: ${dup.total}`);
                console.log(`   IDs: ${dup.ids.join(', ')}`);
                console.log(`   Variantes:`);
                dup.celulares_originales.forEach(cel => {
                    console.log(`     - "${cel}"`);
                });
                console.log('');
            });

            // Contar total de duplicados
            const totalDuplicados = await pool.query(`
                WITH numeros_normalizados AS (
                    SELECT
                        REPLACE(REPLACE(celular, '+', ''), 'whatsapp:', '') as celular_normalizado
                    FROM conversaciones_whatsapp
                )
                SELECT COUNT(*) as total_duplicados
                FROM numeros_normalizados
                GROUP BY celular_normalizado
                HAVING COUNT(*) > 1
            `);

            console.log(`📊 Total de números con duplicados: ${totalDuplicados.rows.length}`);
        }

        // Verificar formatos de números
        console.log('\n📋 Formatos de números en la base de datos:');

        const formatos = await pool.query(`
            SELECT
                CASE
                    WHEN celular LIKE '+%' THEN 'Con + al inicio'
                    WHEN celular LIKE 'whatsapp:%' THEN 'Con whatsapp: prefix'
                    WHEN celular LIKE '57%' AND LENGTH(celular) = 12 THEN 'Formato correcto (57XXXXXXXXXX)'
                    WHEN celular LIKE '5757%' THEN 'Doble 57'
                    ELSE 'Otro formato'
                END as formato,
                COUNT(*) as cantidad,
                array_agg(celular ORDER BY id LIMIT 3) as ejemplos
            FROM conversaciones_whatsapp
            GROUP BY formato
            ORDER BY cantidad DESC
        `);

        formatos.rows.forEach(fmt => {
            console.log(`\n  ${fmt.formato}: ${fmt.cantidad} registros`);
            console.log(`    Ejemplos: ${fmt.ejemplos.slice(0, 3).join(', ')}`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

verificarDuplicados();
