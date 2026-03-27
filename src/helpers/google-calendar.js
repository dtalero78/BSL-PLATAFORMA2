// Helper para generar links de Google Calendar

/**
 * Genera un link de Google Calendar para agregar un evento
 * @param {Object} params
 * @param {string} params.titulo - Título del evento
 * @param {Date} params.fechaInicio - Fecha/hora de inicio
 * @param {Date} params.fechaFin - Fecha/hora de fin (opcional, default: +1 hora)
 * @param {string} params.descripcion - Descripción del evento
 * @param {string} params.ubicacion - Ubicación del evento
 * @returns {string} URL completa de Google Calendar
 */
function generarLinkGoogleCalendar({ titulo, fechaInicio, fechaFin, descripcion, ubicacion }) {
    // Formato requerido: 20260325T150000Z (UTC)
    const formatDate = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    const fin = fechaFin || new Date(fechaInicio.getTime() + 60 * 60 * 1000); // +1 hora por defecto

    // Construir URL manualmente para evitar que URLSearchParams encodee / en dates
    const params = [
        `action=TEMPLATE`,
        `text=${encodeURIComponent(titulo)}`,
        `dates=${formatDate(fechaInicio)}/${formatDate(fin)}`,
        `details=${encodeURIComponent(descripcion || '')}`,
        `location=${encodeURIComponent(ubicacion || '')}`
    ].join('&');

    return `https://calendar.google.com/calendar/render?${params}`;
}

module.exports = { generarLinkGoogleCalendar };
