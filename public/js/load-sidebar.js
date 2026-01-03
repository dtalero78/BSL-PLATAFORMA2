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
            }
        })
        .catch(error => {
            console.error('Error cargando sidebar:', error);
        });
})();
