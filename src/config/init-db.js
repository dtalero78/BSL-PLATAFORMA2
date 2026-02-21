const pool = require('./database');

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
            'enfermedad_autoinmune VARCHAR(10)',
            // Timestamp columns
            'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
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

        // Aumentar tamaño de columnas eps, arl, pensiones a VARCHAR(150)
        const columnsToResize = ['eps', 'arl', 'pensiones'];
        for (const col of columnsToResize) {
            try {
                await pool.query(`
                    ALTER TABLE formularios
                    ALTER COLUMN ${col} TYPE VARCHAR(150)
                `);
            } catch (err) {
                // Columna no existe o ya tiene el tipo correcto
            }
        }

        // Asegurar que foto_url sea TEXT para URLs largas
        try {
            await pool.query(`
                ALTER TABLE formularios
                ADD COLUMN IF NOT EXISTS foto_url TEXT
            `);
        } catch (err) {
            // Columna ya existe
        }
        try {
            await pool.query(`
                ALTER TABLE formularios
                ALTER COLUMN foto_url TYPE TEXT
            `);
        } catch (err) {
            // Ya es TEXT o error
        }

        // Aumentar tamaño de campos de texto que pueden ser largos
        const textFieldsToEnlarge = ['ejercicio', 'consumo_licor', 'estado_civil', 'nivel_educativo'];
        for (const col of textFieldsToEnlarge) {
            try {
                await pool.query(`
                    ALTER TABLE formularios
                    ALTER COLUMN ${col} TYPE VARCHAR(100)
                `);
            } catch (err) {
                // Columna no existe o ya tiene el tipo correcto
            }
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

        // Agregar columna subempresa a HistoriaClinica si no existe
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS subempresa VARCHAR(200)
            `);
        } catch (err) {
            // Columna ya existe o tabla no existe
        }

        // Agregar columna centro_de_costo a HistoriaClinica si no existe
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS centro_de_costo VARCHAR(200)
            `);
        } catch (err) {
            // Columna ya existe o tabla no existe
        }

        // Agregar columna aprobacion a HistoriaClinica si no existe (para perfil APROBADOR)
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS aprobacion VARCHAR(20)
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

        // Eliminar constraint UNIQUE para permitir múltiples rangos horarios por día
        try {
            await pool.query(`
                ALTER TABLE medicos_disponibilidad
                DROP CONSTRAINT IF EXISTS medicos_disponibilidad_medico_id_dia_semana_modalidad_key
            `);
        } catch (err) {
            // Constraint no existe o ya fue eliminada
        }

        // Crear tabla audiometrias si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS audiometrias (
                id SERIAL PRIMARY KEY,
                orden_id VARCHAR(100) REFERENCES "HistoriaClinica"("_id") ON DELETE CASCADE,
                numero_id VARCHAR(50),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),

                -- Otoscopia
                pabellon_auricular_oi VARCHAR(50) DEFAULT 'NORMAL',
                pabellon_auricular_od VARCHAR(50) DEFAULT 'NORMAL',
                conducto_auditivo_oi VARCHAR(50) DEFAULT 'NORMAL',
                conducto_auditivo_od VARCHAR(50) DEFAULT 'NORMAL',
                membrana_timpanica_oi VARCHAR(50) DEFAULT 'NORMAL',
                membrana_timpanica_od VARCHAR(50) DEFAULT 'NORMAL',
                observaciones_oi TEXT,
                observaciones_od TEXT,
                requiere_limpieza_otica VARCHAR(10) DEFAULT 'NO',
                estado_gripal VARCHAR(10) DEFAULT 'NO',

                -- Resultado Aéreo - Oído Derecho
                aereo_od_250 INTEGER,
                aereo_od_500 INTEGER,
                aereo_od_1000 INTEGER,
                aereo_od_2000 INTEGER,
                aereo_od_3000 INTEGER,
                aereo_od_4000 INTEGER,
                aereo_od_6000 INTEGER,
                aereo_od_8000 INTEGER,

                -- Resultado Aéreo - Oído Izquierdo
                aereo_oi_250 INTEGER,
                aereo_oi_500 INTEGER,
                aereo_oi_1000 INTEGER,
                aereo_oi_2000 INTEGER,
                aereo_oi_3000 INTEGER,
                aereo_oi_4000 INTEGER,
                aereo_oi_6000 INTEGER,
                aereo_oi_8000 INTEGER,

                -- Resultado Óseo - Oído Derecho (opcional)
                oseo_od_250 INTEGER,
                oseo_od_500 INTEGER,
                oseo_od_1000 INTEGER,
                oseo_od_2000 INTEGER,
                oseo_od_3000 INTEGER,
                oseo_od_4000 INTEGER,

                -- Resultado Óseo - Oído Izquierdo (opcional)
                oseo_oi_250 INTEGER,
                oseo_oi_500 INTEGER,
                oseo_oi_1000 INTEGER,
                oseo_oi_2000 INTEGER,
                oseo_oi_3000 INTEGER,
                oseo_oi_4000 INTEGER,

                -- Equipo y cabina
                cabina VARCHAR(50),
                equipo VARCHAR(100),

                -- Diagnóstico
                diagnostico_oi VARCHAR(100),
                diagnostico_od VARCHAR(100),
                interpretacion TEXT,
                recomendaciones TEXT,
                remision VARCHAR(100),

                -- Metadatos
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Crear tabla visiometrias si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS visiometrias (
                id SERIAL PRIMARY KEY,
                orden_id VARCHAR(100) REFERENCES "HistoriaClinica"("_id") ON DELETE CASCADE,
                numero_id VARCHAR(50),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),

                -- Visión Lejana - Ojo Derecho
                vl_od_sin_correccion VARCHAR(20),
                vl_od_con_correccion VARCHAR(20),

                -- Visión Lejana - Ojo Izquierdo
                vl_oi_sin_correccion VARCHAR(20),
                vl_oi_con_correccion VARCHAR(20),

                -- Visión Lejana - Ambos Ojos
                vl_ao_sin_correccion VARCHAR(20),
                vl_ao_con_correccion VARCHAR(20),

                -- Enceguecimiento y Forias (Visión Lejana)
                vl_foria_lateral VARCHAR(50),
                vl_foria_vertical VARCHAR(50),

                -- Visión Cercana - Ojo Derecho
                vc_od_sin_correccion VARCHAR(20),
                vc_od_con_correccion VARCHAR(20),

                -- Visión Cercana - Ojo Izquierdo
                vc_oi_sin_correccion VARCHAR(20),
                vc_oi_con_correccion VARCHAR(20),

                -- Visión Cercana - Ambos Ojos
                vc_ao_sin_correccion VARCHAR(20),
                vc_ao_con_correccion VARCHAR(20),

                -- Forias y Campimetría (Visión Cercana)
                vc_foria_lateral VARCHAR(50),
                vc_campimetria VARCHAR(50),

                -- Ishihara y PPC
                ishihara VARCHAR(50),
                ppc VARCHAR(50),

                -- Visión Cromática
                vision_cromatica VARCHAR(50),

                -- Enceguecimiento
                enceguecimiento VARCHAR(10),

                -- Estado Fórico
                estado_forico VARCHAR(50),

                -- Cover Test
                cover_test_lejos VARCHAR(100),
                cover_test_cerca VARCHAR(100),

                -- Queratometría
                queratometria_od TEXT,
                queratometria_oi TEXT,

                -- Examen Externo
                examen_externo TEXT,

                -- Oftalmoscopia
                oftalmoscopia_od VARCHAR(50),
                oftalmoscopia_oi VARCHAR(50),

                -- Biomicroscopia
                biomicroscopia_od VARCHAR(50),
                biomicroscopia_oi VARCHAR(50),

                -- Tonometría
                tonometria_od VARCHAR(50),
                tonometria_oi VARCHAR(50),

                -- Rx en Uso
                rx_en_uso VARCHAR(10) DEFAULT 'NO',

                -- Refractometría
                refractometria_od VARCHAR(50),
                refractometria_oi VARCHAR(50),

                -- Subjetivo
                subjetivo_od VARCHAR(50),
                subjetivo_oi VARCHAR(50),

                -- Rx Final
                rx_final_od VARCHAR(50),
                rx_final_oi VARCHAR(50),

                -- DIP y Filtro
                dip VARCHAR(20),
                filtro VARCHAR(50),
                uso VARCHAR(50),

                -- Diagnóstico
                diagnostico VARCHAR(100),
                remision VARCHAR(50),

                -- Control y DX
                control VARCHAR(50),
                dx2 TEXT,
                dx3 TEXT,

                -- Observaciones
                observaciones TEXT,

                -- Metadatos
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Crear tabla pruebasADC si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "pruebasADC" (
                id SERIAL PRIMARY KEY,
                orden_id VARCHAR(100) REFERENCES "HistoriaClinica"("_id") ON DELETE CASCADE,
                numero_id VARCHAR(50),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),

                -- Preguntas de Depresión (de*)
                de08 VARCHAR(50),
                de29 VARCHAR(50),
                de03 VARCHAR(50),
                de04 VARCHAR(50),
                de05 VARCHAR(50),
                de32 VARCHAR(50),
                de12 VARCHAR(50),
                de06 VARCHAR(50),
                de33 VARCHAR(50),
                de13 VARCHAR(50),
                de07 VARCHAR(50),
                de35 VARCHAR(50),
                de21 VARCHAR(50),
                de14 VARCHAR(50),
                de15 VARCHAR(50),
                de37 VARCHAR(50),
                de16 VARCHAR(50),
                de38 VARCHAR(50),
                de40 VARCHAR(50),
                de27 VARCHAR(50),
                de20 VARCHAR(50),

                -- Preguntas de Ansiedad (an*)
                an07 VARCHAR(50),
                an11 VARCHAR(50),
                an03 VARCHAR(50),
                an18 VARCHAR(50),
                an19 VARCHAR(50),
                an04 VARCHAR(50),
                an14 VARCHAR(50),
                an09 VARCHAR(50),
                an20 VARCHAR(50),
                an05 VARCHAR(50),
                an36 VARCHAR(50),
                an26 VARCHAR(50),
                an31 VARCHAR(50),
                an22 VARCHAR(50),
                an38 VARCHAR(50),
                an27 VARCHAR(50),
                an35 VARCHAR(50),
                an23 VARCHAR(50),
                an39 VARCHAR(50),
                an30 VARCHAR(50),

                -- Preguntas de Comportamiento (co*)
                cofv01 VARCHAR(50),
                corv11 VARCHAR(50),
                cofc06 VARCHAR(50),
                coav21 VARCHAR(50),
                coov32 VARCHAR(50),
                corc16 VARCHAR(50),
                coac26 VARCHAR(50),
                cofv02 VARCHAR(50),
                coov34 VARCHAR(50),
                cofv03 VARCHAR(50),
                corc17 VARCHAR(50),
                coac27 VARCHAR(50),
                cofc08 VARCHAR(50),
                cooc39 VARCHAR(50),
                cofc10 VARCHAR(50),
                corv12 VARCHAR(50),
                cooc40 VARCHAR(50),
                corv15 VARCHAR(50),
                coac29 VARCHAR(50),
                coov35 VARCHAR(50),
                coav24 VARCHAR(50),
                corc18 VARCHAR(50),
                coav25 VARCHAR(50),

                -- Metadatos
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Crear tabla scl90 si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS scl90 (
                id SERIAL PRIMARY KEY,
                orden_id VARCHAR(100) REFERENCES "HistoriaClinica"("_id") ON DELETE CASCADE,
                numero_id VARCHAR(50),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),

                -- Items SCL-90 (90 preguntas, valores 0-4)
                item1 VARCHAR(20), item2 VARCHAR(20), item3 VARCHAR(20), item4 VARCHAR(20), item5 VARCHAR(20),
                item6 VARCHAR(20), item7 VARCHAR(20), item8 VARCHAR(20), item9 VARCHAR(20), item10 VARCHAR(20),
                item11 VARCHAR(20), item12 VARCHAR(20), item13 VARCHAR(20), item14 VARCHAR(20), item15 VARCHAR(20),
                item16 VARCHAR(20), item17 VARCHAR(20), item18 VARCHAR(20), item19 VARCHAR(20), item20 VARCHAR(20),
                item21 VARCHAR(20), item22 VARCHAR(20), item23 VARCHAR(20), item24 VARCHAR(20), item25 VARCHAR(20),
                item26 VARCHAR(20), item27 VARCHAR(20), item28 VARCHAR(20), item29 VARCHAR(20), item30 VARCHAR(20),
                item31 VARCHAR(20), item32 VARCHAR(20), item33 VARCHAR(20), item34 VARCHAR(20), item35 VARCHAR(20),
                item36 VARCHAR(20), item37 VARCHAR(20), item38 VARCHAR(20), item39 VARCHAR(20), item40 VARCHAR(20),
                item41 VARCHAR(20), item42 VARCHAR(20), item43 VARCHAR(20), item44 VARCHAR(20), item45 VARCHAR(20),
                item46 VARCHAR(20), item47 VARCHAR(20), item48 VARCHAR(20), item49 VARCHAR(20), item50 VARCHAR(20),
                item51 VARCHAR(20), item52 VARCHAR(20), item53 VARCHAR(20), item54 VARCHAR(20), item55 VARCHAR(20),
                item56 VARCHAR(20), item57 VARCHAR(20), item58 VARCHAR(20), item59 VARCHAR(20), item60 VARCHAR(20),
                item61 VARCHAR(20), item62 VARCHAR(20), item63 VARCHAR(20), item64 VARCHAR(20), item65 VARCHAR(20),
                item66 VARCHAR(20), item67 VARCHAR(20), item68 VARCHAR(20), item69 VARCHAR(20), item70 VARCHAR(20),
                item71 VARCHAR(20), item72 VARCHAR(20), item73 VARCHAR(20), item74 VARCHAR(20), item75 VARCHAR(20),
                item76 VARCHAR(20), item77 VARCHAR(20), item78 VARCHAR(20), item79 VARCHAR(20), item80 VARCHAR(20),
                item81 VARCHAR(20), item82 VARCHAR(20), item83 VARCHAR(20), item84 VARCHAR(20), item85 VARCHAR(20),
                item86 VARCHAR(20), item87 VARCHAR(20), item88 VARCHAR(20), item89 VARCHAR(20), item90 VARCHAR(20),

                -- Resultados calculados
                genero VARCHAR(20),
                resultado JSONB,
                interpretacion JSONB,
                baremos JSONB,

                -- Metadatos
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migrar columnas nuevas scl90 (para tablas existentes)
        const columnasScl90 = [
            { name: 'genero', type: 'VARCHAR(20)' },
            { name: 'resultado', type: 'JSONB' },
            { name: 'interpretacion', type: 'JSONB' },
            { name: 'baremos', type: 'JSONB' }
        ];
        for (const col of columnasScl90) {
            await pool.query(`ALTER TABLE scl90 ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
        }

        // Crear tabla visiometrias_virtual si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS visiometrias_virtual (
                id SERIAL PRIMARY KEY,
                orden_id VARCHAR(100) REFERENCES "HistoriaClinica"("_id") ON DELETE CASCADE,
                numero_id VARCHAR(50),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),

                -- Resultados Test Snellen (Letras)
                snellen_correctas INTEGER,
                snellen_total INTEGER,
                snellen_porcentaje INTEGER,

                -- Resultados Test Landolt C (Dirección)
                landolt_correctas INTEGER,
                landolt_total INTEGER,
                landolt_porcentaje INTEGER,

                -- Resultados Test Ishihara (Colores)
                ishihara_correctas INTEGER,
                ishihara_total INTEGER,
                ishihara_porcentaje INTEGER,

                -- Concepto general
                concepto VARCHAR(50),

                -- Metadatos
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT unique_visiometria_virtual_orden UNIQUE (orden_id)
            )
        `);

        // Crear tabla laboratorios si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS laboratorios (
                id SERIAL PRIMARY KEY,
                orden_id VARCHAR(100) REFERENCES "HistoriaClinica"("_id") ON DELETE CASCADE,
                numero_id VARCHAR(50),
                primer_nombre VARCHAR(100),
                primer_apellido VARCHAR(100),
                empresa VARCHAR(100),
                cod_empresa VARCHAR(50),

                -- Tipo de prueba: 'CUADRO_HEMATICO', 'COPROLOGICO', 'PERFIL_LIPIDICO', 'KOH'
                tipo_prueba VARCHAR(50) NOT NULL,

                -- CUADRO HEMÁTICO (HEMOGRAMA)
                hematocrito VARCHAR(50),
                hemoglobina VARCHAR(50),
                conc_corpus_hb VARCHAR(50),
                plaquetas VARCHAR(50),
                sedimentacio_globular VARCHAR(50),
                globulos_blancos VARCHAR(50),
                neutrofilos VARCHAR(50),
                linfocitos VARCHAR(50),
                monocitos VARCHAR(50),
                basofilos VARCHAR(50),
                eosinofilos VARCHAR(50),
                cayados VARCHAR(50),
                observaciones_hemograma TEXT,

                -- COPROLÓGICO
                consistencia VARCHAR(50),
                color VARCHAR(50),
                olor VARCHAR(50),
                moco VARCHAR(50),
                sangre VARCHAR(50),
                parasitologico VARCHAR(50),
                observaciones_coprologico TEXT,
                vegetales VARCHAR(100),
                musculares VARCHAR(100),
                celulosa VARCHAR(100),
                almidones VARCHAR(100),
                levaduras VARCHAR(100),
                hongos VARCHAR(100),
                neutras VARCHAR(100),
                hominis VARCHAR(100),
                leucocitos VARCHAR(100),
                bacteriana VARCHAR(100),

                -- PERFIL LIPÍDICO + QUÍMICA
                glicemia_pre VARCHAR(50),
                glicemia_post VARCHAR(50),
                tsh VARCHAR(50),
                colesterol_total VARCHAR(50),
                colesterol_hdl VARCHAR(50),
                colesterol_ldl VARCHAR(50),
                trigliceridos VARCHAR(50),
                transaminasa_gpt VARCHAR(50),
                transaminasa_got VARCHAR(50),
                bilirrubina_directa VARCHAR(50),
                bilirrubina_indirecta VARCHAR(50),
                bilirrubina_total VARCHAR(50),
                nitrogeno_ureico_bun VARCHAR(50),
                creatinina_en_suero VARCHAR(50),
                colinesterasa VARCHAR(50),
                quimica_observaciones TEXT,
                fosfatasa_alcalina VARCHAR(50),

                -- INMUNOLOGÍA
                grupo_sanguineo VARCHAR(20),
                factor_rh VARCHAR(20),
                inmunologia_observaciones TEXT,
                serologia_vdrl VARCHAR(50),
                serologia_cuantitativa VARCHAR(50),
                como_reporto_a_la_empresa TEXT,

                -- MICROBIOLOGÍA
                frotis_faringeo VARCHAR(100),
                koh_en_unas VARCHAR(100),
                cultivo_faringeo VARCHAR(100),
                frotis_naso_derecha VARCHAR(100),
                frotis_naso_izquierda VARCHAR(100),
                microbiologia_observaciones TEXT,
                coprocultivo VARCHAR(100),
                leptospira VARCHAR(100),
                baciloscopia VARCHAR(100),

                -- TOXICOLOGÍA
                alcohol_aire_respirado VARCHAR(100),
                marihuana_orina VARCHAR(100),
                morfina VARCHAR(100),
                cocaina VARCHAR(100),
                metanfetaminas VARCHAR(100),
                alcohol_saliva VARCHAR(100),
                anfetaminas VARCHAR(100),
                alcohol_sangre VARCHAR(100),
                toxicologia_observaciones TEXT,

                -- Metadatos
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by VARCHAR(100),
                updated_by VARCHAR(100)
            )
        `);

        // Crear índice para búsquedas rápidas de laboratorios
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_laboratorios_orden_id ON laboratorios(orden_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_laboratorios_numero_id ON laboratorios(numero_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_laboratorios_tipo_prueba ON laboratorios(tipo_prueba)`);
        } catch (err) {
            // Índices ya existen
        }

        // Crear tabla de usuarios para autenticación
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                numero_documento VARCHAR(50) UNIQUE NOT NULL,
                celular_whatsapp VARCHAR(20) NOT NULL,
                nombre_completo VARCHAR(200),
                nombre_empresa VARCHAR(200),
                rol VARCHAR(20) DEFAULT 'empresa' CHECK (rol IN ('empresa', 'admin', 'empleado')),
                cod_empresa VARCHAR(50),
                estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'suspendido')),
                fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_aprobacion TIMESTAMP,
                aprobado_por INTEGER REFERENCES usuarios(id),
                ultimo_login TIMESTAMP,
                activo BOOLEAN DEFAULT true
            )
        `);

        // Crear índices para usuarios
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_documento ON usuarios(numero_documento)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_estado ON usuarios(estado)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios(rol)`);
        } catch (err) {
            // Índices ya existen
        }

        // Migración: agregar columna nombre_empresa si no existe
        try {
            await pool.query(`
                ALTER TABLE usuarios
                ADD COLUMN IF NOT EXISTS nombre_empresa VARCHAR(200)
            `);
        } catch (err) {
            // Columna ya existe
        }

        // Migración: actualizar constraint de rol para incluir 'empleado'
        try {
            await pool.query(`
                ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check
            `);
            await pool.query(`
                ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
                CHECK (rol IN ('empresa', 'admin', 'empleado', 'usuario_ips'))
            `);
        } catch (err) {
            // Constraint ya actualizada o no existe
        }

        // Migración: agregar columna empresas_excluidas para empleados
        try {
            await pool.query(`
                ALTER TABLE usuarios
                ADD COLUMN IF NOT EXISTS empresas_excluidas JSONB DEFAULT '[]'::jsonb
            `);
        } catch (err) {
            // Columna ya existe
        }

        // Crear tabla de sesiones
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sesiones (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
                token_hash VARCHAR(255) UNIQUE NOT NULL,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_expiracion TIMESTAMP NOT NULL,
                activa BOOLEAN DEFAULT true
            )
        `);

        // Crear índices para sesiones
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_sesiones_token ON sesiones(token_hash)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_sesiones_expiracion ON sesiones(fecha_expiracion)`);
        } catch (err) {
            // Índices ya existen
        }

        // Crear tabla de permisos de usuario
        await pool.query(`
            CREATE TABLE IF NOT EXISTS permisos_usuario (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
                permiso VARCHAR(50) NOT NULL,
                activo BOOLEAN DEFAULT true,
                fecha_asignacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                asignado_por INTEGER REFERENCES usuarios(id),
                UNIQUE(usuario_id, permiso)
            )
        `);

        // Crear índice para permisos
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_permisos_usuario ON permisos_usuario(usuario_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_permisos_permiso ON permisos_usuario(permiso)`);
        } catch (err) {
            // Índices ya existen
        }

        // ==================== TABLAS SISTEMA MULTI-AGENTE WHATSAPP ====================

        // Tabla de conversaciones de WhatsApp
        await pool.query(`
            CREATE TABLE IF NOT EXISTS conversaciones_whatsapp (
                id SERIAL PRIMARY KEY,
                celular VARCHAR(20) NOT NULL,
                paciente_id VARCHAR(100),
                asignado_a INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                estado VARCHAR(20) NOT NULL DEFAULT 'nueva',
                canal VARCHAR(10) NOT NULL DEFAULT 'bot',
                bot_activo BOOLEAN NOT NULL DEFAULT true,
                nivel_bot INTEGER DEFAULT 0,
                nombre_paciente VARCHAR(200),
                etiquetas TEXT[],
                prioridad VARCHAR(10) DEFAULT 'normal',
                fecha_inicio TIMESTAMP DEFAULT NOW(),
                fecha_ultima_actividad TIMESTAMP DEFAULT NOW(),
                fecha_asignacion TIMESTAMP,
                fecha_cierre TIMESTAMP,
                wix_chatbot_id VARCHAR(100),
                wix_whp_id VARCHAR(100),
                sincronizado_wix BOOLEAN DEFAULT false
            )
        `);

        // Índices para conversaciones_whatsapp
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_celular ON conversaciones_whatsapp(celular)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_asignado ON conversaciones_whatsapp(asignado_a)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_estado ON conversaciones_whatsapp(estado)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_ultima_actividad ON conversaciones_whatsapp(fecha_ultima_actividad DESC)`);
            await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS unique_celular_activa ON conversaciones_whatsapp(celular) WHERE estado != 'cerrada'`);
        } catch (err) {
            // Índices ya existen
        }

        // Tabla de mensajes de WhatsApp
        await pool.query(`
            CREATE TABLE IF NOT EXISTS mensajes_whatsapp (
                id SERIAL PRIMARY KEY,
                conversacion_id INTEGER NOT NULL REFERENCES conversaciones_whatsapp(id) ON DELETE CASCADE,
                direccion VARCHAR(10) NOT NULL,
                contenido TEXT NOT NULL,
                tipo_mensaje VARCHAR(20) DEFAULT 'text',
                enviado_por_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                enviado_por_tipo VARCHAR(10),
                sid_twilio VARCHAR(100),
                timestamp TIMESTAMP DEFAULT NOW(),
                leido_por_agente BOOLEAN DEFAULT false,
                fecha_lectura TIMESTAMP,
                sincronizado_wix BOOLEAN DEFAULT false
            )
        `);

        // Agregar columnas para archivos multimedia si no existen
        try {
            await pool.query(`ALTER TABLE mensajes_whatsapp ADD COLUMN IF NOT EXISTS media_url TEXT`);
            await pool.query(`ALTER TABLE mensajes_whatsapp ADD COLUMN IF NOT EXISTS media_type TEXT`);
        } catch (err) {
            // Columnas ya existen
        }

        // Índices para mensajes_whatsapp
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_msg_conversacion ON mensajes_whatsapp(conversacion_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_msg_timestamp ON mensajes_whatsapp(timestamp DESC)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_msg_no_leido ON mensajes_whatsapp(conversacion_id, leido_por_agente) WHERE leido_por_agente = false`);
        } catch (err) {
            // Índices ya existen
        }

        // Tabla de estado de agentes
        await pool.query(`
            CREATE TABLE IF NOT EXISTS agentes_estado (
                user_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
                estado VARCHAR(20) NOT NULL DEFAULT 'offline',
                conversaciones_activas INTEGER DEFAULT 0,
                max_conversaciones INTEGER DEFAULT 5,
                ultima_actividad TIMESTAMP DEFAULT NOW(),
                tiempo_sesion_inicio TIMESTAMP,
                auto_asignar BOOLEAN DEFAULT true,
                notificaciones_activas BOOLEAN DEFAULT true,
                notas TEXT,
                CONSTRAINT check_conversaciones CHECK (conversaciones_activas >= 0 AND conversaciones_activas <= max_conversaciones)
            )
        `);

        // Índices para agentes_estado
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_agente_estado ON agentes_estado(estado)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_agente_disponible ON agentes_estado(estado, auto_asignar) WHERE estado = 'disponible' AND auto_asignar = true`);
        } catch (err) {
            // Índices ya existen
        }

        // Tabla de transferencias de conversación
        await pool.query(`
            CREATE TABLE IF NOT EXISTS transferencias_conversacion (
                id SERIAL PRIMARY KEY,
                conversacion_id INTEGER NOT NULL REFERENCES conversaciones_whatsapp(id) ON DELETE CASCADE,
                de_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                a_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                de_canal VARCHAR(10),
                a_canal VARCHAR(10),
                motivo TEXT,
                fecha_transferencia TIMESTAMP DEFAULT NOW()
            )
        `);

        // Índices para transferencias_conversacion
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_transfer_conversacion ON transferencias_conversacion(conversacion_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_transfer_fecha ON transferencias_conversacion(fecha_transferencia DESC)`);
        } catch (err) {
            // Índices ya existen
        }

        // Tabla de reglas de enrutamiento
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reglas_enrutamiento (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(100) NOT NULL,
                descripcion TEXT,
                prioridad INTEGER DEFAULT 0,
                activo BOOLEAN DEFAULT true,
                condiciones JSONB NOT NULL,
                asignar_a VARCHAR(20) NOT NULL,
                agente_especifico_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                etiqueta_auto TEXT,
                prioridad_asignar VARCHAR(10) DEFAULT 'normal',
                creado_por INTEGER REFERENCES usuarios(id),
                fecha_creacion TIMESTAMP DEFAULT NOW(),
                fecha_modificacion TIMESTAMP DEFAULT NOW()
            )
        `);

        // Índices para reglas_enrutamiento
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_reglas_prioridad ON reglas_enrutamiento(prioridad DESC) WHERE activo = true`);
        } catch (err) {
            // Índices ya existen
        }

        console.log('Tablas de sistema multi-agente WhatsApp creadas');

        // Agregar columnas JSONB para configuración de empresas
        const empresasColumnsToAdd = [
            'ciudades JSONB DEFAULT \'[]\'::jsonb',
            'examenes JSONB DEFAULT \'[]\'::jsonb',
            'subempresas JSONB DEFAULT \'[]\'::jsonb',
            'centros_de_costo JSONB DEFAULT \'[]\'::jsonb',
            'cargos JSONB DEFAULT \'[]\'::jsonb'
        ];

        for (const column of empresasColumnsToAdd) {
            try {
                await pool.query(`
                    ALTER TABLE empresas
                    ADD COLUMN IF NOT EXISTS ${column}
                `);
            } catch (err) {
                // Columna ya existe
            }
        }

        // Agregar columna linkEnviado a HistoriaClinica para seguimiento de envíos SIIGO
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS "linkEnviado" VARCHAR(50)
            `);
            console.log('Columna linkEnviado agregada a HistoriaClinica');
        } catch (err) {
            // Columna ya existe o tabla no existe
            console.log('Columna linkEnviado ya existe o tabla HistoriaClinica no encontrada');
        }

        // Agregar columna observaciones_siigo a HistoriaClinica para observaciones de asistencia SIIGO
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS "observaciones_siigo" TEXT
            `);
            console.log('Columna observaciones_siigo agregada a HistoriaClinica');
        } catch (err) {
            console.log('Columna observaciones_siigo ya existe o tabla HistoriaClinica no encontrada');
        }

        // Agregar columna foto_url a HistoriaClinica si no existe
        try {
            await pool.query(`
                ALTER TABLE "HistoriaClinica"
                ADD COLUMN IF NOT EXISTS "foto_url" TEXT
            `);
        } catch (err) {
            // Columna ya existe o tabla no existe
        }

        // Aumentar tamaño de campos de visiometrias que almacenan fórmulas de prescripción
        const visiometriasFieldsToEnlarge = [
            'refractometria_od',
            'refractometria_oi',
            'subjetivo_od',
            'subjetivo_oi',
            'rx_final_od',
            'rx_final_oi',
            'filtro',
            'uso',
            'cover_test_lejos',
            'cover_test_cerca',
            'vl_foria_lateral',
            'vl_foria_vertical',
            'vc_foria_lateral',
            'vc_campimetria'
        ];

        for (const field of visiometriasFieldsToEnlarge) {
            try {
                await pool.query(`
                    ALTER TABLE visiometrias
                    ALTER COLUMN ${field} TYPE VARCHAR(200)
                `);
            } catch (err) {
                // Campo no existe o ya tiene el tipo correcto
            }
        }

        // Aumentar tamaño de campos de audiometrias que almacenan observaciones médicas
        const audiometriasFieldsToEnlarge = [
            'pabellon_auricular_oi',
            'pabellon_auricular_od',
            'conducto_auditivo_oi',
            'conducto_auditivo_od',
            'membrana_timpanica_oi',
            'membrana_timpanica_od',
            'cabina',
            'equipo'
        ];

        for (const field of audiometriasFieldsToEnlarge) {
            try {
                await pool.query(`
                    ALTER TABLE audiometrias
                    ALTER COLUMN ${field} TYPE VARCHAR(200)
                `);
            } catch (err) {
                // Campo no existe o ya tiene el tipo correcto
            }
        }

        // ==================== ELIMINACIÓN DE TRIGGER OBSOLETO ====================
        // IMPORTANTE: La normalización se hace en la aplicación con normalizarTelefonoConPrefijo57()
        // El trigger anterior quitaba el + y causaba duplicados de conversaciones
        try {
            await pool.query(`
                DROP TRIGGER IF EXISTS normalizar_celular_before_insert ON conversaciones_whatsapp;
                DROP FUNCTION IF EXISTS normalizar_celular_whatsapp();
            `);
            console.log('✅ Trigger obsoleto de normalización eliminado (la normalización se hace en app)');
        } catch (err) {
            console.error('⚠️ Error al eliminar trigger obsoleto:', err.message);
        }

        console.log('Base de datos inicializada correctamente');
    } catch (error) {
        console.error('Error al inicializar la base de datos:', error);
    }
};

module.exports = initDB;
