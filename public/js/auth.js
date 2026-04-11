/**
 * Módulo de autenticación para BSL Plataforma
 * Maneja tokens JWT, sesiones y redirección
 */
const Auth = {
    TOKEN_KEY: 'bsl_auth_token',
    USER_KEY: 'bsl_user',

    /**
     * Obtener token almacenado
     */
    getToken() {
        // Intentar con la nueva key, si no existe buscar la antigua
        let token = localStorage.getItem(this.TOKEN_KEY);
        if (!token) {
            token = localStorage.getItem('token'); // Backward compatibility
        }
        return token;
    },

    /**
     * Guardar token
     */
    setToken(token) {
        localStorage.setItem(this.TOKEN_KEY, token);
    },

    /**
     * Obtener usuario almacenado
     */
    getUser() {
        const data = localStorage.getItem(this.USER_KEY);
        return data ? JSON.parse(data) : null;
    },

    /**
     * Guardar usuario
     */
    setUser(usuario) {
        localStorage.setItem(this.USER_KEY, JSON.stringify(usuario));
    },

    /**
     * Limpiar sesión
     */
    clearSession() {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
    },

    /**
     * Verificar si está autenticado
     */
    isAuthenticated() {
        return !!this.getToken();
    },

    /**
     * Iniciar sesión
     */
    async login(email, password) {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (data.success && data.token) {
            this.setToken(data.token);
            this.setUser(data.usuario);
        }

        return data;
    },

    /**
     * Registrar nuevo usuario
     */
    async registro(datos) {
        const response = await fetch('/api/auth/registro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
        });

        return response.json();
    },

    /**
     * Cerrar sesión
     */
    async logout() {
        const token = this.getToken();

        if (token) {
            try {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
            } catch (e) {
                console.error('Error en logout:', e);
            }
        }

        this.clearSession();
        window.location.href = '/login.html';
    },

    /**
     * Verificar sesión actual
     */
    async verificarSesion() {
        const token = this.getToken();

        if (!token) return null;

        try {
            const response = await fetch('/api/auth/verificar-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });

            const data = await response.json();

            if (data.success && data.usuario) {
                this.setUser(data.usuario);
                return data.usuario;
            } else {
                this.clearSession();
                return null;
            }
        } catch (error) {
            console.error('Error verificando sesión:', error);
            return null;
        }
    },

    /**
     * Obtener headers de autenticación para fetch
     */
    getAuthHeaders() {
        const token = this.getToken();
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    },

    /**
     * Fetch autenticado
     */
    async fetchAuth(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
            ...this.getAuthHeaders()
        };

        const response = await fetch(url, { ...options, headers });

        // Si el token expiró, limpiar y redirigir
        if (response.status === 401) {
            try {
                const data = await response.clone().json();
                if (data.code === 'TOKEN_EXPIRED') {
                    this.clearSession();
                    window.location.href = '/login.html?expired=1';
                    return null;
                }
            } catch (e) {
                // No es JSON, continuar
            }
        }

        return response;
    },

    /**
     * Proteger página (redirigir si no autenticado)
     */
    async protegerPagina(rolesPermitidos = []) {
        const usuario = await this.verificarSesion();

        if (!usuario) {
            window.location.href = '/login.html';
            return null;
        }

        if (rolesPermitidos.length > 0 && !rolesPermitidos.includes(usuario.rol)) {
            alert('No tienes permiso para acceder a esta página');
            // Redirigir según rol
            if (usuario.rol === 'admin') {
                window.location.href = '/panel-admin.html';
            } else if (usuario.rol === 'usuario_ips') {
                window.location.href = '/ordenes.html';
            } else {
                window.location.href = '/panel-empresas.html';
            }
            return null;
        }

        return usuario;
    },

    /**
     * Determina si el usuario actual es super-admin (admin del tenant BSL).
     * Si el user no tiene tenant_id (sesión vieja antes del branding multi-tenant),
     * usa el hostname para determinarlo — NO asume bsl como fallback, porque eso
     * escalaría privilegios de admins de otros tenants.
     */
    esSuperAdmin() {
        const user = this.getUser();
        if (!user) return false;
        if (user.rol !== 'admin' && user.rol !== 'ADMIN') return false;

        // Si el user tiene tenant_id, usarlo (fuente de verdad)
        if (user.tenant_id) return user.tenant_id === 'bsl';

        // Fallback: hostname actual. Solo bsl-plataforma.com / localhost son BSL.
        const host = window.location.hostname;
        return host === 'bsl-plataforma.com' ||
               host === 'www.bsl-plataforma.com' ||
               host === 'localhost' ||
               host === '127.0.0.1';
    },

    /**
     * Redirigir según rol del usuario
     * Multi-tenant: solo super-admins (BSL) van a panel-admin.html.
     * Los admins de otros tenants (ipsVip, etc.) van directo a ordenes.html
     * porque panel-admin.html tiene accesos cross-tenant exclusivos del super-admin.
     */
    redirigirSegunRol(rol) {
        // Verificar si hay un parámetro redirect en la URL
        const urlParams = new URLSearchParams(window.location.search);
        const redirectUrl = urlParams.get('redirect');

        // Si hay redirect y el usuario es admin, redirigir allí
        if (redirectUrl && (rol === 'admin' || rol === 'ADMIN')) {
            window.location.href = redirectUrl;
            return;
        }

        // Redirección normal según rol
        const user = this.getUser();
        const esSuper = this.esSuperAdmin();

        if (esSuper && user && user.email === 'danieltalero78@gmail.com') {
            // Hack histórico: BSL owner va directo a ordenes.html
            window.location.href = '/ordenes.html';
        } else if (esSuper) {
            // Otros super-admins BSL van al panel admin
            window.location.href = '/panel-admin.html';
        } else if (rol === 'admin' || rol === 'ADMIN') {
            // Admins de otros tenants van a ordenes (no tienen acceso a panel-admin)
            window.location.href = '/ordenes.html';
        } else if (rol === 'usuario_ips') {
            window.location.href = '/ordenes.html';
        } else {
            window.location.href = '/panel-empresas.html';
        }
    }
};

// Exportar para uso global
window.Auth = Auth;
