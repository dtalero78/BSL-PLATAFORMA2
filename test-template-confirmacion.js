#!/usr/bin/env node
/**
 * Script de Prueba - Template de Confirmación de Proceso
 *
 * Prueba el envío del mensaje:
 * "Hola {nombre}. Necesitamos saber si continúas con el proceso o eliminamos el certificado. Gracias!"
 *
 * Template SID: HX156f42644eaf38f9775d32e9ca39c73a
 */

require('dotenv').config();
const twilio = require('twilio');

// Verificar que las variables de entorno estén configuradas
const requiredEnvVars = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_WHATSAPP_FROM',
    'TWILIO_TEMPLATE_CONFIRMACION_PROCESO'
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
async function testTemplateConfirmacion() {
    // Número de prueba (puedes cambiarlo)
    const numeroDestino = process.argv[2] || '573008021701';
    const nombrePaciente = process.argv[3] || 'Juan Pérez';

    console.log('📱 PRUEBA DE TEMPLATE DE CONFIRMACIÓN DE PROCESO');
    console.log('═'.repeat(60));
    console.log(`📞 Número destino: ${numeroDestino}`);
    console.log(`👤 Nombre: ${nombrePaciente}`);
    console.log(`📋 Template SID: ${process.env.TWILIO_TEMPLATE_CONFIRMACION_PROCESO}`);
    console.log(`📤 Remitente: ${process.env.TWILIO_WHATSAPP_FROM}`);
    console.log('═'.repeat(60));
    console.log();

    try {
        const formattedNumber = formatWhatsAppNumber(numeroDestino);
        console.log(`🔄 Enviando mensaje a ${formattedNumber}...`);
        console.log();

        const message = await client.messages.create({
            contentSid: process.env.TWILIO_TEMPLATE_CONFIRMACION_PROCESO,
            from: process.env.TWILIO_WHATSAPP_FROM,
            to: formattedNumber,
            contentVariables: JSON.stringify({
                '1': nombrePaciente // Variable del template
            })
        });

        console.log('✅ ¡Mensaje enviado exitosamente!');
        console.log();
        console.log('📊 Detalles del mensaje:');
        console.log('─'.repeat(60));
        console.log(`   SID del mensaje: ${message.sid}`);
        console.log(`   Estado: ${message.status}`);
        console.log(`   De: ${message.from}`);
        console.log(`   Para: ${message.to}`);
        console.log(`   Fecha de creación: ${message.dateCreated}`);
        console.log(`   Template usado: ${process.env.TWILIO_TEMPLATE_CONFIRMACION_PROCESO}`);
        console.log('─'.repeat(60));
        console.log();
        console.log('💡 Tips:');
        console.log('   • Revisa el mensaje en WhatsApp en el número de destino');
        console.log('   • Ver logs: https://console.twilio.com/us1/monitor/logs/sms');
        console.log(`   • Ver mensaje: https://console.twilio.com/us1/monitor/logs/sms/${message.sid}`);
        console.log();

        return message;
    } catch (error) {
        console.error('❌ Error al enviar mensaje:');
        console.error();
        console.error('Detalles del error:');
        console.error('─'.repeat(60));
        console.error(`   Código: ${error.code}`);
        console.error(`   Mensaje: ${error.message}`);
        console.error(`   Más info: ${error.moreInfo || 'N/A'}`);
        console.error('─'.repeat(60));
        console.error();

        if (error.code === 63016) {
            console.error('🔍 Este error significa que el template no está aprobado o no existe.');
            console.error('   Verifica en: https://console.twilio.com/us1/develop/sms/content-editor');
        } else if (error.code === 21608) {
            console.error('🔍 Este error significa que el número de destino no es válido.');
            console.error('   Verifica el formato del número (debe ser válido para WhatsApp).');
        }

        console.error();
        process.exit(1);
    }
}

// Mostrar ayuda
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
📖 USO DEL SCRIPT

    node test-template-confirmacion.js [NUMERO] [NOMBRE]

📝 PARÁMETROS

    NUMERO    Número de WhatsApp destino (opcional)
              Por defecto: 573008021701
              Formatos aceptados: 3008021701, 573008021701, +573008021701

    NOMBRE    Nombre del paciente (opcional)
              Por defecto: "Juan Pérez"

💡 EJEMPLOS

    # Prueba con valores por defecto
    node test-template-confirmacion.js

    # Especificar número
    node test-template-confirmacion.js 573125727007

    # Especificar número y nombre
    node test-template-confirmacion.js 573125727007 "María García"

🔧 CONFIGURACIÓN

    Este script requiere las siguientes variables en .env:
    - TWILIO_ACCOUNT_SID
    - TWILIO_AUTH_TOKEN
    - TWILIO_WHATSAPP_FROM
    - TWILIO_TEMPLATE_CONFIRMACION_PROCESO

📋 TEMPLATE

    SID: HX156f42644eaf38f9775d32e9ca39c73a
    Mensaje: "Hola {nombre}. Necesitamos saber si continúas con el proceso
              o eliminamos el certificado. Gracias!"
`);
    process.exit(0);
}

// Ejecutar prueba
console.log();
testTemplateConfirmacion()
    .then(() => {
        console.log('✅ Prueba completada exitosamente\n');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ La prueba falló\n');
        process.exit(1);
    });
