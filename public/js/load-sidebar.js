// Script para cargar el sidebar compartido en todas las páginas
// Definir funciones globales PRIMERO
window.toggleNavGroup = function(element) {
    const group = element.closest('.nav-group');
    group.classList.toggle('open');
};

window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
};

// Aplica filtro de módulos + favicon + título usando config ya cargado.
// (El logo y nombre ya fueron parchados en el HTML string antes de inyectarlo al DOM,
// por eso no hay flash del logo BSL.)
window.aplicarFiltroYFavicon = function(t) {
    if (!t) return;

    // Título del documento
    if (t.id !== 'bsl' && document.title) {
        const separator = ' - ';
        if (document.title.includes(separator)) {
            const partes = document.title.split(separator);
            document.title = partes[0] + separator + t.nombre;
        }
    }

    // Favicon
    if (t.logo_url) {
        let favicon = document.querySelector('link[rel="icon"]');
        if (!favicon) {
            favicon = document.createElement('link');
            favicon.rel = 'icon';
            document.head.appendChild(favicon);
        }
        favicon.href = t.logo_url;
    }

    // Ocultar items del sidebar según modulos_activos del tenant.
    // BSL ve todo; los demás tenants solo ven lo habilitado por super-admin.
    // Cada botón del sidebar tiene data-sidebar-key con un identificador único.
    // Items sin data-sidebar-key (y sin super-admin-only) siguen visibles para todos.
    if (t.id !== 'bsl' && Array.isArray(t.modulos_activos)) {
        const itemsPermitidos = new Set(t.modulos_activos);

        // Filtrar nav-items individuales
        document.querySelectorAll('[data-sidebar-key]').forEach(item => {
            const key = item.getAttribute('data-sidebar-key');
            if (!itemsPermitidos.has(key)) {
                item.style.display = 'none';
            }
        });

        // Ocultar secciones cuyos items estén todos ocultos.
        document.querySelectorAll('.nav-section-title').forEach(titulo => {
            let hayVisible = false;
            let sibling = titulo.nextElementSibling;
            while (sibling && !sibling.classList.contains('nav-section-title')) {
                // Puede ser un nav-item directo o un nav-group (submenu)
                const esItem = sibling.classList && (
                    sibling.classList.contains('nav-item') ||
                    sibling.classList.contains('nav-group')
                );
                if (esItem) {
                    const computed = window.getComputedStyle(sibling);
                    if (computed.display !== 'none') {
                        hayVisible = true;
                        break;
                    }
                }
                sibling = sibling.nextElementSibling;
            }
            if (!hayVisible) {
                titulo.style.display = 'none';
            }
        });
    }
};

// Alias retrocompatible para otras páginas que llaman aplicarBrandingTenant
window.aplicarBrandingTenant = function() {
    // Ya se aplica automáticamente al cargar el sidebar.
    // Esta función queda como no-op para no romper páginas que la llamen.
};

// Luego cargar el HTML del sidebar + config del tenant en paralelo
// para evitar FOUC (flash del logo BSL antes del logo del tenant correcto)
(function() {
    const TENANT_CACHE_KEY = 'bsl_tenant_config';

    // Cache síncrono desde sessionStorage para respuesta instantánea en navegaciones
    let cachedConfig = null;
    try {
        const cached = sessionStorage.getItem(TENANT_CACHE_KEY);
        if (cached) cachedConfig = JSON.parse(cached);
    } catch (e) { /* ignore */ }

    // Reemplaza el logo + nombre en el HTML string ANTES de inyectarlo al DOM.
    // Así el navegador nunca pinta el logo incorrecto.
    function parcharSidebarHtml(html, tenantConfig) {
        if (!tenantConfig) return html;
        let parchado = html;

        if (tenantConfig.logo_url) {
            const sep = tenantConfig.logo_url.includes('?') ? '&' : '?';
            const cacheBust = tenantConfig.logo_url + sep + 'v=' + Date.now();
            parchado = parchado.replace('src="/bsl-logo.png"', `src="${cacheBust}"`);
            parchado = parchado.replace(
                'alt="BSL - Bienestar & Salud Laboral"',
                `alt="${tenantConfig.nombre || ''}"`
            );
        }
        if (tenantConfig.nombre && tenantConfig.id !== 'bsl') {
            parchado = parchado.replace('>Sistema Médico<', `>${tenantConfig.nombre}<`);
        }
        return parchado;
    }

    // Fetch en paralelo: sidebar HTML + tenant config (con fallback a cache)
    const sidebarPromise = fetch('/components/sidebar.html').then(r => r.text());
    const configPromise = fetch('/api/tenants/config', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(result => result?.tenant || null)
        .catch(() => null);

    Promise.all([sidebarPromise, configPromise])
        .then(([html, tenantConfig]) => {
            // Si el fetch del config falló, usa el cache
            const configFinal = tenantConfig || cachedConfig;

            // Actualiza cache si obtuvimos del server
            if (tenantConfig) {
                try { sessionStorage.setItem(TENANT_CACHE_KEY, JSON.stringify(tenantConfig)); } catch (e) {}
            }

            const htmlParchado = parcharSidebarHtml(html, configFinal);
            const sidebarContainer = document.getElementById('sidebar-container');
            if (sidebarContainer) {
                sidebarContainer.innerHTML = htmlParchado;

                // Auto-activar el item del menú correspondiente
                const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
                const menuItems = document.querySelectorAll('.nav-item[data-page]');

                menuItems.forEach(item => {
                    if (item.dataset.page === currentPage) {
                        item.classList.add('active');
                    } else {
                        item.classList.remove('active');
                    }
                });

                // Restaurar estado del sidebar
                const sidebar = document.getElementById('sidebar');
                const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
                if (isCollapsed) {
                    sidebar.classList.add('collapsed');
                }

                // Reemplazar iconos de feather
                if (typeof feather !== 'undefined') {
                    feather.replace();
                }

                // Agregar event listener para el botón "Fijar Tiempo"
                const btnFijarTiempo = document.getElementById('btnFijarTiempoConsulta');
                if (btnFijarTiempo) {
                    btnFijarTiempo.addEventListener('click', function(e) {
                        e.preventDefault();
                        // Esperar a que la función esté disponible
                        if (typeof window.abrirModalTiempoConsultaGlobal === 'function') {
                            window.abrirModalTiempoConsultaGlobal();
                        } else {
                            console.warn('Modal de disponibilidad aún no está cargado, reintentando...');
                            setTimeout(() => {
                                if (typeof window.abrirModalTiempoConsultaGlobal === 'function') {
                                    window.abrirModalTiempoConsultaGlobal();
                                }
                            }, 200);
                        }
                    });
                }

                // Mostrar/ocultar elementos solo para ADMIN
                if (window.Auth) {
                    const usuario = window.Auth.getUser();
                    const esAdmin = usuario && (usuario.rol === 'ADMIN' || usuario.rol === 'admin');

                    if (esAdmin) {
                        const adminElements = document.querySelectorAll('.admin-only');
                        adminElements.forEach(el => {
                            el.style.display = 'block';
                        });
                    }

                    // super-admin-only: visible solo para admins del tenant 'bsl'
                    const esSuperAdmin = esAdmin && (usuario.tenant_id || 'bsl') === 'bsl';
                    if (esSuperAdmin) {
                        const superAdminElements = document.querySelectorAll('.super-admin-only');
                        superAdminElements.forEach(el => {
                            el.style.display = 'block';
                        });
                    }
                }

                // Branding dinámico: aplica filtro de módulos + favicon + título.
                // El logo y nombre del tenant ya fueron parchados en el HTML string antes
                // de inyectarlo al DOM, así que no hay FOUC.
                if (configFinal) {
                    aplicarFiltroYFavicon(configFinal);
                }
            }
        })
        .catch(error => {
            console.error('Error cargando sidebar:', error);
        });
})();
