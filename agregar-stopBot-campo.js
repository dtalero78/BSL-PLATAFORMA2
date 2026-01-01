/**
 * Script para agregar el campo stopBot a la tabla conversaciones_whatsapp
 *
 * Uso: node agregar-stopBot-campo.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 25060,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
});

async function agregarCampoStopBot() {
    try {
        console.log('Conectando a la base de datos...');

        // Verificar si el campo ya existe
        const checkColumn = await pool.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'conversaciones_whatsapp'
            AND column_name = 'stopBot'
        `);

        if (checkColumn.rows.length > 0) {
            console.log('✓ El campo "stopBot" ya existe en la tabla conversaciones_whatsapp');
            return;
        }

        console.log('Agregando campo "stopBot" a la tabla conversaciones_whatsapp...');

        // Agregar el campo
        await pool.query(`
            ALTER TABLE conversaciones_whatsapp
            ADD COLUMN "stopBot" BOOLEAN DEFAULT false
        `);

        console.log('✓ Campo "stopBot" agregado exitosamente');

        // Verificar
        const verify = await pool.query(`
            SELECT column_name, data_type, column_default
            FROM information_schema.columns
            WHERE table_name = 'conversaciones_whatsapp'
            AND column_name = 'stopBot'
        `);

        console.log('Verificación:', verify.rows[0]);

    } catch (error) {
        console.error('Error al agregar el campo:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Ejecutar
agregarCampoStopBot()
    .then(() => {
        console.log('✓ Migración completada');
        process.exit(0);
    })
    .catch(error => {
        console.error('✗ Migración falló:', error);
        process.exit(1);
    });
