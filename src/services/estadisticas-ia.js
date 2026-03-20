const pool = require('../config/database');

// Schema descriptions for OpenAI (excludes foto, firma, foto_url)
const SCHEMA_FORMULARIOS = `
Table: formularios (employee health survey, snake_case columns, no quotes needed)
Columns:
- id (integer, PK autoincrement)
- numero_id (varchar, cedula/ID number of employee)
- primer_nombre, primer_apellido (varchar, name)
- celular (varchar, phone), email (varchar)
- genero (varchar: 'Masculino' or 'Femenino')
- edad (integer), fecha_nacimiento (varchar)
- lugar_nacimiento, ciudad_residencia (varchar)
- hijos (integer)
- profesion_oficio (varchar)
- estado_civil (varchar: 'Soltero/a', 'Casado/a', 'Union Libre', 'Divorciado/a', 'Viudo/a')
- nivel_educativo (varchar: 'Primaria', 'Secundaria', 'Técnico', 'Tecnólogo', 'Universitario', 'Posgrado')
- empresa1, empresa2 (varchar, company names)
- cod_empresa (varchar, company code - ALWAYS filter by this)
- estatura (varchar, in cm), peso (numeric, in kg)
- ejercicio (varchar: 'NUNCA', 'OCASIONALMENTE', '1 DIA SEMANAL', '2 DIAS SEMANALES', '+ DE 2 DIAS SEMANALES')
- consumo_licor (varchar: 'NUNCA', 'OCASIONALMENTE', '1 DIA SEMANAL', '2 DIAS SEMANALES', '+ DE 2 DIAS SEMANALES')
- fuma (varchar: 'SI' or 'NO')
- presion_alta, problemas_cardiacos, problemas_azucar, problemas_sueno (varchar: 'SI'/'NO')
- hormigueos, dolor_espalda, dolor_cabeza, ruido_jaqueca (varchar: 'SI'/'NO')
- embarazo, hernias, varices, hepatitis (varchar: 'SI'/'NO')
- enfermedad_higado, enfermedad_pulmonar (varchar: 'SI'/'NO')
- cirugia_ocular, usa_anteojos, usa_lentes_contacto (varchar: 'SI'/'NO')
- cirugia_programada, condicion_medica (varchar: 'SI'/'NO')
- trastorno_psicologico, sintomas_psicologicos (varchar: 'SI'/'NO')
- diagnostico_cancer, enfermedades_laborales (varchar: 'SI'/'NO')
- enfermedad_osteomuscular, enfermedad_autoinmune (varchar: 'SI'/'NO')
- familia_diabetes, familia_hipertension, familia_cancer (varchar: 'SI'/'NO')
- familia_infartos, familia_trastornos, familia_hereditarias, familia_geneticas, familia_infecciosas (varchar: 'SI'/'NO')
- eps, arl, pensiones (varchar, insurance names)
- inscripcion_boletin (varchar)
- fecha_registro (timestamp)
- wix_id (varchar, links to HistoriaClinica._id)
- fecha_atencion (varchar), fecha_consulta (timestamp)
- atendido (varchar), medico (varchar)
- md_concepto_final (text: 'APTO', 'APLAZADO', 'NO APTO', 'APTO CON RECOMENDACIONES')
- md_recomendaciones_medicas, md_observaciones_certificado (text)
- certificado_enviado (boolean)
- hora_atencion (varchar)
- origen (varchar), updated_at (timestamp)
`;

const SCHEMA_HISTORIA_CLINICA = `
Table: "HistoriaClinica" (medical records, camelCase columns, MUST use double quotes around table and column names)
Columns:
- "_id" (varchar, PK, order ID)
- "_createdDate", "_updatedDate" (timestamptz)
- "numeroId" (varchar, cedula/ID number - same as formularios.numero_id)
- "primerNombre", "segundoNombre", "primerApellido", "segundoApellido" (varchar)
- "celular" (varchar), "email" (varchar)
- "codEmpresa" (varchar, company code - ALWAYS filter by this)
- "empresa" (varchar, company name)
- "cargo" (varchar, job position)
- "tipoExamen" (varchar: 'INGRESO', 'PERIODICO', 'RETIRO', 'POST-INCAPACIDAD')
- "mdAntecedentes" (text, medical history notes)
- "mdObsParaMiDocYa" (text, observations for doctor)
- "mdObservacionesCertificado" (text, certificate observations)
- "mdRecomendacionesMedicasAdicionales" (text, medical recommendations)
- "mdConceptoFinal" (text: 'APTO', 'APLAZADO', 'NO APTO', 'APTO CON RECOMENDACIONES')
- "mdDx1", "mdDx2" (text, CIE-10 diagnosis codes)
- "talla" (varchar, height), "peso" (varchar, weight)
- "motivoConsulta", "diagnostico", "tratamiento" (text)
- "fechaAtencion" (timestamptz, appointment date)
- "fechaConsulta" (timestamptz, consultation date)
- "atendido" (varchar: 'PENDIENTE', 'ATENDIDO')
- "pvEstado" (varchar)
- "medico" (varchar, doctor name)
- "ciudad" (varchar, city)
- "examenes" (text, exams requested)
- "horaAtencion" (varchar)
- "pagado" (boolean), "fecha_pago" (timestamp)
- "origen" (varchar)
- "subempresa" (varchar), "centro_de_costo" (varchar)
- "aprobacion" (varchar), "aprobacion_externa" (varchar)
- "fecha_aprobacion_externa" (timestamp), "concepto_aprobado" (varchar)
- "linkEnviado" (varchar)
- "eps" (varchar)
- "observaciones_siigo" (text)
- "datosNutricionales" (jsonb)
`;

const SYSTEM_PROMPT_SQL = `Eres un generador de SQL para PostgreSQL. Dada una pregunta en lenguaje natural, genera UNICAMENTE una query SELECT.

ESQUEMA DE TABLAS:
${SCHEMA_FORMULARIOS}
${SCHEMA_HISTORIA_CLINICA}

RELACION ENTRE TABLAS:
- JOIN: "HistoriaClinica"."numeroId" = formularios.numero_id
- Ambas tablas tienen código de empresa: "HistoriaClinica"."codEmpresa" y formularios.cod_empresa

REGLAS ESTRICTAS:
1. SOLO genera queries SELECT. Nunca INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE.
2. SIEMPRE filtra por la empresa proporcionada usando "codEmpresa" = '{codEmpresa}' o cod_empresa = '{codEmpresa}'
3. NUNCA selecciones columnas: foto, firma, foto_url
4. Para "HistoriaClinica" SIEMPRE usa comillas dobles en nombre de tabla y columnas: "HistoriaClinica"."columna"
5. Para formularios NO uses comillas dobles
6. Agrega LIMIT 500 a menos que sea un COUNT/agregacion
7. Los valores SI/NO en formularios estan en MAYUSCULAS
8. Para comparaciones de texto usa UPPER() o ILIKE para ser flexible
9. Si la pregunta pide listar personas, incluye nombre, apellido y cedula
10. Responde UNICAMENTE con la query SQL, sin explicacion, sin markdown, sin backticks`;

function validarSQL(sql) {
    const trimmed = sql.trim().replace(/```sql?\n?/gi, '').replace(/```/g, '').trim();

    if (!/^\s*SELECT\b/i.test(trimmed)) {
        return { valid: false, sql: trimmed, reason: 'Solo se permiten queries SELECT' };
    }

    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|COPY)\b/i;
    if (forbidden.test(trimmed)) {
        return { valid: false, sql: trimmed, reason: 'Query contiene operaciones no permitidas' };
    }

    if (trimmed.includes(';')) {
        return { valid: false, sql: trimmed, reason: 'No se permiten multiples statements' };
    }

    if (/\b(foto|firma|foto_url)\b/i.test(trimmed)) {
        return { valid: false, sql: trimmed, reason: 'No se permite acceder a campos de imagen' };
    }

    return { valid: true, sql: trimmed };
}

function verificarFiltroEmpresa(sql, codEmpresa) {
    const upper = sql.toUpperCase();
    const codUpper = codEmpresa.toUpperCase();
    return upper.includes(codUpper);
}

async function callOpenAI(messages, temperature = 0, maxTokens = 1000) {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages,
            temperature,
            max_tokens: maxTokens
        })
    });

    if (!response.ok) {
        const err = await response.text();
        console.error('Error OpenAI:', err);
        throw new Error('Error al comunicarse con OpenAI');
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function ejecutarConsulta(sql) {
    const client = await pool.connect();
    try {
        await client.query('SET statement_timeout = 10000');
        const result = await client.query(sql);
        return { success: true, rows: result.rows, rowCount: result.rowCount };
    } catch (error) {
        return { success: false, error: error.message };
    } finally {
        client.release();
    }
}

async function procesarPreguntaIA(codEmpresa, pregunta) {
    console.log('');
    console.log('===================================================================');
    console.log('CONSULTA IA (SQL) - Empresa:', codEmpresa);
    console.log('Pregunta:', pregunta);
    console.log('===================================================================');

    // Step 1: Generate SQL
    const sqlPrompt = SYSTEM_PROMPT_SQL.replace(/\{codEmpresa\}/g, codEmpresa);
    const sqlRaw = await callOpenAI([
        { role: 'system', content: sqlPrompt },
        { role: 'user', content: pregunta }
    ], 0, 500);

    console.log('SQL generado:', sqlRaw);

    // Step 2: Validate SQL
    const validation = validarSQL(sqlRaw);
    if (!validation.valid) {
        console.error('SQL rechazado:', validation.reason);
        return { success: true, respuesta: 'No pude generar una consulta segura para esa pregunta. Intenta reformularla.' };
    }

    // Step 3: Verify company filter
    if (!verificarFiltroEmpresa(validation.sql, codEmpresa)) {
        console.error('SQL sin filtro de empresa');
        return { success: true, respuesta: 'No pude generar una consulta segura para esa pregunta. Intenta reformularla.' };
    }

    // Step 4: Execute query
    let resultado = await ejecutarConsulta(validation.sql);

    // Step 4b: Retry once if query failed
    if (!resultado.success) {
        console.log('Query falló, reintentando con contexto de error:', resultado.error);
        const retrySql = await callOpenAI([
            { role: 'system', content: sqlPrompt },
            { role: 'user', content: pregunta },
            { role: 'assistant', content: sqlRaw },
            { role: 'user', content: `La query anterior falló con error: ${resultado.error}. Genera una query corregida.` }
        ], 0, 500);

        const retryValidation = validarSQL(retrySql);
        if (retryValidation.valid && verificarFiltroEmpresa(retryValidation.sql, codEmpresa)) {
            console.log('SQL reintento:', retryValidation.sql);
            resultado = await ejecutarConsulta(retryValidation.sql);
        }

        if (!resultado.success) {
            console.error('Query falló en reintento:', resultado.error);
            return { success: true, respuesta: 'No pude consultar esa información. Intenta una pregunta más específica.' };
        }
    }

    console.log(`Query exitosa: ${resultado.rowCount} filas`);

    // Step 5: Format response with AI
    const datosParaIA = resultado.rows.slice(0, 100);
    const respuesta = await callOpenAI([
        {
            role: 'system',
            content: `Eres un analista de salud ocupacional para la empresa ${codEmpresa}.
Tu rol es responder preguntas de recursos humanos sobre sus colaboradores basándote en los resultados de una consulta a la base de datos.

INSTRUCCIONES:
- Responde en español, de forma clara, concisa y profesional
- Incluye números absolutos y porcentajes cuando sea relevante
- Si los resultados están vacíos, indícalo amablemente
- Usa emojis moderadamente para hacer la respuesta más visual
- Si detectas datos preocupantes, sugiere acciones preventivas
- Nunca reveles la query SQL ni detalles técnicos
- Nunca inventes datos, solo usa los proporcionados
- Si hay una lista de personas, preséntalas en formato legible`
        },
        {
            role: 'user',
            content: `Pregunta del usuario: ${pregunta}\n\nResultados de la consulta (${resultado.rowCount} registros):\n${JSON.stringify(datosParaIA, null, 2)}`
        }
    ], 0.7, 1500);

    console.log('Respuesta IA generada exitosamente');

    return { success: true, respuesta };
}

module.exports = { procesarPreguntaIA };
