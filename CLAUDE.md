# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BSL Plataforma - Medical occupational health system built with Node.js/Express backend and vanilla JavaScript frontend. The system manages patient medical exams, certifications, and appointments with a dual-database architecture: PostgreSQL for the main platform and Wix CMS as the source of truth for patient records.

## Development Commands

```bash
npm install        # Install dependencies (generates package-lock.json if missing)
npm start          # Start production server (node server.js)
npm run dev        # Start development server with auto-reload (nodemon)
```

Server runs on port 8080 by default (configurable via PORT env var).

## Deployment

The application is deployed to **DigitalOcean App Platform** using Docker.

### Docker Build
- Uses `Dockerfile` with Node.js 20 slim base image
- Installs Chromium and dependencies for Puppeteer (PDF generation)
- Uses `npm ci --omit=dev` for production dependencies
- **CRITICAL**: `package-lock.json` MUST be committed to repository
  - Docker build will fail without it (npm ci requirement)
  - Never add package-lock.json to .gitignore
  - Regenerate with `npm install` if missing

### Environment Variables in DigitalOcean
All required environment variables must be configured in App Platform settings before deployment. Build will fail if critical variables (DB_HOST, DB_PASSWORD, JWT_SECRET) are missing.

## Multi-Tenant Architecture (Active)

The platform runs multi-tenant in production with two live tenants:
- **bsl** — `bsl-plataforma.com` (tenant raíz, legacy, usa todos los módulos BSL-only)
- **ipsVip** — `vip-mediconecta.app` (IPS VIP Mediconecta, administrada por Diego Barragán)

Single app + single DB + single deploy serves all tenants; row-level isolation via `tenant_id` column on every tenant-scoped table. DigitalOcean App Platform maneja multi-domain + SSL nativamente.

### Core principles

1. **BSL debe seguir funcionando exactamente igual** — zero-regression. El default de `tenant_id` es `'bsl'` a nivel de schema y código, así cualquier path legacy sigue apuntando a BSL.
2. **Wix es BSL-only.** Todo código Wix (`src/services/wix-sync.js`, `/api/wix/*`, scripts de migración) va envuelto con `requireBslTenant` o `isBsl(req)`.
3. **Una fila pertenece a un solo tenant.** Las queries DEBEN filtrar por `tenant_id`. El `DEFAULT 'bsl'` del schema es red de seguridad, no sustituto del filtro explícito.
4. **El tenant se resuelve por hostname** vía `src/middleware/tenant.js`, disponible como `req.tenant`. Hostname desconocido → fallback a `'bsl'`.
5. **La BD es la fuente de verdad para `tenant_id`, NO el JWT.** El middleware `authMiddleware` lee `usuarios.tenant_id` de la BD y lo monta en `req.usuario.tenant_id`. Si el JWT trae un claim que no coincide con la BD → 403 TENANT_MISMATCH.
6. **Super-admin = admin del tenant bsl.** Solo BSL admins pueden crear tenants, editarlos, o usar herramientas globales (`/api/admin/tablas/*`). Enforced via `requireSuperAdmin` middleware.
7. **No Kubernetes.** DO App Platform cubre el caso. Revisar solo con 20+ tenants, regionalización, o DevOps dedicado.

### Módulos BSL-only (wrapped con `requireBslTenant`)

Estas rutas devuelven 404 para tenants que no sean BSL:

- `/api/facturacion`, `/api/facturacion-empresas` (Alegra)
- `/api/planilla-sitel` (SITEL payroll)
- `/api/nubia` + barrido cron NUBIA (SANITHELP-JJ telemedicine)
- `/api/rips` (Colombia health reports)
- `/api/envio-siigo`, `/api/asistencia-siigo` (SIIGO integration)
- `/api/external` (x-api-key, SIIGO orders)
- `/api/wix/:id` (Wix proxy)
- Endpoints de comunidad con perfiles PARTICULAR/SANITHELP-JJ

### Estado actual (sprints históricos)

| Sprint | Descripción | Status |
|---|---|---|
| 1 | `tenants` table + `tenant_id` columns + middleware + JWT claim | ✅ Done |
| 2 | `BaseRepository` + repos aceptan `tenantId` param | ✅ Done (Empresas, WhatsApp, HistoriaClinica) |
| 3 | Wix envuelto con `requireBslTenant` / `isBsl` | ✅ Done |
| 4 | `pool.query()` filtrados por `tenant_id` | 🟡 70% — ver audit script |
| 5 | Socket.io rooms + SSE scoped por tenant | ✅ Done |
| 6 | Frontend branding dinámico vía `/api/tenants/config` | ✅ Done |
| 7 | Primer tenant nuevo onboarded (ipsVip) | ✅ Done |
| 8 | UNIQUE constraints compuestos con `tenant_id` | ✅ Done (ronda 3 de bug hunt) |

### `tenants` table schema

```sql
CREATE TABLE tenants (
  id           VARCHAR(50)  PRIMARY KEY,     -- 'bsl', 'clinicax', etc.
  nombre       VARCHAR(200) NOT NULL,
  hostnames    TEXT[]       NOT NULL,         -- ['bsl.com.co', 'www.bsl.com.co']
  config       JSONB        NOT NULL DEFAULT '{}'::jsonb,  -- modulos_activos, logo_url, colores, etc.
  credenciales JSONB        NOT NULL DEFAULT '{}'::jsonb,  -- Twilio, OpenAI, etc. (optional, encrypted)
  activo       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

BSL is inserted as the first tenant on startup with `id = 'bsl'` and its current hostname(s).

### Tables with `tenant_id` column

All tenant-scoped tables receive `tenant_id VARCHAR(50) NOT NULL DEFAULT 'bsl'` via `ALTER TABLE ADD COLUMN IF NOT EXISTS` in `src/config/init-db.js`:

- `formularios`, `HistoriaClinica`, `empresas`, `usuarios`, `medicos`, `examenes`
- `audiometrias`, `visiometrias`, `visiometrias_virtual`, `voximetrias_virtual`, `pruebasADC`, `scl90`, `laboratorios`
- `medicos_disponibilidad`
- `conversaciones_whatsapp`, `mensajes_whatsapp`, `agentes_estado`, `transferencias_conversacion`, `reglas_enrutamiento`
- `sesiones`, `permisos_usuario`, `seguimiento_comunidad`
- `certificado_envio_logs`, `configuracion_facturacion_empresa`, `contenido_educativo`, `sistema_asignacion`
- `facturas` (agregado en ronda 3 para soportar FK compuesta con empresas)

### UNIQUE constraints compuestos con `tenant_id`

Los siguientes UNIQUEs son compuestos `(col, tenant_id)` para permitir que cada tenant tenga sus propios valores (ej: cada tenant puede tener una empresa "PARTICULAR"):

| Tabla | Constraint | Columnas |
|---|---|---|
| `empresas` | `empresas_cod_empresa_tenant_key` | `(cod_empresa, tenant_id)` |
| `examenes` | `examenes_nombre_tenant_key` | `(nombre, tenant_id)` |
| `usuarios` | `usuarios_email_tenant_key` | `(email, tenant_id)` |
| `usuarios` | `usuarios_numero_documento_tenant_key` | `(numero_documento, tenant_id)` |
| `conversaciones_whatsapp` | `..._celular_tenant_key` | `(celular, tenant_id)` |
| `visiometrias_virtual` | `..._orden_tenant` | `(orden_id, tenant_id)` |
| `voximetrias_virtual` | `..._orden_tenant` | `(orden_id, tenant_id)` |
| `configuracion_facturacion_empresa` | `..._cod_empresa_tenant_key` | `(cod_empresa, tenant_id)` |

FKs a `empresas(cod_empresa, tenant_id)` en `configuracion_facturacion_empresa.fk_empresa` y `facturas.fk_empresa_factura` son compuestas.

**Preservados como UNIQUE simple** (valores globalmente únicos): `sesiones.token_hash`, `facturas.alegra_invoice_id`, `permisos_usuario(usuario_id, permiso)`.

Cuando agregues una tabla nueva con un UNIQUE sobre columna de dominio, **hazlo compuesto con `tenant_id` desde el inicio**. La migración del constraint viejo está en `src/config/init-db.js` en el bloque `uniqueMigrations`.

### Writing multi-tenant-safe code

**1. Queries nuevas** — siempre incluir `tenant_id`:

```javascript
const result = await pool.query(
  `SELECT * FROM "HistoriaClinica" WHERE "numeroId" = $1 AND tenant_id = $2`,
  [numeroId, req.tenant.id]
);
```

Usa `req.tenant.id` en rutas HTTP, o `req.usuario.tenant_id` (ya viene de BD) cuando estés dentro de `authMiddleware`. En services/crons pásalo explícito.

**2. Repositories** — los métodos aceptan `tenantId` como parámetro opcional. Pásalo siempre en código nuevo, aunque el default a `'bsl'` funcione:

```javascript
await EmpresasRepository.findByCodigo('PARTICULAR', req.tenant.id);
```

**3. Rutas BSL-only** — envolver con `requireBslTenant` a nivel de router en `server.js`:

```javascript
app.use('/api/facturacion', requireBslTenant, require('./src/routes/facturacion'));
```

**4. Código Wix** — guard explícito con `isBsl(req)`:

```javascript
if (isBsl(req)) {
  await wixSync.syncHistoriaClinica(data);
}
```

**5. Socket.io / SSE** — emitir por room, nunca global:

```javascript
// ✅ Socket.io
io.to('tenant:' + tenantId).emit('nuevo-mensaje', data);

// ✅ SSE — usar helpers/sse que ya filtran por tenantId
notificarNuevaOrden(orden, req.tenant.id);
```

**6. Uploads a DO Spaces** — incluir tenant en el path (BSL conserva path legacy para zero-regression):

```javascript
await subirFotoASpaces(base64, numeroId, formId, req.tenant.id);
// Path: 'ipsVip/fotos/123_456_789.jpg' para no-BSL, 'fotos/123_456_789.jpg' para BSL
```

**7. Super-admin vs admin del tenant** — herramientas de plataforma van con `requireSuperAdmin`:

```javascript
router.get('/tablas/:nombre/datos', authMiddleware, requireSuperAdmin, handler);
```

### Reglas antes de agregar authMiddleware a un endpoint existente

Cuando agregues `authMiddleware` a una ruta que antes era pública, **DEBES** correr:

```bash
grep -rn "fetch.*'/api/RUTA'" public/
```

y verificar que todas las páginas que la consumen envían `Auth.getAuthHeaders()`. Si alguna no lo hace, o la actualizas o dejas el endpoint público. Ejemplo aprendido: `GET /api/examenes` es consumido por 6 páginas (ordenes, nueva-orden, empresas, calendario, panel-empresas, examenes) y debe ser público. Las mutaciones (`POST/PUT/DELETE`) sí llevan auth.

### Why no Kubernetes

Kubernetes was evaluated and rejected: DO App Platform already provides multi-domain SSL, auto-deploy, rollback, and scaling. K8s would strip those away in exchange for flexibility we don't need. Revisit only if: (a) 20+ tenants with physical DB isolation required, (b) regionalization, or (c) dedicated DevOps team.

### Auditoría de seguridad / multi-tenant

Antes de hacer cambios amplios o como revisión periódica, correr:

```bash
node scripts/audit-multitenant.js
```

Reporta candidatos en 4 categorías: queries sin `tenant_id`, rutas sin `authMiddleware`, template literals en SQL (posible injection), `io.emit` sin room filter. Ver [AUDIT.md](AUDIT.md) para el checklist semántico completo, falsos positivos esperados, e historial de rondas de bug hunt. **Cuando encuentres un bug nuevo que el script debería haber atrapado pero no lo hizo, amplía el script** — ese es el mecanismo para que la cobertura crezca con el tiempo.

## Architecture Overview

### Dual-Database System
The platform operates with TWO databases that must stay synchronized:

1. **PostgreSQL (Platform Database)**: Main operational database
   - Tables: `formularios`, `HistoriaClinica`, `usuarios`, `empresas`
   - Used by web application for real-time operations
   - Contains both user-generated data and synced data from Wix

2. **Wix CMS (Source of Truth)**: External content management system
   - Collections: `HistoriaClinica`, `FORMULARIO`, `CHATBOT`
   - Accessed via HTTP functions at `https://www.bsl.com.co/_functions/`
   - Medical data entered by doctors goes here first
   - Requires periodic synchronization to PostgreSQL

### Synchronization Pattern
Medical data flows: **Wix → PostgreSQL** (Wix is authoritative for medical records)

Key synchronization scripts:
- `migracion-historia-clinica.js` - Full migration of HistoriaClinica from Wix to PostgreSQL
- `sincronizar-datos-medicos.js` - Daily sync of medical fields (mdConceptoFinal, mdDx1, etc.) for records with fechaConsulta = today
- `migracion-formulario.js` - Migration of FORMULARIO collection from Wix

### Backend Architecture (Modular Structure)

**Entry Point**: `server.js` (~237 lines) - Express server with modular routing

**Directory Structure**:
```
src/
  config/
    database.js         - PostgreSQL pool singleton
    init-db.js          - Database schema initialization
  middleware/
    auth.js             - JWT authentication & authorization
  helpers/
    date.js             - Date/time utilities (Colombia timezone)
    phone.js            - Phone number normalization
    webhook.js          - Make.com webhook utilities
    sse.js              - Server-Sent Events for real-time notifications
    certificate.js      - PDF certificate generation
    historia-clinica-html.js - HTML generation for medical history PDF export
    google-calendar.js  - Google Calendar link generator for appointment events
  services/
    spaces-upload.js    - DigitalOcean Spaces file uploads
    whatsapp.js         - Twilio WhatsApp messaging
    whapi.js            - WHAPI WhatsApp messaging (alternative channel)
    bot.js              - AI chatbot (OpenAI RAG)
    payment.js          - Payment classification (OpenAI Vision)
    wix-sync.js         - Wix CMS synchronization
  repositories/
    BaseRepository.js                  - Base CRUD operations
    HistoriaClinicaRepository.js       - Medical records
    FormulariosRepository.js           - Patient intake forms
    UsuariosRepository.js              - User management
    ConversacionesWhatsAppRepository.js - WhatsApp conversations
    MensajesWhatsAppRepository.js      - WhatsApp messages
    EmpresasRepository.js              - Company records
  routes/
    auth.js             - /api/auth/* - Authentication
    admin.js            - /api/admin/* - Admin operations
    whatsapp.js         - /api/whatsapp/* - WhatsApp chat
    formularios.js      - /api/formularios/* - Patient forms
    ordenes.js          - /api/ordenes/* - Medical orders
    ordenes-legacy.js   - Legacy /api/ level routes
    historia-clinica.js - /api/historia-clinica/* - Medical history
    medicos.js          - /api/medicos/* - Doctor management
    empresas.js         - /api/empresas/* - Company management
    calendario.js       - /api/calendario/*, /api/examenes/* - Scheduling
    nubia.js            - /api/nubia/* - Virtual appointments
    audiometria.js      - /api/audiometrias/* - Hearing tests
    pruebas-adc.js      - /api/pruebas-adc/* - ADC tests + /api/pruebas-adc/estadisticas/:codEmpresa (ADC stats by Apto/No Apto, date range)
    scl90.js            - /api/scl90/* - SCL-90 psychological test
    estado-pruebas.js   - /api/estado-pruebas/* - Test status
    consulta-publica.js - /api/consulta-ordenes - Public lookups
    visiometria.js      - /api/visiometrias/* - Vision tests
    voximetria.js       - /api/voximetria-virtual/* - Virtual voximetry (voice analysis with GPT-4o audio)
    laboratorios.js     - /api/laboratorios/* - Lab results
    certificados.js     - /preview-certificado/*, /api/certificado-pdf/*, /descarga-empresas/:codEmpresa, /api/descarga-empresas/*
    rips.js             - /api/rips/* - Colombian health reports
    comunidad.js        - /api/comunidad/* - Community features
    siigo.js            - /api/envio-siigo/* - Siigo accounting
    facturacion.js      - /api/facturacion/* - Alegra invoicing
    asistencia-siigo.js - /api/asistencia-siigo/* - SIIGO attendance tracking
    envio-empresas.js   - /api/envio-empresas/* - Company scheduling notifications via WhatsApp
    estadisticas.js     - /api/estadisticas/* - Patient movement statistics
    facturacion-empresas.js - /api/facturacion-empresas/* - Company billing reports
    planilla-sitel.js   - /api/planilla-sitel/* - SITEL payroll report generation
    external.js         - /api/external/* - External API for SIIGO (API key auth)
    basic.js            - /, /health, /api/events (SSE), /api/wix/*
lib/
  alegra-client.js      - Alegra accounting API client class
  rips-generator.js     - RIPS JSON generator (Resolución 2275/2023)
scripts/
  migrar-fotos-spaces.js              - Migrate photos to DigitalOcean Spaces
  consolidar-duplicados-whatsapp.js   - Consolidate duplicate WhatsApp conversations
  limpiar-server-chat.js              - Clean chat server data
  one-time/                           - One-off migration and fix scripts
```

**Key Features**:
- **Repository Pattern**: Data access abstraction with BaseRepository + specialized repos
- **Modular Routing**: 25+ route modules organized by domain
- **Service Layer**: Specialized services for external integrations
- **Automated Tasks**: Cron jobs for NUBIA virtual appointments (every 5 min)

### Frontend (public/)

Multiple HTML pages with vanilla JavaScript (no framework):
- `ordenes.html` - Main dashboard for viewing/managing patient orders
- `nueva-orden.html`, `nuevaorden1.html`, `nuevaorden2.html`, `nuevaorden3.html` - Multi-step order creation wizards. `nuevaorden2.html` supports URL params `epa1`, `epa2`, `epa3` to pre-select codEmpresa
- `panel-admin.html` - Admin panel for user management
- `panel-empresas.html` / `empresas.html` - Company portal for viewing employee exams
- `index.html` - Patient intake form (multi-step wizard)
- `login.html` / `registro.html` - Authentication and registration pages
- `audiometria.html`, `audiometria-virtual.html` - Audiometry exam interfaces
- `visiometria.html`, `visiometria-virtual.html` - Vision exam interfaces
- `voximetria-virtual.html` - Virtual voximetry exam for call center workers (gender selection → mic calibration → 3 voice exercises → GPT-4o audio analysis)
- `scl90.html` - SCL-90 psychological symptom test (SIIGO only)
- `pruebas-adc.html` - ADC test interface (includes estadísticas tab with anxiety/depression charts, filterable by date range, grouped by Apto/No Apto)
- `medicos.html` - Medical staff management
- `calendario.html` - Appointment scheduling interface
- `nubia.html` - NUBIA virtual appointments interface
- `consulta-orden.html` - Public order lookup
- `validar-certificado.html` - Certificate validation page
- `examenes.html` - Exam type management
- `estadisticas.html` - Statistics dashboard
- `movimiento.html` - Patient movement statistics by date range (standalone, no sidebar/topbar)
- `descarga-empresas.html` - Public page for downloading certificates by codEmpresa (standalone, no sidebar/topbar)
- `certificado-template.html` - Medical certificate PDF template
- `enviar-siigo.html` - Integration with Siigo accounting system
- `asistencia-siigo.html` - SIIGO attendance tracking
- `enviar-empresas.html` - Company scheduling notifications (standalone, no sidebar/topbar)
- `facturacion-empresas.html` - Company billing reports
- `planilla-sitel.html` - SITEL payroll report (standalone, no sidebar/topbar)
- `informe-audiometrias.html` - Audiometry report by company with CSV export (standalone, no sidebar/topbar)
- `panel-laboratorios.html` - Laboratory results panel
- `panel-rips.html` - RIPS Colombian health reports panel
- `panel-comunidad.html` - Community features panel (WhatsApp modal with two-column layout, patient seguimiento/observaciones, date range filtering by fechaConsulta, profile chips, patient photo with lightbox, filtered to PARTICULAR and SANITHELP-JJ only)
- `twilio-chat.html` - WhatsApp agent chat interface
- `subir-lote.html` - Batch upload interface
- `actualizar-foto.html` - Photo upload interface

Shared frontend modules (`public/js/`):
- `auth.js` - Authentication utilities (token management, redirects)
- `load-sidebar.js` - Dynamic sidebar component loader
- `load-topbar.js` - Dynamic topbar component loader
- `modal-disponibilidad.js` - Doctor availability modal

Reusable components (`public/components/`):
- `sidebar.html` - Shared navigation sidebar
- `topbar.html` - Shared top navigation bar
- `modal-disponibilidad.html` - Doctor availability modal template

Frontend architecture:
- Direct DOM manipulation (no virtual DOM)
- Fetch API for backend communication
- Inline event handlers and global functions
- Modal-based workflows for patient details
- Socket.io for real-time updates (appointments, notifications)
- Shared sidebar/topbar loaded dynamically via `load-sidebar.js` and `load-topbar.js`
- All internal pages MUST use the shared sidebar/topbar pattern (see ordenes.html as reference)
- Exceptions: `twilio-chat.html` (custom chat UI), `validar-certificado.html` (public page), `index.html` (patient form), `movimiento.html` (standalone stats), `descarga-empresas.html` (public company downloads), `enviar-empresas.html` (standalone notifications), `planilla-sitel.html` (standalone report), `voximetria-virtual.html` (patient voice test)

### Wix Integration (WIX/)

Backend functions that run on Wix platform (deployed separately):
- `http-functions.js` - Main HTTP endpoints exposed by Wix (~118KB, primary integration point)
  - `get_historiaClinicaPorFecha` - Get records by consultation date
  - `get_exportarHistoriaClinica` - Paginated export for migration
  - `post_updateHistoriaClinica` - Update medical records
- `exposeDataBase.js` - Database query functions (~35KB)
- `agendarAlonso.js` - Appointment scheduling logic with Alonso system integration
- `automaticWhp.js` - WhatsApp automation workflows (~18KB)
- `audiometriaVirtual.js` - Virtual audiometry exam logic
- `ansiedadWix.js`, `depresionWix.js`, `congruenciaWix.js` - Psychological test handlers
- `adcVirtual.js` - Virtual ADC (Atención Domiciliaria Continuada) handling
- `visualVirtual.js` - Virtual vision test handling
- `panel_empresas_wix.js` - Company panel Wix-side logic

These files use Wix SDK (`wix-data`, `wix-fetch`) and must be deployed to Wix separately from the main platform.

### Chatbot & Scheduling Features
- **CHATBOT Collection** (Wix): Stores chatbot conversations and automated scheduling requests
- **Appointment Scheduling**: Integrated with external "Alonso" appointment system
- **AI-Powered Assistance**: OpenAI integration for intelligent form filling and patient queries
- **Virtual Exams**: Support for remote audiometry, visiometry, voximetry, and psychological testing

### Voximetry Virtual (Voice Analysis for Call Center Workers)
Voice quality screening test using GPT-4o audio analysis:

**Flow**: Gender selection → Mic calibration check → 3 exercises → GPT-4o analysis → Results

**Exercises**:
1. Sustained vowel "A" (max 20s) — measures F0, jitter, shimmer, HNR, TMF
2. Read call center script aloud (max 30s) — measures intensity, stability
3. Count 1-20 in one breath (max 25s) — respiratory capacity

**Technical architecture**:
- Frontend records via `MediaRecorder` (webm/opus), decodes to PCM via `decodeAudioData()`, converts to WAV base64 via `samplesToWavBase64()`
- Backend `POST /api/voximetria-virtual/analizar` sends WAV audio to `gpt-4o-audio-preview` model
- GPT-4o estimates acoustic parameters (F0, jitter, shimmer, HNR, intensity) + generates concepto/interpretacion/recomendaciones
- Results saved to `voximetrias_virtual` table (upsert on orden_id)
- Body limit is 25mb to support 3 WAV audio files in base64
- Mic calibration screen validates volume level before tests begin (requires ~3s of good level)

### WhatsApp Chat Platform (Multi-Agent System)
The platform includes a full WhatsApp-based customer service system:

**Architecture**:
- Real-time Socket.io communication between agents and server
- Multi-agent routing with automatic assignment rules
- Agent status management (online, offline, busy)
- Conversation transfer between agents
- Message persistence in PostgreSQL

**Key Components**:
- `conversaciones_whatsapp`: Conversation threads with status tracking → `ConversacionesWhatsAppRepository`
- `mensajes_whatsapp`: Message history (customer + agent messages) → `MensajesWhatsAppRepository`
- `agentes_estado`: Real-time agent availability
- `reglas_enrutamiento`: Smart routing rules (priority-based, condition-driven)
- `transferencias_conversacion`: Transfer audit trail

**Default Routing Rules** (created automatically on startup):
- "Fuera de horario laboral" (Priority 10) - Routes to bot outside 08:00-18:00
- "Emergencias" (Priority 20) - Routes urgent keywords to available agents
- "Solicitar humano" (Priority 15) - Routes human requests to available agents

**Integration Points**:
- Twilio WhatsApp API for message sending (`src/services/whatsapp.js`)
- WHAPI for alternative WhatsApp channel (`src/services/whapi.js`)
- Email notifications via Nodemailer (`src/services/email.js`)
- Automated message templates for common scenarios

## Data Flow Patterns

### Patient Order Creation (Internal)
1. Company creates order in Wix → generates `_id`
2. Patient fills form at `/index.html?_id=xxx`
3. Form data saved to PostgreSQL `formularios` table
4. Data synced back to Wix `FORMULARIO` collection
5. Medical exam conducted → doctor enters results in Wix
6. Results synced to PostgreSQL via `sincronizar-datos-medicos.js`

### External Order Creation (SIIGO API)
1. External platform sends POST to `/api/external/ordenes` with `X-API-Key` header
2. Creates HistoriaClinica record in PostgreSQL + syncs to Wix
3. Manages WhatsApp conversation for the patient
4. After exam, POST to `/api/external/aprobar` to approve and send results back
5. Alternatively, EMPRESA users can approve directly via the APROBAR button in `panel-empresas.html`

### Historia Clínica PDF Export
- Preview HTML and download PDF of complete medical history via `/api/historia-clinica/:id/pdf`
- HTML generation handled by `src/helpers/historia-clinica-html.js`
- PDF rendered server-side with Puppeteer (Chromium)

### Modal Details in ordenes.html
The patient details modal loads data from **PostgreSQL HistoriaClinica table** via `/api/historia-clinica/:id` endpoint. If medical fields (mdConceptoFinal, mdDx1, etc.) appear empty, run the sync script to pull latest data from Wix.

## Database Schema

All tables are created automatically on server startup with `CREATE TABLE IF NOT EXISTS`.

**Database Access Pattern**: Use the Repository layer (`src/repositories/`) instead of direct `pool.query()` calls for cleaner, testable code.

### Core Tables

**formularios** (PostgreSQL)
- Patient intake form submissions
- Auto-migrates new columns on server startup
- Links to HistoriaClinica via `wix_id` foreign key
- **Access via**: `FormulariosRepository`

**HistoriaClinica** (PostgreSQL)
- Medical history records synced from Wix
- Primary key: `_id` (Wix-generated UUID)
- Critical fields: `numeroId` (patient ID), `atendido` (status), `mdConceptoFinal` (medical concept), `mdDx1/mdDx2` (diagnoses)
- Valid `mdConceptoFinal` values: `APTO`, `APLAZADO`, `NO APTO`, `APTO CON RECOMENDACIONES`
- Dynamic columns (added on startup): `horaAtencion`, `subempresa`, `centro_de_costo`, `aprobacion`, `aprobacion_externa`, `fecha_aprobacion_externa`, `concepto_aprobado`, `linkEnviado`, `observaciones_siigo`, `foto_url`, `recordatorioLinkEnviado`, `correo`
- Index on: `numeroId`, `celular`, `codEmpresa`, `fechaAtencion`
- **Access via**: `HistoriaClinicaRepository`

**usuarios** (PostgreSQL)
- Platform user accounts
- Roles: ADMIN, MEDICO, APROBADOR, EMPRESA
- Permissions stored as JSON array
- **Access via**: `UsuariosRepository`

### Exam & Medical Data Tables

- **audiometrias**: Audiometry test results
- **visiometrias**: Vision test results
- **visiometrias_virtual**: Virtual vision test results
- **voximetrias_virtual**: Virtual voximetry results. Columns: f0_mean/min/max, jitter_percent, shimmer_percent, hnr_db, intensidad_mean_db, tiempo_maximo_fonacion_s, concepto, interpretacion, recomendaciones. Audio analyzed by GPT-4o-audio-preview. UNIQUE on orden_id.
- **pruebasADC**: ADC (Atención Domiciliaria Continuada) test data
- **scl90**: SCL-90 psychological symptom test (items 1-90, resultado/interpretacion/baremos as JSONB). Required for SIIGO instead of ADC. Auto-scored with Colombian baremos by gender.
- **laboratorios**: Laboratory test results
- **medicos_disponibilidad**: Doctor availability/scheduling
- **empresas**: Company records → `EmpresasRepository`. JSONB columns: `ciudades`, `examenes`, `subempresas`, `centros_de_costo`, `cargos`

### WhatsApp Chat System Tables

- **conversaciones_whatsapp**: Chat conversation threads
- **mensajes_whatsapp**: Individual messages in conversations
- **agentes_estado**: Agent status (online, offline, busy)
- **transferencias_conversacion**: Conversation transfer history
- **reglas_enrutamiento**: Routing rules for incoming chats

### Authentication & Sessions

- **sesiones**: Active user sessions (JWT tracking)
- **permisos_usuario**: User-specific permission overrides

### Field Naming Conventions
- **Frontend**: camelCase (primerNombre, numeroId)
- **PostgreSQL**: snake_case for formularios, camelCase with quotes for HistoriaClinica ("primerNombre")
- **Wix**: camelCase (primerNombre, numeroId)

Careful mapping required when transforming data between systems.

## External Integrations

### Third-Party Services
- **AWS S3**: File storage for patient photos and documents
- **Twilio**: WhatsApp messaging for notifications and appointment reminders
- **OpenAI**: AI-powered features (chatbot, form assistance)
- **Siigo**: Accounting system integration for billing
- **Alegra**: Alternative accounting system integration
- **Wix**: Primary CMS for medical records (source of truth)

### Communication Channels
- **WhatsApp** (via Twilio & WHAPI): Automated messages for appointments, reminders, order confirmations
- **Socket.io**: Real-time web notifications and updates

## Environment Variables

Required in `.env`:
```
# PostgreSQL (DigitalOcean)
DB_HOST=
DB_PORT=25060
DB_USER=
DB_PASSWORD=
DB_NAME=defaultdb

# Server
PORT=8080
BASE_URL=https://your-domain.com

# JWT
JWT_SECRET=

# AWS S3 (for file uploads)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_BUCKET_NAME=

# Twilio (WhatsApp)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
TWILIO_WHATSAPP_NUMBER=
TWILIO_MESSAGING_SERVICE_SID=
TWILIO_TEMPLATE_*=  # Various message templates
TWILIO_TEMPLATE_CITA_CALENDARIO=  # Google Calendar appointment link template

# WHAPI
WHAPI_TOKEN=
WHAPI_CHANNEL_ID=

# OpenAI
OPENAI_API_KEY=

# Alegra (Accounting)
ALEGRA_TOKEN=
ALEGRA_EMAIL=
ALEGRA_API_URL=

# DigitalOcean Spaces
SPACES_KEY=
SPACES_SECRET=
SPACES_ENDPOINT=
SPACES_BUCKET=
SPACES_CDN=

# External API
EXTERNAL_API_KEY=  # API key for external integrations (SIIGO order creation)

# Email (SMTP - Nodemailer)
SMTP_HOST=smtp.gmail.com        # SMTP server (Gmail, SendGrid, AWS SES, etc.)
SMTP_PORT=587                    # SMTP port (587 for TLS, 465 for SSL)
SMTP_SECURE=false                # true for port 465, false for 587
SMTP_USER=                       # SMTP username (email address for Gmail)
SMTP_PASS=                       # SMTP password (app password for Gmail)
SMTP_FROM=                       # Sender email (defaults to SMTP_USER)

# Other
COORDINADOR_CELULAR=  # Coordinator phone for notifications
```

## Migration & Sync Scripts

Run from project root:

```bash
# Full migration from Wix to PostgreSQL
node migracion-historia-clinica.js [--skip=N] [--dry-run] [--desde=YYYY-MM-DD]

# Daily sync of medical data for today's consultations
node sincronizar-datos-medicos.js [--dry-run] [--fecha=YYYY-MM-DD]

# Migrate FORMULARIO collection from Wix to PostgreSQL formularios table
# Links formularios to HistoriaClinica via wix_id = idGeneral
# Only inserts for HC records that don't already have a formulario (never overwrites/deletes)
# Converts Wix encuestaSalud/antecedentesFamiliares tag arrays to individual Sí/No columns
node migracion-formulario.js [--skip=N] [--dry-run] [--desde=YYYY-MM-DD]
```

Use `--dry-run` to preview changes without modifying database.

**Note**: `migracion-historia-clinica.js` and `sincronizar-datos-medicos.js` are excluded from git (in .gitignore). `migracion-formulario.js` is committed to the repository.

## Automated Tasks (Cron Jobs)

The server runs automated background tasks via `node-cron`:

### NUBIA System Sweep (Every 5 minutes)
Manages virtual medical appointments for NUBIA telemedicine platform:
1. **Send Virtual Link**: Sends medical appointment link at exact scheduled time
2. **Mark as Attended**: Automatically marks past appointments as ATENDIDO
3. **Payment Reminders**: Sends payment reminder to SANITHELP-JJ 1 hour after consultation

Location: [server.js:13369-13383](server.js#L13369-L13383)

## Important Patterns & Gotchas

### Database Pool Import
- **ALWAYS** import pool as: `const pool = require('../config/database');`
- **NEVER** use `req.app.locals.pool` - this is an anti-pattern that breaks consistency
- For repositories, pool is handled internally by BaseRepository

### Images and Base64
- Patient photos stored as base64 in PostgreSQL
- **NEVER** include `foto` field in list queries (causes memory issues)
- Always exclude in SELECT: `SELECT _id, nombre, apellido FROM ...` (not SELECT *)

### Certificate Download & SST Approval (panel-empresas.html)
- Empresas with SST approval flow: `EMPRESAS_CON_APROBACION = ['SITEL', 'OMEGA']`
- For these companies, certificate download normally requires `aprobacion === 'APROBADO'`
- **OMEGA exception**: allows download when patient is ATENDIDO and `mdConceptoFinal === 'APTO'`, even without SST approval
- This exception applies to: modal PDF button, table row download icon, and bulk download
- OMEGA also displays approval badge as `APROBADO` in the table when `mdConceptoFinal === 'APTO'`
- **SITEL APROBADOR exception**: users with `APROBADOR` permission on SITEL can always download certificates without approval restriction
- Other SITEL users (non-APROBADOR) strictly require `aprobacion === 'APROBADO'`

### SITEL Modalidad (Presencial/Virtual)
- SITEL currently operates in **presencial only** mode (virtual hidden)
- This has changed multiple times — check current state in the order creation flow
- Specific centros de costo may have special rules (e.g., Iberia, Harley Davidson)

### Wix Sync Failures
- Wix sync failures are logged but **do not block** the user response
- Form submissions succeed even if Wix sync fails
- Check server logs for sync errors

### Health Survey Tag Conversion
- Frontend checkboxes converted to tag arrays for Wix
- Only "Sí" (Yes) responses are sent as tags
- Example: `["Diabetes", "Hipertensión"]`

### Date Handling
- Wix uses UTC timestamps
- Colombia timezone is UTC-5
- Always adjust for timezone when comparing dates
- `fechaConsulta` vs `fechaAtencion`: consultation date vs actual exam date

### Authentication Flow
- JWT tokens stored in localStorage
- Middleware hierarchy:
  - `authMiddleware` — valida token, monta `req.usuario` con `tenant_id` **desde la BD** (no del JWT). Rechaza con 403 TENANT_MISMATCH si JWT y BD no coinciden, o si hostname y BD no coinciden.
  - `requireAdmin` — requiere `rol === 'admin'` del tenant del request
  - `requireSuperAdmin` — requiere admin **del tenant `bsl`** específicamente. Usar para herramientas globales de plataforma (gestión de tenants, inspección de tablas, etc.)
- Permissions checked via `hasPermission()` function
- Token expiration: 24 hours
- Registro/login filtran por `tenant_id` (hostname del request) — mismo email puede existir en múltiples tenants

### Home route (`GET /`) behavior
- Sin query params → sirve `login.html`
- Con `?_id=...` → sirve `index.html` (formulario del paciente, usado por links de Wix/WhatsApp)
- `express.static('public')` tiene `{ index: false }` para que no auto-sirva `public/index.html` en `/`

### Patient photos en DO Spaces
- Path legacy BSL: `fotos/${numeroId}_${formId}_${timestamp}.ext`
- Path tenant no-BSL: `${tenantId}/fotos/${numeroId}_${formId}_${timestamp}.ext`
- Ver `src/services/spaces-upload.js` → `subirFotoASpaces(base64, numeroId, formId, tenantId)`
- BSL conserva el path legacy (sin prefijo) para zero-regression con URLs ya guardadas en BD

## Code References

When modifying code, use these patterns for file references:
- Files: `[server.js](server.js)` or `[ordenes.html](public/ordenes.html)`
- Specific lines: `[server.js:3419](server.js#L3419)`
- Line ranges: `[ordenes.html:3822-3841](public/ordenes.html#L3822-L3841)`

## Debugging Common Issues

**Patient shows PENDIENTE but should be ATENDIDO:**
- Medical data in Wix but not synced to PostgreSQL
- Run: `node sincronizar-datos-medicos.js --fecha=YYYY-MM-DD`

**Modal shows incomplete medical data:**
- Check if endpoint `/api/historia-clinica/:id` returns full record
- Verify PostgreSQL has latest data from Wix
- Run sync script for the consultation date

**Form submission fails:**
- Check PostgreSQL connection (DB_HOST, DB_PASSWORD)
- Verify table schema matches code (auto-migration on startup)
- Check server logs for detailed error messages

**Wix endpoints return 404:**
- Ensure Wix functions are deployed (WIX/http-functions.js)
- Check URL format: `https://www.bsl.com.co/_functions/endpointName`
- Verify CORS headers in Wix function responses

**Docker build fails with "npm ci requires package-lock.json":**
- Ensure package-lock.json is committed to repository
- Never add package-lock.json to .gitignore
- Regenerate with `npm install` if missing
- Commit and push the file before deploying

**PDF generation fails in production:**
- Verify Chromium is installed in Docker container (line 68 of Dockerfile)
- Check PUPPETEER_EXECUTABLE_PATH is set to `/usr/bin/chromium`
- Ensure all required system libraries are installed (lines 8-49 of Dockerfile)

**WhatsApp messages not sending:**
- Verify Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
- Check WHAPI_TOKEN is valid and active
- Review message template IDs (TWILIO_TEMPLATE_*)
- Check server logs for API errors from Twilio/WHAPI

**Multi-tenant: "ya existe" al crear empresa/examen en tenant nuevo:**
- Probablemente un UNIQUE constraint global (no compuesto con `tenant_id`)
- Verificar con: `SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid WHERE t.relname = 'TABLA' AND c.contype = 'u';`
- Debería ser `UNIQUE (col, tenant_id)`, no `UNIQUE (col)`. Si no lo es, agregarlo a `uniqueMigrations` en `src/config/init-db.js`.

**Multi-tenant: ruta devuelve 401 tras agregar authMiddleware:**
- El frontend no envía `Authorization` header. Buscar todas las páginas que llaman al endpoint: `grep -rn "fetch.*'/api/RUTA'" public/`
- O arreglar cada página para usar `Auth.getAuthHeaders()`, o hacer el endpoint público (lectura de catálogo)
- Ver sección "Reglas antes de agregar authMiddleware" arriba

**Multi-tenant: 403 TENANT_MISMATCH en login o navegación:**
- JWT trae `tenant_id` que no coincide con `usuarios.tenant_id` en BD, o hostname del request no coincide con el del usuario
- Casos típicos: usuario BSL intentando usar su token en vip-mediconecta.app (o viceversa), token viejo emitido antes de la migración multi-tenant
- Arreglar: logout + login desde el hostname correcto

**Patient link `/?_id=xxx` redirige al panel en vez de al formulario:**
- Verificar que `GET /` en `server.js` tiene el check `if (req.query._id)` → `sendFile(index.html)`
- Verificar que `express.static('public')` tiene `{ index: false }` (si no, sirve `public/index.html` como formulario por default, pero eso rompe `/` → login)

## Repository Pattern Guide

The codebase uses the **Repository Pattern** for database access abstraction. Always prefer repositories over direct `pool.query()` calls.

### Using Repositories

```javascript
// Import repositories
const { HistoriaClinicaRepository, FormulariosRepository } = require('../repositories');

// Basic CRUD operations (inherited from BaseRepository)
const paciente = await HistoriaClinicaRepository.findById(id);
const pacientes = await HistoriaClinicaRepository.findAll({ codEmpresa: 'ABC' });
const created = await FormulariosRepository.create({ numero_id: '123', ... });
const updated = await HistoriaClinicaRepository.update(id, { atendido: 'ATENDIDO' });
const deleted = await HistoriaClinicaRepository.delete(id);

// Specialized methods (defined in each repository)
const ultimoPaciente = await HistoriaClinicaRepository.findUltimoPorNumeroId('123456');
const stats = await FormulariosRepository.getEstadisticasSalud('COD_EMP');
const duplicado = await HistoriaClinicaRepository.findDuplicadoPendiente('123456', 'COD_EMP');
```

### Available Repositories

1. **BaseRepository** (`src/repositories/BaseRepository.js`)
   - `findById(id, key = '_id')` - Find single record by ID
   - `findOne(filters)` - Find first matching record
   - `findAll(filters, options)` - Find all matching records
   - `create(data)` - Insert new record
   - `update(id, data, key = '_id')` - Update record
   - `delete(id, key = '_id')` - Delete record
   - `query(sql, params)` - Execute raw SQL
   - `transaction(callback)` - Execute within transaction

2. **HistoriaClinicaRepository** (`src/repositories/HistoriaClinicaRepository.js`)
   - Specialized methods for medical records
   - `findByNumeroId(numeroId)`, `findByCelular(celular)`
   - `findDuplicadoPendiente()`, `findDuplicadoAtendido()`
   - `actualizarFechaAtencion()`, `togglePago()`
   - `getStatsHoy()`, `getEstadisticasOrdenes()`
   - `marcarAtendido()` - Upsert from Wix sync

3. **FormulariosRepository** (`src/repositories/FormulariosRepository.js`)
   - Patient intake form operations
   - `findByNumeroId()`, `findByCelular()`, `findByWixId()`
   - `findByCodEmpresa()` - With pagination and search
   - `getEstadisticasSalud()` - Health statistics for AI queries

4. **UsuariosRepository** (`src/repositories/UsuariosRepository.js`)
   - User account management
   - `findByEmail()`, `findByUsername()`, `findWithFilters()`
   - `aprobarUsuario()`, `rechazarUsuario()`, `desactivarUsuario()`

5. **ConversacionesWhatsAppRepository** (`src/repositories/ConversacionesWhatsAppRepository.js`)
   - WhatsApp conversation management
   - `findByCelular()` - Find conversation by phone number

6. **MensajesWhatsAppRepository** (`src/repositories/MensajesWhatsAppRepository.js`)
   - WhatsApp message management
   - `findByConversacion()` - Get messages for a conversation

7. **EmpresasRepository** (`src/repositories/EmpresasRepository.js`)
   - Company record management
   - Domain-specific CRUD operations

### When to Use Repositories

**DO use repositories for:**
- Simple CRUD operations (findById, create, update, delete)
- Domain-specific queries defined in repository methods
- Reusable queries used in multiple endpoints

**DON'T extract to repository when:**
- Complex queries with JOINs across multiple unrelated tables
- One-off queries specific to a single endpoint
- Dynamic filter builders with many optional parameters
- Queries for tables without repositories

### Adding New Repository Methods

When you find a repeated query pattern, add it to the appropriate repository:

```javascript
// In HistoriaClinicaRepository.js
async findDuplicadoAtendido(numeroId, codEmpresa = null) {
    let query = `
        SELECT "_id", "numeroId", "primerNombre", "primerApellido"
        FROM ${this.tableName}
        WHERE "numeroId" = $1 AND "atendido" = 'ATENDIDO'
    `;
    const params = [numeroId];

    if (codEmpresa) {
        query += ` AND "codEmpresa" = $2`;
        params.push(codEmpresa);
    }

    query += ` ORDER BY "_createdDate" DESC LIMIT 1`;
    const result = await this.query(query, params);
    return result.rows[0] || null;
}
```

### Refactoring Legacy Code

When refactoring routes with direct `pool.query()` calls:
1. Check if a repository method already exists for the query
2. If not, consider adding it to the repository if it's reusable
3. Replace `pool.query()` with repository call
4. Keep complex/one-off queries as `pool.query()` with a comment explaining why
