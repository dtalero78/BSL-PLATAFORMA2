const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { generarHTMLCertificado, generarPDFConPuppeteer, generarPDFDesdeURL } = require('../helpers/certificate');

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

module.exports = router;
