# AUDIT — Multi-tenant & Security Review

Sistema para revisar la plataforma de forma reproducible y mecánica en lugar de depender de la intuición del reviewer (humano o LLM). Cada ronda de bug hunt histórico se documenta al final.

## Cómo usar

### 1. Script automático (gatillo de candidatos)

```bash
node scripts/audit-multitenant.js                    # todos los checks
node scripts/audit-multitenant.js --category=queries # solo queries
node scripts/audit-multitenant.js --category=routes  # solo rutas sin auth
node scripts/audit-multitenant.js --category=injection  # template literals en SQL
node scripts/audit-multitenant.js --category=emits   # io.emit sin room
```

El script reporta **candidatos**, no bugs confirmados. Su trabajo es asegurar que **nada pasa desapercibido**; el trabajo del reviewer es juzgar cuáles son falsos positivos y cuáles hay que arreglar.

Retorna exit 1 si hay hallazgos — apto para CI si algún día se quiere.

### 2. Checklist semántico (lo que el script no puede juzgar)

Ver secciones de abajo — cosas que requieren entender el dominio y no se pueden grep-ear.

---

## Falsos positivos esperados (NO son bugs)

Cuando el script reporta algo en estas categorías, es por diseño:

### Queries sin `tenant_id`

| Caso | Por qué es OK |
|---|---|
| `src/routes/nubia.js` | Ruta envuelta con `requireBslTenant` en `server.js`. Solo llega tráfico BSL. |
| `src/routes/facturacion.js`, `facturacion-empresas.js`, `planilla-sitel.js` | Idem — BSL-only por diseño (Alegra, SITEL). |
| `src/routes/rips.js` | Idem — BSL-only (RIPS Colombia). |
| `src/routes/siigo.js`, `asistencia-siigo.js` | Idem — BSL-only (SIIGO integration). |
| `src/routes/external.js` | BSL-only (x-api-key + `requireBslTenant`). |
| `src/routes/envio-empresas.js` UPDATE `"HistoriaClinica" WHERE _id = $1` | `_id` es UUID global único (Wix-generated). No hay colisión posible cross-tenant. |
| `src/config/init-db.js` | Solo corre al arranque, no procesa input del usuario. |

**Regla para agregar a esta lista**: si decides que un hallazgo es OK, agrégalo aquí con una línea explicando por qué. Si no puedes explicarlo en una línea, probablemente no es OK.

### Template literals con `${...}` en SQL

| Caso | Por qué es OK |
|---|---|
| `src/config/init-db.js` `ALTER TABLE ${col}` | Nombres hardcoded en el source, no input del usuario. |
| `src/routes/admin.js:427` `VALUES ${values}` | `values` se construye con `$N` placeholders, no con strings del usuario. Verificar cada vez. |
| `BaseRepository`/repos que interpolan `this.tableName` | Nombre de tabla definido en constructor, no input externo. |

### Rutas sin `authMiddleware`

Ver whitelist en `scripts/audit-multitenant.js` (`PUBLIC_ROUTE_WHITELIST`). Mantener actualizado cuando se agreguen rutas públicas legítimas (patient-facing, webhooks, SSE handshake).

---

## Checklist semántico (revisión manual)

El script cubre ~70% del espacio de bugs. El resto requiere juicio:

### A. Aislamiento por tenant

- [ ] ¿Las queries en rutas NO-BSL-only filtran por `tenant_id` en `WHERE` para SELECT/UPDATE/DELETE y en columnas para INSERT?
- [ ] Si una ruta es BSL-only, ¿está envuelta con `requireBslTenant` a nivel de router en `server.js`?
- [ ] Los JOINs entre tablas tenant-scoped ¿incluyen `ON x.tenant_id = y.tenant_id`? (Si ambas partes filtran por el mismo tenant no hace falta, pero es buena práctica.)
- [ ] Los parámetros que provienen del path (`req.params.id`) ¿pertenecen al tenant del request? (ej: `WHERE id = $1 AND tenant_id = $2`).

### B. Autenticación y escalación

- [ ] ¿Cada ruta que no es patient-facing tiene `authMiddleware`?
- [ ] ¿Las rutas de inspección/debug (tablas, estadísticas globales) tienen `requireSuperAdmin` (no solo `requireAdmin`)?
- [ ] `req.usuario.tenant_id` ¿se lee de la BD vía `authMiddleware`, no del JWT? (fuente de verdad = BD)
- [ ] ¿Hay fallbacks laxos tipo `tenant_id || 'bsl'` en contextos donde el tenant importa para autorización?

### C. Socket.io y SSE

- [ ] ¿Todos los emits usan `io.to('tenant:X').emit(...)` con X sacado del payload o del socket?
- [ ] ¿Los nuevos clientes SSE se asocian a un `tenantId` al conectar?
- [ ] Si usas `global.emitWhatsAppEvent(type, data)`, ¿`data.tenant_id` está presente?

### D. Uploads y archivos en DO Spaces

- [ ] Los paths incluyen prefijo por tenant (`${tenantId}/fotos/...`) para evitar colisiones y enumeración cross-tenant?
- [ ] Excepción: BSL conserva path legacy (sin prefijo) para zero-regression con URLs ya guardadas.

### E. SQL y queries dinámicas

- [ ] `ORDER BY` nunca interpola variables del usuario sin whitelist.
- [ ] `INTERVAL '${N} days'` → validar con `parseInt` antes.
- [ ] Nombres de tabla dinámicos: solo en endpoints `requireSuperAdmin` y validados contra `information_schema`.

### G. Constraints de BD (schema-level)

Los `UNIQUE` sobre columnas que representan identificadores de dominio (cod_empresa, email, numero_documento, celular, nombre de examen, orden_id) DEBEN ser compuestos con `tenant_id`. Un UNIQUE simple bloquea que dos tenants tengan el mismo valor, lo cual es normal (ej: todos los tenants tienen una empresa "PARTICULAR"). Para detectar:

```sql
SELECT t.relname, c.conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
WHERE c.contype = 'u'
  AND t.relname IN (/* lista de tablas tenant-scoped */);
```

Cualquier constraint cuyo `def` sea `UNIQUE (x)` donde `x` no sea un valor globalmente único (UUID, hash random, alegra_invoice_id) debe migrarse a `UNIQUE (x, tenant_id)`. Cuidado con las FKs dependientes: hay que tumbarlas, migrar el UNIQUE, y recrearlas como compuestas — ver `empresas` + `configuracion_facturacion_empresa` + `facturas` como ejemplo en `src/config/init-db.js`.

### F. Integraciones externas (Wix, Twilio, WHAPI, SIIGO, Alegra)

- [ ] Wix: todo código Wix envuelto con `if (isBsl(req))` o `requireBslTenant`.
- [ ] Webhooks: validar firma (Twilio signature, etc.), no depender de JWT.
- [ ] Credenciales: ¿están en `tenants.credenciales` (por tenant) o en env vars globales? Si es BSL-only, env vars está bien.

---

## Protocolo cuando encuentras un bug

1. **Confirma** que es bug real (lee el código, no solo el report del script).
2. **Mide el blast radius**: ¿es cross-tenant leak? ¿escalación? ¿solo defense-in-depth?
3. **Fix con el principio de mínimo cambio**: no refactorices el archivo entero.
4. **Agrega test o caso al AUDIT.md** si aplica — cambia el whitelist del script si el hallazgo era falso positivo.
5. **Commit con referencia al hallazgo**: `Fix: [categoría] [archivo:línea] — [descripción]`.

---

## Historial de rondas

### Ronda 1 (commit b8055be, 9e693ba)
- Fix Socket.io rooms por tenant, SSE filter por tenant
- SQL injection en `services/payment.js` (template literal con user input)
- SQL injection en `cerrarInactivas`/`eliminarAntiguos` (INTERVAL con string)
- Repositories: `tenantId` param en Empresas/ConversacionesWhatsApp/MensajesWhatsApp
- `requireBslTenant` middleware creado y aplicado a facturación, NUBIA, RIPS, SIIGO, SITEL
- `auth.js` reforzado: BD como fuente de verdad para `tenant_id`, no JWT

**Lección**: usé grep de `tenantId(req)` como proxy de "filtra correctamente", dejando escapar `admin.js /tablas/*` que construye SQL dinámico sin usar esa variable.

### Ronda 2 (commit 13502c3)
- `admin.js /tablas/*` — `requireAdmin` → `requireSuperAdmin` (era dump cross-tenant crítico)
- `/api/external` envuelto con `requireBslTenant`
- `/api/examenes` CRUD con `authMiddleware`
- `obtenerPermisosUsuario` filtra por `tenant_id`
- `seguimiento_comunidad` queries filtradas por tenant
- `spaces-upload.js` path con prefijo de tenant (BSL conserva legacy)

**Lección que motivó este AUDIT.md**: la revisión ad-hoc no es reproducible. Siguiente ronda debe correr el script primero.

### Ronda 3 — UNIQUE constraints
- Bug reportado: crear empresa `PARTICULAR` en vip-mediconecta devolvía "ya existe" porque `empresas_cod_empresa_key` era `UNIQUE (cod_empresa)` global.
- Migrados a compuesto `(col, tenant_id)`: `empresas.cod_empresa`, `examenes.nombre`, `usuarios.email`, `usuarios.numero_documento`, `conversaciones_whatsapp.celular`, `visiometrias_virtual.orden_id`, `voximetrias_virtual.orden_id`, `configuracion_facturacion_empresa.cod_empresa`.
- Caso especial `empresas`: FKs dependientes en `configuracion_facturacion_empresa` y `facturas` hubo que tumbarlas y recrearlas como compuestas. `facturas` ganó columna `tenant_id`.
- Preservados como UNIQUE simples (valores globalmente únicos): `sesiones.token_hash`, `facturas.alegra_invoice_id`, `permisos_usuario (usuario_id, permiso)`.

**Lección**: el script `audit-multitenant.js` solo cubre lógica de app, no schema. Agregué categoría G al checklist. Para detectar este tipo de bugs no basta con leer código — hay que inspeccionar `pg_constraint` directamente.

---

## Limitaciones conocidas del script

- No parsea SQL — detecta tablas con regex, falla si la query se arma en partes.
- No reconoce cuando `tenant_id` viene por constante/variable (`WHERE tenant_id = ${MY_TENANT}`).
- No valida JOINs (reporta la query global, no cada tabla individual).
- No cubre Express middlewares compuestos (si `authMiddleware` se aplica a nivel de router via `router.use`).
- No detecta lógica de negocio (ej: "solo admins de este tenant pueden editar empresas de este tenant").

Cuando encuentres un patrón que el script debería detectar pero no lo hace, amplíalo.
