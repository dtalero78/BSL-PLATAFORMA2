// Script de prueba para actualizar un formulario
// Uso: node test-update.js

const fetch = require('node-fetch');

async function testUpdate() {
    try {
        // 1. Obtener todos los formularios
        console.log('📋 Obteniendo formularios...');
        const listResponse = await fetch('http://localhost:8080/api/formularios');
        const listResult = await listResponse.json();

        if (!listResult.success || listResult.total === 0) {
            console.log('❌ No hay formularios para probar');
            return;
        }

        // 2. Buscar un formulario con wix_id y numero_id = 415117423
        const formulario = listResult.data.find(f =>
            f.numero_id === '415117423' || f.numero_id === 415117423
        );

        if (!formulario) {
            console.log('❌ No se encontró formulario con número de documento 415117423');
            console.log('Formularios disponibles:');
            listResult.data.slice(0, 5).forEach(f => {
                console.log(`  - ID: ${f.id}, numero_id: ${f.numero_id}, wix_id: ${f.wix_id || 'N/A'}`);
            });
            return;
        }

        console.log('\n📝 Formulario encontrado:');
        console.log(`  - ID: ${formulario.id}`);
        console.log(`  - Número ID: ${formulario.numero_id}`);
        console.log(`  - Wix ID: ${formulario.wix_id || 'N/A'}`);
        console.log(`  - Email actual: ${formulario.email}`);
        console.log(`  - Edad actual: ${formulario.edad}`);

        if (!formulario.wix_id) {
            console.log('\n⚠️ Este formulario NO tiene wix_id, no se sincronizará con Wix');
        }

        // 3. Actualizar el formulario
        console.log('\n🔄 Actualizando formulario...');
        const updateData = {
            id: formulario.id,
            genero: formulario.genero,
            edad: (formulario.edad || 30) + 1, // Incrementar edad en 1 para ver el cambio
            email: formulario.email || 'test@example.com',
            fecha_nacimiento: formulario.fecha_nacimiento,
            lugar_nacimiento: formulario.lugar_nacimiento,
            ciudad_residencia: formulario.ciudad_residencia,
            estado_civil: formulario.estado_civil,
            hijos: formulario.hijos,
            nivel_educativo: formulario.nivel_educativo,
            profesion_oficio: formulario.profesion_oficio,
            empresa1: formulario.empresa1,
            empresa2: formulario.empresa2,
            estatura: formulario.estatura,
            peso: formulario.peso,
            ejercicio: formulario.ejercicio
        };

        const updateResponse = await fetch(`http://localhost:8080/api/formularios/${formulario.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });

        const updateResult = await updateResponse.json();

        if (updateResult.success) {
            console.log('\n✅ Formulario actualizado exitosamente');
            console.log(`  - Nueva edad: ${updateResult.data.edad}`);
            console.log('\n📊 Verifica los logs del servidor para ver si se actualizó en Wix');
        } else {
            console.log('\n❌ Error al actualizar:', updateResult.error || updateResult.message);
        }

    } catch (error) {
        console.error('\n❌ Error en la prueba:', error.message);
    }
}

testUpdate();
