const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { generarHTMLCertificado, generarPDFConPuppeteer, generarPDFDesdeURL } = require('../helpers/certificate');
const { generarHTMLHistoriaClinica } = require('../helpers/historia-clinica-html');

// GET /preview-certificado/:id - Preview HTML del certificado médico
router.get('/preview-certificado/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📄 Generando preview de certificado para orden: ${id}`);

        // 1. Obtener datos de HistoriaClinica
        const historiaResult = await pool.query(
            'SELECT * FROM "HistoriaClinica" WHERE "_id" = $1',
            [id]
        );

        if (historiaResult.rows.length === 0) {
            return res.status(404).send('<h1>Orden no encontrada</h1>');
        }

        const historia = historiaResult.rows[0];

        // 2. Obtener datos completos del formulario (foto, firma y demográficos)
        let fotoUrl = null;
        let firmaPaciente = null;
        let datosFormulario = {};

        const formularioResult = await pool.query(`
            SELECT foto_url, firma, genero, edad, estado_civil, hijos,
                   profesion_oficio, fecha_nacimiento, email, eps, arl,
                   pensiones, nivel_educativo
            FROM formularios
            WHERE (wix_id = $1 OR numero_id = $2)
            ORDER BY fecha_registro DESC LIMIT 1
        `, [id, historia.numeroId]);

        if (formularioResult.rows.length > 0) {
            const formData = formularioResult.rows[0];
            fotoUrl = formData.foto_url;
            firmaPaciente = formData.firma;
            datosFormulario = formData;
        }

        // 3. Obtener datos del médico (si está registrado)
        let medico = null;
        if (historia.medico) {
            const medicoResult = await pool.query(`
                SELECT * FROM medicos
                WHERE CONCAT(primer_nombre, ' ', primer_apellido) ILIKE $1
                   OR CONCAT(primer_nombre, ' ', segundo_nombre, ' ', primer_apellido) ILIKE $1
                LIMIT 1
            `, [`%${historia.medico}%`]);

            if (medicoResult.rows.length > 0) {
                medico = medicoResult.rows[0];
            }
        }

        // 4. Generar HTML
        const html = generarHTMLCertificado(historia, medico, fotoUrl, firmaPaciente, datosFormulario);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);

    } catch (error) {
        console.error('❌ Error generando preview de certificado:', error);
        res.status(500).send('<h1>Error generando certificado</h1><p>' + error.message + '</p>');
    }
});

// GET /api/certificado-pdf/:id - Genera y descarga el PDF del certificado médico
router.get('/api/certificado-pdf/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📄 Generando PDF de certificado para orden: ${id}`);

        // 1. Verificar que la orden existe y obtener numeroId para el nombre del archivo
        const historiaResult = await pool.query(
            'SELECT "numeroId" FROM "HistoriaClinica" WHERE "_id" = $1',
            [id]
        );

        if (historiaResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Orden no encontrada'
            });
        }

        const numeroId = historiaResult.rows[0].numeroId;

        // 2. Construir URL del preview (el preview tiene toda la lógica de datos)
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const previewUrl = `${protocol}://${host}/preview-certificado/${id}`;
        console.log('📍 Preview URL:', previewUrl);

        // 3. Generar PDF navegando a la URL del preview
        const pdfBuffer = await generarPDFDesdeURL(previewUrl);

        // 4. Nombre del archivo
        const nombreArchivo = `certificado_${numeroId || id}_${Date.now()}.pdf`;

        // 5. Configurar headers de respuesta
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        res.send(pdfBuffer);

        console.log(`✅ PDF enviado: ${nombreArchivo} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);

    } catch (error) {
        console.error('❌ Error generando PDF de certificado:', error);
        res.status(500).json({
            success: false,
            message: 'Error generando el PDF del certificado',
            error: error.message
        });
    }
});

// GET /descarga-empresas/:codEmpresa - Página pública para descargar certificados de una empresa
router.get('/descarga-empresas/:codEmpresa', async (req, res) => {
    res.sendFile(require('path').join(__dirname, '..', '..', 'public', 'descarga-empresas.html'));
});

// IMPORTANTE: ruta con /pdf/ debe ir ANTES de la ruta con :codEmpresa para evitar conflicto
// GET /api/descarga-empresas/pdf/:id - Descarga directa del PDF de un certificado (público)
router.get('/api/descarga-empresas/pdf/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📄 Descarga directa de certificado para orden: ${id}`);

        const historiaResult = await pool.query(
            'SELECT "numeroId", "atendido" FROM "HistoriaClinica" WHERE "_id" = $1',
            [id]
        );

        if (historiaResult.rows.length === 0) {
            return res.status(404).send('<h1>Certificado no encontrado</h1>');
        }

        const historia = historiaResult.rows[0];

        if (historia.atendido !== 'ATENDIDO') {
            return res.status(400).send('<h1>Certificado no disponible</h1><p>El paciente aún no ha sido atendido.</p>');
        }

        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const previewUrl = `${protocol}://${host}/preview-certificado/${id}`;

        const pdfBuffer = await generarPDFDesdeURL(previewUrl);
        const nombreArchivo = `certificado_${historia.numeroId || id}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);

        console.log(`✅ Certificado descargado: ${nombreArchivo} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);

    } catch (error) {
        console.error('❌ Error en descarga de certificado:', error);
        res.status(500).send('<h1>Error generando certificado</h1><p>Por favor intente nuevamente.</p>');
    }
});

// GET /api/descarga-empresas/:codEmpresa - API: lista certificados disponibles de una empresa
router.get('/api/descarga-empresas/:codEmpresa', async (req, res) => {
    try {
        const { codEmpresa } = req.params;
        const { documento } = req.query;
        console.log(`📄 Consultando certificados para empresa: ${codEmpresa}`);

        let query = `
            SELECT "_id", "numeroId", "primerNombre", "segundoNombre",
                   "primerApellido", "segundoApellido", "atendido",
                   "fechaConsulta", "fechaAtencion", "examenes", "mdConceptoFinal"
            FROM "HistoriaClinica"
            WHERE "codEmpresa" = $1
              AND "fechaConsulta" IS NOT NULL
              AND "fechaConsulta" != ''
        `;
        const params = [codEmpresa];

        if (documento) {
            query += ` AND "numeroId" = $2`;
            params.push(documento);
        }

        query += ` ORDER BY "fechaConsulta" DESC LIMIT 100`;

        const result = await pool.query(query, params);

        const certificados = result.rows.map(row => ({
            _id: row._id,
            nombres: [row.primerNombre, row.segundoNombre].filter(Boolean).join(' '),
            apellidos: [row.primerApellido, row.segundoApellido].filter(Boolean).join(' '),
            numeroId: row.numeroId,
            estado: row.atendido,
            fechaConsulta: row.fechaConsulta,
            fechaAtencion: row.fechaAtencion,
            examenes: row.examenes,
            concepto: row.mdConceptoFinal
        }));

        res.json({ success: true, certificados, codEmpresa });

    } catch (error) {
        console.error('❌ Error consultando certificados empresa:', error);
        res.status(500).json({ success: false, message: 'Error al consultar certificados' });
    }
});

// GET /api/validar-certificado/:numeroId - Valida la existencia de un certificado médico
router.get('/api/validar-certificado/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;
        console.log(`🔍 Validando certificado para documento: ${numeroId}`);

        // Buscar el último registro ATENDIDO para este número de documento
        const query = `
            SELECT "_id", "numeroId", "primerNombre", "segundoNombre",
                   "primerApellido", "segundoApellido", "fechaConsulta",
                   "examenes", "mdConceptoFinal"
            FROM "HistoriaClinica"
            WHERE "numeroId" = $1
              AND "atendido" = 'ATENDIDO'
              AND "mdConceptoFinal" IS NOT NULL
              AND "mdConceptoFinal" != ''
            ORDER BY "fechaConsulta" DESC NULLS LAST, "_createdDate" DESC
            LIMIT 1
        `;

        const result = await pool.query(query, [numeroId]);

        if (result.rows.length === 0) {
            return res.json({
                success: true,
                existe: false,
                message: 'No se encontró certificado médico para este documento'
            });
        }

        const paciente = result.rows[0];

        // Formatear fecha de consulta
        let fechaConsultaFormateada = 'No disponible';
        if (paciente.fechaConsulta) {
            const fecha = new Date(paciente.fechaConsulta);
            fechaConsultaFormateada = fecha.toLocaleDateString('es-CO', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }

        // Construir nombre completo
        const nombreCompleto = [
            paciente.primerNombre,
            paciente.segundoNombre,
            paciente.primerApellido,
            paciente.segundoApellido
        ].filter(Boolean).join(' ');

        // Formatear exámenes
        const examenesFormateados = paciente.examenes || 'No especificado';

        res.json({
            success: true,
            existe: true,
            datos: {
                nombre: nombreCompleto,
                fechaConsulta: fechaConsultaFormateada,
                examenes: examenesFormateados
            }
        });

        console.log(`✅ Certificado validado para: ${nombreCompleto}`);

    } catch (error) {
        console.error('❌ Error validando certificado:', error);
        res.status(500).json({
            success: false,
            existe: false,
            message: 'Error al validar el certificado. Por favor intente nuevamente.'
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// HISTORIA CLÍNICA COMPLETA (preview + PDF)
// ─────────────────────────────────────────────────────────────────────────────

// GET /preview-historia-clinica/:id  — devuelve HTML completo
router.get('/preview-historia-clinica/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📋 Generando preview de historia clínica para: ${id}`);

        // 1. Historia Clínica
        const hcResult = await pool.query(
            'SELECT * FROM "HistoriaClinica" WHERE "_id" = $1',
            [id]
        );
        if (hcResult.rows.length === 0) {
            return res.status(404).send('<h1>Historia clínica no encontrada</h1>');
        }
        const historia = hcResult.rows[0];

        // 2. Formulario (datos demográficos + antecedentes + firma)
        let formulario = null;
        const fResult = await pool.query(`
            SELECT * FROM formularios
            WHERE wix_id = $1 OR numero_id = $2
            ORDER BY fecha_registro DESC LIMIT 1
        `, [id, historia.numeroId]);
        if (fResult.rows.length > 0) formulario = fResult.rows[0];

        // 3. Audiometría
        let audiometria = null;
        const audioResult = await pool.query(
            'SELECT * FROM audiometrias WHERE orden_id = $1 LIMIT 1', [id]
        );
        if (audioResult.rows.length > 0) audiometria = audioResult.rows[0];

        // 4. Visiometría (presencial primero, luego virtual)
        let visiometria = null;
        const visioResult = await pool.query(
            'SELECT * FROM visiometrias WHERE orden_id = $1 LIMIT 1', [id]
        );
        if (visioResult.rows.length > 0) {
            visiometria = visioResult.rows[0];
        } else {
            const visioVirtResult = await pool.query(
                'SELECT * FROM visiometrias_virtual WHERE orden_id = $1 LIMIT 1', [id]
            );
            if (visioVirtResult.rows.length > 0) visiometria = visioVirtResult.rows[0];
        }

        // 5. Laboratorios
        let laboratorios = [];
        const labResult = await pool.query(
            'SELECT * FROM laboratorios WHERE orden_id = $1 ORDER BY created_at ASC', [id]
        );
        if (labResult.rows.length > 0) laboratorios = labResult.rows;

        // 6. Prueba ADC
        let adc = null;
        const adcResult = await pool.query(
            'SELECT * FROM "pruebasADC" WHERE orden_id = $1 LIMIT 1', [id]
        );
        if (adcResult.rows.length > 0) adc = adcResult.rows[0];

        // 7. SCL-90
        let scl90 = null;
        const sclResult = await pool.query(
            'SELECT * FROM scl90 WHERE orden_id = $1 LIMIT 1', [id]
        );
        if (sclResult.rows.length > 0) scl90 = sclResult.rows[0];

        const html = generarHTMLHistoriaClinica({
            historia,
            formulario,
            audiometria,
            visiometria,
            laboratorios,
            adc,
            scl90
        });

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);

    } catch (error) {
        console.error('❌ Error generando preview de historia clínica:', error);
        res.status(500).send('<h1>Error generando historia clínica</h1><p>' + error.message + '</p>');
    }
});

// GET /api/historia-clinica-pdf/:id  — genera y descarga el PDF
router.get('/api/historia-clinica-pdf/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📄 Generando PDF de historia clínica para: ${id}`);

        // Verificar que la orden existe
        const hcCheck = await pool.query(
            'SELECT "numeroId" FROM "HistoriaClinica" WHERE "_id" = $1', [id]
        );
        if (hcCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Historia clínica no encontrada' });
        }
        const numeroId = hcCheck.rows[0].numeroId;

        // Construir URL del preview
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const previewUrl = `${protocol}://${host}/preview-historia-clinica/${id}`;
        console.log('📍 Preview URL:', previewUrl);

        const pdfBuffer = await generarPDFDesdeURL(previewUrl);

        const nombreArchivo = `historia_clinica_${numeroId || id}_${Date.now()}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);

        console.log(`✅ PDF historia clínica enviado: ${nombreArchivo} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);

    } catch (error) {
        console.error('❌ Error generando PDF de historia clínica:', error);
        res.status(500).json({
            success: false,
            message: 'Error generando el PDF de la historia clínica',
            error: error.message
        });
    }
});

module.exports = router;
