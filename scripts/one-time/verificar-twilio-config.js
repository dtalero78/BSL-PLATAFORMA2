/**
 * Verificar configuración de Twilio WhatsApp
 */

require('dotenv').config();

async function verificarConfig() {
    console.log('🔍 Verificando configuración de Twilio...\n');

    console.log('📋 Variables de entorno:');
    console.log('   TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? '✅ Configurado' : '❌ No configurado');
    console.log('   TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? '✅ Configurado' : '❌ No configurado');
    console.log('   TWILIO_WHATSAPP_FROM:', process.env.TWILIO_WHATSAPP_FROM);
    console.log('   BASE_URL:', process.env.BASE_URL);
    console.log('   Status Callback URL:', process.env.BASE_URL + '/api/whatsapp/status');

    console.log('\n📝 Próximos pasos:');
    console.log('\n1. Verifica que configuraste el Status Callback URL en Twilio Console:');
    console.log('   🔗 https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders');
    console.log('   - Busca tu número: +573153369631');
    console.log('   - Haz clic en el número');
    console.log('   - En "Status Callback URL" debe estar: https://bsl-plataforma.com/api/whatsapp/status');
    console.log('   - Eventos seleccionados: Sent, Delivered');

    console.log('\n2. Verifica que tu servidor es accesible desde internet:');
    console.log('   curl -X POST https://bsl-plataforma.com/api/whatsapp/status');
    console.log('   (Debe devolver algo, no 404 o timeout)');

    console.log('\n3. Verifica el Twilio Debugger para ver errores de callback:');
    console.log('   🔗 https://console.twilio.com/us1/monitor/logs/debugger');
    console.log('   - Busca el SID del mensaje de prueba');
    console.log('   - Verifica si Twilio intentó llamar al callback');
    console.log('   - Verifica si hubo errores (timeouts, 404, 500, etc.)');

    console.log('\n4. Una vez configurado, envía un mensaje de prueba:');
    console.log('   node test-status-callback.js');

    console.log('\n💡 Nota importante:');
    console.log('   El Status Callback puede tardar unos segundos en ejecutarse.');
    console.log('   Twilio llama al callback cuando el estado del mensaje cambia a "sent" o "delivered".');
}

verificarConfig();
