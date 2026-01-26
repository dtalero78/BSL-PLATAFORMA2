// ========== HELPER: Construir fecha de atención correcta ==========
// Recibe fecha y hora en zona horaria Colombia y retorna un Date UTC correcto
// fecha: YYYY-MM-DD o YYYY-MM-DDTHH:MM (datetime-local)
// hora: HH:MM (hora Colombia) - opcional si ya viene en fecha
function construirFechaAtencionColombia(fecha, hora) {
    if (!fecha) return null;

    let fechaStr, horaStr;

    // Si viene un ISO string completo (2025-12-11T16:40:00.000Z), usarlo directamente
    // pero necesitamos la hora que el usuario seleccionó (hora Colombia)
    if (typeof fecha === 'string' && fecha.includes('T')) {
        const partes = fecha.split('T');
        fechaStr = partes[0];
        // Si viene hora como parámetro, usarla; si no, extraer del ISO
        if (hora) {
            horaStr = hora;
        } else {
            // Extraer hora del ISO (puede tener formato HH:MM:SS.sssZ o HH:MM:SS o HH:MM)
            let horaParte = partes[1] || '08:00';
            // Limpiar sufijos como Z, +00:00, .000Z
            horaParte = horaParte.replace(/[Z].*$/, '').replace(/\.\d+.*$/, '').replace(/[+-]\d{2}:\d{2}$/, '');
            horaStr = horaParte.substring(0, 5); // Tomar solo HH:MM
        }
    } else if (typeof fecha === 'string') {
        fechaStr = fecha;
        horaStr = hora || '08:00';
    } else {
        // Si fecha no es string, intentar convertir
        try {
            const fechaObj = new Date(fecha);
            if (isNaN(fechaObj.getTime())) return null;
            return fechaObj;
        } catch (e) {
            console.log(`⚠️ construirFechaAtencionColombia: fecha inválida`, fecha);
            return null;
        }
    }

    // Validar formato de fecha YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
        console.log(`⚠️ construirFechaAtencionColombia: formato de fecha inválido`, fechaStr);
        return null;
    }

    // Normalizar hora: convertir "7:00" a "07:00", "9:30" a "09:30", etc.
    if (horaStr) {
        const horaParts = horaStr.split(':');
        if (horaParts.length >= 2) {
            const hh = horaParts[0].padStart(2, '0');
            const mm = horaParts[1].padStart(2, '0');
            const ss = horaParts[2] ? horaParts[2].padStart(2, '0') : '00';
            horaStr = `${hh}:${mm}:${ss}`;
        } else {
            horaStr = '08:00:00'; // Default si el formato es inválido
        }
    } else {
        horaStr = '08:00:00';
    }

    // Construir la fecha con offset Colombia (UTC-5)
    // Ejemplo: 2025-12-11T11:40:00-05:00 -> Se interpreta como 11:40 AM Colombia -> 16:40 UTC
    const fechaCompleta = `${fechaStr}T${horaStr}-05:00`;

    console.log(`📅 construirFechaAtencionColombia: ${fecha} + ${hora} -> ${fechaCompleta}`);

    const resultado = new Date(fechaCompleta);

    // Validar que el resultado sea válido
    if (isNaN(resultado.getTime())) {
        console.log(`⚠️ construirFechaAtencionColombia: resultado inválido para ${fechaCompleta}`);
        return null;
    }

    return resultado;
}

module.exports = { construirFechaAtencionColombia };
