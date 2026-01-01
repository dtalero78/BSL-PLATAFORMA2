/**
 * Script para asignar permisos automáticamente a usuarios agente_chat
 * Ejecutar: node asignar-permisos-agentes.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

const PERMISOS_AGENTE_CHAT = [
    'CHAT_VER_CONVERSACIONES',
    'CHAT_RESPONDER',
    'CHAT_TRANSFERIR',
    'CHAT_ACTIVAR_BOT',
    'CHAT_CERRAR'
];

async function asignarPermisos() {
    try {
        console.log('🔍 Buscando usuarios con rol agente_chat...');

        const usuarios = await pool.query(`
            SELECT id, email, nombre_completo
            FROM usuarios
            WHERE rol = 'agente_chat' AND activo = true
        `);

        console.log(`✅ Encontrados ${usuarios.rows.length} usuarios agente_chat\n`);

        for (const usuario of usuarios.rows) {
            // Eliminar permisos existentes
            await pool.query(`
                DELETE FROM permisos_usuario WHERE usuario_id = $1
            `, [usuario.id]);

            // Insertar nuevos permisos
            for (const permiso of PERMISOS_AGENTE_CHAT) {
                await pool.query(`
                    INSERT INTO permisos_usuario (usuario_id, permiso, activo, fecha_asignacion)
                    VALUES ($1, $2, true, NOW())
                    ON CONFLICT (usuario_id, permiso) DO NOTHING
                `, [usuario.id, permiso]);
            }

            console.log(`✅ Permisos asignados a: ${usuario.email}`);
            console.log(`   ${usuario.nombre_completo || 'Sin nombre'}`);
            console.log(`   Permisos: ${PERMISOS_AGENTE_CHAT.join(', ')}\n`);
        }

        console.log('🎉 Proceso completado');
        console.log(`📊 Total usuarios actualizados: ${usuarios.rows.length}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
    } finally {
        await pool.end();
    }
}

asignarPermisos();
