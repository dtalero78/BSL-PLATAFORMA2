# Ejemplo de Refactorización con Repositories

## ANTES (Sin capa de repositorios)

```javascript
// src/routes/ordenes-legacy.js (líneas 58-146)

router.get('/ordenes-aprobador', async (req, res) => {
    try {
        const { codEmpresa, buscar, limit = 100, offset = 0 } = req.query;

        // 50+ líneas de SQL inline
        let query = `
            SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre",
                   h."primerApellido", h."segundoApellido", h."codEmpresa", h."empresa",
                   h."cargo", h."tipoExamen", h."medico", h."atendido",
                   h."fechaAtencion", h."horaAtencion", h."examenes", h."ciudad", h."celular",
                   h."_createdDate", h."_updatedDate", h."fechaConsulta", h."aprobacion",
                   h."mdConceptoFinal", h."mdRecomendacionesMedicasAdicionales",
                   h."mdObservacionesCertificado", h."mdObsParaMiDocYa", h."centro_de_costo",
                   (
                       SELECT foto_url FROM formularios
                       WHERE (wix_id = h."_id" OR numero_id = h."numeroId")
                       AND foto_url IS NOT NULL
                       ORDER BY fecha_registro DESC LIMIT 1
                   ) as foto_url
            FROM "HistoriaClinica" h
            WHERE 1=1
        `;

        const params = [];
        let paramIndex = 1;

        // Lógica compleja de construcción dinámica de query
        if (codEmpresa) {
            query += ` AND h."codEmpresa" = $${paramIndex}`;
            params.push(codEmpresa);
            paramIndex++;
        }

        if (buscar) {
            query += ` AND (
                COALESCE(h."numeroId", '') || ' ' ||
                COALESCE(h."primerNombre", '') || ' ' ||
                COALESCE(h."primerApellido", '') || ' ' ||
                COALESCE(h."codEmpresa", '') || ' ' ||
                COALESCE(h."celular", '') || ' ' ||
                COALESCE(h."empresa", '')
            ) ILIKE $${paramIndex}`;
            params.push(`%${buscar}%`);
            paramIndex++;
        }

        query += ` ORDER BY h."fechaConsulta" DESC NULLS LAST, h."_createdDate" DESC`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        // Otro query para el count (duplicación de lógica)
        let countQuery = `SELECT COUNT(*) FROM "HistoriaClinica" WHERE 1=1`;
        const countParams = [];
        let countParamIndex = 1;

        if (codEmpresa) {
            countQuery += ` AND "codEmpresa" = $${countParamIndex}`;
            countParams.push(codEmpresa);
            countParamIndex++;
        }

        if (buscar) {
            countQuery += ` AND (
                COALESCE("numeroId", '') || ' ' ||
                COALESCE("primerNombre", '') || ' ' ||
                COALESCE("primerApellido", '') || ' ' ||
                COALESCE("codEmpresa", '') || ' ' ||
                COALESCE("celular", '') || ' ' ||
                COALESCE("empresa", '')
            ) ILIKE $${countParamIndex}`;
            countParams.push(`%${buscar}%`);
        }

        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);

        res.json({
            success: true,
            data: result.rows,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Error al listar ordenes para aprobador:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar órdenes para aprobador',
            error: error.message
        });
    }
});
```

**Problemas:**
- ❌ ~90 líneas de código SQL inline
- ❌ Lógica de construcción de queries duplicada
- ❌ Difícil de testear (acoplado a DB)
- ❌ No reutilizable (cada ruta reimplementa la misma lógica)
- ❌ Parámetros indexados manualmente ($1, $2, ...)
- ❌ Sin validación centralizada

---

## DESPUÉS (Con capa de repositorios)

```javascript
// src/routes/ordenes-legacy.js (refactorizado)

const historiaClinicaRepo = require('../repositories/HistoriaClinicaRepository');

router.get('/ordenes-aprobador', async (req, res) => {
    try {
        const { codEmpresa, buscar, limit = 100, offset = 0 } = req.query;

        // Usar repository - 2 líneas en lugar de 90
        const data = await historiaClinicaRepo.findByEmpresa(codEmpresa, {
            limit,
            offset,
            buscar
        });

        const total = await historiaClinicaRepo.countByEmpresa(codEmpresa, buscar);

        res.json({
            success: true,
            data,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Error al listar ordenes para aprobador:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar órdenes para aprobador',
            error: error.message
        });
    }
});
```

**Beneficios:**
- ✅ ~25 líneas en lugar de 90 (reducción del 72%)
- ✅ Query complejo encapsulado en el repository
- ✅ Fácil de testear (mockear el repository)
- ✅ Reutilizable (otros endpoints pueden usar `findByEmpresa`)
- ✅ Lógica de DB centralizada
- ✅ Sin gestión manual de parámetros

---

## Más ejemplos de uso del Repository

### Buscar paciente por documento
```javascript
// ANTES
const result = await pool.query(
    'SELECT * FROM "HistoriaClinica" WHERE "numeroId" = $1',
    [numeroId]
);
const paciente = result.rows[0];

// DESPUÉS
const paciente = await historiaClinicaRepo.findByNumeroId(numeroId);
```

### Marcar como atendido (upsert complejo)
```javascript
// ANTES: 60+ líneas con lógica de INSERT vs UPDATE

// DESPUÉS: 1 línea
const paciente = await historiaClinicaRepo.marcarAtendido({
    wixId,
    atendido: 'ATENDIDO',
    fechaConsulta,
    mdConceptoFinal,
    // ... otros campos
});
```

### Verificar duplicados
```javascript
// ANTES: Query complejo con múltiples condiciones

// DESPUÉS
const duplicado = await historiaClinicaRepo.findDuplicadoPendiente(
    numeroId,
    codEmpresa
);
```

---

## Estadísticas de Refactorización

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|---------|
| **Líneas por query** | 40-90 | 1-3 | **95% reducción** |
| **Queries duplicados** | 334 llamadas directas | Centralizadas | Mantenibilidad ++ |
| **Testabilidad** | Baja (acoplado a DB) | Alta (mockeable) | Testing ++ |
| **Reutilización** | 0% | 100% | DRY principle |

---

## Próximos pasos

1. ✅ Repositories creados para 7 tablas principales
2. ⏳ Refactorizar rutas críticas para usar repositories
3. ⏳ Refactorizar services para usar repositories
4. ⏳ Testing y validación
