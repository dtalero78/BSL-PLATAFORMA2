const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// ========== COMUNIDAD DE SALUD ==========

// GET /perfiles - Generar perfiles de salud
router.get('/perfiles', authMiddleware, async (req, res) => {
    try {
        console.log('📊 Generando perfiles de salud...');
        const startTime = Date.now();

        const { fechaDesde, fechaHasta } = req.query;
        let dateFilter = '';
        const dateParams = [];

        if (fechaDesde) {
            dateParams.push(fechaDesde);
            dateFilter += ` AND fecha_registro >= $${dateParams.length}`;
        }
        if (fechaHasta) {
            dateParams.push(fechaHasta + ' 23:59:59');
            dateFilter += ` AND fecha_registro <= $${dateParams.length}`;
        }

        // Obtener solo el total de miembros primero (rápido)
        const totalQuery = await pool.query(`SELECT COUNT(*) as total FROM formularios WHERE 1=1${dateFilter}`, dateParams);
        const total_miembros = parseInt(totalQuery.rows[0].total);

        console.log(`✅ Total miembros: ${total_miembros} (${Date.now() - startTime}ms)`);

        // Contar cada condición directamente de la BD con filtro de fecha
        const countQueries = {
            fumadores: `SELECT COUNT(*) as c FROM formularios WHERE fuma = 'SI'${dateFilter}`,
            hipertension: `SELECT COUNT(*) as c FROM formularios WHERE presion_alta = 'SI'${dateFilter}`,
            diabetes: `SELECT COUNT(*) as c FROM formularios WHERE problemas_azucar = 'SI'${dateFilter}`,
            dolor_cabeza: `SELECT COUNT(*) as c FROM formularios WHERE dolor_cabeza = 'SI'${dateFilter}`,
            dolor_espalda: `SELECT COUNT(*) as c FROM formularios WHERE dolor_espalda = 'SI'${dateFilter}`,
            problemas_sueno: `SELECT COUNT(*) as c FROM formularios WHERE problemas_sueno = 'SI'${dateFilter}`,
            salud_mental: `SELECT COUNT(*) as c FROM formularios WHERE trastorno_psicologico = 'SI'${dateFilter}`,
            sedentarios: `SELECT COUNT(*) as c FROM formularios WHERE ejercicio IN ('Nunca', 'Ocasionalmente')${dateFilter}`,
            sobrepeso: `SELECT COUNT(*) as c FROM formularios WHERE peso > 0 AND estatura ~ '^[0-9]+(\\.[0-9]+)?$' AND estatura::numeric > 0 AND (peso / ((estatura::numeric / 100) * (estatura::numeric / 100))) >= 25${dateFilter}`,
            riesgo_hipertension: `SELECT COUNT(*) as c FROM formularios WHERE familia_hipertension = 'SI'${dateFilter}`,
            riesgo_cancer: `SELECT COUNT(*) as c FROM formularios WHERE familia_cancer = 'SI'${dateFilter}`,
            riesgo_cardiovascular: `SELECT COUNT(*) as c FROM formularios WHERE familia_infartos = 'SI'${dateFilter}`
        };

        const countResults = await Promise.all(
            Object.entries(countQueries).map(async ([key, sql]) => {
                const result = await pool.query(sql, dateParams);
                return [key, parseInt(result.rows[0].c)];
            })
        );
        const counts = Object.fromEntries(countResults);

        const condiciones = {
            total_miembros,
            fumadores: counts.fumadores,
            hipertension: counts.hipertension,
            diabetes: counts.diabetes,
            dolor_cabeza: counts.dolor_cabeza,
            dolor_espalda: counts.dolor_espalda,
            problemas_sueno: counts.problemas_sueno,
            salud_mental: counts.salud_mental,
            sedentarios: counts.sedentarios,
            sobrepeso: counts.sobrepeso
        };

        const antecedentes = {
            riesgo_hipertension: counts.riesgo_hipertension,
            riesgo_cancer: counts.riesgo_cancer,
            riesgo_cardiovascular: counts.riesgo_cardiovascular
        };

        // Generar perfiles de salud
        const perfiles = [
            {
                id: 'fumadores',
                nombre: 'Fumadores',
                descripcion: 'Personas que fuman actualmente',
                icono: '🚬',
                color: '#DC2626',
                miembros: parseInt(condiciones.fumadores),
                porcentaje: ((parseInt(condiciones.fumadores) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'habitos',
                prioridad: 'alta',
                recomendaciones: [
                    'Programa de cesación tabáquica',
                    'Seguimiento médico regular',
                    'Contenido educativo sobre riesgos'
                ]
            },
            {
                id: 'dolor-espalda',
                nombre: 'Dolor de Espalda',
                descripcion: 'Personas con dolor de espalda crónico',
                icono: '🦴',
                color: '#F59E0B',
                miembros: parseInt(condiciones.dolor_espalda),
                porcentaje: ((parseInt(condiciones.dolor_espalda) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'sintomas',
                prioridad: 'media',
                recomendaciones: [
                    'Ejercicios de estiramiento',
                    'Ergonomía laboral',
                    'Fisioterapia preventiva'
                ]
            },
            {
                id: 'dolor-cabeza',
                nombre: 'Cefaleas/Migrañas',
                descripcion: 'Personas con dolores de cabeza frecuentes',
                icono: '🤕',
                color: '#EF4444',
                miembros: parseInt(condiciones.dolor_cabeza),
                porcentaje: ((parseInt(condiciones.dolor_cabeza) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'sintomas',
                prioridad: 'media',
                recomendaciones: [
                    'Control de triggers',
                    'Evaluación neurológica',
                    'Manejo del estrés'
                ]
            },
            {
                id: 'hipertension',
                nombre: 'Hipertensión',
                descripcion: 'Personas con presión arterial alta',
                icono: '💔',
                color: '#DC2626',
                miembros: parseInt(condiciones.hipertension),
                porcentaje: ((parseInt(condiciones.hipertension) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'condicion',
                prioridad: 'alta',
                recomendaciones: [
                    'Monitoreo de presión arterial',
                    'Dieta baja en sodio',
                    'Control médico regular'
                ]
            },
            {
                id: 'diabetes',
                nombre: 'Diabetes',
                descripcion: 'Personas con problemas de azúcar en sangre',
                icono: '🩸',
                color: '#7C3AED',
                miembros: parseInt(condiciones.diabetes),
                porcentaje: ((parseInt(condiciones.diabetes) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'condicion',
                prioridad: 'alta',
                recomendaciones: [
                    'Control de glucosa',
                    'Plan alimenticio',
                    'Educación en diabetes'
                ]
            },
            {
                id: 'sedentarios',
                nombre: 'Sedentarios',
                descripcion: 'Personas con poca actividad física',
                icono: '🪑',
                color: '#6B7280',
                miembros: parseInt(condiciones.sedentarios),
                porcentaje: ((parseInt(condiciones.sedentarios) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'estilo-vida',
                prioridad: 'media',
                recomendaciones: [
                    'Programa de actividad física',
                    'Retos de pasos diarios',
                    'Ejercicio en casa'
                ]
            },
            {
                id: 'sobrepeso',
                nombre: 'Sobrepeso/Obesidad',
                descripcion: 'Personas con IMC >= 25',
                icono: '⚖️',
                color: '#F59E0B',
                miembros: parseInt(condiciones.sobrepeso),
                porcentaje: ((parseInt(condiciones.sobrepeso) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'estilo-vida',
                prioridad: 'alta',
                recomendaciones: [
                    'Asesoría nutricional',
                    'Plan de ejercicio',
                    'Seguimiento de peso'
                ]
            },
            {
                id: 'problemas-sueno',
                nombre: 'Problemas de Sueño',
                descripcion: 'Personas con dificultades para dormir',
                icono: '😴',
                color: '#8B5CF6',
                miembros: parseInt(condiciones.problemas_sueno),
                porcentaje: ((parseInt(condiciones.problemas_sueno) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'sintomas',
                prioridad: 'media',
                recomendaciones: [
                    'Higiene del sueño',
                    'Técnicas de relajación',
                    'Evaluación médica'
                ]
            },
            {
                id: 'salud-mental',
                nombre: 'Salud Mental',
                descripcion: 'Personas con trastornos psicológicos',
                icono: '🧠',
                color: '#06B6D4',
                miembros: parseInt(condiciones.salud_mental),
                porcentaje: ((parseInt(condiciones.salud_mental) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'condicion',
                prioridad: 'alta',
                recomendaciones: [
                    'Apoyo psicológico',
                    'Terapia cognitivo-conductual',
                    'Manejo del estrés'
                ]
            },
            {
                id: 'riesgo-hipertension',
                nombre: 'Riesgo Hipertensión (Familiar)',
                descripcion: 'Antecedentes familiares de hipertensión',
                icono: '🧬',
                color: '#EC4899',
                miembros: parseInt(antecedentes.riesgo_hipertension),
                porcentaje: ((parseInt(antecedentes.riesgo_hipertension) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'riesgo',
                prioridad: 'media',
                recomendaciones: [
                    'Monitoreo preventivo',
                    'Estilo de vida saludable',
                    'Control periódico'
                ]
            },
            {
                id: 'riesgo-cancer',
                nombre: 'Riesgo Cáncer (Familiar)',
                descripcion: 'Antecedentes familiares de cáncer',
                icono: '🎗️',
                color: '#F472B6',
                miembros: parseInt(antecedentes.riesgo_cancer),
                porcentaje: ((parseInt(antecedentes.riesgo_cancer) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'riesgo',
                prioridad: 'alta',
                recomendaciones: [
                    'Chequeos preventivos',
                    'Exámenes específicos',
                    'Asesoría genética'
                ]
            },
            {
                id: 'riesgo-cardiovascular',
                nombre: 'Riesgo Cardiovascular (Familiar)',
                descripcion: 'Antecedentes familiares de infartos',
                icono: '❤️‍🩹',
                color: '#EF4444',
                miembros: parseInt(antecedentes.riesgo_cardiovascular),
                porcentaje: ((parseInt(antecedentes.riesgo_cardiovascular) / parseInt(condiciones.total_miembros)) * 100).toFixed(2),
                categoria: 'riesgo',
                prioridad: 'alta',
                recomendaciones: [
                    'Control lipídico',
                    'Ejercicio cardiovascular',
                    'Dieta cardio-saludable'
                ]
            }
        ];

        // Ordenar por número de miembros (descendente)
        perfiles.sort((a, b) => b.miembros - a.miembros);

        res.json({
            success: true,
            data: {
                total_miembros: parseInt(condiciones.total_miembros),
                total_perfiles: perfiles.length,
                perfiles: perfiles,
                resumen: {
                    condiciones: parseInt(condiciones.fumadores) + parseInt(condiciones.hipertension) + parseInt(condiciones.diabetes),
                    sintomas: parseInt(condiciones.dolor_cabeza) + parseInt(condiciones.dolor_espalda),
                    riesgos: parseInt(antecedentes.riesgo_hipertension) + parseInt(antecedentes.riesgo_cancer),
                    estilo_vida: parseInt(condiciones.sedentarios) + parseInt(condiciones.sobrepeso)
                }
            }
        });

    } catch (error) {
        console.error('❌ Error generando perfiles:', error);
        res.status(500).json({
            success: false,
            message: 'Error al generar perfiles de salud',
            error: error.message
        });
    }
});

// GET /perfiles/:id/miembros - Obtener lista de miembros de un perfil
router.get('/perfiles/:id/miembros', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { limit = 100, offset = 0, fechaDesde, fechaHasta } = req.query;

        let dateFilter = '';
        const dateParams = [];

        if (fechaDesde) {
            dateParams.push(fechaDesde);
            dateFilter += ` AND fecha_registro >= $${dateParams.length}`;
        }
        if (fechaHasta) {
            dateParams.push(fechaHasta + ' 23:59:59');
            dateFilter += ` AND fecha_registro <= $${dateParams.length}`;
        }

        let condicion = '';

        // Mapeo de perfiles a condiciones SQL
        switch(id) {
            case 'fumadores':
                condicion = "fuma = 'SI'";
                break;
            case 'dolor-espalda':
                condicion = "dolor_espalda = 'SI'";
                break;
            case 'dolor-cabeza':
                condicion = "dolor_cabeza = 'SI'";
                break;
            case 'hipertension':
                condicion = "presion_alta = 'SI'";
                break;
            case 'diabetes':
                condicion = "problemas_azucar = 'SI'";
                break;
            case 'sedentarios':
                condicion = "ejercicio IN ('Nunca', 'Ocasionalmente')";
                break;
            case 'sobrepeso':
                condicion = "peso > 0 AND estatura ~ '^[0-9]+(\\\\.[0-9]+)?$' AND estatura::numeric > 0 AND (peso / ((estatura::numeric / 100) * (estatura::numeric / 100))) >= 25";
                break;
            case 'problemas-sueno':
                condicion = "problemas_sueno = 'SI'";
                break;
            case 'salud-mental':
                condicion = "trastorno_psicologico = 'SI'";
                break;
            case 'riesgo-hipertension':
                condicion = "familia_hipertension = 'SI'";
                break;
            case 'riesgo-cancer':
                condicion = "familia_cancer = 'SI'";
                break;
            case 'riesgo-cardiovascular':
                condicion = "familia_infartos = 'SI'";
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Perfil no válido'
                });
        }

        const limitParamIndex = dateParams.length + 1;
        const offsetParamIndex = dateParams.length + 2;

        const query = `
            SELECT
                numero_id,
                primer_nombre,
                primer_apellido,
                genero,
                edad,
                celular,
                email,
                empresa,
                cod_empresa,
                fecha_registro
            FROM formularios
            WHERE ${condicion}${dateFilter}
            ORDER BY fecha_registro DESC
            LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
        `;

        const countQuery = `
            SELECT COUNT(*) as total
            FROM formularios
            WHERE ${condicion}${dateFilter}
        `;

        const [miembrosResult, countResult] = await Promise.all([
            pool.query(query, [...dateParams, limit, offset]),
            pool.query(countQuery, dateParams)
        ]);

        res.json({
            success: true,
            data: {
                perfil_id: id,
                total: parseInt(countResult.rows[0].total),
                limit: parseInt(limit),
                offset: parseInt(offset),
                miembros: miembrosResult.rows
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo miembros del perfil:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener miembros del perfil',
            error: error.message
        });
    }
});

// POST /whatsapp/enviar - Enviar mensaje masivo a perfil de salud
router.post('/whatsapp/enviar', authMiddleware, async (req, res) => {
    try {
        const { perfilId, mensaje, tipo } = req.body;

        if (!perfilId || !mensaje) {
            return res.status(400).json({
                success: false,
                message: 'Faltan datos requeridos (perfilId, mensaje)'
            });
        }

        // Obtener miembros del perfil con números de celular válidos
        let condicion = '';

        // Mapeo de perfiles a condiciones SQL (mismo que endpoint de miembros)
        switch(perfilId) {
            case 'fumadores':
                condicion = "fuma = 'SI'";
                break;
            case 'dolor-espalda':
                condicion = "dolor_espalda = 'SI'";
                break;
            case 'dolor-cabeza':
                condicion = "dolor_cabeza = 'SI'";
                break;
            case 'hipertension':
                condicion = "presion_alta = 'SI'";
                break;
            case 'diabetes':
                condicion = "problemas_azucar = 'SI'";
                break;
            case 'sedentarios':
                condicion = "ejercicio IN ('Nunca', 'Ocasionalmente')";
                break;
            case 'sobrepeso':
                condicion = "peso > 0 AND estatura ~ '^[0-9]+(\\\\.[0-9]+)?$' AND estatura::numeric > 0 AND (peso / ((estatura::numeric / 100) * (estatura::numeric / 100))) >= 25";
                break;
            case 'problemas-sueno':
                condicion = "problemas_sueno = 'SI'";
                break;
            case 'salud-mental':
                condicion = "trastorno_psicologico = 'SI'";
                break;
            case 'riesgo-hipertension':
                condicion = "familia_hipertension = 'SI'";
                break;
            case 'riesgo-cancer':
                condicion = "familia_cancer = 'SI'";
                break;
            case 'riesgo-cardiovascular':
                condicion = "familia_infartos = 'SI'";
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Perfil no válido'
                });
        }

        const query = `
            SELECT
                numero_id,
                primer_nombre,
                primer_apellido,
                celular,
                empresa
            FROM formularios
            WHERE ${condicion}
            AND celular IS NOT NULL
            AND celular != ''
            AND LENGTH(celular) >= 10
            ORDER BY fecha_registro DESC
        `;

        const result = await pool.query(query);
        const destinatarios = result.rows;

        console.log(`📤 Preparando envío de WhatsApp a ${destinatarios.length} destinatarios`);

        // Guardar campaña en base de datos
        const insertQuery = `
            INSERT INTO whatsapp_campanas (perfil_id, mensaje, tipo, total_destinatarios, estado, fecha_creacion, usuario_id)
            VALUES ($1, $2, $3, $4, 'pendiente', NOW(), $5)
            RETURNING id
        `;

        const campanaResult = await pool.query(insertQuery, [
            perfilId,
            mensaje,
            tipo || 'custom',
            destinatarios.length,
            req.usuario.id
        ]);

        const campanaId = campanaResult.rows[0].id;

        // TODO: Integración real con WhatsApp Business API
        // Por ahora simulamos el envío exitoso
        // En producción, aquí iría la lógica de envío a través de WhatsApp Business API

        // Simular envío y actualizar estado
        setTimeout(async () => {
            try {
                await pool.query(`
                    UPDATE whatsapp_campanas
                    SET estado = 'completado', fecha_completado = NOW()
                    WHERE id = $1
                `, [campanaId]);
                console.log(`✅ Campaña ${campanaId} marcada como completada`);
            } catch (error) {
                console.error('Error actualizando campaña:', error);
            }
        }, 2000);

        res.json({
            success: true,
            message: 'Mensaje en proceso de envío',
            data: {
                campanaId: campanaId,
                enviados: destinatarios.length,
                perfilId: perfilId
            }
        });

    } catch (error) {
        console.error('❌ Error enviando mensaje WhatsApp:', error);
        res.status(500).json({
            success: false,
            message: 'Error al enviar mensaje',
            error: error.message
        });
    }
});

// GET /whatsapp/historial - Obtener historial de campañas WhatsApp
router.get('/whatsapp/historial', authMiddleware, async (req, res) => {
    try {
        const { limit = 20 } = req.query;

        const query = `
            SELECT
                wc.id,
                wc.perfil_id,
                wc.mensaje,
                wc.tipo,
                wc.total_destinatarios,
                wc.estado,
                wc.fecha_creacion,
                wc.fecha_completado,
                u.nombre_completo as usuario
            FROM whatsapp_campanas wc
            LEFT JOIN usuarios u ON wc.usuario_id = u.id
            ORDER BY wc.fecha_creacion DESC
            LIMIT $1
        `;

        const result = await pool.query(query, [limit]);

        // Mapear perfiles a iconos
        const perfilIcons = {
            'fumadores': '🚬',
            'dolor-espalda': '🦴',
            'dolor-cabeza': '🤕',
            'hipertension': '💔',
            'diabetes': '🩸',
            'sedentarios': '🪑',
            'sobrepeso': '⚖️',
            'problemas-sueno': '😴',
            'salud-mental': '🧠',
            'riesgo-hipertension': '🧬',
            'riesgo-cancer': '🎗️',
            'riesgo-cardiovascular': '❤️'
        };

        const perfilNames = {
            'fumadores': 'Fumadores',
            'dolor-espalda': 'Dolor de Espalda',
            'dolor-cabeza': 'Cefaleas/Migrañas',
            'hipertension': 'Hipertensión',
            'diabetes': 'Diabetes',
            'sedentarios': 'Sedentarios',
            'sobrepeso': 'Sobrepeso',
            'problemas-sueno': 'Problemas de Sueño',
            'salud-mental': 'Salud Mental',
            'riesgo-hipertension': 'Riesgo Hipertensión',
            'riesgo-cancer': 'Riesgo Cáncer',
            'riesgo-cardiovascular': 'Riesgo Cardiovascular'
        };

        const historial = result.rows.map(row => ({
            id: row.id,
            perfil: perfilNames[row.perfil_id] || row.perfil_id,
            icono: perfilIcons[row.perfil_id] || '📊',
            mensaje: row.mensaje,
            tipo: row.tipo,
            enviados: row.total_destinatarios,
            estado: row.estado,
            fecha: new Date(row.fecha_creacion).toLocaleString('es-CO', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }),
            usuario: row.usuario
        }));

        res.json({
            success: true,
            data: historial
        });

    } catch (error) {
        console.error('❌ Error obteniendo historial WhatsApp:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener historial',
            error: error.message
        });
    }
});

// GET /contenido/biblioteca - Obtener biblioteca de contenido
router.get('/contenido/biblioteca', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id, titulo, categoria, contenido, perfiles,
                lecturas, rating, fecha_creacion
            FROM contenido_educativo
            ORDER BY lecturas DESC
        `);

        const contenido = result.rows.map(row => ({
            ...row,
            perfiles: Array.isArray(row.perfiles) ? row.perfiles : JSON.parse(row.perfiles || '[]')
        }));

        res.json({
            success: true,
            data: contenido,
            stats: {
                total: contenido.length,
                lecturas_totales: contenido.reduce((sum, c) => sum + (c.lecturas || 0), 0)
            }
        });
    } catch (error) {
        console.error('Error obteniendo biblioteca:', error);
        res.status(500).json({ success: false, message: 'Error al obtener biblioteca' });
    }
});

// GET /contenido/campanas - Obtener campañas de contenido
router.get('/contenido/campanas', authMiddleware, async (req, res) => {
    try {
        // Datos de ejemplo (en producción vendría de BD)
        const campanas = [
            {
                id: 1,
                nombre: 'Tips Semanales para Fumadores',
                descripcion: 'Consejos y motivación para dejar de fumar',
                frecuencia: 'Semanal (Lunes)',
                perfiles: ['fumadores'],
                estado: 'activa',
                envios_totales: 48
            },
            {
                id: 2,
                nombre: 'Nutrición para Diabéticos',
                descripcion: 'Recetas y guías nutricionales',
                frecuencia: 'Quincenal',
                perfiles: ['diabetes', 'sobrepeso'],
                estado: 'activa',
                envios_totales: 24
            },
            {
                id: 3,
                nombre: 'Ejercicios Preventivos',
                descripcion: 'Rutinas de ejercicio adaptadas',
                frecuencia: 'Semanal (Miércoles)',
                perfiles: ['sedentarios', 'dolor-espalda'],
                estado: 'pausada',
                envios_totales: 36
            }
        ];

        res.json({ success: true, data: campanas });
    } catch (error) {
        console.error('Error obteniendo campañas:', error);
        res.status(500).json({ success: false, message: 'Error al obtener campañas' });
    }
});

// POST /contenido/crear - Crear nuevo contenido
router.post('/contenido/crear', authMiddleware, async (req, res) => {
    try {
        const { titulo, categoria, contenido, perfiles } = req.body;

        if (!titulo || !contenido || !perfiles || perfiles.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos requeridos'
            });
        }

        const result = await pool.query(`
            INSERT INTO contenido_educativo (titulo, categoria, contenido, perfiles)
            VALUES ($1, $2, $3, $4)
            RETURNING id
        `, [titulo, categoria, contenido, JSON.stringify(perfiles)]);

        res.json({
            success: true,
            message: 'Contenido creado exitosamente',
            data: { id: result.rows[0].id }
        });
    } catch (error) {
        console.error('Error creando contenido:', error);
        res.status(500).json({ success: false, message: 'Error al crear contenido' });
    }
});

console.log('✅ Endpoints Comunidad de Salud configurados');

module.exports = router;
