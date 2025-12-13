# Sistema de Turnos y Agendamiento de Médicos

## Arquitectura General

El sistema de agendamiento está implementado en tres capas:
- **Backend**: Node.js/Express en `server.js`
- **Frontend**: HTML/JavaScript en `public/`
- **Integración WIX**: Código en `WIX/`

---

## Tablas de Base de Datos

### Tabla `medicos`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | SERIAL PK | Identificador único |
| primer_nombre | VARCHAR | Nombre del médico |
| primer_apellido | VARCHAR | Apellido del médico |
| especialidad | VARCHAR | Especialidad médica |
| numero_licencia | VARCHAR | Número de licencia profesional |
| tipo_licencia | VARCHAR | Tipo de licencia |
| fecha_vencimiento_licencia | DATE | Vencimiento de licencia |
| firma | TEXT | Firma digital en base64 |
| tiempo_consulta | INT | Duración de consulta en minutos (default: 10) |
| activo | BOOLEAN | Estado del médico |

### Tabla `medicos_disponibilidad`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | SERIAL PK | Identificador único |
| medico_id | INT FK | Referencia a tabla médicos |
| dia_semana | INT | 0-6 (Domingo a Sábado) |
| hora_inicio | TIME | Hora de inicio de atención |
| hora_fin | TIME | Hora de fin de atención |
| modalidad | VARCHAR(20) | 'presencial' o 'virtual' |
| activo | BOOLEAN | Si está activo ese día |

**Constraint UNIQUE**: `(medico_id, dia_semana, modalidad)`

### Tabla `HistoriaClinica` (Citas/Órdenes)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| _id | UUID | Identificador único de la cita |
| numeroId | VARCHAR | Cédula del paciente |
| medico | VARCHAR | Nombre del médico asignado |
| fechaAtencion | TIMESTAMP | Fecha de la cita |
| horaAtencion | VARCHAR | Hora específica (HH:MM) |
| atendido | VARCHAR | Estado: PENDIENTE, ATENDIDO |
| modalidad | VARCHAR | Presencial o Virtual |

---

## Endpoints API

### Gestión de Disponibilidad

#### GET `/api/medicos/:id/disponibilidad`
Obtiene la disponibilidad configurada de un médico.

**Query params:**
- `modalidad` (opcional): 'presencial' o 'virtual'

#### POST `/api/medicos/:id/disponibilidad`
Guarda la disponibilidad para una modalidad específica.

**Body:**
```json
{
  "disponibilidad": [
    {"dia_semana": 1, "hora_inicio": "08:00", "hora_fin": "17:00", "activo": true}
  ],
  "modalidad": "presencial"
}
```

#### PUT `/api/medicos/:id/tiempo-consulta`
Actualiza la duración de consulta (5-120 minutos).

### Obtención de Horarios Disponibles

#### GET `/api/horarios-disponibles`
Obtiene horarios libres para un médico en una fecha y modalidad.

**Query params:**
- `fecha`: YYYY-MM-DD
- `medico`: nombre del médico
- `modalidad`: 'presencial' o 'virtual' (default: presencial)

**Lógica:**
1. Determina el día de la semana
2. Busca configuración de disponibilidad del médico
3. Si no existe, usa rango por defecto (6:00-23:00)
4. Obtiene citas ocupadas
5. Genera slots basados en `tiempo_consulta`
6. Retorna horarios con disponibilidad

#### GET `/api/turnos-disponibles`
Obtiene turnos consolidados de TODOS los médicos (excepto NUBIA).

**Query params:**
- `fecha`: YYYY-MM-DD
- `modalidad`: 'presencial' o 'virtual'

**Lógica:**
1. Para cada médico disponible ese día genera slots
2. Consolida por hora (múltiples médicos misma hora)
3. Filtra horas pasadas si es hoy
4. Retorna cantidad de médicos disponibles por hora

#### GET `/api/medicos-por-modalidad`
Obtiene médicos que atienden una modalidad específica.

### Endpoints del Calendario

#### GET `/api/calendario/mes`
Conteo de citas por día del mes.

#### GET `/api/calendario/mes-detalle`
Citas agrupadas por médico y estado (ATENDIDO, PENDIENTE, VENCIDO).

#### GET `/api/calendario/dia`
Todas las citas de un día específico.

---

## Flujo de Creación de Cita

### POST `/api/ordenes`

### Asignación Automática de Médico

Si no se proporciona médico:
1. Busca médicos activos disponibles para ese día, modalidad y hora
2. **Excluye a NUBIA**
3. Verifica que no tengan cita a esa hora
4. Asigna el primer médico disponible

---

## Modalidades y Estados

| Modalidad | Descripción |
|-----------|-------------|
| Presencial | Atención en sitio |
| Virtual | Atención remota |

| Estado | Descripción |
|--------|-------------|
| PENDIENTE | Cita programada |
| ATENDIDO | Cita completada |
| VENCIDA | Fecha pasada sin atender |

---

## Generación de Slots

Se genera basándose en:
1. **Configuración de disponibilidad** del médico
2. **Tiempo de consulta** por médico (default: 10 min)
3. **Citas existentes** para evitar conflictos

---

## Consideraciones Especiales

- **NUBIA**: Excluida de asignaciones automáticas, se gestiona aparte
- **Timezone**: Colombia (UTC-5)
- **Rango por defecto**: 6:00-23:00 si no hay configuración
- **Sin overbooking**: Previene dos citas a la misma hora

---

## Archivos Principales

| Archivo | Descripción |
|---------|-------------|
| `server.js` | Backend con endpoints |
| `public/calendario.html` | Gestión de disponibilidad |
| `public/medicos.html` | CRUD de médicos |
| `public/nueva-orden.html` | Creación de citas |
| `public/ordenes.html` | Visualización de órdenes |
