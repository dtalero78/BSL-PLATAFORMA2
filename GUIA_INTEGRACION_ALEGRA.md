# Guía de Integración con Alegra API

## 📋 Resumen

Esta guía documenta la integración de la plataforma BSL con la API de Alegra para la generación automática de facturas de servicios médicos.

## 🎯 Funcionalidad Implementada

- **Facturación por lotes**: Generar una factura agrupada para todos los exámenes de una empresa en un período de tiempo
- **Sincronización bidireccional**: Registro de facturas tanto en PostgreSQL como en Alegra
- **Configuración por empresa**: Cada empresa puede tener su propia configuración de facturación
- **Auditoría completa**: Logs de todas las interacciones con la API de Alegra

## 📦 Archivos Creados

### 1. Base de Datos
- **`scripts/crear-tablas-facturacion.sql`**: Script SQL con 5 tablas nuevas
  - `configuracion_facturacion_empresa`: Configuración de facturación por empresa
  - `examenes_alegra`: Mapeo entre exámenes locales y productos en Alegra
  - `facturas`: Registro de facturas generadas
  - `factura_items`: Detalle de items (exámenes) en cada factura
  - `alegra_sync_log`: Log de auditoría de sincronización con Alegra

**Nota importante**: Los precios se obtienen de la tabla `examenes` existente (campo `precio`)

### 2. Backend
- **`lib/alegra-client.js`**: Cliente HTTP para la API de Alegra
  - Autenticación Basic Auth
  - Métodos para clientes, items, y facturas
  - Utilidades para validación y transformación de datos

- **`routes/facturacion.js`**: Endpoints de facturación
  - `POST /api/facturacion/generar-lote`: Generar factura por lote
  - `GET /api/facturacion/facturas`: Listar facturas
  - `GET /api/facturacion/facturas/:id`: Detalle de factura
  - `GET /api/facturacion/configuracion/:codEmpresa`: Obtener configuración
  - `POST /api/facturacion/configuracion`: Guardar configuración

## 🚀 Pasos de Implementación

### Paso 1: Configurar Credenciales de Alegra

1. **Obtener credenciales de Alegra**:
   - Inicia sesión en [Alegra](https://app.alegra.com)
   - Ve a "Configuración" → "API - Integraciones con otros sistemas"
   - Copia tu correo y token de API

2. **Agregar a archivo `.env`**:
   ```bash
   # Credenciales de Alegra
   ALEGRA_EMAIL=tu-email@ejemplo.com
   ALEGRA_TOKEN=tu-token-aqui
   ALEGRA_API_URL=https://api.alegra.com/api/v1
   ```

### Paso 2: Crear Tablas en PostgreSQL

Ejecuta el script SQL para crear las tablas necesarias:

```bash
# Opción 1: Desde psql
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f scripts/crear-tablas-facturacion.sql

# Opción 2: Desde Node.js (agregar migración automática en initDB())
```

**O agregar al código de `initDB()` en [server.js](server.js)**:

```javascript
// En la función initDB(), después de las otras creaciones de tablas:
const sqlFacturacion = fs.readFileSync('./scripts/crear-tablas-facturacion.sql', 'utf8');
await pool.query(sqlFacturacion);
console.log('✅ Tablas de facturación creadas');
```

### Paso 3: Instalar Dependencias

```bash
npm install node-fetch
```

### Paso 4: Integrar Rutas en server.js

Agregar en [server.js](server.js) después de la inicialización de Express:

```javascript
// Importar módulo de facturación
const facturacionRoutes = require('./routes/facturacion');

// Exponer pool de PostgreSQL en app.locals para que las rutas puedan acceder
app.locals.pool = pool;

// Registrar rutas de facturación (con autenticación)
app.use('/api/facturacion', authMiddleware, facturacionRoutes);
```

### Paso 5: Configurar Empresa en Alegra

Para cada empresa que quieras facturar, necesitas:

#### 5.1. Crear Cliente en Alegra

1. Ve a Alegra → Contactos → Nuevo Contacto
2. Crea un cliente con los datos de la empresa (nombre, NIT, etc.)
3. Guarda el **ID del cliente** (lo verás en la URL o en la respuesta de API)

#### 5.2. Configurar Precios en Tabla examenes

**IMPORTANTE**: Los precios se obtienen de la tabla `examenes` que ya existe en tu BD.

Asegúrate de que todos los exámenes tengan precio configurado:

```sql
-- Ver exámenes sin precio
SELECT id, nombre, precio FROM examenes WHERE precio IS NULL OR precio = 0;

-- Actualizar precios
UPDATE examenes SET precio = 50000 WHERE nombre = 'AUDIOMETRÍA';
UPDATE examenes SET precio = 40000 WHERE nombre = 'VISIOMETRÍA';
-- etc...
```

#### 5.3. Crear Productos/Servicios en Alegra

1. Ve a Alegra → Inventario → Nuevo Item
2. Crea items para cada tipo de examen que facturarás
3. Guarda el **ID de cada item** creado

#### 5.4. Asociar Exámenes con Items de Alegra (Opcional)

Si quieres que cada examen tenga un producto específico en Alegra:

```bash
# POST /api/facturacion/examenes-alegra
curl -X POST http://localhost:8080/api/facturacion/examenes-alegra \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_JWT_TOKEN" \
  -d '{
    "examenId": 1,
    "alegraItemId": "456"
  }'
```

**Nota**: Si no asocias los exámenes con items de Alegra, la factura se creará igualmente pero sin referencia a productos predefinidos en Alegra.

#### 5.5. Guardar Configuración de Empresa en PostgreSQL

Hacer un POST a `/api/facturacion/configuracion` con:

```json
{
  "codEmpresa": "SIIGO",
  "alegraClientId": "123",
  "terminosCondiciones": "Pago a 30 días. Transferencia bancaria.",
  "observacionesDefault": "Factura por servicios médicos ocupacionales",
  "diasVencimiento": 30,
  "incluirRetencion": false
}
```

### Paso 6: Generar Primera Factura de Prueba

```bash
# Usando curl
curl -X POST http://localhost:8080/api/facturacion/generar-lote \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_JWT_TOKEN" \
  -d '{
    "codEmpresa": "SIIGO",
    "fechaInicio": "2025-01-01",
    "fechaFin": "2025-01-31",
    "observaciones": "Factura mensual enero 2025",
    "diasVencimiento": 30
  }'
```

## 📊 Flujo de Facturación

```
1. Usuario solicita factura por lote desde panel (ordenes.html)
   ↓
2. Backend consulta exámenes completados sin facturar
   ↓
3. Backend consulta configuración de facturación de la empresa
   ↓
4. Backend construye JSON de factura con items
   ↓
5. Backend envía factura a Alegra API (POST /invoices)
   ↓
6. Alegra responde con ID y número de factura
   ↓
7. Backend guarda factura en PostgreSQL (tablas: facturas, factura_items)
   ↓
8. Backend marca exámenes como pagados en HistoriaClinica
   ↓
9. Backend registra log de sincronización en alegra_sync_log
   ↓
10. Respuesta exitosa al usuario con detalles de factura
```

## 🔧 Estructura de Datos

### Tabla: examenes (ya existe)

```sql
id SERIAL PRIMARY KEY
nombre VARCHAR -- AUDIOMETRÍA, VISIOMETRÍA, etc.
precio NUMERIC -- Precio del examen (usado para facturación)
codigo_cups VARCHAR
activo BOOLEAN
```

### Tabla: examenes_alegra (nueva)

```sql
id SERIAL PRIMARY KEY
examen_id INTEGER -- FK a tabla examenes
alegra_item_id VARCHAR(100) -- ID del producto/servicio en Alegra
```

### Tabla: configuracion_facturacion_empresa (nueva)

```sql
cod_empresa VARCHAR(50) -- SIIGO, MASIN, etc.
alegra_client_id VARCHAR(100) -- ID del cliente en Alegra
terminos_condiciones TEXT
observaciones_default TEXT
dias_vencimiento INTEGER
incluir_retencion BOOLEAN
porcentaje_retencion DECIMAL(5,2)
```

### Tabla: facturas

```sql
id SERIAL PRIMARY KEY
alegra_invoice_id VARCHAR(100) -- ID de la factura en Alegra
alegra_invoice_number VARCHAR(50) -- Número de factura (ej: FV-001)
cod_empresa VARCHAR(50)
fecha_factura DATE
fecha_vencimiento DATE
subtotal DECIMAL(12,2)
impuestos DECIMAL(12,2)
retenciones DECIMAL(12,2)
total DECIMAL(12,2)
estado VARCHAR(20) -- draft, sent, paid, void
```

### Tabla: factura_items

```sql
id SERIAL PRIMARY KEY
factura_id INTEGER -- FK a facturas
historia_clinica_id VARCHAR(100) -- _id del examen
descripcion TEXT
cantidad INTEGER
precio_unitario DECIMAL(12,2)
subtotal DECIMAL(12,2)
alegra_item_id VARCHAR(100)
paciente_nombre VARCHAR(200)
paciente_numero_id VARCHAR(50)
tipo_examen VARCHAR(100)
fecha_examen DATE
```

## 🎨 Interfaz de Usuario (Pendiente)

### Opción 1: Panel de Facturación Dedicado

Crear nuevo archivo `public/panel-facturacion.html`:
- Lista de empresas con botón "Generar Factura"
- Formulario para seleccionar rango de fechas
- Tabla de facturas generadas con filtros
- Modal para ver detalle de factura

### Opción 2: Integración en ordenes.html

Agregar botón "Facturación" en el panel principal:
- Botón "Generar Factura por Lote" en toolbar
- Modal que permita:
  - Seleccionar empresa
  - Seleccionar rango de fechas
  - Ver preview de exámenes a facturar
  - Confirmar y generar factura
- Tabla de facturas recientes debajo de la tabla de órdenes

## 🧪 Testing

### 1. Prueba de Configuración

```javascript
// Verificar que las credenciales funcionan
const AlegraClient = require('./lib/alegra-client');
const client = new AlegraClient();

// Obtener lista de clientes
client.getClients().then(result => {
  console.log('Clientes:', result.data);
});
```

### 2. Prueba de Creación de Factura

```javascript
// Crear factura de prueba
const facturaData = {
  client: { id: "TU_CLIENT_ID" },
  items: [
    {
      name: "Audiometría",
      price: 50000,
      quantity: 1
    }
  ],
  date: "2025-01-02",
  dueDate: "2025-02-01",
  observations: "Factura de prueba"
};

client.createInvoice(facturaData).then(result => {
  console.log('Factura creada:', result.data);
});
```

## 📚 Documentación de Referencia

- **Alegra API**: https://developer.alegra.com/
- **Autenticación**: https://developer.alegra.com/docs/autenticación
- **Crear Factura**: https://developer.alegra.com/reference/post_invoices

## ⚠️ Consideraciones Importantes

1. **Manejo de Errores**: Todas las operaciones con Alegra API están en try-catch y se registran en `alegra_sync_log`

2. **Idempotencia**: Verificar que no se dupliquen facturas. Implementar validación antes de generar.

3. **Tipos de Examen**: El campo `tipo_examen` en HistoriaClinica debe coincidir **EXACTAMENTE** con el campo `nombre` en la tabla `examenes` (comparación case-insensitive)

4. **Sincronización**: Las facturas se marcan en ambos sistemas (PostgreSQL y Alegra). Si Alegra falla, la transacción debe revertirse.

5. **Permisos**: Solo usuarios con rol ADMIN deben poder generar facturas. Agregar middleware `requireAdmin` a las rutas.

## 🔐 Seguridad

- Las credenciales de Alegra están en variables de entorno (`.env`)
- Nunca commitear el archivo `.env` al repositorio
- Usar HTTPS en producción para todas las peticiones
- Validar autenticación JWT en todos los endpoints de facturación

## 📈 Próximos Pasos

1. ✅ Crear tablas en base de datos
2. ✅ Configurar credenciales de Alegra
3. ✅ Integrar rutas en server.js
4. 🔲 Configurar precios en tabla examenes
5. 🔲 Configurar empresas en Alegra (crear clientes y productos)
6. 🔲 Asociar exámenes con items de Alegra (opcional)
7. 🔲 Crear configuración de facturación por empresa
8. 🔲 Crear interfaz de usuario
9. 🔲 Testing en ambiente de desarrollo
10. 🔲 Validar en producción con una empresa piloto

## 🆘 Soporte

Para problemas con la integración:
- Revisar logs de `alegra_sync_log` en PostgreSQL
- Verificar que las credenciales en `.env` sean correctas
- Consultar documentación oficial de Alegra
- Verificar que los IDs de clientes e items en Alegra sean válidos
