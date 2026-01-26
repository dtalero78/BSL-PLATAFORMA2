require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
});

async function ejecutarMigration() {
    try {
        console.log('🚀 Ejecutando migration de índices (SIN constraint UNIQUE)...\n');

        // Leer el archivo SQL
        const sqlPath = path.join(__dirname, 'migrations', 'add-whatsapp-indexes.sql');
        let sql = fs.readFileSync(sqlPath, 'utf8');

        // QUITAR la parte del constraint UNIQUE para no afectar los duplicados existentes
        console.log('⚠️  Removiendo constraint UNIQUE del script (para no afectar duplicados existentes)...\n');

        // Buscar y eliminar la sección del UNIQUE INDEX
        const uniqueIndexStart = sql.indexOf('-- Crear índice UNIQUE en celular para prevenir duplicados');
        const uniqueIndexEnd = sql.indexOf('COMMENT ON INDEX idx_conv_celular_unique');

        if (uniqueIndexStart !== -1 && uniqueIndexEnd !== -1) {
            const endOfComment = sql.indexOf(';', uniqueIndexEnd) + 1;
            sql = sql.substring(0, uniqueIndexStart) + sql.substring(endOfComment);
            console.log('✅ Constraint UNIQUE removido temporalmente\n');
        }

        // Ejecutar el SQL modificado
        console.log('📋 Ejecutando queries...\n');

        await pool.query(sql);

        console.log('✅ Migration ejecutada exitosamente\n');

        // Verificar índices creados
        console.log('🔍 Verificando índices creados...\n');

        const indices = await pool.query(`
            SELECT
                tablename,
                indexname,
                indexdef
            FROM pg_indexes
            WHERE tablename IN ('conversaciones_whatsapp', 'mensajes_whatsapp', 'HistoriaClinica')
            AND indexname LIKE 'idx_%'
            ORDER BY tablename, indexname
        `);

        console.log(`📊 Total de índices creados: ${indices.rows.length}\n`);

        // Agrupar por tabla
        const porTabla = {};
        indices.rows.forEach(idx => {
            if (!porTabla[idx.tablename]) {
                porTabla[idx.tablename] = [];
            }
            porTabla[idx.tablename].push(idx.indexname);
        });

        Object.keys(porTabla).forEach(tabla => {
            console.log(`\n${tabla}:`);
            porTabla[tabla].forEach(idx => {
                console.log(`  ✓ ${idx}`);
            });
        });

        console.log('\n');
        console.log('═════════════════════════════════════════════════════');
        console.log('✅ MIGRATION COMPLETADA (sin constraint UNIQUE)');
        console.log('═════════════════════════════════════════════════════');
        console.log('\nNOTA: El constraint UNIQUE NO fue creado para no afectar');
        console.log('los 63 duplicados existentes. Los índices de performance');
        console.log('fueron creados exitosamente.');
        console.log('\nPara agregar el constraint UNIQUE en el futuro:');
        console.log('1. Consolidar duplicados: node consolidar-duplicados-whatsapp.js');
        console.log('2. Crear constraint manualmente con psql');

    } catch (error) {
        console.error('❌ Error ejecutando migration:', error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
    }
}

ejecutarMigration();
