// Script para cargar el topbar compartido en todas las páginas
(function() {
    // Cargar el topbar
    fetch('/components/topbar.html')
        .then(response => response.text())
        .then(html => {
            // Buscar el contenedor del topbar
            const topbarContainer = document.getElementById('topbar-container');
            if (topbarContainer) {
                topbarContainer.innerHTML = html;

                // Reemplazar iconos de feather después de cargar
                if (typeof feather !== 'undefined') {
                    feather.replace();
                }
            }
        })
        .catch(error => {
            console.error('Error cargando topbar:', error);
        });
})();
