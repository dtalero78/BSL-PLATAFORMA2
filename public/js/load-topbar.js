// Script para cargar el topbar compartido en todas las páginas
(function() {
    // Cargar el topbar con cache-busting
    fetch('/components/topbar.html?v=' + Date.now())
        .then(response => response.text())
        .then(html => {
            // Buscar el contenedor del topbar
            const topbarContainer = document.getElementById('topbar-container');
            if (topbarContainer) {
                topbarContainer.innerHTML = html;

                // Ejecutar los scripts que vienen en el HTML del topbar
                // (innerHTML no ejecuta <script> tags automáticamente)
                const scripts = topbarContainer.querySelectorAll('script');
                scripts.forEach(oldScript => {
                    const newScript = document.createElement('script');
                    newScript.textContent = oldScript.textContent;
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                });

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
