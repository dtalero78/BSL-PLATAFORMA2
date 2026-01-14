# 📋 CATÁLOGO DE TEMPLATES DE TWILIO WHATSAPP

**Fecha**: 14 Enero 2026
**Estado**: ✅ ACTIVO
**Número WhatsApp**: +573153369631

---

## 📌 TEMPLATES CONFIGURADOS

### 1. **Template General (Por Defecto)**
```
SID: HX10034ddb435237059b7115fdb7646da2
Variable de entorno: TWILIO_CONTENT_TEMPLATE_SID
```

**Uso**:
- Notificaciones generales a coordinadores
- Alertas médicas de preguntas críticas
- Recordatorios de citas
- Links de pruebas virtuales
- Certificados disponibles
- Mensajes generales del sistema

**Mensajes que usan este template**:
1. ✅ Nueva Orden de Examen (coordinadores)
2. ✅ Alertas médicas de preguntas críticas
3. ✅ Recordatorio de cita próxima
4. ✅ Recordatorio de revisión de certificado
5. ✅ Confirmación de certificado disponible
6. ✅ Notificación de certificado listo
7. ✅ Link de pruebas virtuales
8. ✅ Link de prueba específica (Audiometría/Visiometría)

**Ubicaciones en código**:
- [server.js:372](server.js#L372) - Template por defecto en `sendWhatsAppMessage()`
- [server.js:496](server.js#L496) - Notificación a coordinador
- [server.js:563](server.js#L563) - Alertas de salud
- [server.js:1775](server.js#L1775) - Confirmación de registro
- [server.js:8419](server.js#L8419) - Recordatorio de cita
- [server.js:8543](server.js#L8543) - Recordatorio de pago
- [server.js:8608](server.js#L8608) - Certificado disponible
- [server.js:8762](server.js#L8762) - Certificado listo
- [server.js:8964](server.js#L8964) - Mensaje de pruebas virtuales
- [server.js:9835](server.js#L9835) - Link de prueba específica

---

### 2. **Template de Confirmación de Proceso**
```
SID: HX156f42644eaf38f9775d32e9ca39c73a
Variable de entorno: TWILIO_TEMPLATE_CONFIRMACION_PROCESO
```

**Uso**:
- Confirmación de continuidad del proceso de certificación
- Mensajes de seguimiento NUBIA

**Mensaje**:
```
Hola {nombre}. Necesitamos saber si continúas con el proceso o eliminamos el certificado. Gracias!
```

**Variables del template**:
- `{{1}}` = `nombre`: Nombre completo del paciente

**Ubicaciones en código**:
- [server.js:8808-8813](server.js#L8808-L8813) - Envío individual
- [server.js:8870-8875](server.js#L8870-L8875) - Envío masivo

---

### 3. **Template de Recordatorio de Cita Próxima**
```
SID: HX46fddaf93f19f21d72720743b836d237
Variable de entorno: TWILIO_TEMPLATE_RECORDATORIO_CITA
```

**Uso**:
- Recordatorio de cita médica virtual
- Envío de link de consulta 10 minutos antes de la cita

**Mensaje**:
```
Hola {nombre}, tu cita está próxima..

Comunícate ya haciendo clic en este link
```

**Variables del template**:
- `{{1}}` = `primerNombre`: Nombre del paciente
- `{{2}}` = `_id`: ID de la historia clínica (usado en URL del botón)

**Botón**:
- Tipo: URL Dinámica
- Texto: "Conectarme ahora" (o similar)
- URL: `https://sea-lion-app-qcttp.ondigitalocean.app/?_id={{2}}`

**Ubicaciones en código**:
- [server.js:8425-8433](server.js#L8425-L8433) - Envío automático (barridoNubiaEnviarLink)

---

## 🔧 CONFIGURACIÓN EN `.env`

```bash
# Template general (usado por defecto)
TWILIO_CONTENT_TEMPLATE_SID=HX10034ddb435237059b7115fdb7646da2

# Template específico de confirmación de proceso
TWILIO_TEMPLATE_CONFIRMACION_PROCESO=HX156f42644eaf38f9775d32e9ca39c73a

# Template específico de recordatorio de cita próxima
TWILIO_TEMPLATE_RECORDATORIO_CITA=HX46fddaf93f19f21d72720743b836d237
```

---

## 💻 USO EN CÓDIGO

### Función Principal: `sendWhatsAppMessage()`

```javascript
/**
 * @param {string} toNumber - Número de WhatsApp (puede incluir o no el prefijo 57)
 * @param {string} messageBody - Cuerpo del mensaje (para referencia, no se envía directamente)
 * @param {object} variables - Variables para interpolar en el template
 * @param {string|null} templateSid - SID del template a usar (opcional, usa el por defecto si no se especifica)
 * @returns {Promise<{success: boolean, sid?: string, status?: string, error?: string}>}
 */
async function sendWhatsAppMessage(toNumber, messageBody, variables = {}, templateSid = null)
```

### Ejemplos de Uso

#### 1. Usar template por defecto (general)
```javascript
await sendWhatsAppMessage(
    '573125727007',
    'Mensaje de notificación',
    { campo1: 'valor1' }
);
```

#### 2. Usar template específico (confirmación de proceso)
```javascript
await sendWhatsAppMessage(
    '573125727007',
    'Mensaje de confirmación',
    { nombre: 'Juan Pérez' },
    process.env.TWILIO_TEMPLATE_CONFIRMACION_PROCESO
);
```

---

## 📊 ESTADÍSTICAS DE USO

| Template | Endpoints que lo usan | Frecuencia estimada | Crítico |
|----------|----------------------|---------------------|---------|
| General (HX10034...) | 10+ endpoints | Alta (100+ mensajes/día) | ✅ Sí |
| Confirmación Proceso (HX156f...) | 2 endpoints | Media (10-50 mensajes/día) | ⚠️ Medio |
| Recordatorio Cita (HX46fd...) | 1 endpoint | Alta (50+ mensajes/día) | ✅ Sí |

---

## ⚙️ CÓMO AGREGAR UN NUEVO TEMPLATE

### Paso 1: Crear Template en Twilio Console
1. Ir a: https://console.twilio.com/us1/develop/sms/content-editor
2. Click en "Create Content"
3. Configurar el template con variables (usar formato: `{{1}}`, `{{2}}`, etc.)
4. Esperar aprobación de WhatsApp (puede tardar 24-48 horas)
5. Copiar el SID generado (formato: `HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

### Paso 2: Agregar a `.env`
```bash
# Nuevo template
TWILIO_TEMPLATE_NUEVO_TIPO=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Paso 3: Actualizar código
```javascript
// En el lugar donde necesites usar el template
await sendWhatsAppMessage(
    toNumber,
    'Mensaje de referencia',
    { variable1: 'valor1', variable2: 'valor2' },
    process.env.TWILIO_TEMPLATE_NUEVO_TIPO  // 👈 Usar el nuevo template
);
```

### Paso 4: Documentar
Agregar entrada en este documento con:
- SID del template
- Variable de entorno
- Uso y propósito
- Variables requeridas
- Ubicaciones en código

---

## 🔍 VERIFICACIÓN DE TEMPLATES

### Listar Templates Activos
```bash
# Usando Twilio CLI
twilio api:content:v1:contents:list

# O visitar en browser
https://console.twilio.com/us1/develop/sms/content-editor
```

### Verificar Estado de un Template
```bash
twilio api:content:v1:contents:fetch --sid HX10034ddb435237059b7115fdb7646da2
```

### Ver Mensajes Enviados
```bash
# Ver últimos 50 mensajes
https://console.twilio.com/us1/monitor/logs/sms

# Filtrar por template
https://console.twilio.com/us1/monitor/logs/sms?ContentSid=HX10034ddb435237059b7115fdb7646da2
```

---

## 🚨 TROUBLESHOOTING

### Error: "Content SID is not approved"
**Causa**: El template está en estado pendiente de aprobación
**Solución**: Esperar aprobación de WhatsApp o usar template ya aprobado

### Error: "Invalid ContentVariables format"
**Causa**: Variables del template no coinciden con las definidas
**Solución**: Verificar que las variables en el código coincidan con las del template en Twilio Console

### Error: "63016 - This message requires an approved template"
**Causa**: Intentando enviar mensaje fuera de ventana de 24h sin template
**Solución**: Usar un Content Template aprobado (no enviar texto libre)

---

## 📚 RECURSOS

- **Twilio Console**: https://console.twilio.com/
- **Content Editor**: https://console.twilio.com/us1/develop/sms/content-editor
- **Logs de Mensajes**: https://console.twilio.com/us1/monitor/logs/sms
- **Documentación Templates**: https://www.twilio.com/docs/content/content-types-overview
- **WhatsApp Templates**: https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates

---

## 🔄 HISTORIAL DE CAMBIOS

| Fecha | Cambio | Template SID | Autor |
|-------|--------|--------------|-------|
| 14 Ene 2026 | Template general configurado | HX10034ddb435237059b7115fdb7646da2 | Sistema |
| 14 Ene 2026 | Template confirmación de proceso agregado | HX156f42644eaf38f9775d32e9ca39c73a | Daniel Talero |
| 14 Ene 2026 | Template recordatorio de cita próxima agregado | HX46fddaf93f19f21d72720743b836d237 | Daniel Talero |

---

**Última actualización**: 14 Enero 2026
**Mantenido por**: Equipo BSL
**Documento**: TWILIO-TEMPLATES-CATALOG.md
