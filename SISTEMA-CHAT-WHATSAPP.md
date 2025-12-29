# Sistema Multi-Agente de WhatsApp

**Documentación técnica completa del sistema de atención por chat con múltiples agentes humanos y bot automático.**

---

## 📋 Tabla de Contenidos

1. [Descripción General](#descripción-general)
2. [Arquitectura del Sistema](#arquitectura-del-sistema)
3. [Roles del Sistema](#roles-del-sistema)
4. [Base de Datos](#base-de-datos)
5. [Flujo de Mensajes](#flujo-de-mensajes)
6. [Reglas de Enrutamiento](#reglas-de-enrutamiento)
7. [Endpoints API](#endpoints-api)
8. [Paneles de Usuario](#paneles-de-usuario)
9. [Configuración e Instalación](#configuración-e-instalación)
10. [Uso del Sistema](#uso-del-sistema)
11. [Notificaciones en Tiempo Real](#notificaciones-en-tiempo-real)

---

## Descripción General

### ¿Para qué sirve?

El sistema permite que **múltiples agentes humanos atiendan conversaciones de WhatsApp simultáneamente**, mientras que un **bot automático** maneja consultas simples. El sistema decide inteligentemente cuándo derivar una conversación a un agente humano basándose en reglas configurables.

### Características principales

- ✅ **Múltiples agentes** trabajando en paralelo
- ✅ **Asignación automática** por carga de trabajo (round-robin)
- ✅ **Bot + Humano** funcionando simultáneamente
- ✅ **Reglas inteligentes** de enrutamiento (keywords, horarios)
- ✅ **Notificaciones en tiempo real** vía Server-Sent Events (SSE)
- ✅ **Transferencia** de conversaciones entre agentes
- ✅ **Supervisión completa** para administradores
- ✅ **Historial** de todas las conversaciones
- ✅ **Control de bot** por conversación (activar/desactivar)

---

## Arquitectura del Sistema

### Componentes

```
┌─────────────────────────────────────────────────────────────┐
│                         WHATSAPP                             │
│                            ↓                                 │
│                        TWILIO                                │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                    WIX HTTP FUNCTIONS                        │
│            (post_twilioWhatsAppWebhook)                      │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│              POSTGRESQL (BSL Plataforma)                     │
│                POST /api/whatsapp/webhook                    │
│                                                              │
│    ┌────────────────────────────────────────────────┐       │
│    │  1. Guardar mensaje                            │       │
│    │  2. Evaluar reglas de enrutamiento             │       │
│    │  3. Decidir: BOT o HUMANO                      │       │
│    │  4. Si HUMANO → Asignar agente automáticamente │       │
│    │  5. Notificar agente vía SSE                   │       │
│    └────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
                             ↓
        ┌────────────────────┴───────────────────┐
        ↓                                        ↓
┌──────────────────┐                  ┌──────────────────┐
│   BOT (Wix)      │                  │  AGENTE HUMANO   │
│   Responde auto  │                  │  panel-agentes   │
└──────────────────┘                  └──────────────────┘
```

### Stack Tecnológico

- **Backend**: Node.js + Express.js
- **Base de datos**: PostgreSQL (Digital Ocean)
- **Frontend**: Vanilla JavaScript (sin frameworks)
- **Autenticación**: JWT (JSON Web Tokens)
- **Notificaciones**: Server-Sent Events (SSE)
- **Integración**: Twilio + Wix CMS
- **Estilos**: CSS personalizado

---

## Roles del Sistema

### 1. `agente_chat`

**Descripción**: Agente humano que atiende conversaciones de WhatsApp.

**Permisos**:
- `CHAT_VER_CONVERSACIONES` - Ver conversaciones asignadas
- `CHAT_RESPONDER` - Enviar mensajes a pacientes
- `CHAT_TRANSFERIR` - Transferir chat a otro agente
- `CHAT_ACTIVAR_BOT` - Activar/desactivar bot por conversación
- `CHAT_CERRAR` - Cerrar conversación

**Panel de acceso**: `/panel-agentes.html`

**Login redirige a**: `/panel-agentes.html`

**Restricciones**:
- ❌ No puede ver conversaciones de otros agentes
- ❌ No tiene acceso a datos médicos
- ❌ No puede acceder a panel-admin

---

### 2. `supervisor_chat`

**Descripción**: Supervisor que monitorea todos los agentes y conversaciones.

**Permisos**:
- `CHAT_VER_TODAS` - Ver conversaciones de todos los agentes
- Asignar/reasignar conversaciones manualmente
- Ver estadísticas en tiempo real
- Ver estado de todos los agentes

**Panel de acceso**: `/panel-supervisor-chats.html`

**Login redirige a**: `/panel-supervisor-chats.html`

**Restricciones**:
- ❌ No puede crear/editar usuarios (solo admin)
- ❌ No puede modificar configuración del sistema

---

### 3. `admin`

**Descripción**: Administrador del sistema completo.

**Permisos**: Todos los permisos del sistema

**Panel de acceso**:
- `/panel-admin.html` (gestión general)
- `/panel-supervisor-chats.html` (supervisión de chats)

**Login redirige a**: `/panel-admin.html`

---

## Base de Datos

### Tablas del Sistema de Chat

#### 1. `conversaciones_whatsapp`

Almacena las conversaciones de WhatsApp.

```sql
CREATE TABLE conversaciones_whatsapp (
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
    sincronizado_wix BOOLEAN DEFAULT false,
    CONSTRAINT unique_celular_activa UNIQUE (celular) WHERE estado != 'cerrada'
);
```

**Estados posibles**:
- `nueva` - Conversación recién creada, sin asignar
- `activa` - Asignada a un agente, en curso
- `cerrada` - Finalizada

**Canales**:
- `bot` - Bot automático está respondiendo
- `humano` - Agente humano está respondiendo

**Índices**:
```sql
CREATE INDEX idx_conv_celular ON conversaciones_whatsapp(celular);
CREATE INDEX idx_conv_asignado ON conversaciones_whatsapp(asignado_a);
CREATE INDEX idx_conv_estado ON conversaciones_whatsapp(estado);
```

---

#### 2. `mensajes_whatsapp`

Almacena todos los mensajes de las conversaciones.

```sql
CREATE TABLE mensajes_whatsapp (
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
    sincronizado_wix BOOLEAN DEFAULT false
);
```

**Dirección**:
- `entrada` - Mensaje del paciente
- `salida` - Mensaje del agente/bot

**Tipo de mensaje**:
- `text` - Texto plano
- `image` - Imagen
- `document` - Documento
- `audio` - Audio

**Índices**:
```sql
CREATE INDEX idx_msg_conversacion ON mensajes_whatsapp(conversacion_id);
CREATE INDEX idx_msg_timestamp ON mensajes_whatsapp(timestamp);
```

---

#### 3. `agentes_estado`

Estado en tiempo real de cada agente.

```sql
CREATE TABLE agentes_estado (
    user_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    estado VARCHAR(20) NOT NULL DEFAULT 'offline',
    conversaciones_activas INTEGER DEFAULT 0,
    max_conversaciones INTEGER DEFAULT 5,
    ultima_actividad TIMESTAMP DEFAULT NOW(),
    auto_asignar BOOLEAN DEFAULT true,
    notas TEXT,
    CONSTRAINT check_conversaciones CHECK (
        conversaciones_activas >= 0 AND
        conversaciones_activas <= max_conversaciones
    )
);
```

**Estados posibles**:
- `disponible` - Puede recibir nuevas conversaciones
- `ocupado` - No recibe nuevas, mantiene las actuales
- `ausente` - Temporalmente ausente
- `offline` - Desconectado

**Lógica de asignación**:
- Solo agentes con `estado = 'disponible'` y `auto_asignar = true` reciben conversaciones
- Se asigna al agente con **menor** `conversaciones_activas`
- Respeta el límite `max_conversaciones` (por defecto 5)

---

#### 4. `transferencias_conversacion`

Historial de transferencias entre agentes.

```sql
CREATE TABLE transferencias_conversacion (
    id SERIAL PRIMARY KEY,
    conversacion_id INTEGER NOT NULL REFERENCES conversaciones_whatsapp(id) ON DELETE CASCADE,
    de_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    a_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    de_canal VARCHAR(10),
    a_canal VARCHAR(10),
    motivo TEXT,
    fecha_transferencia TIMESTAMP DEFAULT NOW()
);
```

**Casos de uso**:
- Transferir de agente A a agente B
- Transferir de bot a humano
- Transferir de humano a bot

---

#### 5. `reglas_enrutamiento`

Reglas para decidir si un mensaje va al bot o a un agente humano.

```sql
CREATE TABLE reglas_enrutamiento (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    prioridad INTEGER DEFAULT 0,
    activo BOOLEAN DEFAULT true,
    condiciones JSONB NOT NULL,
    asignar_a VARCHAR(20) NOT NULL,
    agente_especifico_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    etiqueta_auto TEXT,
    fecha_creacion TIMESTAMP DEFAULT NOW()
);
```

**Estructura de condiciones (JSONB)**:
```json
{
  "keywords": ["urgente", "emergencia"],
  "horario": {
    "desde": "08:00",
    "hasta": "18:00"
  }
}
```

**Reglas por defecto** (creadas automáticamente):

1. **Fuera de horario → Bot** (Prioridad: 10)
   ```json
   {
     "horario": { "desde": "08:00", "hasta": "18:00" }
   }
   ```

2. **Emergencias → Agente** (Prioridad: 20)
   ```json
   {
     "keywords": ["urgente", "emergencia", "ayuda", "problema grave"]
   }
   ```

3. **Solicitar humano → Agente** (Prioridad: 15)
   ```json
   {
     "keywords": ["hablar con persona", "asesor", "operador", "humano"]
   }
   ```

---

## Flujo de Mensajes

### Flujo completo de un mensaje entrante

```
1. PACIENTE ESCRIBE POR WHATSAPP
   ↓
2. TWILIO RECIBE EL MENSAJE
   ↓
3. TWILIO → WIX HTTP FUNCTION (post_twilioWhatsAppWebhook)
   ↓
4. WIX → POSTGRESQL WEBHOOK (POST /api/whatsapp/webhook)
   ↓
5. POSTGRESQL:
   5.1. Buscar o crear conversación
   5.2. Guardar mensaje en mensajes_whatsapp
   5.3. Actualizar fecha_ultima_actividad
   5.4. Evaluar reglas de enrutamiento (determinarCanal())
   5.5. ¿Resultado?
        ├─ BOT → Retornar { detener_bot: false }
        └─ HUMANO → Asignar agente (asignarConversacionAutomatica())
             ├─ Buscar agente disponible con menos carga
             ├─ Asignar conversación
             ├─ Incrementar contador
             ├─ Notificar agente vía SSE (evento 'nueva_conversacion')
             └─ Retornar { detener_bot: true, asignado_a: X }
   ↓
6. WIX RECIBE RESPUESTA:
   ├─ detener_bot = false → Bot continúa respondiendo
   └─ detener_bot = true → Bot se detiene, espera humano
   ↓
7. AGENTE HUMANO:
   7.1. Recibe notificación en tiempo real (SSE)
   7.2. Conversación aparece en su lista
   7.3. Abre chat y responde
   7.4. POST /api/agentes/conversacion/:id/mensaje
   7.5. Backend envía mensaje vía Wix/Twilio
   7.6. Mensaje llega a WhatsApp del paciente
```

---

### Algoritmo de Asignación Automática (Round-Robin)

**Función**: `asignarConversacionAutomatica(conversacionId)`

**Ubicación**: `server.js` línea 1354-1400

**Lógica**:

```javascript
1. Buscar agentes disponibles:
   - estado = 'disponible'
   - auto_asignar = true
   - conversaciones_activas < max_conversaciones
   - ultima_actividad < 5 minutos (conectados)

2. Ordenar por carga:
   - ORDER BY conversaciones_activas ASC

3. Seleccionar el primero (menor carga)

4. Si no hay agentes disponibles:
   - Retornar null
   - Conversación queda sin asignar

5. Si hay agente disponible:
   - UPDATE conversaciones_whatsapp SET asignado_a = X
   - UPDATE agentes_estado SET conversaciones_activas++
   - Notificar vía SSE
   - Retornar agente_id
```

---

### Evaluación de Reglas de Enrutamiento

**Función**: `determinarCanal(mensaje, celular, conversacion)`

**Ubicación**: `server.js` línea 1402-1459

**Lógica**:

```javascript
1. Si conversación ya está con agente humano y bot desactivado:
   → Retornar 'humano'

2. Obtener reglas activas ordenadas por prioridad DESC

3. Para cada regla:
   3.1. Evaluar keywords:
        - Si mensaje contiene alguna keyword → Asignar según regla

   3.2. Evaluar horario:
        - Si fuera de horario → 'bot'
        - Si dentro de horario → Continuar evaluando

4. Si ninguna regla aplica:
   → Retornar 'bot' (por defecto)
```

---

## Endpoints API

### Endpoints para Agentes (`/api/agentes/*`)

Requieren autenticación y rol `agente_chat`.

#### GET `/api/agentes/conversaciones`

Obtiene las conversaciones asignadas al agente.

**Query params**:
- `estado` (opcional): `activa`, `nueva`, `cerrada`, `todas`
- `limit` (opcional): Número máximo de resultados

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "celular": "3001234567",
      "nombre_paciente": "Juan Pérez",
      "estado": "activa",
      "canal": "humano",
      "bot_activo": false,
      "fecha_ultima_actividad": "2025-12-29T10:30:00Z",
      "mensajes_no_leidos": 2
    }
  ]
}
```

---

#### GET `/api/agentes/conversacion/:id/mensajes`

Obtiene los mensajes de una conversación.

**Params**:
- `id`: ID de la conversación

**Query params**:
- `limit` (opcional): Número de mensajes (default: 100)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "direccion": "entrada",
      "contenido": "Hola, necesito ayuda",
      "timestamp": "2025-12-29T10:25:00Z",
      "enviado_por_tipo": "paciente"
    },
    {
      "id": 2,
      "direccion": "salida",
      "contenido": "¿En qué te puedo ayudar?",
      "timestamp": "2025-12-29T10:26:00Z",
      "enviado_por_tipo": "agente",
      "enviado_por_nombre": "María López"
    }
  ]
}
```

---

#### POST `/api/agentes/conversacion/:id/mensaje`

Envía un mensaje a un paciente.

**Params**:
- `id`: ID de la conversación

**Body**:
```json
{
  "contenido": "Texto del mensaje"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Mensaje enviado correctamente",
  "data": {
    "id": 3,
    "contenido": "Texto del mensaje",
    "timestamp": "2025-12-29T10:27:00Z"
  }
}
```

---

#### PUT `/api/agentes/conversacion/:id/transferir`

Transfiere una conversación a otro agente.

**Params**:
- `id`: ID de la conversación

**Body**:
```json
{
  "agente_destino_id": 5,
  "motivo": "Especialización en área médica"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Conversación transferida correctamente"
}
```

---

#### PUT `/api/agentes/conversacion/:id/bot`

Activa o desactiva el bot para una conversación.

**Params**:
- `id`: ID de la conversación

**Body**:
```json
{
  "bot_activo": false
}
```

**Response**:
```json
{
  "success": true,
  "message": "Bot desactivado para esta conversación"
}
```

---

#### PUT `/api/agentes/conversacion/:id/cerrar`

Cierra una conversación.

**Params**:
- `id`: ID de la conversación

**Response**:
```json
{
  "success": true,
  "message": "Conversación cerrada correctamente"
}
```

---

#### PUT `/api/agentes/estado`

Cambia el estado del agente.

**Body**:
```json
{
  "estado": "disponible",
  "auto_asignar": true,
  "max_conversaciones": 5
}
```

**Estados válidos**: `disponible`, `ocupado`, `ausente`, `offline`

**Response**:
```json
{
  "success": true,
  "message": "Estado actualizado correctamente"
}
```

---

### Endpoints para Supervisores/Admins (`/api/admin/*`)

Requieren autenticación y rol `admin` o `supervisor_chat`.

#### GET `/api/admin/agentes`

Obtiene todos los agentes con su estado.

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 3,
      "nombre_completo": "María López",
      "email": "maria@ejemplo.com",
      "estado": "disponible",
      "conversaciones_activas": 2,
      "max_conversaciones": 5,
      "ultima_actividad": "2025-12-29T10:28:00Z",
      "auto_asignar": true
    }
  ]
}
```

---

#### GET `/api/admin/conversaciones`

Obtiene todas las conversaciones del sistema.

**Query params**:
- `estado` (opcional): Filtrar por estado
- `limit` (opcional): Límite de resultados

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "celular": "3001234567",
      "nombre_paciente": "Juan Pérez",
      "asignado_a": 3,
      "agente_nombre": "María López",
      "estado": "activa",
      "canal": "humano",
      "fecha_ultima_actividad": "2025-12-29T10:30:00Z",
      "mensajes_no_leidos": 2
    }
  ]
}
```

---

#### PUT `/api/admin/asignar-conversacion/:id`

Asigna manualmente una conversación a un agente.

**Params**:
- `id`: ID de la conversación

**Body**:
```json
{
  "agente_id": 5
}
```

**Response**:
```json
{
  "success": true,
  "message": "Conversación asignada correctamente"
}
```

---

#### GET `/api/admin/estadisticas-chat`

Obtiene estadísticas del sistema de chat.

**Response**:
```json
{
  "success": true,
  "data": {
    "agentes_online": 5,
    "agentes_total": 8,
    "conversaciones_activas": 12,
    "conversaciones_hoy": 47,
    "tiempo_respuesta_promedio": "2.3 min"
  }
}
```

---

### Endpoint Público (sin autenticación)

#### POST `/api/whatsapp/webhook`

Recibe mensajes desde Wix/Twilio.

**Body**:
```json
{
  "from": "573001234567",
  "body": "Hola, necesito ayuda",
  "sid": "SM1234567890abcdef",
  "timestamp": "2025-12-29T10:25:00Z",
  "fromName": "Juan Pérez"
}
```

**Response (Bot)**:
```json
{
  "success": true,
  "canal": "bot",
  "detener_bot": false
}
```

**Response (Humano)**:
```json
{
  "success": true,
  "canal": "humano",
  "asignado_a": 3,
  "detener_bot": true
}
```

---

## Paneles de Usuario

### 1. Panel de Agentes (`/panel-agentes.html`)

**Acceso**: Usuarios con rol `agente_chat`

**Diseño**: Layout de 3 columnas

#### Columna Izquierda: Lista de Conversaciones

```
┌─────────────────────────┐
│ Conversaciones (5)      │
├─────────────────────────┤
│ [Buscar...]             │
│ [Filtro: Activas ▼]     │
├─────────────────────────┤
│ 🔴 Juan Pérez           │
│    Necesito ayuda...    │
│    Hace 2 min      (3)  │ ← Badge con mensajes no leídos
├─────────────────────────┤
│ Ana Gómez               │
│    Gracias por...       │
│    Hace 15 min          │
└─────────────────────────┘
```

**Funcionalidades**:
- Buscar por nombre o teléfono
- Filtrar por estado (Activas, Nuevas, Todas, Cerradas)
- Badge rojo indica mensajes no leídos
- Click abre el chat en columna central

---

#### Columna Central: Chat Activo

```
┌───────────────────────────────────┐
│ Juan Pérez | 📱 3001234567         │
│ [🤖 Bot: Inactivo] [Transferir] [Cerrar] │
├───────────────────────────────────┤
│                                   │
│  Juan: Hola, necesito ayuda       │
│  [10:25]                          │
│                                   │
│         Tú: ¿En qué te puedo      │
│         ayudar?                   │
│         [10:26] ✓✓                │
│                                   │
├───────────────────────────────────┤
│ [Escribe mensaje...]        [📤]  │
└───────────────────────────────────┘
```

**Funcionalidades**:
- Ver historial completo de mensajes
- Enviar mensajes (Enter o click en 📤)
- Toggle bot (activar/desactivar)
- Transferir conversación
- Cerrar chat
- Auto-scroll a mensajes nuevos

---

#### Columna Derecha: Info del Paciente

```
┌──────────────────────┐
│ Juan Pérez           │
│ 📱 3001234567        │
│ 🆔 123456789         │
│                      │
│ 🏥 Empresa: SITEL    │
│ 📅 Última cita:      │
│    2025-12-15        │
│                      │
│ 🏷️ Etiquetas:        │
│ • Urgente            │
│                      │
│ [Desactivar Bot]     │
│ [Transferir]         │
│ [Cerrar Chat]        │
└──────────────────────┘
```

---

#### Header

```
┌─────────────────────────────────────────────────────┐
│ 👤 Agente de Chat                                   │
│                                                     │
│ Estado: [🟢 Disponible ▼]    María López [Cerrar]  │
└─────────────────────────────────────────────────────┘
```

**Selector de estado**:
- 🟢 Disponible - Recibe nuevas conversaciones
- 🟡 Ocupado - No recibe nuevas
- 🟠 Ausente - Temporalmente ausente
- 🔴 Offline - Desconectado

---

### 2. Panel de Supervisión (`/panel-supervisor-chats.html`)

**Acceso**: Usuarios con rol `admin` o `supervisor_chat`

#### Dashboard de Métricas

```
┌───────────────┬────────────────┬──────────────┬─────────────────┐
│ Agentes Online│ Conversaciones │ Tiempo Resp. │ Conversaciones  │
│               │ Activas        │              │ Hoy             │
├───────────────┼────────────────┼──────────────┼─────────────────┤
│      5        │      12        │   2.3 min    │       47        │
│  De 8 totales │  En este momento│ Promedio 24h│  Desde las 00:00│
└───────────────┴────────────────┴──────────────┴─────────────────┘
```

---

#### Tabla de Agentes

```
┌──────────────┬─────────────┬────────────────┬────────────────┬──────────┐
│ Agente       │ Estado      │ Conversaciones │ Última Act.    │ Acciones │
├──────────────┼─────────────┼────────────────┼────────────────┼──────────┤
│ María López  │ 🟢 Disponible│    2/5         │ Hace 1 min     │ [Ver]    │
│ Juan García  │ 🟡 Ocupado   │    5/5         │ Hace 3 min     │ [Ver]    │
│ Ana Martínez │ 🟢 Disponible│    1/5         │ Hace 2 min     │ [Ver]    │
│ Luis Rojas   │ 🔴 Offline   │    0/5         │ Hace 15 min    │ [Ver]    │
└──────────────┴─────────────┴────────────────┴────────────────┴──────────┘
```

---

#### Tabla de Conversaciones

```
┌───────────┬─────────────┬───────┬────────┬────────────┬──────────┬──────────┐
│ Paciente  │ Asignado a  │ Canal │ Estado │ Última Act.│ Mensajes │ Acciones │
├───────────┼─────────────┼───────┼────────┼────────────┼──────────┼──────────┤
│ Juan Pérez│ María López │ 👤    │ ACTIVA │ Hace 2min  │ 3 nuevos │ [Reasig] │
│ Ana Gómez │ Juan García │ 👤    │ ACTIVA │ Hace 5min  │    -     │ [Reasig] │
│ Pedro Ruiz│ Sin asignar │ 🤖    │ NUEVA  │ Ahora      │ 1 nuevo  │ [Asignar]│
└───────────┴─────────────┴───────┴────────┴────────────┴──────────┴──────────┘
```

**Funcionalidades**:
- Ver todas las conversaciones del sistema
- Filtrar por estado
- Asignar conversaciones manualmente
- Reasignar conversaciones
- Ver estado de agentes en tiempo real
- Auto-refresh cada 10 segundos

---

#### Modal de Asignación

```
┌─────────────────────────────────┐
│ Asignar Conversación        [×] │
├─────────────────────────────────┤
│ Paciente:                       │
│ Juan Pérez (3001234567)         │
│                                 │
│ Asignar a:                      │
│ [María López - 2/5 conv.    ▼]  │
│                                 │
│         [Cancelar]  [Asignar]   │
└─────────────────────────────────┘
```

---

## Notificaciones en Tiempo Real

### Tecnología: Server-Sent Events (SSE)

**Endpoint**: `GET /api/whatsapp/stream`

**Requiere**: Autenticación JWT

---

### Conexión SSE (Cliente)

```javascript
const eventSource = new EventSource('/api/whatsapp/stream', {
    headers: { 'Authorization': `Bearer ${token}` }
});

// Evento: Conectado
eventSource.addEventListener('connected', (e) => {
    console.log('Conectado:', JSON.parse(e.data));
});

// Evento: Nuevo mensaje
eventSource.addEventListener('nuevo_mensaje', (e) => {
    const data = JSON.parse(e.data);
    console.log('Nuevo mensaje en conversación:', data.conversacion_id);
    // Refrescar mensajes si es la conversación activa
    // Mostrar badge en la lista
    // Reproducir sonido
});

// Evento: Nueva conversación asignada
eventSource.addEventListener('nueva_conversacion', (e) => {
    const data = JSON.parse(e.data);
    console.log('Nueva conversación asignada:', data.conversacion_id);
    // Agregar a la lista
    // Reproducir sonido
    // Mostrar notificación
});

// Heartbeat (cada 30 segundos)
eventSource.addEventListener('message', (e) => {
    if (e.data === ': heartbeat') {
        console.log('Heartbeat recibido');
    }
});
```

---

### Notificaciones del Backend

**Función**: `notificarAgenteNuevoMensaje(agenteId, conversacionId, contenido)`

```javascript
function notificarAgenteNuevoMensaje(agenteId, conversacionId, contenido) {
    const res = sseClientesAgentes.get(agenteId);
    if (res) {
        res.write('event: nuevo_mensaje\n');
        res.write(`data: ${JSON.stringify({
            conversacion_id: conversacionId,
            contenido: contenido.substring(0, 50),
            timestamp: new Date()
        })}\n\n`);
    }
}
```

**Función**: `notificarAgenteNuevaConversacion(agenteId, conversacionId)`

```javascript
function notificarAgenteNuevaConversacion(agenteId, conversacionId) {
    const res = sseClientesAgentes.get(agenteId);
    if (res) {
        res.write('event: nueva_conversacion\n');
        res.write(`data: ${JSON.stringify({
            conversacion_id: conversacionId,
            timestamp: new Date()
        })}\n\n`);
    }
}
```

---

### Heartbeat

Cada 30 segundos se envía un heartbeat para mantener la conexión viva:

```javascript
const heartbeatInterval = setInterval(() => {
    res.write(': heartbeat\n\n');
}, 30000);
```

---

### Desconexión

Al cerrar el navegador o perder conexión:

```javascript
req.on('close', () => {
    clearInterval(heartbeatInterval);
    sseClientesAgentes.delete(userId);

    // Marcar agente como offline
    pool.query(`
        UPDATE agentes_estado
        SET estado = 'offline', ultima_actividad = NOW()
        WHERE user_id = $1
    `, [userId]);
});
```

---

## Configuración e Instalación

### Requisitos Previos

- Node.js v16 o superior
- PostgreSQL 12 o superior
- Cuenta de Twilio (para WhatsApp)
- Cuenta de Wix (para integración)

---

### Variables de Entorno

Crear archivo `.env` en la raíz:

```bash
# PostgreSQL
DB_HOST=your-database-host.com
DB_PORT=25060
DB_USER=your-db-user
DB_PASSWORD=your-secure-password
DB_NAME=defaultdb

# Servidor
PORT=8080

# JWT
JWT_SECRET=tu_secreto_super_seguro_aqui

# AWS S3 (opcional, para uploads)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_BUCKET_NAME=
```

---

### Instalación

```bash
# 1. Clonar repositorio
git clone https://github.com/tu-repo/BSL-PLATAFORMA.git
cd BSL-PLATAFORMA

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# 4. Iniciar servidor
npm start

# Para desarrollo (con auto-reload):
npm run dev
```

---

### Inicialización Automática

Al iniciar el servidor por primera vez, se crean automáticamente:

1. ✅ Tablas del sistema de chat (si no existen)
2. ✅ Constraint de roles actualizado
3. ✅ Índices en las tablas
4. ✅ 3 reglas de enrutamiento por defecto
5. ✅ Permisos para rol `agente_chat`

---

### Crear Primer Usuario Admin

**Opción 1: Desde panel de registro**
```
1. Ir a /registro.html
2. Llenar formulario
3. Esperar aprobación de admin existente
```

**Opción 2: Directo en base de datos**
```sql
-- Insertar usuario admin (reemplaza los valores)
INSERT INTO usuarios (
    email,
    password_hash,
    nombre_completo,
    rol,
    estado,
    activo
) VALUES (
    'admin@ejemplo.com',
    '$2b$10$...',  -- Hash de bcrypt para la contraseña
    'Administrador del Sistema',
    'admin',
    'aprobado',
    true
);
```

Para generar el hash de contraseña:
```javascript
const bcrypt = require('bcrypt');
const hash = await bcrypt.hash('tu_contraseña', 10);
console.log(hash);
```

---

## Uso del Sistema

### 1. Crear Agentes de Chat

**Como admin**:

1. Login → `/panel-admin.html`
2. Sección "Usuarios"
3. Click "+ Nuevo Usuario"
4. Llenar:
   - Nombre completo
   - Email
   - Password
   - **Rol: Agente de Chat**
5. Guardar

**El agente ya puede hacer login** en `/panel-agentes.html`

---

### 2. Crear Supervisor de Chat

**Como admin**:

1. Login → `/panel-admin.html`
2. Sección "Usuarios"
3. Click "+ Nuevo Usuario"
4. Llenar:
   - Nombre completo
   - Email
   - Password
   - **Rol: Supervisor de Chat**
5. Guardar

**El supervisor ya puede hacer login** y será redirigido a `/panel-supervisor-chats.html`

---

### 3. Flujo de Trabajo del Agente

```
1. Login con email y contraseña
   ↓
2. Redirige automáticamente a /panel-agentes.html
   ↓
3. Selector de estado → "🟢 Disponible"
   ↓
4. Esperar asignación automática o ver conversaciones existentes
   ↓
5. Cuando llega conversación:
   - 🔊 Sonido de notificación
   - 🔴 Badge rojo en la lista
   - 💬 Toast: "Nueva conversación asignada"
   ↓
6. Click en la conversación para abrirla
   ↓
7. Leer historial de mensajes
   ↓
8. Escribir respuesta y enviar (Enter o 📤)
   ↓
9. Opciones:
   - Desactivar bot (si quieres que solo tú respondas)
   - Transferir a otro agente
   - Cerrar conversación cuando termines
```

---

### 4. Transferir Conversación

**Desde panel-agentes.html**:

```
1. Abrir conversación
2. Click "Transferir"
3. Aparece modal
4. Seleccionar agente destino
5. Escribir motivo (opcional)
6. Click "Confirmar"
   ↓
7. Conversación desaparece de tu lista
8. Aparece en la lista del otro agente
9. El otro agente recibe notificación
```

---

### 5. Supervisar Agentes

**Como supervisor**:

```
1. Login → /panel-supervisor-chats.html
2. Ver dashboard de métricas en tiempo real
3. Revisar tabla de agentes (estados, carga)
4. Revisar tabla de conversaciones
5. Si hay conversación sin asignar:
   - Click "Asignar"
   - Seleccionar agente
   - Confirmar
6. Auto-refresh cada 10 segundos
```

---

### 6. Modificar Reglas de Enrutamiento

**Directamente en base de datos**:

```sql
-- Ver reglas actuales
SELECT * FROM reglas_enrutamiento ORDER BY prioridad DESC;

-- Crear nueva regla
INSERT INTO reglas_enrutamiento (
    nombre,
    prioridad,
    activo,
    condiciones,
    asignar_a,
    etiqueta_auto
) VALUES (
    'VIP - Asignar a agente específico',
    25,
    true,
    '{"keywords": ["vip", "premium"]}',
    'agente_especifico',
    'VIP'
);

-- Desactivar regla
UPDATE reglas_enrutamiento SET activo = false WHERE id = 1;

-- Cambiar prioridad
UPDATE reglas_enrutamiento SET prioridad = 30 WHERE id = 2;
```

---

## Troubleshooting

### Problema: Agente no recibe conversaciones

**Causas posibles**:
1. Estado no es "Disponible"
2. `auto_asignar = false`
3. `conversaciones_activas >= max_conversaciones`
4. `ultima_actividad > 5 minutos` (desconectado)

**Solución**:
```sql
-- Verificar estado del agente
SELECT * FROM agentes_estado WHERE user_id = X;

-- Resetear estado
UPDATE agentes_estado
SET estado = 'disponible',
    auto_asignar = true,
    conversaciones_activas = 0,
    ultima_actividad = NOW()
WHERE user_id = X;
```

---

### Problema: Notificaciones no llegan

**Causas posibles**:
1. SSE desconectado
2. Navegador bloqueando EventSource
3. Token expirado

**Solución**:
1. Refrescar página (F5)
2. Verificar en consola del navegador (F12)
3. Cerrar sesión y volver a hacer login

---

### Problema: Mensajes no se envían

**Causas posibles**:
1. Conversación no está asignada al agente
2. Conversación cerrada
3. Error en integración con Wix/Twilio

**Solución**:
1. Verificar que la conversación esté en tu lista
2. Ver logs del servidor: `tail -f logs/server.log`
3. Verificar conexión con Wix

---

## Arquitectura de Archivos

```
BSL-PLATAFORMA/
├── server.js                          # Backend principal (9000+ líneas)
├── package.json
├── .env                               # Variables de entorno
│
├── public/
│   ├── panel-agentes.html             # Panel de agentes (900 líneas)
│   ├── panel-supervisor-chats.html    # Panel de supervisión (800 líneas)
│   ├── panel-admin.html               # Panel admin (modificado)
│   │
│   ├── css/
│   │   └── chat-agentes.css           # Estilos del chat (750 líneas)
│   │
│   └── js/
│       └── auth.js                    # Módulo de autenticación (modificado)
│
├── WIX/
│   └── http-functions.js              # Funciones de Wix (referenciado)
│
└── SISTEMA-CHAT-WHATSAPP.md           # Esta documentación
```

---

## Roadmap / Mejoras Futuras

### Funcionalidades pendientes

- [ ] Panel de configuración de reglas de enrutamiento (UI)
- [ ] Estadísticas avanzadas (gráficos, métricas)
- [ ] Notificaciones push (navegador)
- [ ] Soporte para multimedia (imágenes, videos, audio)
- [ ] Plantillas de respuestas rápidas
- [ ] Búsqueda en historial de conversaciones
- [ ] Exportar conversaciones a PDF/CSV
- [ ] Integración con CRM
- [ ] Dashboard de reportes (conversaciones por hora, por agente, etc.)
- [ ] Categorización automática de conversaciones con IA

---

## Soporte y Contacto

Para reportar bugs o solicitar features:
- GitHub Issues: https://github.com/tu-repo/BSL-PLATAFORMA/issues
- Email: soporte@bsl.com.co

---

## Licencia

[Especifica tu licencia aquí]

---

**Fecha de última actualización**: 2025-12-29
**Versión del sistema**: 1.0.0
**Autor**: Daniel Talero (con Claude Code)
