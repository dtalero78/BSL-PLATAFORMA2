/**
 * Script de Migración: ADCTEST de Wix a PostgreSQL (tabla pruebasADC)
 *
 * Migra pruebas psicológicas ADC (Ansiedad, Depresión, Comportamiento) desde Wix a PostgreSQL.
 *
 * Uso:
 *   node migracion-adc-test.js [--skip=N] [--dry-run] [--verify] [--test] [--desde=YYYY-MM-DD]
 *
 * Opciones:
 *   --skip=N           Continuar desde el registro N (útil si se interrumpió)
 *   --dry-run          Solo mostrar lo que se haría, sin insertar
 *   --verify           Verificar conteos después de migración
 *   --test             Solo procesar primeros 1000 registros
 *   --desde=YYYY-MM-DD Filtrar registros desde esta fecha (ej: --desde=2025-12-20)
 *
 * Ejemplo para migrar solo registros nuevos desde el 20 de diciembre:
 *   node migracion-adc-test.js --desde=2025-12-20
 */

require('dotenv').config();
const { Pool } = require('pg');

// Configuración de la base de datos PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
});

// URL base de Wix
const WIX_BASE_URL = 'https://www.bsl.com.co/_functions';

// Configuración de migración
const BATCH_SIZE = 500; // Tamaño de lote para ADCTEST (más pequeño que HistoriaClinica por la cantidad de campos)
const DELAY_BETWEEN_BATCHES_MS = 3000; // Pausa entre lotes de Wix

// Argumentos de línea de comandos
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verifyOnly = args.includes('--verify');
const testMode = args.includes('--test');
const skipArg = args.find(a => a.startsWith('--skip='));
const skipStart = skipArg ? parseInt(skipArg.split('=')[1], 10) : 0;
const maxRecords = testMode ? 1000 : Infinity;
const desdeArg = args.find(a => a.startsWith('--desde='));
const fechaDesde = desdeArg ? desdeArg.split('=')[1] : null;

// Estadísticas
const stats = {
    totalFetched: 0,
    totalInserted: 0,
    totalUpdated: 0,
    totalSkipped: 0,
    totalErrors: 0,
    startTime: null,
    endTime: null,
    errors: []
};

/**
 * Obtener lote de registros de Wix con reintentos
 */
async function fetchBatchFromWix(skip, limit, maxRetries = 5) {
    let url = `${WIX_BASE_URL}/exportarADCTEST?skip=${skip}&limit=${limit}`;
    if (fechaDesde) {
        url += `&desde=${fechaDesde}`;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minutos de timeout

            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Error desconocido de Wix');
            }

            return data;
        } catch (error) {
            console.error(`❌ Error fetching skip=${skip} (intento ${attempt}/${maxRetries}):`, error.message);

            if (attempt < maxRetries) {
                const waitTime = attempt * 5000;
                console.log(`⏳ Esperando ${waitTime/1000}s antes de reintentar...`);
                await new Promise(r => setTimeout(r, waitTime));
            } else {
                throw error;
            }
        }
    }
}

/**
 * Truncar string a longitud máxima
 */
function truncate(str, maxLen) {
    if (!str) return null;
    const s = String(str);
    return s.length > maxLen ? s.substring(0, maxLen) : s;
}

/**
 * Parsear fecha de forma segura
 */
function safeDate(dateValue) {
    if (!dateValue) return null;
    try {
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) return null;
        if (date.getFullYear() < 1900 || date.getFullYear() > 2100) return null;
        return date;
    } catch {
        return null;
    }
}

/**
 * Mapear campos de Wix a PostgreSQL
 *
 * Mapeo clave: numeroId (Wix) -> orden_id (PostgreSQL)
 * IMPORTANTE: En ADCTEST, numeroId contiene el _id de HistoriaClinica (UUID), no el documento del paciente
 */
function mapWixToPostgres(item) {
    return {
        // Identificador de la orden (FK a HistoriaClinica)
        // En ADCTEST, numeroId contiene el UUID de HistoriaClinica._id
        orden_id: item.numeroId || null, // Clave: numeroId en Wix = orden_id en PostgreSQL

        // Datos del paciente
        numero_id: truncate(item.documento, 50), // documento es el número de identificación del paciente
        primer_nombre: truncate(item.primerNombre, 100),
        primer_apellido: truncate(item.primerApellido, 100),
        empresa: truncate(item.empresa, 100),
        cod_empresa: truncate(item.codEmpresa || item.empresa, 50),

        // Preguntas de Depresión (21 campos)
        de08: truncate(item.de08, 50),
        de29: truncate(item.de29, 50),
        de03: truncate(item.de03, 50),
        de04: truncate(item.de04, 50),
        de05: truncate(item.de05, 50),
        de32: truncate(item.de32, 50),
        de12: truncate(item.de12, 50),
        de06: truncate(item.de06, 50),
        de33: truncate(item.de33, 50),
        de13: truncate(item.de13, 50),
        de07: truncate(item.de07, 50),
        de35: truncate(item.de35, 50),
        de21: truncate(item.de21, 50),
        de14: truncate(item.de14, 50),
        de15: truncate(item.de15, 50),
        de37: truncate(item.de37, 50),
        de16: truncate(item.de16, 50),
        de38: truncate(item.de38, 50),
        de40: truncate(item.de40, 50),
        de27: truncate(item.de27, 50),
        de20: truncate(item.de20, 50),

        // Preguntas de Ansiedad (20 campos)
        an07: truncate(item.an07, 50),
        an11: truncate(item.an11, 50),
        an03: truncate(item.an03, 50),
        an18: truncate(item.an18, 50),
        an19: truncate(item.an19, 50),
        an04: truncate(item.an04, 50),
        an14: truncate(item.an14, 50),
        an09: truncate(item.an09, 50),
        an20: truncate(item.an20, 50),
        an05: truncate(item.an05, 50),
        an36: truncate(item.an36, 50),
        an26: truncate(item.an26, 50),
        an31: truncate(item.an31, 50),
        an22: truncate(item.an22, 50),
        an38: truncate(item.an38, 50),
        an27: truncate(item.an27, 50),
        an35: truncate(item.an35, 50),
        an23: truncate(item.an23, 50),
        an39: truncate(item.an39, 50),
        an30: truncate(item.an30, 50),

        // Preguntas de Comportamiento (23 campos)
        cofv01: truncate(item.cofv01, 50),
        corv11: truncate(item.corv11, 50),
        cofc06: truncate(item.cofc06, 50),
        coav21: truncate(item.coav21, 50),
        coov32: truncate(item.coov32, 50),
        corc16: truncate(item.corc16, 50),
        coac26: truncate(item.coac26, 50),
        cofv02: truncate(item.cofv02, 50),
        coov34: truncate(item.coov34, 50),
        cofv03: truncate(item.cofv03, 50),
        corc17: truncate(item.corc17, 50),
        coac27: truncate(item.coac27, 50),
        cofc08: truncate(item.cofc08, 50),
        cooc39: truncate(item.cooc39, 50),
        cofc10: truncate(item.cofc10, 50),
        corv12: truncate(item.corv12, 50),
        cooc40: truncate(item.cooc40, 50),
        corv15: truncate(item.corv15, 50),
        coac29: truncate(item.coac29, 50),
        coov35: truncate(item.coov35, 50),
        coav24: truncate(item.coav24, 50),
        corc18: truncate(item.corc18, 50),
        coav25: truncate(item.coav25, 50),

        // Timestamps
        created_at: safeDate(item._createdDate),
        updated_at: safeDate(item._updatedDate)
    };
}

// Query de UPSERT (usa orden_id como clave única)
const UPSERT_QUERY = `
    INSERT INTO "pruebasADC" (
        orden_id, numero_id, primer_nombre, primer_apellido, empresa, cod_empresa,
        de08, de29, de03, de04, de05, de32, de12, de06, de33, de13,
        de07, de35, de21, de14, de15, de37, de16, de38, de40, de27, de20,
        an07, an11, an03, an18, an19, an04, an14, an09, an20, an05,
        an36, an26, an31, an22, an38, an27, an35, an23, an39, an30,
        cofv01, corv11, cofc06, coav21, coov32, corc16, coac26, cofv02, coov34, cofv03,
        corc17, coac27, cofc08, cooc39, cofc10, corv12, cooc40, corv15, coac29, coov35,
        coav24, corc18, coav25,
        created_at, updated_at
    ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
        $28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,
        $48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67,$68,$69,$70,
        $71,$72
    )
    ON CONFLICT (orden_id) WHERE orden_id IS NOT NULL DO UPDATE SET
        numero_id = COALESCE(EXCLUDED.numero_id, "pruebasADC".numero_id),
        primer_nombre = COALESCE(EXCLUDED.primer_nombre, "pruebasADC".primer_nombre),
        primer_apellido = COALESCE(EXCLUDED.primer_apellido, "pruebasADC".primer_apellido),
        empresa = COALESCE(EXCLUDED.empresa, "pruebasADC".empresa),
        cod_empresa = COALESCE(EXCLUDED.cod_empresa, "pruebasADC".cod_empresa),
        de08 = COALESCE(EXCLUDED.de08, "pruebasADC".de08),
        de29 = COALESCE(EXCLUDED.de29, "pruebasADC".de29),
        de03 = COALESCE(EXCLUDED.de03, "pruebasADC".de03),
        de04 = COALESCE(EXCLUDED.de04, "pruebasADC".de04),
        de05 = COALESCE(EXCLUDED.de05, "pruebasADC".de05),
        de32 = COALESCE(EXCLUDED.de32, "pruebasADC".de32),
        de12 = COALESCE(EXCLUDED.de12, "pruebasADC".de12),
        de06 = COALESCE(EXCLUDED.de06, "pruebasADC".de06),
        de33 = COALESCE(EXCLUDED.de33, "pruebasADC".de33),
        de13 = COALESCE(EXCLUDED.de13, "pruebasADC".de13),
        de07 = COALESCE(EXCLUDED.de07, "pruebasADC".de07),
        de35 = COALESCE(EXCLUDED.de35, "pruebasADC".de35),
        de21 = COALESCE(EXCLUDED.de21, "pruebasADC".de21),
        de14 = COALESCE(EXCLUDED.de14, "pruebasADC".de14),
        de15 = COALESCE(EXCLUDED.de15, "pruebasADC".de15),
        de37 = COALESCE(EXCLUDED.de37, "pruebasADC".de37),
        de16 = COALESCE(EXCLUDED.de16, "pruebasADC".de16),
        de38 = COALESCE(EXCLUDED.de38, "pruebasADC".de38),
        de40 = COALESCE(EXCLUDED.de40, "pruebasADC".de40),
        de27 = COALESCE(EXCLUDED.de27, "pruebasADC".de27),
        de20 = COALESCE(EXCLUDED.de20, "pruebasADC".de20),
        an07 = COALESCE(EXCLUDED.an07, "pruebasADC".an07),
        an11 = COALESCE(EXCLUDED.an11, "pruebasADC".an11),
        an03 = COALESCE(EXCLUDED.an03, "pruebasADC".an03),
        an18 = COALESCE(EXCLUDED.an18, "pruebasADC".an18),
        an19 = COALESCE(EXCLUDED.an19, "pruebasADC".an19),
        an04 = COALESCE(EXCLUDED.an04, "pruebasADC".an04),
        an14 = COALESCE(EXCLUDED.an14, "pruebasADC".an14),
        an09 = COALESCE(EXCLUDED.an09, "pruebasADC".an09),
        an20 = COALESCE(EXCLUDED.an20, "pruebasADC".an20),
        an05 = COALESCE(EXCLUDED.an05, "pruebasADC".an05),
        an36 = COALESCE(EXCLUDED.an36, "pruebasADC".an36),
        an26 = COALESCE(EXCLUDED.an26, "pruebasADC".an26),
        an31 = COALESCE(EXCLUDED.an31, "pruebasADC".an31),
        an22 = COALESCE(EXCLUDED.an22, "pruebasADC".an22),
        an38 = COALESCE(EXCLUDED.an38, "pruebasADC".an38),
        an27 = COALESCE(EXCLUDED.an27, "pruebasADC".an27),
        an35 = COALESCE(EXCLUDED.an35, "pruebasADC".an35),
        an23 = COALESCE(EXCLUDED.an23, "pruebasADC".an23),
        an39 = COALESCE(EXCLUDED.an39, "pruebasADC".an39),
        an30 = COALESCE(EXCLUDED.an30, "pruebasADC".an30),
        cofv01 = COALESCE(EXCLUDED.cofv01, "pruebasADC".cofv01),
        corv11 = COALESCE(EXCLUDED.corv11, "pruebasADC".corv11),
        cofc06 = COALESCE(EXCLUDED.cofc06, "pruebasADC".cofc06),
        coav21 = COALESCE(EXCLUDED.coav21, "pruebasADC".coav21),
        coov32 = COALESCE(EXCLUDED.coov32, "pruebasADC".coov32),
        corc16 = COALESCE(EXCLUDED.corc16, "pruebasADC".corc16),
        coac26 = COALESCE(EXCLUDED.coac26, "pruebasADC".coac26),
        cofv02 = COALESCE(EXCLUDED.cofv02, "pruebasADC".cofv02),
        coov34 = COALESCE(EXCLUDED.coov34, "pruebasADC".coov34),
        cofv03 = COALESCE(EXCLUDED.cofv03, "pruebasADC".cofv03),
        corc17 = COALESCE(EXCLUDED.corc17, "pruebasADC".corc17),
        coac27 = COALESCE(EXCLUDED.coac27, "pruebasADC".coac27),
        cofc08 = COALESCE(EXCLUDED.cofc08, "pruebasADC".cofc08),
        cooc39 = COALESCE(EXCLUDED.cooc39, "pruebasADC".cooc39),
        cofc10 = COALESCE(EXCLUDED.cofc10, "pruebasADC".cofc10),
        corv12 = COALESCE(EXCLUDED.corv12, "pruebasADC".corv12),
        cooc40 = COALESCE(EXCLUDED.cooc40, "pruebasADC".cooc40),
        corv15 = COALESCE(EXCLUDED.corv15, "pruebasADC".corv15),
        coac29 = COALESCE(EXCLUDED.coac29, "pruebasADC".coac29),
        coov35 = COALESCE(EXCLUDED.coov35, "pruebasADC".coov35),
        coav24 = COALESCE(EXCLUDED.coav24, "pruebasADC".coav24),
        corc18 = COALESCE(EXCLUDED.corc18, "pruebasADC".corc18),
        coav25 = COALESCE(EXCLUDED.coav25, "pruebasADC".coav25),
        updated_at = COALESCE(EXCLUDED.updated_at, "pruebasADC".updated_at)
`;

/**
 * Insertar un registro individual
 */
async function insertSingleRecord(item) {
    const mapped = mapWixToPostgres(item);

    // Si no hay orden_id, no podemos insertar (es requerido)
    if (!mapped.orden_id) {
        console.warn(`⚠️  Registro sin idGeneral, saltando: ${item._id}`);
        return false;
    }

    const values = [
        mapped.orden_id, mapped.numero_id, mapped.primer_nombre, mapped.primer_apellido,
        mapped.empresa, mapped.cod_empresa,
        // Depresión (21 campos)
        mapped.de08, mapped.de29, mapped.de03, mapped.de04, mapped.de05, mapped.de32,
        mapped.de12, mapped.de06, mapped.de33, mapped.de13, mapped.de07, mapped.de35,
        mapped.de21, mapped.de14, mapped.de15, mapped.de37, mapped.de16, mapped.de38,
        mapped.de40, mapped.de27, mapped.de20,
        // Ansiedad (20 campos)
        mapped.an07, mapped.an11, mapped.an03, mapped.an18, mapped.an19, mapped.an04,
        mapped.an14, mapped.an09, mapped.an20, mapped.an05, mapped.an36, mapped.an26,
        mapped.an31, mapped.an22, mapped.an38, mapped.an27, mapped.an35, mapped.an23,
        mapped.an39, mapped.an30,
        // Comportamiento (23 campos)
        mapped.cofv01, mapped.corv11, mapped.cofc06, mapped.coav21, mapped.coov32,
        mapped.corc16, mapped.coac26, mapped.cofv02, mapped.coov34, mapped.cofv03,
        mapped.corc17, mapped.coac27, mapped.cofc08, mapped.cooc39, mapped.cofc10,
        mapped.corv12, mapped.cooc40, mapped.corv15, mapped.coac29, mapped.coov35,
        mapped.coav24, mapped.corc18, mapped.coav25,
        // Timestamps
        mapped.created_at, mapped.updated_at
    ];

    if (!dryRun) {
        await pool.query(UPSERT_QUERY, values);
    }
    return true;
}

/**
 * Insertar lote de registros con procesamiento paralelo
 */
async function insertBatchToPostgres(items) {
    if (items.length === 0) return { inserted: 0, skipped: 0 };

    let inserted = 0;
    let skipped = 0;
    const PARALLEL_LIMIT = 10;

    for (let i = 0; i < items.length; i += PARALLEL_LIMIT) {
        const batch = items.slice(i, i + PARALLEL_LIMIT);

        const results = await Promise.allSettled(
            batch.map(item => insertSingleRecord(item))
        );

        for (let j = 0; j < results.length; j++) {
            if (results[j].status === 'fulfilled') {
                if (results[j].value === true) {
                    inserted++;
                } else {
                    skipped++;
                }
            } else {
                const error = results[j].reason;
                const item = batch[j];
                console.error(`❌ Error insertando ${item._id}:`, error.message);
                stats.errors.push({ _id: item._id, error: error.message });
                stats.totalErrors++;
            }
        }
    }

    return { inserted, skipped };
}

/**
 * Verificar conteos finales
 */
async function verifyMigration() {
    console.log('\n📊 Verificando conteos...\n');

    try {
        // Contar en Wix
        let url = `${WIX_BASE_URL}/exportarADCTEST?skip=0&limit=1`;
        if (fechaDesde) {
            url += `&desde=${fechaDesde}`;
        }

        const wixResponse = await fetch(url);
        const wixData = await wixResponse.json();
        const wixTotal = wixData.totalCount || 0;

        // Contar en PostgreSQL
        const pgResult = await pool.query('SELECT COUNT(*) FROM "pruebasADC"');
        const pgTotal = parseInt(pgResult.rows[0].count, 10);

        console.log(`Wix ADCTEST:            ${wixTotal.toLocaleString()} registros`);
        console.log(`PostgreSQL pruebasADC:  ${pgTotal.toLocaleString()} registros`);

        const diferencia = Math.abs(wixTotal - pgTotal);
        if (diferencia === 0) {
            console.log('\n✅ Los conteos coinciden perfectamente\n');
        } else {
            console.log(`\n⚠️  Diferencia de ${diferencia} registros\n`);
        }
    } catch (error) {
        console.error('❌ Error verificando conteos:', error.message);
    }
}

/**
 * Proceso principal de migración
 */
async function main() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║         Migración ADCTEST (Wix → PostgreSQL)                   ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    if (dryRun) {
        console.log('🧪 Modo DRY-RUN activado (no se insertará nada)\n');
    }
    if (testMode) {
        console.log(`🧪 Modo TEST activado (máximo ${maxRecords} registros)\n`);
    }
    if (fechaDesde) {
        console.log(`📅 Filtrando desde: ${fechaDesde}\n`);
    }
    if (skipStart > 0) {
        console.log(`⏭️  Saltando los primeros ${skipStart} registros\n`);
    }

    if (verifyOnly) {
        await verifyMigration();
        await pool.end();
        return;
    }

    stats.startTime = Date.now();

    try {
        let skip = skipStart;
        let hasMore = true;

        while (hasMore && stats.totalFetched < maxRecords) {
            console.log(`\n📦 Obteniendo lote desde skip=${skip}, limit=${BATCH_SIZE}...`);

            const data = await fetchBatchFromWix(skip, BATCH_SIZE);
            const items = data.items || [];

            if (items.length === 0) {
                console.log('✅ No hay más registros');
                break;
            }

            console.log(`   Recibidos: ${items.length} registros`);
            stats.totalFetched += items.length;

            // Insertar en PostgreSQL
            const { inserted, skipped } = await insertBatchToPostgres(items);
            stats.totalInserted += inserted;
            stats.totalSkipped += skipped;

            console.log(`   Insertados: ${inserted}, Saltados: ${skipped}`);
            console.log(`   Total acumulado: ${stats.totalFetched.toLocaleString()} fetched, ${stats.totalInserted.toLocaleString()} insertados`);

            // Verificar si hay más registros
            hasMore = data.hasMore;
            skip = data.nextSkip || (skip + BATCH_SIZE);

            // Pausa entre lotes para no saturar Wix
            if (hasMore && stats.totalFetched < maxRecords) {
                await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
            }
        }

        stats.endTime = Date.now();
        const durationSec = Math.round((stats.endTime - stats.startTime) / 1000);
        const minutes = Math.floor(durationSec / 60);
        const seconds = durationSec % 60;

        console.log('\n╔════════════════════════════════════════════════════════════════╗');
        console.log('║                    MIGRACIÓN COMPLETADA                        ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        console.log(`📊 Estadísticas:`);
        console.log(`   Total obtenido de Wix:  ${stats.totalFetched.toLocaleString()}`);
        console.log(`   Total insertado en PG:  ${stats.totalInserted.toLocaleString()}`);
        console.log(`   Saltados (sin orden_id):${stats.totalSkipped.toLocaleString()}`);
        console.log(`   Errores:                ${stats.totalErrors.toLocaleString()}`);
        console.log(`   Duración:               ${minutes}m ${seconds}s`);
        console.log(`   Registros/seg:          ${(stats.totalInserted / durationSec).toFixed(2)}\n`);

        if (stats.errors.length > 0) {
            console.log('⚠️  Errores encontrados:');
            stats.errors.slice(0, 10).forEach(e => {
                console.log(`   - ${e._id}: ${e.error}`);
            });
            if (stats.errors.length > 10) {
                console.log(`   ... y ${stats.errors.length - 10} errores más\n`);
            }
        }

        if (!dryRun) {
            console.log('\n📊 Verificando conteos finales...\n');
            await verifyMigration();
        }

    } catch (error) {
        console.error('\n❌ Error fatal en migración:', error);
        console.error(error.stack);
    } finally {
        await pool.end();
        console.log('🔌 Conexión a PostgreSQL cerrada\n');
    }
}

// Ejecutar migración
main().catch(console.error);