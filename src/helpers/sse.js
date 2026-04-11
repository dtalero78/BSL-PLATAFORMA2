// ========== SERVER-SENT EVENTS (SSE) ==========
// Clientes conectados para notificaciones en tiempo real.
// Multi-tenant: cada cliente se asocia a un tenant y solo recibe eventos
// de su propio tenant (ver CLAUDE.md Multi-Tenant Architecture).
let sseClients = [];

/**
 * Notifica a los clientes SSE de un tenant específico.
 * @param {Object} orden - Datos de la orden
 * @param {string} tenantId - Tenant al que pertenece la orden. Si se omite, emite a todos
 *                            (modo legacy; usar solo cuando no hay tenant disponible).
 */
function notificarNuevaOrden(orden, tenantId = null) {
    const data = JSON.stringify({ type: 'nueva-orden', orden, tenant_id: tenantId });
    let enviados = 0;

    sseClients.forEach(client => {
        // Solo enviar a clientes del mismo tenant.
        // Si el evento no tiene tenantId (legacy), emite a todos como fallback.
        if (!tenantId || client.tenantId === tenantId) {
            try {
                client.res.write(`data: ${data}\n\n`);
                enviados++;
            } catch (err) {
                // Cliente desconectado — se removerá en el próximo cleanup
            }
        }
    });

    console.log(`📡 Notificación SSE enviada a ${enviados}/${sseClients.length} clientes (tenant: ${tenantId || 'ALL'})`);
}

/**
 * Agrega un cliente SSE. Debe incluir tenantId para que reciba solo
 * eventos de su tenant.
 */
function addSSEClient(client) {
    sseClients.push(client);
}

// Remover un cliente SSE por ID
function removeSSEClient(clientId) {
    sseClients = sseClients.filter(c => c.id !== clientId);
}

// Obtener la lista de clientes SSE
function getSSEClients() {
    return sseClients;
}

module.exports = {
    notificarNuevaOrden,
    addSSEClient,
    removeSSEClient,
    getSSEClients
};
