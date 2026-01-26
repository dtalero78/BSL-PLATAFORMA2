const crypto = require('crypto');
const { OpenAI } = require('openai');

// Configurar OpenAI (lazy init para evitar error si falta API key al cargar)
let _openai;
function getOpenAI() {
    if (!_openai) {
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}
// Proxy para mantener compatibilidad con código que usa `openai.xxx`
const openai = new Proxy({}, { get: (_, prop) => getOpenAI()[prop] });

// ========== SISTEMA DE BOT CONVERSACIONAL CON IA ==========
// System prompt para el bot de WhatsApp
const systemPromptBot = `Eres el asistente virtual de BSL para exámenes médicos ocupacionales en Colombia.

TU PROPOSITO:
Ayudar a usuarios a agendar exámenes médicos ocupacionales de forma clara y eficiente.

TRANSFERIR A ASESOR:
Si no entiendes algo, hay problemas técnicos, el usuario lo solicita, o pregunta por su examen/certificado/pago/cita específica, responde EXACTAMENTE:
"...transfiriendo con asesor"

TEMAS FUERA DE ALCANCE:
Si preguntan temas personales, emocionales o NO relacionados con exámenes médicos:
"¿Necesitas agendar un examen?"

SERVICIOS Y PRECIOS:

**Exámenes Ocupacionales (Paquete Completo):**
• Virtual: $52.000
  - 100% online, 7am-7pm todos los días
  - 35 minutos total
  - Incluye: Médico osteomuscular, audiometría, optometría (se puede cambiar por visiometría)

• Presencial: $69.000 Calle 134 No. 7-83, Bogotá
  - Lunes a Viernes 7:30am-4:30pm, Sábados 8am-11:30am
  - Incluye: Médico, audiometría, optometría

**Link de agendamiento:** https://bsl-plataforma.com/nuevaorden1.html

**Exámenes extras opcionales:**
• Cardiovascular, Vascular, Espirometría, Dermatológico: $10.000 c/u
• Psicológico: $23.000
• Perfil lipídico: $69.500
• Glicemia: $23.100

**Solicitud especial:**
• Solo Visiometría y Optometría virtual (sin osteomuscular y audiometría): $23.000
• NO se hace solo examen médico osteomuscular. SE HACE EL PAQUETE COMPLETO

**Medios de pago:**
• Bancolombia: Ahorros 44291192456 (cédula 79981585)
• Daviplata: 3014400818
• Nequi: 3008021701
• Transfiya

PROCESO:
1. Usuario agenda en el link
2. Realiza pruebas virtuales (25 min)
3. Consulta médica (10 min)
4. Médico revisa y aprueba certificado
5. Usuario paga y envía comprobante por WhatsApp
6. Descarga certificado sin marca de agua

IMPORTANTE SOBRE CERTIFICADOS:
- NO se envían automáticamente al correo
- Primero se paga DESPUÉS de que el médico apruebe
- El certificado se descarga desde link enviado por WhatsApp

COMO RESPONDER:

**Saludos:**
"¡Hola! ¿En qué puedo ayudarte hoy?"

**Información general:**
"Nuestras opciones:
• Virtual – $52.000
• Presencial – $69.000 Calle 134 No. 7-83, Bogotá

Para agendar: https://bsl-plataforma.com/nuevaorden1.html"

**Preguntas sobre pago:**
"El pago se realiza DESPUÉS de que el médico revise y apruebe tu examen.

Medios de pago:
• Bancolombia: 44291192456
• Daviplata: 3014400818
• Nequi: 3008021701
• Transfiya

Una vez pagues, envía el comprobante por acá y te quitamos la marca de agua del certificado."

**Datos Legales de BSL (si preguntan):**
NIT: 900.844.030-8
LICENCIA: Resolución No 64 de 10/01/2017
CÓDIGO PRESTADOR REPS: 1100130342
DISTINTIVO: DHSS0244914
Consulta en: https://prestadores.minsalud.gov.co/habilitacion/

REGLAS DE FORMATO:
- Respuestas cortas y claras
- NO uses formato markdown para URLs (escribe URLs en texto plano)
- NO repitas información que ya diste
- Mantén el contexto de la conversación
`;

// Modelo de embeddings para RAG
const EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Genera un embedding para un texto dado (RAG)
 * @param {string} text - Texto a convertir en embedding
 * @returns {Promise<number[]>} - Vector de embedding
 */
async function generarEmbeddingRAG(text) {
    try {
        const response = await openai.embeddings.create({
            model: EMBEDDING_MODEL,
            input: text.trim().substring(0, 8000),
        });
        return response.data[0].embedding;
    } catch (error) {
        console.error('[ERROR] RAG: Error generando embedding:', error.message);
        throw error;
    }
}

/**
 * Genera hash unico para evitar duplicados en RAG
 */
function generarHashRAG(userId, pregunta, respuesta) {
    const contenido = `${userId}|${pregunta}|${respuesta}`;
    return crypto.createHash('sha256').update(contenido).digest('hex');
}

/**
 * Detecta la categoria de una pregunta usando keywords
 */
function detectarCategoriaRAG(texto) {
    const textoLower = texto.toLowerCase();

    const categorias = {
        precios: ['precio', 'costo', 'cuanto', 'valor', 'pago', '$', 'plata', 'tarifa'],
        horarios: ['horario', 'hora', 'cuando', 'disponible', 'abierto', 'atienden'],
        agendamiento: ['agendar', 'cita', 'reservar', 'programar', 'turno', 'agenda'],
        virtual: ['virtual', 'online', 'casa', 'remoto', 'videollamada'],
        presencial: ['presencial', 'ir', 'direccion', 'ubicacion', 'donde', 'sede'],
        certificado: ['certificado', 'descargar', 'pdf', 'listo', 'documento', 'constancia'],
        pagos: ['pagar', 'nequi', 'daviplata', 'bancolombia', 'transferencia', 'comprobante'],
        examenes: ['examen', 'audiometria', 'optometria', 'visiometria', 'medico', 'prueba']
    };

    for (const [categoria, keywords] of Object.entries(categorias)) {
        if (keywords.some(kw => textoLower.includes(kw))) {
            return categoria;
        }
    }
    return 'general';
}

/**
 * Guarda un par pregunta-respuesta con su embedding en RAG
 * @param {Object} params - Parametros del par
 */
async function guardarParConEmbeddingRAG(poolRef, {
    userId,
    pregunta,
    respuesta,
    fuente = 'bot',
    timestampOriginal = new Date()
}) {
    try {
        // Validar que haya contenido sustancial
        if (!pregunta || !respuesta || pregunta.length < 3 || respuesta.length < 5) {
            console.log('[RAG] Par omitido (contenido muy corto)');
            return { omitido: true };
        }

        // Generar hash para evitar duplicados
        const hash = generarHashRAG(userId, pregunta, respuesta);

        // Verificar si ya existe
        const existente = await poolRef.query(
            'SELECT id FROM conversacion_embeddings WHERE hash_mensaje = $1',
            [hash]
        );

        if (existente.rows.length > 0) {
            console.log(`[RAG] Par ya existe (hash: ${hash.substring(0, 8)}...)`);
            return { duplicado: true, id: existente.rows[0].id };
        }

        // Generar embedding de la pregunta
        const embeddingPregunta = await generarEmbeddingRAG(pregunta);

        // Detectar categoria
        const categoria = detectarCategoriaRAG(pregunta);

        // Peso segun fuente (admin tiene mas peso)
        const peso = fuente === 'admin' ? 2.0 : 1.0;

        // Insertar en PostgreSQL
        const result = await poolRef.query(`
            INSERT INTO conversacion_embeddings (
                user_id, pregunta, respuesta, fuente, peso,
                embedding_pregunta, categoria, timestamp_original, hash_mensaje
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
        `, [
            userId,
            pregunta,
            respuesta,
            fuente,
            peso,
            JSON.stringify(embeddingPregunta),
            categoria,
            timestampOriginal,
            hash
        ]);

        console.log(`[OK] RAG: Par guardado (id: ${result.rows[0].id}, fuente: ${fuente}, cat: ${categoria})`);
        return { duplicado: false, id: result.rows[0].id };

    } catch (error) {
        console.error('[ERROR] RAG: Error guardando par:', error.message);
        return { error: error.message };
    }
}

/**
 * Busca respuestas similares a una pregunta en RAG
 * @param {string} pregunta - Pregunta del usuario
 * @param {Object} options - Opciones de busqueda
 * @returns {Promise<Array>} - Resultados ordenados por relevancia
 */
async function buscarRespuestasSimilaresRAG(poolRef, pregunta, options = {}) {
    const {
        limite = 3,
        umbralSimilitud = 0.65,
        pesoAdmin = 1.5
    } = options;

    try {
        // Verificar si hay datos suficientes
        const countResult = await poolRef.query('SELECT COUNT(*) FROM conversacion_embeddings');
        const totalRegistros = parseInt(countResult.rows[0].count);

        if (totalRegistros < 1) {
            console.log('[RAG] Sin datos aun para busqueda');
            return [];
        }

        // Generar embedding de la pregunta
        const embeddingPregunta = await generarEmbeddingRAG(pregunta);

        // Query con similitud coseno
        const result = await poolRef.query(`
            SELECT
                id,
                pregunta,
                respuesta,
                fuente,
                peso,
                categoria,
                veces_usado,
                1 - (embedding_pregunta <=> $1::vector) as similitud
            FROM conversacion_embeddings
            WHERE (1 - (embedding_pregunta <=> $1::vector)) >= $2
            ORDER BY (
                (1 - (embedding_pregunta <=> $1::vector)) * peso *
                CASE WHEN fuente = 'admin' THEN $3 ELSE 1.0 END
            ) DESC
            LIMIT $4
        `, [JSON.stringify(embeddingPregunta), umbralSimilitud, pesoAdmin, limite]);

        // Procesar resultados
        const resultados = result.rows.map(row => ({
            id: row.id,
            pregunta: row.pregunta,
            respuesta: row.respuesta,
            fuente: row.fuente,
            categoria: row.categoria,
            similitud: parseFloat(row.similitud),
            score: parseFloat(row.similitud) * row.peso * (row.fuente === 'admin' ? pesoAdmin : 1.0)
        }));

        // Actualizar contador de uso
        if (resultados.length > 0) {
            const ids = resultados.map(r => r.id);
            await poolRef.query(`
                UPDATE conversacion_embeddings
                SET veces_usado = veces_usado + 1
                WHERE id = ANY($1)
            `, [ids]);
        }

        console.log(`[RAG] ${resultados.length} resultados para: "${pregunta.substring(0, 40)}..."`);

        return resultados;

    } catch (error) {
        console.error('[ERROR] RAG: Error en busqueda:', error.message);
        return [];
    }
}

/**
 * Formatea los resultados RAG para incluir en el contexto de OpenAI
 * @param {Array} resultados - Resultados de busqueda
 * @returns {string} - Texto formateado para el contexto
 */
function formatearContextoRAG(resultados) {
    if (!resultados || resultados.length === 0) {
        return '';
    }

    let contexto = '\n\nINSTRUCCION PRIORITARIA - RESPUESTAS APRENDIDAS:\n';
    contexto += 'Las siguientes respuestas provienen de conversaciones reales con HUMANOS (admin).\n';
    contexto += 'DEBES usar EXACTAMENTE estas respuestas cuando la pregunta sea similar.\n';
    contexto += 'NO inventes informacion diferente si ya existe una respuesta aprendida.\n\n';

    resultados.forEach((r, index) => {
        const fuenteLabel = r.fuente === 'admin' ? 'RESPUESTA HUMANA VERIFICADA' : 'Bot previo';
        const scorePercent = (r.similitud * 100).toFixed(0);

        contexto += `EJEMPLO ${index + 1} (${scorePercent}% relevante - ${fuenteLabel}):\n`;
        contexto += `Usuario pregunto: "${r.pregunta}"\n`;
        contexto += `Respuesta correcta: "${r.respuesta}"\n\n`;
    });

    contexto += 'RECUERDA: Si la pregunta actual es similar a alguno de estos ejemplos, usa la respuesta aprendida.\n';
    contexto += '--- FIN INSTRUCCIONES PRIORITARIAS ---\n';

    return contexto;
}

/**
 * Recuperar mensajes del historial de una conversacion para el bot
 * @param {number} conversacionId - ID de la conversacion
 * @param {number} limite - Numero maximo de mensajes a recuperar
 * @returns {Promise<Array>} - Array de mensajes en formato OpenAI
 */
async function recuperarMensajesBot(poolRef, conversacionId, limite = 10) {
    try {
        const result = await poolRef.query(`
            SELECT direccion, contenido, timestamp
            FROM mensajes_whatsapp
            WHERE conversacion_id = $1
            ORDER BY timestamp DESC
            LIMIT $2
        `, [conversacionId, limite]);

        // Invertir para que queden en orden cronologico y convertir a formato OpenAI
        const mensajes = result.rows.reverse().map(msg => ({
            role: msg.direccion === 'entrante' ? 'user' : 'assistant',
            content: msg.contenido
        }));

        console.log(`[BOT] Recuperados ${mensajes.length} mensajes de conversacion ${conversacionId}`);
        return mensajes;
    } catch (error) {
        console.error('[ERROR] Bot: Error recuperando mensajes:', error.message);
        return [];
    }
}

// FUNCIONES DE BUSQUEDA DE CITAS ELIMINADAS
// Ya no se busca informacion de citas automaticamente por celular o documento

/**
 * Genera respuesta del bot usando OpenAI
 * @param {Array} conversationHistory - Historial de conversacion
 * @returns {Promise<string>} - Respuesta del bot
 */
async function getAIResponseBot(conversationHistory = []) {
    try {
        const messages = [
            { role: 'system', content: systemPromptBot },
            ...conversationHistory
        ];

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            temperature: 0.5,  // Mas bajo = mas consistente
            max_tokens: 300,   // Mas bajo = respuestas mas cortas
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error('[ERROR] Bot: Error con OpenAI:', error);
        return 'Lo siento, tuve un problema técnico. ¿Podrías repetir tu pregunta?';
    }
}

// Map para gestion de estado de flujo de pagos
const estadoPagos = new Map();
const ESTADO_ESPERANDO_DOCUMENTO = 'esperando_documento';

// NUEVO: Estado global de modos de conversacion
const estadoConversacion = new Map();
const MODO_BOT = 'modo_bot';           // Bot conversacional activo
const MODO_PAGO = 'modo_pago';         // Flujo de pago activo
const MODO_HUMANO = 'modo_humano';     // Asesor humano atendiendo

module.exports = {
    openai,
    systemPromptBot,
    EMBEDDING_MODEL,
    generarEmbeddingRAG,
    generarHashRAG,
    detectarCategoriaRAG,
    guardarParConEmbeddingRAG,
    buscarRespuestasSimilaresRAG,
    formatearContextoRAG,
    recuperarMensajesBot,
    getAIResponseBot,
    estadoPagos,
    ESTADO_ESPERANDO_DOCUMENTO,
    estadoConversacion,
    MODO_BOT,
    MODO_PAGO,
    MODO_HUMANO
};
