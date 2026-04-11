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

// Aplica branding del tenant (logo + nombre) al sidebar
// Público: no requiere autenticación, resuelve tenant por hostname
window.aplicarBrandingTenant = async function() {
    try {
        const response = await fetch('/api/tenants/config', { cache: 'no-store' });
        if (!response.ok) return;
        const result = await response.json();
        if (!result.success || !result.tenant) return;

        const t = result.tenant;
        const sidebarLogo = document.querySelector('.sidebar-logo img');
        const sidebarSubtitle = document.querySelector('.sidebar-logo div');

        if (sidebarLogo && t.logo_url) {
            // Cache bust para que tome el logo nuevo al actualizar en UI
            const sep = t.logo_url.includes('?') ? '&' : '?';
            sidebarLogo.src = t.logo_url + sep + 'v=' + Date.now();
            sidebarLogo.alt = t.nombre;
        }
        if (sidebarSubtitle) {
            sidebarSubtitle.textContent = t.nombre;
        }

        // Actualiza también el título del documento
        if (t.id !== 'bsl' && document.title) {
            const separator = ' - ';
            if (document.title.includes(separator)) {
                const partes = document.title.split(separator);
                document.title = partes[0] + separator + t.nombre;
            }
        }

        // Cambia favicon si el tenant tiene logo
        if (t.logo_url) {
            let favicon = document.querySelector('link[rel="icon"]');
            if (!favicon) {
                favicon = document.createElement('link');
                favicon.rel = 'icon';
                document.head.appendChild(favicon);
            }
            favicon.href = t.logo_url;
        }
    } catch (err) {
        console.warn('No se pudo cargar branding del tenant:', err.message);
    }
};

// Luego cargar el HTML del sidebar
(function() {
    fetch('/components/sidebar.html')
        .then(response => response.text())
        .then(html => {
            const sidebarContainer = document.getElementById('sidebar-container');
            if (sidebarContainer) {
                sidebarContainer.innerHTML = html;

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

                // Branding dinámico por tenant (ver CLAUDE.md Multi-Tenant Architecture)
                // Consulta el endpoint público /api/tenants/config y reemplaza el logo
                // y el subtítulo según el tenant resuelto por hostname.
                aplicarBrandingTenant();
            }
        })
        .catch(error => {
            console.error('Error cargando sidebar:', error);
        });
})();
