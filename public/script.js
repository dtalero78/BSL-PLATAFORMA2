document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('formularioMedico');
    const mensaje = document.getElementById('mensaje');

    // Mostrar/ocultar campos condicionales
    const medicamentosRadio = document.querySelectorAll('input[name="medicamentos"]');
    const cirugiasRadio = document.querySelectorAll('input[name="cirugias"]');
    const alergiasRadio = document.querySelectorAll('input[name="alergias"]');

    medicamentosRadio.forEach(radio => {
        radio.addEventListener('change', function() {
            const detalle = document.getElementById('medicamentosDetalle');
            detalle.style.display = this.value === 'Si' ? 'block' : 'none';
        });
    });

    cirugiasRadio.forEach(radio => {
        radio.addEventListener('change', function() {
            const detalle = document.getElementById('cirugiasDetalle');
            detalle.style.display = this.value === 'Si' ? 'block' : 'none';
        });
    });

    alergiasRadio.forEach(radio => {
        radio.addEventListener('change', function() {
            const detalle = document.getElementById('alergiasDetalle');
            detalle.style.display = this.value === 'Si' ? 'block' : 'none';
        });
    });

    // Manejar envío del formulario
    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        // Recopilar datos del formulario
        const formData = new FormData(form);
        const datos = {};

        // Campos simples
        for (let [key, value] of formData.entries()) {
            if (key !== 'enfermedades' && key !== 'antecedentesFamiliares') {
                datos[key] = value;
            }
        }

        // Campos de checkboxes múltiples
        datos.enfermedades = [];
        formData.getAll('enfermedades').forEach(enfermedad => {
            datos.enfermedades.push(enfermedad);
        });

        datos.antecedentesFamiliares = [];
        formData.getAll('antecedentesFamiliares').forEach(antecedente => {
            datos.antecedentesFamiliares.push(antecedente);
        });

        try {
            // Enviar datos al servidor
            const response = await fetch('/api/formulario', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(datos)
            });

            const result = await response.json();

            if (result.success) {
                mostrarMensaje('✅ Formulario enviado correctamente', 'success');
                form.reset();

                // Scroll al mensaje
                mensaje.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Mostrar datos en consola
                console.log('Datos guardados:', result.data);
            } else {
                mostrarMensaje('❌ Error: ' + result.message, 'error');
            }

        } catch (error) {
            console.error('Error:', error);
            mostrarMensaje('❌ Error al enviar el formulario', 'error');
        }
    });

    // Función para mostrar mensajes
    function mostrarMensaje(texto, tipo) {
        mensaje.textContent = texto;
        mensaje.className = 'mensaje ' + tipo;

        // Ocultar mensaje después de 5 segundos
        setTimeout(() => {
            mensaje.style.display = 'none';
        }, 5000);
    }

    // Validación en tiempo real para el número de documento
    const numeroIdInput = document.getElementById('numeroId');
    numeroIdInput.addEventListener('input', function() {
        this.value = this.value.replace(/[^0-9]/g, '');
    });

    // Validación para el celular
    const celularInput = document.getElementById('celular');
    celularInput.addEventListener('input', function() {
        this.value = this.value.replace(/[^0-9+]/g, '');
    });

    // Validación para campos numéricos
    const pesoInput = document.getElementById('peso');
    const alturaInput = document.getElementById('altura');

    pesoInput.addEventListener('input', function() {
        if (this.value < 0) this.value = 0;
        if (this.value > 300) this.value = 300;
    });

    alturaInput.addEventListener('input', function() {
        if (this.value < 0) this.value = 0;
        if (this.value > 250) this.value = 250;
    });
});
