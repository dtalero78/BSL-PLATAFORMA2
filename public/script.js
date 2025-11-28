document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 Aplicación inicializada');

    // ====== MODAL DE VIDEO INTRODUCTORIO ======
    const videoModal = document.getElementById('videoModal');
    const introVideo = document.getElementById('introVideo');
    const skipVideoBtn = document.getElementById('skipVideoBtn');
    const playVideoBtn = document.getElementById('playVideoBtn');

    // Desenfocar cualquier elemento activo para evitar que dropdowns aparezcan sobre el modal
    if (videoModal && !videoModal.classList.contains('hidden')) {
        document.activeElement?.blur();
        // Prevenir que el formulario reciba focus mientras el modal está visible
        document.body.style.overflow = 'hidden';
    }

    // Función para cerrar el modal de video
    function closeVideoModal() {
        videoModal.classList.add('hidden');
        introVideo.pause();
        // Restaurar scroll del body
        document.body.style.overflow = '';
        // Remover el modal del DOM después de la transición
        setTimeout(() => {
            videoModal.style.display = 'none';
        }, 500);
    }

    // Botón de play para iniciar el video
    if (playVideoBtn && introVideo) {
        playVideoBtn.addEventListener('click', function() {
            introVideo.play();
            playVideoBtn.classList.add('hidden');
        });

        // Mostrar botón de play si el video se pausa
        introVideo.addEventListener('pause', function() {
            if (!videoModal.classList.contains('hidden')) {
                playVideoBtn.classList.remove('hidden');
            }
        });

        // Ocultar botón de play cuando el video está reproduciéndose
        introVideo.addEventListener('play', function() {
            playVideoBtn.classList.add('hidden');
        });
    }

    // Cerrar modal cuando termina el video
    if (introVideo) {
        introVideo.addEventListener('ended', closeVideoModal);
    }

    // Botón para omitir el video
    if (skipVideoBtn) {
        skipVideoBtn.addEventListener('click', closeVideoModal);
    }
    // ====== FIN MODAL DE VIDEO ======

    const form = document.getElementById('formularioMedico');
    const slides = document.querySelectorAll('.question-slide');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const submitBtn = document.getElementById('submitBtn');
    const progressBar = document.getElementById('progressBar');
    const currentQuestionSpan = document.getElementById('currentQuestion');
    const totalQuestionsSpan = document.getElementById('totalQuestions');
    const successMessage = document.getElementById('successMessage');

    console.log('✅ Elementos encontrados:', {
        form: !!form,
        slides: slides.length,
        submitBtn: !!submitBtn
    });

    // Objeto para guardar datos de Wix
    let wixData = {};

    // Obtener parámetro _id de la URL
    const urlParams = new URLSearchParams(window.location.search);
    const wixId = urlParams.get('_id');

    if (wixId) {
        console.log('📝 ID de Wix detectado:', wixId);
        try {
            const response = await fetch(`/api/wix/${wixId}`);
            const result = await response.json();

            if (result.success && result.data) {
                wixData = result.data;
                console.log('✅ Datos de Wix cargados:', wixData);

                // Pre-llenar campos si existen
                if (wixData.primerNombre) {
                    document.querySelector('input[name="primerNombre"]')?.setAttribute('readonly', 'true');
                }
            }
        } catch (error) {
            console.error('❌ Error al cargar datos de Wix:', error);
        }
    }

    // Signature canvas
    const signatureCanvas = document.getElementById('signatureCanvas');
    const clearSignatureBtn = document.getElementById('clearSignature');
    const firmaData = document.getElementById('firmaData');
    let isDrawing = false;
    let ctx = null;

    if (signatureCanvas) {
        ctx = signatureCanvas.getContext('2d');
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';

        signatureCanvas.addEventListener('mousedown', startDrawing);
        signatureCanvas.addEventListener('mousemove', draw);
        signatureCanvas.addEventListener('mouseup', stopDrawing);
        signatureCanvas.addEventListener('mouseout', stopDrawing);

        signatureCanvas.addEventListener('touchstart', handleTouchStart);
        signatureCanvas.addEventListener('touchmove', handleTouchMove);
        signatureCanvas.addEventListener('touchend', stopDrawing);

        clearSignatureBtn.addEventListener('click', clearSignature);
    }

    function startDrawing(e) {
        isDrawing = true;
        const rect = signatureCanvas.getBoundingClientRect();
        ctx.beginPath();
        ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    }

    function draw(e) {
        if (!isDrawing) return;
        const rect = signatureCanvas.getBoundingClientRect();
        ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
        ctx.stroke();
        firmaData.value = signatureCanvas.toDataURL();
    }

    function stopDrawing() {
        isDrawing = false;
    }

    function handleTouchStart(e) {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = signatureCanvas.getBoundingClientRect();
        isDrawing = true;
        ctx.beginPath();
        ctx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
    }

    function handleTouchMove(e) {
        e.preventDefault();
        if (!isDrawing) return;
        const touch = e.touches[0];
        const rect = signatureCanvas.getBoundingClientRect();
        ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
        ctx.stroke();
        firmaData.value = signatureCanvas.toDataURL();
    }

    function clearSignature() {
        ctx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
        firmaData.value = '';
    }

    // Función para comprimir imagen
    function compressImage(file, maxWidth = 600, quality = 0.6) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Redimensionar si es muy grande
                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Convertir a base64 con compresión
                    const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                    resolve(compressedBase64);
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Image upload preview
    const fotoInput = document.getElementById('fotoInput');
    const imagePreview = document.getElementById('imagePreview');
    let compressedImageData = null;

    if (fotoInput) {
        fotoInput.addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (file) {
                try {
                    // Mostrar loading
                    imagePreview.innerHTML = '<p style="color: #00B8E6;">Procesando imagen...</p>';

                    // Comprimir imagen con balance calidad/velocidad
                    compressedImageData = await compressImage(file, 600, 0.6);

                    // Mostrar preview
                    imagePreview.innerHTML = `<img src="${compressedImageData}" alt="Preview">`;

                    console.log('📷 Imagen comprimida lista, tamaño:', Math.round(compressedImageData.length / 1024), 'KB');

                    // Mostrar mensaje de que puede enviar
                    setTimeout(() => {
                        if (submitBtn.style.display === 'flex') {
                            submitBtn.textContent = '¡Listo! Enviar formulario';
                            submitBtn.style.animation = 'pulse 1s infinite';
                        }
                    }, 500);
                } catch (error) {
                    console.error('Error al procesar imagen:', error);
                    imagePreview.innerHTML = '<p style="color: red;">Error al procesar la imagen. Por favor intenta con otra foto.</p>';
                    compressedImageData = null;  // Resetear para que el submit detecte el problema
                    fotoInput.value = '';  // Limpiar input para permitir re-selección del mismo archivo
                }
            }
        });
    }

    let currentSlide = 0;
    const totalSlides = slides.length;

    // Actualizar total de preguntas
    totalQuestionsSpan.textContent = totalSlides;

    // Mostrar slide actual
    function showSlide(index) {
        // Ocultar todos los slides
        slides.forEach(slide => slide.classList.remove('active'));

        // Mostrar slide actual
        if (slides[index]) {
            slides[index].classList.add('active');
            currentSlide = index;

            // Actualizar contador
            currentQuestionSpan.textContent = index + 1;

            // Actualizar barra de progreso
            const progress = ((index + 1) / totalSlides) * 100;
            progressBar.style.width = progress + '%';

            // Mostrar/ocultar botones
            prevBtn.style.display = index === 0 ? 'none' : 'flex';

            if (index === totalSlides - 1) {
                nextBtn.style.display = 'none';
                submitBtn.style.display = 'flex';
            } else {
                nextBtn.style.display = 'flex';
                submitBtn.style.display = 'none';
            }

            // Focus en el primer input
            const firstInput = slides[index].querySelector('input:not([type="hidden"]), textarea, select');
            if (firstInput && firstInput.type !== 'file' && firstInput.type !== 'radio') {
                setTimeout(() => firstInput.focus(), 100);
            }
        }
    }

    // Validar slide actual
    function validateCurrentSlide() {
        const currentSlideElement = slides[currentSlide];
        const inputs = currentSlideElement.querySelectorAll('input[required], textarea[required], select[required]');

        for (let input of inputs) {
            // Skip hidden inputs
            if (input.type === 'hidden') {
                if (input.id === 'firmaData' && !input.value) {
                    alert('Por favor firma antes de continuar.');
                    return false;
                }
                continue;
            }

            if (input.type === 'radio') {
                const name = input.name;
                const checked = currentSlideElement.querySelector(`[name="${name}"]:checked`);
                if (!checked) {
                    alert('Por favor selecciona una opción antes de continuar.');
                    return false;
                }
            } else if (input.type === 'file') {
                if (!input.files || input.files.length === 0) {
                    alert('Por favor sube una foto antes de continuar.');
                    return false;
                }
            } else {
                if (!input.value || input.value.trim() === '' || input.value === '-') {
                    alert('Por favor completa este campo antes de continuar.');
                    input.focus();
                    return false;
                }
            }
        }
        return true;
    }

    // Navegación - Siguiente
    nextBtn.addEventListener('click', function() {
        if (validateCurrentSlide()) {
            if (currentSlide < totalSlides - 1) {
                showSlide(currentSlide + 1);
            }
        }
    });

    // Navegación - Anterior
    prevBtn.addEventListener('click', function() {
        if (currentSlide > 0) {
            showSlide(currentSlide - 1);
        }
    });

    // Enter para avanzar (excepto en textareas)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            if (currentSlide < totalSlides - 1) {
                nextBtn.click();
            }
        }
    });

    // Auto-avance en radio buttons y selects
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', function() {
            setTimeout(() => {
                if (validateCurrentSlide()) {
                    if (currentSlide < totalSlides - 1) {
                        showSlide(currentSlide + 1);
                    }
                }
            }, 300);
        });
    });

    document.querySelectorAll('select').forEach(select => {
        select.addEventListener('change', function() {
            if (this.value && this.value !== '-') {
                setTimeout(() => {
                    if (validateCurrentSlide()) {
                        if (currentSlide < totalSlides - 1) {
                            showSlide(currentSlide + 1);
                        }
                    }
                }, 300);
            }
        });
    });

    // Enviar formulario
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        console.log('📝 Formulario submit iniciado');

        try {
            if (!validateCurrentSlide()) {
                console.log('❌ Validación falló');
                // El alert ya se muestra dentro de validateCurrentSlide()
                // Asegurar que el botón esté habilitado para reintentar
                submitBtn.disabled = false;
                submitBtn.textContent = 'Enviar';
                return;
            }

            // Verificar si hay campos con errores de validación previos
            const camposConError = form.querySelectorAll('[data-valid="false"]');
        if (camposConError.length > 0) {
            console.log('❌ Hay campos con errores de validación:', camposConError.length);

            // Encontrar el primer campo con error y mostrar mensaje
            const primerCampoError = camposConError[0];
            const nombreCampo = primerCampoError.name || 'un campo';

            // Buscar la slide que contiene el campo con error
            const slideConError = primerCampoError.closest('.question-slide');
            if (slideConError) {
                const slideIndex = Array.from(document.querySelectorAll('.question-slide')).indexOf(slideConError);
                if (slideIndex !== -1) {
                    showSlide(slideIndex);
                }
            }

            alert('Por favor corrige los errores en el formulario antes de enviar. Revisa el campo: ' + nombreCampo);
            primerCampoError.focus();
            submitBtn.disabled = false;
            submitBtn.textContent = 'Enviar';
            return;
        }

        console.log('✅ Validación pasó');

        // Deshabilitar botón de envío
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando...';

        // Timeout de seguridad: si el envío tarda más de 30 segundos, permitir reintento
        const submitTimeout = setTimeout(() => {
            if (submitBtn.disabled && submitBtn.textContent === 'Enviando...') {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Reintentar envío';
                alert('El envío está tardando demasiado. Por favor verifica tu conexión a internet e intenta de nuevo.');
            }
        }, 30000);

        // Recopilar datos del formulario
        const formData = new FormData(form);
        const datos = {};

        // Agregar datos de Wix si existen
        if (wixId) {
            datos.wixId = wixId;
            datos.primerNombre = wixData.primerNombre || '';
            datos.primerApellido = wixData.primerApellido || '';
            datos.numeroId = wixData.numeroId || '';
            datos.celular = wixData.celular || '';
            datos.empresa = wixData.empresa || '';
            datos.codEmpresa = wixData.codEmpresa || '';
            datos.fechaAtencion = wixData.fechaAtencion || '';
        }

        // Convertir todos los campos
        for (let [key, value] of formData.entries()) {
            // Saltar el campo de foto (file) por ahora
            if (key !== 'foto') {
                datos[key] = value;
            }
        }

        console.log('📦 Datos recopilados (sin foto):', datos);
        if (wixId) {
            console.log('📝 Datos de Wix incluidos:', {
                wixId: datos.wixId,
                primerNombre: datos.primerNombre,
                primerApellido: datos.primerApellido
            });
        }

        // Agregar la foto como base64 si existe (ya comprimida)
        console.log('📷 Verificando foto...');

        if (compressedImageData) {
            console.log('✅ Usando foto comprimida, tamaño:', Math.round(compressedImageData.length / 1024), 'KB');
            datos.foto = compressedImageData;

            try {
                console.log('📡 Enviando al servidor...');
                // Enviar datos al servidor
                const response = await fetch('/api/formulario', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(datos)
                });

                console.log('📨 Respuesta recibida, status:', response.status);
                const result = await response.json();
                console.log('📋 Resultado:', result);

                if (result.success) {
                    clearTimeout(submitTimeout);  // Limpiar timeout de seguridad
                    console.log('✅ Datos guardados:', result.data);

                    // Redirigir según empresa o examen
                    const codEmpresa = wixData.codEmpresa || "";
                    const examenes = wixData.examenes || "";
                    const itemId = wixId || "";
                    const numeroId = wixData.numeroId || "";

                    let redirectUrl = "";

                    if (codEmpresa === "KM2") {
                        redirectUrl = `https://www.bsl.com.co/km2/${numeroId}`;
                    }
                    else if (codEmpresa === "SIIGO") {
                        redirectUrl = `https://www.bsl.com.co/scl90/${numeroId}`;
                    }
                    else if (examenes.includes("Test Riesgo Psicosocial A")) {
                        redirectUrl = `https://www.bsl.com.co/psicosociala/${itemId}`;
                    }
                    else if (examenes.includes("Test Riesgo Psicosocial B")) {
                        redirectUrl = `https://www.bsl.com.co/psicosocialb/${itemId}`;
                    }
                    else {
                        console.warn("No se encontró un examen válido en 'examenes'.");
                        redirectUrl = `https://www.bsl.com.co/adc-preguntas2/${itemId}`;
                    }

                    console.log('🔄 Redirigiendo a:', redirectUrl);

                    // Mostrar mensaje de éxito brevemente antes de redirigir
                    successMessage.classList.add('show');

                    // Redirigir después de 2 segundos
                    setTimeout(() => {
                        window.location.href = redirectUrl;
                    }, 2000);
                } else {
                    clearTimeout(submitTimeout);
                    alert('Error: ' + result.message);
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Enviar';
                }

            } catch (error) {
                clearTimeout(submitTimeout);
                console.error('❌ Error en fetch:', error);
                alert('Error al enviar el formulario. Por favor intenta nuevamente.');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Enviar';
            }
        } else {
            console.log('❌ No hay foto seleccionada o comprimida');
            // Verificar si el usuario intentó subir una foto pero falló la compresión
            if (fotoInput && fotoInput.files && fotoInput.files.length > 0) {
                alert('Hubo un error procesando tu foto. Por favor selecciona otra imagen más pequeña o en formato JPG/PNG.');
            } else {
                alert('Por favor sube una foto antes de enviar.');
            }
            submitBtn.disabled = false;
            submitBtn.textContent = 'Enviar';
        }

        } catch (submitError) {
            console.error('❌ Error inesperado en submit:', submitError);
            alert('Ocurrió un error inesperado: ' + submitError.message + '. Por favor intenta de nuevo.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Enviar';
        }
    });

    // ============================================
    // VALIDACIONES EN TIEMPO REAL
    // ============================================

    // Función para mostrar error en un campo
    function showFieldError(input, message) {
        // Remover error previo si existe
        clearFieldError(input);

        input.style.borderColor = '#ef4444';
        input.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.2)';

        const errorDiv = document.createElement('div');
        errorDiv.className = 'field-error';
        errorDiv.style.cssText = 'color: #ef4444; font-size: 12px; margin-top: 5px; font-weight: 500;';
        errorDiv.textContent = message;
        input.parentNode.appendChild(errorDiv);
    }

    // Función para limpiar error de un campo
    function clearFieldError(input) {
        input.style.borderColor = '';
        input.style.boxShadow = '';
        const existingError = input.parentNode.querySelector('.field-error');
        if (existingError) {
            existingError.remove();
        }
    }

    // Función para mostrar éxito en un campo
    function showFieldSuccess(input) {
        clearFieldError(input);
        input.style.borderColor = '#22c55e';
        input.style.boxShadow = '0 0 0 3px rgba(34, 197, 94, 0.2)';
    }

    // VALIDACIÓN DE EMAIL
    const emailInput = form.querySelector('[name="email"]');
    if (emailInput) {
        emailInput.addEventListener('blur', function() {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const value = this.value.trim();

            if (value && !emailRegex.test(value)) {
                showFieldError(this, 'Por favor ingresa un email válido (ejemplo: tucorreo@gmail.com)');
                this.dataset.valid = 'false';
            } else if (value) {
                showFieldSuccess(this);
                this.dataset.valid = 'true';
            }
        });

        emailInput.addEventListener('input', function() {
            clearFieldError(this);
        });
    }

    // VALIDACIÓN DE EDAD
    const edadInput = form.querySelector('[name="edad"]');
    if (edadInput) {
        edadInput.addEventListener('input', function() {
            if (this.value < 0) this.value = 0;
            if (this.value > 120) this.value = 120;
        });

        edadInput.addEventListener('blur', function() {
            const value = parseInt(this.value);
            if (isNaN(value) || value < 1) {
                showFieldError(this, 'Por favor ingresa una edad válida');
                this.dataset.valid = 'false';
            } else if (value < 15 || value > 100) {
                showFieldError(this, 'La edad debe estar entre 15 y 100 años');
                this.dataset.valid = 'false';
            } else {
                showFieldSuccess(this);
                this.dataset.valid = 'true';
            }
        });
    }

    // VALIDACIÓN DE HIJOS
    const hijosInput = form.querySelector('[name="hijos"]');
    if (hijosInput) {
        hijosInput.addEventListener('input', function() {
            if (this.value < 0) this.value = 0;
            if (this.value > 20) this.value = 20;
        });

        hijosInput.addEventListener('blur', function() {
            const value = this.value.trim();
            if (value === '') {
                showFieldError(this, 'Por favor ingresa el número de hijos (0 si no tienes)');
                this.dataset.valid = 'false';
            } else {
                showFieldSuccess(this);
                this.dataset.valid = 'true';
            }
        });
    }

    // VALIDACIÓN DE PESO
    const pesoInput = form.querySelector('[name="peso"]');
    if (pesoInput) {
        pesoInput.addEventListener('input', function() {
            if (this.value < 0) this.value = 0;
            if (this.value > 300) this.value = 300;
        });

        pesoInput.addEventListener('blur', function() {
            const value = parseInt(this.value);
            if (isNaN(value) || value < 30 || value > 250) {
                showFieldError(this, 'Por favor ingresa un peso válido (entre 30 y 250 kg)');
                this.dataset.valid = 'false';
            } else {
                showFieldSuccess(this);
                this.dataset.valid = 'true';
            }
        });
    }

    // VALIDACIÓN DE FECHA DE NACIMIENTO
    const fechaInput = form.querySelector('[name="fechaNacimiento"]');
    if (fechaInput) {
        fechaInput.addEventListener('input', function() {
            let value = this.value.replace(/\D/g, '');
            if (value.length >= 2) {
                value = value.slice(0, 2) + '/' + value.slice(2);
            }
            if (value.length >= 5) {
                value = value.slice(0, 5) + '/' + value.slice(5, 9);
            }
            this.value = value;
        });

        fechaInput.addEventListener('blur', function() {
            const value = this.value.trim();
            const parts = value.split('/');

            if (parts.length !== 3 || value.length < 10) {
                showFieldError(this, 'Formato: DD/MM/AAAA (ejemplo: 15/03/1990)');
                this.dataset.valid = 'false';
                return;
            }

            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const year = parseInt(parts[2]);

            // Validar día
            if (day < 1 || day > 31) {
                showFieldError(this, 'El día debe estar entre 1 y 31');
                this.dataset.valid = 'false';
                return;
            }

            // Validar mes
            if (month < 1 || month > 12) {
                showFieldError(this, 'El mes debe estar entre 1 y 12');
                this.dataset.valid = 'false';
                return;
            }

            // Validar año
            const currentYear = new Date().getFullYear();
            if (year < 1900 || year > currentYear) {
                showFieldError(this, 'El año debe estar entre 1900 y ' + currentYear);
                this.dataset.valid = 'false';
                return;
            }

            // Validar que la fecha no sea en el futuro
            const fechaNac = new Date(year, month - 1, day);
            const hoy = new Date();
            if (fechaNac > hoy) {
                showFieldError(this, 'La fecha de nacimiento no puede ser en el futuro');
                this.dataset.valid = 'false';
                return;
            }

            // Validar edad mínima (15 años)
            const edadMinima = new Date();
            edadMinima.setFullYear(edadMinima.getFullYear() - 15);
            if (fechaNac > edadMinima) {
                showFieldError(this, 'Debes tener al menos 15 años');
                this.dataset.valid = 'false';
                return;
            }

            showFieldSuccess(this);
            this.dataset.valid = 'true';
        });
    }

    // VALIDACIÓN DE CAMPOS DE TEXTO (no vacíos, sin solo espacios)
    const textInputs = form.querySelectorAll('input[type="text"][required]');
    textInputs.forEach(input => {
        input.addEventListener('blur', function() {
            const value = this.value.trim();
            if (value.length < 2) {
                showFieldError(this, 'Este campo debe tener al menos 2 caracteres');
                this.dataset.valid = 'false';
            } else {
                showFieldSuccess(this);
                this.dataset.valid = 'true';
            }
        });
    });

    // VALIDACIÓN DE NÚMERO DE DOCUMENTO
    const numeroIdInput = form.querySelector('[name="numeroId"]');
    if (numeroIdInput) {
        numeroIdInput.addEventListener('input', function() {
            // Solo permitir números
            this.value = this.value.replace(/\D/g, '');
        });

        numeroIdInput.addEventListener('blur', function() {
            const value = this.value.trim();
            if (value.length < 6) {
                showFieldError(this, 'El número de documento debe tener al menos 6 dígitos');
                this.dataset.valid = 'false';
            } else if (value.length > 15) {
                showFieldError(this, 'El número de documento no puede tener más de 15 dígitos');
                this.dataset.valid = 'false';
            } else {
                showFieldSuccess(this);
                this.dataset.valid = 'true';
            }
        });
    }

    // VALIDACIÓN DE CELULAR
    const celularInput = form.querySelector('[name="celular"]');
    if (celularInput) {
        celularInput.addEventListener('input', function() {
            // Solo permitir números
            this.value = this.value.replace(/\D/g, '');
        });

        celularInput.addEventListener('blur', function() {
            const value = this.value.trim();
            if (value.length < 10) {
                showFieldError(this, 'El número de celular debe tener al menos 10 dígitos');
                this.dataset.valid = 'false';
            } else if (value.length > 15) {
                showFieldError(this, 'El número de celular no puede tener más de 15 dígitos');
                this.dataset.valid = 'false';
            } else {
                showFieldSuccess(this);
                this.dataset.valid = 'true';
            }
        });
    }

    // VALIDACIÓN DE ESTATURA
    const estaturaInput = form.querySelector('[name="estatura"]');
    if (estaturaInput) {
        estaturaInput.addEventListener('input', function() {
            if (this.value < 0) this.value = 0;
            if (this.value > 250) this.value = 250;
        });

        estaturaInput.addEventListener('blur', function() {
            const value = parseInt(this.value);
            if (isNaN(value) || value < 100 || value > 250) {
                showFieldError(this, 'Por favor ingresa una estatura válida (entre 100 y 250 cm)');
                this.dataset.valid = 'false';
            } else {
                showFieldSuccess(this);
                this.dataset.valid = 'true';
            }
        });
    }

    // Inicializar
    showSlide(0);
});
