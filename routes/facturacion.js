/**
 * Endpoints para integración con Alegra - Facturación
 */

const express = require('express');
const router = express.Router();
const AlegraClient = require('../lib/alegra-client');

// Middleware de autenticación (importar del server.js principal)
// Asumimos que req.usuario está disponible después de authMiddleware

/**
 * POST /api/facturacion/generar-lote
 * Genera factura por lote para una empresa
 */
router.post('/generar-lote', async (req, res) => {
    const pool = req.app.locals.pool; // Pool de PostgreSQL

    try {
        const { codEmpresa, fechaInicio, fechaFin, observaciones, terminos, diasVencimiento } = req.body;

        if (!codEmpresa) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere codEmpresa'
            });
        }

        console.log(`📊 Generando factura por lote para empresa: ${codEmpresa}`);

        // 1. Obtener configuración de facturación de la empresa
        const configResult = await pool.query(`
            SELECT * FROM configuracion_facturacion_empresa
            WHERE cod_empresa = $1 AND activo = true
        `, [codEmpresa]);

        if (configResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: `No se encontró configuración de facturación para la empresa ${codEmpresa}`
            });
        }

        const config = configResult.rows[0];

        // 2. Obtener exámenes médicos completados en el rango de fechas
        // Nota: examenes es TEXT con exámenes separados por comas
        // Usamos unnest(string_to_array()) para expandir cada examen
        let query = `
            SELECT
                hc._id,
                hc."primerNombre",
                hc."segundoNombre",
                hc."primerApellido",
                hc."segundoApellido",
                hc."numeroId",
                hc."celular",
                hc."email",
                hc."direccion",
                hc."fechaAtencion",
                hc."mdConceptoFinal",
                hc."tipoExamen",
                TRIM(examen_individual) as tipo_examen,
                e.id as examen_id,
                e.nombre as examen_nombre,
                e.precio as examen_precio,
                ea.alegra_item_id
            FROM "HistoriaClinica" hc
            CROSS JOIN LATERAL unnest(string_to_array(hc.examenes, ',')) AS examen_individual
            LEFT JOIN examenes e ON UPPER(TRIM(examen_individual)) = UPPER(TRIM(e.nombre))
            LEFT JOIN examenes_alegra ea ON e.id = ea.examen_id
            WHERE hc."codEmpresa" = $1
            AND hc.atendido = true
            AND (hc.pagado = false OR hc.pagado IS NULL)
            AND hc.examenes IS NOT NULL
            AND hc.examenes != ''
        `;

        const params = [codEmpresa];
        let paramIndex = 2;

        if (fechaInicio) {
            query += ` AND "fechaAtencion" >= $${paramIndex}`;
            params.push(fechaInicio);
            paramIndex++;
        }

        if (fechaFin) {
            query += ` AND "fechaAtencion" <= $${paramIndex}`;
            params.push(fechaFin);
            paramIndex++;
        }

        query += ` ORDER BY "fechaAtencion" ASC`;

        const examenesResult = await pool.query(query, params);

        if (examenesResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No se encontraron exámenes para facturar en el período especificado'
            });
        }

        console.log(`📋 Se encontraron ${examenesResult.rows.length} exámenes para facturar`);

        // 3. Preparar items de la factura usando la tabla examenes
        const items = [];
        const detalleExamenes = [];
        const examenesNoEncontrados = [];

        for (const examen of examenesResult.rows) {
            // Validar que el examen tenga precio y exista en la tabla examenes
            if (!examen.examen_id) {
                examenesNoEncontrados.push(`${examen.tipo_examen} (paciente: ${examen.primerNombre} ${examen.primerApellido})`);
                console.warn(`⚠️ Examen no encontrado en tabla examenes: ${examen.tipo_examen}`);
                continue;
            }

            if (!examen.examen_precio || parseFloat(examen.examen_precio) <= 0) {
                examenesNoEncontrados.push(`${examen.examen_nombre} (sin precio configurado)`);
                console.warn(`⚠️ Examen sin precio: ${examen.examen_nombre}`);
                continue;
            }

            const precio = parseFloat(examen.examen_precio);

            items.push({
                id: examen.alegra_item_id || undefined, // Si no tiene item_id en Alegra, se omite
                name: examen.examen_nombre,
                description: `${examen.primerNombre} ${examen.primerApellido} - CC ${examen.numeroId}`,
                price: precio,
                quantity: 1
            });

            detalleExamenes.push({
                historia_clinica_id: examen._id,
                descripcion: `${examen.examen_nombre} - ${examen.primerNombre} ${examen.primerApellido}`,
                cantidad: 1,
                precio_unitario: precio,
                subtotal: precio,
                alegra_item_id: examen.alegra_item_id,
                paciente_nombre: `${examen.primerNombre} ${examen.primerApellido}`,
                paciente_numero_id: examen.numeroId,
                tipo_examen: examen.tipo_examen,
                fecha_examen: examen.fechaAtencion
            });
        }

        // Reportar exámenes no procesados
        if (examenesNoEncontrados.length > 0) {
            console.warn(`⚠️ ${examenesNoEncontrados.length} exámenes no pudieron ser procesados:`);
            examenesNoEncontrados.forEach(e => console.warn(`   - ${e}`));
        }

        if (items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No se pudieron preparar items para facturar. Verifica que los exámenes tengan precio configurado en la tabla examenes.',
                examenes_no_procesados: examenesNoEncontrados
            });
        }

        // 4. Calcular totales
        const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
        const total = subtotal; // Ajustar si hay impuestos o retenciones

        // 5. Crear cliente en Alegra si no existe
        const alegraClient = new AlegraClient();
        let clienteAlegraId = config.alegra_client_id;

        if (!clienteAlegraId) {
            console.log('🔍 Cliente no configurado en Alegra, se omite creación automática');
            return res.status(400).json({
                success: false,
                message: 'La empresa no tiene configurado un cliente en Alegra. Configura alegra_client_id en configuracion_facturacion_empresa.'
            });
        }

        // 6. Preparar datos de la factura
        const fechaFactura = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const fechaVencimiento = new Date();
        fechaVencimiento.setDate(fechaVencimiento.getDate() + (diasVencimiento || config.dias_vencimiento || 30));
        const fechaVencimientoStr = fechaVencimiento.toISOString().split('T')[0];

        const facturaData = {
            client: {
                id: clienteAlegraId
            },
            items: items,
            date: fechaFactura,
            dueDate: fechaVencimientoStr,
            observations: observaciones || config.observaciones_default || `Factura por servicios médicos - ${codEmpresa}`,
            termsConditions: terminos || config.terminos_condiciones || ''
        };

        // Validar antes de enviar
        alegraClient.validateInvoiceData(facturaData);

        // 7. Crear factura en Alegra
        console.log('📤 Enviando factura a Alegra...');
        const alegraResponse = await alegraClient.createInvoice(facturaData);

        if (!alegraResponse.success) {
            throw new Error('Error al crear factura en Alegra');
        }

        const alegraInvoice = alegraResponse.data;

        // 8. Guardar factura en PostgreSQL
        const facturaResult = await pool.query(`
            INSERT INTO facturas (
                alegra_invoice_id,
                alegra_invoice_number,
                cod_empresa,
                fecha_factura,
                fecha_vencimiento,
                subtotal,
                impuestos,
                retenciones,
                total,
                estado,
                observaciones,
                terminos_condiciones,
                creado_por,
                ultima_sincronizacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
            RETURNING id
        `, [
            alegraInvoice.id,
            alegraInvoice.numberTemplate?.fullNumber || null,
            codEmpresa,
            fechaFactura,
            fechaVencimientoStr,
            subtotal,
            0, // impuestos
            0, // retenciones
            total,
            alegraInvoice.status || 'draft',
            observaciones || config.observaciones_default,
            terminos || config.terminos_condiciones,
            req.usuario?.id || null
        ]);

        const facturaId = facturaResult.rows[0].id;

        // 9. Guardar items de la factura
        for (const detalle of detalleExamenes) {
            await pool.query(`
                INSERT INTO factura_items (
                    factura_id,
                    historia_clinica_id,
                    descripcion,
                    cantidad,
                    precio_unitario,
                    subtotal,
                    alegra_item_id,
                    paciente_nombre,
                    paciente_numero_id,
                    tipo_examen,
                    fecha_examen
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `, [
                facturaId,
                detalle.historia_clinica_id,
                detalle.descripcion,
                detalle.cantidad,
                detalle.precio_unitario,
                detalle.subtotal,
                detalle.alegra_item_id,
                detalle.paciente_nombre,
                detalle.paciente_numero_id,
                detalle.tipo_examen,
                detalle.fecha_examen
            ]);
        }

        // 10. Marcar exámenes como facturados (opcional)
        const historiaClinicaIds = detalleExamenes.map(d => d.historia_clinica_id);
        await pool.query(`
            UPDATE "HistoriaClinica"
            SET pagado = true, fecha_pago = NOW()
            WHERE _id = ANY($1)
        `, [historiaClinicaIds]);

        // 11. Registrar log de sincronización
        await pool.query(`
            INSERT INTO alegra_sync_log (
                factura_id,
                operacion,
                request_payload,
                response_payload,
                exitoso,
                codigo_http,
                usuario_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            facturaId,
            'create_invoice',
            JSON.stringify(facturaData),
            JSON.stringify(alegraInvoice),
            true,
            alegraResponse.statusCode,
            req.usuario?.id || null
        ]);

        console.log(`✅ Factura creada exitosamente - ID Alegra: ${alegraInvoice.id}, Número: ${alegraInvoice.numberTemplate?.fullNumber}`);

        res.json({
            success: true,
            message: 'Factura generada exitosamente',
            data: {
                factura_id: facturaId,
                alegra_invoice_id: alegraInvoice.id,
                alegra_invoice_number: alegraInvoice.numberTemplate?.fullNumber,
                total: total,
                items_count: items.length,
                examenes_facturados: examenesResult.rows.length
            }
        });

    } catch (error) {
        console.error('❌ Error al generar factura:', error);

        // Registrar log de error
        try {
            await pool.query(`
                INSERT INTO alegra_sync_log (
                    operacion,
                    request_payload,
                    exitoso,
                    mensaje_error,
                    usuario_id
                ) VALUES ($1, $2, $3, $4, $5)
            `, [
                'create_invoice',
                JSON.stringify(req.body),
                false,
                error.message,
                req.usuario?.id || null
            ]);
        } catch (logError) {
            console.error('Error al registrar log:', logError);
        }

        res.status(500).json({
            success: false,
            message: 'Error al generar factura',
            error: error.message
        });
    }
});

/**
 * GET /api/facturacion/facturas
 * Obtener lista de facturas
 */
router.get('/facturas', async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const { codEmpresa, estado, fechaInicio, fechaFin, page = 1, limit = 50 } = req.query;

        let query = `
            SELECT
                f.*,
                u.nombre_completo as creado_por_nombre,
                (SELECT COUNT(*) FROM factura_items WHERE factura_id = f.id) as items_count
            FROM facturas f
            LEFT JOIN usuarios u ON f.creado_por = u.id
            WHERE 1=1
        `;

        const params = [];
        let paramIndex = 1;

        if (codEmpresa) {
            query += ` AND f.cod_empresa = $${paramIndex}`;
            params.push(codEmpresa);
            paramIndex++;
        }

        if (estado) {
            query += ` AND f.estado = $${paramIndex}`;
            params.push(estado);
            paramIndex++;
        }

        if (fechaInicio) {
            query += ` AND f.fecha_factura >= $${paramIndex}`;
            params.push(fechaInicio);
            paramIndex++;
        }

        if (fechaFin) {
            query += ` AND f.fecha_factura <= $${paramIndex}`;
            params.push(fechaFin);
            paramIndex++;
        }

        query += ` ORDER BY f.fecha_creacion DESC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

        const result = await pool.query(query, params);

        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: result.rowCount
            }
        });

    } catch (error) {
        console.error('❌ Error al obtener facturas:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener facturas',
            error: error.message
        });
    }
});

/**
 * GET /api/facturacion/facturas/:id
 * Obtener detalle de una factura con sus items
 */
router.get('/facturas/:id', async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const { id } = req.params;

        const facturaResult = await pool.query(`
            SELECT f.*, u.nombre_completo as creado_por_nombre
            FROM facturas f
            LEFT JOIN usuarios u ON f.creado_por = u.id
            WHERE f.id = $1
        `, [id]);

        if (facturaResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Factura no encontrada'
            });
        }

        const itemsResult = await pool.query(`
            SELECT * FROM factura_items
            WHERE factura_id = $1
            ORDER BY id ASC
        `, [id]);

        res.json({
            success: true,
            data: {
                factura: facturaResult.rows[0],
                items: itemsResult.rows
            }
        });

    } catch (error) {
        console.error('❌ Error al obtener factura:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener factura',
            error: error.message
        });
    }
});

/**
 * GET /api/facturacion/configuracion/:codEmpresa
 * Obtener configuración de facturación de una empresa
 */
router.get('/configuracion/:codEmpresa', async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const { codEmpresa } = req.params;

        const result = await pool.query(`
            SELECT * FROM configuracion_facturacion_empresa
            WHERE cod_empresa = $1
        `, [codEmpresa]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Configuración no encontrada'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error al obtener configuración:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener configuración',
            error: error.message
        });
    }
});

/**
 * POST /api/facturacion/configuracion
 * Crear o actualizar configuración de facturación para una empresa
 */
router.post('/configuracion', async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const {
            codEmpresa,
            alegraClientId,
            terminosCondiciones,
            observacionesDefault,
            diasVencimiento,
            incluirRetencion,
            porcentajeRetencion
        } = req.body;

        if (!codEmpresa) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere codEmpresa'
            });
        }

        const result = await pool.query(`
            INSERT INTO configuracion_facturacion_empresa (
                cod_empresa,
                alegra_client_id,
                terminos_condiciones,
                observaciones_default,
                dias_vencimiento,
                incluir_retencion,
                porcentaje_retencion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (cod_empresa)
            DO UPDATE SET
                alegra_client_id = EXCLUDED.alegra_client_id,
                terminos_condiciones = EXCLUDED.terminos_condiciones,
                observaciones_default = EXCLUDED.observaciones_default,
                dias_vencimiento = EXCLUDED.dias_vencimiento,
                incluir_retencion = EXCLUDED.incluir_retencion,
                porcentaje_retencion = EXCLUDED.porcentaje_retencion,
                updated_at = NOW()
            RETURNING *
        `, [
            codEmpresa,
            alegraClientId || null,
            terminosCondiciones || null,
            observacionesDefault || null,
            diasVencimiento || 30,
            incluirRetencion || false,
            porcentajeRetencion || null
        ]);

        res.json({
            success: true,
            message: 'Configuración guardada exitosamente',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error al guardar configuración:', error);
        res.status(500).json({
            success: false,
            message: 'Error al guardar configuración',
            error: error.message
        });
    }
});

/**
 * POST /api/facturacion/examenes-alegra
 * Asociar un examen con su ID en Alegra
 */
router.post('/examenes-alegra', async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const { examenId, alegraItemId } = req.body;

        if (!examenId || !alegraItemId) {
            return res.status(400).json({
                success: false,
                message: 'Se requieren examenId y alegraItemId'
            });
        }

        const result = await pool.query(`
            INSERT INTO examenes_alegra (examen_id, alegra_item_id)
            VALUES ($1, $2)
            ON CONFLICT (examen_id)
            DO UPDATE SET
                alegra_item_id = EXCLUDED.alegra_item_id,
                updated_at = NOW()
            RETURNING *
        `, [examenId, alegraItemId]);

        res.json({
            success: true,
            message: 'Asociación guardada exitosamente',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error al guardar asociación:', error);
        res.status(500).json({
            success: false,
            message: 'Error al guardar asociación',
            error: error.message
        });
    }
});

/**
 * GET /api/facturacion/examenes-alegra
 * Obtener todos los mapeos de exámenes a Alegra
 */
router.get('/examenes-alegra', async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const result = await pool.query(`
            SELECT
                ea.*,
                e.nombre as examen_nombre,
                e.precio as examen_precio,
                e.codigo_cups
            FROM examenes_alegra ea
            JOIN examenes e ON ea.examen_id = e.id
            ORDER BY e.nombre ASC
        `);

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {
        console.error('❌ Error al obtener mapeos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener mapeos',
            error: error.message
        });
    }
});

/**
 * GET /api/facturacion/preview
 * Obtener preview de exámenes para facturar
 */
router.get('/preview', async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const { codEmpresa, fechaInicio, fechaFin } = req.query;

        if (!codEmpresa) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere codEmpresa'
            });
        }

        // Consultar exámenes pendientes de facturación
        let query = `
            SELECT
                hc._id,
                hc."primerNombre",
                hc."primerApellido",
                hc."numeroId",
                hc."fechaAtencion",
                TRIM(examen_individual) as tipo_examen,
                e.id as examen_id,
                e.nombre as examen_nombre,
                e.precio as examen_precio
            FROM "HistoriaClinica" hc
            CROSS JOIN LATERAL unnest(string_to_array(hc.examenes, ',')) AS examen_individual
            LEFT JOIN examenes e ON UPPER(TRIM(examen_individual)) = UPPER(TRIM(e.nombre))
            WHERE hc."codEmpresa" = $1
            AND hc.atendido = true
            AND (hc.pagado = false OR hc.pagado IS NULL)
            AND hc.examenes IS NOT NULL
            AND hc.examenes != ''
        `;

        const params = [codEmpresa];
        let paramIndex = 2;

        if (fechaInicio) {
            query += ` AND hc."fechaAtencion" >= $${paramIndex}`;
            params.push(fechaInicio);
            paramIndex++;
        }

        if (fechaFin) {
            query += ` AND hc."fechaAtencion" <= $${paramIndex}`;
            params.push(fechaFin);
            paramIndex++;
        }

        query += ` ORDER BY hc."fechaAtencion" DESC`;

        const result = await pool.query(query, params);

        // Agrupar por tipo de examen
        const examenesPorTipo = {};
        let totalExamenes = 0;
        let totalPacientes = new Set();
        let totalMonto = 0;

        result.rows.forEach(row => {
            if (row.examen_id && row.examen_precio) {
                const tipoExamen = row.examen_nombre;
                if (!examenesPorTipo[tipoExamen]) {
                    examenesPorTipo[tipoExamen] = {
                        cantidad: 0,
                        precio: parseFloat(row.examen_precio),
                        subtotal: 0
                    };
                }
                examenesPorTipo[tipoExamen].cantidad++;
                examenesPorTipo[tipoExamen].subtotal += parseFloat(row.examen_precio);
                totalExamenes++;
                totalMonto += parseFloat(row.examen_precio);
                totalPacientes.add(row._id);
            }
        });

        res.json({
            success: true,
            data: {
                totalExamenes,
                totalPacientes: totalPacientes.size,
                totalMonto,
                examenesPorTipo
            }
        });

    } catch (error) {
        console.error('❌ Error al obtener preview:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener preview',
            error: error.message
        });
    }
});

module.exports = router;
