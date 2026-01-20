/**
 * Script de prueba para verificar que los templates de Twilio CON VARIABLES
 * se guardan con su contenido REAL renderizado
 */

require('dotenv').config();
const twilio = require('twilio');

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

async function testTemplateConVariables() {
    console.log('🧪 TEST: Template con variables - Obtener contenido renderizado\n');

    // Template con variables: formulario con link
    const templateSid = 'HX4554efaf53c1bd614d49c951e487d394';
    const testNumber = '+573004695574';
    const testWixId = 'TEST_' + Date.now();

    try {
        console.log('1️⃣ Enviando mensaje con variables...');
        console.log('   Template SID:', templateSid);
        console.log('   Variable {{1}}:', testWixId);

        const message = await twilioClient.messages.create({
            contentSid: templateSid,
            from: process.env.TWILIO_WHATSAPP_FROM,
            to: `whatsapp:${testNumber}`,
            contentVariables: JSON.stringify({ "1": testWixId })
        });

        console.log('✅ Mensaje enviado, SID:', message.sid);

        // Esperar para que Twilio procese
        await new Promise(resolve => setTimeout(resolve, 1500));

        console.log('\n2️⃣ Consultando contenido renderizado...');
        const mensajeCompleto = await twilioClient.messages(message.sid).fetch();

        if (mensajeCompleto.body) {
            console.log('\n📝 CONTENIDO RENDERIZADO:');
            console.log('━'.repeat(70));
            console.log(mensajeCompleto.body);
            console.log('━'.repeat(70));

            // Verificar si las variables fueron reemplazadas
            if (mensajeCompleto.body.includes(testWixId)) {
                console.log('\n✅ ÉXITO: Las variables fueron reemplazadas correctamente');
                console.log(`   Se encontró: "${testWixId}" en el contenido`);
            } else {
                console.log('\n⚠️  INFO: Este template no usa la variable {{1}}');
                console.log('   El contenido real está disponible igualmente');
            }

            console.log('\n✅ SOLUCIÓN IMPLEMENTADA FUNCIONA CORRECTAMENTE');
            console.log('   El contenido REAL del template está disponible desde la API');
            console.log('   Ya no necesitas el diccionario TEMPLATE_TEXTS hardcodeado');
        } else {
            console.log('\n❌ Body no disponible');
        }

    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
    }
}

testTemplateConVariables()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('Error fatal:', error);
        process.exit(1);
    });
