const fs = require('fs');
const path = require('path');

// Archivos a actualizar (los que tienen sidebar en el menú)
const archivos = [
    'public/index.html',
    'public/ordenes.html',
    'public/nueva-orden.html',
    'public/medicos.html',
    'public/examenes.html',
    'public/empresas.html',
    'public/calendario.html'
];

// CSS para .nav-group que se debe agregar si no existe
const cssNavGroup = `
        /* Menú con subitems desplegables */
        .nav-group {
            position: relative;
        }

        .nav-item.has-submenu {
            cursor: pointer;
        }

        .nav-item.has-submenu::after {
            content: '';
            width: 0;
            height: 0;
            border-left: 4px solid transparent;
            border-right: 4px solid transparent;
            border-top: 5px solid #64748B;
            margin-left: auto;
            transition: transform 0.2s ease;
        }

        .nav-group.open .nav-item.has-submenu::after {
            transform: rotate(180deg);
        }

        .nav-submenu {
            display: none;
            overflow: hidden;
        }

        .nav-group.open .nav-submenu {
            display: block;
        }

        .nav-submenu .nav-item {
            padding-left: 44px;
            font-size: 13px;
        }

        .nav-submenu .nav-item i {
            width: 16px;
            height: 16px;
        }`;

function actualizarArchivo(archivo) {
    console.log(`\n📄 Procesando ${archivo}...`);

    let contenido = fs.readFileSync(archivo, 'utf8');
    let cambios = 0;

    // 1. Reemplazar sidebar con contenedor
    const sidebarRegex = /<aside class="sidebar"[^>]*>[\s\S]*?<\/aside>/;
    if (sidebarRegex.test(contenido)) {
        contenido = contenido.replace(
            sidebarRegex,
            '<!-- Sidebar (cargado dinámicamente) -->\n        <div id="sidebar-container"></div>'
        );
        cambios++;
        console.log('   ✓ Sidebar reemplazado');
    }

    // 2. Reemplazar top-bar con contenedor
    const topbarRegex = /<div class="top-bar">[\s\S]*?<\/div>\s*(?=\s*<!--|\s*<main)/;
    if (topbarRegex.test(contenido)) {
        contenido = contenido.replace(
            topbarRegex,
            '<!-- Top Bar (cargado dinámicamente) -->\n        <div id="topbar-container"></div>\n\n        '
        );
        cambios++;
        console.log('   ✓ Top bar reemplazado');
    }

    // 3. Agregar scripts de carga antes de </body> si no existen
    // IMPORTANTE: modal-disponibilidad.js debe cargarse PRIMERO
    if (!contenido.includes('load-sidebar.js')) {
        contenido = contenido.replace(
            '</body>',
            `    <!-- Cargar componentes compartidos -->
    <script src="/js/modal-disponibilidad.js"></script>
    <script src="/js/load-sidebar.js"></script>
    <script src="/js/load-topbar.js"></script>
</body>`
        );
        cambios++;
        console.log('   ✓ Scripts agregados');
    } else if (!contenido.includes('modal-disponibilidad.js')) {
        // Si ya tiene los scripts pero falta modal, agregarlo AL INICIO
        contenido = contenido.replace(
            '<script src="/js/load-sidebar.js"></script>',
            `<script src="/js/modal-disponibilidad.js"></script>
    <script src="/js/load-sidebar.js"></script>`
        );
        cambios++;
        console.log('   ✓ Script de modal agregado');
    } else {
        // Si ya tiene todos los scripts, verificar el orden correcto
        const modalBeforeSidebar = contenido.indexOf('modal-disponibilidad.js') < contenido.indexOf('load-sidebar.js');
        if (!modalBeforeSidebar) {
            // Reordenar: modal debe ir antes que sidebar
            contenido = contenido.replace(
                /<script src="\/js\/load-sidebar.js"><\/script>\s*<script src="\/js\/load-topbar.js"><\/script>\s*<script src="\/js\/modal-disponibilidad.js"><\/script>/,
                `<script src="/js/modal-disponibilidad.js"></script>
    <script src="/js/load-sidebar.js"></script>
    <script src="/js/load-topbar.js"></script>`
            );
            cambios++;
            console.log('   ✓ Scripts reordenados (modal primero)');
        }
    }

    // 4. Agregar CSS de nav-group si no existe
    if (!contenido.includes('.nav-group')) {
        // Buscar el cierre del último CSS antes de </style>
        const styleEndRegex = /(\s*)<\/style>/;
        if (styleEndRegex.test(contenido)) {
            contenido = contenido.replace(
                styleEndRegex,
                cssNavGroup + '\n$1</style>'
            );
            cambios++;
            console.log('   ✓ CSS de nav-group agregado');
        }
    }

    // 5. Agregar función toggleNavGroup si no existe
    if (!contenido.includes('function toggleNavGroup')) {
        const scriptEndRegex = /(\s*)<\/script>(\s*<\/body>)/;
        if (scriptEndRegex.test(contenido)) {
            const funcionToggle = `

        // Toggle navigation group (para menú con submenús)
        function toggleNavGroup(element) {
            const group = element.closest('.nav-group');
            group.classList.toggle('open');
        }`;
            contenido = contenido.replace(
                scriptEndRegex,
                funcionToggle + '\n$1</script>$2'
            );
            cambios++;
            console.log('   ✓ Función toggleNavGroup agregada');
        }
    }

    if (cambios > 0) {
        fs.writeFileSync(archivo, contenido, 'utf8');
        console.log(`   ✅ ${cambios} cambios aplicados`);
    } else {
        console.log('   ℹ️  No se necesitaron cambios');
    }
}

console.log('🚀 Iniciando actualización de componentes compartidos...\n');

archivos.forEach(archivo => {
    if (fs.existsSync(archivo)) {
        actualizarArchivo(archivo);
    } else {
        console.log(`❌ Archivo no encontrado: ${archivo}`);
    }
});

console.log('\n✨ Actualización completada!\n');
