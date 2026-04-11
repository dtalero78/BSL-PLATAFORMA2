// Branding dinámico del logo para páginas patient-facing (sin sidebar).
//
// Busca todas las imgs cuyo src contenga "bsl-logo" y las reemplaza con el logo
// del tenant resuelto por hostname. El tenant config se lee de sessionStorage
// (instantáneo) y se refresca en background contra /api/tenants/config.
//
// Páginas target: index.html (formulario paciente), pruebas virtuales, login,
// registro, consulta-orden, descarga-empresas, etc. Las páginas con sidebar usan
// load-sidebar.js que ya parcha el HTML antes del DOM.
//
// Uso: incluir en <head> lo más temprano posible:
//   <script src="/js/load-logo.js"></script>

(function() {
    const TENANT_CACHE_KEY = 'bsl_tenant_config';

    // Lee cache síncrono desde sessionStorage (respuesta instantánea en navegaciones)
    let cachedConfig = null;
    try {
        const cached = sessionStorage.getItem(TENANT_CACHE_KEY);
        if (cached) cachedConfig = JSON.parse(cached);
    } catch (e) { /* ignore */ }

    function aplicarLogo(config) {
        if (!config || !config.logo_url) return;

        const sep = config.logo_url.includes('?') ? '&' : '?';
        const cacheBust = config.logo_url + sep + 'v=' + Date.now();

        // Reemplazar en todas las imgs que apunten a bsl-logo
        document.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src') || '';
            if (src.includes('bsl-logo')) {
                img.src = cacheBust;
                if (config.nombre) img.alt = config.nombre;
            }
        });

        // Título del documento
        if (config.id !== 'bsl' && config.nombre && document.title) {
            const sepTitle = ' - ';
            if (document.title.includes(sepTitle)) {
                const partes = document.title.split(sepTitle);
                document.title = partes[0] + sepTitle + config.nombre;
            } else {
                document.title = config.nombre;
            }
        }

        // Favicon
        let favicon = document.querySelector('link[rel="icon"]');
        if (!favicon) {
            favicon = document.createElement('link');
            favicon.rel = 'icon';
            document.head.appendChild(favicon);
        }
        favicon.href = config.logo_url;
    }

    // Aplicar cache inmediatamente si el DOM ya está listo, o esperar al DOM
    function aplicarConCache() {
        if (cachedConfig) aplicarLogo(cachedConfig);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', aplicarConCache);
    } else {
        aplicarConCache();
    }

    // Refrescar desde el servidor en background (actualiza cache + re-aplica si cambió)
    fetch('/api/tenants/config', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(result => {
            const config = result && result.tenant;
            if (!config) return;
            try { sessionStorage.setItem(TENANT_CACHE_KEY, JSON.stringify(config)); } catch (e) {}

            // Si cambió respecto al cache, re-aplicar
            const changed = !cachedConfig || cachedConfig.logo_url !== config.logo_url;
            if (changed) {
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => aplicarLogo(config));
                } else {
                    aplicarLogo(config);
                }
            }
        })
        .catch(() => { /* fallback a cache, sin error visible */ });
})();
