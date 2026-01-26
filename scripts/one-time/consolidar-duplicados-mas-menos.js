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

async function consolidarDuplicados() {
    const client = await pool.connect();

    try {
        console.log('🔍 Buscando duplicados con formato +573XXX vs 573XXX...\n');

        // Buscar todos los números que tienen duplicados (con + y sin +)
        const duplicados = await client.query(`
            WITH numeros_normalizados AS (
                SELECT
                    id,
                    celular,
                    REPLACE(celular, '+', '') as celular_normalizado,
                    paciente_id,
                    "stopBot",
                    bot_activo,
                    fecha_inicio
                FROM conversaciones_whatsapp
            ),
            grupos_duplicados AS (
                SELECT
                    celular_normalizado,
                    COUNT(*) as total,
                    array_agg(id ORDER BY fecha_inicio ASC) as ids,
                    array_agg(celular ORDER BY fecha_inicio ASC) as celulares_originales
                FROM numeros_normalizados
                GROUP BY celular_normalizado
                HAVING COUNT(*) > 1
            )
            SELECT * FROM grupos_duplicados
            ORDER BY celular_normalizado
        `);

        if (duplicados.rows.length === 0) {
            console.log('✅ No hay duplicados para consolidar');
            return;
        }

        console.log(`⚠️  Se encontraron ${duplicados.rows.length} grupos de duplicados\n`);

        let totalConsolidados = 0;
        let totalMensajesMigrados = 0;

        await client.query('BEGIN');

        for (const grupo of duplicados.rows) {
            const ids = grupo.ids;
            const celulares = grupo.celulares_originales;

            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`📱 Número: ${grupo.celular_normalizado}`);
            console.log(`   Total duplicados: ${grupo.total}`);

            // Identificar cuál es el registro SIN + (el correcto)
            let idCorrecto = null;
            let idsAEliminar = [];

            for (let i = 0; i < celulares.length; i++) {
                if (!celulares[i].startsWith('+')) {
                    idCorrecto = ids[i];
                    console.log(`   ✅ ID correcto (sin +): ${idCorrecto} ("${celulares[i]}")`);
                } else {
                    idsAEliminar.push(ids[i]);
                    console.log(`   ❌ ID a eliminar (con +): ${ids[i]} ("${celulares[i]}")`);
                }
            }

            // Si no hay registro sin +, usar el más antiguo
            if (!idCorrecto) {
                idCorrecto = ids[0];
                idsAEliminar = ids.slice(1);
                console.log(`   ⚠️  No hay registro sin +, usando más antiguo: ${idCorrecto}`);
            }

            // Contar mensajes en cada conversación
            for (const idDuplicado of idsAEliminar) {
                const countMensajes = await client.query(`
                    SELECT COUNT(*) as total
                    FROM mensajes_whatsapp
                    WHERE conversacion_id = $1
                `, [idDuplicado]);

                const totalMensajes = parseInt(countMensajes.rows[0].total);
                console.log(`   📨 Conversación ${idDuplicado}: ${totalMensajes} mensajes`);

                if (totalMensajes > 0) {
                    // Mover mensajes al ID correcto
                    await client.query(`
                        UPDATE mensajes_whatsapp
                        SET conversacion_id = $1
                        WHERE conversacion_id = $2
                    `, [idCorrecto, idDuplicado]);

                    console.log(`   ✅ ${totalMensajes} mensajes migrados a ID ${idCorrecto}`);
                    totalMensajesMigrados += totalMensajes;
                }
            }

            // Eliminar conversaciones duplicadas (ahora vacías)
            if (idsAEliminar.length > 0) {
                await client.query(`
                    DELETE FROM conversaciones_whatsapp
                    WHERE id = ANY($1::int[])
                `, [idsAEliminar]);

                console.log(`   🗑️  ${idsAEliminar.length} conversación(es) duplicada(s) eliminada(s)`);
                totalConsolidados += idsAEliminar.length;
            }

            console.log('');
        }

        await client.query('COMMIT');

        console.log('═════════════════════════════════════════════════════');
        console.log('✅ CONSOLIDACIÓN COMPLETADA');
        console.log('═════════════════════════════════════════════════════');
        console.log(`📊 Estadísticas:`);
        console.log(`   - Grupos consolidados: ${duplicados.rows.length}`);
        console.log(`   - Registros eliminados: ${totalConsolidados}`);
        console.log(`   - Mensajes migrados: ${totalMensajesMigrados}`);
        console.log('');
        console.log('✅ Todos los mensajes preservados y vinculados correctamente');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

consolidarDuplicados();
