// Script temporal para enviar webhook Make.com a órdenes de ACUMEN importadas
const pool = require('./src/config/database');
const { dispararWebhookMake } = require('./src/helpers/webhook');

(async () => {
    try {
        console.log('🚀 Iniciando envío de webhooks para ACUMEN...\n');

        // Obtener órdenes de ACUMEN sin linkEnviado
        const result = await pool.query(`
            SELECT
                "_id",
                "primerNombre",
                "segundoNombre",
                "primerApellido",
                "segundoApellido",
                "numeroId",
                "celular",
                "ciudad",
                "fechaAtencion",
                "horaAtencion",
                "medico",
                "codEmpresa",
                "examenes",
                "modalidad",
                "_createdDate"
            FROM "HistoriaClinica"
            WHERE "codEmpresa" = 'ACUMEN'
            AND ("linkEnviado" IS NULL OR "linkEnviado" = '')
            ORDER BY "_createdDate" DESC
        `);

        console.log(`📋 Encontradas ${result.rows.length} órdenes de ACUMEN pendientes\n`);

        if (result.rows.length === 0) {
            console.log('✅ No hay órdenes pendientes de envío');
            await pool.end();
            return;
        }

        // Mostrar órdenes
        console.log('Órdenes a procesar:');
        result.rows.forEach((orden, idx) => {
            console.log(`${idx + 1}. ${orden.primerNombre} ${orden.primerApellido} - ${orden.numeroId}`);
        });
        console.log('');

        // Procesar cada orden
        let enviados = 0;
        let errores = 0;

        for (let i = 0; i < result.rows.length; i++) {
            const orden = result.rows[i];

            try {
                console.log(`\n[${i + 1}/${result.rows.length}] Procesando: ${orden.primerNombre} ${orden.primerApellido}`);

                // Disparar webhook
                await dispararWebhookMake({
                    _id: orden._id,
                    celular: orden.celular,
                    numeroId: orden.numeroId,
                    primerNombre: orden.primerNombre,
                    codEmpresa: orden.codEmpresa,
                    examenes: orden.examenes,
                    ciudad: orden.ciudad,
                    fechaAtencion: orden.fechaAtencion,
                    horaAtencion: orden.horaAtencion,
                    medico: orden.medico,
                    modalidad: orden.modalidad
                });

                // Marcar como enviado
                await pool.query(`
                    UPDATE "HistoriaClinica"
                    SET "linkEnviado" = 'ENVIADO'
                    WHERE "_id" = $1
                `, [orden._id]);

                enviados++;
                console.log(`✅ Webhook enviado y marcado como ENVIADO`);

                // Esperar 3 segundos entre envíos para no saturar Make.com
                if (i < result.rows.length - 1) {
                    console.log('⏳ Esperando 3 segundos...');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }

            } catch (error) {
                errores++;
                console.error(`❌ Error: ${error.message}`);
            }
        }

        console.log('\n=====================================');
        console.log('📊 RESUMEN');
        console.log('=====================================');
        console.log(`✅ Enviados exitosamente: ${enviados}`);
        console.log(`❌ Errores: ${errores}`);
        console.log(`📋 Total procesados: ${result.rows.length}`);
        console.log('=====================================\n');

        await pool.end();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error general:', error.message);
        await pool.end();
        process.exit(1);
    }
})();
