/**
 * Script de prueba para verificar que los templates de Twilio
 * se guardan con su contenido REAL en la base de datos
 */

require('dotenv').config();
const twilio = require('twilio');

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

async function testTemplateRealContent() {
    console.log('🧪 TEST: Obtener contenido real de template desde Twilio API\n');

    // Template de prueba (formulario BSL)
    const templateSid = 'HX4554efaf53c1bd614d49c951e487d394';
    const testNumber = '+573004695574'; // Número de prueba
    const testWixId = 'TEST_' + Date.now();

    try {
        console.log('1️⃣ Enviando mensaje con Content Template...');
        console.log('   Template SID:', templateSid);
        console.log('   Número:', testNumber);
        console.log('   Variable {{1}}:', testWixId);

        // Enviar mensaje
        const message = await twilioClient.messages.create({
            contentSid: templateSid,
            from: process.env.TWILIO_WHATSAPP_FROM,
            to: `whatsapp:${testNumber}`,
            contentVariables: JSON.stringify({ "1": testWixId })
        });

        console.log('✅ Mensaje enviado');
        console.log('   SID:', message.sid);
        console.log('   Status:', message.status);
        console.log('   Body inicial:', message.body || '(vacío)');

        console.log('\n2️⃣ Esperando 1 segundo para que Twilio procese el template...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log('\n3️⃣ Consultando el mensaje completo desde la API de Twilio...');
        const mensajeCompleto = await twilioClient.messages(message.sid).fetch();

        console.log('✅ Mensaje obtenido desde Twilio API');
        console.log('   SID:', mensajeCompleto.sid);
        console.log('   Status:', mensajeCompleto.status);
        console.log('   Body renderizado:', mensajeCompleto.body ? '✅ DISPONIBLE' : '❌ NO DISPONIBLE');

        if (mensajeCompleto.body) {
            console.log('\n📝 CONTENIDO REAL DEL TEMPLATE:');
            console.log('━'.repeat(60));
            console.log(mensajeCompleto.body);
            console.log('━'.repeat(60));

            // Verificar que el wixId está en el contenido
            if (mensajeCompleto.body.includes(testWixId)) {
                console.log('\n✅ Las variables fueron reemplazadas correctamente');
            } else {
                console.log('\n⚠️  Las variables NO fueron reemplazadas');
            }
        } else {
            console.log('\n❌ El body NO está disponible en la respuesta de Twilio');
            console.log('   Esto puede significar que:');
            console.log('   - Twilio aún no procesó el template');
            console.log('   - El template no tiene contenido de texto');
            console.log('   - Hay un error en el template');
        }

        console.log('\n🎯 RESULTADO DEL TEST:');
        if (mensajeCompleto.body && mensajeCompleto.body.includes(testWixId)) {
            console.log('✅ EXITOSO - El contenido real del template está disponible');
            console.log('✅ La implementación funcionará correctamente');
        } else {
            console.log('❌ FALLIDO - El contenido real NO está disponible');
            console.log('⚠️  Necesitarás usar el diccionario TEMPLATE_TEXTS como fallback');
        }

    } catch (error) {
        console.error('\n❌ ERROR en el test:', error.message);
        if (error.code) {
            console.error('   Código de error:', error.code);
        }
        if (error.moreInfo) {
            console.error('   Más info:', error.moreInfo);
        }
    }
}

// Ejecutar el test
testTemplateRealContent()
    .then(() => {
        console.log('\n✅ Test completado');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ Error fatal:', error);
        process.exit(1);
    });
