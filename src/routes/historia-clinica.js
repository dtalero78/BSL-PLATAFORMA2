const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { construirFechaAtencionColombia } = require('../helpers/date');

// ==================== HISTORIA CLINICA ENDPOINTS ====================
// Mounted at /api/historia-clinica

// GET /list - Listar órdenes de HistoriaClinica (sincronizadas desde Wix)
router.get('/list', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const buscar = req.query.buscar?.trim();

        console.log(`📋 Listando órdenes de HistoriaClinica (página ${page}, limit ${limit}${buscar ? `, búsqueda: "${buscar}"` : ''})...`);

        let totalRegistros;
        let whereClause = '';
        const params = [];

        if (buscar && buscar.length >= 2) {
            // Búsqueda con índice GIN pg_trgm
            whereClause = `WHERE (
                COALESCE(h."numeroId", '') || ' ' ||
                COALESCE(h."primerNombre", '') || ' ' ||
                COALESCE(h."primerApellido", '') || ' ' ||
                COALESCE(h."codEmpresa", '') || ' ' ||
                COALESCE(h."celular", '') || ' ' ||
                COALESCE(h."empresa", '')
            ) ILIKE $1`;
            params.push(`%${buscar}%`);

            // COUNT exacto cuando hay búsqueda
            const countResult = await pool.query(`
                SELECT COUNT(*) FROM "HistoriaClinica" h ${whereClause}
            `, params);
            totalRegistros = parseInt(countResult.rows[0].count);
        } else {
            // Sin búsqueda: usar estimación rápida de PostgreSQL (<1ms vs 522ms)
            const countResult = await pool.query(`
                SELECT reltuples::bigint as estimate FROM pg_class WHERE relname = 'HistoriaClinica'
            `);
            totalRegistros = parseInt(countResult.rows[0].estimate) || 0;
        }

        const totalPaginas = Math.ceil(totalRegistros / limit);

        // Obtener registros de HistoriaClinica con foto_url del formulario vinculado
        const queryParams = buscar ? [...params, limit, offset] : [limit, offset];
        const limitParam = buscar ? '$2' : '$1';
        const offsetParam = buscar ? '$3' : '$2';

        const historiaResult = await pool.query(`
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre", h."primerApellido", h."segundoApellido",
                   h."celular", h."cargo", h."ciudad", h."tipoExamen", h."codEmpresa", h."empresa", h."medico",
                   h."atendido", h."examenes", h."_createdDate", h."fechaConsulta", h."fechaAtencion", h."horaAtencion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado", h."mdObsParaMiDocYa",
                   h."pvEstado",
                   'historia' as origen,
                   COALESCE(f_exact.foto_url, f_fallback.foto_url) as foto_url
            FROM "HistoriaClinica" h
            LEFT JOIN formularios f_exact ON f_exact.wix_id = h."_id"
            LEFT JOIN LATERAL (
                SELECT foto_url FROM formularios
                WHERE numero_id = h."numeroId" AND foto_url IS NOT NULL
                ORDER BY fecha_registro DESC LIMIT 1
            ) f_fallback ON f_exact.id IS NULL
            ${whereClause}
            ORDER BY h."_createdDate" DESC
            LIMIT ${limitParam} OFFSET ${offsetParam}
        `, queryParams);

        console.log(`✅ HistoriaClinica: ${historiaResult.rows.length} registros (página ${page}/${totalPaginas})`);

        res.json({
            success: true,
            total: totalRegistros,
            page,
            limit,
            totalPaginas,
            data: historiaResult.rows
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

// GET /buscar - Búsqueda server-side para HistoriaClinica (escala a 100,000+ registros)
router.get('/buscar', async (req, res) => {
    try {
        const { q } = req.query;

        // Requiere al menos 2 caracteres para buscar
        if (!q || q.length < 2) {
            return res.json({ success: true, data: [] });
        }

        console.log(`🔍 Buscando en HistoriaClinica: "${q}"`);

        const searchTerm = `%${q}%`;
        const result = await pool.query(`
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre",
                   h."primerApellido", h."segundoApellido", h."celular", h."cargo",
                   h."ciudad", h."tipoExamen", h."codEmpresa", h."empresa", h."medico",
                   h."atendido", h."examenes", h."_createdDate", h."fechaConsulta",
                   h."fechaAtencion", h."horaAtencion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales", h."mdObservacionesCertificado", h."mdObsParaMiDocYa",
                   'historia' as origen,
                   COALESCE(f_exact.foto_url, f_fallback.foto_url) as foto_url
            FROM "HistoriaClinica" h
            LEFT JOIN formularios f_exact ON f_exact.wix_id = h."_id"
            LEFT JOIN LATERAL (
                SELECT foto_url FROM formularios
                WHERE numero_id = h."numeroId" AND foto_url IS NOT NULL
                ORDER BY fecha_registro DESC LIMIT 1
            ) f_fallback ON f_exact.id IS NULL
            WHERE (
                COALESCE(h."numeroId", '') || ' ' ||
                COALESCE(h."primerNombre", '') || ' ' ||
                COALESCE(h."primerApellido", '') || ' ' ||
                COALESCE(h."codEmpresa", '') || ' ' ||
                COALESCE(h."celular", '') || ' ' ||
                COALESCE(h."empresa", '')
            ) ILIKE $1
            ORDER BY h."_createdDate" DESC
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

// GET /buscar-por-celular - Buscar paciente por celular (para el chat de WhatsApp)
router.get('/buscar-por-celular', async (req, res) => {
    try {
        const { celular } = req.query;

        if (!celular) {
            return res.status(400).json({ success: false, message: 'Se requiere el parámetro celular' });
        }

        console.log(`🔍 Buscando paciente por celular: "${celular}"`);

        // Normalizar el celular para búsqueda flexible
        const celularLimpio = celular.replace(/\D/g, ''); // Solo dígitos
        const celularSin57 = celularLimpio.startsWith('57') ? celularLimpio.substring(2) : celularLimpio;

        const result = await pool.query(`
            SELECT h.*
            FROM "HistoriaClinica" h
            WHERE h."celular" = $1
               OR h."celular" = $2
               OR h."celular" = $3
               OR REPLACE(h."celular", ' ', '') = $1
               OR REPLACE(h."celular", ' ', '') = $2
               OR REPLACE(h."celular", ' ', '') = $3
            ORDER BY h."_createdDate" DESC
            LIMIT 1
        `, [celular, celularLimpio, celularSin57]);

        if (result.rows.length === 0) {
            console.log(`⚠️ No se encontró paciente con celular: ${celular}`);
            return res.json({ success: false, message: 'No se encontró paciente con este celular' });
        }

        console.log(`✅ Paciente encontrado: ${result.rows[0].primerNombre} ${result.rows[0].primerApellido}`);

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Error buscando por celular:', error);
        res.status(500).json({
            success: false,
            message: 'Error en la búsqueda',
            error: error.message
        });
    }
});

// GET /:id - Obtener HistoriaClinica o Formulario por _id
router.get('/:id', async (req, res) => {
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

// PUT /:id - Editar HistoriaClinica o Formulario por _id
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const datos = req.body;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📝 Recibida solicitud de edición');
        console.log('   _id:', id);
        console.log('   📦 Datos recibidos:', JSON.stringify(datos, null, 2));
        console.log('   📊 Campo EPS:', datos.eps);
        console.log('═══════════════════════════════════════════════════════════');

        // Primero verificar si existe en HistoriaClinica
        const checkHistoria = await pool.query('SELECT "_id" FROM "HistoriaClinica" WHERE "_id" = $1', [id]);

        if (checkHistoria.rows.length > 0) {
            // ========== ACTUALIZAR EN HISTORIA CLINICA ==========
            const camposPermitidos = [
                'numeroId', 'primerNombre', 'segundoNombre', 'primerApellido', 'segundoApellido',
                'celular', 'email', 'codEmpresa', 'empresa', 'subempresa', 'cargo', 'tipoExamen', 'eps',
                'fechaAtencion', 'atendido', 'fechaConsulta', 'mdConceptoFinal', 'mdRecomendacionesMedicasAdicionales',
                'mdObservacionesCertificado', 'mdAntecedentes', 'mdObsParaMiDocYa', 'mdDx1', 'mdDx2',
                'talla', 'peso', 'motivoConsulta', 'diagnostico', 'tratamiento', 'pvEstado', 'medico', 'examenes',
                'aprobacion'
            ];

            const setClauses = [];
            const values = [];
            let paramIndex = 1;

            for (const campo of camposPermitidos) {
                if (datos[campo] !== undefined) {
                    setClauses.push(`"${campo}" = $${paramIndex}`);
                    if (campo === 'fechaAtencion' && datos[campo]) {
                        // Para fechaAtencion, construir con zona horaria Colombia
                        // El datetime-local viene como "2025-12-11T10:00" (hora local del usuario)
                        const fechaHora = datos[campo].split('T');
                        const fecha = fechaHora[0];
                        const hora = fechaHora[1] || '08:00';
                        values.push(construirFechaAtencionColombia(fecha, hora));
                    } else if (['fechaNacimiento', 'fechaConsulta'].includes(campo)) {
                        // Permitir null para fechaConsulta (cuando se cambia a PENDIENTE)
                        values.push(datos[campo] ? new Date(datos[campo]) : null);
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

            console.log('🔍 Query SQL a ejecutar:');
            console.log('   Query:', query);
            console.log('   Valores:', values);
            console.log('   Set Clauses:', setClauses);

            const result = await pool.query(query, values);
            const historiaActualizada = result.rows[0];

            console.log('✅ POSTGRESQL: HistoriaClinica actualizada exitosamente');
            console.log('   _id:', historiaActualizada._id);
            console.log('   numeroId:', historiaActualizada.numeroId);
            console.log('═══════════════════════════════════════════════════════════');

            // Si se actualizó el numeroId, actualizar en cascada en todas las tablas relacionadas
            if (datos.numeroId !== undefined) {
                const nuevoNumeroId = datos.numeroId;
                const ordenId = id; // El _id de HistoriaClinica es el orden_id en las otras tablas

                console.log('🔄 Actualizando numeroId en cascada...');
                console.log('   Nuevo numeroId:', nuevoNumeroId);
                console.log('   orden_id:', ordenId);

                // Actualizar en formularios (buscar por wix_id que es el orden_id)
                try {
                    const formResult = await pool.query(
                        'UPDATE formularios SET numero_id = $1 WHERE wix_id = $2 RETURNING id',
                        [nuevoNumeroId, ordenId]
                    );
                    if (formResult.rows.length > 0) {
                        console.log('   ✅ formularios actualizado');
                    }
                } catch (e) {
                    console.log('   ⚠️ formularios: sin registro para actualizar');
                }

                // Actualizar en audiometrias
                try {
                    const audioResult = await pool.query(
                        'UPDATE audiometrias SET numero_id = $1 WHERE orden_id = $2 RETURNING id',
                        [nuevoNumeroId, ordenId]
                    );
                    if (audioResult.rows.length > 0) {
                        console.log('   ✅ audiometrias actualizado');
                    }
                } catch (e) {
                    console.log('   ⚠️ audiometrias: sin registro para actualizar');
                }

                // Actualizar en pruebasADC
                try {
                    const adcResult = await pool.query(
                        'UPDATE "pruebasADC" SET numero_id = $1 WHERE orden_id = $2 RETURNING id',
                        [nuevoNumeroId, ordenId]
                    );
                    if (adcResult.rows.length > 0) {
                        console.log('   ✅ pruebasADC actualizado');
                    }
                } catch (e) {
                    console.log('   ⚠️ pruebasADC: sin registro para actualizar');
                }

                // Actualizar en visiometrias
                try {
                    const visioResult = await pool.query(
                        'UPDATE visiometrias SET numero_id = $1 WHERE orden_id = $2 RETURNING id',
                        [nuevoNumeroId, ordenId]
                    );
                    if (visioResult.rows.length > 0) {
                        console.log('   ✅ visiometrias actualizado');
                    }
                } catch (e) {
                    console.log('   ⚠️ visiometrias: sin registro para actualizar');
                }

                // Actualizar en visiometrias_virtual
                try {
                    const visioVirtualResult = await pool.query(
                        'UPDATE visiometrias_virtual SET numero_id = $1 WHERE orden_id = $2 RETURNING id',
                        [nuevoNumeroId, ordenId]
                    );
                    if (visioVirtualResult.rows.length > 0) {
                        console.log('   ✅ visiometrias_virtual actualizado');
                    }
                } catch (e) {
                    console.log('   ⚠️ visiometrias_virtual: sin registro para actualizar');
                }

                console.log('🔄 Actualización en cascada completada');
            }

            // Sincronizar con Wix
            try {
                const fetch = (await import('node-fetch')).default;

                // Preparar payload para Wix, convirtiendo fechaAtencion a ISO string
                const wixPayload = { _id: id, ...datos };

                // Si hay fechaAtencion, convertirla a ISO string para Wix
                if (datos.fechaAtencion) {
                    const fechaHora = datos.fechaAtencion.split('T');
                    const fecha = fechaHora[0];
                    const hora = fechaHora[1] || '08:00';
                    const fechaObj = construirFechaAtencionColombia(fecha, hora);
                    if (fechaObj) {
                        wixPayload.fechaAtencion = fechaObj.toISOString();
                        console.log('📅 Fecha para Wix (edición):', wixPayload.fechaAtencion);
                    }
                }

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

// PATCH /:id/pago - Toggle de estado de pago
router.patch('/:id/pago', async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener estado actual y numeroId
        const currentResult = await pool.query('SELECT "pagado", "numeroId" FROM "HistoriaClinica" WHERE "_id" = $1', [id]);

        if (currentResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Orden no encontrada' });
        }

        const estadoActual = currentResult.rows[0].pagado || false;
        const numeroId = currentResult.rows[0].numeroId;
        const nuevoEstado = !estadoActual;
        const pvEstado = nuevoEstado ? 'Pagado' : '';

        // Actualizar estado en PostgreSQL (pagado y pvEstado)
        await pool.query(
            'UPDATE "HistoriaClinica" SET "pagado" = $1, "pvEstado" = $2 WHERE "_id" = $3',
            [nuevoEstado, pvEstado, id]
        );

        console.log(`💰 Pago ${nuevoEstado ? 'marcado' : 'desmarcado'} para orden ${id}`);

        // Sincronizar con Wix usando endpoint marcarPagado (necesita numeroId)
        if (numeroId) {
            try {
                const wixPayload = {
                    userId: numeroId,
                    observaciones: pvEstado
                };
                console.log('📤 Sincronizando pvEstado con Wix (marcarPagado):', JSON.stringify(wixPayload));

                const wixResponse = await fetch('https://www.bsl.com.co/_functions/marcarPagado', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(wixPayload)
                });

                const wixText = await wixResponse.text();
                console.log('📡 WIX Response Status:', wixResponse.status);
                console.log('📡 WIX Response Body:', wixText);

                if (wixResponse.ok) {
                    console.log('✅ WIX: pvEstado sincronizado en HistoriaClinica');
                } else {
                    console.log('⚠️ WIX: No se pudo sincronizar pvEstado:', wixText);
                }
            } catch (wixError) {
                console.log('⚠️ WIX: Error al sincronizar pvEstado:', wixError.message);
            }
        } else {
            console.log('⚠️ WIX: No se puede sincronizar, falta numeroId');
        }

        res.json({ success: true, pagado: nuevoEstado });
    } catch (error) {
        console.error('❌ Error al actualizar pago:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar pago' });
    }
});

// DELETE /:id - Eliminar HistoriaClinica por _id
router.delete('/:id', async (req, res) => {
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

module.exports = router;
