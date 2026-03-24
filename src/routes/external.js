const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { normalizarTelefonoConPrefijo57 } = require('../helpers/phone');
const { notificarNuevaOrden } = require('../helpers/sse');
const { authMiddleware } = require('../middleware/auth');

const API_KEY = process.env.EXTERNAL_API_KEY;

function apiKeyAuth(req, res, next) {
    const key = req.headers['x-api-key'];
    if (!API_KEY || key !== API_KEY) {
        return res.status(401).json({ success: false, message: 'API Key invalida' });
    }
    next();
}

// POST /api/external/ordenes - Crear orden desde plataforma externa (SIIGO)
router.post('/ordenes', apiKeyAuth, async (req, res) => {
    try {
        const {
            primerNombre,
            segundoNombre,
            primerApellido,
            segundoApellido,
            numeroId,
            celular,
            ciudad,
            cargo,
            email,
            empresa
        } = req.body;

        // Validar campos requeridos
        const camposFaltantes = [];
        if (!primerNombre) camposFaltantes.push('primerNombre');
        if (!primerApellido) camposFaltantes.push('primerApellido');
        if (!numeroId) camposFaltantes.push('numeroId');
        if (!celular) camposFaltantes.push('celular');
        if (!ciudad) camposFaltantes.push('ciudad');
        if (!empresa) camposFaltantes.push('empresa');

        if (camposFaltantes.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Faltan campos requeridos: ${camposFaltantes.join(', ')}`
            });
        }

        // Validar que empresa sea un valor permitido
        const empresasPermitidas = ['SIIGO', 'SIIGO ACTUALICESE'];
        const empresaNormalizada = empresa.toUpperCase().trim();
        if (!empresasPermitidas.includes(empresaNormalizada)) {
            return res.status(400).json({
                success: false,
                message: `Empresa no permitida. Valores validos: ${empresasPermitidas.join(', ')}`
            });
        }

        const codEmpresa = 'SIIGO';

        // Verificar duplicado pendiente
        const duplicado = await pool.query(`
            SELECT "_id", "primerNombre", "primerApellido", "atendido"
            FROM "HistoriaClinica"
            WHERE "numeroId" = $1 AND "codEmpresa" = $2 AND "atendido" = 'PENDIENTE'
            ORDER BY "_createdDate" DESC LIMIT 1
        `, [numeroId, codEmpresa]);

        if (duplicado.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Ya existe una orden PENDIENTE para este paciente',
                orden: duplicado.rows[0]
            });
        }

        const wixId = `orden_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const insertQuery = `
            INSERT INTO "HistoriaClinica" (
                "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                "celular", "codEmpresa", "empresa", "cargo", "ciudad", "email",
                "atendido", "_createdDate", "_updatedDate"
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PENDIENTE', NOW(), NOW()
            )
            RETURNING "_id", "numeroId", "primerNombre", "primerApellido"
        `;

        const result = await pool.query(insertQuery, [
            wixId,
            numeroId.trim(),
            primerNombre.trim().toUpperCase(),
            (segundoNombre || '').trim().toUpperCase() || null,
            primerApellido.trim().toUpperCase(),
            (segundoApellido || '').trim().toUpperCase() || null,
            celular.trim(),
            codEmpresa,
            empresaNormalizada,
            (cargo || '').trim().toUpperCase() || null,
            ciudad.trim().toUpperCase(),
            (email || '').trim().toLowerCase() || null
        ]);

        console.log(`[EXTERNAL] Orden creada: ${wixId} | ${primerNombre} ${primerApellido} | ${numeroId} | ${empresaNormalizada}`);

        // Gestionar conversacion WhatsApp
        try {
            const celularConPrefijo = normalizarTelefonoConPrefijo57(celular);
            const celularSinMas = celularConPrefijo ? celularConPrefijo.replace(/^\+/, '') : null;

            let conversacionExistente = await pool.query(
                `SELECT id, celular FROM conversaciones_whatsapp WHERE celular = $1`,
                [celularConPrefijo]
            );

            if (conversacionExistente.rows.length === 0 && celularSinMas) {
                conversacionExistente = await pool.query(
                    `SELECT id, celular FROM conversaciones_whatsapp WHERE celular = $1`,
                    [celularSinMas]
                );
                if (conversacionExistente.rows.length > 0) {
                    await pool.query(`UPDATE conversaciones_whatsapp SET celular = $1 WHERE id = $2`, [celularConPrefijo, conversacionExistente.rows[0].id]);
                }
            }

            if (conversacionExistente.rows.length > 0) {
                await pool.query(`
                    UPDATE conversaciones_whatsapp
                    SET "stopBot" = true, bot_activo = false, paciente_id = $2,
                        nombre_paciente = $3, fecha_ultima_actividad = NOW()
                    WHERE celular = $1
                `, [celularConPrefijo, numeroId, `${primerNombre} ${primerApellido}`]);
            } else {
                await pool.query(`
                    INSERT INTO conversaciones_whatsapp (
                        celular, paciente_id, nombre_paciente, "stopBot", origen, estado, bot_activo,
                        fecha_inicio, fecha_ultima_actividad
                    ) VALUES ($1, $2, $3, true, 'EXTERNAL', 'nueva', false, NOW(), NOW())
                `, [celularConPrefijo, numeroId, `${primerNombre} ${primerApellido}`]);
            }
        } catch (whatsappError) {
            console.error('[EXTERNAL] Error WhatsApp:', whatsappError.message);
        }

        // Sincronizar con Wix
        try {
            const wixPayload = {
                _id: wixId,
                numeroId: numeroId.trim(),
                primerNombre: primerNombre.trim().toUpperCase(),
                segundoNombre: (segundoNombre || '').trim().toUpperCase(),
                primerApellido: primerApellido.trim().toUpperCase(),
                segundoApellido: (segundoApellido || '').trim().toUpperCase(),
                celular: celular.trim(),
                codEmpresa,
                empresa: empresaNormalizada,
                cargo: (cargo || '').trim().toUpperCase(),
                ciudad: ciudad.trim().toUpperCase(),
                atendido: 'PENDIENTE'
            };

            const wixResponse = await fetch('https://www.bsl.com.co/_functions/crearHistoriaClinica', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(wixPayload)
            });

            if (wixResponse.ok) {
                console.log(`[EXTERNAL] Wix sincronizado para ${wixId}`);
            } else {
                console.error(`[EXTERNAL] Wix error: ${wixResponse.status}`);
            }
        } catch (wixError) {
            console.error('[EXTERNAL] Wix excepcion:', wixError.message);
        }

        // Notificar SSE
        notificarNuevaOrden({
            _id: wixId,
            numeroId,
            primerNombre,
            primerApellido
        });

        res.status(201).json({
            success: true,
            message: 'Orden creada exitosamente',
            orden: {
                _id: wixId,
                numeroId: result.rows[0].numeroId,
                primerNombre: result.rows[0].primerNombre,
                primerApellido: result.rows[0].primerApellido,
                codEmpresa,
                empresa: empresaNormalizada,
                atendido: 'PENDIENTE'
            }
        });

    } catch (error) {
        console.error('[EXTERNAL] Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno al crear la orden',
            error: error.message
        });
    }
});

// POST /api/external/aprobar - Aprobar orden SIIGO (envía resultado a plataforma externa)
router.post('/aprobar', authMiddleware, async (req, res) => {
    try {
        const { ordenId, numeroId, primerNombre, primerApellido, mdConceptoFinal } = req.body;

        if (!ordenId || !mdConceptoFinal) {
            return res.status(400).json({ success: false, message: 'Faltan campos: ordenId, mdConceptoFinal' });
        }

        // Verificar que la orden existe y es SIIGO
        const orden = await pool.query(`
            SELECT "_id", "codEmpresa", "atendido", "aprobacion_externa"
            FROM "HistoriaClinica" WHERE "_id" = $1
        `, [ordenId]);

        if (orden.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Orden no encontrada' });
        }

        if (orden.rows[0].codEmpresa !== 'SIIGO') {
            return res.status(400).json({ success: false, message: 'Esta orden no es de SIIGO' });
        }

        if (orden.rows[0].aprobacion_externa === 'APROBADO') {
            return res.status(409).json({ success: false, message: 'Esta orden ya fue aprobada' });
        }

        // TODO: Enviar a plataforma externa de SIIGO
        // const response = await fetch('https://api-siigo-externa.com/aprobar', { ... });

        // Marcar como aprobada en nuestra BD
        await pool.query(`
            UPDATE "HistoriaClinica"
            SET "aprobacion_externa" = 'APROBADO',
                "fecha_aprobacion_externa" = NOW(),
                "concepto_aprobado" = $2
            WHERE "_id" = $1
        `, [ordenId, mdConceptoFinal]);

        console.log(`[EXTERNAL] Orden aprobada: ${ordenId} | ${primerNombre} ${primerApellido} | Concepto: ${mdConceptoFinal}`);

        res.json({
            success: true,
            message: 'Orden aprobada exitosamente',
            aprobacion: {
                ordenId,
                numeroId,
                concepto: mdConceptoFinal,
                estado: 'APROBADO'
            }
        });

    } catch (error) {
        console.error('[EXTERNAL] Error aprobacion:', error.message);
        res.status(500).json({ success: false, message: 'Error al aprobar la orden', error: error.message });
    }
});

module.exports = router;
