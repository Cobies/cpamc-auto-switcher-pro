# Architecture Decision Records — Auto Switcher Pro

> **Última actualización**: 2026-10-27
> **Estado**: Vigente — Implementado y validado por test suite completa

---

## ADR-001: Contrato de Identificadores Soberanos y Prefijos de Pool

### Contexto

El plugin Auto Switcher Pro gestiona $N$ pools de balanceo de carga ($N \to \infty$) sobre credenciales OAuth físicas (Google Antigravity, Anthropic Directo, Codex, etc.). Cada pool tiene:

- Identidad soberana inmutable (`Pool-XX-<familia>`)
- Prefijo de routing estable (`agy`, `clau`, `codex`, `agy_son`, `agy_opus`…)
- Múltiples cuentas físicas miembro (líder + reservas)
- Liderazgo dinámico en RAM (`ActiveLeader`) que rota por fatiga, 429, o failover

### Problema

Exponer la mecánica interna de reservas (`agy_1`, `agy_2`, `agy_3`…) al usuario genera:
- Confusión: "¿por qué cambió mi prefix de agy_1 a agy_2?"
- Acoplamiento a detalle de implementación
- Rotura del contrato visual limpio "Pool Prefix + Modelo Activo"

### Decisión

**Separación estricta de dos capas:**

| Capa | Concepto | Formato | Visibilidad |
|------|----------|---------|-------------|
| **Pública (Contrato)** | Pool Soberano ID | `Pool-01-gemini`, `Pool-02-gemini` | ✅ `/model`, UI cards |
| **Pública (Contrato)** | BasePrefix del Pool | `agy`, `clau`, `codex`, `agy_son`, `agy_opus` | ✅ Badge `🏷️ [agy]` |
| **Pública (Contrato)** | Modelo Activo del Líder | `gemini-3.8-flash-high`, `claude-sonnet-4-6` | ✅ Hero banner `🎯 MODELO ASIGNADO` |
| **Privada (Mecánica)** | Prefijo reserva numérica | `agy_1`, `agy_2`, `agy_3`… | ❌ **NUNCA expuesto** |
| **Privada (Mecánica)** | Cuenta líder actual RAM | `antigravity-b@gmail.com.json` | Solo badge estado `🟢 EN CALIENTE` |
| **Privada (Mecánica)** | Rotación `ActiveLeader` | Volátil, en memoria | Transparente |

### Reglas de Validación (Code-Enforced)

```go
// modelprovider.go:453 — SOLO sufijos NUMÉRICOS son reservas del mismo pool
func prefixMatchesPool(prefix, basePrefix string) bool {
    if !strings.HasPrefix(prefix, base+"_") { return false }
    suffix := strings.TrimPrefix(prefix, base+"_")
    return poolReserveNumberPattern.MatchString("_" + suffix) // ^_\d+$
}

// poolReserveNumberPattern = regexp.MustCompile(`_\d+$`)
// → agy_1     ✅ reserva de pool "agy"
// → agy_son   ❌ pool HERMANO distinto (Claude Sonnet)
// → agy_opus  ❌ pool HERMANO distinto (Claude Opus)
```

### Catálogos Publicados

| Endpoint | Qué expone | Qué NUNCA expone |
|----------|------------|------------------|
| `model.static` | `Pool-01-gemini`, `Pool-02-gemini`… | Rutas prefijadas (`agy/...`), nombres de cuenta |
| `model.for_auth` | Baseline nativo + `target_models` bare | Facetas `Pool-XX-*`, rutas con `/` |
| `model.route` | Resuelve `Pool-01-gemini` → leader RAM + su modelo | Prefijos numéricos internos |

### UI Contract (AutoAuthFiles.jsx)

```jsx
// UNA LÍNEA LIMPIA — Card top
<span className="badge-prefix-hero">🏷️ [{card.assignedPrefix || card.activePoolBase}]</span>
// → Renderiza: 🏷️ [agy]  |  🏷️ [clau]  |  🏷️ [agy_son]

// Hero banner — Modelo del líder ACTUAL en RAM
<div className="hero-model-name">{specState.activeSpecialistModel}</div>
// → Renderiza: gemini-3.8-flash-high
```

### Consecuencias

- ✅ Usuario ve **identidad estable** del pool, no detalles de rotación
- ✅ $N$ pools hermanas conviven sin colisión (`agy` vs `agy_son` vs `agy_opus`)
- ✅ Rotación transparente: líder cambia en RAM, badge `🏷️ [agy]` no cambia
- ✅ Tests blindan: `TestCleanPoolIdentifierInModelAndPerAccountModels`, `TestPrefixMatchesPoolNumericReservesOnly`

---

## ADR-002: Separación Arquitectónica — CPAMC Nativo vs Auto Switcher Pro

### Contexto

Dos dominios **completamente separados** que nunca deben confundirse:

| Dominio | Propiedad | Naturaleza |
|---------|-----------|------------|
| **Auth Files Management** | CPAMC Core (`/static/management.html`, `GET /v0/management/auth-files`) | Visor de archivos físicos en disco (`/root/.cli-proxy-api/*.json`) — **PROTEGIDO** |
| **Auto Auth Files & Trazabilidad** | Plugin React (`AutoAuthFiles.jsx`) | Capa visual avanzada: failover cards, telemetría cuotas, ⚙️ Modo Especialista |

### Decisión

**Configuration Lock estricto**: NUNCA modificar, alterar ni intentar cambiar código/endpoints nativos de CPAMC. Cualquier orden "Auth Files" se disambigua:
- Modificaciones → Solo plugin (`AutoAuthFiles.jsx`, `SpecialistModal`)
- CPAMC nativo → Solo lectura/inspección

### Consecuencias

- Credenciales físicas en disco conservan `excluded_models: []` de fábrica
- CPAMC nativo siempre muestra catálogo completo en modal de inspección
- Plugin gobierna aislamiento **100% virtual** (`pool.policy.target_models`, `model.route`, `scheduler.pick`)

---

## ADR-003: Bimodal Catalog Invariant ($N \to \infty$)

### Regla Inmutable

| Estado | `/model` expone |
|--------|-----------------|
| **$N = 0$** (cero pools) | Solo credenciales nativas CPAMC |
| **$N \ge 1$** (pools activos) | **1 entrada limpia por pool** (`Pool-XX-<familia>`) + rutas legacy `<prefix>/<modelo>` para compatibilidad |

**PROHIBIDO**: Colapsar, ocultar o "sombrear" pools hermanos. Cada pool es unidad de routing independiente.

### Coexistencia Granular (Por Cuenta)

| Tipo de Cuenta | Comportamiento en `/model` |
|----------------|----------------------------|
| Asignada a pool activo | **Solo** facade soberano (`cpamc/Pool-01-gemini`); rutas físicas ocultas |
| Standalone / No asignada | 100% nativo CPAMC (prefix físico, inclusiones/exclusiones de disco) |

Auto-purge continuo: al crear/editar/disolver pools, cache local (`cpamc-models-cache.json`) se reconcilia sin modelos fantasma.

---

## ADR-004: Gobernanza de Modelo Especialista — Pure Virtual Isolation

### Principio

**Cero mutación de disco**. Pool especialista se gobierna virtualmente:
- `pool.policy.target_models` → modelo único por pool
- `member_models[authFile]` → override per-account opcional
- `excluded_models` en credenciales físicas → **SIEMPRE `[]`** (salvo exclusiones manuales usuario)

### Flujo ⚙️ Modo Especialista (Tuerca 🛠️)

```
Usuario click ⚙️ en card
    │
    ├─ Si cuenta EN POOL → Actualiza member_models[authFile] en PoolRegistry (RAM + disco atómico)
    │   └─ NO toca excluded_models del archivo físico
    │
    └─ Si cuenta STANDALONE → Muestra aviso:
        "Cuenta libre (sin pool). Credenciales en modo nativo.
         Para fijar especialista, agrégala a un pool desde Group Manager."
```

### Validación

- `TestModelCatalogForAuthDiskBackedPoolServesBareTargets`: catálogo nativo intacto
- `TestCleanPoolIdentifierInModelAndPerAccountModels`: modelos per-account respetados

---

## ADR-005: Separación Estricta de Origen Claude

### Dos Proveedores Técnicos Distintos

| Proveedor | Prefijo | Modelos | Nunca Mezclar |
|-----------|---------|---------|---------------|
| **Google Antigravity** (Cloud Code / Gemini Fleet) | `agy_*` | `agy_son*` → Sonnetのみ<br>`agy_opus*` → Opusのみ | ❌ No ofrece Haiku ni Claude genérico |
| **Direct Claude** (Anthropic nativo) | `clau*`, `claude*` | Catálogo completo Anthropic | ✅ Independiente |

### Regla

`familyCanonicalShortName()` en `registry.go` clasifica por prefijo/base:
- `agy_son` / `agy_opus` / `agy_clau` → familia `claude` (pero pool **distinto** de `clau`)
- `clau` / `claude*` → familia `claude` (Direct Anthropic)

---

## Referencias de Implementación

| Archivo | Responsabilidad |
|---------|-----------------|
| `plugins/auto-switcher-pro/internal/plugin/registry.go` | PoolRegistry, Normalización, Identidad soberana |
| `plugins/auto-switcher-pro/internal/plugin/modelprovider.go` | Catálogos, Routing, `prefixMatchesPool`, Fallbacks |
| `plugins/auto-switcher-pro/internal/plugin/plugin.go` | Handlers `model.static`, `model.for_auth`, `model.route`, `scheduler.pick` |
| `plugins/auto-switcher-pro/web/src/components/AutoAuthFiles.jsx` | UI Contract, Badges, Hero banner, Modals |
| `plugins/auto-switcher-pro/internal/plugin/modelprovider_test.go` | Suite de validación completa (50+ tests) |

---

## Historial de Cambios

| Fecha | ADR | Cambio | Autor |
|-------|-----|--------|-------|
| 2026-10-27 | 001, 002, 003, 004, 005 | Contrato inicial documentado | Wilox |

---

> **Nota**: Este documento es la **fuente de verdad** para cualquier modificación futura de prefijos, routing, catálogos o UI de pools. Cualquier cambio que viole estos ADRs requiere decisión explícita del usuario y actualización de este archivo.