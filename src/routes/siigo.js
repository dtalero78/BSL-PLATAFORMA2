const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { sendWhatsAppMessage, sendWhatsAppFreeText } = require('../services/whatsapp');
const { normalizarTelefonoConPrefijo57 } = require('../helpers/phone');

// ========== ENDPOINTS ENVÍO SIIGO ==========

// GET - Obtener registros de SIIGO con linkEnviado vacío (cargar automáticamente)
router.get('/registros', async (req, res) => {
    try {
        const { tipo = 'pendientes' } = req.query;

        let query;
        let params = ['SIIGO'];

        if (tipo === 'pendientes') {
            // Cargar registros con linkEnviado vacío (NULL o '')
            query = `
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
                    "linkEnviado",
                    "_createdDate"
                FROM "HistoriaClinica"
                WHERE "codEmpresa" = $1
                AND ("linkEnviado" IS NULL OR "linkEnviado" = '')
                ORDER BY "_createdDate" DESC
                LIMIT 500
            `;
        } else if (tipo === 'segundo-envio') {
            // Registros con linkEnviado pero sin fechaAtencion
            query = `
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
                    "linkEnviado",
                    "_createdDate"
                FROM "HistoriaClinica"
                WHERE "codEmpresa" = $1
                AND "linkEnviado" IS NOT NULL
                AND "linkEnviado" != ''
                AND ("fechaAtencion" IS NULL OR "fechaAtencion" = '')
                ORDER BY "_createdDate" DESC
                LIMIT 500
            `;
        } else if (tipo === 'emergencia') {
            // Registros con linkEnviado = "ENVIADO"
            query = `
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
                    "linkEnviado",
                    "_createdDate"
                FROM "HistoriaClinica"
                WHERE "codEmpresa" = $1
                AND "linkEnviado" = 'ENVIADO'
                ORDER BY "_createdDate" DESC
                LIMIT 500
            `;
        }

        const result = await pool.query(query, params);

        console.log(`📋 Registros SIIGO (${tipo}): ${result.rows.length} encontrados`);

        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        console.error('❌ Error obteniendo registros SIIGO:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener registros',
            error: error.message
        });
    }
});

// POST - Enviar mensaje individual de WhatsApp a paciente SIIGO
router.post('/enviar-individual', async (req, res) => {
    try {
        const { _id, primerNombre, segundoNombre, primerApellido, celular, numeroId, ciudad, fechaAtencion } = req.body;

        if (!_id || !celular) {
            return res.status(400).json({
                success: false,
                message: 'Se requieren campos: _id, celular'
            });
        }

        // Limpiar y formatear número de teléfono
        const telefonoLimpio = celular.replace(/\s+/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '');
        let telefonoCompleto;

        if (telefonoLimpio.startsWith('+')) {
            telefonoCompleto = telefonoLimpio.substring(1);
        } else if (/^(52|57|1|34|44|58|51|54)\d{10,}/.test(telefonoLimpio)) {
            telefonoCompleto = telefonoLimpio;
        } else if (/^\d{10}$/.test(telefonoLimpio)) {
            telefonoCompleto = '57' + telefonoLimpio;
        } else if (telefonoLimpio.startsWith('0')) {
            const sinCero = telefonoLimpio.substring(1);
            telefonoCompleto = '52' + sinCero;
        } else if (/^\d{8,9}$/.test(telefonoLimpio)) {
            telefonoCompleto = '52' + telefonoLimpio;
        } else {
            telefonoCompleto = '57' + telefonoLimpio;
        }

        // Preparar nombre completo
        const nombreCompleto = `${primerNombre || ""} ${segundoNombre || ""}`.trim();

        // Determinar template y variables según ciudad
        let templateSid;
        let variables;

        if (ciudad && ciudad.toUpperCase() === "BOGOTA") {
            // Template para Bogotá (presencial)
            templateSid = 'HX4554efaf53c1bd614d49c951e487d394';
            variables = {
                "1": _id  // ID para el botón del formulario
            };
        } else {
            // Template para otras ciudades (virtual con cita)
            templateSid = 'HXeb45e56eb2e8dc4eaa35433282e12709';

            // Formatear fecha y hora si existe (convertir a hora de Colombia UTC-5)
            let fechaFormateada = "fecha pendiente";
            let horaFormateada = "hora pendiente";

            if (fechaAtencion) {
                // Convertir a hora de Colombia (UTC-5)
                const fechaUTC = new Date(fechaAtencion);
                const offsetColombia = -5 * 60; // Colombia UTC-5 en minutos
                const offsetLocal = fechaUTC.getTimezoneOffset(); // Offset del servidor
                const fechaColombia = new Date(fechaUTC.getTime() + (offsetLocal + offsetColombia) * 60000);

                const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
                const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

                const diaSemana = diasSemana[fechaColombia.getDay()];
                const dia = fechaColombia.getDate();
                const mes = meses[fechaColombia.getMonth()];

                fechaFormateada = `${diaSemana} ${dia} de ${mes}`;

                const horas = fechaColombia.getHours().toString().padStart(2, '0');
                const minutos = fechaColombia.getMinutes().toString().padStart(2, '0');
                horaFormateada = `${horas}:${minutos}`;
            }

            variables = {
                "1": nombreCompleto,
                "2": fechaFormateada,
                "3": horaFormateada,
                "4": _id  // ID para el botón del formulario
            };
        }

        // Enviar mensaje usando template de Twilio
        const resultWhatsApp = await sendWhatsAppMessage(telefonoCompleto, null, variables, templateSid);

        if (!resultWhatsApp.success) {
            return res.status(500).json({
                success: false,
                message: 'Error al enviar WhatsApp',
                error: resultWhatsApp.error
            });
        }

        // Marcar como enviado en la base de datos
        await pool.query(`
            UPDATE "HistoriaClinica"
            SET "linkEnviado" = 'ENVIADO'
            WHERE "_id" = $1
        `, [_id]);

        // Crear registro en conversaciones_whatsapp con stopBot
        const telefonoConPrefijo = normalizarTelefonoConPrefijo57(telefonoCompleto);

        try {
            // Buscar conversación - primero con +, luego sin + (conversaciones viejas)
            let convExistente = await pool.query(
                'SELECT id FROM conversaciones_whatsapp WHERE celular = $1',
                [telefonoConPrefijo]
            );

            // Si no se encuentra con +, buscar sin + (conversaciones antiguas)
            if (convExistente.rows.length === 0 && telefonoConPrefijo.startsWith('+')) {
                const numeroSinMas = telefonoConPrefijo.substring(1);
                convExistente = await pool.query(
                    'SELECT id FROM conversaciones_whatsapp WHERE celular = $1',
                    [numeroSinMas]
                );
            }

            if (convExistente.rows.length > 0) {
                await pool.query(
                    `UPDATE conversaciones_whatsapp
                    SET "stopBot" = true, fecha_ultima_actividad = NOW()
                    WHERE celular = $1`,
                    [telefonoConPrefijo]
                );
            } else {
                await pool.query(
                    `INSERT INTO conversaciones_whatsapp
                    (celular, nombre_paciente, estado, "stopBot", fecha_ultima_actividad)
                    VALUES ($1, $2, 'cerrada', true, NOW())`,
                    [telefonoConPrefijo, nombreCompleto || 'Paciente SIIGO']
                );
            }
        } catch (whatsappError) {
            console.log('⚠️ Error al gestionar conversación WhatsApp:', whatsappError.message);
        }

        console.log(`✅ WhatsApp enviado a ${nombreCompleto} (${telefonoCompleto})`);

        res.json({
            success: true,
            message: 'Mensaje enviado exitosamente',
            data: {
                telefono: telefonoCompleto,
                nombre: nombreCompleto
            }
        });
    } catch (error) {
        console.error('❌ Error enviando mensaje individual:', error);
        res.status(500).json({
            success: false,
            message: 'Error al enviar mensaje',
            error: error.message
        });
    }
});

// POST - Envío masivo de mensajes
router.post('/enviar-masivo', async (req, res) => {
    try {
        const { registros, tipoMensaje } = req.body;

        if (!registros || !Array.isArray(registros) || registros.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere un array de registros'
            });
        }

        const resultados = {
            total: registros.length,
            enviados: 0,
            errores: 0,
            detalles: [],
            agendaProgramada: []
        };

        for (let i = 0; i < registros.length; i++) {
            const item = registros[i];

            try {
                // Limpiar y formatear número
                const telefonoLimpio = item.celular.replace(/\s+/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '');
                let telefonoCompleto;

                if (telefonoLimpio.startsWith('+')) {
                    telefonoCompleto = telefonoLimpio.substring(1);
                } else if (/^(52|57|1|34|44|58|51|54)\d{10,}/.test(telefonoLimpio)) {
                    telefonoCompleto = telefonoLimpio;
                } else if (/^\d{10}$/.test(telefonoLimpio)) {
                    telefonoCompleto = '57' + telefonoLimpio;
                } else if (telefonoLimpio.startsWith('0')) {
                    const sinCero = telefonoLimpio.substring(1);
                    telefonoCompleto = '52' + sinCero;
                } else if (/^\d{8,9}$/.test(telefonoLimpio)) {
                    telefonoCompleto = '52' + telefonoLimpio;
                } else {
                    telefonoCompleto = '57' + telefonoLimpio;
                }

                const nombreCompleto = `${item.primerNombre || ""} ${item.segundoNombre || ""}`.trim();
                const nombrePaciente = `${item.primerNombre || ""} ${item.primerApellido || ""}`.trim();

                // Determinar template y variables según tipo de mensaje
                let templateSid;
                let variables;

                if (tipoMensaje === 'segundo-envio' || tipoMensaje === 'emergencia') {
                    // Para segundo envío y emergencia usamos texto libre (conversación activa)
                    // NOTA: Estos templates aún no están creados en Twilio
                    // Por ahora usamos sendWhatsAppFreeText
                    const acentos = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U' };
                    const cadenaNombre = item.primerNombre ? item.primerNombre.split('').map(letra => acentos[letra] || letra).join('').toString().split(" ").join("").split(".").join("").split("\t").join("") : "";

                    let mensaje;
                    if (tipoMensaje === 'segundo-envio') {
                        mensaje = `Hola ${cadenaNombre}! Aún no has agendado tu examen médico virtual de SIIGO.

Por favor agenda tu cita haciendo clic en el siguiente link:

https://www.bsl.com.co/autoagendamiento/${item.numeroId}

*Este examen no tiene ningún costo*

¡Gracias!`;
                    } else {
                        mensaje = `Hola ${cadenaNombre}! Te confirmo el link: https://www.bsl.com.co/autoagendamiento/${item.numeroId}`;
                    }

                    // Enviar mensaje de texto libre
                    const resultWhatsApp = await sendWhatsAppFreeText(telefonoCompleto, mensaje);

                    if (!resultWhatsApp.success) {
                        throw new Error(resultWhatsApp.error || 'Error al enviar WhatsApp');
                    }
                } else {
                    // Mensaje inicial (primer envío) - usar templates
                    if (item.ciudad && item.ciudad.toUpperCase() === "BOGOTA") {
                        // Template para Bogotá (presencial)
                        templateSid = 'HX4554efaf53c1bd614d49c951e487d394';
                        variables = {
                            "1": item._id
                        };
                    } else {
                        // Template para otras ciudades (virtual con cita)
                        templateSid = 'HXeb45e56eb2e8dc4eaa35433282e12709';

                        let fechaFormateada = "fecha pendiente";
                        let horaFormateada = "hora pendiente";

                        if (item.fechaAtencion) {
                            // Convertir a hora de Colombia (UTC-5)
                            const fechaUTC = new Date(item.fechaAtencion);
                            const offsetColombia = -5 * 60; // Colombia UTC-5 en minutos
                            const offsetLocal = fechaUTC.getTimezoneOffset(); // Offset del servidor
                            const fechaColombia = new Date(fechaUTC.getTime() + (offsetLocal + offsetColombia) * 60000);

                            const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
                            const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

                            const diaSemana = diasSemana[fechaColombia.getDay()];
                            const dia = fechaColombia.getDate();
                            const mes = meses[fechaColombia.getMonth()];

                            fechaFormateada = `${diaSemana} ${dia} de ${mes}`;

                            const horas = fechaColombia.getHours().toString().padStart(2, '0');
                            const minutos = fechaColombia.getMinutes().toString().padStart(2, '0');
                            horaFormateada = `${horas}:${minutos}`;
                        }

                        variables = {
                            "1": nombreCompleto,
                            "2": fechaFormateada,
                            "3": horaFormateada,
                            "4": item._id
                        };
                    }

                    // Enviar mensaje usando template de Twilio
                    const resultWhatsApp = await sendWhatsAppMessage(telefonoCompleto, null, variables, templateSid);

                    if (!resultWhatsApp.success) {
                        throw new Error(resultWhatsApp.error || 'Error al enviar WhatsApp');
                    }
                }

                // Solo actualizar linkEnviado si es primer envío
                if (tipoMensaje !== 'segundo-envio' && tipoMensaje !== 'emergencia') {
                    await pool.query(`
                        UPDATE "HistoriaClinica"
                        SET "linkEnviado" = 'ENVIADO'
                        WHERE "_id" = $1
                    `, [item._id]);
                }

                // Crear/actualizar conversación WhatsApp
                const telefonoConPrefijo = normalizarTelefonoConPrefijo57(telefonoCompleto);

                try {
                    const convExistente = await pool.query(
                        'SELECT id FROM conversaciones_whatsapp WHERE celular = $1',
                        [telefonoConPrefijo]
                    );

                    if (convExistente.rows.length > 0) {
                        await pool.query(
                            `UPDATE conversaciones_whatsapp
                            SET "stopBot" = true, fecha_ultima_actividad = NOW()
                            WHERE celular = $1`,
                            [telefonoConPrefijo]
                        );
                    } else {
                        await pool.query(
                            `INSERT INTO conversaciones_whatsapp
                            (celular, nombre_paciente, estado, "stopBot", fecha_ultima_actividad)
                            VALUES ($1, $2, 'cerrada', true, NOW())`,
                            [telefonoConPrefijo, nombreCompleto || 'Paciente SIIGO']
                        );
                    }
                } catch (whatsappError) {
                    console.log('⚠️ Error al gestionar conversación WhatsApp:', whatsappError.message);
                }

                // Agregar a agenda programada
                let fechaHoraTexto = "Sin fecha asignada";
                if (item.fechaAtencion) {
                    // Convertir a hora de Colombia (UTC-5)
                    const fechaUTC = new Date(item.fechaAtencion);
                    const offsetColombia = -5 * 60; // Colombia UTC-5 en minutos
                    const offsetLocal = fechaUTC.getTimezoneOffset(); // Offset del servidor
                    const fechaColombia = new Date(fechaUTC.getTime() + (offsetLocal + offsetColombia) * 60000);

                    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
                    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

                    const diaSemana = diasSemana[fechaColombia.getDay()];
                    const dia = fechaColombia.getDate();
                    const mes = meses[fechaColombia.getMonth()];
                    const horas = fechaColombia.getHours().toString().padStart(2, '0');
                    const minutos = fechaColombia.getMinutes().toString().padStart(2, '0');

                    fechaHoraTexto = `${diaSemana} ${dia} de ${mes} - ${horas}:${minutos}`;
                }

                resultados.agendaProgramada.push({
                    nombre: nombrePaciente,
                    fechaHora: fechaHoraTexto,
                    ciudad: item.ciudad || "Sin ciudad"
                });

                resultados.enviados++;
                console.log(`✅ ${i + 1}/${registros.length} - Enviado a ${nombrePaciente}`);

                // Pausa de 3 segundos entre mensajes
                if (i < registros.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }

            } catch (error) {
                resultados.errores++;
                resultados.detalles.push({
                    nombre: `${item.primerNombre || ""} ${item.primerApellido || ""}`.trim(),
                    numeroId: item.numeroId,
                    celular: item.celular,
                    error: error.message
                });
                console.error(`❌ Error enviando a ${item.primerNombre}:`, error.message);
            }
        }

        console.log(`📊 Envío masivo completado: ${resultados.enviados}/${resultados.total} exitosos`);

        res.json({
            success: true,
            message: 'Envío masivo completado',
            resultados: resultados
        });
    } catch (error) {
        console.error('❌ Error en envío masivo:', error);
        res.status(500).json({
            success: false,
            message: 'Error en envío masivo',
            error: error.message
        });
    }
});

// POST - Marcar registros como enviados (sin enviar mensaje)
router.post('/marcar-enviados', async (req, res) => {
    try {
        const { registros } = req.body;

        if (!registros || !Array.isArray(registros) || registros.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere un array de registros con sus _id'
            });
        }

        // Extraer los IDs
        const ids = registros.map(r => r._id).filter(id => id);

        if (ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No se encontraron IDs válidos'
            });
        }

        // Actualizar todos los registros
        const result = await pool.query(`
            UPDATE "HistoriaClinica"
            SET "linkEnviado" = 'ENVIADO'
            WHERE "_id" = ANY($1::text[])
        `, [ids]);

        console.log(`✅ ${result.rowCount} registros marcados como ENVIADO`);

        res.json({
            success: true,
            message: `${result.rowCount} registros marcados como enviados`,
            actualizados: result.rowCount
        });
    } catch (error) {
        console.error('❌ Error marcando registros como enviados:', error);
        res.status(500).json({
            success: false,
            message: 'Error al marcar registros',
            error: error.message
        });
    }
});

// NOTE: /enviar-manual moved to src/routes/whatsapp.js (mounted at /api/whatsapp)

console.log('✅ Endpoints Envío SIIGO configurados');

module.exports = router;
