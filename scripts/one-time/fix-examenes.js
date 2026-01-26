require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
});

async function convertExamenes() {
    console.log("=== Convirtiendo campo examenes de formato array a texto ===\n");

    // Contar registros a actualizar
    const count = await pool.query(`
        SELECT COUNT(*) FROM "HistoriaClinica"
        WHERE "examenes" LIKE '{%}'
    `);
    console.log("Registros a convertir: " + count.rows[0].count);

    // Hacer UPDATE masivo usando expresión regular de PostgreSQL
    console.log("\nEjecutando UPDATE masivo...");

    const result = await pool.query(`
        UPDATE "HistoriaClinica"
        SET "examenes" = TRIM(
            REPLACE(
                REPLACE(
                    REPLACE(
                        REPLACE("examenes", '{', ''),
                        '}', ''
                    ),
                    '","', ', '
                ),
                '"', ''
            )
        )
        WHERE "examenes" LIKE '{%}'
    `);

    console.log("✅ Registros actualizados: " + result.rowCount);

    // Verificar resultado
    console.log("\nVerificación - ejemplos después de conversión:");
    const verify = await pool.query(`
        SELECT "primerNombre", "examenes"
        FROM "HistoriaClinica"
        WHERE "examenes" IS NOT NULL AND "examenes" != '' AND "examenes" != '{}'
        LIMIT 5
    `);
    verify.rows.forEach(r => console.log("  " + r.primerNombre + ": " + r.examenes));

    // Verificar que no queden en formato array
    const remaining = await pool.query(`
        SELECT COUNT(*) FROM "HistoriaClinica"
        WHERE "examenes" LIKE '{%}'
    `);
    console.log("\nRegistros aún en formato array: " + remaining.rows[0].count);

    await pool.end();
}

convertExamenes().catch(console.error);
