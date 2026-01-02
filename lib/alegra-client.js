/**
 * Cliente para la API de Alegra
 * Documentación: https://developer.alegra.com/
 */

require('dotenv').config();
const fetch = require('node-fetch');

class AlegraClient {
    constructor(email = null, token = null) {
        this.email = email || process.env.ALEGRA_EMAIL;
        this.token = token || process.env.ALEGRA_TOKEN;
        this.baseUrl = process.env.ALEGRA_API_URL || 'https://api.alegra.com/api/v1';

        if (!this.email || !this.token) {
            throw new Error('Credenciales de Alegra no configuradas. Verifica ALEGRA_EMAIL y ALEGRA_TOKEN en .env');
        }

        // Generar credenciales en formato Basic Auth (base64)
        this.authHeader = this._generateAuthHeader();
    }

    /**
     * Genera el header de autenticación Basic Auth
     * @private
     */
    _generateAuthHeader() {
        const credentials = `${this.email}:${this.token}`;
        const base64Credentials = Buffer.from(credentials).toString('base64');
        return `Basic ${base64Credentials}`;
    }

    /**
     * Realiza una petición HTTP a la API de Alegra
     * @private
     */
    async _request(method, endpoint, body = null) {
        const url = `${this.baseUrl}${endpoint}`;
        const options = {
            method,
            headers: {
                'Authorization': this.authHeader,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        try {
            console.log(`📤 Alegra API ${method} ${endpoint}`);
            const response = await fetch(url, options);
            const data = await response.json();

            if (!response.ok) {
                const error = new Error(`Alegra API Error: ${data.message || response.statusText}`);
                error.statusCode = response.status;
                error.response = data;
                throw error;
            }

            console.log(`✅ Alegra API ${method} ${endpoint} - Success`);
            return {
                success: true,
                data,
                statusCode: response.status
            };

        } catch (error) {
            console.error(`❌ Alegra API ${method} ${endpoint} - Error:`, error.message);
            throw error;
        }
    }

    // ==================== CLIENTES ====================

    /**
     * Obtener lista de clientes
     */
    async getClients(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const endpoint = `/contacts${queryString ? '?' + queryString : ''}`;
        return this._request('GET', endpoint);
    }

    /**
     * Buscar cliente por identificación
     */
    async getClientByIdentification(identification) {
        const result = await this.getClients({ identification });
        if (result.data && result.data.length > 0) {
            return { success: true, data: result.data[0] };
        }
        return { success: false, data: null };
    }

    /**
     * Crear cliente en Alegra
     */
    async createClient(clientData) {
        return this._request('POST', '/contacts', clientData);
    }

    // ==================== ITEMS (Productos/Servicios) ====================

    /**
     * Obtener lista de items (productos/servicios)
     */
    async getItems(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const endpoint = `/items${queryString ? '?' + queryString : ''}`;
        return this._request('GET', endpoint);
    }

    /**
     * Crear un producto/servicio
     */
    async createItem(itemData) {
        return this._request('POST', '/items', itemData);
    }

    // ==================== FACTURAS ====================

    /**
     * Crear factura de venta
     * @param {Object} invoiceData - Datos de la factura
     * @param {Object} invoiceData.client - Cliente (objeto con id o datos completos)
     * @param {Array} invoiceData.items - Array de items [{id, name, price, quantity}]
     * @param {String} invoiceData.date - Fecha de la factura (YYYY-MM-DD)
     * @param {String} invoiceData.dueDate - Fecha de vencimiento (YYYY-MM-DD)
     * @param {String} invoiceData.observations - Observaciones
     * @param {String} invoiceData.termsConditions - Términos y condiciones
     */
    async createInvoice(invoiceData) {
        return this._request('POST', '/invoices', invoiceData);
    }

    /**
     * Obtener factura por ID
     */
    async getInvoice(invoiceId) {
        return this._request('GET', `/invoices/${invoiceId}`);
    }

    /**
     * Obtener lista de facturas
     */
    async getInvoices(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const endpoint = `/invoices${queryString ? '?' + queryString : ''}`;
        return this._request('GET', endpoint);
    }

    /**
     * Actualizar factura
     */
    async updateInvoice(invoiceId, invoiceData) {
        return this._request('PUT', `/invoices/${invoiceId}`, invoiceData);
    }

    /**
     * Anular factura
     */
    async voidInvoice(invoiceId) {
        return this._request('DELETE', `/invoices/${invoiceId}`);
    }

    /**
     * Enviar factura por correo
     */
    async sendInvoiceByEmail(invoiceId, emailData) {
        return this._request('POST', `/invoices/${invoiceId}/email`, emailData);
    }

    // ==================== UTILIDADES ====================

    /**
     * Construir objeto de cliente para Alegra desde datos de paciente
     */
    buildClientFromPatient(patientData) {
        return {
            name: `${patientData.primerNombre || ''} ${patientData.segundoNombre || ''} ${patientData.primerApellido || ''} ${patientData.segundoApellido || ''}`.trim(),
            identification: patientData.numeroId,
            phonePrimary: patientData.celular || patientData.celularWhatsapp,
            email: patientData.email || null,
            address: {
                address: patientData.direccion || ''
            },
            type: 'client'
        };
    }

    /**
     * Construir objeto de item para factura
     */
    buildInvoiceItem(itemConfig) {
        return {
            id: itemConfig.alegra_item_id || undefined,
            name: itemConfig.nombre || itemConfig.descripcion,
            description: itemConfig.descripcion || '',
            price: itemConfig.precio || itemConfig.precio_unitario,
            quantity: itemConfig.cantidad || 1,
            tax: itemConfig.impuesto || []
        };
    }

    /**
     * Validar datos de factura antes de enviar
     */
    validateInvoiceData(invoiceData) {
        const errors = [];

        if (!invoiceData.client) {
            errors.push('Se requiere información del cliente (client)');
        }

        if (!invoiceData.items || invoiceData.items.length === 0) {
            errors.push('Se requiere al menos un item en la factura');
        }

        if (!invoiceData.date) {
            errors.push('Se requiere fecha de la factura (date)');
        }

        if (errors.length > 0) {
            throw new Error(`Validación de factura falló: ${errors.join(', ')}`);
        }

        return true;
    }
}

module.exports = AlegraClient;
