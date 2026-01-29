const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { normalizarTelefonoConPrefijo57 } = require('../helpers/phone');

// ========== ENDPOINTS ENVÍO AGENDAMIENTO EMPRESAS ==========

// GET - Obtener lista de empresas activas
router.get('/empresas', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT cod_empresa, empresa
            FROM empresas
            WHERE activo = true
            ORDER BY empresa
        `);

        console.log(`📋 Empresas activas: ${result.rows.length}`);

        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        console.error('❌ Error obteniendo empresas:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener empresas',
            error: error.message
        });
    }
});

// GET - Obtener registros pendientes de una empresa
router.get('/registros', async (req, res) => {
    try {
        const { codEmpresa } = req.query;

        if (!codEmpresa) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere el parámetro codEmpresa'
            });
        }

        // Cargar registros con linkEnviado vacío (NULL o '')
        const query = `
            SELECT
                h."_id",
                h."primerNombre",
                h."segundoNombre",
                h."primerApellido",
                h."segundoApellido",
                h."numeroId",
                h."celular",
                h."ciudad",
                h."fechaAtencion",
                h."linkEnviado",
                h."codEmpresa",
                h."_createdDate",
                h."medicoAsignado",
                e.empresa
            FROM "HistoriaClinica" h
            LEFT JOIN empresas e ON h."codEmpresa" = e.cod_empresa
            WHERE h."codEmpresa" = $1
            AND (h."linkEnviado" IS NULL OR h."linkEnviado" = '')
            ORDER BY h."_createdDate" DESC
            LIMIT 500
        `;

        const result = await pool.query(query, [codEmpresa]);

        console.log(`📋 Registros ${codEmpresa}: ${result.rows.length} encontrados`);

        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        console.error('❌ Error obteniendo registros:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener registros',
            error: error.message
        });
    }
});

// POST - Enviar mensaje individual de WhatsApp
router.post('/enviar-individual', async (req, res) => {
    try {
        const { _id, primerNombre, segundoNombre, primerApellido, celular, numeroId, fechaAtencion, empresa } = req.body;

        if (!_id || !celular || !empresa) {
            return res.status(400).json({
                success: false,
                message: 'Se requieren campos: _id, celular, empresa'
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

        // Template para empresas (genérico con nombre de empresa)
        const templateSid = 'HX0543baad49bc2fd29d8262b790a62f69';

        // Formatear fecha y hora si existe (convertir a hora de Colombia UTC-5)
        let fechaFormateada = "fecha pendiente";
        let horaFormateada = "hora pendiente";

        if (fechaAtencion) {
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

        // Variables del template
        const variables = {
            "1": nombreCompleto,        // Nombre del paciente
            "2": empresa,               // Nombre de la empresa
            "3": fechaFormateada,       // Fecha de la cita
            "4": horaFormateada,        // Hora de la cita
            "5": _id                    // ID para el botón del formulario
        };

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
                    [telefonoConPrefijo, nombreCompleto || `Paciente ${empresa}`]
                );
            }
        } catch (whatsappError) {
            console.log('⚠️ Error al gestionar conversación WhatsApp:', whatsappError.message);
        }

        console.log(`✅ WhatsApp enviado a ${nombreCompleto} - ${empresa} (${telefonoCompleto})`);

        res.json({
            success: true,
            message: 'Mensaje enviado exitosamente',
            data: {
                telefono: telefonoCompleto,
                nombre: nombreCompleto,
                empresa: empresa
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
        const { registros } = req.body;

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

        const templateSid = 'HX0543baad49bc2fd29d8262b790a62f69';

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

                // Formatear fecha y hora
                let fechaFormateada = "fecha pendiente";
                let horaFormateada = "hora pendiente";

                if (item.fechaAtencion) {
                    const fechaUTC = new Date(item.fechaAtencion);
                    const offsetColombia = -5 * 60;
                    const offsetLocal = fechaUTC.getTimezoneOffset();
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

                // Variables del template
                const variables = {
                    "1": nombreCompleto,
                    "2": item.empresa || "la empresa",
                    "3": fechaFormateada,
                    "4": horaFormateada,
                    "5": item._id
                };

                // Enviar mensaje usando template de Twilio
                const resultWhatsApp = await sendWhatsAppMessage(telefonoCompleto, null, variables, templateSid);

                if (!resultWhatsApp.success) {
                    throw new Error(resultWhatsApp.error || 'Error al enviar WhatsApp');
                }

                // Actualizar linkEnviado
                await pool.query(`
                    UPDATE "HistoriaClinica"
                    SET "linkEnviado" = 'ENVIADO'
                    WHERE "_id" = $1
                `, [item._id]);

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
                            [telefonoConPrefijo, nombreCompleto || `Paciente ${item.empresa}`]
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
                    empresa: item.empresa || "N/A",
                    fechaHora: fechaHoraTexto,
                    ciudad: item.ciudad || "Sin ciudad"
                });

                resultados.enviados++;
                console.log(`✅ ${i + 1}/${registros.length} - Enviado a ${nombrePaciente} (${item.empresa})`);

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
                    empresa: item.empresa,
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

        const ids = registros.map(r => r._id).filter(id => id);

        if (ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No se encontraron IDs válidos'
            });
        }

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

console.log('✅ Endpoints Envío Agendamiento Empresas configurados');

module.exports = router;
