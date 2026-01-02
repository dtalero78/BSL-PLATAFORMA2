require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 25060,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'defaultdb',
    ssl: { rejectUnauthorized: false }
});

async function marcarPrevemedPagado() {
    try {
        console.log('🔄 Actualizando registros de PREVEMED como pagados...');

        const result = await pool.query(`
            UPDATE "HistoriaClinica"
            SET pagado = true,
                "pvEstado" = 'Pagado',
                fecha_pago = NOW()
            WHERE "codEmpresa" = 'PREVEMED'
            AND (pagado = false OR pagado IS NULL)
            RETURNING _id, "primerNombre", "primerApellido", "numeroId", "fechaConsulta"
        `);

        console.log(`✅ Se actualizaron ${result.rowCount} registros de PREVEMED como pagados`);

        if (result.rows.length > 0) {
            console.log('\nRegistros actualizados:');
            result.rows.forEach((row, i) => {
                const fecha = row.fechaConsulta ? new Date(row.fechaConsulta).toLocaleDateString('es-CO') : 'Sin fecha';
                console.log(`${i + 1}. ${row.primerNombre} ${row.primerApellido} (CC: ${row.numeroId}) - Fecha: ${fecha}`);
            });
        } else {
            console.log('\n⚠️  No se encontraron registros de PREVEMED sin pagar');
        }

        await pool.end();
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

marcarPrevemedPagado();
