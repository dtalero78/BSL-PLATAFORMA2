const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { normalizarTelefonoConPrefijo57 } = require('../helpers/phone');
const { sendWhatsAppMessage, sendWhatsAppFreeText, guardarMensajeSaliente } = require('../services/whatsapp');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

// ========== CONSULTA PÚBLICA DE ÓRDENES ==========
// POST /api/consulta-ordenes - Buscar órdenes por número de documento y celular
router.post('/consulta-ordenes', async (req, res) => {
    try {
        const { numeroDocumento, celular } = req.body;

        if (!numeroDocumento || !celular) {
            return res.status(400).json({
                success: false,
                message: 'Número de documento y celular son requeridos'
            });
        }

        // Buscar órdenes en HistoriaClinica
        const ordenesResult = await pool.query(`
            SELECT
                "_id",
                "primerNombre",
                "segundoNombre",
                "primerApellido",
                "segundoApellido",
                "numeroId",
                "celular",
                "empresa",
                "codEmpresa",
                "cargo",
                "fechaAtencion",
                "fechaConsulta",
                "examenes",
                "atendido",
                "mdConceptoFinal",
                "_createdDate"
            FROM "HistoriaClinica"
            WHERE "numeroId" = $1 AND "celular" = $2
            ORDER BY "_createdDate" DESC
        `, [numeroDocumento, celular]);

        if (ordenesResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No se encontraron órdenes con los datos proporcionados'
            });
        }

        // Para cada orden, obtener el estado de las pruebas
        const ordenesConEstado = await Promise.all(
            ordenesResult.rows.map(async (orden) => {
                const examenesRequeridos = orden.examenes || '';
                const examLower = examenesRequeridos.toLowerCase();

                // Verificar formulario
                let formularioResult = await pool.query(
                    'SELECT id FROM formularios WHERE wix_id = $1',
                    [orden._id]
                );
                if (formularioResult.rows.length === 0 && orden.numeroId) {
                    formularioResult = await pool.query(
                        'SELECT id FROM formularios WHERE numero_id = $1',
                        [orden.numeroId]
                    );
                }
                const tieneFormulario = formularioResult.rows.length > 0;

                // Verificar audiometría
                const audioResult = await pool.query(
                    'SELECT id FROM audiometrias WHERE orden_id = $1',
                    [orden._id]
                );
                const tieneAudiometria = audioResult.rows.length > 0;

                // Verificar pruebas ADC
                const adcResult = await pool.query(
                    'SELECT id FROM "pruebasADC" WHERE orden_id = $1',
                    [orden._id]
                );
                const tieneADC = adcResult.rows.length > 0;

                // Verificar visiometría
                const visioResult = await pool.query(
                    'SELECT id FROM visiometrias WHERE orden_id = $1',
                    [orden._id]
                );
                const visioVirtualResult = await pool.query(
                    'SELECT id FROM visiometrias_virtual WHERE orden_id = $1',
                    [orden._id]
                );
                const tieneVisiometria = visioResult.rows.length > 0 || visioVirtualResult.rows.length > 0;

                // Determinar qué pruebas son requeridas
                const requiereAudiometria = examLower.includes('audiometr');
                const requiereVisiometria = examLower.includes('visiometr') || examLower.includes('optometr');
                const requiereADC = true;

                return {
                    _id: orden._id,
                    primerNombre: orden.primerNombre,
                    segundoNombre: orden.segundoNombre,
                    primerApellido: orden.primerApellido,
                    segundoApellido: orden.segundoApellido,
                    numeroId: orden.numeroId,
                    celular: orden.celular,
                    empresa: orden.empresa,
                    codEmpresa: orden.codEmpresa,
                    cargo: orden.cargo,
                    fechaAtencion: orden.fechaAtencion,
                    fechaConsulta: orden.fechaConsulta,
                    examenes: orden.examenes,
                    atendido: orden.atendido,
                    mdConceptoFinal: orden.mdConceptoFinal,
                    fechaCreacion: orden._createdDate,
                    estadoPruebas: {
                        formulario: {
                            completado: tieneFormulario,
                            requerido: true
                        },
                        audiometria: {
                            completado: tieneAudiometria,
                            requerido: requiereAudiometria
                        },
                        visiometria: {
                            completado: tieneVisiometria,
                            requerido: requiereVisiometria
                        },
                        adc: {
                            completado: tieneADC,
                            requerido: requiereADC
                        }
                    }
                };
            })
        );

        res.json({
            success: true,
            ordenes: ordenesConEstado
        });

    } catch (error) {
        console.error('Error consultando ordenes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al consultar órdenes'
        });
    }
});

// Enviar link de prueba por WhatsApp
router.post('/enviar-link-prueba', async (req, res) => {
    try {
        const { ordenId, tipoPrueba } = req.body;

        if (!ordenId || !tipoPrueba) {
            return res.status(400).json({ success: false, message: 'ordenId y tipoPrueba son requeridos' });
        }

        // Obtener datos del paciente incluyendo empresa
        const ordenResult = await pool.query(
            'SELECT "primerNombre", "primerApellido", "celular", "numeroId", "empresa", "codEmpresa" FROM "HistoriaClinica" WHERE "_id" = $1',
            [ordenId]
        );

        if (ordenResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Orden no encontrada' });
        }

        const paciente = ordenResult.rows[0];
        const nombreCompleto = `${paciente.primerNombre || 'Paciente'} ${paciente.primerApellido || ''}`.trim();
        const celular = paciente.celular;
        const nombreEmpresa = paciente.empresa || paciente.codEmpresa || 'BSL';

        if (!celular) {
            return res.status(400).json({ success: false, message: 'El paciente no tiene número de celular registrado' });
        }

        // Normalizar teléfono a formato 57XXXXXXXXXX
        const telefonoCompleto = normalizarTelefonoConPrefijo57(celular);

        if (!telefonoCompleto) {
            return res.status(400).json({ success: false, message: 'Número de teléfono inválido' });
        }

        // Determinar template SID y nombre de prueba según tipo
        let templateSid = '';
        let nombrePrueba = '';

        switch (tipoPrueba) {
            case 'formulario':
                templateSid = 'HX2e0e080abd0a3a13676a7ee377487dcd'; // link_formulario
                nombrePrueba = 'Formulario Médico';
                break;
            case 'adc':
                templateSid = 'HXf82ef26b43318e958fd0c319932e3b68'; // link_pruebas_adc
                nombrePrueba = 'Pruebas Psicotécnicas ADC';
                break;
            case 'audiometria':
                templateSid = 'HX7e42d815979b97199f3bc9602520ce4a'; // link_audiometria
                nombrePrueba = 'Audiometría Virtual';
                break;
            case 'visiometria':
                templateSid = 'HX932c80997c064594a79bffa03a4777e5'; // link_visuales
                nombrePrueba = 'Prueba Visual';
                break;
            default:
                return res.status(400).json({ success: false, message: 'Tipo de prueba no válido' });
        }

        // Variables del template:
        // {{1}} = Nombre completo del paciente
        // {{2}} = ordenId (_id de la orden)
        // {{3}} = Nombre de la empresa
        const variables = {
            "1": nombreCompleto,
            "2": ordenId,
            "3": nombreEmpresa
        };

        // Enviar mensaje por WhatsApp usando template de Twilio
        const resultWhatsApp = await sendWhatsAppMessage(
            telefonoCompleto,
            null, // No hay mensaje de texto libre
            variables,
            templateSid
        );

        if (!resultWhatsApp.success) {
            console.error(`Error al enviar link de ${tipoPrueba}:`, resultWhatsApp.error);
            return res.status(500).json({
                success: false,
                message: `No se pudo enviar el mensaje: ${resultWhatsApp.error}`
            });
        }

        console.log(`Link de ${tipoPrueba} enviado a ${telefonoCompleto} para orden ${ordenId}`);

        // Guardar mensaje en la base de datos para que aparezca en twilio-chat.html
        try {
            const contenidoMensaje = `Link de ${nombrePrueba} enviado para ${nombreEmpresa}`;
            const twilioSid = resultWhatsApp.sid || `template_${Date.now()}`;

            await guardarMensajeSaliente(
                telefonoCompleto,
                contenidoMensaje,
                twilioSid,
                'template', // tipo de mensaje
                null, // sin mediaUrl
                null, // sin mediaType
                nombreCompleto // nombre del paciente
            );

            console.log(`Mensaje guardado en conversacion para ${telefonoCompleto}`);
        } catch (dbError) {
            console.error('Error al guardar mensaje en BD:', dbError.message);
            // No bloqueamos la respuesta si falla el guardado
        }

        res.json({
            success: true,
            message: `Link de ${nombrePrueba} enviado correctamente`,
            enviado: {
                telefono: telefonoCompleto,
                prueba: tipoPrueba,
                template: templateSid,
                variables: variables
            }
        });

    } catch (error) {
        console.error('Error enviando link de prueba:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Enviar link de certificado por WhatsApp desde conversación
router.post('/enviar-certificado-whatsapp', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { conversacionId } = req.body;

        if (!conversacionId) {
            return res.status(400).json({ success: false, message: 'conversacionId es requerido' });
        }

        // Obtener número de teléfono de la conversación
        const convResult = await pool.query(
            'SELECT celular FROM conversaciones_whatsapp WHERE id = $1',
            [conversacionId]
        );

        if (convResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Conversación no encontrada' });
        }

        const numeroCliente = convResult.rows[0].celular;

        if (!numeroCliente) {
            return res.status(400).json({ success: false, message: 'La conversación no tiene número de teléfono' });
        }

        // Buscar paciente por número de celular (normalizado)
        const numeroLimpio = numeroCliente.replace(/\s+/g, '').replace(/[^0-9]/g, '');
        const numeroSin57 = numeroLimpio.startsWith('57') ? numeroLimpio.substring(2) : numeroLimpio;

        const pacienteResult = await pool.query(
            `SELECT "_id", "primerNombre" FROM "HistoriaClinica"
             WHERE REPLACE(REPLACE("celular", ' ', ''), '+57', '') = $1
             OR REPLACE(REPLACE("celular", ' ', ''), '+', '') = $2
             LIMIT 1`,
            [numeroSin57, numeroLimpio]
        );

        if (pacienteResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'No se encontró paciente con ese número de teléfono' });
        }

        const paciente = pacienteResult.rows[0];
        const primerNombre = paciente.primerNombre || 'Paciente';
        const pacienteId = paciente._id;

        // Construir link de solicitar certificado
        const link = `https://bsl-utilidades-yp78a.ondigitalocean.app/static/solicitar-certificado.html?id=${pacienteId}`;

        // Construir mensaje
        const mensaje = `Hola ${primerNombre}, puedes solicitar tu certificado médico aquí:\n\n${link}\n\n_BSL - Salud Ocupacional_`;

        // Enviar mensaje por WhatsApp
        const twilioResult = await sendWhatsAppFreeText(numeroCliente, mensaje);

        if (!twilioResult.success) {
            return res.status(500).json({
                success: false,
                message: 'Error al enviar mensaje por WhatsApp',
                error: twilioResult.error
            });
        }

        console.log(`Link de certificado enviado a ${numeroCliente} para paciente ${pacienteId}`);

        res.json({
            success: true,
            message: 'Link de certificado enviado correctamente',
            enviado: {
                telefono: numeroCliente,
                pacienteId: pacienteId,
                link: link
            }
        });

    } catch (error) {
        console.error('Error enviando link de certificado:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
