// backend/actualizar-resumen.jsw
import wixData from 'wix-data';

export async function actualizarResumenConversacion(_id, resumen) {
    // Primero obtenemos el ítem actual
    const existingItem = await wixData.get("CHATBOT", _id);

    // Luego solo actualizamos el campo 'resumen'
    existingItem.resumen = resumen;

    // Finalmente hacemos el update
    return wixData.update("CHATBOT", existingItem);
}

export async function obtenerHorasOcupadas(fecha) {
    try {
        const inicioDelDia = new Date(`${fecha}T00:00:00.000Z`);
        const finDelDia = new Date(`${fecha}T23:59:59.999Z`);

        const result = await wixData.query("HistoriaClinica")
            .ge("fechaAtencion", inicioDelDia)
            .le("fechaAtencion", finDelDia)
            .find();

        const horasOcupadas = result.items.map(item => {
            const fecha = new Date(item.fechaAtencion);
            const horaColombia = new Date(fecha.getTime() - (5 * 60 * 60 * 1000));
            const hora = horaColombia.toTimeString().slice(0, 5); // formato "HH:MM"

            return {
                _id: item._id,
                hora
            };
        });

        return horasOcupadas;
    } catch (error) {
        console.error("Error consultando horas ocupadas:", error);
        return [];
    }
}

export async function crearRegistroAgente(fechaTexto) {
    try {
        console.log("🕵️‍♂️ Recibido en el backend:", fechaTexto);

        const fechaUTC = new Date(fechaTexto);

        const nuevaFecha = new Date(fechaUTC.getTime() + (5 * 60 * 60 * 1000));

        const nuevoRegistro = {
            fechaAtencion: nuevaFecha,
            atendido: "PENDIENTE",
            medico: "NUBIA"
        };
        console.log("🧾 Registro a insertar:", nuevoRegistro);

        const result = await wixData.insert("HistoriaClinica", nuevoRegistro);
        return { success: true, item: result };
    } catch (error) {
        console.error("❌ Error al crear registro:", error);
        return { success: false, error: error.message };
    }
}

// PERTENECES AL BOT DE DIGITALOCEAN
export async function consultarPorDocumento(numeroId) {
    try {
        const result = await wixData.query("HistoriaClinica")
            .eq("numeroId", numeroId)
            .find();

        const informacion = result.items.map(item => ({
            _id: item._id,
            primerNombre: item.primerNombre,
            primerApellido: item.primerApellido,
            celular: item.celular,
            fechaConsulta: item.fechaConsulta ? item.fechaConsulta.toISOString() : null,
            fechaAtencion: item.fechaAtencion ? item.fechaAtencion.toISOString() : null,
            pvEstado: item.pvEstado,
            atendido: item.atendido,
            empresa: item.empresa,
            codEmpresa: item.codEmpresa
        }));

        return informacion;
    } catch (error) {
        console.error("Error consultando información por numeroId:", error);
        return [];
    }
}

// FUNCIÓN PARA CONSULTAR POR CELULAR (BOT DIGITALOCEAN)
export async function consultarPorCelular(celular) {
    try {
        // Limpiar el número: quitar código de país y caracteres no numéricos
        const celularLimpio = celular.replace(/\D/g, '').replace(/^57/, '');

        const result = await wixData.query("HistoriaClinica")
            .eq("celular", celularLimpio)
            .descending("fechaAtencion") // Obtener el más reciente primero
            .find();

        if (result.items.length === 0) {
            return { success: false, message: "No se encontró paciente con ese celular" };
        }

        // Retornar el registro más reciente
        const item = result.items[0];
        return {
            success: true,
            _id: item._id,
            numeroId: item.numeroId,
            primerNombre: item.primerNombre,
            segundoNombre: item.segundoNombre,
            primerApellido: item.primerApellido,
            segundoApellido: item.segundoApellido,
            celular: item.celular,
            fechaConsulta: item.fechaConsulta ? item.fechaConsulta.toISOString() : null,
            fechaAtencion: item.fechaAtencion ? item.fechaAtencion.toISOString() : null,
            pvEstado: item.pvEstado,
            atendido: item.atendido,
            empresa: item.empresa,
            codEmpresa: item.codEmpresa
        };
    } catch (error) {
        console.error("Error consultando información por celular:", error);
        return { success: false, error: error.message };
    }
}

// FUNCIÓN PARA CREAR NUEVA HISTORIA CLÍNICA (ORDEN)
export async function crearHistoriaClinica(datos) {
    try {
        const result = await wixData.insert("HistoriaClinica", datos);
        return { success: true, item: result };
    } catch (error) {
        console.error("Error creando historia clínica:", error);
        return { success: false, error: error.message };
    }
}

// FUNCIÓN PARA ACTUALIZAR HISTORIA CLÍNICA
export async function actualizarHistoriaClinica(_id, datos) {
    try {
        const existingItem = await wixData.get("HistoriaClinica", _id);

        // Actualizar solo los campos proporcionados
        Object.keys(datos).forEach(key => {
            if (key !== '_id') {
                existingItem[key] = datos[key];
            }
        });

        const result = await wixData.update("HistoriaClinica", existingItem);
        return { success: true, item: result };
    } catch (error) {
        console.error("Error actualizando historia clínica:", error);
        return { success: false, error: error.message };
    }
}

// FUNCIONES PARA EXPONER BASE DE DATOS FORMULARIO
export async function crearFormulario(datos) {
    try {
        const result = await wixData.insert("FORMULARIO", datos);
        return { success: true, item: result };
    } catch (error) {
        console.error("Error creando formulario:", error);
        return { success: false, error: error.message };
    }
}

export async function obtenerFormularios(filtros = {}) {
    try {
        let query = wixData.query("FORMULARIO");

        // Aplicar filtros si existen
        if (filtros.numeroId) {
            query = query.eq("numeroId", filtros.numeroId);
        }
        if (filtros.fechaInicio && filtros.fechaFin) {
            query = query.ge("createdDate", new Date(filtros.fechaInicio))
                         .le("createdDate", new Date(filtros.fechaFin));
        }

        const result = await query.find();
        return { success: true, items: result.items, total: result.totalCount };
    } catch (error) {
        console.error("Error obteniendo formularios:", error);
        return { success: false, error: error.message };
    }
}

export async function obtenerFormularioPorIdGeneral(idGeneral) {
    try {
        const result = await wixData.query("FORMULARIO")
            .eq("idGeneral", idGeneral)
            .find();

        if (result.items.length > 0) {
            return { success: true, item: result.items[0] };
        } else {
            return { success: false, message: "No se encontró formulario con ese idGeneral" };
        }
    } catch (error) {
        console.error("Error obteniendo formulario por idGeneral:", error);
        return { success: false, error: error.message };
    }
}

export async function actualizarFormulario(_id, datos) {
    try {
        const existingItem = await wixData.get("FORMULARIO", _id);
        
        // Actualizar solo los campos proporcionados
        Object.keys(datos).forEach(key => {
            if (key !== '_id') {
                existingItem[key] = datos[key];
            }
        });
        
        const result = await wixData.update("FORMULARIO", existingItem);
        return { success: true, item: result };
    } catch (error) {
        console.error("Error actualizando formulario:", error);
        return { success: false, error: error.message };
    }
}

// FUNCIONES PARA EXPONER BASE DE DATOS AUDIOMETRIA
export async function obtenerAudiometrias(filtros = {}) {
    try {
        let query = wixData.query("AUDIOMETRIA");
        
        // Aplicar filtros si existen
        if (filtros.numeroId) {
            query = query.eq("numeroId", filtros.numeroId);
        }
        if (filtros.fechaInicio && filtros.fechaFin) {
            query = query.ge("createdDate", new Date(filtros.fechaInicio))
                         .le("createdDate", new Date(filtros.fechaFin));
        }
        
        const result = await query.find();
        return { success: true, items: result.items, total: result.totalCount };
    } catch (error) {
        console.error("Error obteniendo audiometrías:", error);
        return { success: false, error: error.message };
    }
}

export async function crearAudiometria(datos) {
    try {
        const result = await wixData.insert("AUDIOMETRIA", datos);
        return { success: true, item: result };
    } catch (error) {
        console.error("Error creando audiometría:", error);
        return { success: false, error: error.message };
    }
}

export async function actualizarAudiometria(_id, datos) {
    try {
        const existingItem = await wixData.get("AUDIOMETRIA", _id);

        // Actualizar solo los campos proporcionados
        Object.keys(datos).forEach(key => {
            if (key !== '_id') {
                existingItem[key] = datos[key];
            }
        });

        const result = await wixData.update("AUDIOMETRIA", existingItem);
        return { success: true, item: result };
    } catch (error) {
        console.error("Error actualizando audiometría:", error);
        return { success: false, error: error.message };
    }
}

// FUNCIONES PARA EXPONER BASE DE DATOS VISUAL
export async function obtenerVisuales(filtros = {}) {
    try {
        let query = wixData.query("VISUAL");
        
        // Aplicar filtros si existen
        if (filtros.numeroId) {
            query = query.eq("numeroId", filtros.numeroId);
        }
        if (filtros.fechaInicio && filtros.fechaFin) {
            query = query.ge("createdDate", new Date(filtros.fechaInicio))
                         .le("createdDate", new Date(filtros.fechaFin));
        }
        
        const result = await query.find();
        return { success: true, items: result.items, total: result.totalCount };
    } catch (error) {
        console.error("Error obteniendo visuales:", error);
        return { success: false, error: error.message };
    }
}

export async function crearVisual(datos) {
    try {
        const result = await wixData.insert("VISUAL", datos);
        return { success: true, item: result };
    } catch (error) {
        console.error("Error creando visual:", error);
        return { success: false, error: error.message };
    }
}

export async function actualizarVisual(_id, datos) {
    try {
        const existingItem = await wixData.get("VISUAL", _id);

        // Actualizar solo los campos proporcionados
        Object.keys(datos).forEach(key => {
            if (key !== '_id') {
                existingItem[key] = datos[key];
            }
        });

        const result = await wixData.update("VISUAL", existingItem);
        return { success: true, item: result };
    } catch (error) {
        console.error("Error actualizando visual:", error);
        return { success: false, error: error.message };
    }
}

// FUNCIONES PARA EXPONER BASE DE DATOS ADCTEST
export async function obtenerAdcTests(filtros = {}) {
    try {
        let query = wixData.query("ADCTEST");
        
        // Aplicar filtros si existen
        if (filtros.numeroId) {
            query = query.eq("numeroId", filtros.numeroId);
        }
        if (filtros.fechaInicio && filtros.fechaFin) {
            query = query.ge("createdDate", new Date(filtros.fechaInicio))
                         .le("createdDate", new Date(filtros.fechaFin));
        }
        
        const result = await query.find();
        return { success: true, items: result.items, total: result.totalCount };
    } catch (error) {
        console.error("Error obteniendo ADC tests:", error);
        return { success: false, error: error.message };
    }
}

export async function crearAdcTest(datos) {
    try {
        const result = await wixData.insert("ADCTEST", datos);
        return { success: true, item: result };
    } catch (error) {
        console.error("Error creando ADC test:", error);
        return { success: false, error: error.message };
    }
}

export async function actualizarAdcTest(_id, datos) {
    try {
        const existingItem = await wixData.get("ADCTEST", _id);

        // Actualizar solo los campos proporcionados
        Object.keys(datos).forEach(key => {
            if (key !== '_id') {
                existingItem[key] = datos[key];
            }
        });

        const result = await wixData.update("ADCTEST", existingItem);
        return { success: true, item: result };
    } catch (error) {
        console.error("Error actualizando ADC test:", error);
        return { success: false, error: error.message };
    }
}

// FUNCIÓN PARA BUSCAR PACIENTES EN HISTORIA CLÍNICA (MEDIDATA)
export async function buscarPacientesMediData(termino) {
    try {
        console.log(`🔍 Buscando pacientes con término: ${termino}`);

        let result;

        // Detectar si parece un documento (números puros, o números con guión/letras como 1234789639-P)
        const esDocumento = /^\d+(-[A-Za-z0-9]+)?$/.test(termino) || /^\d+$/.test(termino);
        const esSoloNumeros = /^\d+$/.test(termino);

        if (esDocumento) {
            // Buscar por numeroId (coincidencia exacta)
            const resultNumeroIdExacto = await wixData.query("HistoriaClinica")
                .eq("numeroId", termino)
                .limit(50)
                .find();

            // También buscar si el término está contenido en numeroId (para IDs alfanuméricos)
            const resultNumeroIdContains = await wixData.query("HistoriaClinica")
                .contains("numeroId", termino)
                .limit(50)
                .find();

            // Si tiene guión, también buscar por la parte numérica antes del guión
            let resultNumeroIdParcial = { items: [] };
            if (termino.includes('-')) {
                const parteNumerica = termino.split('-')[0];
                resultNumeroIdParcial = await wixData.query("HistoriaClinica")
                    .startsWith("numeroId", parteNumerica)
                    .limit(50)
                    .find();
            }

            // Buscar por celular (solo si es puramente numérico)
            let resultCelular = { items: [] };
            if (esSoloNumeros) {
                resultCelular = await wixData.query("HistoriaClinica")
                    .eq("celular", termino)
                    .limit(50)
                    .find();
            }

            // Combinar resultados y eliminar duplicados
            const combinedItems = [
                ...resultNumeroIdExacto.items,
                ...resultNumeroIdContains.items,
                ...resultNumeroIdParcial.items,
                ...resultCelular.items
            ];
            const uniqueItems = Array.from(new Map(combinedItems.map(item => [item._id, item])).values());

            result = {
                items: uniqueItems,
                totalCount: uniqueItems.length
            };
        } else {
            // Si es texto puro, buscar por apellidos
            const resultPrimerApellido = await wixData.query("HistoriaClinica")
                .contains("primerApellido", termino.toUpperCase())
                .limit(50)
                .find();

            const resultSegundoApellido = await wixData.query("HistoriaClinica")
                .contains("segundoApellido", termino.toUpperCase())
                .limit(50)
                .find();

            // Combinar resultados y eliminar duplicados
            const combinedItems = [...resultPrimerApellido.items, ...resultSegundoApellido.items];
            const uniqueItems = Array.from(new Map(combinedItems.map(item => [item._id, item])).values());

            result = {
                items: uniqueItems,
                totalCount: uniqueItems.length
            };
        }

        console.log(`✅ Encontrados ${result.items.length} pacientes`);

        return {
            success: true,
            items: result.items,
            total: result.totalCount
        };
    } catch (error) {
        console.error("❌ Error buscando pacientes:", error);
        return {
            success: false,
            error: error.message
        };
    }
}

// FUNCIÓN PARA OBTENER DATOS COMPLETOS DE UN PACIENTE (MEDIDATA)
export async function obtenerDatosCompletosPaciente(historiaId) {
    try {
        console.log(`📋 Obteniendo datos completos para Historia ID: ${historiaId}`);

        // Obtener datos de HistoriaClinica
        const historiaClinica = await wixData.get("HistoriaClinica", historiaId);

        // Buscar datos en FORMULARIO usando idGeneral
        let formulario = null;
        try {
            const formularioResult = await wixData.query("FORMULARIO")
                .eq("idGeneral", historiaId)
                .find();

            if (formularioResult.items.length > 0) {
                formulario = formularioResult.items[0];
            }
        } catch (err) {
            console.warn("No se encontró formulario para este paciente");
        }

        console.log(`✅ Datos obtenidos - HistoriaClinica: Sí, Formulario: ${formulario ? 'Sí' : 'No'}`);

        return {
            success: true,
            historiaClinica: historiaClinica,
            formulario: formulario
        };
    } catch (error) {
        console.error("❌ Error obteniendo datos completos:", error);
        return {
            success: false,
            error: error.message
        };
    }
}

// FUNCIÓN PARA OBTENER ESTADÍSTICAS DE CONSULTAS POR RANGO DE FECHAS
export async function obtenerEstadisticasConsultas(fechaInicio, fechaFin) {
    try {
        console.log(`📊 Obteniendo estadísticas desde ${fechaInicio} hasta ${fechaFin}`);

        // Crear fechas en hora local de Colombia (UTC-5)
        // Cuando en Colombia son las 00:00:00, en UTC son las 05:00:00
        const inicio = new Date(`${fechaInicio}T00:00:00-05:00`);
        const fin = new Date(`${fechaFin}T23:59:59-05:00`);

        console.log(`🕐 Rango UTC: ${inicio.toISOString()} hasta ${fin.toISOString()}`);

        // Paginación para obtener TODOS los registros (Wix tiene límite de 1000 por query)
        let allItems = [];
        let hasMore = true;
        let skip = 0;
        const pageSize = 1000;

        while (hasMore) {
            const result = await wixData.query("HistoriaClinica")
                .contains("codEmpresa", "SANITHELP-JJ")
                .ge("fechaConsulta", inicio)
                .le("fechaConsulta", fin)
                .limit(pageSize)
                .skip(skip)
                .find();

            allItems = allItems.concat(result.items);
            console.log(`📄 Página obtenida: ${result.items.length} registros (skip: ${skip})`);

            hasMore = result.items.length === pageSize;
            skip += pageSize;

            // Seguridad: evitar loops infinitos
            if (skip > 10000) {
                console.warn("⚠️ Límite de seguridad alcanzado (10000 registros)");
                break;
            }
        }

        console.log(`✅ Total de registros obtenidos: ${allItems.length}`);

        // Agrupar por fecha
        const conteosPorFecha = {};

        allItems.forEach(item => {
            if (item.fechaConsulta) {
                // Convertir la fecha UTC a hora de Colombia (UTC-5)
                const fechaUTC = new Date(item.fechaConsulta);
                const fechaColombia = new Date(fechaUTC.getTime() - (5 * 60 * 60 * 1000));
                const fechaStr = fechaColombia.toISOString().split('T')[0];

                if (!conteosPorFecha[fechaStr]) {
                    conteosPorFecha[fechaStr] = 0;
                }
                conteosPorFecha[fechaStr]++;
            }
        });

        console.log(`✅ Estadísticas agrupadas: ${Object.keys(conteosPorFecha).length} días con consultas`);

        return {
            success: true,
            total: allItems.length,
            conteosPorFecha: conteosPorFecha
        };
    } catch (error) {
        console.error("❌ Error obteniendo estadísticas:", error);
        return {
            success: false,
            error: error.message
        };
    }
}

// FUNCIONES PARA GESTIONAR CONVERSACIONES DE TWILIO EN CHATBOT
/**
 * Guarda un mensaje de Twilio en la conversación del paciente en CHATBOT
 * @param {string} celular - Número de celular del paciente
 * @param {Object} mensaje - Objeto con los datos del mensaje
 * @returns {Promise<Object>}
 */
export async function guardarMensajeTwilioEnChatbot(celular, mensaje) {
    try {
        console.log(`💬 Guardando mensaje de Twilio para celular: ${celular}`);

        // Buscar el paciente por celular en CHATBOT
        const result = await wixData.query("CHATBOT")
            .eq("celular", celular)
            .find();

        if (result.items.length === 0) {
            console.log(`⚠️ No se encontró paciente con celular: ${celular}`);
            return {
                success: false,
                message: "No se encontró paciente con ese celular"
            };
        }

        const paciente = result.items[0];

        // Obtener conversaciones existentes o crear array vacío
        const conversacionesTwilio = paciente.conversacionesTwilio || [];

        // Agregar el nuevo mensaje
        const nuevoMensaje = {
            sid: mensaje.sid || mensaje._id,
            direccion: mensaje.direccion, // 'entrada' o 'salida'
            contenido: mensaje.msg || mensaje.body,
            fecha: mensaje.fecha || new Date(),
            fechaFormateada: mensaje.fechaFormateada,
            status: mensaje.status,
            timestamp: new Date().toISOString()
        };

        conversacionesTwilio.push(nuevoMensaje);

        // Actualizar el registro en CHATBOT
        paciente.conversacionesTwilio = conversacionesTwilio;
        paciente.ultimoMensajeTwilio = nuevoMensaje.contenido;
        paciente.fechaUltimoMensajeTwilio = nuevoMensaje.fecha;

        await wixData.update("CHATBOT", paciente);

        console.log(`✅ Mensaje guardado exitosamente para ${paciente.primerNombre}`);

        return {
            success: true,
            message: "Mensaje guardado exitosamente",
            pacienteId: paciente._id
        };

    } catch (error) {
        console.error("❌ Error guardando mensaje en CHATBOT:", error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Obtiene las conversaciones de Twilio de un paciente
 * @param {string} celular - Número de celular del paciente
 * @returns {Promise<Object>}
 */
export async function obtenerConversacionesTwilioPorCelular(celular) {
    try {
        console.log(`📖 Obteniendo conversaciones Twilio para celular: ${celular}`);

        const result = await wixData.query("CHATBOT")
            .eq("celular", celular)
            .find();

        if (result.items.length === 0) {
            return {
                success: false,
                message: "No se encontró paciente con ese celular"
            };
        }

        const paciente = result.items[0];
        const conversaciones = paciente.conversacionesTwilio || [];

        return {
            success: true,
            conversaciones: conversaciones,
            paciente: {
                _id: paciente._id,
                primerNombre: paciente.primerNombre,
                celular: paciente.celular
            }
        };

    } catch (error) {
        console.error("❌ Error obteniendo conversaciones:", error);
        return {
            success: false,
            error: error.message
        };
    }
}