const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
});

async function asignarMedicoPresencial() {
    const client = await pool.connect();

    try {
        // Lista de cédulas a actualizar
        const cedulas = [
            '1013100023', '1143120800', '100458303', '1018449073',
            '1073156219', '1018514008', '1010236674', '1007295767',
            '1033705384', '1022969180', '1000692078', '1067716053',
            '1000587709', '79981585', '1030620571', '1032496066',
            '1020818621', '1001280365', '1018515207', '1028400302',
            '1032483085'
        ];

        console.log(`Actualizando ${cedulas.length} registros...`);

        // Actualizar registros
        const query = `
            UPDATE "HistoriaClinica"
            SET medico = 'EUGENIO MENESES'
            WHERE "numeroId" = ANY($1)
            AND "medico" IS NULL
            AND "fechaAtencion" >= '2026-01-01'
            RETURNING _id, "numeroId", "primerNombre", "primerApellido", medico
        `;

        const result = await client.query(query, [cedulas]);

        console.log(`\n✅ Registros actualizados: ${result.rowCount}`);
        console.log('\nRegistros modificados:');
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. ${row.primerNombre} ${row.primerApellido} (${row.numeroId}) - Médico: ${row.medico}`);
        });

    } catch (error) {
        console.error('❌ Error al actualizar registros:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

asignarMedicoPresencial();
