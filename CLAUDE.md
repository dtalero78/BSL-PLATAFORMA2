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

### Backend (server.js - ~15,000 lines, 145+ endpoints)

Single Express server handling:
- **Authentication & Authorization**: JWT-based auth with role-based permissions (ADMIN, APROBADOR, MEDICO, etc.)
- **Patient Management**: CRUD operations for patient records across both databases
- **Medical Exams**: Audiometry, visiometry, psychological tests
- **Certificate Generation**: PDF generation using Puppeteer
- **Wix Integration**: HTTP endpoints to fetch/sync data with Wix CMS

Key endpoint patterns:
- `/api/historia-clinica/*` - Patient medical history (synced from Wix)
- `/api/formularios/*` - Patient intake forms
- `/api/ordenes/*` - Medical exam orders
- `/api/auth/*` - Authentication endpoints
- `/api/admin/*` - Admin operations (user management, permissions)

### Frontend (public/)

Multiple HTML pages with vanilla JavaScript (no framework):
- `ordenes.html` - Main dashboard for viewing/managing patient orders
- `nueva-orden.html`, `nuevaorden1.html`, `nuevaorden2.html`, `nuevaorden3.html` - Multi-step order creation wizards
- `panel-admin.html` - Admin panel for user management
- `panel-empresas.html` / `empresas.html` - Company portal for viewing employee exams
- `index.html` - Patient intake form (multi-step wizard)
- `audiometria.html`, `audiometria-virtual.html` - Audiometry exam interfaces
- `visiometria.html` - Vision exam interface
- `medicos.html` - Medical staff management
- `calendario.html` - Appointment scheduling interface
- `consulta-orden.html` - Public order lookup
- `examenes.html` - Exam type management
- `estadisticas.html` - Statistics dashboard
- `certificado-template.html` - Medical certificate PDF template
- `enviar-siigo.html` - Integration with Siigo accounting system
- `actualizar-foto.html` - Photo upload interface

Frontend architecture:
- Direct DOM manipulation (no virtual DOM)
- Fetch API for backend communication
- Inline event handlers and global functions
- Modal-based workflows for patient details
- Socket.io for real-time updates (appointments, notifications)

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

These files use Wix SDK (`wix-data`, `wix-fetch`) and must be deployed to Wix separately from the main platform.

### Chatbot & Scheduling Features
- **CHATBOT Collection** (Wix): Stores chatbot conversations and automated scheduling requests
- **Appointment Scheduling**: Integrated with external "Alonso" appointment system
- **AI-Powered Assistance**: OpenAI integration for intelligent form filling and patient queries
- **Virtual Exams**: Support for remote audiometry and psychological testing

### WhatsApp Chat Platform (Multi-Agent System)
The platform includes a full WhatsApp-based customer service system:

**Architecture**:
- Real-time Socket.io communication between agents and server
- Multi-agent routing with automatic assignment rules
- Agent status management (online, offline, busy)
- Conversation transfer between agents
- Message persistence in PostgreSQL

**Key Components**:
- `conversaciones_whatsapp`: Conversation threads with status tracking
- `mensajes_whatsapp`: Message history (customer + agent messages)
- `agentes_estado`: Real-time agent availability
- `reglas_enrutamiento`: Smart routing rules (priority-based, condition-driven)
- `transferencias_conversacion`: Transfer audit trail

**Integration Points**:
- Twilio WhatsApp API for message sending
- WHAPI for alternative WhatsApp channel
- Automated message templates for common scenarios

## Data Flow Patterns

### Patient Order Creation
1. Company creates order in Wix → generates `_id`
2. Patient fills form at `/index.html?_id=xxx`
3. Form data saved to PostgreSQL `formularios` table
4. Data synced back to Wix `FORMULARIO` collection
5. Medical exam conducted → doctor enters results in Wix
6. Results synced to PostgreSQL via `sincronizar-datos-medicos.js`

### Modal Details in ordenes.html
The patient details modal loads data from **PostgreSQL HistoriaClinica table** via `/api/historia-clinica/:id` endpoint. If medical fields (mdConceptoFinal, mdDx1, etc.) appear empty, run the sync script to pull latest data from Wix.

## Database Schema

All tables are created automatically on server startup with `CREATE TABLE IF NOT EXISTS`.

### Core Tables

**formularios** (PostgreSQL)
- Patient intake form submissions
- Auto-migrates new columns on server startup
- Links to HistoriaClinica via `wix_id` foreign key

**HistoriaClinica** (PostgreSQL)
- Medical history records synced from Wix
- Primary key: `_id` (Wix-generated UUID)
- Critical fields: `numeroId` (patient ID), `atendido` (status), `mdConceptoFinal` (medical concept), `mdDx1/mdDx2` (diagnoses)
- Index on: `numeroId`, `celular`, `codEmpresa`, `fechaAtencion`

**usuarios** (PostgreSQL)
- Platform user accounts
- Roles: ADMIN, MEDICO, APROBADOR, EMPRESA
- Permissions stored as JSON array

### Exam & Medical Data Tables

- **audiometrias**: Audiometry test results
- **visiometrias**: Vision test results
- **visiometrias_virtual**: Virtual vision test results
- **pruebasADC**: ADC (Atención Domiciliaria Continuada) test data
- **laboratorios**: Laboratory test results
- **medicos_disponibilidad**: Doctor availability/scheduling

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

# Migrate FORMULARIO collection
node migracion-formulario.js
```

Use `--dry-run` to preview changes without modifying database.

**Note**: These scripts are excluded from git (in .gitignore) as they may contain credentials or sensitive configuration.

## Automated Tasks (Cron Jobs)

The server runs automated background tasks via `node-cron`:

### NUBIA System Sweep (Every 5 minutes)
Manages virtual medical appointments for NUBIA telemedicine platform:
1. **Send Virtual Link**: Sends medical appointment link at exact scheduled time
2. **Mark as Attended**: Automatically marks past appointments as ATENDIDO
3. **Payment Reminders**: Sends payment reminder to SANITHELP-JJ 1 hour after consultation

Location: [server.js:13369-13383](server.js#L13369-L13383)

## Important Patterns & Gotchas

### Images and Base64
- Patient photos stored as base64 in PostgreSQL
- **NEVER** include `foto` field in list queries (causes memory issues)
- Always exclude in SELECT: `SELECT _id, nombre, apellido FROM ...` (not SELECT *)

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
- Middleware: `authMiddleware` (validates token), `requireAdmin` (checks role)
- Permissions checked via `hasPermission()` function
- Token expiration: 24 hours

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
