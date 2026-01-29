/**
 * Script de Consolidación de Conversaciones WhatsApp Duplicadas
 *
 * Problema: Las conversaciones se están duplicando porque diferentes aplicaciones
 * guardan números en formatos inconsistentes (+573XXX vs 573XXX).
 *
 * Este script:
 * 1. Identifica conversaciones duplicadas normalizando números on-the-fly
 * 2. Para cada grupo de duplicados:
 *    - Identifica la conversación "primaria" (más reciente)
 *    - Migra todos los mensajes de conversaciones secundarias a la primaria
 *    - Marca las secundarias como cerradas
 *    - Actualiza el número normalizado en la primaria
 *
 * Uso:
 *   node scripts/consolidar-duplicados-whatsapp.js --dry-run    # Ver qué se haría sin ejecutar
 *   node scripts/consolidar-duplicados-whatsapp.js              # Ejecutar consolidación
 */

const pool = require('../src/config/database');
const { normalizarTelefonoConPrefijo57 } = require('../src/helpers/phone');

const DRY_RUN = process.argv.includes('--dry-run');

console.log('═══════════════════════════════════════════════════════');
console.log('🔄 CONSOLIDACIÓN DE CONVERSACIONES WHATSAPP DUPLICADAS');
console.log('═══════════════════════════════════════════════════════');
console.log(`Modo: ${DRY_RUN ? '🧪 DRY RUN (sin cambios reales)' : '⚠️  EJECUCIÓN REAL'}`);
console.log('');

async function consolidarDuplicados() {
    try {
        // 1. Identificar duplicados normalizando números on-the-fly
        console.log('📊 Buscando conversaciones duplicadas...\n');

        const duplicadosQuery = `
            SELECT
                REPLACE(REPLACE(celular, '+', ''), 'whatsapp:', '') as celular_normalizado,
                ARRAY_AGG(id ORDER BY fecha_inicio DESC) as ids_duplicados,
                ARRAY_AGG(celular ORDER BY fecha_inicio DESC) as celulares_originales,
                ARRAY_AGG(nombre_paciente ORDER BY fecha_inicio DESC) as nombres,
                ARRAY_AGG(estado ORDER BY fecha_inicio DESC) as estados,
                COUNT(*) as cantidad
            FROM conversaciones_whatsapp
            GROUP BY celular_normalizado
            HAVING COUNT(*) > 1
            ORDER BY cantidad DESC;
        `;

        const { rows: gruposDuplicados } = await pool.query(duplicadosQuery);

        if (gruposDuplicados.length === 0) {
            console.log('✅ No se encontraron conversaciones duplicadas');
            process.exit(0);
        }

        console.log(`⚠️  Encontrados ${gruposDuplicados.length} grupos de conversaciones duplicadas:\n`);

        // Mostrar resumen
        let totalDuplicados = 0;
        gruposDuplicados.forEach((grupo, index) => {
            totalDuplicados += grupo.cantidad - 1; // -1 porque la primaria no se elimina
            console.log(`📍 Grupo ${index + 1}: ${grupo.celular_normalizado}`);
            console.log(`   Total conversaciones: ${grupo.cantidad}`);
            console.log(`   IDs: ${grupo.ids_duplicados.join(', ')}`);
            console.log(`   Celulares originales: ${grupo.celulares_originales.join(', ')}`);
            console.log(`   Estados: ${grupo.estados.join(', ')}`);
            console.log('');
        });

        console.log(`📈 Total de conversaciones duplicadas a consolidar: ${totalDuplicados}\n`);

        if (DRY_RUN) {
            console.log('🧪 DRY RUN - No se realizarán cambios. Ejecuta sin --dry-run para consolidar.');
            process.exit(0);
        }

        // Confirmación adicional en modo real
        console.log('⚠️  ¿Estás seguro de continuar con la consolidación?');
        console.log('   Se migrarán mensajes y se cerrarán conversaciones duplicadas.');
        console.log('   Presiona Ctrl+C para cancelar o espera 5 segundos para continuar...\n');

        await new Promise(resolve => setTimeout(resolve, 5000));

        // 2. Consolidar cada grupo
        console.log('🔄 Iniciando consolidación...\n');

        let consolidados = 0;
        let mensajesMigrados = 0;

        for (const grupo of gruposDuplicados) {
            const idPrimario = grupo.ids_duplicados[0]; // Más reciente
            const idsSecundarios = grupo.ids_duplicados.slice(1);
            const celularNormalizado = grupo.celular_normalizado;

            console.log(`\n📍 Consolidando grupo: ${celularNormalizado}`);
            console.log(`   ID primario (se mantendrá): ${idPrimario}`);
            console.log(`   IDs secundarios (se cerrarán): ${idsSecundarios.join(', ')}`);

            // Iniciar transacción
            await pool.query('BEGIN');

            try {
                // 2.1. Migrar mensajes de secundarias a primaria
                for (const idSecundario of idsSecundarios) {
                    const { rows: mensajes } = await pool.query(
                        'SELECT COUNT(*) as total FROM mensajes_whatsapp WHERE conversacion_id = $1',
                        [idSecundario]
                    );

                    const totalMensajes = parseInt(mensajes[0].total);

                    if (totalMensajes > 0) {
                        await pool.query(`
                            UPDATE mensajes_whatsapp
                            SET conversacion_id = $1
                            WHERE conversacion_id = $2
                        `, [idPrimario, idSecundario]);

                        console.log(`   ✓ Migrados ${totalMensajes} mensajes de ${idSecundario} → ${idPrimario}`);
                        mensajesMigrados += totalMensajes;
                    }
                }

                // 2.2. Primero, cambiar celular de secundarias a uno temporal para evitar constraint violation
                // Esto libera el número normalizado para la primaria
                for (let i = 0; i < idsSecundarios.length; i++) {
                    await pool.query(`
                        UPDATE conversaciones_whatsapp
                        SET celular = $1
                        WHERE id = $2
                    `, [`_duplicado_${idsSecundarios[i]}`, idsSecundarios[i]]);
                }

                // 2.3. Ahora actualizar celular normalizado en conversación primaria
                await pool.query(`
                    UPDATE conversaciones_whatsapp
                    SET celular = $1,
                        fecha_ultima_actividad = NOW()
                    WHERE id = $2
                `, [celularNormalizado, idPrimario]);

                console.log(`   ✓ Actualizado celular en conversación primaria: ${celularNormalizado}`);

                // 2.4. Finalmente cerrar conversaciones secundarias
                await pool.query(`
                    UPDATE conversaciones_whatsapp
                    SET estado = 'cerrada',
                        fecha_ultima_actividad = NOW()
                    WHERE id = ANY($1::int[])
                `, [idsSecundarios]);

                console.log(`   ✓ Cerradas ${idsSecundarios.length} conversaciones secundarias`);

                // Commit transacción
                await pool.query('COMMIT');
                consolidados++;

                console.log(`   ✅ Grupo consolidado exitosamente`);

            } catch (error) {
                // Rollback en caso de error
                await pool.query('ROLLBACK');
                console.error(`   ❌ Error consolidando grupo ${celularNormalizado}:`, error.message);
                console.error('   Se hizo rollback, no se perdieron datos');
            }
        }

        console.log('\n═══════════════════════════════════════════════════════');
        console.log('✅ CONSOLIDACIÓN COMPLETADA');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`📊 Estadísticas:`);
        console.log(`   • Grupos procesados: ${consolidados}/${gruposDuplicados.length}`);
        console.log(`   • Conversaciones consolidadas: ${totalDuplicados}`);
        console.log(`   • Mensajes migrados: ${mensajesMigrados}`);
        console.log('');

        // 3. Verificación final
        console.log('🔍 Verificando que no quedaron duplicados...\n');

        const { rows: verificacion } = await pool.query(`
            SELECT COUNT(*) as grupos_duplicados
            FROM (
                SELECT
                    REPLACE(REPLACE(celular, '+', ''), 'whatsapp:', '') as celular_normalizado,
                    COUNT(*) as cantidad
                FROM conversaciones_whatsapp
                WHERE estado != 'cerrada'
                GROUP BY celular_normalizado
                HAVING COUNT(*) > 1
            ) duplicados
        `);

        const duplicadosRestantes = parseInt(verificacion[0].grupos_duplicados);

        if (duplicadosRestantes > 0) {
            console.log(`⚠️  Aún quedan ${duplicadosRestantes} grupos de conversaciones duplicadas activas`);
            console.log('   Ejecuta el script nuevamente para consolidarlas');
        } else {
            console.log('✅ No quedan conversaciones duplicadas activas');
        }

    } catch (error) {
        console.error('\n❌ Error durante la consolidación:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Ejecutar
consolidarDuplicados();
