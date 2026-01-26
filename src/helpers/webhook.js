// ========== FUNCIONES PARA WEBHOOK MAKE.COM ==========

// Limpiar strings (quitar acentos, espacios, puntos)
function limpiarStringWebhook(str) {
    if (!str) return '';
    const acentos = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
                      'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'ñ': 'n', 'Ñ': 'N' };
    return str.split('').map(letra => acentos[letra] || letra).join('')
              .replace(/\s+/g, '').replace(/\./g, '').replace(/\t/g, '');
}

// Limpiar teléfono (quitar prefijo +57 o 57)
function limpiarTelefonoWebhook(telefono) {
    if (!telefono) return '';
    let limpio = telefono.replace(/\s+/g, '').replace(/-/g, '');
    if (limpio.startsWith('+57')) limpio = limpio.substring(3);
    else if (limpio.startsWith('57')) limpio = limpio.substring(2);
    return limpio;
}

// Determinar género basado en exámenes
function determinarGeneroWebhook(examenes) {
    if (!examenes) return '';
    return examenes.includes('Serología') ? 'FEMENINO' : '';
}

// Mapear ciudad a formato Make.com (sin acentos, sin espacios, todo en mayúsculas)
function mapearCiudadWebhook(ciudad) {
    if (!ciudad) return '';

    // Mapeo de ciudades a formato esperado por Make.com
    const mapaCiudades = {
        'Bogotá': 'BOGOTA',
        'Medellín': 'MEDELLIN',
        'Cali': 'CALI',
        'Barranquilla': 'BARRANQUILLA',
        'Cartagena': 'CARTAGENA',
        'Cúcuta': 'CUCUTA',
        'Bucaramanga': 'BUCARAMANGA',
        'Pereira': 'PEREIRA',
        'Santa Marta': 'SANTAMARTA',
        'Ibagué': 'IBAGUE',
        'Pasto': 'PASTO',
        'Manizales': 'MANIZALES',
        'Neiva': 'NEIVA',
        'Villavicencio': 'VILLAVICENCIO',
        'Armenia': 'ARMENIA',
        'Valledupar': 'VALLEDUPAR',
        'Montería': 'MONTERIA',
        'Sincelejo': 'SINCELEJO',
        'Popayán': 'POPAYAN',
        'Floridablanca': 'FLORIDABLANCA',
        'Buenaventura': 'BUENAVENTURA',
        'Soledad': 'SOLEDAD',
        'Itagüí': 'ITAGUI',
        'Soacha': 'SOACHA',
        'Bello': 'BELLO',
        'Palmira': 'PALMIRA',
        'Tunja': 'TUNJA',
        'Girardot': 'GIRARDOT',
        'Riohacha': 'RIOHACHA',
        'Barrancabermeja': 'BARRANCABERMEJA',
        'Dosquebradas': 'DOSQUEBRADAS',
        'Envigado': 'ENVIGADO',
        'Tuluá': 'TULUA',
        'Sogamoso': 'SOGAMOSO',
        'Duitama': 'DUITAMA',
        'Zipaquirá': 'ZIPAQUIRA',
        'Facatativá': 'FACATATIVA',
        'Chía': 'CHIA',
        'Fusagasugá': 'FUSAGASUGA',
        'Otro': 'OTRA'
    };

    // Buscar en el mapa, si no existe usar la función de limpieza genérica
    return mapaCiudades[ciudad] || limpiarStringWebhook(ciudad).toUpperCase();
}

// Disparar webhook a Make.com
async function dispararWebhookMake(orden) {
    try {
        // No enviar webhook para SANITHELP-JJ
        if (orden.codEmpresa === 'SANITHELP-JJ') {
            console.log('⏭️  Webhook Make.com omitido para SANITHELP-JJ:', orden._id);
            return;
        }

        const fetch = (await import('node-fetch')).default;

        // Si la modalidad es presencial, enviar "PRESENCIAL" como médico
        const medicoWebhook = orden.modalidad === 'presencial' ? 'PRESENCIAL' : limpiarStringWebhook(orden.medico);

        const params = new URLSearchParams({
            cel: limpiarTelefonoWebhook(orden.celular),
            cedula: limpiarStringWebhook(orden.numeroId),
            nombre: limpiarStringWebhook(orden.primerNombre),
            empresa: limpiarStringWebhook(orden.codEmpresa),
            genero: determinarGeneroWebhook(orden.examenes),
            ciudad: mapearCiudadWebhook(orden.ciudad),
            fecha: orden.fechaAtencion ? new Date(orden.fechaAtencion).toLocaleDateString('es-CO') : '',
            hora: orden.horaAtencion || '',
            medico: medicoWebhook,
            id: orden._id
        });

        const url = `https://hook.us1.make.com/3edkq8bfppx31t6zbd86sfu7urdrhti9?${params.toString()}`;

        const response = await fetch(url);
        console.log('✅ Webhook Make.com enviado:', orden._id);
    } catch (error) {
        console.error('❌ Error enviando webhook Make.com:', error.message);
        // No bloquear la respuesta al cliente si falla el webhook
    }
}

module.exports = {
    limpiarStringWebhook,
    limpiarTelefonoWebhook,
    determinarGeneroWebhook,
    mapearCiudadWebhook,
    dispararWebhookMake
};
