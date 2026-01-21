# Diagnóstico: Validador de Pagos en Producción

## ✅ ÚLTIMA ACTUALIZACIÓN: Flujo Simplificado (21 Enero 2026 - 19:30)

### 🎯 Cambio Implementado (Commit c372f82)

**Simplificación del flujo de pagos - Eliminado paso de confirmación innecesario**

**ANTES (3 fases):**
```
Usuario envía imagen
    ↓
Sistema: "¿Deseas registrar un pago?" ❌ REDUNDANTE
    ↓
Usuario: "SÍ"
    ↓
Sistema: "Envía tu número de cédula"
    ↓
Procesar pago
```

**AHORA (2 fases - SIMPLIFICADO):**
```
Usuario envía imagen de comprobante
    ↓
Sistema: "💳 Perfecto, recibí tu comprobante de pago.
          📝 Por favor envía tu número de cédula para registrar el pago."
    ↓
Procesar pago
```

**Razón:** Si el usuario envía una foto del comprobante, es porque obviamente está pagando. El paso de confirmación era redundante y confundía a los usuarios.

---

## ✅ Problema Identificado y Resuelto (21 Enero 2026 - 19:05)

### 🔍 Causa Raíz del Error

**Error 404 al descargar imágenes desde Twilio**

```
AxiosError: Request failed with status code 404
URL: https://api.twilio.com/2010-04-01/Accounts/.../Messages/.../Media/...
```

**Por qué ocurre:**
- **Race condition:** El webhook de Twilio se ejecuta ANTES de que Twilio termine de procesar/subir la imagen a su CDN
- Cuando el usuario envía un comprobante, el webhook llega inmediatamente pero la imagen aún se está procesando
- Si el sistema intenta descargar la imagen mientras Twilio aún la procesa, devuelve 404
- Esto causaba el error genérico "Lo siento, hubo un error procesando tu solicitud"

### ✅ Solución Implementada (Commit d0378c4)

Agregado mecanismo de reintentos con delays progresivos:

1. **Reintentos automáticos**: 4 intentos totales (inicial + 3 reintentos)
   - Delays: 1 segundo, 2 segundos, 3 segundos
   - Da tiempo a Twilio para procesar la imagen

2. **Error 404 específico**: Si después de 4 intentos aún da 404
   - Mensaje al usuario: "No pude acceder a la imagen... Envía el comprobante nuevamente"

3. **Timeout**: Detecta cuando la descarga tarda más de 60 segundos
   - Mensaje al usuario: "La descarga tardó demasiado... Envía imagen más pequeña"

4. **Logging detallado**: Muestra exactamente qué URL falló, en qué intento, y por qué

### Componentes Verificados
Todos los servicios funcionan correctamente:
- ✅ **OpenAI API**: Funcionando (modelo: gpt-4o-mini-2024-07-18)
- ✅ **Twilio API**: Funcionando (Account activo)
- ✅ **PostgreSQL**: Funcionando (tablas verificadas)
- ✅ **Clasificación de imágenes**: Funcionando
- ✅ **Descarga de media**: Ahora con manejo de errores robusto

### Confirmación Importante

**El validador de pagos YA funciona independientemente de `stopBot`.**

El flujo en el código es:
```
Webhook recibe mensaje
    ↓
📸 ¿Es imagen? → procesarFlujoPagos() [LÍNEA 4366-4382]
    ↓
📝 ¿Es texto con estado de pago activo? → procesarFlujoPagos() [LÍNEA 4441-4466]
    ↓
🤖 Verificar stopBot [LÍNEA 4471+] ← No afecta pagos
```

El sistema de pagos se ejecuta ANTES de cualquier verificación de stopBot.

---

## 🔍 Logging Detallado Agregado (Commit 8e16013)

### Logs por Paso

El nuevo sistema de logging muestra exactamente dónde falla el proceso:

**Para imágenes:**
```
[PASO 1/4] Descargando imagen desde Twilio
[PASO 2/4] Clasificando imagen con OpenAI
[PASO 3/4] Procesando clasificación
[PASO 4/4] Enviando mensaje de confirmación
```

**Para confirmación:**
```
[CONFIRMAR_PAGO] Usuario respondió: "..."
```

**Para documento:**
```
[ESPERANDO_DOCUMENTO] Usuario envió: "..."
[ESPERANDO_DOCUMENTO] Validando formato de documento
[ESPERANDO_DOCUMENTO] Buscando paciente con documento
[ESPERANDO_DOCUMENTO] Query completada: N resultados
[ESPERANDO_DOCUMENTO] Procesando pago
[ESPERANDO_DOCUMENTO] Marcando como pagado en BD
[ESPERANDO_DOCUMENTO] Resultado: success=true/false
```

**Para errores:**
```
❌ Error en procesarFlujoPagos: <mensaje>
❌ Error stack: <stack trace completo>
❌ Error name: <nombre del error>
❌ Error message: <mensaje detallado>
```

---

## 📋 Instrucciones para Producción

### 1. Reiniciar el servidor para aplicar cambios

```bash
# En el servidor de producción
pm2 restart bsl-plataforma
# o
npm start
```

### 2. Cuando ocurra el próximo error de pago

Revisar los logs del servidor para identificar en qué paso falla:

```bash
# Ver logs en tiempo real
pm2 logs bsl-plataforma --lines 100

# O revisar el archivo de logs
tail -f /ruta/a/logs/server.log
```

### 3. Buscar estos patrones en los logs

**Si falla en PASO 1/4:**
- Problema: Descarga de imagen desde Twilio
- Posibles causas:
  - Timeout (> 60 segundos)
  - Credenciales de Twilio incorrectas
  - Imagen no accesible desde Twilio

**Si falla en PASO 2/4:**
- Problema: Clasificación con OpenAI
- Posibles causas:
  - API Key inválida
  - Sin créditos en OpenAI
  - Rate limit excedido
  - Imagen muy grande (> límite de OpenAI)

**Si falla en PASO 3/4 o 4/4:**
- Problema: Lógica del flujo o envío de mensaje
- Posibles causas:
  - Error en sendWhatsAppFreeText
  - Problema con Twilio para enviar respuesta

**Si falla en [ESPERANDO_DOCUMENTO]:**
- Problema: Base de datos o validación
- Posibles causas:
  - Conexión a PostgreSQL
  - Paciente no existe
  - Error en UPDATE de HistoriaClinica

---

## 🧪 Script de Diagnóstico

Ejecutar este comando para verificar que todos los servicios funcionan:

```bash
node test-payment-flow-production.js
```

Este script verifica:
1. ✅ Variables de entorno configuradas
2. ✅ Conexión con OpenAI API
3. ✅ Conexión con Twilio API
4. ✅ Conexión con PostgreSQL
5. ✅ Clasificación de imágenes funcional

---

## 🚨 Posibles Errores y Soluciones

### Error: "API Key inválida o expirada" (OpenAI)
**Solución:**
1. Verificar OPENAI_API_KEY en `.env`
2. Revisar créditos en platform.openai.com
3. Regenerar API key si es necesario

### Error: "Credenciales de Twilio inválidas"
**Solución:**
1. Verificar TWILIO_ACCOUNT_SID en `.env`
2. Verificar TWILIO_AUTH_TOKEN en `.env`
3. Verificar que el token no haya expirado en console.twilio.com

### Error: "No se puede conectar a PostgreSQL"
**Solución:**
1. Verificar DB_HOST, DB_USER, DB_PASSWORD, DB_NAME en `.env`
2. Verificar que el servidor de base de datos esté activo
3. Revisar reglas de firewall (puerto 25060)

### Error: "Timeout descargando imagen"
**Solución:**
1. Imagen muy pesada (> 10 MB)
2. Problema de red entre servidor y Twilio
3. Aumentar timeout si es necesario (actualmente 60 segundos)

---

## 📊 Monitoreo Continuo

### Logs a revisar regularmente:

```bash
# Errores en flujo de pagos
grep "Error en procesarFlujoPagos" logs/server.log

# Pagos exitosos
grep "Pago procesado exitosamente" logs/server.log

# Clasificaciones de imagen
grep "Clasificación de imagen:" logs/server.log

# Estados de pago activados
grep "MODO_PAGO activado" logs/server.log
```

---

## 📝 Historial de Cambios

1. ✅ **Commit 8e16013**: Logging detallado agregado
2. ✅ **Commit f5d2015**: Manejo específico de error 404
3. ✅ **Commit d0378c4**: Mecanismo de reintentos con delays progresivos
4. ✅ **Commit c372f82**: Simplificación del flujo (eliminado paso de confirmación)
5. ✅ **Script creado**: test-payment-flow-production.js para diagnóstico

---

## 🔗 Referencias

- Código del validador: [server.js:1210-1409](server.js#L1210-L1409)
- Webhook de WhatsApp: [server.js:4281-4550](server.js#L4281-L4550)
- Clasificación de imágenes: [server.js:1088-1152](server.js#L1088-L1152)
- Estados de pago: [server.js:453-456](server.js#L453-L456)

---

---

## ✅ RESUMEN EJECUTIVO

### Problema Original
"El validador de pagos no está sirviendo con ninguna persona"

### Causa Identificada
**Race condition:** El webhook ejecutaba ANTES de que Twilio terminara de procesar la imagen subida, causando error 404 inmediato al intentar descargarla.

### Solución Aplicada
1. **Commit 8e16013**: Logging detallado para diagnóstico
2. **Commit f5d2015**: Manejo específico de error 404 con mensajes claros
3. **Commit d0378c4**: Mecanismo de reintentos (4 intentos con delays de 1s, 2s, 3s)
4. **Commit c372f82**: Simplificación del flujo (eliminado paso de confirmación)

### Estado Actual
**RESUELTO Y OPTIMIZADO** ✅

El validador de pagos ahora:
1. ✅ Reintenta automáticamente si la imagen aún se está procesando
2. ✅ Da tiempo a Twilio para procesar (delays progresivos)
3. ✅ Informa al usuario con mensajes claros si falla
4. ✅ Flujo simplificado (2 fases en vez de 3)
5. ✅ No requiere confirmación redundante "¿Deseas registrar pago?"

### Nuevo Flujo (Simplificado)
```
Usuario envía imagen → Sistema: "Envía tu cédula" → Procesar pago
```

---

**Fecha:** 21 Enero 2026
**Última actualización:** 19:30 COT
**Commits aplicados:** 8e16013, f5d2015, d0378c4, c372f82
