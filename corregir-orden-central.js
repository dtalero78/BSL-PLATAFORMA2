// Script para corregir orden de CENTRAL con cédula 53161475
// La orden tiene horaAtencion pero no fechaAtencion

const { Pool } = require('pg');
require('dotenv').config();

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

async function corregirOrden() {
    try {
        console.log('🔧 Corrigiendo orden de CENTRAL...\n');

        // Buscar la orden
        const result = await pool.query(`
            SELECT "_id", "numeroId", "primerNombre", "primerApellido",
                   "fechaAtencion", "horaAtencion", "_createdDate"
            FROM "HistoriaClinica"
            WHERE "numeroId" = '53161475'
            AND "codEmpresa" = 'CENTRAL'
            ORDER BY "_createdDate" DESC
            LIMIT 1
        `);

        if (result.rows.length === 0) {
            console.log('❌ No se encontró la orden');
            process.exit(1);
        }

        const orden = result.rows[0];
        console.log('📋 Orden encontrada:');
        console.log('   ID:', orden._id);
        console.log('   Paciente:', `${orden.primerNombre} ${orden.primerApellido}`);
        console.log('   Cédula:', orden.numeroId);
        console.log('   Fecha actual:', orden.fechaAtencion);
        console.log('   Hora actual:', orden.horaAtencion);
        console.log('   Creada:', orden._createdDate);
        console.log('');

        // Si ya tiene fechaAtencion, no hacer nada
        if (orden.fechaAtencion) {
            console.log('✅ La orden ya tiene fechaAtencion configurada');
            process.exit(0);
        }

        // Construir fecha de atención: 2 de enero 2026 a las 16:00 Colombia
        const fechaAtencion = '2026-01-02 16:00:00-05';

        console.log('🔄 Actualizando...');
        console.log('   Nueva fechaAtencion:', fechaAtencion);

        const updateResult = await pool.query(`
            UPDATE "HistoriaClinica"
            SET "fechaAtencion" = $1::timestamptz,
                "_updatedDate" = NOW()
            WHERE "_id" = $2
            RETURNING "_id", "fechaAtencion", "horaAtencion"
        `, [fechaAtencion, orden._id]);

        if (updateResult.rows.length > 0) {
            const updated = updateResult.rows[0];
            console.log('');
            console.log('✅ Orden actualizada exitosamente');
            console.log('   ID:', updated._id);
            console.log('   Nueva fechaAtencion:', updated.fechaAtencion);
            console.log('   horaAtencion:', updated.horaAtencion);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

corregirOrden();
