// Script para el modal de disponibilidad médica (compartido en todas las páginas)

// Variables globales para el modal de disponibilidad
window.medicoSeleccionadoId = null;
window.modalidadActual = 'presencial';
window.disponibilidadPorModalidad = {
    presencial: {},
    virtual: {}
};
window.medicosDisponibilidad = [];

const diasNombres = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Función para abrir el modal desde cualquier endpoint
window.abrirModalTiempoConsultaGlobal = function() {
    // Esperar a que el modal esté cargado en el DOM
    const modal = document.getElementById('modalTiempoConsulta');
    if (!modal) {
        // Si el modal aún no está cargado, esperar un momento y reintentar
        setTimeout(window.abrirModalTiempoConsultaGlobal, 100);
        return false;
    }

    modal.classList.add('active');
    document.getElementById('disponibilidadGuardada').classList.remove('show');
    poblarSelectMedicosDisponibilidad();
    window.modalidadActual = 'presencial';
    actualizarTabsModalidad();
    renderizarDias();
    if (typeof feather !== 'undefined') {
        feather.replace();
    }
    return false; // Prevenir navegación del enlace
};

// Función original para compatibilidad con calendario.html
window.abrirModalTiempoConsulta = function() {
    return abrirModalTiempoConsultaGlobal();
};

window.cerrarModalTiempoConsulta = function() {
    document.getElementById('modalTiempoConsulta').classList.remove('active');
    document.getElementById('selectMedicoDisponibilidad').value = '';
    document.getElementById('contenidoDisponibilidad').style.display = 'none';
    window.medicoSeleccionadoId = null;
    window.modalidadActual = 'presencial';
    window.disponibilidadPorModalidad = { presencial: {}, virtual: {} };
};

window.cambiarModalidad = function(modalidad) {
    // Guardar configuración actual antes de cambiar
    guardarConfiguracionEnMemoria(window.modalidadActual);

    // Cambiar modalidad
    window.modalidadActual = modalidad;
    actualizarTabsModalidad();

    // Renderizar días con la nueva modalidad
    renderizarDias();
};

function actualizarTabsModalidad() {
    document.querySelectorAll('.modalidad-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.modalidad === window.modalidadActual);
    });
    const label = window.modalidadActual === 'presencial' ? '(Presencial)' : '(Virtual)';
    document.getElementById('modalidadActualLabel').textContent = label;
    if (typeof feather !== 'undefined') {
        feather.replace();
    }
}

function generarOpcionesHora() {
    let opciones = '';
    for (let hora = 6; hora <= 22; hora++) {
        for (let minuto = 0; minuto < 60; minuto += 30) {
            const horaStr = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
            const hora12 = hora > 12 ? hora - 12 : hora;
            const minutoStr = String(minuto).padStart(2, '0');
            const ampm = hora >= 12 ? 'PM' : 'AM';
            opciones += `<option value="${horaStr}">${hora12}:${minutoStr} ${ampm}</option>`;
        }
    }
    return opciones;
}

function renderizarDias() {
    const container = document.getElementById('diasContainer');
    const config = window.disponibilidadPorModalidad[window.modalidadActual];
    const opcionesHora = generarOpcionesHora();

    // Orden: Lunes(1) a Sábado(6), luego Domingo(0)
    const ordenDias = [1, 2, 3, 4, 5, 6, 0];

    let html = '';
    for (const dia of ordenDias) {
        const diaConfig = config[dia] || { activo: false, rangos: [] };
        const activo = diaConfig.activo;
        const rangos = diaConfig.rangos && diaConfig.rangos.length > 0
            ? diaConfig.rangos
            : [{ hora_inicio: '08:00', hora_fin: '17:00' }];

        html += `
            <div class="dia-container" data-dia="${dia}">
                <div class="dia-header">
                    <div class="dia-checkbox">
                        <input type="checkbox" id="dia-${dia}" ${activo ? 'checked' : ''} onchange="toggleDia(${dia})">
                        <label for="dia-${dia}">${diasNombres[dia]}</label>
                    </div>
                </div>
                <div class="rangos-container" id="rangos-${dia}" style="${activo ? '' : 'display: none;'}">
                    ${rangos.map((rango, idx) => `
                        <div class="rango-row" data-rango-idx="${idx}">
                            <select class="rango-inicio" ${!activo ? 'disabled' : ''}>
                                ${opcionesHora.replace(`value="${rango.hora_inicio}"`, `value="${rango.hora_inicio}" selected`)}
                            </select>
                            <span>a</span>
                            <select class="rango-fin" ${!activo ? 'disabled' : ''}>
                                ${opcionesHora.replace(`value="${rango.hora_fin}"`, `value="${rango.hora_fin}" selected`)}
                            </select>
                            ${rangos.length > 1 ? `<button type="button" class="btn-eliminar-rango" onclick="eliminarRango(${dia}, ${idx})">×</button>` : ''}
                            <button type="button" class="btn-agregar-rango" onclick="agregarRango(${dia})">+</button>
                        </div>
                    `).join('')}
                    <button type="button" class="btn-copiar-todos" onclick="copiarATodos(${dia})" id="btn-copiar-${dia}">
                        Copiar a todos los días
                    </button>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

window.toggleDia = function(dia) {
    const checkbox = document.getElementById(`dia-${dia}`);
    const rangosContainer = document.getElementById(`rangos-${dia}`);
    const activo = checkbox.checked;

    rangosContainer.style.display = activo ? 'block' : 'none';

    // Habilitar/deshabilitar selects
    rangosContainer.querySelectorAll('select').forEach(select => {
        select.disabled = !activo;
    });
};

window.copiarATodos = function(diaOrigen) {
    // Obtener los rangos del día origen
    const rangosContainer = document.getElementById(`rangos-${diaOrigen}`);
    const rangosRows = rangosContainer.querySelectorAll('.rango-row');

    const rangosOrigen = [];
    rangosRows.forEach(row => {
        const inicio = row.querySelector('.rango-inicio');
        const fin = row.querySelector('.rango-fin');
        if (inicio && fin) {
            rangosOrigen.push({
                hora_inicio: inicio.value,
                hora_fin: fin.value
            });
        }
    });

    if (rangosOrigen.length === 0) return;

    // Aplicar a TODOS los días (incluyendo el origen)
    const ordenDias = [0, 1, 2, 3, 4, 5, 6];
    for (const dia of ordenDias) {
        // Activar el checkbox (si no es el origen, ya está activo)
        if (dia !== diaOrigen) {
            const checkbox = document.getElementById(`dia-${dia}`);
            checkbox.checked = true;
        }

        // Actualizar la configuración en memoria para TODOS los días
        window.disponibilidadPorModalidad[window.modalidadActual][dia] = {
            activo: true,
            rangos: [...rangosOrigen]
        };
    }

    // Re-renderizar para mostrar los cambios
    renderizarDias();

    // Mostrar confirmación visual
    const btn = document.getElementById(`btn-copiar-${diaOrigen}`);
    const textoOriginal = btn.textContent;
    btn.textContent = '✓ Copiado';
    btn.style.background = '#10B981';
    btn.style.color = 'white';
    setTimeout(() => {
        btn.textContent = textoOriginal;
        btn.style.background = '';
        btn.style.color = '';
    }, 1500);
};

window.agregarRango = function(dia) {
    const opcionesHora = generarOpcionesHora();
    const rangosContainer = document.getElementById(`rangos-${dia}`);
    const rangos = rangosContainer.querySelectorAll('.rango-row');
    const nuevoIdx = rangos.length;

    const nuevoRango = document.createElement('div');
    nuevoRango.className = 'rango-row';
    nuevoRango.dataset.rangoIdx = nuevoIdx;
    nuevoRango.innerHTML = `
        <select class="rango-inicio">
            ${opcionesHora.replace('value="14:00"', 'value="14:00" selected')}
        </select>
        <span>a</span>
        <select class="rango-fin">
            ${opcionesHora.replace('value="18:00"', 'value="18:00" selected')}
        </select>
        <button type="button" class="btn-eliminar-rango" onclick="eliminarRango(${dia}, ${nuevoIdx})">×</button>
        <button type="button" class="btn-agregar-rango" onclick="agregarRango(${dia})">+</button>
    `;

    rangosContainer.insertBefore(nuevoRango, rangosContainer.querySelector('.btn-copiar-todos'));

    // Agregar botón eliminar al primer rango si ahora hay más de uno
    if (rangos.length === 1) {
        const primerRango = rangos[0];
        if (!primerRango.querySelector('.btn-eliminar-rango')) {
            const btnEliminar = document.createElement('button');
            btnEliminar.type = 'button';
            btnEliminar.className = 'btn-eliminar-rango';
            btnEliminar.onclick = () => eliminarRango(dia, 0);
            btnEliminar.textContent = '×';
            // Insertar antes del botón "+"
            const btnAgregar = primerRango.querySelector('.btn-agregar-rango');
            primerRango.insertBefore(btnEliminar, btnAgregar);
        }
    }
};

window.eliminarRango = function(dia, idx) {
    const rangosContainer = document.getElementById(`rangos-${dia}`);
    const rangos = rangosContainer.querySelectorAll('.rango-row');

    if (rangos.length <= 1) return; // No eliminar si es el único

    rangos[idx].remove();

    // Re-indexar rangos y actualizar onclick
    const nuevosRangos = rangosContainer.querySelectorAll('.rango-row');
    nuevosRangos.forEach((rango, nuevoIdx) => {
        rango.dataset.rangoIdx = nuevoIdx;
        const btn = rango.querySelector('.btn-eliminar-rango');
        if (btn) {
            btn.onclick = () => eliminarRango(dia, nuevoIdx);
        }
    });

    // Si solo queda uno, quitar el botón eliminar
    if (nuevosRangos.length === 1) {
        const btn = nuevosRangos[0].querySelector('.btn-eliminar-rango');
        if (btn) btn.remove();
    }
};

function guardarConfiguracionEnMemoria(modalidad) {
    window.disponibilidadPorModalidad[modalidad] = {};

    const ordenDias = [0, 1, 2, 3, 4, 5, 6];
    for (const dia of ordenDias) {
        const checkbox = document.getElementById(`dia-${dia}`);
        if (!checkbox) continue;

        const activo = checkbox.checked;
        const rangosContainer = document.getElementById(`rangos-${dia}`);
        const rangosRows = rangosContainer ? rangosContainer.querySelectorAll('.rango-row') : [];

        const rangos = [];
        rangosRows.forEach(row => {
            const inicio = row.querySelector('.rango-inicio');
            const fin = row.querySelector('.rango-fin');
            if (inicio && fin) {
                rangos.push({
                    hora_inicio: inicio.value,
                    hora_fin: fin.value
                });
            }
        });

        window.disponibilidadPorModalidad[modalidad][dia] = {
            activo,
            rangos: rangos.length > 0 ? rangos : [{ hora_inicio: '08:00', hora_fin: '17:00' }]
        };
    }
}

async function poblarSelectMedicosDisponibilidad() {
    const select = document.getElementById('selectMedicoDisponibilidad');
    select.innerHTML = '<option value="">Seleccionar médico...</option>';

    try {
        // Cargar médicos desde el endpoint
        const response = await fetch('/api/medicos');
        const result = await response.json();

        if (result.success) {
            window.medicosDisponibilidad = result.data;

            result.data.forEach(medico => {
                const option = document.createElement('option');
                option.value = medico.id;
                option.textContent = `${medico.primer_nombre} ${medico.primer_apellido}`;
                option.dataset.tiempoConsulta = medico.tiempo_consulta || 10;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error cargando médicos:', error);
    }
}

window.cargarDisponibilidadMedico = async function() {
    const select = document.getElementById('selectMedicoDisponibilidad');
    const medicoId = select.value;
    const contenido = document.getElementById('contenidoDisponibilidad');

    if (!medicoId) {
        contenido.style.display = 'none';
        window.medicoSeleccionadoId = null;
        return;
    }

    window.medicoSeleccionadoId = medicoId;
    contenido.style.display = 'block';
    document.getElementById('disponibilidadGuardada').classList.remove('show');

    // Obtener tiempo de consulta del médico seleccionado
    const option = select.options[select.selectedIndex];
    document.getElementById('inputTiempoConsulta').value = option.dataset.tiempoConsulta || 10;

    // Resetear configuración en memoria
    window.disponibilidadPorModalidad = { presencial: {}, virtual: {} };

    // Cargar disponibilidad existente para AMBAS modalidades
    try {
        // Cargar presencial (agrupado por día con múltiples rangos)
        const responsePresencial = await fetch(`/api/medicos/${medicoId}/disponibilidad?modalidad=presencial&agrupado=true`);
        const resultPresencial = await responsePresencial.json();

        if (resultPresencial.success && resultPresencial.data.length > 0) {
            resultPresencial.data.forEach(config => {
                const dia = config.dia_semana;
                window.disponibilidadPorModalidad.presencial[dia] = {
                    activo: true,
                    rangos: config.rangos || [{ hora_inicio: '08:00', hora_fin: '17:00' }]
                };
            });
        }

        // Cargar virtual (agrupado por día con múltiples rangos)
        const responseVirtual = await fetch(`/api/medicos/${medicoId}/disponibilidad?modalidad=virtual&agrupado=true`);
        const resultVirtual = await responseVirtual.json();

        if (resultVirtual.success && resultVirtual.data.length > 0) {
            resultVirtual.data.forEach(config => {
                const dia = config.dia_semana;
                window.disponibilidadPorModalidad.virtual[dia] = {
                    activo: true,
                    rangos: config.rangos || [{ hora_inicio: '08:00', hora_fin: '17:00' }]
                };
            });
        }

        // Mostrar la modalidad actual (presencial por defecto)
        window.modalidadActual = 'presencial';
        actualizarTabsModalidad();
        renderizarDias();

    } catch (error) {
        console.error('Error al cargar disponibilidad:', error);
    }
};

window.guardarDisponibilidad = async function() {
    if (!window.medicoSeleccionadoId) {
        alert('Seleccione un médico primero');
        return;
    }

    const btn = document.querySelector('.btn-guardar-disponibilidad');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    // Guardar configuración actual en memoria antes de enviar
    guardarConfiguracionEnMemoria(window.modalidadActual);

    try {
        // 1. Guardar tiempo de consulta
        const tiempoConsulta = parseInt(document.getElementById('inputTiempoConsulta').value);

        await fetch(`/api/medicos/${window.medicoSeleccionadoId}/tiempo-consulta`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tiempoConsulta })
        });

        // 2. Guardar disponibilidad PRESENCIAL (con múltiples rangos)
        const disponibilidadPresencial = [];
        for (let dia = 0; dia <= 6; dia++) {
            const config = window.disponibilidadPorModalidad.presencial[dia];
            disponibilidadPresencial.push({
                dia_semana: dia,
                activo: config ? config.activo : false,
                rangos: config && config.rangos ? config.rangos : [{ hora_inicio: '08:00', hora_fin: '17:00' }]
            });
        }

        await fetch(`/api/medicos/${window.medicoSeleccionadoId}/disponibilidad`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ disponibilidad: disponibilidadPresencial, modalidad: 'presencial' })
        });

        // 3. Guardar disponibilidad VIRTUAL (con múltiples rangos)
        const disponibilidadVirtual = [];
        for (let dia = 0; dia <= 6; dia++) {
            const config = window.disponibilidadPorModalidad.virtual[dia];
            disponibilidadVirtual.push({
                dia_semana: dia,
                activo: config ? config.activo : false,
                rangos: config && config.rangos ? config.rangos : [{ hora_inicio: '08:00', hora_fin: '17:00' }]
            });
        }

        const response = await fetch(`/api/medicos/${window.medicoSeleccionadoId}/disponibilidad`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ disponibilidad: disponibilidadVirtual, modalidad: 'virtual' })
        });

        const result = await response.json();

        if (result.success) {
            document.getElementById('disponibilidadGuardada').classList.add('show');

            // Actualizar tiempo consulta en memoria
            const medicoIndex = window.medicosDisponibilidad.findIndex(m => m.id == window.medicoSeleccionadoId);
            if (medicoIndex !== -1) {
                window.medicosDisponibilidad[medicoIndex].tiempo_consulta = tiempoConsulta;
            }

            // Actualizar dataset del option
            const select = document.getElementById('selectMedicoDisponibilidad');
            const option = select.options[select.selectedIndex];
            option.dataset.tiempoConsulta = tiempoConsulta;
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al guardar la configuración');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar Configuración';
    }
};

// Cargar el modal cuando el DOM esté listo
(function() {
    // Cargar el modal HTML
    fetch('/components/modal-disponibilidad.html')
        .then(response => response.text())
        .then(html => {
            // Buscar si ya existe el contenedor del modal
            let modalContainer = document.getElementById('modal-disponibilidad-container');
            if (!modalContainer) {
                // Crear contenedor si no existe
                modalContainer = document.createElement('div');
                modalContainer.id = 'modal-disponibilidad-container';
                document.body.appendChild(modalContainer);
            }
            modalContainer.innerHTML = html;

            // Cerrar modal al hacer clic fuera
            const modal = document.getElementById('modalTiempoConsulta');
            if (modal) {
                modal.addEventListener('click', (e) => {
                    if (e.target.classList.contains('modal')) {
                        cerrarModalTiempoConsulta();
                    }
                });
            }

            // Reemplazar iconos de feather si está disponible
            if (typeof feather !== 'undefined') {
                feather.replace();
            }
        })
        .catch(error => {
            console.error('Error cargando modal de disponibilidad:', error);
        });
})();
