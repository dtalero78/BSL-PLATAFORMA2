const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

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

// Endpoint para crear nueva orden (guarda en PostgreSQL y Wix HistoriaClinica)
app.post('/api/ordenes', async (req, res) => {
    try {
        const {
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
            atendido,
            examenes,
            empresa
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

        // Generar un _id único para Wix (formato UUID-like)
        const wixId = `orden_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 1. Guardar en PostgreSQL HistoriaClinica
        console.log('');
        console.log('💾 Guardando en PostgreSQL HistoriaClinica...');

        const insertQuery = `
            INSERT INTO "HistoriaClinica" (
                "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                "celular", "codEmpresa", "empresa", "cargo", "ciudad", "tipoExamen", "medico",
                "fechaAtencion", "atendido", "examenes", "_createdDate", "_updatedDate"
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW()
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

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📊 Base de datos: PostgreSQL en Digital Ocean`);
});
