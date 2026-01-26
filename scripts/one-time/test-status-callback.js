/**
 * Script de prueba para verificar Status Callback de Twilio
 *
 * Este script envía un mensaje de WhatsApp usando directamente la API de Twilio
 * (simulando envío desde plataforma externa como Wix).
 *
 * Luego verifica que el mensaje aparezca en la base de datos gracias al Status Callback.
 */

require('dotenv').config();
const { Pool } = require('pg');

// Configurar cliente de Twilio
const twilioClient = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Configurar pool de PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
});

async function testStatusCallback() {
    console.log('🧪 Iniciando prueba de Status Callback...\n');

    // Número de prueba (usa tu propio número o el del coordinador)
    const numeroDestino = process.env.COORDINADOR_CELULAR || '573125727007';
    const numeroFormateado = `whatsapp:+${numeroDestino}`;

    console.log(`📱 Enviando mensaje de prueba a: ${numeroFormateado}`);

    try {
        // Paso 1: Enviar mensaje usando API de Twilio directamente
        // Esto simula un envío desde Wix u otra plataforma externa
        console.log('\n📤 Paso 1: Enviando mensaje via API de Twilio...');

        const message = await twilioClient.messages.create({
            body: '🧪 PRUEBA STATUS CALLBACK\n\nEste es un mensaje de prueba enviado directamente desde la API de Twilio para verificar que el Status Callback funciona correctamente.\n\n' + new Date().toLocaleString('es-CO'),
            from: process.env.TWILIO_WHATSAPP_FROM,
            to: numeroFormateado,
            statusCallback: `${process.env.BASE_URL}/api/whatsapp/status`
        });

        console.log('✅ Mensaje enviado exitosamente!');
        console.log('   - Message SID:', message.sid);
        console.log('   - Status:', message.status);
        console.log('   - Status Callback URL:', message.statusCallback || 'No configurado');

        // Paso 2: Esperar a que Twilio envíe el callback
        console.log('\n⏳ Paso 2: Esperando callback de Twilio (10 segundos)...');
        console.log('   Twilio debería llamar a: ' + process.env.BASE_URL + '/api/whatsapp/status');

        await new Promise(resolve => setTimeout(resolve, 10000));

        // Paso 3: Verificar si el mensaje fue guardado en la base de datos
        console.log('\n🔍 Paso 3: Verificando si el mensaje está en la base de datos...');

        const result = await pool.query(
            'SELECT * FROM mensajes_whatsapp WHERE sid_twilio = $1',
            [message.sid]
        );

        if (result.rows.length > 0) {
            console.log('✅ ¡SUCCESS! El mensaje fue guardado automáticamente por el Status Callback!');
            console.log('\n📊 Datos del mensaje en BD:');
            console.log('   - ID:', result.rows[0].id);
            console.log('   - Conversación ID:', result.rows[0].conversacion_id);
            console.log('   - Contenido:', result.rows[0].contenido.substring(0, 50) + '...');
            console.log('   - Dirección:', result.rows[0].direccion);
            console.log('   - Timestamp:', result.rows[0].timestamp);
            console.log('\n✅ El Status Callback está funcionando correctamente!');
            console.log('📱 Ahora puedes abrir el panel de WhatsApp y ver el mensaje en la conversación.');
        } else {
            console.log('❌ FALLO: El mensaje NO fue guardado en la base de datos.');
            console.log('\n🔧 Posibles causas:');
            console.log('   1. Twilio no pudo alcanzar el callback URL (verifica firewall/nginx)');
            console.log('   2. El servidor no está escuchando en la URL correcta');
            console.log('   3. Hay un error en el endpoint /api/whatsapp/status');
            console.log('\n💡 Revisa los logs del servidor con:');
            console.log('   tail -f server.log | grep "Status callback"');
            console.log('\n💡 Revisa el Twilio Debugger:');
            console.log('   https://console.twilio.com/us1/monitor/logs/debugger');
        }

        // Paso 4: Mostrar conversación
        console.log('\n📋 Conversaciones en la base de datos:');
        const conversaciones = await pool.query(
            `SELECT id, celular, nombre_paciente, fecha_ultima_actividad
             FROM conversaciones_whatsapp
             WHERE celular = $1
             ORDER BY fecha_ultima_actividad DESC
             LIMIT 1`,
            [numeroDestino]
        );

        if (conversaciones.rows.length > 0) {
            const conv = conversaciones.rows[0];
            console.log(`   - ID: ${conv.id}`);
            console.log(`   - Celular: ${conv.celular}`);
            console.log(`   - Nombre: ${conv.nombre_paciente || 'Sin nombre'}`);
            console.log(`   - Última actividad: ${conv.fecha_ultima_actividad}`);

            // Contar mensajes en la conversación
            const mensajesCount = await pool.query(
                'SELECT COUNT(*) as total FROM mensajes_whatsapp WHERE conversacion_id = $1',
                [conv.id]
            );
            console.log(`   - Total mensajes: ${mensajesCount.rows[0].total}`);
        }

    } catch (error) {
        console.error('\n❌ ERROR durante la prueba:', error);
        console.error(error.stack);
    } finally {
        await pool.end();
        console.log('\n✅ Prueba finalizada.');
    }
}

// Ejecutar prueba
testStatusCallback().catch(console.error);
