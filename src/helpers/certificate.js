const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

/**
 * Formatea una fecha ISO a formato legible en español
 * @param {string|Date} fecha - Fecha a formatear
 * @returns {string} Fecha formateada (ej: "15 de Diciembre de 2025")
 */
function formatearFechaCertificado(fecha) {
    if (!fecha) return 'No especificada';

    const meses = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    const fechaObj = new Date(fecha);
    if (isNaN(fechaObj.getTime())) return 'No especificada';

    const dia = fechaObj.getDate();
    const mes = meses[fechaObj.getMonth()];
    const anio = fechaObj.getFullYear();

    return `${dia} de ${mes} de ${anio}`;
}

/**
 * Determina la clase CSS para el concepto médico
 * @param {string} concepto - Concepto médico final
 * @returns {string} Clase CSS
 */
function getConceptoClass(concepto) {
    if (!concepto) return '';
    const conceptoUpper = concepto.toUpperCase();
    if (conceptoUpper.includes('NO APTO')) return 'no-apto';
    if (conceptoUpper.includes('RESTRICCION') || conceptoUpper.includes('RECOMENDACION')) return 'apto-restricciones';
    if (conceptoUpper.includes('APLAZADO')) return 'aplazado';
    if (conceptoUpper.includes('APTO')) return 'apto';
    return '';
}

/**
 * Genera el HTML de los exámenes realizados
 * @param {string} examenes - String de exámenes separados por coma o JSON
 * @returns {string} HTML de los exámenes
 */
function generarExamenesHTML(examenes) {
    if (!examenes) {
        return '<div class="exam-box"><h4>Examen Médico Ocupacional</h4><span class="estado">✓ Realizado</span></div>';
    }

    let listaExamenes = [];

    try {
        if (examenes.startsWith('[')) {
            listaExamenes = JSON.parse(examenes);
        } else {
            listaExamenes = examenes.split(',').map(e => e.trim()).filter(e => e);
        }
    } catch (e) {
        listaExamenes = examenes.split(',').map(e => e.trim()).filter(e => e);
    }

    if (listaExamenes.length === 0) {
        listaExamenes = ['Examen Médico Ocupacional'];
    }

    return listaExamenes.map(examen => `
        <div class="exam-box realizado">
            <h4>${examen}</h4>
            <span class="estado">✓ Realizado</span>
        </div>
    `).join('');
}

/**
 * Genera el HTML para la sección de Resultados Generales con cada examen
 * @param {string} examenes - Lista de exámenes (string o JSON array)
 * @param {Object} historia - Datos de la historia clínica con resultados
 * @returns {string} HTML de los resultados
 */
function generarResultadosHTML(examenes, historia) {
    let listaExamenes = [];

    if (examenes) {
        try {
            if (examenes.startsWith('[')) {
                listaExamenes = JSON.parse(examenes);
            } else {
                listaExamenes = examenes.split(',').map(e => e.trim()).filter(e => e);
            }
        } catch (e) {
            listaExamenes = examenes.split(',').map(e => e.trim()).filter(e => e);
        }
    }

    if (listaExamenes.length === 0) {
        listaExamenes = ['Examen Médico Ocupacional'];
    }

    const normalizar = (str) => str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const resultadosMap = {
        'examen medico ocupacional': {
            titulo: 'EXAMEN MÉDICO OCUPACIONAL OSTEOMUSCULAR',
            contenido: historia.mdConceptoOsteomuscular ||
                `Basándose en los resultados obtenidos de la evaluación física y osteomuscular, el trabajador se encuentra ${historia.mdConceptoFinal || 'APTO'} para desempeñar las funciones del cargo.`
        },
        'osteomuscular': {
            titulo: 'EXAMEN MÉDICO OCUPACIONAL OSTEOMUSCULAR',
            contenido: historia.mdConceptoOsteomuscular ||
                `Basándose en los resultados obtenidos de la evaluación física y osteomuscular, el trabajador se encuentra ${historia.mdConceptoFinal || 'APTO'} para desempeñar las funciones del cargo.`
        },
        'audiometria': {
            titulo: 'AUDIOMETRÍA',
            contenido: historia.audioConcepto || historia.audiometriaConcepto ||
                'Audición dentro de parámetros normales. Se recomienda continuar con controles periódicos.'
        },
        'visiometria': {
            titulo: 'VISIOMETRÍA',
            contenido: historia.visioConcepto || historia.visiometriaConcepto ||
                'Agudeza visual dentro de parámetros normales para el desempeño de las funciones del cargo.'
        },
        'perfil psicologico': {
            titulo: 'PERFIL PSICOLÓGICO',
            contenido: historia.psicoConcepto || historia.perfilPsicologicoConcepto ||
                'El trabajador presenta un perfil psicológico adecuado para el desempeño de las funciones del cargo.'
        },
        'psicologico': {
            titulo: 'PERFIL PSICOLÓGICO',
            contenido: historia.psicoConcepto || historia.perfilPsicologicoConcepto ||
                'El trabajador presenta un perfil psicológico adecuado para el desempeño de las funciones del cargo.'
        },
        'espirometria': {
            titulo: 'ESPIROMETRÍA',
            contenido: historia.espiroConcepto || historia.espirometriaConcepto ||
                'Función pulmonar dentro de parámetros normales.'
        },
        'electrocardiograma': {
            titulo: 'ELECTROCARDIOGRAMA',
            contenido: historia.ekgConcepto || historia.electrocardiogramaConcepto ||
                'Ritmo cardíaco dentro de parámetros normales.'
        },
        'optometria': {
            titulo: 'OPTOMETRÍA',
            contenido: historia.optoConcepto || historia.optometriaConcepto ||
                'Evaluación optométrica dentro de parámetros normales.'
        },
        'laboratorio': {
            titulo: 'EXÁMENES DE LABORATORIO',
            contenido: historia.labConcepto || historia.laboratorioConcepto ||
                'Resultados de laboratorio dentro de parámetros normales.'
        },
        'trabajo en alturas': {
            titulo: 'TRABAJO EN ALTURAS',
            contenido: historia.alturasConcepto ||
                `El trabajador se encuentra ${historia.mdConceptoFinal || 'APTO'} para realizar trabajo en alturas.`
        }
    };

    return listaExamenes.map(examen => {
        const examenNorm = normalizar(examen);

        let resultado = null;
        for (const [key, value] of Object.entries(resultadosMap)) {
            if (examenNorm.includes(normalizar(key)) || normalizar(key).includes(examenNorm)) {
                resultado = value;
                break;
            }
        }

        if (!resultado) {
            resultado = {
                titulo: examen.toUpperCase(),
                contenido: `Examen realizado satisfactoriamente. El trabajador se encuentra ${historia.mdConceptoFinal || 'APTO'} según los resultados obtenidos.`
            };
        }

        return `
            <div class="result-item">
                <div class="result-item-title">${resultado.titulo}</div>
                <div class="result-item-content">${resultado.contenido}</div>
            </div>
        `;
    }).join('');
}

// Mapeo de médicos según la guía
const MEDICOS_MAP = {
    'SIXTA': {
        nombre: 'SIXTA VIVERO CARRASCAL',
        registro: 'REGISTRO MÉDICO NO 55300504',
        licencia: 'LICENCIA SALUD OCUPACIONAL 583',
        firma: '/firmas/FIRMA-SIXTA.png'
    },
    'JUAN 134': {
        nombre: 'JUAN JOSE REATIGA',
        registro: 'CC. 7472.676 - REGISTRO MEDICO NO 14791',
        licencia: 'LICENCIA SALUD OCUPACIONAL 460',
        firma: '/firmas/FIRMA-JUAN134.jpeg'
    },
    'CESAR': {
        nombre: 'CÉSAR ADOLFO ZAMBRANO MARTÍNEZ',
        registro: 'REGISTRO MEDICO NO 1192803570',
        licencia: 'LICENCIA SALUD OCUPACIONAL # 3241',
        firma: '/firmas/FIRMA-CESAR.jpeg'
    },
    'MARY': {
        nombre: 'MARY',
        registro: '',
        licencia: '',
        firma: '/firmas/FIRMA-MARY.jpeg'
    },
    'NUBIA': {
        nombre: 'JUAN JOSE REATIGA',
        registro: 'CC. 7472.676 - REGISTRO MEDICO NO 14791',
        licencia: 'LICENCIA SALUD OCUPACIONAL 460',
        firma: '/firmas/FIRMA-JUAN134.jpeg'
    },
    'PRESENCIAL': {
        nombre: '',
        registro: '',
        licencia: '',
        firma: '/firmas/FIRMA-PRESENCIAL.jpeg'
    }
};

/**
 * Genera el HTML del certificado médico con los datos del paciente
 * @param {Object} historia - Datos de la historia clínica
 * @param {Object} medico - Datos del médico
 * @param {string} fotoUrl - URL de la foto del paciente
 * @param {string} firmaPaciente - Firma del paciente (base64 o URL)
 * @param {Object} datosFormulario - Datos demográficos del formulario
 * @returns {string} HTML completo del certificado
 */
function generarHTMLCertificado(historia, medico, fotoUrl, firmaPaciente, datosFormulario) {
    const templatePath = path.join(__dirname, '..', '..', 'public', 'certificado-template.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    const nombresCompletos = [
        historia.primerNombre,
        historia.segundoNombre,
        historia.primerApellido,
        historia.segundoApellido
    ].filter(Boolean).join(' ').toUpperCase();

    let medicoNombre = '';
    let medicoRegistro = '';
    let medicoLicencia = '';
    let firmaMedico = '';

    const medicoKey = historia.medico ? historia.medico.toUpperCase() : '';
    if (MEDICOS_MAP[medicoKey]) {
        const medicoData = MEDICOS_MAP[medicoKey];
        medicoNombre = medicoData.nombre;
        medicoRegistro = medicoData.registro;
        medicoLicencia = medicoData.licencia;
        firmaMedico = medicoData.firma;
    } else if (medico) {
        medicoNombre = [medico.primer_nombre, medico.primer_apellido].filter(Boolean).join(' ').toUpperCase();
        medicoRegistro = medico.registro_medico ? `REGISTRO MÉDICO NO ${medico.registro_medico}` : '';
        medicoLicencia = medico.numero_licencia ? `LICENCIA SALUD OCUPACIONAL ${medico.numero_licencia}` : '';
        firmaMedico = medico.firma || '';
    } else {
        medicoNombre = historia.medico || 'MÉDICO OCUPACIONAL';
    }

    const logoUrl = '/bsl-logo.png';
    const vigencia = 'Tres años';
    const ipsSede = 'Sede norte DHSS0244914';
    const df = datosFormulario || {};

    const replacements = {
        '{{LOGO_URL}}': logoUrl,
        '{{TIPO_EXAMEN}}': historia.tipoExamen || 'OCUPACIONAL',
        '{{FECHA_ATENCION}}': formatearFechaCertificado(historia.fechaConsulta || historia.fechaAtencion),
        '{{ORDEN_ID}}': historia._id || '',
        '{{NOMBRES_COMPLETOS}}': nombresCompletos,
        '{{NUMERO_ID}}': historia.numeroId || '',
        '{{EMPRESA}}': (historia.empresa || '').toUpperCase(),
        '{{COD_EMPRESA}}': historia.codEmpresa || '',
        '{{CARGO}}': (historia.cargo || '').toUpperCase(),
        '{{CIUDAD}}': (historia.ciudad || 'BOGOTA').toUpperCase(),
        '{{VIGENCIA}}': vigencia,
        '{{IPS_SEDE}}': ipsSede,
        '{{GENERO}}': df.genero || '',
        '{{EDAD}}': df.edad || '',
        '{{FECHA_NACIMIENTO}}': df.fecha_nacimiento ? formatearFechaCertificado(df.fecha_nacimiento) : '',
        '{{ESTADO_CIVIL}}': df.estado_civil || '',
        '{{HIJOS}}': df.hijos || '0',
        '{{PROFESION}}': df.profesion_oficio || '',
        '{{EMAIL}}': df.email || historia.email || '',
        '{{EPS}}': df.eps || '',
        '{{ARL}}': df.arl || '',
        '{{PENSIONES}}': df.pensiones || '',
        '{{NIVEL_EDUCATIVO}}': df.nivel_educativo || '',
        '{{EXAMENES_HTML}}': generarExamenesHTML(historia.examenes),
        '{{RESULTADOS_HTML}}': generarResultadosHTML(historia.examenes, historia),
        '{{CONCEPTO_FINAL}}': historia.mdConceptoFinal || 'PENDIENTE',
        '{{CONCEPTO_CLASS}}': getConceptoClass(historia.mdConceptoFinal),
        '{{RECOMENDACIONES}}': historia.mdRecomendacionesMedicasAdicionales || '',
        '{{OBSERVACIONES_CERTIFICADO}}': historia.mdObservacionesCertificado || '',
        '{{MEDICO_NOMBRE}}': medicoNombre,
        '{{MEDICO_REGISTRO}}': medicoRegistro,
        '{{MEDICO_LICENCIA}}': medicoLicencia,
        '{{FIRMA_MEDICO}}': firmaMedico,
        '{{FIRMA_PACIENTE}}': firmaPaciente || '',
        '{{FOTO_URL}}': fotoUrl || ''
    };

    for (const [key, value] of Object.entries(replacements)) {
        html = html.split(key).join(value);
    }

    // Manejar condicionales simples {{#if VAR}}...{{/if}}
    if (fotoUrl) {
        html = html.replace(/\{\{#if FOTO_URL\}\}([\s\S]*?)\{\{else\}\}[\s\S]*?\{\{\/if\}\}/g, '$1');
    } else {
        html = html.replace(/\{\{#if FOTO_URL\}\}[\s\S]*?\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    }

    if (firmaMedico) {
        html = html.replace(/\{\{#if FIRMA_MEDICO\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    } else {
        html = html.replace(/\{\{#if FIRMA_MEDICO\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }

    if (firmaPaciente) {
        html = html.replace(/\{\{#if FIRMA_PACIENTE\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    } else {
        html = html.replace(/\{\{#if FIRMA_PACIENTE\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }

    if (historia.mdRecomendacionesMedicasAdicionales) {
        html = html.replace(/\{\{#if RECOMENDACIONES\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    } else {
        html = html.replace(/\{\{#if RECOMENDACIONES\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }

    if (historia.mdObservacionesCertificado) {
        html = html.replace(/\{\{#if OBSERVACIONES_CERTIFICADO\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
    } else {
        html = html.replace(/\{\{#if OBSERVACIONES_CERTIFICADO\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }

    return html;
}

/**
 * Genera un PDF a partir de HTML usando Puppeteer
 * @param {string} html - HTML a convertir
 * @param {string} baseUrl - URL base para recursos estáticos
 * @returns {Promise<Buffer>} Buffer del PDF generado
 */
async function generarPDFConPuppeteer(html, baseUrl) {
    let browser = null;

    try {
        console.log('🎭 Iniciando Puppeteer para generar PDF...');

        const launchOptions = {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--single-process',
                '--no-zygote'
            ]
        };

        if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            console.log('📍 Usando Chromium del sistema:', process.env.PUPPETEER_EXECUTABLE_PATH);
        } else {
            console.log('📍 Usando Chrome de Puppeteer (cache)');
        }

        browser = await puppeteer.launch(launchOptions);

        const page = await browser.newPage();

        await page.setContent(html, {
            waitUntil: ['load', 'networkidle0'],
            timeout: 30000
        });

        await page.evaluate((baseUrl) => {
            document.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src');
                if (src && src.startsWith('/')) {
                    img.src = baseUrl + src;
                }
            });
        }, baseUrl);

        await page.evaluate(() => {
            return Promise.all(
                Array.from(document.images).map(img => {
                    return new Promise((resolve) => {
                        if (img.complete) {
                            resolve();
                            return;
                        }
                        img.addEventListener('load', resolve);
                        img.addEventListener('error', resolve);
                        setTimeout(resolve, 5000);
                    });
                })
            );
        });

        await new Promise(resolve => setTimeout(resolve, 1000));

        const pdfData = await page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: {
                top: '0.5cm',
                right: '0.5cm',
                bottom: '0.5cm',
                left: '0.5cm'
            }
        });

        const pdfBuffer = Buffer.from(pdfData);

        const pdfHeader = pdfBuffer.slice(0, 5).toString();
        console.log('📄 PDF Header:', pdfHeader, '| Size:', pdfBuffer.length, 'bytes');

        if (!pdfHeader.startsWith('%PDF-')) {
            throw new Error('El PDF generado no es válido');
        }

        console.log('✅ PDF generado exitosamente');
        return pdfBuffer;

    } catch (error) {
        console.error('❌ Error generando PDF con Puppeteer:', error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Genera PDF navegando directamente a una URL
async function generarPDFDesdeURL(url) {
    let browser = null;

    try {
        console.log('🎭 Iniciando Puppeteer para generar PDF desde URL...');
        console.log('📍 URL:', url);

        const launchOptions = {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--single-process',
                '--no-zygote'
            ]
        };

        if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            console.log('📍 Usando Chromium del sistema:', process.env.PUPPETEER_EXECUTABLE_PATH);
        } else {
            console.log('📍 Usando Chrome de Puppeteer (cache)');
        }

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();

        await page.goto(url, {
            waitUntil: ['load', 'networkidle0'],
            timeout: 30000
        });

        await page.evaluate(() => {
            return Promise.all(
                Array.from(document.images).map(img => {
                    return new Promise((resolve) => {
                        if (img.complete) {
                            resolve();
                            return;
                        }
                        img.addEventListener('load', resolve);
                        img.addEventListener('error', resolve);
                        setTimeout(resolve, 5000);
                    });
                })
            );
        });

        await new Promise(resolve => setTimeout(resolve, 1000));

        const pdfData = await page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: {
                top: '0.5cm',
                right: '0.5cm',
                bottom: '0.5cm',
                left: '0.5cm'
            }
        });

        const pdfBuffer = Buffer.from(pdfData);

        const pdfHeader = pdfBuffer.slice(0, 5).toString();
        console.log('📄 PDF Header:', pdfHeader, '| Size:', pdfBuffer.length, 'bytes');

        if (!pdfHeader.startsWith('%PDF-')) {
            throw new Error('El PDF generado no es válido');
        }

        console.log('✅ PDF generado exitosamente desde URL');
        return pdfBuffer;

    } catch (error) {
        console.error('❌ Error generando PDF desde URL:', error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = {
    formatearFechaCertificado,
    getConceptoClass,
    generarExamenesHTML,
    generarResultadosHTML,
    generarHTMLCertificado,
    generarPDFConPuppeteer,
    generarPDFDesdeURL,
    MEDICOS_MAP
};
