const fs = require('fs');

// Archivos que deben estar protegidos (requieren login)
const archivosProtegidos = [
    { archivo: 'public/ordenes.html', roles: ['admin', 'ADMIN'] },
    { archivo: 'public/nueva-orden.html', roles: ['admin', 'ADMIN'] },
    { archivo: 'public/medicos.html', roles: ['admin', 'ADMIN'] },
    { archivo: 'public/examenes.html', roles: ['admin', 'ADMIN'] },
    { archivo: 'public/empresas.html', roles: ['admin', 'ADMIN'] },
    { archivo: 'public/calendario.html', roles: ['admin', 'ADMIN'] }
    // index.html NO debe estar protegido (es el formulario público)
];

function agregarProteccionAuth(archivo, roles) {
    console.log(`\n📄 Procesando ${archivo}...`);

    let contenido = fs.readFileSync(archivo, 'utf8');
    let cambios = 0;

    // 1. Agregar script auth.js si no existe (ANTES de los componentes)
    if (!contenido.includes('auth.js')) {
        // Buscar los scripts de componentes compartidos
        const componentScriptsRegex = /<!-- Cargar componentes compartidos -->/;
        if (componentScriptsRegex.test(contenido)) {
            contenido = contenido.replace(
                '<!-- Cargar componentes compartidos -->',
                `<!-- Sistema de autenticación -->
    <script src="/js/auth.js"></script>

    <!-- Cargar componentes compartidos -->`
            );
            cambios++;
            console.log('   ✓ Script auth.js agregado');
        } else {
            // Si no hay componentes, agregarlo antes de </body>
            contenido = contenido.replace(
                '</body>',
                `    <script src="/js/auth.js"></script>
</body>`
            );
            cambios++;
            console.log('   ✓ Script auth.js agregado (antes de </body>)');
        }
    }

    // 2. Agregar protección de página si no existe
    if (!contenido.includes('Auth.protegerPagina')) {
        // Buscar el DOMContentLoaded existente
        const domContentLoadedRegex = /document\.addEventListener\(['"]DOMContentLoaded['"], (?:async )?(?:function\(\)|(?:\(\) =>))? ?\{/;

        const rolesArray = JSON.stringify(roles);

        if (domContentLoadedRegex.test(contenido)) {
            // Ya existe DOMContentLoaded, envolver TODO el contenido en Auth.protegerPagina
            contenido = contenido.replace(
                /(document\.addEventListener\(['"]DOMContentLoaded['"], (?:async )?(?:function\(\)|(?:\(\) =>))? ?\{)([\s\S]*?)\n(\s*)\}\);/,
                (match, inicio, contenidoInterno, espacios) => {
                    return `${inicio}
        // Proteger página con autenticación
        Auth.protegerPagina(${rolesArray}).then(usuarioActual => {
            if (!usuarioActual) return; // Redirigido a login

            // Usuario autenticado, continuar con inicialización
            console.log('Usuario autenticado:', usuarioActual.nombre);
${contenidoInterno}
        }); // Fin Auth.protegerPagina
${espacios}});`;
                }
            );
            cambios++;
            console.log('   ✓ Protección agregada envolviendo DOMContentLoaded existente');
        } else {
            // No existe DOMContentLoaded, crear uno nuevo
            const scriptEndRegex = /(<script src="\/js\/auth\.js"><\/script>)/;
            if (scriptEndRegex.test(contenido)) {
                contenido = contenido.replace(
                    scriptEndRegex,
                    `$1

    <script>
        document.addEventListener('DOMContentLoaded', async () => {
            // Proteger página con autenticación
            Auth.protegerPagina(${rolesArray}).then(usuarioActual => {
                if (!usuarioActual) return; // Redirigido a login

                // Usuario autenticado, continuar con inicialización
                console.log('Usuario autenticado:', usuarioActual.nombre);

                // Aquí iría el código de inicialización de la página
            }); // Fin Auth.protegerPagina
        });
    </script>`
                );
                cambios++;
                console.log('   ✓ DOMContentLoaded y protección creados');
            }
        }
    }

    if (cambios > 0) {
        fs.writeFileSync(archivo, contenido, 'utf8');
        console.log(`   ✅ ${cambios} cambios aplicados`);
    } else {
        console.log('   ℹ️  Ya tiene protección de autenticación');
    }
}

console.log('🔒 Iniciando protección de endpoints con autenticación...\n');

archivosProtegidos.forEach(({ archivo, roles }) => {
    if (fs.existsSync(archivo)) {
        agregarProteccionAuth(archivo, roles);
    } else {
        console.log(`❌ Archivo no encontrado: ${archivo}`);
    }
});

console.log('\n✨ Protección completada!\n');
