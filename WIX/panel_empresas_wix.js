import wixData from 'wix-data';
import wixWindow from 'wix-window';
import wixStorage from 'wix-storage';

let codEmpresa;
let pageSize = 4; // Cuántos ítems por página
let currentPage = 0; // Comenzamos en la primera página
let pagedData = []; // Aquí almacenaremos nuestras páginas de datos

$w.onReady(async function () {
    $w('#btnNext').onClick(() => goToPage(currentPage + 1));
    $w('#btnPrev').onClick(() => goToPage(currentPage - 1));
console.log("PRUEBA NUEVO CERT")
});

function goToPage(pageNumber) {
    currentPage = pageNumber;
    if (currentPage < 0) currentPage = 0;
    if (currentPage >= pagedData.length) currentPage = pagedData.length - 1;

    $w('#ordenesCompletadas').data = pagedData[currentPage];
    updatePaginationControls();
}

function updatePaginationControls() {
    $w('#btnPrev').enable();
    $w('#btnNext').enable();
    if (currentPage <= 0) $w('#btnPrev').disable();
    if (currentPage >= pagedData.length - 1) $w('#btnNext').disable();
}

//---------------CARGAR TODOS LOS DATOS---------------

async function actualizarDatos() {
    $w('#codigoIncorrecto').hide();
    $w('#loadingOrdenes').show();
    $w('#loadingActualizar').show();
    $w('#lostConection').hide();

    const valorIngresado = $w('#codEmpresa').value;
    
    // Guardamos el valor original para usarlo en el lightbox
    let codigoOriginal = valorIngresado === "SITEL 2024" ? "SITEL" : valorIngresado;
    
    // Si es ZIMMER2, buscamos como ZIMMER pero mantenemos ZIMMER2 para el lightbox
    let codEmpresaBusqueda;
    if (codigoOriginal === "ZIMMER2") {
        codEmpresa = "ZIMMER2"; // Mantener ZIMMER2 para el lightbox
        codEmpresaBusqueda = "ZIMMER"; // Buscar con ZIMMER en la BD
    } else {
        codEmpresa = codigoOriginal;
        codEmpresaBusqueda = codEmpresa;
    }

    if (codEmpresa === "SITEL") {
        $w('#group1').hide();
        $w('#group3').hide();
        $w('#adcGroup').show();
    }

    console.log("Código empresa para lightbox:", codEmpresa);
    console.log("Código empresa para búsqueda:", codEmpresaBusqueda);

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

    // Query para programadosHoy
    try {
        let consultaProgramados = wixData.query("HistoriaClinica")
            .eq("codEmpresa", codEmpresaBusqueda) // Usar código de búsqueda
            .between("fechaAtencion", startOfDay, endOfDay)
            .descending("fechaAtencion");

        if (codEmpresa === "SITEL") {
            consultaProgramados = consultaProgramados
                .eq("atendido", "ATENDIDO")
                .eq("tipoExamen", "INGRESO")
                .ne("aprobacion", "APROBADO")
                .ne("aprobacion", "NO APROBADO")
        }

        const programadosHoyResults = await consultaProgramados.count();
        $w("#programadosHoy").text = programadosHoyResults.toString();

    } catch (error) {
        console.error("Error al consultar programadosHoy:", error);
    }

    // Query para atendidosHoy
    try {
        const atendidosHoyResults = await wixData.query("HistoriaClinica")
            .eq("codEmpresa", codEmpresaBusqueda) // Usar código de búsqueda
            .between("fechaConsulta", startOfDay, endOfDay)
            .count();

        $w("#atendidosHoy").text = atendidosHoyResults.toString();

    } catch (error) {
        console.error("Error al consultar atendidosHoy:", error);
    }

    let success = false;
    while (!success) {
        try {
            let consultaHistoriaClinica = wixData.query("HistoriaClinica")
                .eq("codEmpresa", codEmpresaBusqueda) // Usar código de búsqueda
                .ne("fechaConsulta", "")
                .ne("numeroId", "TEST")
                .ne("numeroId", "Test")
                .ne("numeroId", "test")
                .descending("fechaConsulta")
                .limit(1000);

            if (codEmpresa === "SITEL") {
                consultaHistoriaClinica = consultaHistoriaClinica
                    .eq("atendido", "ATENDIDO")
                    .ne("aprobacion", "APROBADO")
                    .ne("aprobacion", "NO APROBADO")
                    .descending("fechaConsulta");
            }

            const historiaClinicaResults = await consultaHistoriaClinica.find();

            if (historiaClinicaResults.items.length === 0 || valorIngresado === "SITEL") {
                $w('#codigoIncorrecto').show();
                console.log(historiaClinicaResults)
                $w('#loadingOrdenes').hide();
                return; // Termina la función si no hay resultados o si el valor ingresado es "SITEL"
            }

            const historiaClinicaItems = historiaClinicaResults.items;
            let numerosId = historiaClinicaItems.map(item => item.numeroId).filter(Boolean);

            const formularioResults = await wixData.query("FORMULARIO")
                .hasSome("documentoIdentidad", numerosId)
                .limit(1000)
                .find();

            let formularioMap = {};
            formularioResults.items.forEach(item => {
                formularioMap[item.documentoIdentidad] = item;
            });

            let combinedData = historiaClinicaItems.map(historiaClinicaItem => {
                let foto = formularioMap[historiaClinicaItem.numeroId]?.foto || "";
                $w('#ordenesRepetear').show();
                return {
                    _id: historiaClinicaItem._id,
                    nombres: historiaClinicaItem.primerNombre + ' ' + historiaClinicaItem.primerApellido,
                    numeroId: historiaClinicaItem.numeroId,
                    estado: historiaClinicaItem.atendido,
                    foto: foto,
                    fechaConsulta: historiaClinicaItem.fechaConsulta,
                    fechaAtencion: historiaClinicaItem.fechaAtencion
                };
            });
            pagedData = [];
            for (let i = 0; i < combinedData.length; i += pageSize) {
                pagedData.push(combinedData.slice(i, i + pageSize));
            }
            $w('#loadingActualizar').hide()

            goToPage(0);

            $w('#ordenesCompletadas').onItemReady(($item, itemData, index) => {
                $item('#nombres').text = itemData.nombres;
                $item('#numeroId').text = itemData.numeroId;
                $item('#estado').text = itemData.estado;
                if (itemData.estado === "PENDIENTE") {
                    $item("#descargarButton").hide()
                }

                var linkDescargarButon = ""
                var empresasEspeciales = ["OMEGA", "PHIDIAS", "KM2", "CP360", "ZIMMER"]; // Agrega todos los códigos

                if (codEmpresa === "SITEL") {
                    linkDescargarButon = "https://www.bsl.com.co/copy-of-sitelaprobar/" + `${itemData.numeroId}`;
                    $w('#descargarButton').hide()
                } else if (codEmpresa === "ALEGRA") {
                    linkDescargarButon = "https://bsl-utilidades-yp78a.ondigitalocean.app/generar-certificado-v2/" + itemData._id;
                } else if (empresasEspeciales.includes(codEmpresa)) {

                    linkDescargarButon = "https://bsl-utilidades-yp78a.ondigitalocean.app/generar-certificado-desde-wix/" + itemData._id;

                    //linkDescargarButon = "https://www.bsl.com.co/certificado/" + itemData._id;
                } else {
                    //linkDescargarButon = "https://bsl-utilidades-yp78a.ondigitalocean.app/generar-certificado-desde-wix/" + itemData._id;

                    linkDescargarButon = "https://www.bsl.com.co/certificado/" + itemData._id;
                }

                $item('#foto').src = itemData.foto;
                $item('#fechaAtencion').text = itemData.fechaAtencion ? itemData.fechaAtencion.toLocaleString() : "";
                $item('#fechaConsulta').text = itemData.fechaConsulta ? itemData.fechaConsulta.toLocaleString() : "";
                $item("#descargarButton").link = linkDescargarButon;
                $item("#descargarButton").target = "_blank";

            });
            $w('#loadingOrdenes').hide();
            $w('#login').hide();

            success = true; // Si llega aquí, significa que no hubo errores

        } catch (error) {
            console.error(error);
            if (error.code !== "WDE0028") {
                $w('#loadingOrdenes').hide()
                $w('#lostConection').show()
                break; // Si el error no es "Operation time limit exceeded", salir del bucle
            }
            await new Promise(resolve => setTimeout(resolve, 2000)); // Espera 2 segundos
        }
    }

}

$w('#entrar').onClick(async () => {
    // Validar que codEmpresa no esté vacío
    if (!$w('#codEmpresa').value || $w('#codEmpresa').value.trim() === "") {
        return; // No hace nada si está vacío
    }

    if ($w('#codEmpresa').value === "IPSVISION") {
        $w('#codigoIncorrecto').text = "FACTURAS EN MORA";
        $w('#codigoIncorrecto').show();
        return; // detiene el flujo
    }

    await actualizarDatos();

    if (codEmpresa === "OMEGA") {
        $w('#contadorAtenciones').show();
    }
});

async function handleDocumentoChange(documento, repeaterItem) {

    console.log("Este es doc:", documento)
    console.log("esta es empresa", codEmpresa)
    
    // Determinar qué código usar para búsqueda
    let codEmpresaBusqueda = codEmpresa === "ZIMMER2" ? "ZIMMER" : codEmpresa;
    
    if (repeaterItem) {
        repeaterItem('#loadingRepeater').show();
    } else {
        $w('#loadingDocumento').show();
    }

    try {
        const results = await wixData.query("HistoriaClinica")
            .eq("codEmpresa", codEmpresaBusqueda) // Usar código de búsqueda
            .eq("numeroId", documento)
            .find();

        if (results.items.length > 0) {
            $w('#ordenesCompletadas').data = results.items; // Establece los datos del repetidor

            if (repeaterItem) {
                repeaterItem('#loadingRepeater').hide();

            } else {
                $w('#loadingDocumento').hide();
            }

        } else {
            if (repeaterItem) {
                repeaterItem('#loadingRepeater').hide();
            } else {
                $w('#loadingDocumento').hide();
            }
            $w('#noExiste').show();
        }
    } catch (error) {
        if (repeaterItem) {
            repeaterItem('#loadingRepeater').hide();
        } else {
            $w('#loadingDocumento').hide();
        }
        console.error("Hubo un error al consultar la base de datos:", error);
    }
}

export async function documento_change(event) {
    const documento = $w('#documento').value;
    await handleDocumentoChange(documento, null);
}

export function documento_click(event) {
    $w('#noExiste').hide();
}

export function numeroId_click_1(event, $item) {
    // No abrir lightbox para ALEGRA
    if (codEmpresa === "ALEGRA") {
        return;
    }

    const documento = $item('#numeroId').text; // Extraer el valor del campo "numeroId"
    wixStorage.local.setItem("documentoParaLightbox", documento);
    wixStorage.local.setItem("codEmpresaParaLightbox", codEmpresa);

    // Abrir FOUNDEVER APROBAR para SITEL y ZIMMER2
    if (codEmpresa === "SITEL" || codEmpresa === "ZIMMER2") {
        wixWindow.openLightbox("FOUNDEVER APROBAR");
    } else {
        wixWindow.openLightbox("PERFIL");
    }
}

export async function actualizarButton_click(event) {
    await actualizarDatos();
}

export function button1_click(event) {

    wixStorage.local.setItem("codEmpresaParaLightbox", codEmpresa);

    setTimeout(() => {
        wixWindow.openLightbox("ADC EMPRESAS");

    }, 100);
}

export function nuevaOrden_click(event) {

    wixStorage.local.setItem("codEmpresaParaLightbox", codEmpresa);

    setTimeout(() => {
        wixWindow.openLightbox("NUEVA ORDEN");

    }, 100);

}

export function estadisticasButton_click(event) {

    wixStorage.local.setItem("codEmpresaParaLightbox", codEmpresa);

    setTimeout(() => {
        wixWindow.openLightbox("ESTADISTICAS");

    }, 100);
}

const telefono = "+573008021701"; // Número de teléfono
const mensaje = "Hola. Requiero soporte con el panel de empresa"; // Mensaje personalizado
const enlaceWhatsApp = `https://api.whatsapp.com/send?phone=${telefono}&text=${encodeURIComponent(mensaje)}`;

$w('#whp').link = enlaceWhatsApp
$w('#whp').target = "_blank"

$w('#buttonConsolidado').onClick(async (event) => {
    console.log("iniciando búsqueda", codEmpresa)
    
    // Determinar qué código usar para búsqueda
    let codEmpresaBusqueda = codEmpresa === "ZIMMER2" ? "ZIMMER" : codEmpresa;
    
    // Obtener los valores seleccionados en los datePickers
    const fechaInicio = $w('#datePicker1').value;
    const fechaFin = $w('#datePicker2').value;

    if (!fechaInicio || !fechaFin) {
        console.error("Por favor selecciona un rango de fechas válido.");
        return;
    }

    try {
        $w('#buttonConsolidado').label = "Buscando..."
        // Realizar la consulta en HistoriaClinica
        const results = await wixData.query("HistoriaClinica")
            .eq("codEmpresa", codEmpresaBusqueda) // Usar código de búsqueda
            .between("fechaConsulta", fechaInicio, fechaFin)
            .find();

        // Actualizar el campo de texto con el total de registros
        const totalAtenciones = results.items.length;
        $w('#totalAtenciones').text = totalAtenciones.toString();

    } catch (error) {
        console.error("Error al consultar los datos de HistoriaClinica:", error);
    } finally {
        $w('#buttonConsolidado').label = "Buscar"
    }
})

$w('#adcLink').link = "https://www.bsl.com.co/reporte-adc"
$w('#adcLink').target = "_blank"