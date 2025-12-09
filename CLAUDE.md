# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BSL Plataforma - Medical occupational system built with Node.js/Express backend and vanilla JavaScript frontend. The system captures patient medical information, stores it in PostgreSQL, and syncs data bidirectionally with an external Wix CMS.

## Development Commands

```bash
npm install        # Install dependencies
npm start          # Start production server (node server.js)
npm run dev        # Start development server with auto-reload (nodemon)
```

Server runs on port 8080 by default (configurable via PORT env var).

## Architecture

### Backend (server.js)
- Express server with PostgreSQL connection pool (`pg` library)
- Single `formularios` table with auto-migration for new columns on startup
- Three main API integrations with Wix CMS:
  - `GET /api/wix/:id` - Fetch patient data from Wix by ID
  - `POST` to Wix's `crearFormulario` - Create new form entries
  - `POST` to Wix's `actualizarFormulario` - Update existing entries (uses two-step: query by idGeneral, then update by _id)

### Frontend (public/)
- Multi-step wizard form with slide-based navigation
- `script.js` handles:
  - Wix data pre-population via URL parameter `?_id=xxx`
  - Real-time field validation with visual feedback
  - Signature canvas capture (mouse/touch)
  - Client-side image compression before upload (600px max, 60% quality)
  - Conditional redirect after submission based on `codEmpresa` or `examenes` field

### Data Flow
1. Form opened with `?_id=xxx` URL parameter
2. Frontend fetches patient data from `/api/wix/:id`
3. User completes multi-step form (pre-filled with Wix data)
4. On submit: save to PostgreSQL first, then sync to Wix
5. Redirect to appropriate follow-up test based on company code or exam type

### Key Tables
- `formularios` - Main form submissions (PostgreSQL)
- `HistoriaClinica` - Medical history lookup table (read-only, linked by numeroId/cédula)

## Environment Variables

Required in `.env`:
```
DB_HOST=      # PostgreSQL host (DigitalOcean)
DB_PORT=      # Usually 25060
DB_USER=
DB_PASSWORD=
DB_NAME=      # Usually 'defaultdb'
PORT=         # Server port (default 8080)
```

## Important Notes

- Images (foto) are stored as base64 in PostgreSQL; excluded from list queries to prevent memory issues
- Field mappings between frontend (camelCase), PostgreSQL (snake_case), and Wix (camelCase) require careful attention
- Health survey responses are converted to tag arrays for Wix (only "Sí" responses)
- Wix sync failures are logged but don't block the response to user
