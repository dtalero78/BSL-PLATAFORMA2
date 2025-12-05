import wixData from 'wix-data';
import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { local } from 'wix-storage';
import { sendmessage } from 'backend/realtime';
import { fetch } from 'wix-fetch';

// Código nuevo
let savedPersonId = null;
let heather = "FORM";
let examenesArray = [];
let codEmpresa;
let empresa;
let tipoExamen;
let queryParams = wixLocation.query;
let cedula;
let tiempoConsulta = 2;
let horariosMedicos = [{
    nombre: "NUBIA",
    horarios: [
        { inicio: "08:00", fin: "21:00" },
    ]
}];

local.setItem('heather', heather);

$w.onReady(function () {
    // Inicializar otros elementos cuando la página esté lista
    initializePage();
    ocultarElementosBasadosEnQueryParams();
    mostrarFormularioConRetraso();
    inicializarDropdownsFechaHora();

    // Verificar si la URL contiene 'ref=ATR' y ajustar exámenes
    if (wixLocation.query.ref === "ATR") {
        configurarExamenesParaATR();
        $w('#examenes2').hide();
    } else {
        configurarExamenesGenerales();
    }
});

function configurarExamenesGenerales() {
    const examenesGenerales = [
        { "value": "Examen Médico Osteomuscular", "label": "Examen Médico Osteomuscular" },
        { "value": "Audiometría", "label": "Audiometría" },
        { "value": "Optometría", "label": "Optometría" }
        // Agrega otros exámenes generales aquí si es necesario
    ];

    // Asignar las opciones generales al dropdown de exámenes
    $w('#examenes1').options = examenesGenerales;
}

function configurarExamenesParaATR() {
    const examenesATR = [
        { "value": "Examen Médico Osteomuscular", "label": "Examen Médico Osteomuscular" },
        { "value": "Audiometría", "label": "Audiometría" },
        { "value": "Visiometría", "label": "Visiometría" },
        { "value": "Espirometría", "label": "Espirometría" },
        { "value": "Psicosensométrico", "label": "Psicosensométrico" },
        { "value": "Toxicología", "label": "Toxicología" }
    ];

    // Asignar las opciones específicas de ATR al dropdown de exámenes
    $w('#examenes1').options = examenesATR;
}

function initializePage() {
    hideAllGroupsExceptFirst();
    setupEventHandlers();
}

function hideAllGroupsExceptFirst() {
    ['2', '3', '4'].forEach(group => hideElement(`#group${group}`));
}

function setupEventHandlers() {
    $w('#siguiente').onClick(handleNextButtonClick);
    setupFieldChangeHandlers();
    $w('#tipoConsulta').onChange(handleTipoConsultaChange);
    $w('#aNombreDe').onChange(handleANombreDeChange);
}

async function handleNextButtonClick() {
    let currentGroup = getCurrentGroup();
    if (currentGroup === 1) {
        await numeroId_change();
    }
    wixWindow.scrollTo(0, 0);
    if (currentGroup < 5) {
        let validation = validateCurrentGroupFields(currentGroup);
        if (validation.isValid) {
            if (currentGroup === 4) {
                $w('#loading').show();
                await updateDatabase();
                $w('#loading').hide();
            }
            toggleGroupVisibility(currentGroup, false);
            currentGroup++;
            toggleGroupVisibility(currentGroup, true);
            if (currentGroup === 5) {
                hideElement("#siguiente");
            }
        } else {
            showElementWithText("#aviso", `Por favor complete los siguientes campos: ${validation.missingFields.join(", ")}`);
        }
    }
}

function setupFieldChangeHandlers() {
    const allFields = [
        "#primerNombre", "#segundoNombre", "#primerApellido", "#segundoApellido", "#numeroId",
        "#celular", "#tipoConsulta", "#mes", "#dia", "#hora",
        "#aNombreDe", "#empresa", "#cargo", "#ciudad", "#direccion",
        "#examenes1",
    ];
    allFields.forEach(fieldId => {
        try {
            $w(fieldId).onChange(() => {
                let currentGroup = getCurrentGroup();
                let validation = validateCurrentGroupFields(currentGroup);
                if (validation.isValid) {
                    hideElement("#aviso");
                }
            });
        } catch (err) {
            console.error(`Error setting up change handler for ${fieldId}:`, err);
        }
    });
}

function handleTipoConsultaChange(event) {
    console.log('Tipo de consulta cambiado a:', $w('#tipoConsulta').value); // Añadir esto para verificar el valor
    if ($w('#tipoConsulta').value === "Presencial") {
        generarOpcionesHorasPresencial();
    } else {
        actualizarHorasDisponibles();
    }
}

function handleANombreDeChange(event) {
    if ($w('#aNombreDe').value === "EMPRESA") {
        $w('#empresa').expand();
    } else {
        $w('#empresa').collapse();
    }
}

function generarOpcionesHorasPresencial() {
    let opcionesDeHoras = [];
    for (let hora = 7; hora <= 16; hora++) {
        let horaFormateada = hora < 10 ? '0' + hora : hora;
        opcionesDeHoras.push({
            "value": `${horaFormateada}:00-PRESENCIAL`,
            "label": `${horaFormateada}:00`
        });
    }
    $w("#hora").options = opcionesDeHoras;
}

function showElement(selector) {
    $w(selector).show();
}

function hideElement(selector) {
    $w(selector).hide();
}

function showElementWithText(selector, text) {
    const element = $w(selector);
    element.text = text;
    element.show();
}

function validateCurrentGroupFields(groupNumber) {
    const groupFields = {
        1: ["#primerNombre", "#primerApellido", "#numeroId"],
        2: ["#celular", "#tipoConsulta", "#mes", "#dia", "#hora"],
        3: ["#ciudad", "#direccion"],
        4: ["#examenes1"]
    };

    let isValid = true;
    let missingFields = [];

    const excludeFieldsForIPSVISION = ["#mes", "#dia", "#hora", "#direccion", "#examenes"];
    const empresasOcultas = [
        "DeStori", "rippling", "ripplingegreso", "ripplingperiodico", "EVERTEC", "EVERTECPERIODICO", "EVERTECPERIODICOBOGOTA",
        "EVERTECINGRESOBOGOTA", "EVERTECEGRESOBOGOTA", "AVANTO", "EVERTECEGRESO", "IPSVISION"
    ];
    const isIPSVISION = queryParams.ref === "IPSVISION";

    groupFields[groupNumber].forEach(fieldId => {
        // Ya tienes esto para exámenes, ahora amplíalo para tipoConsulta:
        if (
            (groupNumber === 4 && queryParams.ref && empresasOcultas.includes(queryParams.ref) && fieldId === "#examenes1") ||
            (groupNumber === 2 && queryParams.ref && empresasOcultas.includes(queryParams.ref) && fieldId === "#tipoConsulta")
        ) {
            return;
        }
        // Si la empresa es IPSVISION y el campo está en la lista de exclusión, no validarlo
        if (isIPSVISION && excludeFieldsForIPSVISION.includes(fieldId)) {
            return;
        }
        let fieldValue = $w(fieldId).value;
        if (Array.isArray(fieldValue)) {
            if (fieldValue.length === 0) {
                missingFields.push($w(fieldId).placeholder || fieldId);
                isValid = false;
            }
        } else {
            if (!fieldValue || fieldValue.trim() === "") {
                missingFields.push($w(fieldId).placeholder || fieldId);
                isValid = false;
            }
        }
    });

    return { isValid, missingFields };
}

function toggleGroupVisibility(groupNumber, show) {
    const groupId = `#group${groupNumber}`;
    if (show) {
        showElement(groupId);
    } else {
        hideElement(groupId);
    }
}

function getCurrentGroup() {
    for (let i = 1; i <= 5; i++) {
        if (!$w(`#group${i}`).hidden) {
            return i;
        }
    }
    return 1;
}

// Código antiguo
function cleanText(inputText) {
    return inputText.replace(/[ .]+/g, "");
}

function combineDateAndTime(date, time) {
    const year = date.substring(0, 4);
    const month = date.substring(5, 7) - 1;
    const day = date.substring(8, 10);
    const hours = Number(time.substring(0, 2));
    const minutes = Number(time.substring(3, 5));
    const fechaLocal = new Date(year, month, day, hours, minutes);
    fechaLocal.setHours(fechaLocal.getHours());
    return fechaLocal.toISOString();
}

function ocultarElementosBasadosEnQueryParams() {
    const empresasOcultas = [
        "DeStori", "rippling", "ripplingegreso", "ripplingperiodico", "EVERTEC", "EVERTECPERIODICO", "EVERTECPERIODICOBOGOTA",
        "EVERTECINGRESOBOGOTA", "EVERTECEGRESOBOGOTA", "AVANTO", "EVERTECEGRESO", "IPSVISION"
    ];

    if (queryParams.ref && empresasOcultas.includes(queryParams.ref)) {
        $w('#formulario').hide();
        $w('#aNombreDe').collapse();
        $w('#examenes1').collapse();
        $w('#examenes2').collapse();
        $w('#tipoConsulta').collapse(); // NUEVO: Oculta tipoConsulta
    }

    // Acciones específicas para IPSVISION
    if (queryParams.ref === "IPSVISION") {
        $w('#hora').collapse();
        $w('#dia').collapse();
        $w('#mes').collapse();
    }

    // Abrir lightbox para empresas (si no es IPSVISION)
    if (queryParams.ref && !["IPSVISION"].includes(queryParams.ref)) {
        wixWindow.openLightbox("INSTRUCCIONES EMPRESAS");
    }
}

function mostrarFormularioConRetraso() {
    setTimeout(() => {
        $w('#formulario').show();
    }, 500);
}

function inicializarDropdownsFechaHora() {
    actualizarMesesDisponibles();
    $w("#mes").onChange(actualizarDiasDisponibles);
    $w("#dia").onChange(actualizarHorasDisponibles);
}

$w('#celular').onInput((event) => {
    const textWithoutSpacesOrDots = cleanText(event.target.value);
    $w('#celular').value = textWithoutSpacesOrDots;
});

async function updateDatabase() {
    let fechaYHoraCombinadas;
    let medico;

    const isIPSVISION = queryParams.ref === "IPSVISION";

    // Solo validar hora si no es IPSVISION
    let horaOpcion;
    if (!isIPSVISION) {
        const horaIndexSeleccionada = $w("#hora").value;
        horaOpcion = $w("#hora").options.find(opt => opt.value === horaIndexSeleccionada);
        if (!horaOpcion) {
            $w('#loading').hide();
            console.error("No se pudo encontrar la opción seleccionada para la hora.");
            $w('#aviso').show();
            $w('#aviso').text = "Selecciona una hora y diligencia todos los campos";
            return;
        }
    }

    const mesSeleccionado = parseInt($w("#mes").value, 10);
    const diaSeleccionado = $w("#dia").value;

    if (!isIPSVISION) {
        const fechaSeleccionadaISO = new Date(diaSeleccionado);
        const fechaFormateada = fechaSeleccionadaISO.toISOString().split('T')[0];
        const horaFormateada = horaOpcion.label;
        fechaYHoraCombinadas = combineDateAndTime(fechaFormateada, horaFormateada);
        console.log(fechaYHoraCombinadas);
    }

    if (queryParams.ref) {
        if (queryParams.ref === "DeStori") {
            codEmpresa = "STORI";
            empresa = "Stori Card";
            tipoExamen = "Ingreso";
            examenesArray = ["Examen Médico Osteomuscular", "Audiometría", "Optometría"];
        } else if (["EVERTEC", "EVERTECPERIODICO", "EVERTECEGRESO"].includes(queryParams.ref)) {
            codEmpresa = "EVERTEC";
            empresa = "EVERTEC";
            tipoExamen = queryParams.ref === "EVERTEC" ? "Ingreso" : queryParams.ref === "EVERTECPERIODICO" ? "Periódico" : "Egreso";
            examenesArray = ["Examen Médico Osteomuscular", "Audiometría", "Optometría"];
        } else if (["rippling", "ripplingperiodico", "ripplingegreso"].includes(queryParams.ref)) {
            codEmpresa = "RIPPLING";
            empresa = "Rippling";
            tipoExamen = queryParams.ref === "rippling" ?
                "Ingreso" :
                queryParams.ref === "ripplingperiodico" ?
                "Periódico" :
                "Egreso";
            // ✅ Exámenes por defecto para Rippling
            examenesArray = ["Examen Médico Osteomuscular", "Audiometría", "Optometría"];
        } else if (["EVERTECEGRESO", "EVERTECINGRESOBOGOTA", "EVERTECPERIODICOBOGOTA"].includes(queryParams.ref)) {
            codEmpresa = "EVERTECBOGOTA";
            empresa = "EVERTEC BOGOTÁ";
            tipoExamen = queryParams.ref === "EVERTECINGRESOBOGOTA" ? "Ingreso" : queryParams.ref === "EVERTECPERIODICOBOGOTA" ? "Periódico" : "Egreso";
            examenesArray = ["Examen Médico Osteomuscular", "Audiometría", "Optometría"];
        } else if (queryParams.ref === "AVANTO") {
            codEmpresa = "AVANTO";
            empresa = "AVANTO";
            tipoExamen = "Egreso";
            examenesArray = ["Examen Médico Osteomuscular", "Audiometría", "Optometría"];
        } else if (queryParams.ref === "ATR") {
            codEmpresa = "ATR";
            empresa = "ATR";
            tipoExamen = "Ingreso";
            examenesArray = $w('#examenes1').value || [];
        } else if (isIPSVISION) {
            const ahora = new Date();
            codEmpresa = "IPSVISION";
            empresa = "VISION CARIBE";
            tipoExamen = "Ingreso";
            medico = "SIXTA";
            fechaYHoraCombinadas = new Date(ahora.getTime() + 30 * 60 * 1000).toISOString();
            examenesArray = ["Examen Médico Osteomuscular", "Audiometría", "Optometría"];
        } else {
            examenesArray = ["Examen Médico Osteomuscular", "Audiometría", "Optometría"];
        }
    } else {
        codEmpresa = $w('#aNombreDe').value === "PARTICULAR" ? "SANITHELP-JJ" : "EMPRESA";
        empresa = $w('#aNombreDe').value === "PARTICULAR" ? "PARTICULAR" : $w('#empresa').value;
        examenesArray = [].concat($w('#examenes1').value || []).concat($w('#examenes2').value || []);
        console.log("Exámenes seleccionados:", $w('#examenes1').value, $w('#examenes2').value);
        tipoExamen = "Ingreso";
    }

    const cleanedNumeroId = limpiarNumeroId($w('#numeroId').value);

    if (typeof medico === 'undefined') {
        if ($w('#tipoConsulta').value === "Presencial") {
            medico = "PRESENCIAL";
        } else {
            medico = $w("#hora").value.split('-')[1];
        }
    }

    const empresasOcultas = [
        "DeStori", "rippling", "ripplingegreso", "ripplingperiodico", "EVERTEC", "EVERTECPERIODICO", "EVERTECPERIODICOBOGOTA",
        "EVERTECINGRESOBOGOTA", "EVERTECEGRESOBOGOTA", "AVANTO", "EVERTECEGRESO", "IPSVISION"
    ];
    if (queryParams.ref && empresasOcultas.includes(queryParams.ref)) {
        medico = "SIXTA";
    }

    const dataToSave = {
        "primerNombre": $w('#primerNombre').value,
        "segundoNombre": $w('#segundoNombre').value,
        "primerApellido": $w('#primerApellido').value,
        "segundoApellido": $w('#segundoApellido').value,
        "numeroId": cleanedNumeroId,
        "fechaAtencion": new Date(fechaYHoraCombinadas),
        "cargo": $w('#cargo').value,
        "celular": $w('#celular').value,
        "atendido": "PENDIENTE",
        "codEmpresa": codEmpresa,
        "empresa": empresa,
        "medico": medico,
        "tipoExamen": tipoExamen,
        "ciudad": "Bogotá",
        "examenes": examenesArray,
        "publicidad": $w('#direccion').value
    };

    await wixData.insert("HistoriaClinica", dataToSave)
        .then(async (newItem) => {
            console.log("Nuevo registro creado en HistoriaClinica:", newItem);

            // ========== SINCRONIZAR CON POSTGRESQL ==========
            try {
                const postgresData = {
                    wixId: newItem._id,
                    atendido: "PENDIENTE",
                    numeroId: cleanedNumeroId,
                    primerNombre: $w('#primerNombre').value,
                    segundoNombre: $w('#segundoNombre').value || null,
                    primerApellido: $w('#primerApellido').value,
                    segundoApellido: $w('#segundoApellido').value || null,
                    celular: $w('#celular').value,
                    codEmpresa: codEmpresa,
                    empresa: empresa,
                    tipoExamen: tipoExamen,
                    cargo: $w('#cargo').value || null,
                    fechaAtencion: fechaYHoraCombinadas,
                    ciudad: "Bogotá",
                    medico: medico
                };

                const pgResponse = await fetch("https://bsl-formulario-f5qx3.ondigitalocean.app/api/marcar-atendido", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(postgresData)
                });

                const pgResult = await pgResponse.json();
                console.log("✅ PostgreSQL sincronizado:", pgResult);
            } catch (pgError) {
                console.error("❌ Error al sincronizar con PostgreSQL:", pgError);
                // No bloqueamos el flujo si falla PostgreSQL
            }
            // ========== FIN SINCRONIZACIÓN POSTGRESQL ==========

            // Eliminar registros TEST con la misma fecha
            try {
                const nuevaFechaAtencion = new Date(fechaYHoraCombinadas);
                const registrosTEST = await wixData.query("HistoriaClinica")
                    .contains("numeroId", "TEST")
                    .eq("numeroId", cleanedNumeroId + "TEST")
                    .find();

                if (registrosTEST.items.length > 0) {
                    console.log(`Encontrados ${registrosTEST.items.length} registros TEST para verificar`);
                    for (const registroTEST of registrosTEST.items) {
                        const fechaTEST = new Date(registroTEST.fechaAtencion);
                        if (fechaTEST.getTime() === nuevaFechaAtencion.getTime()) {
                            await wixData.remove("HistoriaClinica", registroTEST._id);
                            console.log(`Registro TEST eliminado de HistoriaClinica: ${registroTEST._id} (misma fecha)`);

                            // También eliminar de CHATBOT si existe
                            try {
                                await wixData.remove("CHATBOT", registroTEST._id);
                                console.log(`Registro TEST eliminado de CHATBOT: ${registroTEST._id}`);
                            } catch (chatbotError) {
                                console.log(`No se encontró registro en CHATBOT para eliminar: ${registroTEST._id}`);
                            }
                        }
                    }
                }
            } catch (cleanupError) {
                console.error("Error al limpiar registros TEST:", cleanupError);
            }

            const dataToSaveChatbot = {
                "_id": newItem._id,
                "numeroId": cleanedNumeroId,
                "idGeneral": newItem._id,
                "primerNombre": $w('#primerNombre').value,
                "fechaAtencion": new Date(fechaYHoraCombinadas),
                "celular": $w('#celular').value
            };

            await sendmessage("nuevaOrden", { type: "updateComplete" });
            console.log("Evento 'updateComplete' registrado correctamente.");

            // Evitar guardar en CHATBOT si es una empresa especial
            if (!empresasOcultas.includes(queryParams.ref)) {
                await wixData.insert("CHATBOT", dataToSaveChatbot)
                    .then(() => {
                        console.log("Nuevo registro creado en CHATBOT.");
                    })
                    .catch((err) => {
                        console.error("Error al crear el nuevo registro en CHATBOT: ", err);
                    });
            } else {
                console.log("Empresa especial detectada, no se guarda en CHATBOT.");
            }

            $w('#titulo').text = "Redireccionando...";
            $w('#textoNuevoComercial').text = "Registro Creado. Espera...";

            console.log("REDIRECCIONAND A DIGITAL")
                    //wixLocation.to("https://www.bsl.com.co/historia-clinica2/" + newItem._id);
                    wixLocation.to("https://bsl-formulario-f5qx3.ondigitalocean.app/?_id=" + newItem._id);

        })
        .catch((err) => {
            console.error("Error al crear el nuevo registro en HistoriaClinica: ", err);
        });
}

function limpiarNumeroId(numeroId) {
    return numeroId.replace(/[^\d]/g, ''); // Esto eliminará cualquier carácter que no sea un dígito.
}

function actualizarMesesDisponibles() {
    const hoy = new Date();
    let opcionesDeMeses = [];
    for (let i = 0; i < 3; i++) {
        const mesActual = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
        const nombreDelMes = mesActual.toLocaleDateString('es-ES', { month: 'long' });
        const valorMes = mesActual.getMonth() + 1;
        opcionesDeMeses.push({ "value": valorMes.toString(), "label": nombreDelMes.charAt(0).toUpperCase() + nombreDelMes.slice(1) });
    }
    $w("#mes").options = opcionesDeMeses;
}

function actualizarDiasDisponibles() {
    const mesSeleccionado = parseInt($w("#mes").value, 10) - 1;
    const añoActual = new Date().getFullYear();
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    let primerDiaDelMes = new Date(añoActual, mesSeleccionado, 1);
    const ultimoDiaDelMes = new Date(añoActual, mesSeleccionado + 1, 0);
    if (mesSeleccionado === hoy.getMonth() && primerDiaDelMes < hoy) {
        primerDiaDelMes = hoy;
    }
    let opcionesDeDias = [];
    let diaActual = new Date(primerDiaDelMes);
    while (diaActual <= ultimoDiaDelMes) {
        let etiquetaDia = diaActual.toLocaleDateString('es-ES', {
            weekday: 'long',
            day: 'numeric'
        }).replace(/^./, match => match.toUpperCase());
        const esHoy = diaActual.getDate() === hoy.getDate() && diaActual.getMonth() === hoy.getMonth() && diaActual.getFullYear() === hoy.getFullYear();
        opcionesDeDias.push({
            "value": diaActual.toISOString(),
            "label": esHoy ? "Hoy" : etiquetaDia
        });
        diaActual.setDate(diaActual.getDate() + 1);
    }
    $w("#dia").options = opcionesDeDias;
}

async function actualizarHorasDisponibles() {
    const diaSeleccionado = new Date($w("#dia").value);
    const inicioDelDia = new Date(diaSeleccionado.setHours(0, 0, 0, 0));
    const finDelDia = new Date(diaSeleccionado.setHours(23, 59, 59, 999));
    const turnosOcupados = await wixData.query("HistoriaClinica")
        .between("fechaAtencion", inicioDelDia, finDelDia)
        .find()
        .then((results) => {
            const mappedResults = results.items.map(item => ({
                fechaAtencion: new Date(item.fechaAtencion),
                medico: item.medico
            }));
            console.log("Mapped results:", mappedResults);
            return mappedResults;
        })
        .catch((err) => {
            console.error("Error al consultar la base de datos:", err);
            return [];
        });
    generarOpcionesDeHoras(diaSeleccionado, turnosOcupados);
    console.log("Turnos ocupados:", turnosOcupados);
}

function generarOpcionesDeHoras(diaSeleccionado, turnosOcupados) {
    const ahora = new Date();
    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    diaSeleccionado = new Date(diaSeleccionado.getFullYear(), diaSeleccionado.getMonth(), diaSeleccionado.getDate());
    const esHoy = +diaSeleccionado === +hoy;

    let inicioHoras;
    if (esHoy) {
        // Asegurarse de que la hora de inicio respete estrictamente las reglas
        let inicioTemporal = new Date(ahora.getTime() + 60 * 60 * 1000); // 1 hora después de la hora actual
        let inicioJornada = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 8, 0); // Jornada comienza a las 8:00
        inicioHoras = inicioTemporal > inicioJornada ? inicioTemporal : inicioJornada;
    } else {
        // Para días futuros, la jornada siempre comienza a las 8:00
        inicioHoras = new Date(diaSeleccionado.getFullYear(), diaSeleccionado.getMonth(), diaSeleccionado.getDate(), 8, 0);
    }

    let finalDelDia = new Date(diaSeleccionado.getFullYear(), diaSeleccionado.getMonth(), diaSeleccionado.getDate(), 0, 0);
    horariosMedicos.forEach(medico => {
        medico.horarios.forEach(horario => {
            let finHorarioMedico = new Date(diaSeleccionado.getFullYear(), diaSeleccionado.getMonth(), diaSeleccionado.getDate(), ...horario.fin.split(':').map(Number));
            if (finHorarioMedico > finalDelDia) {
                finalDelDia = finHorarioMedico;
            }
        });
    });

    let opcionesDeHoras = [];
    let horaActual = inicioHoras;

    while (horaActual < finalDelDia) {
        horariosMedicos.forEach(medico => {
            medico.horarios.forEach(horario => {
                let inicioHorarioMedico = new Date(diaSeleccionado.getFullYear(), diaSeleccionado.getMonth(), diaSeleccionado.getDate(), ...horario.inicio.split(':').map(Number));
                let finHorarioMedico = new Date(diaSeleccionado.getFullYear(), diaSeleccionado.getMonth(), diaSeleccionado.getDate(), ...horario.fin.split(':').map(Number));

                if (horaActual >= inicioHorarioMedico && horaActual < finHorarioMedico) {
                    const turnoOcupado = turnosOcupados.find(turno =>
                        turno.fechaAtencion.getTime() === horaActual.getTime() && turno.medico === medico.nombre
                    );

                    // Solo agregar si no está ocupado
                    if (!turnoOcupado) {
                        let hora = horaActual.getHours();
                        let minutos = horaActual.getMinutes();
                        let tiempoFormateado = `${hora < 10 ? '0' + hora : hora}:${minutos < 10 ? '0' + minutos : minutos}`;
                        opcionesDeHoras.push({
                            "value": tiempoFormateado + `-${medico.nombre}`,
                            "label": tiempoFormateado,
                            "medico": medico.nombre
                        });
                    }
                }
            });
        });
        horaActual = new Date(horaActual.getTime() + (60000 * tiempoConsulta));
    }

    let opcionesFiltradas = opcionesDeHoras.filter((opcion, index, self) =>
        index === self.findIndex((t) => t.value === opcion.value && t.label === opcion.label)
    );

    $w("#hora").options = opcionesFiltradas;
}

export async function numeroId_change(event) {
    console.log("Revisando id");
    const numeroIdIngresado = $w('#numeroId').value;
    if (numeroIdIngresado.trim() !== "") {
        const cleanedCedula = cleanText(numeroIdIngresado);
        console.log("Cleaned Cedula: ", cleanedCedula);
        if (numeroIdIngresado === cleanedCedula) {
            console.log("Cedula is clean, proceeding with query");
            const queryResults = await wixData.query("HistoriaClinica").eq("numeroId", cleanedCedula).find();
            console.log("Query Results: ", queryResults.items);
            if (queryResults.items.length > 0) {
                let registrosConFechaConsulta = queryResults.items.filter(item => item.fechaConsulta);
                console.log("Registros con fechaConsulta: ", registrosConFechaConsulta);
                if (registrosConFechaConsulta.length > 0) {
                    console.log("Modifying existing records with (2)");
                    // Modificar los registros existentes agregando un (2) al numeroId
                    await Promise.all(queryResults.items.map(async (item) => {
                        let updatedItem = { ...item, numeroId: item.numeroId + "(2)" };
                        await wixData.update("HistoriaClinica", updatedItem);
                        console.log(`Registro modificado: ${item._id} a ${updatedItem.numeroId}`);
                    }));
                    $w('#siguiente').expand();
                } else {
                    console.log("Modifying existing records by adding 'TEST'");
                    // Modificar los registros existentes agregando "TEST" al numeroId
                    await Promise.all(queryResults.items.map(async (item) => {
                        let updatedItem = { ...item, numeroId: item.numeroId + " " + "TEST" };
                        await wixData.update("HistoriaClinica", updatedItem);
                        console.log(`Registro modificado: ${item._id} a ${updatedItem.numeroId}`);
                    }));
                    $w('#siguiente').expand();
                }
            } else {
                console.log("No records found with the given numeroId");
                $w('#aviso').show();
                $w('#siguiente').expand();
            }
        } else {
            console.log("Cedula does not match the cleaned version");
        }
    } else {
        console.log("numeroId is empty or only contains whitespace");
    }
}
