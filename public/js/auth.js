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
        return localStorage.getItem(this.TOKEN_KEY);
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
            } else if (usuario.rol === 'agente_chat') {
                window.location.href = '/panel-agentes.html';
            } else if (usuario.rol === 'supervisor_chat') {
                window.location.href = '/panel-supervisor-chats.html';
            } else {
                window.location.href = '/panel-empresas.html';
            }
            return null;
        }

        return usuario;
    },

    /**
     * Redirigir según rol del usuario
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
        if (rol === 'admin') {
            window.location.href = '/panel-admin.html';
        } else if (rol === 'agente_chat') {
            window.location.href = '/panel-agentes.html';
        } else if (rol === 'supervisor_chat') {
            window.location.href = '/panel-supervisor-chats.html';
        } else {
            window.location.href = '/panel-empresas.html';
        }
    }
};

// Exportar para uso global
window.Auth = Auth;
