const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

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
            'fecha_atencion VARCHAR(50)'
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

// Middleware
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
                nivel_educativo, email, estatura, peso, ejercicio,
                cirugia_ocular, consumo_licor, cirugia_programada, condicion_medica,
                dolor_cabeza, dolor_espalda, ruido_jaqueca, embarazo,
                enfermedad_higado, enfermedad_pulmonar, fuma, hernias,
                hormigueos, presion_alta, problemas_azucar, problemas_cardiacos,
                problemas_sueno, usa_anteojos, usa_lentes_contacto, varices,
                hepatitis, familia_hereditarias, familia_geneticas, familia_diabetes,
                familia_hipertension, familia_infartos, familia_cancer,
                familia_trastornos, familia_infecciosas, firma, inscripcion_boletin, foto
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
                $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
                $51, $52, $53, $54, $55
            ) RETURNING id
        `;

        const values = [
            datos.wixId, datos.primerNombre, datos.primerApellido, datos.numeroId, datos.celular,
            datos.empresa, datos.codEmpresa, datos.fechaAtencion,
            datos.genero, datos.edad, datos.fechaNacimiento, datos.lugarDeNacimiento, datos.ciudadDeResidencia,
            datos.hijos, datos.profesionUOficio, datos.empresa1, datos.empresa2, datos.estadoCivil,
            datos.nivelEducativo, datos.email, datos.estatura, datos.peso, datos.ejercicio,
            datos.cirugiaOcular, datos.consumoLicor, datos.cirugiaProgramada, datos.condicionMedica,
            datos.dolorCabeza, datos.dolorEspalda, datos.ruidoJaqueca, datos.embarazo,
            datos.enfermedadHigado, datos.enfermedadPulmonar, datos.fuma, datos.hernias,
            datos.hormigueos, datos.presionAlta, datos.problemasAzucar, datos.problemasCardiacos,
            datos.problemasSueno, datos.usaAnteojos, datos.usaLentesContacto, datos.varices,
            datos.hepatitis, datos.familiaHereditarias, datos.familiaGeneticas, datos.familiaDiabetes,
            datos.familiaHipertension, datos.familiaInfartos, datos.familiaCancer,
            datos.familiaTrastornos, datos.familiaInfecciosas, datos.firma, datos.inscripcionBoletin, datos.foto
        ];

        const result = await pool.query(query, values);

        console.log('✅ Formulario guardado en PostgreSQL:', result.rows[0].id);

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
                arl: "", // No lo tenemos en el formulario
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
        const result = await pool.query('SELECT * FROM formularios ORDER BY fecha_registro DESC');

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

// También crear una ruta con /api/formularios/:id para compatibilidad con el frontend
app.get('/api/formularios/:id', async (req, res) => {
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

        // Actualizar solo los campos que vienen en el body
        const query = `
            UPDATE formularios SET
                genero = COALESCE($1, genero),
                edad = COALESCE($2, edad),
                fecha_nacimiento = COALESCE($3, fecha_nacimiento),
                lugar_nacimiento = COALESCE($4, lugar_nacimiento),
                ciudad_residencia = COALESCE($5, ciudad_residencia),
                estado_civil = COALESCE($6, estado_civil),
                hijos = COALESCE($7, hijos),
                nivel_educativo = COALESCE($8, nivel_educativo),
                email = COALESCE($9, email),
                profesion_oficio = COALESCE($10, profesion_oficio),
                empresa1 = COALESCE($11, empresa1),
                empresa2 = COALESCE($12, empresa2),
                estatura = COALESCE($13, estatura),
                peso = COALESCE($14, peso),
                ejercicio = COALESCE($15, ejercicio)
            WHERE id = $16
            RETURNING *
        `;

        const values = [
            datos.genero,
            datos.edad,
            datos.fecha_nacimiento,
            datos.lugar_nacimiento,
            datos.ciudad_residencia,
            datos.estado_civil,
            datos.hijos,
            datos.nivel_educativo,
            datos.email,
            datos.profesion_oficio,
            datos.empresa1,
            datos.empresa2,
            datos.estatura,
            datos.peso,
            datos.ejercicio,
            id
        ];

        const result = await pool.query(query, values);
        const formularioActualizado = result.rows[0];

        console.log('✅ Formulario actualizado en PostgreSQL:', id);

        // Actualizar en Wix si tiene wix_id
        if (formularioActual.wix_id) {
            try {
                const fetch = (await import('node-fetch')).default;

                // Preparar payload para Wix usando los datos actualizados
                const wixPayload = {
                    _id: formularioActual.wix_id,
                    numeroId: formularioActualizado.numero_id || formularioActual.numero_id || "",
                    codEmpresa: formularioActualizado.cod_empresa || formularioActual.cod_empresa || "",
                    primerNombre: formularioActualizado.primer_nombre || formularioActual.primer_nombre || "",
                    celular: formularioActualizado.celular || formularioActual.celular || "",
                    ejercicio: formularioActualizado.ejercicio || "",
                    estadoCivil: formularioActualizado.estado_civil || "",
                    hijos: formularioActualizado.hijos || "",
                    email: formularioActualizado.email || "",
                    fechaNacimiento: formularioActualizado.fecha_nacimiento || "",
                    edad: formularioActualizado.edad || "",
                    genero: formularioActualizado.genero || "",
                    lugarDeNacimiento: formularioActualizado.lugar_nacimiento || "",
                    ciudadDeResidencia: formularioActualizado.ciudad_residencia || "",
                    profesionUOficio: formularioActualizado.profesion_oficio || "",
                    nivelEducativo: formularioActualizado.nivel_educativo || "",
                    empresa1: formularioActualizado.empresa1 || "",
                    empresa2: formularioActualizado.empresa2 || "",
                    estatura: formularioActualizado.estatura || "",
                    peso: formularioActualizado.peso || ""
                };

                console.log('📤 Actualizando datos en Wix...');
                console.log('📦 Payload:', JSON.stringify(wixPayload, null, 2));

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
                    console.log('✅ Datos actualizados en Wix exitosamente:', wixResult);
                } else {
                    const errorText = await wixResponse.text();
                    console.error('❌ ERROR al actualizar en Wix:');
                    console.error('   Status:', wixResponse.status);
                    console.error('   Response:', errorText);
                }

            } catch (wixError) {
                console.error('❌ EXCEPCIÓN al actualizar en Wix:');
                console.error('   Mensaje:', wixError.message);
                console.error('   Stack:', wixError.stack);
                // No bloqueamos la respuesta si Wix falla
            }
        } else {
            console.log('⚠️ El formulario no tiene wix_id, no se actualiza en Wix');
        }

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

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', database: 'connected' });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📊 Base de datos: PostgreSQL en Digital Ocean`);
});
