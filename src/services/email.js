const nodemailer = require('nodemailer');

// Inicializar transporter SMTP (compatible con Gmail, SendGrid, AWS SES, etc.)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

const EMAIL_FROM = process.env.SMTP_FROM || process.env.SMTP_USER;

// Enviar email de confirmacion de cita al paciente
async function enviarEmailConfirmacionCita({ correo, nombreCompleto, fechaHoraCompleta, codEmpresa, empresa, ciudad, linkCalendar }) {
    if (!correo || !EMAIL_FROM) {
        console.log('[EMAIL] No se envio email: correo o SMTP no configurado');
        return { success: false, error: 'Correo o SMTP no configurado' };
    }

    try {
        const html = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
                <div style="background: #0D6EFD; padding: 24px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 22px;">BSL - Salud Ocupacional</h1>
                </div>
                <div style="padding: 32px 24px;">
                    <h2 style="color: #181818; margin-top: 0;">Confirmacion de Cita</h2>
                    <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">
                        Hola <strong>${nombreCompleto}</strong>,
                    </p>
                    <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">
                        Tu cita de examen medico ocupacional ha sido programada exitosamente.
                    </p>
                    <div style="background: #F3F4F6; border-radius: 8px; padding: 20px; margin: 24px 0;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Fecha y hora:</td>
                                <td style="padding: 8px 0; color: #181818; font-size: 14px; font-weight: 600;">${fechaHoraCompleta}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Empresa:</td>
                                <td style="padding: 8px 0; color: #181818; font-size: 14px; font-weight: 600;">${empresa || codEmpresa}</td>
                            </tr>
                            ${ciudad ? `<tr>
                                <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Ciudad:</td>
                                <td style="padding: 8px 0; color: #181818; font-size: 14px; font-weight: 600;">${ciudad}</td>
                            </tr>` : ''}
                        </table>
                    </div>
                    ${linkCalendar ? `<div style="text-align: center; margin: 24px 0;">
                        <a href="${linkCalendar}" target="_blank"
                           style="background: #0D6EFD; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600; display: inline-block;">
                            &#128197; Agregar a Google Calendar
                        </a>
                    </div>` : ''}
                    <p style="color: #4B5563; font-size: 14px; line-height: 1.6;">
                        Por favor asiste puntualmente a tu cita. Si tienes alguna pregunta, no dudes en contactarnos por WhatsApp.
                    </p>
                </div>
                <div style="background: #F9FAFB; padding: 16px 24px; text-align: center; border-top: 1px solid #E5E7EB;">
                    <p style="color: #9CA3AF; font-size: 12px; margin: 0;">BSL Salud Ocupacional - www.bsl.com.co</p>
                </div>
            </div>
        `;

        const info = await transporter.sendMail({
            from: `"BSL Salud Ocupacional" <${EMAIL_FROM}>`,
            to: correo,
            subject: `Confirmacion de cita - ${fechaHoraCompleta}`,
            html
        });

        console.log(`[EMAIL] Confirmacion enviada a ${correo} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error(`[ERROR] Error enviando email de confirmacion a ${correo}:`, err.message);
        return { success: false, error: err.message };
    }
}

// Enviar email con link al formulario medico (mismo contenido que el WhatsApp de envio-empresas)
async function enviarEmailLinkFormulario({ correo, nombreCompleto, empresa, fechaFormateada, horaFormateada, ordenId }) {
    if (!correo || !EMAIL_FROM) {
        console.log('[EMAIL] No se envio email link: correo o SMTP no configurado');
        return { success: false, error: 'Correo o SMTP no configurado' };
    }

    try {
        const formUrl = `${process.env.BASE_URL || 'https://bsl-plataforma.com'}/?_id=${ordenId}`;

        const html = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
                <div style="background: #0D6EFD; padding: 24px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 22px;">BSL - Salud Ocupacional</h1>
                </div>
                <div style="padding: 32px 24px;">
                    <h2 style="color: #181818; margin-top: 0;">Formulario Medico</h2>
                    <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">
                        Hola <strong>${nombreCompleto}</strong>,
                    </p>
                    <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">
                        La empresa <strong>${empresa}</strong> ha programado tu examen medico ocupacional
                        para el <strong>${fechaFormateada}</strong> a las <strong>${horaFormateada}</strong>.
                    </p>
                    <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">
                        Por favor diligencia el siguiente formulario antes de asistir a tu cita:
                    </p>
                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${formUrl}" target="_blank"
                           style="background: #0D6EFD; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
                            Diligenciar Formulario
                        </a>
                    </div>
                    <p style="color: #9CA3AF; font-size: 13px; line-height: 1.6;">
                        Si el boton no funciona, copia y pega este enlace en tu navegador:<br>
                        <a href="${formUrl}" style="color: #0D6EFD;">${formUrl}</a>
                    </p>
                </div>
                <div style="background: #F9FAFB; padding: 16px 24px; text-align: center; border-top: 1px solid #E5E7EB;">
                    <p style="color: #9CA3AF; font-size: 12px; margin: 0;">BSL Salud Ocupacional - www.bsl.com.co</p>
                </div>
            </div>
        `;

        const info = await transporter.sendMail({
            from: `"BSL Salud Ocupacional" <${EMAIL_FROM}>`,
            to: correo,
            subject: `Formulario medico - ${empresa}`,
            html
        });

        console.log(`[EMAIL] Link formulario enviado a ${correo} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error(`[ERROR] Error enviando email link formulario a ${correo}:`, err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    enviarEmailConfirmacionCita,
    enviarEmailLinkFormulario
};
