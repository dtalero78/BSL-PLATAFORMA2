/**
 * Test con el template que incluye link al formulario (usa variable {{1}})
 */
require('dotenv').config();
const twilio = require('twilio');

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

async function test() {
    // Template: HX4554efaf53c1bd614d49c951e487d394
    // Contenido según tu diccionario: 
    // "¡Hola! Gracias por comunicarte con BSL.\n\nPara agilizar tu proceso, por favor completa el siguiente formulario: https://www.bsl.com.co/?_id={{1}}"
    
    const testWixId = 'TESTID_' + Date.now();
    
    console.log('Enviando template con link al formulario...');
    console.log('Variable {{1}}:', testWixId);
    
    const message = await twilioClient.messages.create({
        contentSid: 'HX4554efaf53c1bd614d49c951e487d394',
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: 'whatsapp:+573004695574',
        contentVariables: JSON.stringify({ "1": testWixId })
    });
    
    console.log('Mensaje enviado:', message.sid);
    console.log('Body inicial:', message.body || '(vacío)');
    
    await new Promise(r => setTimeout(r, 1500));
    
    const completo = await twilioClient.messages(message.sid).fetch();
    console.log('\n📝 BODY RENDERIZADO:');
    console.log(completo.body);
    
    if (completo.body.includes(testWixId)) {
        console.log('\n✅ Las variables SÍ fueron reemplazadas!');
    }
}

test().catch(console.error);
