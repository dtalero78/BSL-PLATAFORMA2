/**
 * Script para marcar todas las órdenes de MASIN como pagadas
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false
    }
});

async function marcarMasinPagado() {
    try {
        console.log('🔍 Buscando órdenes de MASIN pendientes de pago...');

        // Primero consultar cuántas hay
        const consulta = await pool.query(`
            SELECT COUNT(*) as total
            FROM "HistoriaClinica"
            WHERE "codEmpresa" = 'MASIN'
            AND (pagado IS NULL OR pagado = false)
        `);

        const total = parseInt(consulta.rows[0].total);
        console.log(`📊 Total de órdenes de MASIN sin pagar: ${total}`);

        if (total === 0) {
            console.log('✅ No hay órdenes pendientes de pago para MASIN');
            process.exit(0);
        }

        // Mostrar algunas órdenes de ejemplo
        const ejemplos = await pool.query(`
            SELECT _id, "primerNombre", "primerApellido", "fechaAtencion"
            FROM "HistoriaClinica"
            WHERE "codEmpresa" = 'MASIN'
            AND (pagado IS NULL OR pagado = false)
            ORDER BY "fechaAtencion" DESC
            LIMIT 5
        `);

        console.log('\n📋 Ejemplos de órdenes a marcar como pagadas:');
        ejemplos.rows.forEach(orden => {
            console.log(`  - ${orden._id}: ${orden.primerNombre} ${orden.primerApellido} (${orden.fechaAtencion})`);
        });

        console.log('\n🔄 Actualizando órdenes...');

        // Actualizar
        const resultado = await pool.query(`
            UPDATE "HistoriaClinica"
            SET pagado = true
            WHERE "codEmpresa" = 'MASIN'
            AND (pagado IS NULL OR pagado = false)
        `);

        console.log(`✅ ${resultado.rowCount} órdenes de MASIN marcadas como pagadas`);

        // Verificar
        const verificacion = await pool.query(`
            SELECT COUNT(*) as pendientes
            FROM "HistoriaClinica"
            WHERE "codEmpresa" = 'MASIN'
            AND (pagado IS NULL OR pagado = false)
        `);

        console.log(`\n✓ Órdenes pendientes de MASIN restantes: ${verificacion.rows[0].pendientes}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

marcarMasinPagado();
