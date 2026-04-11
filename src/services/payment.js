const pool = require('../config/database');
const { sendWhatsAppMessage, sendWhatsAppFreeText } = require('./whatsapp');
const { sendWhapiMessage } = require('./whapi');
const OpenAI = require('openai');

// Lazy init para evitar error si falta API key al cargar módulo
let _openai;
function getOpenAI() {
    if (!_openai) {
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}
const openai = new Proxy({}, { get: (_, prop) => getOpenAI()[prop] });

// Estados del flujo de pagos
const ESTADO_ESPERANDO_DOCUMENTO = 'esperando_documento';

// Maps de estado compartidos (importados directamente de bot.js)
const {
    estadoPagos,
    estadoConversacion,
    MODO_PAGO,
    MODO_BOT,
    MODO_HUMANO
} = require('./bot');

/**
 * Clasifica una imagen usando OpenAI Vision API
 * @param {string} base64Image - Imagen en base64
 * @param {string} mimeType - Tipo MIME de la imagen (image/jpeg, image/png, etc.)
 * @returns {Promise<string>} - Clasificación: 'comprobante_pago', 'listado_examenes', 'certificado_medico', 'otra_imagen', 'error'
 */
async function clasificarImagen(base64Image, mimeType) {
    try {
        const systemPrompt = `Eres un clasificador de imágenes especializado en identificar comprobantes de pago.

IMPORTANTE: Solo clasifica como "comprobante_pago" si hay evidencia CLARA de una transacción financiera completada.

COMPROBANTE DE PAGO (comprobante_pago):
- Capturas de transferencias bancarias con monto y fecha
- Screenshots de PSE, Nequi, Daviplata, Bancolombia mostrando "Transferencia exitosa"
- Recibos de pago con sello o confirmación
- Pantallas que muestren "Pago aprobado" o similar

NO CLASIFICAR COMO COMPROBANTE (usar "otra_imagen"):
- Fotos de cédulas o documentos de identidad
- Screenshots de conversaciones o chat
- Capturas de formularios sin confirmación de pago
- Imágenes de números o códigos sin contexto de pago
- Fotos borrosas o poco claras
- Certificados médicos o documentos personales

LISTADO DE EXÁMENES (listado_examenes):
- Documentos médicos con lista de procedimientos
- Órdenes médicas laborales con membrete de empresa

Responde SOLO con: comprobante_pago, listado_examenes, u otra_imagen

NO AGREGUES EXPLICACIONES NI PUNTUACIÓN ADICIONAL.`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Clasifica esta imagen:'
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${mimeType};base64,${base64Image}`,
                                detail: 'low'
                            }
                        }
                    ]
                }
            ],
            max_tokens: 50,
            temperature: 0.1
        });

        const clasificacion = response.choices[0].message.content.trim().toLowerCase();
        console.log(`🔍 Clasificación de imagen: ${clasificacion}`);

        return clasificacion;
    } catch (error) {
        console.error('❌ Error clasificando imagen con OpenAI:', error);
        return 'error';
    }
}

/**
 * Valida si un texto es un número de documento válido
 * @param {string} texto - Texto a validar
 * @returns {boolean} - true si es documento válido
 */
function esCedula(texto) {
    const numero = texto.trim();
    return /^\d{6,10}$/.test(numero);
}

/**
 * Marca un registro en HistoriaClinica como pagado
 * @param {string} numeroDocumento - Número de cédula del paciente
 * @returns {Promise<object>} - Resultado con success, data o error
 */
async function marcarPagadoHistoriaClinica(numeroDocumento) {
    try {
        const result = await pool.query(`
            UPDATE "HistoriaClinica"
            SET
                "pagado" = true,
                "pvEstado" = 'Pagado',
                fecha_pago = NOW()
            WHERE "numeroId" = $1
            RETURNING _id, "numeroId", "primerNombre", "primerApellido", "pagado", "pvEstado", fecha_pago
        `, [numeroDocumento]);

        if (result.rows.length > 0) {
            console.log(`✅ Pago marcado en HistoriaClinica para documento: ${numeroDocumento}`);
            return {
                success: true,
                data: result.rows[0]
            };
        } else {
            console.log(`⚠️ No se encontró registro en HistoriaClinica para documento: ${numeroDocumento}`);
            return {
                success: false,
                message: 'No se encontró el registro en la base de datos'
            };
        }
    } catch (error) {
        console.error('❌ Error marcando pago en HistoriaClinica:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Procesa el flujo completo de validación de pagos
 * @param {object} message - Mensaje parseado de Twilio
 * @param {string} from - Número del usuario en formato whatsapp:+573XXXXXXXXX
 * @returns {Promise<string>} - Mensaje de respuesta para el usuario
 */
async function procesarFlujoPagos(message, from) {
    try {
        const messageText = (message.Body || '').trim();
        const numMedia = parseInt(message.NumMedia) || 0;
        const estadoPago = estadoPagos.get(from);

        console.log(`📸 Procesando flujo de pagos - Usuario: ${from}, Media: ${numMedia}, Estado: ${estadoPago ? estadoPago.estado : 'sin estado'}`);

        // Caso 1: Usuario envía IMAGEN (nueva)
        if (numMedia > 0) {
            const mediaUrl = message.MediaUrl0;
            const mediaType = message.MediaContentType0 || 'image/jpeg';

            // Descargar imagen desde Twilio
            console.log(`⬇️ [PASO 1/4] Descargando imagen desde Twilio: ${mediaUrl}`);

            const axios = require('axios');
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;

            console.log(`⬇️ [PASO 1/4] Iniciando descarga con axios...`);
            console.log(`⬇️ [PASO 1/4] URL: ${mediaUrl}`);

            let imageResponse;
            let lastError;
            const maxRetries = 3;
            const retryDelays = [1000, 2000, 3000];

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    if (attempt > 0) {
                        console.log(`⏳ [PASO 1/4] Reintento ${attempt + 1}/${maxRetries} después de ${retryDelays[attempt - 1]}ms...`);
                        await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]));
                    }

                    imageResponse = await axios.get(mediaUrl, {
                        auth: {
                            username: accountSid,
                            password: authToken
                        },
                        responseType: 'arraybuffer',
                        timeout: 60000
                    });

                    break;
                } catch (downloadError) {
                    lastError = downloadError;
                    console.error(`❌ [PASO 1/4] Intento ${attempt + 1}/${maxRetries} falló:`, downloadError.message);
                    console.error(`❌ [PASO 1/4] Status: ${downloadError.response?.status}`);

                    if (downloadError.response?.status === 404 && attempt < maxRetries - 1) {
                        console.log(`⏳ [PASO 1/4] 404 detectado - Twilio puede estar procesando la imagen, reintentando...`);
                        continue;
                    }

                    if (downloadError.code === 'ECONNABORTED' || downloadError.code === 'ETIMEDOUT') {
                        break;
                    }

                    if (attempt === maxRetries - 1) {
                        break;
                    }
                }
            }

            if (!imageResponse) {
                console.error(`❌ [PASO 1/4] Error después de ${maxRetries} intentos:`, lastError.message);

                if (lastError.response?.status === 404) {
                    await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                        '⚠️ No pude acceder a la imagen que enviaste después de varios intentos.\n\n' +
                        'Posibles causas:\n' +
                        '• La imagen aún se está procesando en WhatsApp\n' +
                        '• Problema temporal con el servidor\n\n' +
                        'Por favor:\n' +
                        '1. Espera 30 segundos y envía el comprobante nuevamente\n' +
                        '2. O contacta a un asesor para registrar tu pago manualmente');

                    console.log(`❌ [PASO 1/4] Imagen no disponible (404) después de ${maxRetries} intentos`);
                    return 'Imagen no disponible en Twilio';
                } else if (lastError.code === 'ECONNABORTED' || lastError.code === 'ETIMEDOUT') {
                    await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                        '⏱️ La descarga de tu imagen tardó demasiado.\n\nPor favor envía una imagen más pequeña o contacta a un asesor.');

                    console.log(`❌ [PASO 1/4] Timeout descargando imagen (${lastError.code})`);
                    return 'Timeout descargando imagen';
                } else {
                    throw lastError;
                }
            }

            console.log(`✅ [PASO 1/4] Imagen descargada: ${(imageResponse.data.length / 1024).toFixed(1)} KB`);

            const base64Image = Buffer.from(imageResponse.data).toString('base64');

            console.log(`🔍 [PASO 2/4] Clasificando imagen con OpenAI...`);
            const clasificacion = await clasificarImagen(base64Image, mediaType);
            console.log(`✅ [PASO 2/4] Clasificación completada: ${clasificacion}`);

            console.log(`🔀 [PASO 3/4] Procesando clasificación: ${clasificacion}`);
            if (clasificacion === 'comprobante_pago') {
                estadoConversacion.set(from, MODO_PAGO);

                console.log(`💬 [PASO 4/4] Solicitando número de cédula...`);
                await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                    '💳 Perfecto, recibí tu comprobante de pago.\n\n📝 Por favor envía tu número de cédula para registrar el pago.');

                estadoPagos.set(from, {
                    estado: ESTADO_ESPERANDO_DOCUMENTO,
                    timestamp: Date.now()
                });

                console.log(`✅ [PASO 4/4] MODO_PAGO activado para ${from.replace('whatsapp:', '')} - Esperando documento`);
                return 'Esperando documento';
            }
            else {
                console.log(`📸 Imagen clasificada como "${clasificacion}" - no se procesa automáticamente`);
                return 'Imagen no procesada';
            }
        }

        // Caso 2: Usuario envía TEXTO (documento) con flujo activo
        const estadoActivo = estadoPago && estadoPago.estado === ESTADO_ESPERANDO_DOCUMENTO;
        if (messageText && estadoActivo) {
            console.log(`📝 [ESPERANDO_DOCUMENTO] Usuario envió: "${messageText}"`);
            const documento = messageText.trim();

            console.log(`🔍 [ESPERANDO_DOCUMENTO] Validando formato de documento...`);
            if (!esCedula(documento)) {
                console.log(`❌ [ESPERANDO_DOCUMENTO] Formato de documento inválido`);
                await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                    'Por favor envía solo números, sin puntos ni guiones.\n\nEjemplo: 1234567890');
                return 'Documento inválido';
            }

            console.log(`🔍 [ESPERANDO_DOCUMENTO] Buscando paciente con documento: ${documento}`);
            const pacienteExiste = await pool.query(
                `SELECT _id, "primerNombre", "primerApellido", "numeroId", atendido
                 FROM "HistoriaClinica"
                 WHERE "numeroId" = $1
                 ORDER BY "_createdDate" DESC
                 LIMIT 1`,
                [documento]
            );
            console.log(`✅ [ESPERANDO_DOCUMENTO] Query completada: ${pacienteExiste.rows.length} resultados`);

            if (pacienteExiste.rows.length === 0) {
                estadoPagos.delete(from);
                estadoConversacion.set(from, MODO_BOT);
                await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                    `❌ No encontramos ningún paciente con cédula ${documento} en nuestro sistema.\n\n¿Deseas agendar un examen? Escribe "agendar" para comenzar.`);
                console.log(`🤖 MODO_BOT restaurado para ${from.replace('whatsapp:', '')} - Documento no encontrado`);
                return 'Documento no encontrado';
            }

            const paciente = pacienteExiste.rows[0];

            console.log(`⏳ [ESPERANDO_DOCUMENTO] Procesando pago para documento: ${documento}`);

            await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                `⏳ Procesando pago para ${paciente.primerNombre} ${paciente.primerApellido}...`);

            console.log(`💾 [ESPERANDO_DOCUMENTO] Marcando como pagado en BD...`);
            const resultado = await marcarPagadoHistoriaClinica(documento);
            console.log(`✅ [ESPERANDO_DOCUMENTO] Resultado de marcarPagadoHistoriaClinica: success=${resultado.success}`);

            if (resultado.success) {
                const data = resultado.data;
                const nombre = `${data.primerNombre || ''} ${data.primerApellido || ''}`.trim();

                estadoPagos.delete(from);
                estadoConversacion.set(from, MODO_HUMANO);

                await pool.query(`
                    UPDATE conversaciones_whatsapp
                    SET bot_activo = false
                    WHERE celular = $1
                `, [from.replace('whatsapp:', '')]);

                await pool.query(`
                    UPDATE mensajes_whatsapp m
                    SET leido_por_agente = true,
                        fecha_lectura = NOW()
                    FROM conversaciones_whatsapp c
                    WHERE m.conversacion_id = c.id
                    AND c.celular = $1
                    AND m.direccion = 'entrante'
                    AND m.leido_por_agente = false
                `, [from.replace('whatsapp:', '')]);

                let mensajeConfirmacion;
                if (paciente.atendido === 'PENDIENTE') {
                    mensajeConfirmacion = `✅ *¡Pago registrado exitosamente!*\n\n👤 ${nombre}\n📄 Documento: ${documento}\n\n💰 Tu pago ha sido validado y guardado.\n\n⚠️ *Importante:* Debes completar tu examen médico. Una vez finalizado, podrás descargar tu certificado.\n\n📋 Un asesor te contactará para coordinar tu cita.\n\nGracias por confiar en BSL.`;
                } else {
                    mensajeConfirmacion = `🎉 *¡Pago registrado exitosamente!*\n\n👤 ${nombre}\n📄 Documento: ${documento}\n\n✅ Tu pago ha sido validado. Puedes descargar tu certificado médico desde:\n\n🔗 https://bsl-utilidades-yp78a.ondigitalocean.app/static/solicitar-certificado.html?id=${paciente._id}\n\nGracias por confiar en BSL.`;
                }

                await sendWhatsAppFreeText(from.replace('whatsapp:', ''), mensajeConfirmacion);

                await pool.query(`
                    UPDATE mensajes_whatsapp m
                    SET leido_por_agente = true,
                        fecha_lectura = NOW()
                    FROM conversaciones_whatsapp c
                    WHERE m.conversacion_id = c.id
                    AND c.celular = $1
                    AND m.direccion = 'entrante'
                    AND m.leido_por_agente = false
                `, [from.replace('whatsapp:', '')]);

                console.log(`✅ Pago procesado exitosamente para ${documento} (${paciente.atendido}) - MODO_HUMANO activado (bot desactivado)`);
                return 'Pago confirmado';
            } else {
                await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                    `❌ No encontré un registro con el documento ${documento}.\n\nVerifica que:\n• El número esté correcto\n• Ya hayas realizado tu examen médico\n\nSi necesitas ayuda, un asesor te contactará pronto.`);

                estadoPagos.delete(from);
                estadoConversacion.set(from, MODO_BOT);
                console.log(`🤖 MODO_BOT restaurado para ${from.replace('whatsapp:', '')} - Documento no encontrado en BD`);
                return 'Documento no encontrado';
            }
        }

        // Caso 3: Texto sin flujo activo -> ignorar (lo procesa el webhook normal)
        return null;

    } catch (error) {
        console.error('❌ Error en procesarFlujoPagos:', error);
        console.error('❌ Error stack:', error.stack);
        console.error('❌ Error name:', error.name);
        console.error('❌ Error message:', error.message);

        try {
            await sendWhatsAppFreeText(from.replace('whatsapp:', ''),
                'Lo siento, hubo un error procesando tu solicitud. Un asesor te contactará pronto.');
        } catch (err) {
            console.error('❌ Error enviando mensaje de error:', err);
        }

        estadoPagos.delete(from);
        estadoConversacion.set(from, MODO_BOT);
        console.log(`🤖 MODO_BOT restaurado para ${from.replace('whatsapp:', '')} - Error en flujo de pagos`);

        return 'Error en flujo de pagos';
    }
}

// Notificar al coordinador de agendamiento sobre nueva orden
async function notificarCoordinadorNuevaOrden(orden) {
    try {
        const modalidadPresencial = !orden.modalidad || orden.modalidad === 'presencial';

        const ciudadNormalizada = orden.ciudad ?
            orden.ciudad.toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            : '';

        const ciudadesExcluidas = ['bogota', 'barranquilla'];
        const ciudadExcluida = ciudadesExcluidas.includes(ciudadNormalizada);

        const empresaExcluida = orden.codEmpresa === 'SANITHELP-JJ';

        if (!modalidadPresencial || ciudadExcluida || empresaExcluida) {
            console.log(`⏭️ No se notifica al coordinador - Modalidad: ${orden.modalidad || 'presencial'}, Ciudad: ${orden.ciudad}, Empresa: ${orden.codEmpresa}`);
            return;
        }

        const coordinadorCelular = process.env.COORDINADOR_CELULAR;

        if (!coordinadorCelular) {
            console.log('⚠️ No hay coordinador configurado para notificaciones');
            return;
        }

        const nombreCompleto = [
            orden.primerNombre,
            orden.segundoNombre,
            orden.primerApellido,
            orden.segundoApellido
        ].filter(Boolean).join(' ');

        const fechaFormateada = orden.fechaAtencion ?
            new Date(orden.fechaAtencion).toLocaleDateString('es-CO', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }) : 'No definida';

        const mensaje = `🆕 *Nueva Orden de Examen*

📋 *Empresa:* ${orden.codEmpresa}
🏥 *Tipo de Examen:* ${orden.tipoExamen || 'No especificado'}

👤 *Paciente:* ${nombreCompleto}
🆔 *Documento:* ${orden.numeroId}
📱 *Celular:* ${orden.celular}
🏙️ *Ciudad:* ${orden.ciudad}

📅 *Fecha programada:* ${fechaFormateada}
⏰ *Hora:* ${orden.horaAtencion || 'No definida'}
🩺 *Modalidad:* ${orden.modalidad === 'presencial' ? 'Presencial' : 'Virtual'}

🆔 *ID Orden:* ${orden._id}`;

        await sendWhatsAppMessage(coordinadorCelular, mensaje);
        console.log('✅ Notificación enviada al coordinador:', coordinadorCelular);
    } catch (error) {
        console.error('❌ Error notificando al coordinador:', error.message);
    }
}

/**
 * Verifica si un número de celular es nuevo (no existe en ninguna tabla)
 * @param {string} numeroCelular - Número de celular a verificar
 * @returns {Promise<boolean>} - true si es nuevo, false si ya existe
 */
async function esUsuarioNuevo(numeroCelular) {
    try {
        let numeroLimpio = numeroCelular.replace(/[^0-9]/g, '');

        if (!numeroLimpio.startsWith('57') && numeroLimpio.length === 10) {
            numeroLimpio = '57' + numeroLimpio;
        }

        // Fix: parameterizar LIKE en vez de template literal (evita SQL injection)
        const celularSufijo = '%' + numeroLimpio.slice(-10) + '%';
        const enHistoria = await pool.query(
            `SELECT "numeroId" FROM "HistoriaClinica" WHERE celular LIKE $1 LIMIT 1`,
            [celularSufijo]
        );

        if (enHistoria.rows.length > 0) {
            console.log('📋 Usuario encontrado en HistoriaClinica');
            return false;
        }

        const enFormularios = await pool.query(
            `SELECT id FROM formularios WHERE celular LIKE $1 LIMIT 1`,
            [celularSufijo]
        );

        if (enFormularios.rows.length > 0) {
            console.log('📋 Usuario encontrado en formularios');
            return false;
        }

        const enWhatsApp = await pool.query(`
            SELECT cw.id
            FROM conversaciones_whatsapp cw
            WHERE cw.celular = $1
            AND (
                SELECT COUNT(*)
                FROM mensajes_whatsapp mw
                WHERE mw.conversacion_id = cw.id
            ) > 2
            LIMIT 1
        `, [numeroCelular]);

        if (enWhatsApp.rows.length > 0) {
            console.log('📋 Usuario con historial en WhatsApp');
            return false;
        }

        console.log('🆕 Usuario nuevo detectado:', numeroCelular);
        return true;

    } catch (error) {
        console.error('❌ Error verificando si es usuario nuevo:', error);
        return false;
    }
}

// Configuración de números de alerta por empresa
const NUMEROS_ALERTA_POR_EMPRESA = {
    "SIIGO": [
        "573008021701",
        "573045792035",
        "573138232201"
    ],
    "MASIN": [
        "573112634312",
        "573008021701"
    ]
};

// Función para enviar alertas de preguntas críticas (para empresas SIIGO y MASIN)
async function enviarAlertasPreguntasCriticas(datos) {
    const numerosAlerta = NUMEROS_ALERTA_POR_EMPRESA[datos.codEmpresa];

    if (!numerosAlerta) {
        console.log('ℹ️ Alertas WhatsApp omitidas - Empresa:', datos.codEmpresa || 'No especificada', '(solo aplica para SIIGO y MASIN)');
        return;
    }

    const alertas = [];

    if (datos.trastornoPsicologico === "SI") {
        alertas.push("🧠 Trastorno psicológico o psiquiátrico diagnosticado");
    }
    if (datos.sintomasPsicologicos === "SI") {
        alertas.push("😰 Síntomas psicológicos en los últimos 2 años (ansiedad, depresión, pánico)");
    }
    if (datos.diagnosticoCancer === "SI") {
        alertas.push("🎗️ Diagnóstico o estudio por sospecha de cáncer");
    }
    if (datos.enfermedadesLaborales === "SI") {
        alertas.push("⚠️ Enfermedades laborales o accidentes de trabajo previos");
    }
    if (datos.enfermedadOsteomuscular === "SI") {
        alertas.push("🦴 Enfermedad osteomuscular diagnosticada");
    }
    if (datos.enfermedadAutoinmune === "SI") {
        alertas.push("🔬 Enfermedad autoinmune diagnosticada");
    }

    if (alertas.length > 0) {
        const nombreCompleto = `${datos.primerNombre || ''} ${datos.primerApellido || ''}`.trim() || 'No especificado';
        const mensaje = `🚨 *ALERTA - Formulario Médico BSL*\n\n` +
            `👤 *Paciente:* ${nombreCompleto}\n` +
            `🆔 *Cédula:* ${datos.numeroId || 'No especificada'}\n` +
            `📱 *Celular:* ${datos.celular || 'No especificado'}\n` +
            `🏢 *Empresa:* ${datos.empresa || 'No especificada'}\n\n` +
            `⚠️ *Condiciones reportadas:*\n${alertas.map(a => `• ${a}`).join('\n')}\n\n` +
            `_Revisar historia clínica antes de la consulta._`;

        console.log('🚨 Enviando alertas de preguntas críticas para empresa', datos.codEmpresa, '...');

        const promesas = numerosAlerta.map(numero => sendWhapiMessage(numero, mensaje));
        await Promise.all(promesas);

        console.log('✅ Alertas enviadas a', numerosAlerta.length, 'números');
    }
}

module.exports = {
    clasificarImagen,
    esCedula,
    marcarPagadoHistoriaClinica,
    procesarFlujoPagos,
    notificarCoordinadorNuevaOrden,
    esUsuarioNuevo,
    enviarAlertasPreguntasCriticas,
    NUMEROS_ALERTA_POR_EMPRESA
};
