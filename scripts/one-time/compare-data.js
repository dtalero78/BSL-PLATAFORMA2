// Script para comparar datos entre PostgreSQL y Wix
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
        rejectUnauthorized: false
    }
});

async function compareData() {
    try {
        // Importar fetch de forma dinámica para node-fetch v3
        const fetch = (await import('node-fetch')).default;

        // Consultar PostgreSQL
        console.log('📊 Consultando PostgreSQL...\n');
        const pgResult = await pool.query(
            "SELECT * FROM formularios WHERE numero_id = '415117423'"
        );

        if (pgResult.rows.length === 0) {
            console.log('❌ No se encontró el registro en PostgreSQL');
            await pool.end();
            return;
        }

        const pgData = pgResult.rows[0];
        console.log('PostgreSQL:');
        console.log('  ID:', pgData.id);
        console.log('  Número ID:', pgData.numero_id);
        console.log('  Wix ID:', pgData.wix_id);
        console.log('  Edad:', pgData.edad);
        console.log('  Género:', pgData.genero);
        console.log('  Email:', pgData.email);
        console.log('  Estado Civil:', pgData.estado_civil);
        console.log('  Hijos:', pgData.hijos);
        console.log('  Lugar Nacimiento:', pgData.lugar_nacimiento);
        console.log('  Ciudad Residencia:', pgData.ciudad_residencia);
        console.log('  Profesión/Oficio:', pgData.profesion_oficio);
        console.log('  Empresa 1:', pgData.empresa1);
        console.log('  Empresa 2:', pgData.empresa2);
        console.log('  Estatura:', pgData.estatura);
        console.log('  Peso:', pgData.peso);
        console.log('  Ejercicio:', pgData.ejercicio);

        // Consultar Wix
        console.log('\n📊 Consultando Wix...\n');
        const wixResponse = await fetch(
            `https://www.bsl.com.co/_functions/formularioPorIdGeneral?idGeneral=${pgData.wix_id}`
        );

        if (!wixResponse.ok) {
            console.log('❌ Error al consultar Wix');
            await pool.end();
            return;
        }

        const wixResult = await wixResponse.json();

        if (!wixResult.success || !wixResult.item) {
            console.log('❌ No se encontró el registro en Wix');
            await pool.end();
            return;
        }

        const wixData = wixResult.item;
        console.log('Wix FORMULARIO:');
        console.log('  _id:', wixData._id);
        console.log('  idGeneral:', wixData.idGeneral);
        console.log('  numeroId:', wixData.numeroId);
        console.log('  Edad:', wixData.edad);
        console.log('  Género:', wixData.genero);
        console.log('  Email:', wixData.email);
        console.log('  Estado Civil:', wixData.estadoCivil);
        console.log('  Hijos:', wixData.hijos);
        console.log('  Lugar Nacimiento:', wixData.lugarDeNacimiento);
        console.log('  Ciudad Residencia:', wixData.ciudadDeResidencia);
        console.log('  Profesión/Oficio:', wixData.profesionUOficio);
        console.log('  Empresa 1:', wixData.empresa1);
        console.log('  Empresa 2:', wixData.empresa2);
        console.log('  Estatura:', wixData.estatura);
        console.log('  Peso:', wixData.peso);
        console.log('  Ejercicio:', wixData.ejercicio);

        // Comparar datos
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('📋 COMPARACIÓN DE DATOS');
        console.log('═══════════════════════════════════════════════════════════\n');

        const comparisons = [
            { field: 'Edad', pg: pgData.edad, wix: wixData.edad },
            { field: 'Género', pg: pgData.genero, wix: wixData.genero },
            { field: 'Email', pg: pgData.email, wix: wixData.email },
            { field: 'Estado Civil', pg: pgData.estado_civil, wix: wixData.estadoCivil },
            { field: 'Hijos', pg: pgData.hijos, wix: wixData.hijos },
            { field: 'Lugar Nacimiento', pg: pgData.lugar_nacimiento, wix: wixData.lugarDeNacimiento },
            { field: 'Ciudad Residencia', pg: pgData.ciudad_residencia, wix: wixData.ciudadDeResidencia },
            { field: 'Profesión/Oficio', pg: pgData.profesion_oficio, wix: wixData.profesionUOficio },
            { field: 'Empresa 1', pg: pgData.empresa1, wix: wixData.empresa1 },
            { field: 'Empresa 2', pg: pgData.empresa2, wix: wixData.empresa2 },
            { field: 'Estatura', pg: pgData.estatura, wix: wixData.estatura },
            { field: 'Peso', pg: pgData.peso, wix: wixData.peso },
            { field: 'Ejercicio', pg: pgData.ejercicio, wix: wixData.ejercicio }
        ];

        let allMatch = true;
        comparisons.forEach(({ field, pg, wix }) => {
            const match = String(pg) === String(wix);
            const status = match ? '✅' : '❌';
            console.log(`${status} ${field}:`);
            console.log(`   PostgreSQL: "${pg}"`);
            console.log(`   Wix: "${wix}"`);
            if (!match) {
                allMatch = false;
            }
            console.log('');
        });

        console.log('═══════════════════════════════════════════════════════════');
        if (allMatch) {
            console.log('✅ TODOS LOS DATOS COINCIDEN');
        } else {
            console.log('❌ HAY DIFERENCIAS ENTRE LAS BASES DE DATOS');
        }
        console.log('═══════════════════════════════════════════════════════════');

        await pool.end();

    } catch (error) {
        console.error('❌ Error:', error.message);
        await pool.end();
    }
}

compareData();
