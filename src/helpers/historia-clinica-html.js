'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Helper para generar el HTML completo de la Historia Clínica
 * Incluye datos de: HistoriaClinica, formularios, audiometrias,
 * visiometrias, laboratorios, pruebasADC y scl90
 */

// Logo embebido como base64 para funcionar sin servidor HTTP
let BSL_LOGO_SRC = '/bsl-logo.png'; // fallback a URL relativa
try {
    const logoPath = path.join(__dirname, '..', '..', 'public', 'bsl-logo.png');
    const logoData = fs.readFileSync(logoPath);
    BSL_LOGO_SRC = `data:image/png;base64,${logoData.toString('base64')}`;
} catch (e) {
    // Si no se puede leer, usa URL relativa (funciona cuando el servidor sirve los estáticos)
}

function v(val, fallback = '') {
    if (val === null || val === undefined || val === '') return fallback;
    return String(val);
}

function yesNo(val) {
    if (!val) return '';
    const s = String(val).toUpperCase();
    if (s === 'SI' || s === 'SÍ' || s === 'YES' || s === '1' || s === 'TRUE') return 'Sí';
    if (s === 'NO' || s === '0' || s === 'FALSE') return 'No';
    return v(val);
}

function fmt(val) {
    if (!val) return 'No';
    const s = String(val).trim().toUpperCase();
    if (s === 'SI' || s === 'SÍ' || s === 'YES' || s === '1' || s === 'TRUE') return 'Sí';
    if (s === 'NO' || s === '0' || s === 'FALSE' || s === '') return 'No';
    return val;
}

function fmtFecha(fecha) {
    if (!fecha) return '';
    try {
        const d = new Date(fecha);
        if (isNaN(d.getTime())) return String(fecha);
        return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
        return String(fecha);
    }
}

function fmtFechaLarga(fecha) {
    if (!fecha) return '';
    try {
        const d = new Date(fecha);
        if (isNaN(d.getTime())) return String(fecha);
        const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
    } catch {
        return String(fecha);
    }
}

function celda(label, value, wide = false) {
    const cls = wide ? 'cell wide' : 'cell';
    return `<div class="${cls}"><span class="label">${label}</span><span class="value">${v(value, '—')}</span></div>`;
}

function check(val) {
    return val === 'Sí' || val === 'SI' || val === 'sí' ? '☑' : '☐';
}

/* ─────────── AUDIOMETRÍA ─────────── */
function freqRow(label, data, prefix, freqs) {
    const cells = freqs.map(f => {
        const k = `${prefix}_${f}`;
        const val = data[k];
        return `<td>${val !== null && val !== undefined ? val : ''}</td>`;
    }).join('');
    return `<tr><td class="freq-label">${label}</td>${cells}</tr>`;
}

function buildAudioHTML(audio) {
    if (!audio) return '<p class="no-data">Sin datos de audiometría</p>';
    const freqs = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000];
    return `
    <div class="sub-section">
        <h4>Otoscopía</h4>
        <div class="grid-4">
            ${celda('Pabellón OI', audio.pabellon_auricular_oi)}
            ${celda('Pabellón OD', audio.pabellon_auricular_od)}
            ${celda('Conducto OI', audio.conducto_auditivo_oi)}
            ${celda('Conducto OD', audio.conducto_auditivo_od)}
            ${celda('Membrana OI', audio.membrana_timpanica_oi)}
            ${celda('Membrana OD', audio.membrana_timpanica_od)}
            ${celda('Obs. OI', audio.observaciones_oi)}
            ${celda('Obs. OD', audio.observaciones_od)}
            ${celda('Requiere Limpieza', yesNo(audio.requiere_limpieza_otica))}
            ${celda('Estado Gripal', yesNo(audio.estado_gripal))}
            ${celda('Cabina', audio.cabina)}
            ${celda('Equipo', audio.equipo)}
        </div>
    </div>
    <div class="sub-section">
        <h4>Umbrales (dB HL)</h4>
        <table class="audio-table">
            <thead>
                <tr>
                    <th>Vía / Frec.</th>
                    ${freqs.map(f => `<th>${f}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${freqRow('Aéreo OD', audio, 'aereo_od', freqs)}
                ${freqRow('Aéreo OI', audio, 'aereo_oi', freqs)}
                ${freqRow('Óseo OD', audio, 'oseo_od', [250,500,1000,2000,3000,4000,'',''].slice(0,8).map((_,i)=>[250,500,1000,2000,3000,4000][i]||''))}
                ${freqRow('Óseo OI', audio, 'oseo_oi', [250,500,1000,2000,3000,4000,'',''].slice(0,8).map((_,i)=>[250,500,1000,2000,3000,4000][i]||''))}
            </tbody>
        </table>
    </div>
    <div class="grid-2">
        ${celda('Diagnóstico OI', audio.diagnostico_oi, true)}
        ${celda('Diagnóstico OD', audio.diagnostico_od, true)}
        ${celda('Interpretación', audio.interpretacion, true)}
        ${celda('Recomendaciones', audio.recomendaciones, true)}
        ${celda('Remisión', yesNo(audio.remision))}
    </div>`;
}

/* ─────────── VISIOMETRÍA ─────────── */
function buildVisioHTML(visio) {
    if (!visio) return '<p class="no-data">Sin datos de visiometría</p>';
    return `
    <div class="grid-4">
        <div class="cell"><span class="label">Snellen</span><span class="value">${v(visio.snellen_correctas)}/${v(visio.snellen_total)} (${v(visio.snellen_porcentaje)}%)</span></div>
        <div class="cell"><span class="label">Landolt</span><span class="value">${v(visio.landolt_correctas)}/${v(visio.landolt_total)} (${v(visio.landolt_porcentaje)}%)</span></div>
        <div class="cell"><span class="label">Ishihara</span><span class="value">${v(visio.ishihara_correctas)}/${v(visio.ishihara_total)} (${v(visio.ishihara_porcentaje)}%)</span></div>
        ${celda('Concepto', visio.concepto)}
        ${celda('Miopía', yesNo(visio.miopia))}
        ${celda('Astigmatismo', yesNo(visio.astigmatismo))}
    </div>`;
}

/* ─────────── LABORATORIOS ─────────── */
function buildLabHTML(labs) {
    if (!labs || labs.length === 0) return '<p class="no-data">Sin datos de laboratorios</p>';
    const rows = labs.map(l => `
        <tr>
            <td>${v(l.tipo_prueba)}</td>
            <td>${v(l.resultado)}</td>
            <td>${v(l.valor_referencia)}</td>
            <td>${v(l.interpretacion)}</td>
            <td>${fmtFecha(l.fecha_toma || l.created_at)}</td>
        </tr>`).join('');
    return `
    <table class="data-table">
        <thead><tr><th>Prueba</th><th>Resultado</th><th>Valor Referencia</th><th>Interpretación</th><th>Fecha</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

/* ─────────── ADC ─────────── */
function buildAdcHTML(adc) {
    if (!adc) return '<p class="no-data">Sin datos de prueba ADC</p>';
    const campos = {
        de08:'Depresión 08', de29:'Depresión 29', de03:'Depresión 03', de04:'Depresión 04',
        de05:'Depresión 05', de32:'Depresión 32', de12:'Depresión 12', de06:'Depresión 06',
        an07:'Ansiedad 07', an11:'Ansiedad 11', an03:'Ansiedad 03', an18:'Ansiedad 18',
        an19:'Ansiedad 19', an04:'Ansiedad 04', an14:'Ansiedad 14', an09:'Ansiedad 09'
    };
    const items = Object.entries(campos)
        .filter(([k]) => adc[k] !== null && adc[k] !== undefined)
        .map(([k,label]) => `<div class="cell"><span class="label">${label}</span><span class="value">${v(adc[k])}</span></div>`)
        .join('');
    const resumen = ['puntaje_depresion','puntaje_ansiedad','puntaje_cognitivo',
        'categoria_depresion','categoria_ansiedad','nivel_cognitivo','interpretacion']
        .filter(k => adc[k])
        .map(k => celda(k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()), adc[k]))
        .join('');
    return `<div class="grid-4">${items}</div>${resumen ? `<div class="grid-2 mt-2">${resumen}</div>` : ''}`;
}

/* ─────────── SCL-90 ─────────── */
function buildScl90HTML(scl) {
    if (!scl) return '<p class="no-data">Sin datos SCL-90</p>';
    let interpretacion = scl.interpretacion || '';
    if (typeof interpretacion === 'string' && interpretacion.startsWith('{')) {
        try { interpretacion = JSON.parse(interpretacion); } catch(e) {}
    }
    const dimensionNames = {SOM:'Somatización',OBS:'Obsesión-Compulsión',SI:'Sensibilidad Interpersonal',
        DEP:'Depresión',ANS:'Ansiedad',HOS:'Hostilidad',FOB:'Ansiedad Fóbica',PAR:'Ideación Paranoide',
        PSIC:'Psicoticismo'};
    let dimRows = '';
    if (typeof interpretacion === 'object' && interpretacion !== null) {
        dimRows = Object.entries(dimensionNames).map(([k, nombre]) => {
            const val = interpretacion[k] || '';
            return `<tr><td>${nombre}</td><td class="dim-level dim-${v(val).toLowerCase()}">${v(val)}</td></tr>`;
        }).join('');
    }
    const gsip = scl.resultado ? (typeof scl.resultado === 'object' ? scl.resultado : {}) : {};
    return `
    ${dimRows ? `<table class="data-table"><thead><tr><th>Dimensión</th><th>Nivel</th></tr></thead><tbody>${dimRows}</tbody></table>` : ''}
    ${scl.resultado ? `<div class="grid-2 mt-2">${celda('IGSP', gsip.IGSP || gsip.igsp || '')}${celda('ISP', gsip.ISP || gsip.isp || '')}${celda('PSDI', gsip.PSDI || gsip.psdi || '')}</div>` : ''}`;
}

/* ─────────── ANTECEDENTES PERSONALES ─────────── */
function buildAntecedentesHTML(f) {
    if (!f) return '';
    const items = [
        { label: 'Presión Alta', val: f.presion_alta },
        { label: 'Problemas Cardíacos', val: f.problemas_cardiacos },
        { label: 'Problemas de Azúcar', val: f.problemas_azucar },
        { label: 'Enfermedad Pulmonar', val: f.enfermedad_pulmonar },
        { label: 'Enfermedad de Hígado', val: f.enfermedad_higado },
        { label: 'Dolor de Espalda', val: f.dolor_espalda },
        { label: 'Dolor de Cabeza', val: f.dolor_cabeza },
        { label: 'Ruido / Jaqueca', val: f.ruido_jaqueca },
        { label: 'Problemas de Sueño', val: f.problemas_sueno },
        { label: 'Cirugía Ocular', val: f.cirugia_ocular },
        { label: 'Cirugía Programada', val: f.cirugia_programada },
        { label: 'Condición Médica', val: f.condicion_medica },
        { label: 'Trastorno Psicológico', val: f.trastorno_psicologico },
        { label: 'Síntomas Psicológicos', val: f.sintomas_psicologicos },
        { label: 'Diagnóstico de Cáncer', val: f.diagnostico_cancer },
        { label: 'Enfermedades Laborales', val: f.enfermedades_laborales },
        { label: 'Enf. Osteomuscular', val: f.enfermedad_osteomuscular },
        { label: 'Enf. Autoinmune', val: f.enfermedad_autoinmune },
        { label: 'Hernias', val: f.hernias },
        { label: 'Varices', val: f.varices },
        { label: 'Hormigueos', val: f.hormigueos },
        { label: 'Embarazo', val: f.embarazo },
        { label: 'Hepatitis', val: f.hepatitis },
        { label: 'Fuma', val: f.fuma },
        { label: 'Usa Anteojos', val: f.usa_anteojos },
        { label: 'Usa Lentes de Contacto', val: f.usa_lentes_contacto },
    ];
    return items.map(i => {
        const val = fmt(i.val);
        const cls = val === 'Sí' ? 'ant-yes' : 'ant-no';
        return `<div class="ant-item ${cls}"><span class="ant-check">${check(val)}</span><span class="ant-label">${i.label}</span></div>`;
    }).join('');
}

function buildFamiliaresHTML(f) {
    if (!f) return '';
    const items = [
        { label: 'Hereditarias', val: f.familia_hereditarias },
        { label: 'Genéticas', val: f.familia_geneticas },
        { label: 'Diabetes', val: f.familia_diabetes },
        { label: 'Hipertensión', val: f.familia_hipertension },
        { label: 'Infartos', val: f.familia_infartos },
        { label: 'Cáncer', val: f.familia_cancer },
        { label: 'Trastornos', val: f.familia_trastornos },
        { label: 'Infecciosas', val: f.familia_infecciosas },
    ];
    return items.map(i => {
        const val = fmt(i.val);
        const cls = val === 'Sí' ? 'ant-yes' : 'ant-no';
        return `<div class="ant-item ${cls}"><span class="ant-check">${check(val)}</span><span class="ant-label">${i.label}</span></div>`;
    }).join('');
}

/* ─────────── HTML PRINCIPAL ─────────── */
function generarHTMLHistoriaClinica({ historia, formulario, audiometria, visiometria, laboratorios, adc, scl90 }) {
    const hc = historia || {};
    const f = formulario || {};

    const nombreCompleto = [hc.primerNombre, hc.segundoNombre, hc.primerApellido, hc.segundoApellido]
        .filter(Boolean).join(' ').toUpperCase();

    const talla = v(hc.talla || f.estatura);
    const peso = v(hc.peso || f.peso);
    const imc = (talla && peso)
        ? (() => {
            const h = parseFloat(talla);
            const p = parseFloat(peso);
            const hm = h > 10 ? h / 100 : h;
            if (!isNaN(hm) && !isNaN(p) && hm > 0) return (p / (hm * hm)).toFixed(1);
            return '';
        })()
        : '';

    // Sección exámenes
    let secExamenes = '';
    const tieneAudio = !!audiometria;
    const tieneVisio = !!visiometria;
    const tieneLabs = laboratorios && laboratorios.length > 0;
    const tieneAdc = !!adc;
    const tieneScl = !!scl90;

    if (tieneAudio) secExamenes += `
        <div class="section">
            <div class="section-title">AUDIOMETRÍA</div>
            ${buildAudioHTML(audiometria)}
        </div>`;

    if (tieneVisio) secExamenes += `
        <div class="section">
            <div class="section-title">VISIOMETRÍA</div>
            ${buildVisioHTML(visiometria)}
        </div>`;

    if (tieneLabs) secExamenes += `
        <div class="section">
            <div class="section-title">LABORATORIOS</div>
            ${buildLabHTML(laboratorios)}
        </div>`;

    if (tieneAdc) secExamenes += `
        <div class="section">
            <div class="section-title">PRUEBA ADC</div>
            ${buildAdcHTML(adc)}
        </div>`;

    if (tieneScl) secExamenes += `
        <div class="section">
            <div class="section-title">SCL-90 (Perfil Psicológico)</div>
            ${buildScl90HTML(scl90)}
        </div>`;

    const conceptoClass = (() => {
        const c = v(hc.mdConceptoFinal).toUpperCase();
        if (c.includes('NO APTO')) return 'badge-no-apto';
        if (c.includes('RESTRICCION') || c.includes('RECOMENDACION')) return 'badge-restriccion';
        if (c.includes('APLAZADO')) return 'badge-aplazado';
        if (c.includes('APTO')) return 'badge-apto';
        return 'badge-pendiente';
    })();

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Historia Clínica - ${nombreCompleto}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9.5pt; color: #111; background: #fff; }

  .page { max-width: 800px; margin: 0 auto; padding: 12px 16px; }

  /* ── HEADER ── */
  .header { display: flex; align-items: center; border-bottom: 2px solid #1a5c8a; padding-bottom: 8px; margin-bottom: 10px; }
  .header-logo { flex: 0 0 auto; margin-right: 14px; }
  .header-logo img { height: 52px; width: auto; }
  .header-info { flex: 1; }
  .header-info h1 { font-size: 14pt; color: #1a5c8a; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
  .header-info p { font-size: 8pt; color: #555; margin-top: 2px; }
  .header-meta { flex: 0 0 auto; text-align: right; font-size: 8pt; color: #333; }
  .header-meta strong { display: block; font-size: 9pt; }

  /* ── SECTIONS ── */
  .section { border: 1px solid #ccc; border-radius: 3px; margin-bottom: 8px; overflow: hidden; }
  .section-title {
    background: #1a5c8a; color: #fff; font-weight: bold; font-size: 9pt;
    padding: 4px 10px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .section-subtitle { background: #e8f0f8; color: #1a5c8a; font-weight: bold; font-size: 8.5pt; padding: 3px 10px; border-bottom: 1px solid #c5d8ec; }
  .section-body { padding: 8px 10px; }
  .sub-section { padding: 4px 0; }
  .sub-section h4 { font-size: 8.5pt; color: #1a5c8a; margin-bottom: 4px; border-bottom: 1px dashed #aac; padding-bottom: 2px; }

  /* ── CELLS ── */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; padding: 6px 0; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px 10px; padding: 6px 0; }
  .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px 10px; padding: 6px 0; }
  .cell { display: flex; flex-direction: column; }
  .cell.wide { grid-column: span 2; }
  .label { font-size: 7.5pt; color: #666; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 1px; }
  .value { font-size: 9pt; color: #111; font-weight: 500; border-bottom: 1px dotted #bbb; min-height: 14px; }
  .mt-2 { margin-top: 8px; }

  /* ── ANTECEDENTES ── */
  .ant-grid { display: flex; flex-wrap: wrap; gap: 4px 8px; padding: 6px 0; }
  .ant-item { display: flex; align-items: center; gap: 4px; font-size: 8.5pt; min-width: 160px; }
  .ant-check { font-size: 10pt; }
  .ant-yes { color: #c0392b; font-weight: bold; }
  .ant-no { color: #555; }

  /* ── AUDIOMETRÍA ── */
  .audio-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 4px; }
  .audio-table th, .audio-table td { border: 1px solid #bbb; padding: 2px 5px; text-align: center; }
  .audio-table th { background: #d8e8f5; font-weight: bold; }
  .audio-table .freq-label { text-align: left; background: #f0f6fb; font-weight: 600; }

  /* ── LABORATORIOS / GENÉRICO ── */
  .data-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 4px; }
  .data-table th { background: #1a5c8a; color: #fff; padding: 3px 8px; text-align: left; }
  .data-table td { border: 1px solid #ddd; padding: 3px 8px; }
  .data-table tr:nth-child(even) td { background: #f5f9fd; }

  /* ── SCL-90 ── */
  .dim-bajo { color: #27ae60; font-weight: bold; }
  .dim-medio { color: #e67e22; font-weight: bold; }
  .dim-alto { color: #c0392b; font-weight: bold; }

  /* ── CONCEPTO FINAL ── */
  .concepto-box { display: flex; align-items: center; gap: 12px; padding: 10px; }
  .badge { display: inline-block; padding: 5px 18px; border-radius: 4px; font-size: 11pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
  .badge-apto { background: #27ae60; color: #fff; }
  .badge-no-apto { background: #c0392b; color: #fff; }
  .badge-restriccion { background: #e67e22; color: #fff; }
  .badge-aplazado { background: #8e44ad; color: #fff; }
  .badge-pendiente { background: #7f8c8d; color: #fff; }
  .concepto-detail { flex: 1; font-size: 9pt; }
  .concepto-detail p { margin-bottom: 3px; }

  /* ── DIAGNÓSTICOS ── */
  .dx-row { display: flex; gap: 12px; padding: 4px 0; font-size: 9pt; }
  .dx-code { background: #e8f0f8; color: #1a5c8a; padding: 1px 6px; border-radius: 3px; font-weight: bold; font-size: 8.5pt; flex: 0 0 auto; }

  /* ── FIRMA ── */
  .firma-section { display: flex; gap: 16px; align-items: flex-end; padding: 8px 0; }
  .firma-box { flex: 1; text-align: center; }
  .firma-box img { max-height: 60px; max-width: 140px; object-fit: contain; }
  .firma-line { border-top: 1px solid #333; margin-top: 4px; padding-top: 2px; font-size: 8pt; }

  .no-data { color: #888; font-style: italic; padding: 6px 0; font-size: 8.5pt; }

  /* ── IMPRESIÓN ── */
  @media print {
    body { font-size: 8.5pt; }
    .page { padding: 6px 10px; }
    .section { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    <div class="header-logo">
      <img src="${BSL_LOGO_SRC}" alt="BSL">
    </div>
    <div class="header-info">
      <h1>Historia Clínica Ocupacional</h1>
      <p>BSL Salud Laboral &nbsp;|&nbsp; Sede Norte DHSS0244914</p>
      <p>Medicina del Trabajo - Salud Ocupacional</p>
    </div>
    <div class="header-meta">
      <strong>${v(hc._id)}</strong>
      <span>Fecha: ${fmtFechaLarga(hc.fechaConsulta || hc.fechaAtencion)}</span><br>
      <span>Tipo: ${v(hc.tipoExamen, 'OCUPACIONAL')}</span><br>
      <span>Estado: <b>${v(hc.atendido, 'PENDIENTE')}</b></span>
    </div>
  </div>

  <!-- I. DATOS DEL PACIENTE -->
  <div class="section">
    <div class="section-title">I. Datos del Paciente</div>
    <div class="section-body">
      <div class="grid-4">
        ${celda('Nombres completos', nombreCompleto, true)}
        ${celda('N.º Documento', hc.numeroId)}
        ${celda('Género', f.genero || hc.genero || '')}
        ${celda('Edad', f.edad || hc.edad || '')}
        ${celda('Fecha de Nacimiento', fmtFecha(f.fecha_nacimiento || hc.fechaNacimiento))}
        ${celda('Lugar de Nacimiento', f.lugar_nacimiento)}
        ${celda('Ciudad de Residencia', f.ciudad_residencia || hc.ciudad)}
        ${celda('Estado Civil', f.estado_civil)}
        ${celda('Hijos', f.hijos)}
        ${celda('Nivel Educativo', f.nivel_educativo)}
        ${celda('Profesión / Oficio', f.profesion_oficio || hc.cargo)}
        ${celda('Celular', hc.celular || f.celular)}
        ${celda('Email', hc.email || f.email, true)}
        ${celda('EPS', f.eps || hc.eps)}
        ${celda('ARL', f.arl || hc.arl)}
        ${celda('Pensiones', f.pensiones)}
      </div>
    </div>
  </div>

  <!-- II. DATOS LABORALES -->
  <div class="section">
    <div class="section-title">II. Datos Laborales</div>
    <div class="section-body">
      <div class="grid-4">
        ${celda('Empresa', hc.empresa, true)}
        ${celda('Código Empresa', hc.codEmpresa)}
        ${celda('Subempresa', hc.subempresa)}
        ${celda('Centro de Costo', hc.centro_de_costo)}
        ${celda('Cargo', hc.cargo)}
        ${celda('Tipo de Examen', hc.tipoExamen)}
        ${celda('Médico', hc.medico)}
        ${celda('Exámenes ordenados', hc.examenes, true)}
      </div>
    </div>
  </div>

  <!-- III. DATOS ANTROPOMÉTRICOS -->
  <div class="section">
    <div class="section-title">III. Datos Antropométricos</div>
    <div class="section-body">
      <div class="grid-4">
        ${celda('Talla (cm)', talla)}
        ${celda('Peso (kg)', peso)}
        ${celda('IMC', imc)}
        ${celda('Ejercicio', f.ejercicio)}
        ${celda('Fuma', fmt(f.fuma))}
        ${celda('Consumo Licor', f.consumo_licor)}
      </div>
    </div>
  </div>

  <!-- IV. ANTECEDENTES PERSONALES -->
  <div class="section">
    <div class="section-title">IV. Antecedentes Personales Patológicos</div>
    <div class="section-body">
      <div class="ant-grid">
        ${buildAntecedentesHTML(f)}
      </div>
      ${f.condicion_medica && f.condicion_medica !== 'No' && f.condicion_medica !== 'NO' ? `
      <div style="margin-top:6px;font-size:8.5pt;"><strong>Condición médica referida:</strong> ${f.condicion_medica}</div>` : ''}
    </div>
  </div>

  <!-- V. ANTECEDENTES FAMILIARES -->
  <div class="section">
    <div class="section-title">V. Antecedentes Familiares</div>
    <div class="section-body">
      <div class="ant-grid">
        ${buildFamiliaresHTML(f)}
      </div>
    </div>
  </div>

  <!-- VI. ANAMNESIS Y MOTIVO DE CONSULTA -->
  <div class="section">
    <div class="section-title">VI. Anamnesis</div>
    <div class="section-body">
      <div class="grid-2">
        ${celda('Motivo de Consulta', hc.motivoConsulta, true)}
        ${celda('Antecedentes Médicos (MD)', hc.mdAntecedentes, true)}
        ${celda('Observaciones para el Médico', hc.mdObsParaMiDocYa, true)}
      </div>
    </div>
  </div>

  <!-- VII. EXAMEN FÍSICO Y RESULTADOS -->
  <div class="section">
    <div class="section-title">VII. Examen Físico y Diagnóstico</div>
    <div class="section-body">
      <div class="grid-2">
        ${celda('Diagnóstico', hc.diagnostico, true)}
        ${celda('Tratamiento', hc.tratamiento, true)}
      </div>
      ${hc.mdDx1 ? `<div class="dx-row"><span class="dx-code">Dx1</span><span>${v(hc.mdDx1)}</span></div>` : ''}
      ${hc.mdDx2 ? `<div class="dx-row"><span class="dx-code">Dx2</span><span>${v(hc.mdDx2)}</span></div>` : ''}
    </div>
  </div>

  <!-- VIII. EXÁMENES PARACLÍNICOS -->
  ${secExamenes || `<div class="section"><div class="section-title">VIII. Exámenes Paraclínicos</div><div class="section-body"><p class="no-data">No se registraron exámenes paraclínicos</p></div></div>`}

  <!-- IX. CONCEPTO MÉDICO FINAL -->
  <div class="section">
    <div class="section-title">IX. Concepto Médico Final</div>
    <div class="section-body">
      <div class="concepto-box">
        <span class="badge ${conceptoClass}">${v(hc.mdConceptoFinal, 'PENDIENTE')}</span>
        <div class="concepto-detail">
          ${hc.mdRecomendacionesMedicasAdicionales ? `<p><strong>Recomendaciones:</strong> ${hc.mdRecomendacionesMedicasAdicionales}</p>` : ''}
          ${hc.mdObservacionesCertificado ? `<p><strong>Observaciones:</strong> ${hc.mdObservacionesCertificado}</p>` : ''}
          ${hc.mdConceptoOsteomuscular ? `<p><strong>Concepto Osteomuscular:</strong> ${hc.mdConceptoOsteomuscular}</p>` : ''}
        </div>
      </div>
    </div>
  </div>

  <!-- X. FIRMA -->
  <div class="section">
    <div class="section-title">X. Firmas</div>
    <div class="section-body">
      <div class="firma-section">
        <div class="firma-box">
          ${f.firma ? `<img src="${f.firma}" alt="Firma paciente">` : '<div style="height:50px"></div>'}
          <div class="firma-line">
            ${nombreCompleto}<br>
            C.C. ${v(hc.numeroId)}
          </div>
        </div>
        <div class="firma-box">
          <div style="height:50px"></div>
          <div class="firma-line">
            ${v(hc.medico, 'Médico Ocupacional')}<br>
            Médico Salud Ocupacional
          </div>
        </div>
      </div>
    </div>
  </div>

  <div style="text-align:center;font-size:7.5pt;color:#aaa;margin-top:6px;border-top:1px solid #eee;padding-top:4px;">
    Documento generado el ${fmtFechaLarga(new Date())} &nbsp;|&nbsp; BSL Plataforma &nbsp;|&nbsp; Uso exclusivo médico-laboral &nbsp;|&nbsp; ID: ${v(hc._id)}
  </div>
</div>
</body>
</html>`;
}

module.exports = { generarHTMLHistoriaClinica };
