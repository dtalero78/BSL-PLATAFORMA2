const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { subirFotoASpaces } = require('../services/spaces-upload');
const { enviarAlertasPreguntasCriticas } = require('../services/payment');
const { FormulariosRepository, HistoriaClinicaRepository } = require('../repositories');

// Ruta para recibir el formulario
router.post('/formulario', async (req, res) => {
    try {
        const datos = req.body;

        // Validacion basica
        if (!datos.genero || !datos.edad || !datos.email) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos obligatorios'
            });
        }

        // Subir foto a DigitalOcean Spaces si existe
        let fotoUrl = null;
        if (datos.foto && datos.foto.startsWith('data:image')) {
            console.log('📤 Subiendo foto a DigitalOcean Spaces...');
            fotoUrl = await subirFotoASpaces(datos.foto, datos.numeroId, 'new');
        }

        // Verificar si ya existe un formulario con este wix_id
        let existeFormulario = false;
        if (datos.wixId) {
            const checkResult = await pool.query(
                'SELECT id FROM formularios WHERE wix_id = $1',
                [datos.wixId]
            );
            existeFormulario = checkResult.rows.length > 0;
        }

        let result;

        if (existeFormulario) {
            // UPDATE si ya existe
            const updateQuery = `
                UPDATE formularios SET
                    primer_nombre = $2, primer_apellido = $3, numero_id = $4, celular = $5,
                    empresa = $6, cod_empresa = $7, fecha_atencion = $8,
                    genero = $9, edad = $10, fecha_nacimiento = $11, lugar_nacimiento = $12, ciudad_residencia = $13,
                    hijos = $14, profesion_oficio = $15, empresa1 = $16, empresa2 = $17, estado_civil = $18,
                    nivel_educativo = $19, email = $20, eps = $21, arl = $22, pensiones = $23, estatura = $24, peso = $25, ejercicio = $26,
                    cirugia_ocular = $27, consumo_licor = $28, cirugia_programada = $29, condicion_medica = $30,
                    dolor_cabeza = $31, dolor_espalda = $32, ruido_jaqueca = $33, embarazo = $34,
                    enfermedad_higado = $35, enfermedad_pulmonar = $36, fuma = $37, hernias = $38,
                    hormigueos = $39, presion_alta = $40, problemas_azucar = $41, problemas_cardiacos = $42,
                    problemas_sueno = $43, usa_anteojos = $44, usa_lentes_contacto = $45, varices = $46,
                    hepatitis = $47, familia_hereditarias = $48, familia_geneticas = $49, familia_diabetes = $50,
                    familia_hipertension = $51, familia_infartos = $52, familia_cancer = $53,
                    familia_trastornos = $54, familia_infecciosas = $55,
                    trastorno_psicologico = $56, sintomas_psicologicos = $57, diagnostico_cancer = $58,
                    enfermedades_laborales = $59, enfermedad_osteomuscular = $60, enfermedad_autoinmune = $61,
                    firma = $62, inscripcion_boletin = $63, foto_url = COALESCE($64, foto_url),
                    updated_at = CURRENT_TIMESTAMP
                WHERE wix_id = $1
                RETURNING id
            `;

            const updateValues = [
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
                datos.firma, datos.inscripcionBoletin, fotoUrl
            ];

            result = await pool.query(updateQuery, updateValues);
            console.log('✅ Formulario actualizado en PostgreSQL:', result.rows[0].id);
        } else {
            // INSERT si no existe
            const insertQuery = `
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
                    firma, inscripcion_boletin, foto_url
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

            const insertValues = [
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
                datos.firma, datos.inscripcionBoletin, fotoUrl
            ];

            result = await pool.query(insertQuery, insertValues);
            console.log('✅ Formulario guardado en PostgreSQL:', result.rows[0].id);
        }

        // Enviar alertas por WhatsApp si hay respuestas afirmativas en preguntas criticas
        try {
            await enviarAlertasPreguntasCriticas(datos);
        } catch (alertaError) {
            console.error('❌ Error al enviar alertas WhatsApp:', alertaError.message);
            // No bloqueamos la respuesta si falla el envio de alertas
        }

        // Enviar datos a Wix
        try {
            const fetch = (await import('node-fetch')).default;

            // Mapear encuestaSalud - solo incluir respuestas "Si" (para tags de Wix)
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

            // Mapear antecedentesFamiliares - solo incluir respuestas "Si" (para tags de Wix)
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
                numeroId: datos.wixId || "",
                codEmpresa: datos.codEmpresa || "",
                primerNombre: datos.primerNombre || "",
                examenes: "",
                celular: datos.celular || "No disponible",
                ejercicio: datos.ejercicio || "",
                estadoCivil: datos.estadoCivil || "",
                hijos: datos.hijos || "",
                consumoLicor: datos.consumoLicor || "",
                email: datos.email || "",
                foto: datos.foto || "",
                firma: datos.firma || "",
                encuestaSalud: encuestaSaludTags,
                antecedentesFamiliares: antecedentesFamiliaresTags,
                fechaNacimiento: datos.fechaNacimiento || "",
                edad: datos.edad || "",
                genero: datos.genero || "",
                lugarDeNacimiento: datos.lugarDeNacimiento || "",
                ciudadDeResidencia: datos.ciudadDeResidencia || "",
                direccion: "",
                profesionUOficio: datos.profesionUOficio || "",
                nivelEducativo: datos.nivelEducativo || "",
                empresa1: datos.empresa1 || "",
                empresa2: datos.empresa2 || "",
                eps: datos.eps || "",
                arl: datos.arl || "",
                pensiones: datos.pensiones || "",
                estatura: datos.estatura || "",
                peso: datos.peso || "",
                documentoIdentidad: datos.numeroId || "",
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
            console.error('❌ EXCEPCION al enviar a Wix:');
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
router.get('/formularios', async (req, res) => {
    try {
        // Solo seleccionar los campos necesarios para la vista resumida
        // IMPORTANTE: No incluir 'foto' aqui porque son imagenes base64 muy grandes
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
router.get('/formulario/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Use repository
        const formulario = await FormulariosRepository.findById(id, 'id');

        if (formulario) {
            res.json({ success: true, data: formulario });
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

// Endpoint de busqueda server-side para formularios (escala a 100,000+ registros)
router.get('/formularios/search', async (req, res) => {
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
            WHERE (
                COALESCE(f.numero_id, '') || ' ' ||
                COALESCE(f.primer_nombre, '') || ' ' ||
                COALESCE(f.primer_apellido, '') || ' ' ||
                COALESCE(f.cod_empresa, '') || ' ' ||
                COALESCE(f.celular, '')
            ) ILIKE $1
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
        console.error('❌ Error en busqueda de formularios:', error);
        res.status(500).json({
            success: false,
            message: 'Error en la busqueda',
            error: error.message
        });
    }
});

// Buscar formulario por wix_id (orden_id), con fallback a numero_id (cedula)
router.get('/formularios/buscar/:identificador', async (req, res) => {
    try {
        const { identificador } = req.params;

        console.log(`🔍 Buscando formulario por identificador: ${identificador}`);

        // Use repositories - buscar por wix_id, luego numero_id, luego via HistoriaClinica
        let formulario = await FormulariosRepository.findByWixId(identificador);

        if (!formulario) {
            console.log(`🔍 No encontrado por wix_id, buscando por numero_id...`);
            formulario = await FormulariosRepository.findUltimoPorNumeroId(identificador);
        }

        if (!formulario) {
            const hc = await HistoriaClinicaRepository.findByNumeroId(identificador);
            if (hc) {
                console.log(`🔍 Buscando formulario por wix_id desde HC: ${hc._id}`);
                formulario = await FormulariosRepository.findByWixId(hc._id);
            }
        }

        if (!formulario) {
            return res.json({
                success: false,
                message: 'No se encontró formulario para este paciente'
            });
        }

        res.json({
            success: true,
            data: formulario
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

// Tambien crear una ruta con /api/formularios/:id para compatibilidad con el frontend
router.get('/formularios/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Use repository
        const formulario = await FormulariosRepository.findById(id, 'id');

        if (!formulario) {
            return res.status(404).json({
                success: false,
                message: 'Formulario no encontrado'
            });
        }

        // Use repository para HistoriaClinica
        let historiaClinica = null;
        if (formulario.numero_id) {
            try {
                historiaClinica = await HistoriaClinicaRepository.findByNumeroId(formulario.numero_id);
            } catch (historiaError) {
                console.error('⚠️ No se pudo obtener HistoriaClinica:', historiaError.message);
            }
        }

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

// Ruta para enlazar una orden con un formulario existente
router.post('/formularios/enlazar-orden', async (req, res) => {
    try {
        const { formId, numeroId, nuevoWixId } = req.body;

        if (!nuevoWixId) {
            return res.status(400).json({ success: false, error: 'nuevoWixId es requerido' });
        }

        // Use repository - verificar que la orden existe
        const ordenExiste = await HistoriaClinicaRepository.findById(nuevoWixId);

        if (!ordenExiste) {
            return res.status(404).json({
                success: false,
                error: 'La orden especificada no existe en HistoriaClinica'
            });
        }

        let result;

        if (formId) {
            // Actualizar por ID del formulario
            result = await pool.query(
                'UPDATE formularios SET wix_id = $1 WHERE id = $2 RETURNING id, wix_id, numero_id',
                [nuevoWixId, formId]
            );
        } else if (numeroId) {
            // Actualizar por numero de identificacion
            result = await pool.query(
                'UPDATE formularios SET wix_id = $1 WHERE numero_id = $2 RETURNING id, wix_id, numero_id',
                [nuevoWixId, numeroId]
            );
        } else {
            return res.status(400).json({
                success: false,
                error: 'Se requiere formId o numeroId para identificar el formulario'
            });
        }

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No se encontro el formulario para actualizar'
            });
        }

        console.log('✅ Orden enlazada correctamente:', result.rows[0]);

        res.json({
            success: true,
            data: result.rows[0],
            message: 'Orden enlazada correctamente'
        });

    } catch (error) {
        console.error('❌ Error enlazando orden:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Ruta para actualizar un formulario
router.put('/formularios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const datos = req.body;

        // Use repository - verificar que el formulario existe
        const formularioActual = await FormulariosRepository.findById(id, 'id');
        if (!formularioActual) {
            return res.status(404).json({
                success: false,
                message: 'Formulario no encontrado'
            });
        }

        // Convertir cadenas vacias a null para campos numericos
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
                    console.error('❌ No se encontro el registro en Wix con idGeneral:', formularioActual.wix_id);
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
                console.error('❌ WIX: EXCEPCION al actualizar');
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
        console.log('🎉 RESUMEN: Actualizacion completada');
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

// Endpoint para eliminar un formulario y su historia clinica asociada
router.delete('/formularios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { numeroId } = req.body;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🗑️  ELIMINANDO REGISTRO');
        console.log('   ID Formulario:', id);
        console.log('   Numero ID (Cedula):', numeroId);
        console.log('═══════════════════════════════════════════════════════════');

        // Use repository - verificar existencia
        const formulario = await FormulariosRepository.findById(id, 'id');
        if (!formulario) {
            return res.status(404).json({
                success: false,
                message: 'Formulario no encontrado'
            });
        }

        let historiaClinicaEliminada = false;

        // Intentar eliminar la historia clinica asociada (si existe)
        if (numeroId) {
            try {
                const hc = await HistoriaClinicaRepository.findByNumeroId(numeroId);
                if (hc) {
                    await HistoriaClinicaRepository.delete(hc._id);
                    historiaClinicaEliminada = true;
                    console.log('   ✅ Historia Clinica eliminada');
                } else {
                    console.log('   ℹ️  No se encontro Historia Clinica asociada');
                }
            } catch (hcError) {
                console.error('   ⚠️ Error al eliminar Historia Clinica:', hcError.message);
            }
        }

        // Use repository - eliminar formulario
        const eliminado = await FormulariosRepository.delete(id, 'id');

        if (!eliminado) {
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
            mensaje += ' junto con su Historia Clinica asociada';
        }

        res.json({
            success: true,
            message: mensaje,
            data: {
                formularioEliminado: formulario,
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

// Buscar paciente por numero de identificacion (para actualizar-foto.html)
router.get('/buscar-paciente/:numeroId', async (req, res) => {
    try {
        const { numeroId } = req.params;

        if (!numeroId) {
            return res.status(400).json({ success: false, message: 'Numero de identificacion requerido' });
        }

        // Buscar en formularios primero
        const formulario = await FormulariosRepository.findUltimoPorNumeroId(numeroId);

        if (formulario) {
            return res.json({
                success: true,
                data: {
                    numero_id: formulario.numero_id,
                    nombre: [formulario.primer_nombre, formulario.primer_apellido].filter(Boolean).join(' '),
                    fuente: 'formularios',
                    formulario_id: formulario.id
                }
            });
        }

        // Fallback: buscar en HistoriaClinica
        const hc = await HistoriaClinicaRepository.findByNumeroId(numeroId);

        if (hc) {
            return res.json({
                success: true,
                data: {
                    numero_id: hc.numeroId,
                    nombre: [hc.primerNombre, hc.primerApellido].filter(Boolean).join(' '),
                    fuente: 'historia_clinica',
                    hc_id: hc._id
                }
            });
        }

        res.json({ success: false, message: 'No se encontro el paciente' });

    } catch (error) {
        console.error('❌ Error buscando paciente:', error);
        res.status(500).json({ success: false, message: 'Error al buscar paciente' });
    }
});

// Actualizar foto de un paciente (para actualizar-foto.html)
router.post('/actualizar-foto', async (req, res) => {
    try {
        const { numeroId, foto } = req.body;

        if (!numeroId || !foto) {
            return res.status(400).json({ success: false, message: 'Se requiere numeroId y foto' });
        }

        if (!foto.startsWith('data:image')) {
            return res.status(400).json({ success: false, message: 'Formato de imagen invalido' });
        }

        // Subir foto a DigitalOcean Spaces
        const fotoUrl = await subirFotoASpaces(foto, numeroId, 'update');

        if (!fotoUrl) {
            return res.status(500).json({ success: false, message: 'Error al subir la foto' });
        }

        // Actualizar foto_url en formularios
        const formulario = await FormulariosRepository.findUltimoPorNumeroId(numeroId);

        if (!formulario) {
            return res.status(404).json({ success: false, message: 'No se encontro registro del paciente' });
        }

        await FormulariosRepository.actualizarFotoUrl(formulario.id, fotoUrl);
        console.log('✅ Foto actualizada en formularios para:', numeroId);

        res.json({ success: true, message: 'Foto actualizada correctamente', fotoUrl });

    } catch (error) {
        console.error('❌ Error actualizando foto:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar la foto' });
    }
});

module.exports = router;
