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

async function limpiarDuplicado() {
    try {
        console.log('🔍 Limpiando duplicado 42253 de Richard...\n');

        // Verificar que esté vacío
        const mensajes = await pool.query(`
            SELECT COUNT(*) as total
            FROM mensajes_whatsapp
            WHERE conversacion_id = 42253
        `);

        if (parseInt(mensajes.rows[0].total) > 0) {
            console.log(`⚠️  La conversación 42253 tiene ${mensajes.rows[0].total} mensajes`);
            console.log('   Migrando a ID 41997...');

            await pool.query(`
                UPDATE mensajes_whatsapp
                SET conversacion_id = 41997
                WHERE conversacion_id = 42253
            `);

            console.log(`✅ ${mensajes.rows[0].total} mensajes migrados`);
        } else {
            console.log('✅ La conversación 42253 está vacía');
        }

        // Eliminar el duplicado
        await pool.query(`
            DELETE FROM conversaciones_whatsapp
            WHERE id = 42253
        `);

        console.log('✅ Duplicado 42253 eliminado\n');

        // Verificar resultado
        const verificar = await pool.query(`
            SELECT id, celular, paciente_id, "stopBot", bot_activo
            FROM conversaciones_whatsapp
            WHERE celular LIKE '%3013731468%'
        `);

        console.log('📊 Estado final:');
        verificar.rows.forEach(conv => {
            console.log(`   ID ${conv.id}: "${conv.celular}" - stopBot=${conv.stopBot}, bot_activo=${conv.bot_activo}, paciente=${conv.paciente_id || 'sin asignar'}`);
        });

        if (verificar.rows.length === 1) {
            console.log('\n✅ PERFECTO: Solo queda 1 registro para este número');
        } else {
            console.log(`\n⚠️  Aún hay ${verificar.rows.length} registros`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

limpiarDuplicado();
