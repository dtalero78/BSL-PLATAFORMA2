import fetch from 'node-fetch';

const WIX_BASE_URL = 'https://www.bsl.com.co/_functions';

async function consultarADC(numeroId) {
    try {
        const url = `${WIX_BASE_URL}/get_adctests?numeroId=${numeroId}`;

        console.log(`🔍 Consultando: ${url}`);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        console.log(`📡 Status: ${response.status}`);

        if (!response.ok) {
            const text = await response.text();
            console.error(`❌ Error HTTP: ${response.status}`);
            console.error(`Response: ${text}`);
            return;
        }

        const data = await response.json();

        console.log('\n📊 Resultado:');
        console.log(JSON.stringify(data, null, 2));

        if (data.items && data.items.length > 0) {
            console.log(`\n✅ Se encontraron ${data.items.length} pruebas ADC`);
        } else {
            console.log('\n⚠️ No se encontraron pruebas ADC para este paciente');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

const numeroId = process.argv[2] || '1032497737';
console.log(`\n🔎 Buscando pruebas ADC para cédula: ${numeroId}\n`);
consultarADC(numeroId);
