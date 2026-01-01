# Webhook WhatsApp para Creación de Órdenes

## Resumen

Cuando una empresa crea una orden desde el panel de empresas, se envía automáticamente un mensaje de WhatsApp al paciente a través de Make.com.

## Flujo de Funcionamiento

1. **Empresa crea orden** → Panel Empresas (`/panel-empresas.html`)
2. **Backend guarda en PostgreSQL** → Endpoint `POST /api/ordenes` ([server.js:3879](server.js#L3879))
3. **Dispara webhook a Make.com** → Función `dispararWebhookMake()` ([server.js:4055-4067](server.js#L4055-L4067))
4. **Make.com recibe datos** → URL: `https://hook.us1.make.com/3edkq8bfppx31t6zbd86sfu7urdrhti9`
5. **Make.com envía WhatsApp** → Al número del paciente

## Datos Enviados al Webhook

El webhook recibe los siguientes parámetros vía GET:

| Parámetro | Descripción | Transformación | Ejemplo |
|-----------|-------------|----------------|---------|
| `cel` | Celular del paciente | Sin prefijo +57/57 | `3001234567` |
| `cedula` | Número de documento | Sin acentos, sin espacios, sin puntos | `1023456789` |
| `nombre` | Primer nombre | Sin acentos, sin espacios | `JuanCarlos` |
| `empresa` | Código empresa | Sin acentos, sin espacios | `SITEL` |
| `genero` | Género del paciente | Detectado automáticamente | `FEMENINO` o vacío |
| `ciudad` | Ciudad mapeada | Mayúsculas, sin acentos, sin espacios | `BOGOTA`, `MEDELLIN` |
| `fecha` | Fecha de atención | Formato local Colombia | `29/12/2025` |
| `hora` | Hora de atención | Formato 24h | `14:30` |
| `medico` | Médico asignado | Sin acentos o "PRESENCIAL" | `PRESENCIAL` o `DrAlonsoMartinez` |
| `id` | ID de la orden | UUID generado | `orden_1735567890123_abc123xyz` |

## Funciones de Transformación

### 1. `mapearCiudadWebhook(ciudad)` - [server.js:211-260](server.js#L211-L260)

Mapea ciudades colombianas al formato esperado por Make.com:

```javascript
// Entrada: "Bogotá" → Salida: "BOGOTA"
// Entrada: "Medellín" → Salida: "MEDELLIN"
// Entrada: "Santa Marta" → Salida: "SANTAMARTA"
```

**Ciudades soportadas (44 ciudades):**
- `BOGOTA`, `MEDELLIN`, `CALI`, `BARRANQUILLA`, `CARTAGENA`
- `CUCUTA`, `BUCARAMANGA`, `PEREIRA`, `SANTAMARTA`, `IBAGUE`
- `PASTO`, `MANIZALES`, `NEIVA`, `VILLAVICENCIO`, `ARMENIA`
- `VALLEDUPAR`, `MONTERIA`, `SINCELEJO`, `POPAYAN`, `FLORIDABLANCA`
- `BUENAVENTURA`, `SOLEDAD`, `ITAGUI`, `SOACHA`, `BELLO`
- `PALMIRA`, `TUNJA`, `GIRARDOT`, `RIOHACHA`, `BARRANCABERMEJA`
- `DOSQUEBRADAS`, `ENVIGADO`, `TULUA`, `SOGAMOSO`, `DUITAMA`
- `ZIPAQUIRA`, `FACATATIVA`, `CHIA`, `FUSAGASUGA`, `OTRA`

Si la ciudad no está en el mapa, se usa transformación genérica (sin acentos, sin espacios, mayúsculas).

### 2. `limpiarTelefonoWebhook(telefono)` - [server.js:196-202](server.js#L196-L202)

Limpia el número de teléfono:
- Quita espacios y guiones
- Quita prefijos `+57` o `57`

```javascript
// Entrada: "+57 300 123 4567" → Salida: "3001234567"
// Entrada: "57-300-123-4567" → Salida: "3001234567"
```

### 3. `limpiarStringWebhook(str)` - [server.js:187-193](server.js#L187-L193)

Limpia strings generales:
- Quita acentos (á→a, é→e, ñ→n)
- Quita espacios, puntos y tabulaciones

```javascript
// Entrada: "Juan Carlos López" → Salida: "JuanCarlosLopez"
// Entrada: "S.I.T.E.L." → Salida: "SITEL"
```

### 4. `determinarGeneroWebhook(examenes)` - [server.js:205-208](server.js#L205-L208)

Detecta género basado en exámenes:

```javascript
// Si examenes incluye "Serología" → "FEMENINO"
// De lo contrario → "" (vacío)
```

## Ejemplo de URL Generada

```
https://hook.us1.make.com/3edkq8bfppx31t6zbd86sfu7urdrhti9?
  cel=3001234567&
  cedula=1023456789&
  nombre=JuanCarlos&
  empresa=SITEL&
  genero=&
  ciudad=BOGOTA&
  fecha=29/12/2025&
  hora=14:30&
  medico=PRESENCIAL&
  id=orden_1735567890123_abc123xyz
```

## Logs en el Servidor

Al crear una orden, verás en los logs:

```
═══════════════════════════════════════════════════════════
📋 CREANDO NUEVA ORDEN
═══════════════════════════════════════════════════════════
💾 Guardando en PostgreSQL HistoriaClinica...
✅ PostgreSQL: Orden guardada con _id: orden_1735567890123_abc123xyz
✅ Webhook Make.com enviado: orden_1735567890123_abc123xyz
📤 Sincronizando con Wix...
```

## Comportamiento ante Errores

El webhook **NO bloquea** la creación de la orden:

- ✅ Si Make.com falla, la orden **SE CREA** de todas formas
- ✅ El error se registra en logs pero no afecta al usuario
- ✅ La empresa recibe confirmación de orden creada

## Código Relevante

- **Función principal:** `dispararWebhookMake()` - [server.js:263-289](server.js#L263-L289)
- **Invocación:** [server.js:4055-4067](server.js#L4055-L4067)
- **Mapeo de ciudades:** `mapearCiudadWebhook()` - [server.js:211-260](server.js#L211-L260)
- **Panel empresas:** [panel-empresas.html:4684-4764](public/panel-empresas.html#L4684-L4764)

## Testing

Para probar el webhook:

1. Crear una orden desde panel de empresas
2. Verificar logs del servidor: `✅ Webhook Make.com enviado`
3. Confirmar recepción en Make.com
4. Verificar mensaje de WhatsApp enviado al paciente

## Estado Actual

- ✅ **ACTIVADO** - El webhook se dispara automáticamente al crear órdenes
- ✅ Mapeo de ciudades implementado
- ✅ Transformación de datos completa
- ✅ Manejo de errores sin bloqueo

## Cambios Realizados (2026-01-01)

1. ✅ Agregada función `mapearCiudadWebhook()` con 44 ciudades colombianas
2. ✅ Actualizada función `dispararWebhookMake()` para usar el nuevo mapeo
3. ✅ Descomentado el llamado al webhook en creación de órdenes
4. ✅ Documentación completa del flujo

---

**Última actualización:** 2026-01-01
**Autor:** Daniel Talero (con Claude Code)
