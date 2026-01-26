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

async function buscarConversacion() {
    const numero = '573013731468';

    try {
        console.log(`🔍 Buscando conversaciones para número: ${numero}\n`);

        // Buscar todas las variantes del número
        const conversaciones = await pool.query(`
            SELECT
                id,
                celular,
                nombre_paciente,
                paciente_id,
                "stopBot",
                bot_activo,
                estado,
                fecha_inicio,
                fecha_ultima_actividad,
                origen
            FROM conversaciones_whatsapp
            WHERE celular LIKE '%${numero.slice(-10)}%'
            ORDER BY fecha_ultima_actividad DESC
        `);

        if (conversaciones.rows.length === 0) {
            console.log('❌ No se encontraron conversaciones para ese número');
        } else {
            console.log(`✅ Se encontraron ${conversaciones.rows.length} conversación(es):\n`);

            conversaciones.rows.forEach((conv, i) => {
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                console.log(`Conversación ${i + 1}:`);
                console.log(`  ID: ${conv.id}`);
                console.log(`  Celular: "${conv.celular}"`);
                console.log(`  Nombre: ${conv.nombre_paciente || 'sin nombre'}`);
                console.log(`  Paciente ID: ${conv.paciente_id || 'sin asignar'}`);
                console.log(`  stopBot: ${conv.stopBot}`);
                console.log(`  bot_activo: ${conv.bot_activo}`);
                console.log(`  Estado: ${conv.estado}`);
                console.log(`  Origen: ${conv.origen || 'N/A'}`);
                console.log(`  Fecha inicio: ${conv.fecha_inicio}`);
                console.log(`  Última actividad: ${conv.fecha_ultima_actividad}`);
                console.log('');
            });

            // Contar mensajes de cada conversación
            console.log('📊 Mensajes por conversación:\n');

            for (const conv of conversaciones.rows) {
                const mensajes = await pool.query(`
                    SELECT COUNT(*) as total
                    FROM mensajes_whatsapp
                    WHERE conversacion_id = $1
                `, [conv.id]);

                console.log(`  Conversación ${conv.id} ("${conv.celular}"): ${mensajes.rows[0].total} mensajes`);
            }

            // Si hay duplicados, mostrar cuál debería ser el correcto
            if (conversaciones.rows.length > 1) {
                console.log('\n⚠️  DUPLICADO DETECTADO\n');
                console.log('Criterio para elegir el correcto:');
                console.log('1. El que tenga más mensajes');
                console.log('2. El más antiguo (fecha_inicio más temprana)');
                console.log('3. El que tenga formato correcto (57XXXXXXXXXX sin +)\n');

                // Contar mensajes totales
                const conMensajes = [];
                for (const conv of conversaciones.rows) {
                    const count = await pool.query(`
                        SELECT COUNT(*) as total
                        FROM mensajes_whatsapp
                        WHERE conversacion_id = $1
                    `, [conv.id]);

                    conMensajes.push({
                        ...conv,
                        total_mensajes: parseInt(count.rows[0].total)
                    });
                }

                // Ordenar por mensajes
                conMensajes.sort((a, b) => b.total_mensajes - a.total_mensajes);

                console.log('💡 RECOMENDACIÓN:');
                console.log(`   Conversación correcta: ID ${conMensajes[0].id} ("${conMensajes[0].celular}")`);
                console.log(`   Razón: Tiene ${conMensajes[0].total_mensajes} mensajes (la que más tiene)`);

                if (conMensajes.length > 1) {
                    console.log('\n   Conversación(es) duplicada(s) a consolidar:');
                    for (let i = 1; i < conMensajes.length; i++) {
                        console.log(`     - ID ${conMensajes[i].id} ("${conMensajes[i].celular}") con ${conMensajes[i].total_mensajes} mensajes`);
                    }
                }
            }
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

buscarConversacion();
