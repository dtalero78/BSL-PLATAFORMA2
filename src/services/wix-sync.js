/**
 * Sincronización de datos con Wix CMS
 * - Audiometría → Wix crearAudiometria
 * - Pruebas ADC → Wix crearADC
 *
 * ⚠️  BSL-only (ver CLAUDE.md sección "Multi-Tenant Architecture").
 * Wix es exclusivo del tenant BSL. Otros tenants no se sincronizan con Wix —
 * las funciones hacen early-return con success=true (no-op silencioso) para
 * no romper call sites existentes.
 */

const { isBslTenantId } = require('../helpers/tenant');

// Función para sincronizar audiometría con Wix
async function syncAudiometriaToWix(datos, operacion, tenantId) {
    // Multi-tenant: solo BSL usa Wix
    if (!isBslTenantId(tenantId)) {
        return { success: true, skipped: true, reason: 'wix-bsl-only' };
    }

    try {
        const fetch = (await import('node-fetch')).default;

        // Mapear campos de PostgreSQL a Wix
        // PostgreSQL usa: aereo_od_8000, aereo_oi_8000
        // Wix usa: auDer8000, auIzq8000
        const wixPayload = {
            idGeneral: datos.orden_id,
            numeroId: datos.orden_id,
            cedula: datos.numero_id,
            codEmpresa: datos.cod_empresa,
            // Oído Derecho
            auDer250: datos.aereo_od_250,
            auDer500: datos.aereo_od_500,
            auDer1000: datos.aereo_od_1000,
            auDer2000: datos.aereo_od_2000,
            auDer3000: datos.aereo_od_3000,
            auDer4000: datos.aereo_od_4000,
            auDer6000: datos.aereo_od_6000,
            auDer8000: datos.aereo_od_8000,
            // Oído Izquierdo
            auIzq250: datos.aereo_oi_250,
            auIzq500: datos.aereo_oi_500,
            auIzq1000: datos.aereo_oi_1000,
            auIzq2000: datos.aereo_oi_2000,
            auIzq3000: datos.aereo_oi_3000,
            auIzq4000: datos.aereo_oi_4000,
            auIzq6000: datos.aereo_oi_6000,
            auIzq8000: datos.aereo_oi_8000
        };

        console.log('📤 Sincronizando audiometría con Wix...', operacion);
        console.log('📦 Payload Wix:', JSON.stringify(wixPayload, null, 2));

        const wixResponse = await fetch('https://www.bsl.com.co/_functions/crearAudiometria', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(wixPayload)
        });

        if (wixResponse.ok) {
            const wixResult = await wixResponse.json();
            console.log('✅ Audiometría sincronizada con Wix:', wixResult);
            return { success: true, wixResult };
        } else {
            const errorText = await wixResponse.text();
            console.error('❌ Error sincronizando con Wix:', errorText);
            return { success: false, error: errorText };
        }
    } catch (error) {
        console.error('❌ Error en sincronización Wix:', error.message);
        // No lanzar error para no bloquear el guardado en PostgreSQL
        return { success: false, error: error.message };
    }
}

// Función para sincronizar prueba ADC con Wix
async function syncADCToWix(datos, operacion, tenantId) {
    // Multi-tenant: solo BSL usa Wix
    if (!isBslTenantId(tenantId)) {
        return { success: true, skipped: true, reason: 'wix-bsl-only' };
    }

    try {
        const fetch = (await import('node-fetch')).default;

        // Mapear campos para Wix
        const wixPayload = {
            idGeneral: datos.orden_id,
            primerNombre: `${datos.primer_nombre || ''} ${datos.primer_apellido || ''}`.trim(),
            documento: datos.numero_id,
            empresa: datos.cod_empresa,
            // Incluir todas las respuestas
            ...datos
        };

        // Eliminar campos que no van a Wix
        delete wixPayload.orden_id;
        delete wixPayload.numero_id;
        delete wixPayload.primer_nombre;
        delete wixPayload.primer_apellido;
        delete wixPayload.cod_empresa;

        console.log('📤 Sincronizando prueba ADC con Wix...', operacion);

        const wixResponse = await fetch('https://www.bsl.com.co/_functions/crearADC', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(wixPayload)
        });

        if (wixResponse.ok) {
            const wixResult = await wixResponse.json();
            console.log('✅ Prueba ADC sincronizada con Wix:', wixResult);
            return { success: true, wixResult };
        } else {
            const errorText = await wixResponse.text();
            console.error('❌ Error sincronizando ADC con Wix:', errorText);
            return { success: false, error: errorText };
        }
    } catch (error) {
        console.error('❌ Error en sincronización ADC Wix:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    syncAudiometriaToWix,
    syncADCToWix
};
