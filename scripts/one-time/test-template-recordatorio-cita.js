#!/usr/bin/env node
/**
 * Script de Prueba - Template de Recordatorio de Cita Próxima
 *
 * Prueba el envío del mensaje:
 * "Hola {nombre}, tu cita está próxima.. Comunícate ya haciendo clic en este link"
 * Con un botón que tiene URL dinámica
 *
 * Template SID: HX46fddaf93f19f21d72720743b836d237
 */

require('dotenv').config();
const twilio = require('twilio');

// Verificar que las variables de entorno estén configuradas
const requiredEnvVars = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_WHATSAPP_FROM',
    'TWILIO_TEMPLATE_RECORDATORIO_CITA'
];

console.log('🔍 Verificando configuración...\n');

let missingVars = [];
requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
        missingVars.push(varName);
        console.log(`❌ ${varName}: NO CONFIGURADA`);
    } else {
        console.log(`✅ ${varName}: ${varName.includes('TOKEN') ? '***' : process.env[varName]}`);
    }
});

if (missingVars.length > 0) {
    console.error('\n❌ Error: Faltan las siguientes variables de entorno:', missingVars.join(', '));
    console.error('Por favor configúralas en el archivo .env\n');
    process.exit(1);
}

console.log('\n✅ Todas las variables están configuradas\n');

// Inicializar cliente de Twilio
const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Función para formatear número de WhatsApp
function formatWhatsAppNumber(number) {
    let formatted = number.toString().replace(/\D/g, ''); // Remover no-numéricos

    if (!formatted.startsWith('57')) {
        formatted = '57' + formatted;
    }

    return `whatsapp:+${formatted}`;
}

// Función principal de prueba
async function testTemplateRecordatorioCita() {
    // Parámetros de prueba (puedes cambiarlos)
    const numeroDestino = process.argv[2] || '573008021701';
    const nombrePaciente = process.argv[3] || 'Juan Pérez';
    const historiaId = process.argv[4] || 'abc123-test-id-456';

    console.log('📱 PRUEBA DE TEMPLATE DE RECORDATORIO DE CITA PRÓXIMA');
    console.log('═'.repeat(70));
    console.log(`📞 Número destino: ${numeroDestino}`);
    console.log(`👤 Nombre: ${nombrePaciente}`);
    console.log(`🆔 Historia ID: ${historiaId}`);
    console.log(`📋 Template SID: ${process.env.TWILIO_TEMPLATE_RECORDATORIO_CITA}`);
    console.log(`📤 Remitente: ${process.env.TWILIO_WHATSAPP_FROM}`);
    console.log(`🔗 URL del botón: https://sea-lion-app-qcttp.ondigitalocean.app/?_id=${historiaId}`);
    console.log('═'.repeat(70));
    console.log();

    try {
        const formattedNumber = formatWhatsAppNumber(numeroDestino);
        console.log(`🔄 Enviando mensaje con botón a ${formattedNumber}...`);
        console.log();

        const message = await client.messages.create({
            contentSid: process.env.TWILIO_TEMPLATE_RECORDATORIO_CITA,
            from: process.env.TWILIO_WHATSAPP_FROM,
            to: formattedNumber,
            contentVariables: JSON.stringify({
                '1': nombrePaciente,  // Variable {{1}} en el body
                '2': historiaId       // Variable {{2}} en la URL del botón
            })
        });

        console.log('✅ ¡Mensaje enviado exitosamente!');
        console.log();
        console.log('📊 Detalles del mensaje:');
        console.log('─'.repeat(70));
        console.log(`   SID del mensaje: ${message.sid}`);
        console.log(`   Estado: ${message.status}`);
        console.log(`   De: ${message.from}`);
        console.log(`   Para: ${message.to}`);
        console.log(`   Fecha de creación: ${message.dateCreated}`);
        console.log(`   Template usado: ${process.env.TWILIO_TEMPLATE_RECORDATORIO_CITA}`);
        console.log('─'.repeat(70));
        console.log();
        console.log('💡 Tips:');
        console.log('   • Revisa el mensaje en WhatsApp en el número de destino');
        console.log('   • Verifica que el botón aparezca correctamente');
        console.log('   • Haz clic en el botón para verificar que la URL sea correcta');
        console.log('   • Ver logs: https://console.twilio.com/us1/monitor/logs/sms');
        console.log(`   • Ver mensaje: https://console.twilio.com/us1/monitor/logs/sms/${message.sid}`);
        console.log();
        console.log('🔍 Verificaciones:');
        console.log('   1. ¿El nombre del paciente aparece correctamente?');
        console.log('   2. ¿El botón tiene el texto correcto?');
        console.log('   3. ¿Al hacer clic en el botón te lleva a la URL correcta?');
        console.log(`   4. ¿La URL contiene el ID: ${historiaId}?`);
        console.log();

        return message;
    } catch (error) {
        console.error('❌ Error al enviar mensaje:');
        console.error();
        console.error('Detalles del error:');
        console.error('─'.repeat(70));
        console.error(`   Código: ${error.code}`);
        console.error(`   Mensaje: ${error.message}`);
        console.error(`   Más info: ${error.moreInfo || 'N/A'}`);
        console.error('─'.repeat(70));
        console.error();

        if (error.code === 63016) {
            console.error('🔍 Este error significa que el template no está aprobado o no existe.');
            console.error('   Verifica en: https://console.twilio.com/us1/develop/sms/content-editor');
            console.error(`   Busca el SID: ${process.env.TWILIO_TEMPLATE_RECORDATORIO_CITA}`);
        } else if (error.code === 21608) {
            console.error('🔍 Este error significa que el número de destino no es válido.');
            console.error('   Verifica el formato del número (debe ser válido para WhatsApp).');
        } else if (error.code === 63017) {
            console.error('🔍 Este error significa que las variables del template no coinciden.');
            console.error('   Verifica que el template tenga configuradas las variables {{1}} y {{2}}');
            console.error('   - {{1}} debe estar en el body (nombre)');
            console.error('   - {{2}} debe estar en la URL del botón (_id)');
        }

        console.error();
        process.exit(1);
    }
}

// Mostrar ayuda
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
📖 USO DEL SCRIPT

    node test-template-recordatorio-cita.js [NUMERO] [NOMBRE] [HISTORIA_ID]

📝 PARÁMETROS

    NUMERO       Número de WhatsApp destino (opcional)
                 Por defecto: 573008021701
                 Formatos aceptados: 3008021701, 573008021701, +573008021701

    NOMBRE       Nombre del paciente (opcional)
                 Por defecto: "Juan Pérez"

    HISTORIA_ID  ID de la historia clínica (opcional)
                 Por defecto: "abc123-test-id-456"
                 Este ID se usará en la URL del botón

💡 EJEMPLOS

    # Prueba con valores por defecto
    node test-template-recordatorio-cita.js

    # Especificar número
    node test-template-recordatorio-cita.js 573125727007

    # Especificar número y nombre
    node test-template-recordatorio-cita.js 573125727007 "María García"

    # Especificar todos los parámetros
    node test-template-recordatorio-cita.js 573125727007 "María García" "67890xyz"

🔧 CONFIGURACIÓN

    Este script requiere las siguientes variables en .env:
    - TWILIO_ACCOUNT_SID
    - TWILIO_AUTH_TOKEN
    - TWILIO_WHATSAPP_FROM
    - TWILIO_TEMPLATE_RECORDATORIO_CITA

📋 TEMPLATE

    SID: HX46fddaf93f19f21d72720743b836d237
    Mensaje: "Hola {nombre}, tu cita está próxima..
              Comunícate ya haciendo clic en este link"

    Variables:
    - {{1}} = Nombre del paciente (aparece en el mensaje)
    - {{2}} = ID de historia clínica (usado en URL del botón)

    Botón:
    - Texto: "Conectarme ahora" (o similar según configuración)
    - URL: https://sea-lion-app-qcttp.ondigitalocean.app/?_id={{2}}
`);
    process.exit(0);
}

// Ejecutar prueba
console.log();
testTemplateRecordatorioCita()
    .then(() => {
        console.log('✅ Prueba completada exitosamente\n');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ La prueba falló\n');
        process.exit(1);
    });
