/**
 * Script para migrar fotos base64 de PostgreSQL a DigitalOcean Spaces
 *
 * Uso: node scripts/migrar-fotos-spaces.js
 *
 * Variables de entorno requeridas:
 * - SPACES_KEY: Access Key de DigitalOcean Spaces
 * - SPACES_SECRET: Secret Key de DigitalOcean Spaces
 * - DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME: Credenciales PostgreSQL
 */

require('dotenv').config();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Pool } = require('pg');

// Configuración de DigitalOcean Spaces
const SPACES_ENDPOINT = 'https://nyc3.digitaloceanspaces.com';
const SPACES_REGION = 'nyc3';
const BUCKET = 'bsl-fotos';
const BATCH_SIZE = 50; // Procesar 50 fotos a la vez

// Cliente S3 (compatible con Spaces)
const s3Client = new S3Client({
    endpoint: SPACES_ENDPOINT,
    region: SPACES_REGION,
    credentials: {
        accessKeyId: process.env.SPACES_KEY,
        secretAccessKey: process.env.SPACES_SECRET
    },
    forcePathStyle: false
});

// Pool de PostgreSQL (requiere variables de entorno configuradas en .env)
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
});

/**
 * Detecta el tipo de imagen desde el base64
 */
function detectImageType(base64Data) {
    if (base64Data.startsWith('data:image/png')) return { mime: 'image/png', ext: 'png' };
    if (base64Data.startsWith('data:image/jpeg') || base64Data.startsWith('data:image/jpg')) return { mime: 'image/jpeg', ext: 'jpg' };
    if (base64Data.startsWith('data:image/gif')) return { mime: 'image/gif', ext: 'gif' };
    if (base64Data.startsWith('data:image/webp')) return { mime: 'image/webp', ext: 'webp' };
    // Default a JPEG
    return { mime: 'image/jpeg', ext: 'jpg' };
}

/**
 * Migra un batch de fotos
 * @returns {number} Cantidad de fotos migradas
 */
async function migrarBatch() {
    // Obtener registros con foto base64 pero sin foto_url
    const { rows } = await pool.query(`
        SELECT id, foto, numero_id
        FROM formularios
        WHERE foto IS NOT NULL
          AND foto != ''
          AND LENGTH(foto) > 100
          AND (foto_url IS NULL OR foto_url = '')
        LIMIT $1
    `, [BATCH_SIZE]);

    if (rows.length === 0) {
        return 0;
    }

    console.log(`\nProcesando batch de ${rows.length} fotos...`);
    let exitosas = 0;
    let errores = 0;

    for (const row of rows) {
        try {
            // Detectar tipo de imagen
            const { mime, ext } = detectImageType(row.foto);

            // Limpiar y decodificar base64
            const base64Clean = row.foto.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Clean, 'base64');

            // Validar que el buffer tenga contenido
            if (buffer.length < 100) {
                console.log(`  ! ID ${row.id}: Buffer muy pequeño (${buffer.length} bytes), saltando`);
                // Marcar como procesado con error
                await pool.query(
                    'UPDATE formularios SET foto_url = $1 WHERE id = $2',
                    ['ERROR:INVALID_IMAGE', row.id]
                );
                errores++;
                continue;
            }

            // Generar nombre único para el archivo
            const numeroId = row.numero_id || 'unknown';
            const fileName = `fotos/${numeroId}_${row.id}.${ext}`;

            // Subir a Spaces
            await s3Client.send(new PutObjectCommand({
                Bucket: BUCKET,
                Key: fileName,
                Body: buffer,
                ContentType: mime,
                ACL: 'public-read',
                CacheControl: 'max-age=31536000' // Cache 1 año
            }));

            // Construir URL pública
            const fotoUrl = `https://${BUCKET}.${SPACES_REGION}.digitaloceanspaces.com/${fileName}`;

            // Actualizar PostgreSQL con la URL
            await pool.query(
                'UPDATE formularios SET foto_url = $1 WHERE id = $2',
                [fotoUrl, row.id]
            );

            console.log(`  ✓ ID ${row.id} → ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);
            exitosas++;

        } catch (error) {
            console.error(`  ✗ ID ${row.id}: ${error.message}`);
            errores++;
        }
    }

    console.log(`  Batch completado: ${exitosas} exitosas, ${errores} errores`);
    return rows.length;
}

/**
 * Ejecuta la migración completa
 */
async function migrarTodas() {
    console.log('='.repeat(60));
    console.log('MIGRACIÓN DE FOTOS A DIGITALOCEAN SPACES');
    console.log('='.repeat(60));
    console.log(`Bucket: ${BUCKET}`);
    console.log(`Endpoint: ${SPACES_ENDPOINT}`);
    console.log(`Batch size: ${BATCH_SIZE}`);
    console.log('');

    // Verificar credenciales
    if (!process.env.SPACES_KEY || !process.env.SPACES_SECRET) {
        console.error('ERROR: Faltan credenciales de Spaces');
        console.error('Configura SPACES_KEY y SPACES_SECRET en tu archivo .env');
        process.exit(1);
    }

    // Contar fotos pendientes
    const countResult = await pool.query(`
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE foto IS NOT NULL AND foto != '' AND LENGTH(foto) > 100) as con_foto,
            COUNT(*) FILTER (WHERE foto_url IS NOT NULL AND foto_url != '' AND foto_url NOT LIKE 'ERROR:%') as con_url
        FROM formularios
    `);

    const { total, con_foto, con_url } = countResult.rows[0];
    const pendientes = parseInt(con_foto) - parseInt(con_url);

    console.log(`Total registros: ${total}`);
    console.log(`Con foto base64: ${con_foto}`);
    console.log(`Ya migradas: ${con_url}`);
    console.log(`Pendientes: ${pendientes}`);
    console.log('');

    if (pendientes === 0) {
        console.log('¡No hay fotos pendientes de migrar!');
        await pool.end();
        return;
    }

    // Migrar en batches
    let totalMigradas = 0;
    let batchNum = 0;
    const startTime = Date.now();

    while (true) {
        batchNum++;
        console.log(`\n--- Batch #${batchNum} ---`);

        const migradas = await migrarBatch();
        if (migradas === 0) break;

        totalMigradas += migradas;

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = totalMigradas / elapsed;
        const remaining = pendientes - totalMigradas;
        const eta = remaining / rate;

        console.log(`Progreso: ${totalMigradas}/${pendientes} (${((totalMigradas/pendientes)*100).toFixed(1)}%)`);
        console.log(`Velocidad: ${rate.toFixed(1)} fotos/seg`);
        console.log(`ETA: ${Math.ceil(eta / 60)} minutos`);

        // Pequeña pausa entre batches para no saturar
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log('\n' + '='.repeat(60));
    console.log('MIGRACIÓN COMPLETADA');
    console.log('='.repeat(60));
    console.log(`Total migradas: ${totalMigradas}`);
    console.log(`Tiempo total: ${(totalTime / 60).toFixed(1)} minutos`);
    console.log(`Velocidad promedio: ${(totalMigradas / totalTime).toFixed(1)} fotos/seg`);

    await pool.end();
}

// Ejecutar
migrarTodas().catch(error => {
    console.error('Error fatal:', error);
    process.exit(1);
});
