const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { Pool } = require('pg');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 8080;

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

// Función para enviar mensajes de WhatsApp via Whapi Cloud
function sendWhatsAppMessage(toNumber, messageBody) {
    const url = "https://gate.whapi.cloud/messages/text";
    const headers = {
        "accept": "application/json",
        "authorization": "Bearer due3eWCwuBM2Xqd6cPujuTRqSbMb68lt",
        "content-type": "application/json"
    };
    const postData = {
        "typing_time": 0,
        "to": toNumber,
        "body": messageBody
    };

    return fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(postData)
    })
    .then(response => response.json())
    .then(json => {
        console.log(`📱 WhatsApp enviado a ${toNumber}:`, json);
        return json;
    })
    .catch(err => {
        console.error(`❌ Error enviando WhatsApp a ${toNumber}:`, err);
        return null;
    });
}

// Configuración de números de alerta por empresa
const NUMEROS_ALERTA_POR_EMPRESA = {
    "SIIGO": [
        "573008021701",
        "573045792035",
        "573138232201"
    ],
    "MASIN": [
        "573112634312",
        "573008021701"
    ]
};

// Función para enviar alertas de preguntas críticas (para empresas SIIGO y MASIN)
async function enviarAlertasPreguntasCriticas(datos) {
    // Verificar si la empresa tiene alertas configuradas
    const numerosAlerta = NUMEROS_ALERTA_POR_EMPRESA[datos.codEmpresa];

    if (!numerosAlerta) {
        console.log('ℹ️ Alertas WhatsApp omitidas - Empresa:', datos.codEmpresa || 'No especificada', '(solo aplica para SIIGO y MASIN)');
        return;
    }

    const alertas = [];

    // Verificar cada pregunta nueva y agregar alertas si es afirmativa
    if (datos.trastornoPsicologico === "SI") {
        alertas.push("🧠 Trastorno psicológico o psiquiátrico diagnosticado");
    }
    if (datos.sintomasPsicologicos === "SI") {
        alertas.push("😰 Síntomas psicológicos en los últimos 2 años (ansiedad, depresión, pánico)");
    }
    if (datos.diagnosticoCancer === "SI") {
        alertas.push("🎗️ Diagnóstico o estudio por sospecha de cáncer");
    }
    if (datos.enfermedadesLaborales === "SI") {
        alertas.push("⚠️ Enfermedades laborales o accidentes de trabajo previos");
    }
    if (datos.enfermedadOsteomuscular === "SI") {
        alertas.push("🦴 Enfermedad osteomuscular diagnosticada");
    }
    if (datos.enfermedadAutoinmune === "SI") {
        alertas.push("🔬 Enfermedad autoinmune diagnosticada");
    }

    // Si hay alertas, enviar mensaje a los números configurados
    if (alertas.length > 0) {
        const nombreCompleto = `${datos.primerNombre || ''} ${datos.primerApellido || ''}`.trim() || 'No especificado';
        const mensaje = `🚨 *ALERTA - Formulario Médico BSL*\n\n` +
            `👤 *Paciente:* ${nombreCompleto}\n` +
            `🆔 *Cédula:* ${datos.numeroId || 'No especificada'}\n` +
            `📱 *Celular:* ${datos.celular || 'No especificado'}\n` +
            `🏢 *Empresa:* ${datos.empresa || 'No especificada'}\n\n` +
            `⚠️ *Condiciones reportadas:*\n${alertas.map(a => `• ${a}`).join('\n')}\n\n` +
            `_Revisar historia clínica antes de la consulta._`;

        console.log('🚨 Enviando alertas de preguntas críticas para empresa', datos.codEmpresa, '...');

        // Enviar a todos los números de la empresa
        const promesas = numerosAlerta.map(numero => sendWhatsAppMessage(numero, mensaje));
        await Promise.all(promesas);

        console.log('✅ Alertas enviadas a', numerosAlerta.length, 'números');
    }
}

// Configuración de PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
        rejectUnauthorized: false
    }
});

// Crear tabla si no existe
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS formularios (
                id SERIAL PRIMARY KEY,
                wix_id VARCHAR(100),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                numero_id VARCHAR(50),
                celular VARCHAR(20),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),
                fecha_atencion VARCHAR(50),
                hora_atencion VARCHAR(10),
                genero VARCHAR(20),
                edad INTEGER,
                fecha_nacimiento VARCHAR(20),
                lugar_nacimiento VARCHAR(100),
                ciudad_residencia VARCHAR(100),
                hijos INTEGER,
                profesion_oficio VARCHAR(100),
                empresa1 VARCHAR(100),
                empresa2 VARCHAR(100),
                estado_civil VARCHAR(50),
                nivel_educativo VARCHAR(50),
                email VARCHAR(100),
                estatura VARCHAR(10),
                peso DECIMAL(5,2),
                ejercicio VARCHAR(50),
                cirugia_ocular VARCHAR(10),
                consumo_licor VARCHAR(50),
                cirugia_programada VARCHAR(10),
                condicion_medica VARCHAR(10),
                dolor_cabeza VARCHAR(10),
                dolor_espalda VARCHAR(10),
                ruido_jaqueca VARCHAR(10),
                embarazo VARCHAR(10),
                enfermedad_higado VARCHAR(10),
                enfermedad_pulmonar VARCHAR(10),
                fuma VARCHAR(10),
                hernias VARCHAR(10),
                hormigueos VARCHAR(10),
                presion_alta VARCHAR(10),
                problemas_azucar VARCHAR(10),
                problemas_cardiacos VARCHAR(10),
                problemas_sueno VARCHAR(10),
                usa_anteojos VARCHAR(10),
                usa_lentes_contacto VARCHAR(10),
                varices VARCHAR(10),
                hepatitis VARCHAR(10),
                familia_hereditarias VARCHAR(10),
                familia_geneticas VARCHAR(10),
                familia_diabetes VARCHAR(10),
                familia_hipertension VARCHAR(10),
                familia_infartos VARCHAR(10),
                familia_cancer VARCHAR(10),
                familia_trastornos VARCHAR(10),
                familia_infecciosas VARCHAR(10),
                trastorno_psicologico VARCHAR(10),
                sintomas_psicologicos VARCHAR(10),
                diagnostico_cancer VARCHAR(10),
                enfermedades_laborales VARCHAR(10),
                enfermedad_osteomuscular VARCHAR(10),
                enfermedad_autoinmune VARCHAR(10),
                firma TEXT,
                inscripcion_boletin VARCHAR(10),
                foto TEXT,
                fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Agregar columnas de Wix si no existen
        const columnsToAdd = [
            'wix_id VARCHAR(100)',
            'primer_nombre VARCHAR(100)',
            'primer_apellido VARCHAR(100)',
            'numero_id VARCHAR(50)',
            'celular VARCHAR(20)',
            'empresa VARCHAR(100)',
            'cod_empresa VARCHAR(50)',
            'fecha_atencion VARCHAR(50)',
            'hora_atencion VARCHAR(10)',
            // Nuevas preguntas de salud personal
            'trastorno_psicologico VARCHAR(10)',
            'sintomas_psicologicos VARCHAR(10)',
            'diagnostico_cancer VARCHAR(10)',
            'enfermedades_laborales VARCHAR(10)',
            'enfermedad_osteomuscular VARCHAR(10)',
            'enfermedad_autoinmune VARCHAR(10)'
        ];

        for (const column of columnsToAdd) {
            const columnName = column.split(' ')[0];
            try {
                await pool.query(`
                    ALTER TABLE formularios
                    ADD COLUMN IF NOT EXISTS ${column}
                `);
            } catch (err) {
                // Columna ya existe, continuar
            }
        }

        // Modificar el tipo de columna si ya existe con tamaño menor
        try {
            await pool.query(`
                ALTER TABLE formularios
                ALTER COLUMN fecha_atencion TYPE VARCHAR(50)
            `);
        } catch (err) {
            // Si falla, es porque la columna no existe o ya tiene el tipo correcto
        }

        // Agregar columna horaAtencion a HistoriaClinica si no existe
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS "horaAtencion" VARCHAR(10)
            `);
        } catch (err) {
            // Columna ya existe o tabla no existe
        }

        // Agregar columna recordatorioLinkEnviado a HistoriaClinica si no existe
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS "recordatorioLinkEnviado" BOOLEAN DEFAULT false
            `);
        } catch (err) {
            // Columna ya existe o tabla no existe
        }

        // Crear tabla medicos_disponibilidad si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS medicos_disponibilidad (
                id SERIAL PRIMARY KEY,
                medico_id INTEGER NOT NULL REFERENCES medicos(id) ON DELETE CASCADE,
                dia_semana INTEGER NOT NULL CHECK (dia_semana >= 0 AND dia_semana <= 6),
                hora_inicio TIME NOT NULL,
                hora_fin TIME NOT NULL,
                modalidad VARCHAR(20) DEFAULT 'presencial',
                activo BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(medico_id, dia_semana, modalidad)
            )
        `);

        // Agregar columna modalidad si no existe (para migraciones)
        try {
            await pool.query(`
                ALTER TABLE medicos_disponibilidad
                ADD COLUMN IF NOT EXISTS modalidad VARCHAR(20) DEFAULT 'presencial'
            `);
        } catch (err) {
            // Columna ya existe
        }

        console.log('✅ Base de datos inicializada correctamente');
    } catch (error) {
        console.error('❌ Error al inicializar la base de datos:', error);
    }
};

initDB();

// Middleware CORS - permitir solicitudes desde Wix y otros dominios
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

    // Manejar preflight requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Ruta principal - servir el formulario
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== ENDPOINT SSE PARA NOTIFICACIONES EN TIEMPO REAL ==========
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Enviar heartbeat inicial
    res.write('data: {"type":"connected"}\n\n');

    // Agregar cliente a la lista
    const clientId = Date.now();
    const newClient = { id: clientId, res };
    sseClients.push(newClient);
    console.log(`📡 Cliente SSE conectado: ${clientId}. Total: ${sseClients.length}`);

    // Remover cliente cuando se desconecta
    req.on('close', () => {
        sseClients = sseClients.filter(client => client.id !== clientId);
        console.log(`📡 Cliente SSE desconectado: ${clientId}. Total: ${sseClients.length}`);
    });
});

// Ruta para obtener datos de Wix por ID
app.get('/api/wix/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const fetch = (await import('node-fetch')).default;

        const response = await fetch(`https://www.bsl.com.co/_functions/historiaClinicaPorId?_id=${id}`);

        if (!response.ok) {
            return res.status(404).json({
                success: false,
                message: 'No se encontró información en Wix'
            });
        }

        const result = await response.json();

        // Los datos vienen en result.data
        const wixData = result.data || {};

        res.json({
            success: true,
            data: {
                primerNombre: wixData.primerNombre,
                primerApellido: wixData.primerApellido,
                numeroId: wixData.numeroId,
                celular: wixData.celular,
                empresa: wixData.empresa,
                codEmpresa: wixData.codEmpresa,
                fechaAtencion: wixData.fechaAtencion,
                examenes: wixData.examenes || ""
            }
        });

    } catch (error) {
        console.error('❌ Error al consultar Wix:', error);
        res.status(500).json({
            success: false,
            message: 'Error al consultar datos de Wix',
            error: error.message
        });
    }
});

// Ruta para recibir el formulario
app.post('/api/formulario', async (req, res) => {
    try {
        const datos = req.body;

        // Validación básica
        if (!datos.genero || !datos.edad || !datos.email) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos obligatorios'
            });
        }

        // Insertar en PostgreSQL
        const query = `
            INSERT INTO formularios (
                wix_id, primer_nombre, primer_apellido, numero_id, celular,
                empresa, cod_empresa, fecha_atencion,
                genero, edad, fecha_nacimiento, lugar_nacimiento, ciudad_residencia,
                hijos, profesion_oficio, empresa1, empresa2, estado_civil,
                nivel_educativo, email, eps, arl, pensiones, estatura, peso, ejercicio,
                cirugia_ocular, consumo_licor, cirugia_programada, condicion_medica,
                dolor_cabeza, dolor_espalda, ruido_jaqueca, embarazo,
                enfermedad_higado, enfermedad_pulmonar, fuma, hernias,
                hormigueos, presion_alta, problemas_azucar, problemas_cardiacos,
                problemas_sueno, usa_anteojos, usa_lentes_contacto, varices,
                hepatitis, familia_hereditarias, familia_geneticas, familia_diabetes,
                familia_hipertension, familia_infartos, familia_cancer,
                familia_trastornos, familia_infecciosas,
                trastorno_psicologico, sintomas_psicologicos, diagnostico_cancer,
                enfermedades_laborales, enfermedad_osteomuscular, enfermedad_autoinmune,
                firma, inscripcion_boletin, foto
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
                $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
                $51, $52, $53, $54, $55, $56, $57, $58, $59, $60,
                $61, $62, $63, $64
            ) RETURNING id
        `;

        const values = [
            datos.wixId, datos.primerNombre, datos.primerApellido, datos.numeroId, datos.celular,
            datos.empresa, datos.codEmpresa, datos.fechaAtencion,
            datos.genero, datos.edad, datos.fechaNacimiento, datos.lugarDeNacimiento, datos.ciudadDeResidencia,
            datos.hijos, datos.profesionUOficio, datos.empresa1, datos.empresa2, datos.estadoCivil,
            datos.nivelEducativo, datos.email, datos.eps, datos.arl, datos.pensiones, datos.estatura, datos.peso, datos.ejercicio,
            datos.cirugiaOcular, datos.consumoLicor, datos.cirugiaProgramada, datos.condicionMedica,
            datos.dolorCabeza, datos.dolorEspalda, datos.ruidoJaqueca, datos.embarazo,
            datos.enfermedadHigado, datos.enfermedadPulmonar, datos.fuma, datos.hernias,
            datos.hormigueos, datos.presionAlta, datos.problemasAzucar, datos.problemasCardiacos,
            datos.problemasSueno, datos.usaAnteojos, datos.usaLentesContacto, datos.varices,
            datos.hepatitis, datos.familiaHereditarias, datos.familiaGeneticas, datos.familiaDiabetes,
            datos.familiaHipertension, datos.familiaInfartos, datos.familiaCancer,
            datos.familiaTrastornos, datos.familiaInfecciosas,
            datos.trastornoPsicologico, datos.sintomasPsicologicos, datos.diagnosticoCancer,
            datos.enfermedadesLaborales, datos.enfermedadOsteomuscular, datos.enfermedadAutoinmune,
            datos.firma, datos.inscripcionBoletin, datos.foto
        ];

        const result = await pool.query(query, values);

        console.log('✅ Formulario guardado en PostgreSQL:', result.rows[0].id);

        // Enviar alertas por WhatsApp si hay respuestas afirmativas en preguntas críticas
        try {
            await enviarAlertasPreguntasCriticas(datos);
        } catch (alertaError) {
            console.error('❌ Error al enviar alertas WhatsApp:', alertaError.message);
            // No bloqueamos la respuesta si falla el envío de alertas
        }

        // Enviar datos a Wix
        try {
            const fetch = (await import('node-fetch')).default;

            // Mapear encuestaSalud - solo incluir respuestas "Sí" (para tags de Wix)
            const encuestaSaludTags = [];
            if (datos.cirugiaOcular === "Sí") encuestaSaludTags.push("Cirugía ocular");
            if (datos.cirugiaProgramada === "Sí") encuestaSaludTags.push("Cirugías programadas");
            if (datos.condicionMedica === "Sí") encuestaSaludTags.push("Condición médica con tratamiento actual");
            if (datos.dolorCabeza === "Sí") encuestaSaludTags.push("Dolor de cabeza");
            if (datos.dolorEspalda === "Sí") encuestaSaludTags.push("Dolor de espalda");
            if (datos.ruidoJaqueca === "Sí") encuestaSaludTags.push("El ruido produce jaqueca");
            if (datos.embarazo === "Sí") encuestaSaludTags.push("Embarazo actual");
            if (datos.enfermedadHigado === "Sí") encuestaSaludTags.push("Enfermedades hígado");
            if (datos.enfermedadPulmonar === "Sí") encuestaSaludTags.push("Enfermedades pulmonares");
            if (datos.fuma === "Sí") encuestaSaludTags.push("Fuma o fumaba");
            if (datos.hernias === "Sí") encuestaSaludTags.push("Hernias");
            if (datos.hormigueos === "Sí") encuestaSaludTags.push("Hormigueos");
            if (datos.presionAlta === "Sí") encuestaSaludTags.push("Presión arterial alta");
            if (datos.problemasAzucar === "Sí") encuestaSaludTags.push("Problemas azúcar");
            if (datos.problemasCardiacos === "Sí") encuestaSaludTags.push("Problemas cardíacos");
            if (datos.problemasSueno === "Sí") encuestaSaludTags.push("Problemas de sueño");
            if (datos.usaAnteojos === "Sí") encuestaSaludTags.push("Usa anteojos");
            if (datos.usaLentesContacto === "Sí") encuestaSaludTags.push("Usa lentes de contacto");
            if (datos.varices === "Sí") encuestaSaludTags.push("Várices");
            // Nuevas preguntas de salud personal
            if (datos.trastornoPsicologico === "Sí") encuestaSaludTags.push("Trastorno psicológico o psiquiátrico");
            if (datos.sintomasPsicologicos === "Sí") encuestaSaludTags.push("Síntomas psicológicos recientes");
            if (datos.diagnosticoCancer === "Sí") encuestaSaludTags.push("Diagnóstico o sospecha de cáncer");
            if (datos.enfermedadesLaborales === "Sí") encuestaSaludTags.push("Enfermedades laborales o accidentes de trabajo");
            if (datos.enfermedadOsteomuscular === "Sí") encuestaSaludTags.push("Enfermedad osteomuscular");
            if (datos.enfermedadAutoinmune === "Sí") encuestaSaludTags.push("Enfermedad autoinmune");

            // Mapear antecedentesFamiliares - solo incluir respuestas "Sí" (para tags de Wix)
            const antecedentesFamiliaresTags = [];
            if (datos.hepatitis === "Sí") antecedentesFamiliaresTags.push("Hepatitis");
            if (datos.familiaHereditarias === "Sí") antecedentesFamiliaresTags.push("Enfermedades hereditarias");
            if (datos.familiaGeneticas === "Sí") antecedentesFamiliaresTags.push("Enfermedades genéticas");
            if (datos.familiaDiabetes === "Sí") antecedentesFamiliaresTags.push("Diabetes");
            if (datos.familiaHipertension === "Sí") antecedentesFamiliaresTags.push("Hipertensión");
            if (datos.familiaInfartos === "Sí") antecedentesFamiliaresTags.push("Infarto");
            if (datos.familiaCancer === "Sí") antecedentesFamiliaresTags.push("Cáncer");
            if (datos.familiaTrastornos === "Sí") antecedentesFamiliaresTags.push("Trastornos mentales o psicológicos");

            const wixPayload = {
                // itemId se removió - no es necesario
                numeroId: datos.wixId || "", // numeroId usa el mismo valor que wixId
                codEmpresa: datos.codEmpresa || "",
                primerNombre: datos.primerNombre || "",
                examenes: "", // No tenemos este dato
                celular: datos.celular || "No disponible",
                // Todos los campos van al mismo nivel, no dentro de "respuestas"
                ejercicio: datos.ejercicio || "",
                estadoCivil: datos.estadoCivil || "",
                hijos: datos.hijos || "",
                consumoLicor: datos.consumoLicor || "",
                email: datos.email || "",
                foto: datos.foto || "",
                firma: datos.firma || "",
                encuestaSalud: encuestaSaludTags, // Solo tags con respuestas "Sí"
                antecedentesFamiliares: antecedentesFamiliaresTags, // Solo tags con respuestas "Sí"
                fechaNacimiento: datos.fechaNacimiento || "",
                edad: datos.edad || "",
                genero: datos.genero || "",
                lugarDeNacimiento: datos.lugarDeNacimiento || "",
                ciudadDeResidencia: datos.ciudadDeResidencia || "",
                direccion: "", // No lo tenemos en el formulario
                profesionUOficio: datos.profesionUOficio || "",
                nivelEducativo: datos.nivelEducativo || "",
                empresa1: datos.empresa1 || "",
                empresa2: datos.empresa2 || "",
                eps: datos.eps || "",
                arl: datos.arl || "",
                pensiones: datos.pensiones || "",
                estatura: datos.estatura || "",
                peso: datos.peso || "",
                documentoIdentidad: datos.numeroId || "", // Número de cédula de HistoriaClinica
                idGeneral: datos.wixId || "",
                inscripcionBoletin: datos.inscripcionBoletin || ""
            };

            console.log('📤 Enviando datos a Wix...');
            console.log('📦 Payload:', JSON.stringify(wixPayload, null, 2));

            const wixResponse = await fetch('https://www.bsl.com.co/_functions/crearFormulario', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(wixPayload)
            });

            console.log('📡 Respuesta de Wix - Status:', wixResponse.status);

            if (wixResponse.ok) {
                const wixResult = await wixResponse.json();
                console.log('✅ Datos guardados en Wix exitosamente:', wixResult);
            } else {
                const errorText = await wixResponse.text();
                console.error('❌ ERROR al guardar en Wix:');
                console.error('   Status:', wixResponse.status);
                console.error('   Response:', errorText);
                // Intentar parsear como JSON para ver el error
                try {
                    const errorJson = JSON.parse(errorText);
                    console.error('   Error JSON:', errorJson);
                } catch (e) {
                    // No es JSON, ya imprimimos el texto
                }
            }

        } catch (wixError) {
            console.error('❌ EXCEPCIÓN al enviar a Wix:');
            console.error('   Mensaje:', wixError.message);
            console.error('   Stack:', wixError.stack);
            // No bloqueamos la respuesta si Wix falla
        }

        res.json({
            success: true,
            message: 'Formulario guardado correctamente',
            data: { id: result.rows[0].id }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error al procesar el formulario',
            error: error.message
        });
    }
});

// Ruta para obtener todos los formularios
app.get('/api/formularios', async (req, res) => {
    try {
        // Solo seleccionar los campos necesarios para la vista resumida
        // IMPORTANTE: No incluir 'foto' aquí porque son imágenes base64 muy grandes
        // que pueden causar errores de memoria cuando hay muchos registros
        // LEFT JOIN con HistoriaClinica para obtener fechaConsulta y atendido
        const result = await pool.query(`
            SELECT
                f.id,
                f.numero_id,
                f.celular,
                f.primer_nombre,
                f.primer_apellido,
                f.cod_empresa,
                f.wix_id,
                f.fecha_registro,
                hc."fechaConsulta" as fecha_consulta,
                hc."atendido" as estado_atencion
            FROM formularios f
            LEFT JOIN "HistoriaClinica" hc ON f.wix_id = hc."_id"
            ORDER BY f.fecha_registro DESC
        `);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener formularios',
            error: error.message
        });
    }
});

// Ruta para buscar por ID
app.get('/api/formulario/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM formularios WHERE id = $1', [id]);

        if (result.rows.length > 0) {
            res.json({ success: true, data: result.rows[0] });
        } else {
            res.status(404).json({
                success: false,
                message: 'Formulario no encontrado'
            });
        }
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error al buscar formulario',
            error: error.message
        });
    }
});

// Endpoint de búsqueda server-side para formularios (escala a 100,000+ registros)
app.get('/api/formularios/search', async (req, res) => {
    try {
        const { q } = req.query;

        // Requiere al menos 2 caracteres para buscar
        if (!q || q.length < 2) {
            return res.json({ success: true, data: [] });
        }

        console.log(`🔍 Buscando en formularios: "${q}"`);

        const searchTerm = `%${q}%`;
        const result = await pool.query(`
            SELECT
                f.id,
                f.numero_id,
                f.celular,
                f.primer_nombre,
                f.primer_apellido,
                f.cod_empresa,
                f.wix_id,
                f.fecha_registro,
                hc."fechaConsulta" as fecha_consulta,
                hc."atendido" as estado_atencion
            FROM formularios f
            LEFT JOIN "HistoriaClinica" hc ON f.wix_id = hc."_id"
            WHERE f.numero_id ILIKE $1
               OR f.primer_nombre ILIKE $1
               OR f.primer_apellido ILIKE $1
               OR f.cod_empresa ILIKE $1
               OR f.celular ILIKE $1
            ORDER BY f.fecha_registro DESC
            LIMIT 100
        `, [searchTerm]);

        console.log(`✅ Encontrados ${result.rows.length} formularios para "${q}"`);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error('❌ Error en búsqueda de formularios:', error);
        res.status(500).json({
            success: false,
            message: 'Error en la búsqueda',
            error: error.message
        });
    }
});

// Buscar formulario por numeroId (cédula)
app.get('/api/formularios/buscar/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;

        console.log(`🔍 Buscando formulario por numeroId: ${numeroId}`);

        const result = await pool.query(
            'SELECT * FROM formularios WHERE numero_id = $1 ORDER BY fecha_registro DESC LIMIT 1',
            [numeroId]
        );

        if (result.rows.length === 0) {
            return res.json({
                success: false,
                message: 'No se encontró formulario para este paciente'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error buscando formulario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al buscar formulario',
            error: error.message
        });
    }
});

// También crear una ruta con /api/formularios/:id para compatibilidad con el frontend
app.get('/api/formularios/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener datos del formulario
        const formularioResult = await pool.query('SELECT * FROM formularios WHERE id = $1', [id]);

        if (formularioResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Formulario no encontrado'
            });
        }

        const formulario = formularioResult.rows[0];

        // Intentar obtener datos de HistoriaClinica usando numero_id (cédula)
        let historiaClinica = null;
        if (formulario.numero_id) {
            try {
                const historiaResult = await pool.query(
                    'SELECT * FROM "HistoriaClinica" WHERE "numeroId" = $1',
                    [formulario.numero_id]
                );

                if (historiaResult.rows.length > 0) {
                    historiaClinica = historiaResult.rows[0];
                }
            } catch (historiaError) {
                console.error('⚠️ No se pudo obtener HistoriaClinica:', historiaError.message);
                // Continuar sin historia clínica
            }
        }

        // Combinar los datos
        const datosCompletos = {
            ...formulario,
            historiaClinica: historiaClinica
        };

        res.json({ success: true, data: datosCompletos });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error al buscar formulario',
            error: error.message
        });
    }
});

// Ruta para actualizar un formulario
app.put('/api/formularios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const datos = req.body;

        // Verificar que el formulario existe y obtener todos sus datos
        const checkResult = await pool.query('SELECT * FROM formularios WHERE id = $1', [id]);
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Formulario no encontrado'
            });
        }

        const formularioActual = checkResult.rows[0];

        // Convertir cadenas vacías a null para campos numéricos
        const parseNumeric = (value) => value === "" ? null : value;

        // Actualizar solo los campos que vienen en el body
        const query = `
            UPDATE formularios SET
                wix_id = COALESCE($1, wix_id),
                genero = COALESCE($2, genero),
                edad = COALESCE($3, edad),
                fecha_nacimiento = COALESCE($4, fecha_nacimiento),
                lugar_nacimiento = COALESCE($5, lugar_nacimiento),
                ciudad_residencia = COALESCE($6, ciudad_residencia),
                estado_civil = COALESCE($7, estado_civil),
                hijos = COALESCE($8, hijos),
                nivel_educativo = COALESCE($9, nivel_educativo),
                email = COALESCE($10, email),
                eps = COALESCE($11, eps),
                arl = COALESCE($12, arl),
                pensiones = COALESCE($13, pensiones),
                profesion_oficio = COALESCE($14, profesion_oficio),
                empresa1 = COALESCE($15, empresa1),
                empresa2 = COALESCE($16, empresa2),
                estatura = COALESCE($17, estatura),
                peso = COALESCE($18, peso),
                ejercicio = COALESCE($19, ejercicio)
            WHERE id = $20
            RETURNING *
        `;

        const values = [
            datos.wix_id || null,
            datos.genero,
            parseNumeric(datos.edad),
            datos.fecha_nacimiento,
            datos.lugar_nacimiento,
            datos.ciudad_residencia,
            datos.estado_civil,
            parseNumeric(datos.hijos),
            datos.nivel_educativo,
            datos.email,
            datos.eps,
            datos.arl,
            datos.pensiones,
            datos.profesion_oficio,
            datos.empresa1,
            datos.empresa2,
            parseNumeric(datos.estatura),
            parseNumeric(datos.peso),
            datos.ejercicio,
            id
        ];

        const result = await pool.query(query, values);
        const formularioActualizado = result.rows[0];

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ POSTGRESQL: Formulario actualizado exitosamente');
        console.log('   ID:', id);
        console.log('   Datos actualizados:', {
            genero: formularioActualizado.genero,
            edad: formularioActualizado.edad,
            email: formularioActualizado.email
        });
        console.log('═══════════════════════════════════════════════════════════');

        // Actualizar en Wix si tiene wix_id
        if (formularioActual.wix_id) {
            try {
                const fetch = (await import('node-fetch')).default;

                console.log('📤 Consultando registro en Wix por idGeneral:', formularioActual.wix_id);

                // PASO 1: Consultar el _id usando idGeneral
                const queryResponse = await fetch(`https://www.bsl.com.co/_functions/formularioPorIdGeneral?idGeneral=${formularioActual.wix_id}`);

                if (!queryResponse.ok) {
                    console.error('❌ ERROR al consultar formulario en Wix:');
                    console.error('   Status:', queryResponse.status);
                    const errorText = await queryResponse.text();
                    console.error('   Response:', errorText);
                    throw new Error('No se pudo consultar el registro en Wix');
                }

                const queryResult = await queryResponse.json();

                if (!queryResult.success || !queryResult.item) {
                    console.error('❌ No se encontró el registro en Wix con idGeneral:', formularioActual.wix_id);
                    throw new Error('Registro no encontrado en Wix');
                }

                const wixId = queryResult.item._id;
                console.log('✅ Registro encontrado en Wix. _id:', wixId);

                // PASO 2: Preparar payload para actualizar usando el _id correcto
                // Solo enviar campos que tienen valores en formularioActualizado
                const wixPayload = {
                    _id: wixId,  // Usar el _id interno de Wix
                    numeroId: formularioActualizado.numero_id || formularioActual.numero_id,
                    codEmpresa: formularioActualizado.cod_empresa || formularioActual.cod_empresa,
                    primerNombre: formularioActualizado.primer_nombre || formularioActual.primer_nombre,
                    celular: formularioActualizado.celular || formularioActual.celular,
                    ejercicio: formularioActualizado.ejercicio || formularioActual.ejercicio,
                    estadoCivil: formularioActualizado.estado_civil || formularioActual.estado_civil,
                    hijos: String(formularioActualizado.hijos || formularioActual.hijos || ''),
                    email: formularioActualizado.email || formularioActual.email,
                    fechaNacimiento: formularioActualizado.fecha_nacimiento || formularioActual.fecha_nacimiento,
                    edad: String(formularioActualizado.edad || formularioActual.edad || ''),
                    genero: formularioActualizado.genero || formularioActual.genero,
                    lugarDeNacimiento: formularioActualizado.lugar_nacimiento || formularioActual.lugar_nacimiento,
                    ciudadDeResidencia: formularioActualizado.ciudad_residencia || formularioActual.ciudad_residencia,
                    profesionUOficio: formularioActualizado.profesion_oficio || formularioActual.profesion_oficio,
                    nivelEducativo: formularioActualizado.nivel_educativo || formularioActual.nivel_educativo,
                    empresa1: formularioActualizado.empresa1 || formularioActual.empresa1,
                    empresa2: formularioActualizado.empresa2 || formularioActual.empresa2,
                    eps: formularioActualizado.eps || formularioActual.eps || '',
                    arl: formularioActualizado.arl || formularioActual.arl || '',
                    pensiones: formularioActualizado.pensiones || formularioActual.pensiones || '',
                    estatura: formularioActualizado.estatura || formularioActual.estatura,
                    peso: formularioActualizado.peso || formularioActual.peso
                };

                console.log('📤 Actualizando datos en Wix...');
                console.log('📦 Payload:', JSON.stringify(wixPayload, null, 2));

                // PASO 3: Actualizar el registro
                const wixResponse = await fetch('https://www.bsl.com.co/_functions/actualizarFormulario', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(wixPayload)
                });

                console.log('📡 Respuesta de Wix - Status:', wixResponse.status);

                if (wixResponse.ok) {
                    const wixResult = await wixResponse.json();
                    console.log('');
                    console.log('═══════════════════════════════════════════════════════════');
                    console.log('✅ WIX: Formulario actualizado exitosamente');
                    console.log('   _id:', wixId);
                    console.log('   idGeneral:', formularioActual.wix_id);
                    console.log('   Respuesta:', JSON.stringify(wixResult, null, 2));
                    console.log('═══════════════════════════════════════════════════════════');
                    console.log('');
                } else {
                    const errorText = await wixResponse.text();
                    console.log('');
                    console.log('═══════════════════════════════════════════════════════════');
                    console.error('❌ WIX: ERROR al actualizar');
                    console.error('   Status:', wixResponse.status);
                    console.error('   Response:', errorText);
                    console.log('═══════════════════════════════════════════════════════════');
                    console.log('');
                }

            } catch (wixError) {
                console.log('');
                console.log('═══════════════════════════════════════════════════════════');
                console.error('❌ WIX: EXCEPCIÓN al actualizar');
                console.error('   Mensaje:', wixError.message);
                console.error('   Stack:', wixError.stack);
                console.log('═══════════════════════════════════════════════════════════');
                console.log('');
                // No bloqueamos la respuesta si Wix falla
            }
        } else {
            console.log('');
            console.log('⚠️ El formulario no tiene wix_id, no se actualiza en Wix');
            console.log('');
        }

        console.log('');
        console.log('🎉 RESUMEN: Actualización completada');
        console.log('   ✅ PostgreSQL: OK');
        console.log('   ✅ Wix:', formularioActual.wix_id ? 'Sincronizado' : 'No aplica');
        console.log('');

        res.json({
            success: true,
            message: 'Formulario actualizado correctamente',
            data: formularioActualizado
        });

    } catch (error) {
        console.error('❌ Error al actualizar formulario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar el formulario',
            error: error.message
        });
    }
});

// Endpoint para eliminar un formulario y su historia clínica asociada
app.delete('/api/formularios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { numeroId } = req.body;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🗑️  ELIMINANDO REGISTRO');
        console.log('   ID Formulario:', id);
        console.log('   Número ID (Cédula):', numeroId);
        console.log('═══════════════════════════════════════════════════════════');

        // Verificar que el formulario existe
        const checkResult = await pool.query('SELECT * FROM formularios WHERE id = $1', [id]);
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Formulario no encontrado'
            });
        }

        let historiaClinicaEliminada = false;

        // Intentar eliminar la historia clínica asociada (si existe)
        if (numeroId) {
            try {
                const hcResult = await pool.query(
                    'DELETE FROM "HistoriaClinica" WHERE "numeroId" = $1 RETURNING *',
                    [numeroId]
                );
                if (hcResult.rowCount > 0) {
                    historiaClinicaEliminada = true;
                    console.log('   ✅ Historia Clínica eliminada:', hcResult.rowCount, 'registro(s)');
                } else {
                    console.log('   ℹ️  No se encontró Historia Clínica asociada');
                }
            } catch (hcError) {
                console.error('   ⚠️ Error al eliminar Historia Clínica:', hcError.message);
                // Continuamos con la eliminación del formulario aunque falle la HC
            }
        }

        // Eliminar el formulario
        const deleteResult = await pool.query(
            'DELETE FROM formularios WHERE id = $1 RETURNING *',
            [id]
        );

        if (deleteResult.rowCount === 0) {
            return res.status(500).json({
                success: false,
                message: 'No se pudo eliminar el formulario'
            });
        }

        console.log('   ✅ Formulario eliminado correctamente');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        let mensaje = 'Formulario eliminado correctamente';
        if (historiaClinicaEliminada) {
            mensaje += ' junto con su Historia Clínica asociada';
        }

        res.json({
            success: true,
            message: mensaje,
            data: {
                formularioEliminado: deleteResult.rows[0],
                historiaClinicaEliminada: historiaClinicaEliminada
            }
        });

    } catch (error) {
        console.error('❌ Error al eliminar formulario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar el formulario',
            error: error.message
        });
    }
});

// Endpoint para verificar si existe una orden duplicada con el mismo numeroId
app.get('/api/ordenes/verificar-duplicado/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;

        if (!numeroId) {
            return res.json({ success: true, hayDuplicado: false, tipo: null });
        }

        // Primero buscar órdenes PENDIENTES
        const resultPendiente = await pool.query(`
            SELECT "_id", "numeroId", "primerNombre", "primerApellido",
                   "codEmpresa", "empresa", "tipoExamen", "atendido",
                   "_createdDate", "fechaAtencion"
            FROM "HistoriaClinica"
            WHERE "numeroId" = $1
              AND "atendido" = 'PENDIENTE'
            ORDER BY "_createdDate" DESC
            LIMIT 1
        `, [numeroId]);

        if (resultPendiente.rows.length > 0) {
            const ordenExistente = resultPendiente.rows[0];

            // Verificar si tiene formulario asociado
            const formResult = await pool.query(`
                SELECT id FROM formularios
                WHERE wix_id = $1 OR numero_id = $2
                LIMIT 1
            `, [ordenExistente._id, numeroId]);

            const tieneFormulario = formResult.rows.length > 0;

            // Verificar si la fecha de atención ya pasó
            let fechaExpirada = false;
            if (ordenExistente.fechaAtencion) {
                const fechaAtencion = new Date(ordenExistente.fechaAtencion);
                const hoy = new Date();
                // Comparar solo fechas (sin hora)
                fechaAtencion.setHours(0, 0, 0, 0);
                hoy.setHours(0, 0, 0, 0);
                fechaExpirada = fechaAtencion < hoy;
            }

            return res.json({
                success: true,
                hayDuplicado: true,
                tipo: fechaExpirada ? 'expirado' : 'pendiente',
                ordenExistente: {
                    _id: ordenExistente._id,
                    numeroId: ordenExistente.numeroId,
                    nombre: `${ordenExistente.primerNombre} ${ordenExistente.primerApellido}`,
                    empresa: ordenExistente.empresa || ordenExistente.codEmpresa,
                    tipoExamen: ordenExistente.tipoExamen,
                    fechaCreacion: ordenExistente._createdDate,
                    fechaAtencion: ordenExistente.fechaAtencion,
                    tieneFormulario
                }
            });
        }

        // Si no hay PENDIENTE, buscar ATENDIDO
        const resultAtendido = await pool.query(`
            SELECT "_id", "numeroId", "primerNombre", "primerApellido",
                   "codEmpresa", "empresa", "tipoExamen", "atendido",
                   "_createdDate", "fechaAtencion"
            FROM "HistoriaClinica"
            WHERE "numeroId" = $1
              AND "atendido" = 'ATENDIDO'
            ORDER BY "_createdDate" DESC
            LIMIT 1
        `, [numeroId]);

        if (resultAtendido.rows.length > 0) {
            const ordenAtendida = resultAtendido.rows[0];

            return res.json({
                success: true,
                hayDuplicado: true,
                tipo: 'atendido',
                ordenExistente: {
                    _id: ordenAtendida._id,
                    numeroId: ordenAtendida.numeroId,
                    nombre: `${ordenAtendida.primerNombre} ${ordenAtendida.primerApellido}`,
                    empresa: ordenAtendida.empresa || ordenAtendida.codEmpresa,
                    tipoExamen: ordenAtendida.tipoExamen,
                    fechaCreacion: ordenAtendida._createdDate,
                    fechaAtencion: ordenAtendida.fechaAtencion
                }
            });
        }

        // No hay ningún registro
        res.json({ success: true, hayDuplicado: false, tipo: null });
    } catch (error) {
        console.error('❌ Error al verificar duplicado:', error);
        res.status(500).json({
            success: false,
            message: 'Error al verificar duplicado',
            error: error.message
        });
    }
});

// Endpoint para actualizar fecha de atención de una orden existente
app.patch('/api/ordenes/:id/fecha-atencion', async (req, res) => {
    try {
        const { id } = req.params;
        const { fechaAtencion, horaAtencion } = req.body;

        if (!fechaAtencion) {
            return res.status(400).json({
                success: false,
                message: 'La fecha de atención es requerida'
            });
        }

        // Actualizar en PostgreSQL
        const result = await pool.query(`
            UPDATE "HistoriaClinica"
            SET "fechaAtencion" = $1,
                "horaAtencion" = $2
            WHERE "_id" = $3
            RETURNING "_id", "numeroId", "primerNombre", "primerApellido", "fechaAtencion", "horaAtencion"
        `, [fechaAtencion, horaAtencion || null, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Orden no encontrada'
            });
        }

        const ordenActualizada = result.rows[0];

        // Intentar actualizar en Wix también
        try {
            const wixResponse = await fetch('https://www.bsl-plataforma.com/_functions/actualizarFormulario', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    idGeneral: id,
                    fechaAtencion: fechaAtencion,
                    horaAtencion: horaAtencion || ''
                })
            });

            if (wixResponse.ok) {
                console.log('✅ Fecha actualizada en Wix');
            }
        } catch (wixError) {
            console.error('⚠️ Error al actualizar en Wix (no crítico):', wixError.message);
        }

        res.json({
            success: true,
            message: 'Fecha de atención actualizada correctamente',
            orden: {
                _id: ordenActualizada._id,
                numeroId: ordenActualizada.numeroId,
                nombre: `${ordenActualizada.primerNombre} ${ordenActualizada.primerApellido}`,
                fechaAtencion: ordenActualizada.fechaAtencion,
                horaAtencion: ordenActualizada.horaAtencion
            }
        });
    } catch (error) {
        console.error('❌ Error al actualizar fecha de atención:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar la fecha de atención',
            error: error.message
        });
    }
});

// Endpoint para crear nueva orden (guarda en PostgreSQL y Wix HistoriaClinica)
app.post('/api/ordenes', async (req, res) => {
    try {
        let {
            codEmpresa,
            numeroId,
            primerNombre,
            segundoNombre,
            primerApellido,
            segundoApellido,
            celular,
            cargo,
            ciudad,
            tipoExamen,
            medico,
            fechaAtencion,
            horaAtencion,
            atendido,
            examenes,
            empresa,
            asignarMedicoAuto,
            modalidad
        } = req.body;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📋 CREANDO NUEVA ORDEN');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📦 Datos recibidos:', JSON.stringify(req.body, null, 2));

        // Validar campos requeridos
        if (!numeroId || !primerNombre || !primerApellido || !codEmpresa || !celular) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos requeridos: numeroId, primerNombre, primerApellido, codEmpresa, celular'
            });
        }

        // Si se solicita asignación automática de médico
        if (asignarMedicoAuto && fechaAtencion && horaAtencion) {
            console.log('🤖 Asignación automática de médico solicitada...');
            console.log('   Fecha:', fechaAtencion, '| Hora:', horaAtencion, '| Modalidad:', modalidad || 'presencial');

            const fechaObj = new Date(fechaAtencion + 'T12:00:00');
            const diaSemana = fechaObj.getDay();
            const modalidadBuscar = modalidad || 'presencial';

            // Buscar médicos disponibles para esa hora, fecha y modalidad (excepto NUBIA)
            const medicosResult = await pool.query(`
                SELECT m.id, m.primer_nombre, m.primer_apellido,
                       COALESCE(m.tiempo_consulta, 10) as tiempo_consulta,
                       TO_CHAR(md.hora_inicio, 'HH24:MI') as hora_inicio,
                       TO_CHAR(md.hora_fin, 'HH24:MI') as hora_fin
                FROM medicos m
                INNER JOIN medicos_disponibilidad md ON m.id = md.medico_id
                WHERE m.activo = true
                  AND md.activo = true
                  AND md.modalidad = $1
                  AND md.dia_semana = $2
                  AND UPPER(CONCAT(m.primer_nombre, ' ', m.primer_apellido)) NOT LIKE '%NUBIA%'
                ORDER BY m.primer_nombre
            `, [modalidadBuscar, diaSemana]);

            // Filtrar médicos que realmente están disponibles en esa hora
            const medicosDisponibles = [];
            for (const med of medicosResult.rows) {
                const medicoNombre = `${med.primer_nombre} ${med.primer_apellido}`;
                const [horaInicioH, horaInicioM] = med.hora_inicio.split(':').map(Number);
                const [horaFinH, horaFinM] = med.hora_fin.split(':').map(Number);
                const [horaSelH, horaSelM] = horaAtencion.split(':').map(Number);

                // Verificar que la hora está dentro del rango del médico
                const horaSelMinutos = horaSelH * 60 + horaSelM;
                const horaInicioMinutos = horaInicioH * 60 + horaInicioM;
                const horaFinMinutos = horaFinH * 60 + horaFinM;

                if (horaSelMinutos < horaInicioMinutos || horaSelMinutos >= horaFinMinutos) {
                    continue; // Fuera del horario del médico
                }

                // Verificar que no tenga cita a esa hora
                const citaExistente = await pool.query(`
                    SELECT COUNT(*) as total
                    FROM "HistoriaClinica"
                    WHERE "fechaAtencion" >= $1::timestamp
                      AND "fechaAtencion" < ($1::timestamp + interval '1 day')
                      AND "medico" = $2
                      AND "horaAtencion" = $3
                `, [fechaAtencion, medicoNombre, horaAtencion]);

                if (parseInt(citaExistente.rows[0].total) === 0) {
                    medicosDisponibles.push(medicoNombre);
                }
            }

            if (medicosDisponibles.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No hay médicos disponibles para el horario seleccionado'
                });
            }

            // Asignar el primer médico disponible (o se podría aleatorizar)
            medico = medicosDisponibles[0];
            console.log('✅ Médico asignado automáticamente:', medico);
        }

        // Generar un _id único para Wix (formato UUID-like)
        const wixId = `orden_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 1. Guardar en PostgreSQL HistoriaClinica
        console.log('');
        console.log('💾 Guardando en PostgreSQL HistoriaClinica...');

        const insertQuery = `
            INSERT INTO "HistoriaClinica" (
                "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                "celular", "codEmpresa", "empresa", "cargo", "ciudad", "tipoExamen", "medico",
                "fechaAtencion", "horaAtencion", "atendido", "examenes", "_createdDate", "_updatedDate"
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW()
            )
            RETURNING "_id", "numeroId", "primerNombre", "primerApellido"
        `;

        const insertValues = [
            wixId,
            numeroId,
            primerNombre,
            segundoNombre || null,
            primerApellido,
            segundoApellido || null,
            celular,
            codEmpresa,
            empresa || null,
            cargo || null,
            ciudad || null,
            tipoExamen || null,
            medico || null,
            fechaAtencion ? new Date(fechaAtencion) : null,
            horaAtencion || null,
            atendido || 'PENDIENTE',
            examenes || null
        ];

        const pgResult = await pool.query(insertQuery, insertValues);
        console.log('✅ PostgreSQL: Orden guardada con _id:', wixId);

        // 2. Sincronizar con Wix
        console.log('');
        console.log('📤 Sincronizando con Wix...');

        try {
            const wixPayload = {
                _id: wixId,
                numeroId,
                primerNombre,
                segundoNombre: segundoNombre || '',
                primerApellido,
                segundoApellido: segundoApellido || '',
                celular,
                codEmpresa,
                empresa: empresa || '',
                cargo: cargo || '',
                ciudad: ciudad || '',
                tipoExamen: tipoExamen || '',
                medico: medico || '',
                fechaAtencion: fechaAtencion || '',
                atendido: atendido || 'PENDIENTE',
                examenes: examenes || ''
            };

            const wixResponse = await fetch('https://www.bsl.com.co/_functions/crearHistoriaClinica', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(wixPayload)
            });

            if (wixResponse.ok) {
                const wixResult = await wixResponse.json();
                console.log('✅ Wix: Sincronizado exitosamente');
                console.log('   Respuesta:', JSON.stringify(wixResult, null, 2));
            } else {
                const errorText = await wixResponse.text();
                console.error('⚠️ Wix: Error al sincronizar');
                console.error('   Status:', wixResponse.status);
                console.error('   Response:', errorText);
            }
        } catch (wixError) {
            console.error('⚠️ Wix: Excepción al sincronizar:', wixError.message);
            // No bloqueamos si Wix falla
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🎉 ORDEN CREADA EXITOSAMENTE');
        console.log('   _id:', wixId);
        console.log('   Paciente:', primerNombre, primerApellido);
        console.log('   Cédula:', numeroId);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        // Notificar a clientes SSE sobre la nueva orden
        notificarNuevaOrden({
            _id: wixId,
            numeroId,
            primerNombre,
            primerApellido,
            medico: req.body.medico
        });

        res.json({
            success: true,
            message: 'Orden creada exitosamente',
            data: {
                _id: wixId,
                numeroId,
                primerNombre,
                primerApellido
            }
        });

    } catch (error) {
        console.error('❌ Error al crear orden:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear la orden',
            error: error.message
        });
    }
});

// GET /api/ordenes - Listar órdenes con filtros opcionales
app.get('/api/ordenes', async (req, res) => {
    try {
        const { codEmpresa, buscar, limit = 100, offset = 0 } = req.query;

        let query = `
            SELECT "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                   "codEmpresa", "empresa", "cargo", "tipoExamen", "medico", "atendido",
                   "fechaAtencion", "horaAtencion", "examenes", "ciudad",
                   "_createdDate", "_updatedDate", "fechaConsulta"
            FROM "HistoriaClinica"
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (codEmpresa) {
            query += ` AND "codEmpresa" = $${paramIndex}`;
            params.push(codEmpresa);
            paramIndex++;
        }

        if (buscar) {
            query += ` AND (
                "numeroId" ILIKE $${paramIndex} OR
                "primerNombre" ILIKE $${paramIndex} OR
                "primerApellido" ILIKE $${paramIndex} OR
                "empresa" ILIKE $${paramIndex}
            )`;
            params.push(`%${buscar}%`);
            paramIndex++;
        }

        query += ` ORDER BY "fechaAtencion" DESC NULLS LAST, "_createdDate" DESC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        // Obtener el total para paginación
        let countQuery = `SELECT COUNT(*) FROM "HistoriaClinica" WHERE 1=1`;
        const countParams = [];
        let countParamIndex = 1;

        if (codEmpresa) {
            countQuery += ` AND "codEmpresa" = $${countParamIndex}`;
            countParams.push(codEmpresa);
            countParamIndex++;
        }

        if (buscar) {
            countQuery += ` AND (
                "numeroId" ILIKE $${countParamIndex} OR
                "primerNombre" ILIKE $${countParamIndex} OR
                "primerApellido" ILIKE $${countParamIndex} OR
                "empresa" ILIKE $${countParamIndex}
            )`;
            countParams.push(`%${buscar}%`);
        }

        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);

        res.json({
            success: true,
            data: result.rows,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('❌ Error al listar órdenes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar órdenes',
            error: error.message
        });
    }
});

// GET /api/ordenes/:id - Obtener una orden específica
app.get('/api/ordenes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const query = `
            SELECT * FROM "HistoriaClinica"
            WHERE "_id" = $1
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Orden no encontrada'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al obtener orden:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener la orden',
            error: error.message
        });
    }
});

// PUT /api/ordenes/:id - Actualizar una orden
app.put('/api/ordenes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            primerNombre,
            primerApellido,
            empresa,
            tipoExamen,
            medico,
            atendido,
            fechaAtencion,
            horaAtencion
        } = req.body;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📝 ACTUALIZANDO ORDEN:', id);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📦 Datos recibidos:', JSON.stringify(req.body, null, 2));

        const updateQuery = `
            UPDATE "HistoriaClinica"
            SET
                "primerNombre" = COALESCE($2, "primerNombre"),
                "primerApellido" = COALESCE($3, "primerApellido"),
                "empresa" = COALESCE($4, "empresa"),
                "tipoExamen" = COALESCE($5, "tipoExamen"),
                "medico" = COALESCE($6, "medico"),
                "atendido" = COALESCE($7, "atendido"),
                "fechaAtencion" = $8,
                "horaAtencion" = $9,
                "_updatedDate" = NOW()
            WHERE "_id" = $1
            RETURNING *
        `;

        const values = [
            id,
            primerNombre || null,
            primerApellido || null,
            empresa || null,
            tipoExamen || null,
            medico || null,
            atendido || null,
            fechaAtencion ? new Date(fechaAtencion) : null,
            horaAtencion || null
        ];

        const result = await pool.query(updateQuery, values);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Orden no encontrada'
            });
        }

        console.log('✅ Orden actualizada exitosamente');

        res.json({
            success: true,
            message: 'Orden actualizada exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al actualizar orden:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar la orden',
            error: error.message
        });
    }
});

// Endpoint para marcar como atendido desde Wix (upsert en HistoriaClinica)
app.post('/api/marcar-atendido', async (req, res) => {
    try {
        const {
            wixId,
            atendido,
            fechaConsulta,
            mdConceptoFinal,
            mdRecomendacionesMedicasAdicionales,
            mdObservacionesCertificado,
            // Campos adicionales para INSERT
            numeroId,
            primerNombre,
            segundoNombre,
            primerApellido,
            segundoApellido,
            celular,
            email,
            fechaNacimiento,
            edad,
            genero,
            estadoCivil,
            hijos,
            ejercicio,
            codEmpresa,
            empresa,
            cargo,
            tipoExamen,
            fechaAtencion
        } = req.body;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📥 Recibida solicitud de marcar-atendido desde Wix');
        console.log('   wixId:', wixId);
        console.log('   atendido:', atendido);
        console.log('   fechaConsulta:', fechaConsulta);
        console.log('═══════════════════════════════════════════════════════════');

        if (!wixId) {
            return res.status(400).json({
                success: false,
                message: 'wixId es requerido'
            });
        }

        // Buscar en HistoriaClinica por _id (que es el wixId)
        const checkResult = await pool.query('SELECT "_id" FROM "HistoriaClinica" WHERE "_id" = $1', [wixId]);

        let result;
        let operacion;

        if (checkResult.rows.length > 0) {
            // UPDATE - El registro existe
            operacion = 'UPDATE';
            const updateQuery = `
                UPDATE "HistoriaClinica" SET
                    "atendido" = $1,
                    "fechaConsulta" = $2,
                    "mdConceptoFinal" = $3,
                    "mdRecomendacionesMedicasAdicionales" = $4,
                    "mdObservacionesCertificado" = $5,
                    "_updatedDate" = NOW()
                WHERE "_id" = $6
                RETURNING "_id", "numeroId", "primerNombre"
            `;

            const updateValues = [
                atendido || 'ATENDIDO',
                fechaConsulta ? new Date(fechaConsulta) : new Date(),
                mdConceptoFinal || null,
                mdRecomendacionesMedicasAdicionales || null,
                mdObservacionesCertificado || null,
                wixId
            ];

            result = await pool.query(updateQuery, updateValues);
        } else {
            // INSERT - El registro no existe
            operacion = 'INSERT';

            // Validar campos mínimos requeridos para INSERT
            if (!numeroId || !primerNombre || !primerApellido || !celular) {
                console.log('⚠️ Faltan campos requeridos para INSERT');
                return res.status(400).json({
                    success: false,
                    message: 'Para crear un nuevo registro se requieren: numeroId, primerNombre, primerApellido, celular'
                });
            }

            const insertQuery = `
                INSERT INTO "HistoriaClinica" (
                    "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                    "celular", "email", "fechaNacimiento", "edad", "genero", "estadoCivil", "hijos",
                    "ejercicio", "codEmpresa", "empresa", "cargo", "tipoExamen", "fechaAtencion",
                    "atendido", "fechaConsulta", "mdConceptoFinal", "mdRecomendacionesMedicasAdicionales",
                    "mdObservacionesCertificado", "_createdDate", "_updatedDate"
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                    $20, $21, $22, $23, $24, NOW(), NOW()
                )
                RETURNING "_id", "numeroId", "primerNombre"
            `;

            const insertValues = [
                wixId,
                numeroId,
                primerNombre,
                segundoNombre || null,
                primerApellido,
                segundoApellido || null,
                celular,
                email || null,
                fechaNacimiento ? new Date(fechaNacimiento) : null,
                edad || null,
                genero || null,
                estadoCivil || null,
                hijos || null,
                ejercicio || null,
                codEmpresa || null,
                empresa || null,
                cargo || null,
                tipoExamen || null,
                fechaAtencion ? new Date(fechaAtencion) : null,
                atendido || 'ATENDIDO',
                fechaConsulta ? new Date(fechaConsulta) : new Date(),
                mdConceptoFinal || null,
                mdRecomendacionesMedicasAdicionales || null,
                mdObservacionesCertificado || null
            ];

            result = await pool.query(insertQuery, insertValues);
        }

        console.log(`✅ HistoriaClinica ${operacion === 'INSERT' ? 'CREADA' : 'ACTUALIZADA'} como ATENDIDO`);
        console.log('   _id:', result.rows[0]._id);
        console.log('   numeroId:', result.rows[0].numeroId);
        console.log('   primerNombre:', result.rows[0].primerNombre);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        res.json({
            success: true,
            message: `HistoriaClinica ${operacion === 'INSERT' ? 'creada' : 'actualizada'} como ATENDIDO`,
            operacion: operacion,
            data: {
                _id: result.rows[0]._id,
                numeroId: result.rows[0].numeroId,
                primerNombre: result.rows[0].primerNombre
            }
        });

    } catch (error) {
        console.error('❌ Error en marcar-atendido:', error);
        res.status(500).json({
            success: false,
            message: 'Error al marcar como atendido',
            error: error.message
        });
    }
});

// Endpoint para editar HistoriaClinica o Formulario por _id
app.put('/api/historia-clinica/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const datos = req.body;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📝 Recibida solicitud de edición');
        console.log('   _id:', id);
        console.log('═══════════════════════════════════════════════════════════');

        // Primero verificar si existe en HistoriaClinica
        const checkHistoria = await pool.query('SELECT "_id" FROM "HistoriaClinica" WHERE "_id" = $1', [id]);

        if (checkHistoria.rows.length > 0) {
            // ========== ACTUALIZAR EN HISTORIA CLINICA ==========
            const camposPermitidos = [
                'numeroId', 'primerNombre', 'segundoNombre', 'primerApellido', 'segundoApellido',
                'celular', 'email', 'fechaNacimiento', 'edad', 'genero', 'estadoCivil', 'hijos',
                'ejercicio', 'codEmpresa', 'empresa', 'cargo', 'tipoExamen', 'fechaAtencion',
                'atendido', 'fechaConsulta', 'mdConceptoFinal', 'mdRecomendacionesMedicasAdicionales',
                'mdObservacionesCertificado', 'mdAntecedentes', 'mdObsParaMiDocYa', 'mdDx1', 'mdDx2',
                'talla', 'peso', 'motivoConsulta', 'diagnostico', 'tratamiento', 'pvEstado', 'medico',
                'encuestaSalud', 'antecedentesFamiliares', 'empresa1'
            ];

            const setClauses = [];
            const values = [];
            let paramIndex = 1;

            for (const campo of camposPermitidos) {
                if (datos[campo] !== undefined) {
                    setClauses.push(`"${campo}" = $${paramIndex}`);
                    if (['fechaNacimiento', 'fechaAtencion', 'fechaConsulta'].includes(campo) && datos[campo]) {
                        values.push(new Date(datos[campo]));
                    } else {
                        values.push(datos[campo] === '' ? null : datos[campo]);
                    }
                    paramIndex++;
                }
            }

            if (setClauses.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No se proporcionaron campos para actualizar'
                });
            }

            setClauses.push(`"_updatedDate" = NOW()`);
            values.push(id);

            const query = `
                UPDATE "HistoriaClinica" SET
                    ${setClauses.join(', ')}
                WHERE "_id" = $${paramIndex}
                RETURNING *
            `;

            const result = await pool.query(query, values);
            const historiaActualizada = result.rows[0];

            console.log('✅ POSTGRESQL: HistoriaClinica actualizada exitosamente');
            console.log('   _id:', historiaActualizada._id);
            console.log('   numeroId:', historiaActualizada.numeroId);
            console.log('═══════════════════════════════════════════════════════════');

            // Sincronizar con Wix
            try {
                const fetch = (await import('node-fetch')).default;
                const wixPayload = { _id: id, ...datos };

                console.log('📤 Sincronizando HistoriaClinica con Wix...');
                const wixResponse = await fetch('https://www.bsl.com.co/_functions/actualizarHistoriaClinica', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(wixPayload)
                });

                if (wixResponse.ok) {
                    console.log('✅ WIX: HistoriaClinica sincronizada exitosamente');
                } else {
                    console.error('❌ WIX: ERROR al sincronizar - Status:', wixResponse.status);
                }
            } catch (wixError) {
                console.error('❌ WIX: EXCEPCIÓN al sincronizar:', wixError.message);
            }

            return res.json({
                success: true,
                message: 'HistoriaClinica actualizada correctamente',
                data: historiaActualizada
            });
        }

        // ========== SI NO ESTÁ EN HISTORIA CLINICA, BUSCAR EN FORMULARIOS ==========
        const checkFormulario = await pool.query('SELECT id FROM formularios WHERE id = $1', [id]);

        if (checkFormulario.rows.length > 0) {
            // Mapeo de campos camelCase a snake_case para formularios
            const mapeoFormularios = {
                'primerNombre': 'primer_nombre',
                'primerApellido': 'primer_apellido',
                'numeroId': 'numero_id',
                'codEmpresa': 'cod_empresa',
                'estadoCivil': 'estado_civil',
                'fechaNacimiento': 'fecha_nacimiento',
                'ciudadResidencia': 'ciudad_residencia',
                'lugarNacimiento': 'lugar_nacimiento',
                'nivelEducativo': 'nivel_educativo',
                'profesionOficio': 'profesion_oficio',
                'consumoLicor': 'consumo_licor',
                'usaAnteojos': 'usa_anteojos',
                'usaLentesContacto': 'usa_lentes_contacto',
                'cirugiaOcular': 'cirugia_ocular',
                'presionAlta': 'presion_alta',
                'problemasCardiacos': 'problemas_cardiacos',
                'problemasAzucar': 'problemas_azucar',
                'enfermedadPulmonar': 'enfermedad_pulmonar',
                'enfermedadHigado': 'enfermedad_higado',
                'dolorEspalda': 'dolor_espalda',
                'dolorCabeza': 'dolor_cabeza',
                'ruidoJaqueca': 'ruido_jaqueca',
                'problemasSueno': 'problemas_sueno',
                'cirugiaProgramada': 'cirugia_programada',
                'condicionMedica': 'condicion_medica',
                'trastornoPsicologico': 'trastorno_psicologico',
                'sintomasPsicologicos': 'sintomas_psicologicos',
                'diagnosticoCancer': 'diagnostico_cancer',
                'enfermedadesLaborales': 'enfermedades_laborales',
                'enfermedadOsteomuscular': 'enfermedad_osteomuscular',
                'enfermedadAutoinmune': 'enfermedad_autoinmune',
                'familiaHereditarias': 'familia_hereditarias',
                'familiaGeneticas': 'familia_geneticas',
                'familiaDiabetes': 'familia_diabetes',
                'familiaHipertension': 'familia_hipertension',
                'familiaInfartos': 'familia_infartos',
                'familiaCancer': 'familia_cancer',
                'familiaTrastornos': 'familia_trastornos',
                'familiaInfecciosas': 'familia_infecciosas'
            };

            const camposDirectos = [
                'celular', 'email', 'edad', 'genero', 'hijos', 'ejercicio', 'empresa',
                'eps', 'arl', 'pensiones', 'estatura', 'peso', 'fuma', 'embarazo',
                'hepatitis', 'hernias', 'varices', 'hormigueos', 'atendido', 'ciudad'
            ];

            const setClauses = [];
            const values = [];
            let paramIndex = 1;

            for (const [key, value] of Object.entries(datos)) {
                let columna = null;

                if (mapeoFormularios[key]) {
                    columna = mapeoFormularios[key];
                } else if (camposDirectos.includes(key)) {
                    columna = key;
                }

                if (columna && value !== undefined) {
                    setClauses.push(`${columna} = $${paramIndex}`);
                    values.push(value === '' ? null : value);
                    paramIndex++;
                }
            }

            if (setClauses.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No se proporcionaron campos válidos para actualizar'
                });
            }

            values.push(id);

            const query = `
                UPDATE formularios SET
                    ${setClauses.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await pool.query(query, values);
            const formularioActualizado = result.rows[0];

            console.log('✅ POSTGRESQL: Formulario actualizado exitosamente');
            console.log('   id:', formularioActualizado.id);
            console.log('   numero_id:', formularioActualizado.numero_id);
            console.log('═══════════════════════════════════════════════════════════');

            return res.json({
                success: true,
                message: 'Formulario actualizado correctamente',
                data: formularioActualizado
            });
        }

        // No se encontró en ninguna tabla
        return res.status(404).json({
            success: false,
            message: 'Registro no encontrado en HistoriaClinica ni en Formularios'
        });

    } catch (error) {
        console.error('❌ Error al actualizar registro:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar registro',
            error: error.message
        });
    }
});

// Endpoint para listar todas las HistoriaClinica (órdenes) + formularios sin sincronizar
app.get('/api/historia-clinica/list', async (req, res) => {
    try {
        console.log('📋 Listando órdenes de HistoriaClinica + formularios...');

        // Obtener registros de HistoriaClinica
        const historiaResult = await pool.query(`
            SELECT "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                   "celular", "cargo", "ciudad", "tipoExamen", "codEmpresa", "empresa", "medico",
                   "atendido", "examenes", "_createdDate", "fechaConsulta", 'historia' as origen
            FROM "HistoriaClinica"
            ORDER BY "_createdDate" DESC
            LIMIT 500
        `);

        // Obtener cédulas que ya están en HistoriaClinica
        const cedulasHistoria = historiaResult.rows.map(r => r.numeroId).filter(Boolean);

        // Obtener registros de formularios que NO están en HistoriaClinica
        let formulariosResult = { rows: [] };
        if (cedulasHistoria.length > 0) {
            formulariosResult = await pool.query(`
                SELECT
                    COALESCE(wix_id, id::text) as "_id",
                    id as "formId",
                    numero_id as "numeroId",
                    primer_nombre as "primerNombre",
                    NULL as "segundoNombre",
                    primer_apellido as "primerApellido",
                    NULL as "segundoApellido",
                    celular,
                    NULL as "cargo",
                    ciudad_residencia as "ciudad",
                    NULL as "tipoExamen",
                    cod_empresa as "codEmpresa",
                    empresa,
                    NULL as "medico",
                    atendido,
                    NULL as "examenes",
                    fecha_registro as "_createdDate",
                    fecha_consulta as "fechaConsulta",
                    'formulario' as origen
                FROM formularios
                WHERE numero_id IS NOT NULL
                AND numero_id NOT IN (${cedulasHistoria.map((_, i) => `$${i + 1}`).join(',')})
                ORDER BY fecha_registro DESC
                LIMIT 100
            `, cedulasHistoria);
        } else {
            // Si no hay registros en HistoriaClinica, traer todos los formularios
            formulariosResult = await pool.query(`
                SELECT
                    COALESCE(wix_id, id::text) as "_id",
                    id as "formId",
                    numero_id as "numeroId",
                    primer_nombre as "primerNombre",
                    NULL as "segundoNombre",
                    primer_apellido as "primerApellido",
                    NULL as "segundoApellido",
                    celular,
                    NULL as "cargo",
                    ciudad_residencia as "ciudad",
                    NULL as "tipoExamen",
                    cod_empresa as "codEmpresa",
                    empresa,
                    NULL as "medico",
                    atendido,
                    NULL as "examenes",
                    fecha_registro as "_createdDate",
                    fecha_consulta as "fechaConsulta",
                    'formulario' as origen
                FROM formularios
                WHERE numero_id IS NOT NULL
                ORDER BY fecha_registro DESC
                LIMIT 100
            `);
        }

        // Combinar y ordenar por fecha
        const todosLosRegistros = [...historiaResult.rows, ...formulariosResult.rows]
            .sort((a, b) => new Date(b._createdDate) - new Date(a._createdDate));

        console.log(`✅ HistoriaClinica: ${historiaResult.rows.length}, Formularios sin sincronizar: ${formulariosResult.rows.length}`);

        res.json({
            success: true,
            total: todosLosRegistros.length,
            data: todosLosRegistros
        });

    } catch (error) {
        console.error('❌ Error al listar registros:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar registros',
            error: error.message
        });
    }
});

// Endpoint de búsqueda server-side para HistoriaClinica (escala a 100,000+ registros)
app.get('/api/historia-clinica/buscar', async (req, res) => {
    try {
        const { q } = req.query;

        // Requiere al menos 2 caracteres para buscar
        if (!q || q.length < 2) {
            return res.json({ success: true, data: [] });
        }

        console.log(`🔍 Buscando en HistoriaClinica: "${q}"`);

        const searchTerm = `%${q}%`;
        const result = await pool.query(`
            SELECT "_id", "numeroId", "primerNombre", "segundoNombre",
                   "primerApellido", "segundoApellido", "celular", "cargo",
                   "ciudad", "tipoExamen", "codEmpresa", "empresa", "medico",
                   "atendido", "examenes", "_createdDate", "fechaConsulta",
                   'historia' as origen
            FROM "HistoriaClinica"
            WHERE "numeroId" ILIKE $1
               OR "primerNombre" ILIKE $1
               OR "primerApellido" ILIKE $1
               OR "codEmpresa" ILIKE $1
               OR "celular" ILIKE $1
            ORDER BY "_createdDate" DESC
            LIMIT 100
        `, [searchTerm]);

        console.log(`✅ Encontrados ${result.rows.length} registros para "${q}"`);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error('❌ Error en búsqueda:', error);
        res.status(500).json({
            success: false,
            message: 'Error en la búsqueda',
            error: error.message
        });
    }
});

// Endpoint para obtener HistoriaClinica o Formulario por _id
app.get('/api/historia-clinica/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Primero buscar en HistoriaClinica
        const historiaResult = await pool.query('SELECT *, \'historia\' as origen FROM "HistoriaClinica" WHERE "_id" = $1', [id]);

        if (historiaResult.rows.length > 0) {
            return res.json({
                success: true,
                data: historiaResult.rows[0]
            });
        }

        // Si no está en HistoriaClinica, buscar en formularios por wix_id o id numérico
        const formResult = await pool.query(`
            SELECT
                COALESCE(wix_id, id::text) as "_id",
                id as "formId",
                numero_id as "numeroId",
                primer_nombre as "primerNombre",
                NULL as "segundoNombre",
                primer_apellido as "primerApellido",
                NULL as "segundoApellido",
                celular,
                NULL as "cargo",
                ciudad_residencia as "ciudad",
                NULL as "tipoExamen",
                cod_empresa as "codEmpresa",
                empresa,
                NULL as "medico",
                atendido,
                NULL as "examenes",
                fecha_registro as "_createdDate",
                fecha_consulta as "fechaConsulta",
                genero, edad, fecha_nacimiento as "fechaNacimiento", lugar_nacimiento as "lugarNacimiento",
                hijos, profesion_oficio as "profesionOficio", estado_civil as "estadoCivil",
                nivel_educativo as "nivelEducativo", email, estatura, peso, ejercicio,
                eps, arl, pensiones,
                'formulario' as origen
            FROM formularios
            WHERE wix_id = $1 OR ($1 ~ '^[0-9]+$' AND id = $1::integer)
        `, [id]);

        if (formResult.rows.length > 0) {
            return res.json({
                success: true,
                data: formResult.rows[0]
            });
        }

        return res.status(404).json({
            success: false,
            message: 'Registro no encontrado'
        });

    } catch (error) {
        console.error('❌ Error al obtener registro:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener registro',
            error: error.message
        });
    }
});

// Endpoint para toggle de estado de pago
app.patch('/api/historia-clinica/:id/pago', async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener estado actual
        const currentResult = await pool.query('SELECT "pagado" FROM "HistoriaClinica" WHERE "_id" = $1', [id]);

        if (currentResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Orden no encontrada' });
        }

        const estadoActual = currentResult.rows[0].pagado || false;
        const nuevoEstado = !estadoActual;

        // Actualizar estado
        await pool.query('UPDATE "HistoriaClinica" SET "pagado" = $1 WHERE "_id" = $2', [nuevoEstado, id]);

        console.log(`💰 Pago ${nuevoEstado ? 'marcado' : 'desmarcado'} para orden ${id}`);

        res.json({ success: true, pagado: nuevoEstado });
    } catch (error) {
        console.error('❌ Error al actualizar pago:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar pago' });
    }
});

// Endpoint para eliminar HistoriaClinica por _id
app.delete('/api/historia-clinica/:id', async (req, res) => {
    try {
        const { id } = req.params;

        console.log('');
        console.log('🗑️ ========== ELIMINANDO ORDEN ==========');
        console.log(`📋 ID: ${id}`);

        // Eliminar de PostgreSQL
        const result = await pool.query('DELETE FROM "HistoriaClinica" WHERE "_id" = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Registro no encontrado en HistoriaClinica'
            });
        }

        console.log('✅ Orden eliminada de PostgreSQL');

        res.json({
            success: true,
            message: 'Orden eliminada correctamente',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error al eliminar orden:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar orden',
            error: error.message
        });
    }
});

// Endpoint para buscar paciente por numeroId (para actualizar foto)
app.get('/api/buscar-paciente/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;

        console.log('🔍 Buscando paciente con numeroId:', numeroId);

        // Buscar en formularios
        const formResult = await pool.query(
            'SELECT id, wix_id, primer_nombre, primer_apellido, numero_id, foto FROM formularios WHERE numero_id = $1 ORDER BY fecha_registro DESC LIMIT 1',
            [numeroId]
        );

        if (formResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No se encontró paciente con ese número de identificación'
            });
        }

        const paciente = formResult.rows[0];

        res.json({
            success: true,
            data: {
                id: paciente.id,
                wix_id: paciente.wix_id,
                nombre: `${paciente.primer_nombre || ''} ${paciente.primer_apellido || ''}`.trim(),
                numero_id: paciente.numero_id,
                tiene_foto: !!paciente.foto
            }
        });

    } catch (error) {
        console.error('❌ Error al buscar paciente:', error);
        res.status(500).json({
            success: false,
            message: 'Error al buscar paciente',
            error: error.message
        });
    }
});

// Endpoint para actualizar foto de paciente
app.post('/api/actualizar-foto', async (req, res) => {
    try {
        const { numeroId, foto } = req.body;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📸 Recibida solicitud de actualización de foto');
        console.log('   numeroId:', numeroId);
        console.log('   Tamaño foto:', foto ? `${(foto.length / 1024).toFixed(2)} KB` : 'No proporcionada');
        console.log('═══════════════════════════════════════════════════════════');

        if (!numeroId || !foto) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere numeroId y foto'
            });
        }

        // Buscar el formulario por numero_id
        const checkResult = await pool.query(
            'SELECT id, wix_id, primer_nombre, primer_apellido FROM formularios WHERE numero_id = $1 ORDER BY fecha_registro DESC LIMIT 1',
            [numeroId]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No se encontró paciente con ese número de identificación'
            });
        }

        const paciente = checkResult.rows[0];

        // Actualizar foto en PostgreSQL
        await pool.query(
            'UPDATE formularios SET foto = $1 WHERE id = $2',
            [foto, paciente.id]
        );

        console.log('✅ POSTGRESQL: Foto actualizada');
        console.log('   ID:', paciente.id);
        console.log('   Paciente:', paciente.primer_nombre, paciente.primer_apellido);

        // Sincronizar con Wix si tiene wix_id
        let wixSincronizado = false;
        if (paciente.wix_id) {
            try {
                const fetch = (await import('node-fetch')).default;

                // Primero obtener el _id de Wix
                const queryResponse = await fetch(`https://www.bsl.com.co/_functions/formularioPorIdGeneral?idGeneral=${paciente.wix_id}`);

                if (queryResponse.ok) {
                    const queryResult = await queryResponse.json();

                    if (queryResult.success && queryResult.item) {
                        const wixId = queryResult.item._id;

                        // Actualizar foto en Wix
                        const wixPayload = {
                            _id: wixId,
                            foto: foto
                        };

                        console.log('📤 Sincronizando foto con Wix...');

                        const wixResponse = await fetch('https://www.bsl.com.co/_functions/actualizarFormulario', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(wixPayload)
                        });

                        if (wixResponse.ok) {
                            wixSincronizado = true;
                            console.log('✅ WIX: Foto sincronizada exitosamente');
                        } else {
                            console.error('❌ WIX: Error al sincronizar foto');
                        }
                    }
                }
            } catch (wixError) {
                console.error('❌ WIX: Excepción al sincronizar:', wixError.message);
            }
        }

        console.log('');
        console.log('🎉 RESUMEN: Actualización de foto completada');
        console.log('   ✅ PostgreSQL: OK');
        console.log('   ' + (wixSincronizado ? '✅' : '⚠️') + ' Wix:', wixSincronizado ? 'Sincronizado' : 'No sincronizado');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        res.json({
            success: true,
            message: 'Foto actualizada correctamente',
            data: {
                id: paciente.id,
                nombre: `${paciente.primer_nombre || ''} ${paciente.primer_apellido || ''}`.trim(),
                wixSincronizado
            }
        });

    } catch (error) {
        console.error('❌ Error al actualizar foto:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar foto',
            error: error.message
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', database: 'connected' });
});

// ============================================
// ENDPOINTS PARA MÉDICOS
// ============================================

// Listar todos los médicos activos
app.get('/api/medicos', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
                   numero_licencia, tipo_licencia, fecha_vencimiento_licencia, especialidad,
                   firma, activo, created_at, COALESCE(tiempo_consulta, 10) as tiempo_consulta
            FROM medicos
            WHERE activo = true
            ORDER BY primer_apellido, primer_nombre
        `);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error('❌ Error al listar médicos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar médicos',
            error: error.message
        });
    }
});

// Obtener un médico por ID (incluye firma)
app.get('/api/medicos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM medicos WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Médico no encontrado'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al obtener médico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener médico',
            error: error.message
        });
    }
});

// Crear un nuevo médico
app.post('/api/medicos', async (req, res) => {
    try {
        const {
            primerNombre, segundoNombre, primerApellido, segundoApellido,
            numeroLicencia, tipoLicencia, fechaVencimientoLicencia, especialidad, firma
        } = req.body;

        if (!primerNombre || !primerApellido || !numeroLicencia) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: primerNombre, primerApellido, numeroLicencia'
            });
        }

        const result = await pool.query(`
            INSERT INTO medicos (
                primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
                numero_licencia, tipo_licencia, fecha_vencimiento_licencia, especialidad, firma
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            primerNombre,
            segundoNombre || null,
            primerApellido,
            segundoApellido || null,
            numeroLicencia,
            tipoLicencia || null,
            fechaVencimientoLicencia ? new Date(fechaVencimientoLicencia) : null,
            especialidad || null,
            firma || null
        ]);

        console.log(`✅ Médico creado: ${primerNombre} ${primerApellido} (Licencia: ${numeroLicencia})`);

        res.json({
            success: true,
            message: 'Médico creado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al crear médico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear médico',
            error: error.message
        });
    }
});

// Actualizar un médico
app.put('/api/medicos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            primerNombre, segundoNombre, primerApellido, segundoApellido,
            numeroLicencia, tipoLicencia, fechaVencimientoLicencia, especialidad, firma, activo
        } = req.body;

        const result = await pool.query(`
            UPDATE medicos SET
                primer_nombre = COALESCE($1, primer_nombre),
                segundo_nombre = COALESCE($2, segundo_nombre),
                primer_apellido = COALESCE($3, primer_apellido),
                segundo_apellido = COALESCE($4, segundo_apellido),
                numero_licencia = COALESCE($5, numero_licencia),
                tipo_licencia = COALESCE($6, tipo_licencia),
                fecha_vencimiento_licencia = COALESCE($7, fecha_vencimiento_licencia),
                especialidad = COALESCE($8, especialidad),
                firma = COALESCE($9, firma),
                activo = COALESCE($10, activo),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $11
            RETURNING *
        `, [
            primerNombre,
            segundoNombre,
            primerApellido,
            segundoApellido,
            numeroLicencia,
            tipoLicencia,
            fechaVencimientoLicencia ? new Date(fechaVencimientoLicencia) : null,
            especialidad,
            firma,
            activo,
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Médico no encontrado'
            });
        }

        console.log(`✅ Médico actualizado: ID ${id}`);

        res.json({
            success: true,
            message: 'Médico actualizado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al actualizar médico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar médico',
            error: error.message
        });
    }
});

// Eliminar (desactivar) un médico
app.delete('/api/medicos/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            UPDATE medicos SET activo = false, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id, primer_nombre, primer_apellido
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Médico no encontrado'
            });
        }

        console.log(`✅ Médico desactivado: ID ${id}`);

        res.json({
            success: true,
            message: 'Médico desactivado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al desactivar médico:', error);
        res.status(500).json({
            success: false,
            message: 'Error al desactivar médico',
            error: error.message
        });
    }
});

// Actualizar tiempo de consulta de un médico
app.put('/api/medicos/:id/tiempo-consulta', async (req, res) => {
    try {
        const { id } = req.params;
        const { tiempoConsulta } = req.body;

        if (!tiempoConsulta || tiempoConsulta < 5 || tiempoConsulta > 120) {
            return res.status(400).json({
                success: false,
                message: 'El tiempo de consulta debe estar entre 5 y 120 minutos'
            });
        }

        const result = await pool.query(`
            UPDATE medicos SET
                tiempo_consulta = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, primer_nombre, primer_apellido, tiempo_consulta
        `, [tiempoConsulta, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Médico no encontrado'
            });
        }

        console.log(`✅ Tiempo de consulta actualizado para médico ID ${id}: ${tiempoConsulta} min`);

        res.json({
            success: true,
            message: 'Tiempo de consulta actualizado',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al actualizar tiempo de consulta:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar tiempo de consulta',
            error: error.message
        });
    }
});

// ============================================
// ENDPOINTS PARA DISPONIBILIDAD DE MÉDICOS
// ============================================

// GET - Obtener disponibilidad de un médico (opcionalmente filtrado por modalidad)
app.get('/api/medicos/:id/disponibilidad', async (req, res) => {
    try {
        const { id } = req.params;
        const { modalidad } = req.query; // Opcional: 'presencial' o 'virtual'

        let query = `
            SELECT id, medico_id, dia_semana,
                   TO_CHAR(hora_inicio, 'HH24:MI') as hora_inicio,
                   TO_CHAR(hora_fin, 'HH24:MI') as hora_fin,
                   COALESCE(modalidad, 'presencial') as modalidad,
                   activo
            FROM medicos_disponibilidad
            WHERE medico_id = $1
        `;
        const params = [id];

        if (modalidad) {
            query += ` AND modalidad = $2`;
            params.push(modalidad);
        }

        query += ` ORDER BY modalidad, dia_semana`;

        const result = await pool.query(query, params);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error('❌ Error al obtener disponibilidad:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener disponibilidad',
            error: error.message
        });
    }
});

// POST - Guardar disponibilidad de un médico para una modalidad específica
app.post('/api/medicos/:id/disponibilidad', async (req, res) => {
    try {
        const { id } = req.params;
        const { disponibilidad, modalidad = 'presencial' } = req.body;

        if (!Array.isArray(disponibilidad)) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere un array de disponibilidad'
            });
        }

        // Verificar que el médico existe
        const medicoCheck = await pool.query('SELECT id FROM medicos WHERE id = $1', [id]);
        if (medicoCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Médico no encontrado'
            });
        }

        // Eliminar disponibilidad existente SOLO para esta modalidad
        await pool.query('DELETE FROM medicos_disponibilidad WHERE medico_id = $1 AND modalidad = $2', [id, modalidad]);

        // Insertar nueva disponibilidad
        for (const dia of disponibilidad) {
            if (dia.activo && dia.hora_inicio && dia.hora_fin) {
                await pool.query(`
                    INSERT INTO medicos_disponibilidad (medico_id, dia_semana, hora_inicio, hora_fin, modalidad, activo)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [id, dia.dia_semana, dia.hora_inicio, dia.hora_fin, modalidad, dia.activo]);
            }
        }

        console.log(`✅ Disponibilidad ${modalidad} actualizada para médico ID ${id}`);

        res.json({
            success: true,
            message: `Disponibilidad ${modalidad} guardada correctamente`
        });
    } catch (error) {
        console.error('❌ Error al guardar disponibilidad:', error);
        res.status(500).json({
            success: false,
            message: 'Error al guardar disponibilidad',
            error: error.message
        });
    }
});

// DELETE - Eliminar disponibilidad de un día específico y modalidad
app.delete('/api/medicos/:id/disponibilidad/:dia', async (req, res) => {
    try {
        const { id, dia } = req.params;
        const { modalidad } = req.query;

        let query = `DELETE FROM medicos_disponibilidad WHERE medico_id = $1 AND dia_semana = $2`;
        const params = [id, dia];

        if (modalidad) {
            query += ` AND modalidad = $3`;
            params.push(modalidad);
        }

        await pool.query(query, params);

        res.json({
            success: true,
            message: 'Disponibilidad eliminada'
        });
    } catch (error) {
        console.error('❌ Error al eliminar disponibilidad:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar disponibilidad',
            error: error.message
        });
    }
});

// ============================================
// ENDPOINTS PARA EMPRESAS
// ============================================

// Listar todas las empresas activas
app.get('/api/empresas', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, cod_empresa, empresa, nit, profesiograma, activo, created_at
            FROM empresas
            WHERE activo = true
            ORDER BY empresa
        `);

        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error('❌ Error al listar empresas:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar empresas',
            error: error.message
        });
    }
});

// Obtener una empresa por ID
app.get('/api/empresas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM empresas WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Empresa no encontrada'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al obtener empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener empresa',
            error: error.message
        });
    }
});

// Crear una nueva empresa
app.post('/api/empresas', async (req, res) => {
    try {
        const { codEmpresa, empresa, nit, profesiograma } = req.body;

        if (!codEmpresa || !empresa) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: codEmpresa, empresa'
            });
        }

        const result = await pool.query(`
            INSERT INTO empresas (cod_empresa, empresa, nit, profesiograma)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [codEmpresa, empresa, nit || null, profesiograma || null]);

        console.log(`✅ Empresa creada: ${empresa} (${codEmpresa})`);

        res.json({
            success: true,
            message: 'Empresa creada exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({
                success: false,
                message: 'Ya existe una empresa con ese código'
            });
        }
        console.error('❌ Error al crear empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear empresa',
            error: error.message
        });
    }
});

// Actualizar una empresa
app.put('/api/empresas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { codEmpresa, empresa, nit, profesiograma, activo } = req.body;

        const result = await pool.query(`
            UPDATE empresas SET
                cod_empresa = COALESCE($1, cod_empresa),
                empresa = COALESCE($2, empresa),
                nit = COALESCE($3, nit),
                profesiograma = COALESCE($4, profesiograma),
                activo = COALESCE($5, activo),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING *
        `, [codEmpresa, empresa, nit, profesiograma, activo, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Empresa no encontrada'
            });
        }

        console.log(`✅ Empresa actualizada: ID ${id}`);

        res.json({
            success: true,
            message: 'Empresa actualizada exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al actualizar empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar empresa',
            error: error.message
        });
    }
});

// Eliminar (desactivar) una empresa
app.delete('/api/empresas/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            UPDATE empresas SET activo = false, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id, cod_empresa, empresa
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Empresa no encontrada'
            });
        }

        console.log(`✅ Empresa desactivada: ID ${id}`);

        res.json({
            success: true,
            message: 'Empresa desactivada exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al desactivar empresa:', error);
        res.status(500).json({
            success: false,
            message: 'Error al desactivar empresa',
            error: error.message
        });
    }
});

// ==================== CALENDARIO ENDPOINTS ====================

// GET /api/calendario/mes - Obtener conteo de citas por día del mes
app.get('/api/calendario/mes', async (req, res) => {
    try {
        const { year, month, medico } = req.query;

        if (!year || !month) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere year y month'
            });
        }

        // Calcular primer y último día del mes
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0).getDate();
        const endDateStr = `${year}-${String(month).padStart(2, '0')}-${endDate}`;

        let query = `
            SELECT
                fecha_atencion,
                COUNT(*) as total
            FROM formularios
            WHERE fecha_atencion IS NOT NULL
              AND fecha_atencion >= $1
              AND fecha_atencion <= $2
        `;
        const params = [startDate, endDateStr];

        if (medico) {
            query += ` AND medico = $3`;
            params.push(medico);
        }

        query += ` GROUP BY fecha_atencion ORDER BY fecha_atencion`;

        const result = await pool.query(query, params);

        // Convertir a objeto {fecha: count}
        const citasPorDia = {};
        result.rows.forEach(row => {
            if (row.fecha_atencion) {
                // Normalizar formato de fecha
                let fecha = row.fecha_atencion;
                if (fecha instanceof Date) {
                    fecha = fecha.toISOString().split('T')[0];
                } else if (typeof fecha === 'string' && fecha.includes('T')) {
                    fecha = fecha.split('T')[0];
                }
                citasPorDia[fecha] = parseInt(row.total);
            }
        });

        res.json({
            success: true,
            data: citasPorDia,
            year: parseInt(year),
            month: parseInt(month)
        });
    } catch (error) {
        console.error('❌ Error al obtener citas del mes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener citas del mes',
            error: error.message
        });
    }
});

// GET /api/calendario/mes-detalle - Obtener citas agrupadas por médico y estado para cada día del mes
app.get('/api/calendario/mes-detalle', async (req, res) => {
    try {
        const { year, month } = req.query;

        if (!year || !month) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere year y month'
            });
        }

        // Calcular primer y último día del mes
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDateStr = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

        // Buscar en HistoriaClinica (donde se guardan las órdenes) - incluir atendido
        const query = `
            SELECT
                "fechaAtencion" as fecha_atencion,
                COALESCE("medico", 'Sin asignar') as medico,
                COALESCE("atendido", 'PENDIENTE') as estado,
                COUNT(*) as total
            FROM "HistoriaClinica"
            WHERE "fechaAtencion" IS NOT NULL
              AND "fechaAtencion" >= $1::timestamp
              AND "fechaAtencion" < ($2::timestamp + interval '1 day')
            GROUP BY "fechaAtencion", "medico", "atendido"
            ORDER BY "fechaAtencion", total DESC
        `;

        const result = await pool.query(query, [startDate, endDateStr]);

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        // Convertir a objeto {fecha: {medico: {atendidos, pendientes, vencidos}, ...}}
        const citasPorDia = {};
        let totalAtendidos = 0;
        let totalPendientes = 0;
        let totalVencidos = 0;

        result.rows.forEach(row => {
            if (row.fecha_atencion) {
                // Normalizar formato de fecha
                let fecha = row.fecha_atencion;
                if (fecha instanceof Date) {
                    fecha = fecha.toISOString().split('T')[0];
                } else if (typeof fecha === 'string' && fecha.includes('T')) {
                    fecha = fecha.split('T')[0];
                }

                if (!citasPorDia[fecha]) {
                    citasPorDia[fecha] = {};
                }
                if (!citasPorDia[fecha][row.medico]) {
                    citasPorDia[fecha][row.medico] = { atendidos: 0, pendientes: 0, vencidos: 0 };
                }

                const count = parseInt(row.total);
                const fechaCita = new Date(fecha);
                fechaCita.setHours(0, 0, 0, 0);

                if (row.estado === 'ATENDIDO') {
                    citasPorDia[fecha][row.medico].atendidos += count;
                    totalAtendidos += count;
                } else if (fechaCita < hoy) {
                    // Pendiente pero fecha ya pasó = vencido
                    citasPorDia[fecha][row.medico].vencidos += count;
                    totalVencidos += count;
                } else {
                    citasPorDia[fecha][row.medico].pendientes += count;
                    totalPendientes += count;
                }
            }
        });

        res.json({
            success: true,
            data: citasPorDia,
            estadisticas: {
                atendidos: totalAtendidos,
                pendientes: totalPendientes,
                vencidos: totalVencidos,
                total: totalAtendidos + totalPendientes + totalVencidos
            },
            year: parseInt(year),
            month: parseInt(month)
        });
    } catch (error) {
        console.error('❌ Error al obtener detalle de citas del mes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener detalle de citas del mes',
            error: error.message
        });
    }
});

// GET /api/calendario/dia - Obtener citas de un día específico
app.get('/api/calendario/dia', async (req, res) => {
    try {
        const { fecha, medico } = req.query;

        if (!fecha) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere fecha (YYYY-MM-DD)'
            });
        }

        // Buscar en HistoriaClinica (donde se guardan las órdenes)
        let query = `
            SELECT
                "_id" as id,
                "numeroId" as cedula,
                CONCAT(COALESCE("primerNombre", ''), ' ', COALESCE("primerApellido", '')) as nombre,
                "tipoExamen",
                "medico",
                "fechaAtencion" as fecha_atencion,
                "horaAtencion" as hora,
                "empresa",
                "atendido"
            FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1::timestamp
              AND "fechaAtencion" < ($1::timestamp + interval '1 day')
        `;
        const params = [fecha];

        if (medico) {
            if (medico === 'Sin asignar') {
                query += ` AND "medico" IS NULL`;
            } else {
                query += ` AND "medico" = $2`;
                params.push(medico);
            }
        }

        query += ` ORDER BY "fechaAtencion" ASC, "_createdDate" ASC`;

        const result = await pool.query(query, params);

        res.json({
            success: true,
            data: result.rows,
            total: result.rows.length,
            fecha
        });
    } catch (error) {
        console.error('❌ Error al obtener citas del día:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener citas del día',
            error: error.message
        });
    }
});

// GET /api/horarios-disponibles - Obtener horarios disponibles para un médico en una fecha y modalidad
app.get('/api/horarios-disponibles', async (req, res) => {
    try {
        const { fecha, medico, modalidad = 'presencial' } = req.query;

        if (!fecha || !medico) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere fecha (YYYY-MM-DD) y medico'
            });
        }

        // Obtener día de la semana (0=Domingo, 1=Lunes, etc.)
        const fechaObj = new Date(fecha + 'T12:00:00');
        const diaSemana = fechaObj.getDay();

        // Obtener tiempo de consulta y ID del médico
        const medicoResult = await pool.query(`
            SELECT id, COALESCE(tiempo_consulta, 10) as tiempo_consulta
            FROM medicos
            WHERE CONCAT(primer_nombre, ' ', primer_apellido) = $1
            AND activo = true
        `, [medico]);

        if (medicoResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Médico no encontrado'
            });
        }

        const medicoId = medicoResult.rows[0].id;
        const tiempoConsulta = medicoResult.rows[0].tiempo_consulta;

        // Obtener disponibilidad configurada para este día de la semana Y modalidad
        const disponibilidadResult = await pool.query(`
            SELECT TO_CHAR(hora_inicio, 'HH24:MI') as hora_inicio,
                   TO_CHAR(hora_fin, 'HH24:MI') as hora_fin
            FROM medicos_disponibilidad
            WHERE medico_id = $1 AND dia_semana = $2 AND modalidad = $3 AND activo = true
        `, [medicoId, diaSemana, modalidad]);

        // Si no hay disponibilidad configurada para este día y modalidad
        let horaInicio = 6;
        let horaFin = 23;
        let medicoDisponible = true;

        if (disponibilidadResult.rows.length > 0) {
            const config = disponibilidadResult.rows[0];
            const [hiH] = config.hora_inicio.split(':').map(Number);
            const [hfH] = config.hora_fin.split(':').map(Number);
            horaInicio = hiH;
            horaFin = hfH;
        } else {
            // Verificar si tiene alguna disponibilidad configurada para esta modalidad (en cualquier día)
            const tieneConfigResult = await pool.query(`
                SELECT COUNT(*) as total FROM medicos_disponibilidad
                WHERE medico_id = $1 AND modalidad = $2
            `, [medicoId, modalidad]);

            // Si tiene configuración para esta modalidad pero no para este día, no está disponible
            if (parseInt(tieneConfigResult.rows[0].total) > 0) {
                medicoDisponible = false;
            }
            // Si no tiene ninguna configuración para esta modalidad, usar horario por defecto (6-23)
        }

        if (!medicoDisponible) {
            return res.json({
                success: true,
                fecha,
                medico,
                modalidad,
                tiempoConsulta,
                disponible: false,
                mensaje: `El médico no atiende ${modalidad} este día`,
                horarios: []
            });
        }

        // Obtener citas existentes del médico para esa fecha (todas las modalidades ocupan el mismo horario)
        const citasResult = await pool.query(`
            SELECT "horaAtencion" as hora
            FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1::timestamp
              AND "fechaAtencion" < ($1::timestamp + interval '1 day')
              AND "medico" = $2
              AND "horaAtencion" IS NOT NULL
        `, [fecha, medico]);

        const horasOcupadas = citasResult.rows.map(r => r.hora);

        // Generar horarios dentro del rango configurado
        const horariosDisponibles = [];
        for (let hora = horaInicio; hora <= horaFin; hora++) {
            for (let minuto = 0; minuto < 60; minuto += tiempoConsulta) {
                if (hora === horaFin && minuto > 0) break; // No pasar de la hora de fin

                const horaStr = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;

                // Verificar si este horario está ocupado
                const ocupado = horasOcupadas.some(horaOcupada => {
                    if (!horaOcupada) return false;
                    const horaOcupadaNorm = horaOcupada.substring(0, 5);
                    return horaOcupadaNorm === horaStr;
                });

                horariosDisponibles.push({
                    hora: horaStr,
                    disponible: !ocupado
                });
            }
        }

        res.json({
            success: true,
            fecha,
            medico,
            modalidad,
            tiempoConsulta,
            disponible: true,
            horaInicio: `${String(horaInicio).padStart(2, '0')}:00`,
            horaFin: `${String(horaFin).padStart(2, '0')}:00`,
            horarios: horariosDisponibles
        });
    } catch (error) {
        console.error('❌ Error al obtener horarios disponibles:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener horarios disponibles',
            error: error.message
        });
    }
});

// GET /api/turnos-disponibles - Obtener todos los turnos disponibles para una fecha y modalidad (sin mostrar médicos)
// Este endpoint consolida la disponibilidad de todos los médicos excepto NUBIA
app.get('/api/turnos-disponibles', async (req, res) => {
    try {
        const { fecha, modalidad = 'presencial' } = req.query;

        if (!fecha) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere fecha (YYYY-MM-DD)'
            });
        }

        // Obtener día de la semana (0=Domingo, 1=Lunes, etc.)
        const fechaObj = new Date(fecha + 'T12:00:00');
        const diaSemana = fechaObj.getDay();

        // Obtener todos los médicos activos con disponibilidad para esta modalidad y día (excepto NUBIA)
        const medicosResult = await pool.query(`
            SELECT m.id, m.primer_nombre, m.primer_apellido,
                   COALESCE(m.tiempo_consulta, 10) as tiempo_consulta,
                   TO_CHAR(md.hora_inicio, 'HH24:MI') as hora_inicio,
                   TO_CHAR(md.hora_fin, 'HH24:MI') as hora_fin
            FROM medicos m
            INNER JOIN medicos_disponibilidad md ON m.id = md.medico_id
            WHERE m.activo = true
              AND md.activo = true
              AND md.modalidad = $1
              AND md.dia_semana = $2
              AND UPPER(CONCAT(m.primer_nombre, ' ', m.primer_apellido)) NOT LIKE '%NUBIA%'
            ORDER BY m.primer_nombre
        `, [modalidad, diaSemana]);

        if (medicosResult.rows.length === 0) {
            return res.json({
                success: true,
                fecha,
                modalidad,
                turnos: [],
                mensaje: 'No hay médicos disponibles para esta modalidad en este día'
            });
        }

        // Para cada médico, generar sus horarios y verificar disponibilidad
        const turnosPorHora = {}; // { "08:00": [{ medicoId, nombre, disponible }], ... }

        for (const medico of medicosResult.rows) {
            const medicoNombre = `${medico.primer_nombre} ${medico.primer_apellido}`;
            const tiempoConsulta = medico.tiempo_consulta;
            const [horaInicioH] = medico.hora_inicio.split(':').map(Number);
            const [horaFinH] = medico.hora_fin.split(':').map(Number);

            // Obtener citas existentes del médico para esa fecha
            const citasResult = await pool.query(`
                SELECT "horaAtencion" as hora
                FROM "HistoriaClinica"
                WHERE "fechaAtencion" >= $1::timestamp
                  AND "fechaAtencion" < ($1::timestamp + interval '1 day')
                  AND "medico" = $2
                  AND "horaAtencion" IS NOT NULL
            `, [fecha, medicoNombre]);

            const horasOcupadas = citasResult.rows.map(r => r.hora ? r.hora.substring(0, 5) : null).filter(Boolean);

            // Generar horarios para este médico
            for (let hora = horaInicioH; hora < horaFinH; hora++) {
                for (let minuto = 0; minuto < 60; minuto += tiempoConsulta) {
                    const horaStr = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
                    const ocupado = horasOcupadas.includes(horaStr);

                    if (!turnosPorHora[horaStr]) {
                        turnosPorHora[horaStr] = [];
                    }

                    turnosPorHora[horaStr].push({
                        medicoId: medico.id,
                        medicoNombre: medicoNombre,
                        disponible: !ocupado
                    });
                }
            }
        }

        // Convertir a array de turnos consolidados (solo mostrar hora y si hay al menos un médico disponible)
        const turnos = Object.keys(turnosPorHora)
            .sort()
            .map(hora => {
                const medicosEnHora = turnosPorHora[hora];
                const medicosDisponibles = medicosEnHora.filter(m => m.disponible);
                return {
                    hora,
                    disponible: medicosDisponibles.length > 0,
                    cantidadDisponibles: medicosDisponibles.length,
                    // Guardamos internamente los médicos para asignar al crear la orden
                    _medicos: medicosEnHora
                };
            });

        res.json({
            success: true,
            fecha,
            modalidad,
            diaSemana,
            turnos
        });
    } catch (error) {
        console.error('❌ Error al obtener turnos disponibles:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener turnos disponibles',
            error: error.message
        });
    }
});

// GET /api/medicos-por-modalidad - Obtener médicos que atienden una modalidad específica
app.get('/api/medicos-por-modalidad', async (req, res) => {
    try {
        const { modalidad = 'presencial', fecha } = req.query;

        let query = `
            SELECT DISTINCT m.id, m.primer_nombre, m.primer_apellido,
                   m.especialidad, COALESCE(m.tiempo_consulta, 10) as tiempo_consulta
            FROM medicos m
            INNER JOIN medicos_disponibilidad md ON m.id = md.medico_id
            WHERE m.activo = true
              AND md.activo = true
              AND md.modalidad = $1
        `;
        const params = [modalidad];

        // Si se proporciona fecha, filtrar por día de la semana
        if (fecha) {
            const fechaObj = new Date(fecha + 'T12:00:00');
            const diaSemana = fechaObj.getDay();
            query += ` AND md.dia_semana = $2`;
            params.push(diaSemana);
        }

        query += ` ORDER BY m.primer_apellido, m.primer_nombre`;

        const result = await pool.query(query, params);

        res.json({
            success: true,
            modalidad,
            data: result.rows
        });
    } catch (error) {
        console.error('❌ Error al obtener médicos por modalidad:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener médicos',
            error: error.message
        });
    }
});

// ==================== CRUD EXAMENES ====================

// GET - Listar todos los exámenes
app.get('/api/examenes', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, nombre, activo, created_at
            FROM examenes
            ORDER BY nombre ASC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener exámenes:', error);
        res.status(500).json({ error: 'Error al obtener exámenes' });
    }
});

// GET - Obtener un examen por ID
app.get('/api/examenes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT id, nombre, activo, created_at
            FROM examenes
            WHERE id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Examen no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al obtener examen:', error);
        res.status(500).json({ error: 'Error al obtener examen' });
    }
});

// POST - Crear nuevo examen
app.post('/api/examenes', async (req, res) => {
    try {
        const { nombre } = req.body;

        if (!nombre || nombre.trim() === '') {
            return res.status(400).json({ error: 'El nombre del examen es requerido' });
        }

        const result = await pool.query(`
            INSERT INTO examenes (nombre)
            VALUES ($1)
            RETURNING id, nombre, activo, created_at
        `, [nombre.trim()]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') { // Unique violation
            return res.status(400).json({ error: 'Ya existe un examen con ese nombre' });
        }
        console.error('Error al crear examen:', error);
        res.status(500).json({ error: 'Error al crear examen' });
    }
});

// PUT - Actualizar examen
app.put('/api/examenes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, activo } = req.body;

        if (!nombre || nombre.trim() === '') {
            return res.status(400).json({ error: 'El nombre del examen es requerido' });
        }

        const result = await pool.query(`
            UPDATE examenes
            SET nombre = $1, activo = $2
            WHERE id = $3
            RETURNING id, nombre, activo, created_at
        `, [nombre.trim(), activo !== false, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Examen no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Ya existe un examen con ese nombre' });
        }
        console.error('Error al actualizar examen:', error);
        res.status(500).json({ error: 'Error al actualizar examen' });
    }
});

// DELETE - Eliminar examen
app.delete('/api/examenes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            DELETE FROM examenes
            WHERE id = $1
            RETURNING id
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Examen no encontrado' });
        }
        res.json({ message: 'Examen eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar examen:', error);
        res.status(500).json({ error: 'Error al eliminar examen' });
    }
});

// ==========================================
// BARRIDO NUBIA - Enviar link médico virtual (5-15 min antes)
// ==========================================
async function barridoNubiaEnviarLink() {
    console.log("🔗 [barridoNubiaEnviarLink] Iniciando ejecución...");
    try {
        const ahora = new Date();
        // Buscar citas que están entre 5 y 15 minutos en el futuro
        const cincoMinFuturo = new Date(ahora.getTime() + 5 * 60 * 1000);
        const quinceMinFuturo = new Date(ahora.getTime() + 15 * 60 * 1000);

        console.log(`📅 [barridoNubiaEnviarLink] Buscando citas de NUBIA entre ${cincoMinFuturo.toISOString()} y ${quinceMinFuturo.toISOString()}`);

        // Busca registros con cita próxima que no tengan el recordatorio enviado
        const result = await pool.query(`
            SELECT * FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1
              AND "fechaAtencion" <= $2
              AND "medico" ILIKE '%NUBIA%'
              AND ("recordatorioLinkEnviado" IS NULL OR "recordatorioLinkEnviado" = false)
            LIMIT 20
        `, [cincoMinFuturo.toISOString(), quinceMinFuturo.toISOString()]);

        console.log(`📊 [barridoNubiaEnviarLink] Registros encontrados: ${result.rows.length}`);

        if (result.rows.length === 0) {
            console.log("⚠️ [barridoNubiaEnviarLink] No hay citas próximas de NUBIA");
            return { mensaje: 'No hay citas próximas de NUBIA.', enviados: 0 };
        }

        let enviados = 0;

        for (const registro of result.rows) {
            const { primerNombre, celular, _id: historiaId } = registro;

            if (!celular) {
                console.log(`⚠️ [barridoNubiaEnviarLink] ${primerNombre} no tiene celular`);
                continue;
            }

            const telefonoLimpio = celular.replace(/\s+/g, '').replace(/[^\d]/g, '');
            const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

            // URL del formulario médico virtual
            const url = `https://sea-lion-app-qcttp.ondigitalocean.app/?_id=${historiaId}`;
            const messageBody = `Hola ${primerNombre}, tu cita está próxima..\n\nComunícate ya haciendo clic en este link:\n\n${url}`;

            try {
                await sendWhatsAppMessage(toNumber, messageBody);

                // Marcar que ya se envió el recordatorio
                await pool.query(`
                    UPDATE "HistoriaClinica"
                    SET "recordatorioLinkEnviado" = true
                    WHERE "_id" = $1
                `, [historiaId]);

                console.log(`✅ [barridoNubiaEnviarLink] Link enviado a ${primerNombre} (${toNumber})`);
                enviados++;
            } catch (sendError) {
                console.error(`Error enviando link a ${toNumber}:`, sendError);
            }

            // Pequeño delay entre mensajes
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`✅ [barridoNubiaEnviarLink] Enviados ${enviados} links`);
        return { mensaje: `Enviados ${enviados} links de NUBIA.`, enviados };
    } catch (error) {
        console.error("❌ Error en barridoNubiaEnviarLink:", error.message);
        throw error;
    }
}

// ==========================================
// BARRIDO NUBIA - Marcar como ATENDIDO citas pasadas
// Para consultas presenciales con médico NUBIA
// ==========================================
async function barridoNubiaMarcarAtendido() {
    console.log("🚀 [barridoNubiaMarcarAtendido] Iniciando ejecución...");
    try {
        const ahora = new Date();
        // Buscar citas desde 2 horas atrás hasta 5 minutos atrás (ya pasaron)
        const dosHorasAtras = new Date(ahora.getTime() - 120 * 60 * 1000);
        const cincoMinAtras = new Date(ahora.getTime() - 5 * 60 * 1000);

        console.log(`📅 [barridoNubiaMarcarAtendido] Buscando citas de NUBIA entre ${dosHorasAtras.toISOString()} y ${cincoMinAtras.toISOString()}`);

        // Busca registros en HistoriaClinica con médico NUBIA que no estén atendidos
        // y cuya fecha de atención ya pasó (entre 2 horas atrás y 5 min atrás)
        const result = await pool.query(`
            SELECT * FROM "HistoriaClinica"
            WHERE "fechaAtencion" >= $1
              AND "fechaAtencion" <= $2
              AND "medico" ILIKE '%NUBIA%'
              AND ("atendido" IS NULL OR "atendido" != 'ATENDIDO')
            LIMIT 20
        `, [dosHorasAtras.toISOString(), cincoMinAtras.toISOString()]);

        console.log(`📊 [barridoNubiaMarcarAtendido] Registros encontrados: ${result.rows.length}`);

        if (result.rows.length === 0) {
            console.log("⚠️ [barridoNubiaMarcarAtendido] No hay registros de NUBIA pendientes por marcar");
            return { mensaje: 'No hay registros de NUBIA pendientes.', procesados: 0 };
        }

        let procesados = 0;

        for (const registro of result.rows) {
            await procesarRegistroNubia(registro);
            procesados++;
            // Pequeño delay entre registros
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`✅ [barridoNubiaMarcarAtendido] Procesados ${procesados} registros`);
        return { mensaje: `Procesados ${procesados} registros de NUBIA.`, procesados };
    } catch (error) {
        console.error("❌ Error en barridoNubiaMarcarAtendido:", error.message);
        throw error;
    }
}

async function procesarRegistroNubia(registro) {
    const {
        primerNombre,
        primerApellido,
        celular,
        _id: historiaId,
        fechaAtencion,
        medico
    } = registro;

    const ahora = new Date();
    const fechaAtencionDate = new Date(fechaAtencion);
    const minutosDesdesCita = (ahora.getTime() - fechaAtencionDate.getTime()) / 60000;

    console.log(`👤 [procesarRegistroNubia] ${primerNombre} ${primerApellido || ''} - Médico: ${medico} - Minutos desde cita: ${minutosDesdesCita.toFixed(1)}`);

    // Si ya pasó la cita (más de 5 minutos), marcar como ATENDIDO
    if (minutosDesdesCita >= 5) {
        try {
            // Actualizar el registro en HistoriaClinica
            await pool.query(`
                UPDATE "HistoriaClinica"
                SET "atendido" = 'ATENDIDO'
                WHERE "_id" = $1
            `, [historiaId]);

            console.log(`✅ [procesarRegistroNubia] Marcado como ATENDIDO: ${primerNombre} ${primerApellido || ''} (ID: ${historiaId})`);

            // Enviar mensaje de confirmación si tiene celular
            if (celular) {
                const telefonoLimpio = celular.replace(/\s+/g, '');
                const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

                // Enviar mensaje de WhatsApp al paciente
                const messageBody = `Hola ${primerNombre}, gracias por asistir a tu cita médico ocupacional. Puedes descargar tu certificado en el siguiente link: www.bsl.com.co/descargar`;

                try {
                    await sendWhatsAppMessage(toNumber, messageBody);
                    console.log(`📱 [procesarRegistroNubia] Mensaje enviado a ${primerNombre} (${toNumber})`);
                } catch (sendError) {
                    console.error(`Error enviando mensaje a ${toNumber}:`, sendError);
                }
            }
        } catch (updateError) {
            console.error(`Error actualizando registro de NUBIA ${historiaId}:`, updateError);
        }
    } else {
        console.log(`⏳ [procesarRegistroNubia] ${primerNombre} - Aún no han pasado 5 minutos desde la cita`);
    }
}

// Endpoint para ejecutar el barrido de NUBIA manualmente o via cron
app.post('/api/barrido-nubia', async (req, res) => {
    try {
        const resultado = await barridoNubiaMarcarAtendido();
        res.json({ success: true, ...resultado });
    } catch (error) {
        console.error('Error en barrido NUBIA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/barrido-nubia', async (req, res) => {
    try {
        const resultado = await barridoNubiaMarcarAtendido();
        res.json({ success: true, ...resultado });
    } catch (error) {
        console.error('Error en barrido NUBIA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// API para Panel NUBIA - Listar pacientes del día
// ==========================================
app.get('/api/nubia/pacientes', async (req, res) => {
    try {
        const { desde, hasta } = req.query;

        // Si se proporcionan fechas, usarlas; sino usar hoy
        // Colombia es UTC-5, agregamos el offset para que las fechas sean correctas
        let inicioDelDia, finDelDia;

        if (desde) {
            // Fecha en Colombia (UTC-5): 00:00:00 Colombia = 05:00:00 UTC
            inicioDelDia = new Date(desde + 'T05:00:00.000Z');
        } else {
            // Obtener fecha actual en Colombia
            const ahora = new Date();
            const colombiaOffset = -5 * 60; // UTC-5 en minutos
            const utcTime = ahora.getTime() + (ahora.getTimezoneOffset() * 60000);
            const colombiaTime = new Date(utcTime + (colombiaOffset * 60000));
            const hoyStr = colombiaTime.toISOString().split('T')[0];
            inicioDelDia = new Date(hoyStr + 'T05:00:00.000Z');
        }

        if (hasta) {
            // Fecha en Colombia (UTC-5): 23:59:59 Colombia = 04:59:59 UTC del día siguiente
            finDelDia = new Date(hasta + 'T05:00:00.000Z');
            finDelDia.setDate(finDelDia.getDate() + 1);
            finDelDia.setMilliseconds(finDelDia.getMilliseconds() - 1);
        } else {
            // Obtener fecha actual en Colombia
            const ahora = new Date();
            const colombiaOffset = -5 * 60;
            const utcTime = ahora.getTime() + (ahora.getTimezoneOffset() * 60000);
            const colombiaTime = new Date(utcTime + (colombiaOffset * 60000));
            const hoyStr = colombiaTime.toISOString().split('T')[0];
            finDelDia = new Date(hoyStr + 'T05:00:00.000Z');
            finDelDia.setDate(finDelDia.getDate() + 1);
            finDelDia.setMilliseconds(finDelDia.getMilliseconds() - 1);
        }

        console.log(`📋 [API NUBIA] Buscando pacientes del ${inicioDelDia.toISOString()} a ${finDelDia.toISOString()}`);

        const result = await pool.query(`
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre", h."primerApellido", h."segundoApellido",
                   h."celular", h."cargo", h."ciudad", h."tipoExamen", h."codEmpresa", h."empresa", h."medico",
                   h."atendido", h."examenes", h."_createdDate", h."fechaConsulta", h."fechaAtencion", h."horaAtencion",
                   h."pvEstado", h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado",
                   h."pagado",
                   (SELECT f.foto FROM formularios f WHERE f.numero_id = h."numeroId" ORDER BY f.fecha_registro DESC LIMIT 1) as foto
            FROM "HistoriaClinica" h
            WHERE h."medico" ILIKE '%NUBIA%'
              AND h."fechaAtencion" >= $1
              AND h."fechaAtencion" <= $2
            ORDER BY h."fechaAtencion" ASC
            LIMIT 100
        `, [inicioDelDia.toISOString(), finDelDia.toISOString()]);

        // Contar atendidos y pagados
        const atendidos = result.rows.filter(r => r.atendido === 'ATENDIDO').length;
        const pagados = result.rows.filter(r => r.pagado === true).length;

        res.json({
            success: true,
            data: result.rows,
            total: result.rows.length,
            atendidos,
            pagados
        });
    } catch (error) {
        console.error('❌ Error listando pacientes NUBIA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API para cambiar estado a ATENDIDO (Panel NUBIA)
app.post('/api/nubia/atender/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Valores por defecto
        const RECOMENDACIONES_DEFAULT = `1. PAUSAS ACTIVAS
2. HIGIENE POSTURAL
3. MEDIDAS ERGONOMICAS
4. TÉCNICAS DE MANEJO DE ESTRÉS
5. EJERCICIO AEROBICO
6. MANTENER MEDIDAS DE BIOSEGURIDAD PARA COVID.
7. ALIMENTACIÓN BALANCEADA`;

        const OBSERVACIONES_DEFAULT = `Basándonos en los resultados obtenidos de la evaluación osteomuscular, certificamos que el paciente presenta un sistema osteomuscular en condiciones óptimas de salud. Esta condición le permite llevar a cabo una variedad de actividades físicas y cotidianas sin restricciones notables y con un riesgo mínimo de lesiones osteomusculares.`;

        // Actualizar el registro
        const result = await pool.query(`
            UPDATE "HistoriaClinica"
            SET "atendido" = 'ATENDIDO',
                "fechaConsulta" = NOW(),
                "mdConceptoFinal" = 'ELEGIBLE PARA EL CARGO SIN RECOMENDACIONES LABORALES',
                "mdRecomendacionesMedicasAdicionales" = $2,
                "mdObservacionesCertificado" = $3
            WHERE "_id" = $1
            RETURNING *
        `, [id, RECOMENDACIONES_DEFAULT, OBSERVACIONES_DEFAULT]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        const paciente = result.rows[0];

        // Enviar mensaje de WhatsApp si tiene celular
        if (paciente.celular) {
            const telefonoLimpio = paciente.celular.replace(/\s+/g, '').replace(/[^\d]/g, '');
            const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

            const mensaje = `👋 Hola ${paciente.primerNombre}. Te escribimos de BSL. 🏥 Tu certificado médico ya está listo. 📄\n\nRevísalo haciendo clic en este link: 👉 www.bsl.com.co/descargar`;

            try {
                await sendWhatsAppMessage(toNumber, mensaje);
                console.log(`📱 [NUBIA] Mensaje de certificado enviado a ${paciente.primerNombre} (${toNumber})`);
            } catch (sendError) {
                console.error(`Error enviando mensaje:`, sendError);
            }
        }

        res.json({ success: true, data: paciente, message: 'Estado actualizado correctamente' });
    } catch (error) {
        console.error('❌ Error marcando como atendido:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API para marcar como PAGADO (Panel NUBIA)
app.post('/api/nubia/cobrar/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Actualizar estado a Pagado
        const result = await pool.query(`
            UPDATE "HistoriaClinica"
            SET "pvEstado" = 'Pagado'
            WHERE "_id" = $1
            RETURNING *
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        const paciente = result.rows[0];

        // Enviar mensaje con link de descarga
        if (paciente.celular) {
            const telefonoLimpio = paciente.celular.replace(/\s+/g, '').replace(/[^\d]/g, '');
            const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

            const mensaje = `Descargalo del siguiente link: https://www.bsl.com.co/descargar`;

            try {
                await sendWhatsAppMessage(toNumber, mensaje);
                console.log(`📱 [NUBIA] Link de descarga enviado a ${paciente.primerNombre} (${toNumber})`);
            } catch (sendError) {
                console.error(`Error enviando mensaje:`, sendError);
            }
        }

        res.json({ success: true, data: paciente, message: 'Marcado como pagado y mensaje enviado' });
    } catch (error) {
        console.error('❌ Error marcando como pagado:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API para eliminar registro (Panel NUBIA)
app.delete('/api/nubia/eliminar/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar que el registro existe
        const checkResult = await pool.query(`
            SELECT "_id", "primerNombre", "primerApellido", "numeroId"
            FROM "HistoriaClinica" WHERE "_id" = $1
        `, [id]);

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        const paciente = checkResult.rows[0];

        // Eliminar el registro
        await pool.query(`
            DELETE FROM "HistoriaClinica" WHERE "_id" = $1
        `, [id]);

        console.log(`🗑️ [NUBIA] Registro eliminado: ${paciente.primerNombre} ${paciente.primerApellido} (${paciente.numeroId})`);

        res.json({
            success: true,
            message: `Registro de ${paciente.primerNombre} ${paciente.primerApellido} eliminado correctamente`
        });
    } catch (error) {
        console.error('❌ Error eliminando registro:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API para enviar mensaje de bienvenida (Panel NUBIA)
app.post('/api/nubia/enviar-mensaje/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener datos del paciente
        const result = await pool.query(`
            SELECT * FROM "HistoriaClinica" WHERE "_id" = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        }

        const paciente = result.rows[0];

        if (!paciente.celular) {
            return res.status(400).json({ success: false, message: 'El paciente no tiene celular registrado' });
        }

        const telefonoLimpio = paciente.celular.replace(/\s+/g, '').replace(/[^\d]/g, '');
        const toNumber = telefonoLimpio.startsWith('57') ? telefonoLimpio : `57${telefonoLimpio}`;

        const mensaje = `Hola ${paciente.primerNombre}! Te escribimos de BSL.
Estás realizando con nosotros el examen médico virtual.

Debes realizar las siguientes pruebas:

https://www.bsl.com.co/historia-clinica2/${id}

Puedes hacerlo desde celular o computador.

¡Gracias!`;

        await sendWhatsAppMessage(toNumber, mensaje);

        res.json({ success: true, message: 'Mensaje enviado correctamente' });
    } catch (error) {
        console.error('❌ Error enviando mensaje:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API para buscar paciente por cédula (Panel NUBIA)
app.get('/api/nubia/buscar', async (req, res) => {
    try {
        const { q } = req.query;

        if (!q) {
            return res.status(400).json({ success: false, message: 'Parámetro de búsqueda requerido' });
        }

        const result = await pool.query(`
            SELECT "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                   "celular", "cargo", "ciudad", "tipoExamen", "codEmpresa", "empresa", "medico",
                   "atendido", "examenes", "_createdDate", "fechaConsulta", "fechaAtencion", "horaAtencion",
                   "pvEstado"
            FROM "HistoriaClinica"
            WHERE ("numeroId" ILIKE $1 OR "_id" ILIKE $1)
            ORDER BY "_createdDate" DESC
            LIMIT 20
        `, [`%${q}%`]);

        res.json({
            success: true,
            data: result.rows,
            total: result.rows.length
        });
    } catch (error) {
        console.error('❌ Error buscando paciente:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// CRON JOB - Barrido NUBIA cada 5 minutos
// ==========================================
cron.schedule('*/5 * * * *', async () => {
    console.log('⏰ [CRON] Ejecutando barrido NUBIA automático...');
    try {
        // 1. Enviar link médico virtual a citas próximas (5-15 min antes)
        await barridoNubiaEnviarLink();

        // 2. Marcar como ATENDIDO citas que ya pasaron
        await barridoNubiaMarcarAtendido();
    } catch (error) {
        console.error('❌ [CRON] Error en barrido NUBIA:', error);
    }
});

console.log('✅ Cron job configurado: Barrido NUBIA cada 5 minutos');

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📊 Base de datos: PostgreSQL en Digital Ocean`);
});
