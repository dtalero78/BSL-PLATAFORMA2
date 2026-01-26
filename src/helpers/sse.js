// ========== SERVER-SENT EVENTS (SSE) ==========
// Clientes conectados para notificaciones en tiempo real
let sseClients = [];

// Función para notificar a todos los clientes SSE
function notificarNuevaOrden(orden) {
    const data = JSON.stringify({ type: 'nueva-orden', orden });
    sseClients.forEach(client => {
        client.res.write(`data: ${data}\n\n`);
    });
    console.log(`📡 Notificación SSE enviada a ${sseClients.length} clientes`);
}

// Agregar un cliente SSE
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
