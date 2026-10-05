# 🔍 Auditoría: Menús AUTO SWITCHER PRO con Pools Reales

**Fecha**: 2026-10-04  
**Scope**: Solo lectura — 5 menús del Visual Profile Web UI  
**Pools Reales**:
- `agy_clau` — 4 cuentas (1 leader + 3 reserves)
- `agy` — 2 cuentas (1 leader + 1 reserve)
- `agy2` — 2 cuentas (1 leader + 1 reserve)

---

## Resumen Ejecutivo

| Menú / Tab | Estado | Bugs Encontrados |
|---|---|---|
| ①  Crear Prefijos (PrefixManager) | 🟡 FUNCIONAL con gaps | 1 MAJOR |
| ②  Crear Group/Perfiles (GroupManager) | 🟢 CORRECTO | 0 (lógica sólida) |
| ③  Control Switcher | 🔴 **ROTO** | **2 CRITICAL + 1 MAJOR** |
| ④  Visual Profile (ProfileGraph) | 🟢 CORRECTO | 0 (edges correctos) |
| ⑤  Pulse Tokens | 🟡 LIMITADO | 1 MAJOR (mock estático) |

**Total**: **2 CRITICAL**, **3 MAJOR**, **4 escenarios TDD faltantes**

---

## 1. Control Switcher (ControlSwitcher.jsx) — 🔴 ROTO

### BUG CRITICAL-1: Pool "agy" absorbe todas las cuentas de "agy_clau"

**Archivo**: `components/ControlSwitcher.jsx` líneas ~365-390  
**Código afectado**: Fase de matching de cuentas a pools

```js
const matchingFiles = valid.filter((f) => {
  const pref = (f.note || f.prefix || '').trim();
  return pref === def.activePrefix || pref.startsWith(`${def.activePrefix}_`);
});
```

**Problema**: El pool con `activePrefix="agy"` usa `startsWith("agy_")` para buscar reservas. Pero `agy_clau`, `agy_clau_1`, `agy_clau_2`, `agy_clau_3` **TODOS** empiezan con `"agy_"`, por lo que el pool "agy" reclama erróneamente las 4 cuentas del pool "agy_clau" como reservas.

**Resultado visible**: El pool "agy" muestra **5 reservas** (agy_1 + agy_clau + agy_clau_1 + agy_clau_2 + agy_clau_3) en lugar de 1. Las cuentas de agy_clau aparecen duplicadas en dos pools.

**Fix sugerido**: Al buscar reservas, validar que el sufijo después de `activePrefix_` empiece con un dígito:
```js
const matchingFiles = valid.filter((f) => {
  const pref = (f.note || f.prefix || '').trim();
  if (pref === def.activePrefix) return true;
  if (!pref.startsWith(`${def.activePrefix}_`)) return false;
  const suffix = pref.slice(def.activePrefix.length + 1);
  return /^\d/.test(suffix); // Solo sufijos numéricos son reservas
});
```

### BUG CRITICAL-2: Pools sin reconocimiento de familia (títulos y modelos incorrectos)

**Archivo**: `components/ControlSwitcher.jsx` líneas ~300-360  
**Código afectado**: Fase de descubrimiento de pools

El algoritmo extrae el `base` como `"agy"` para todas las cuentas Antigravity. Luego:

| Prefijo real | `activePref` | `prof` extraído | `poolKey` | Título generado | Modelo asignado |
|---|---|---|---|---|---|
| `agy_clau` | `agy_clau` | `clau` | `agy::clau` | "Pool CLAU" | `auto` |
| `agy` | `agy` | `default` | `agy::default` | "Pool DEFAULT" | `auto` |
| `agy2` | `agy2` | `agy2` | `agy::agy2` | "Pool AGY2" | `auto` |

**Problema**: Ninguno de estos pools entra en los branches de reconocimiento (`prof.startsWith('g')` o `prof.startsWith('son')`). Todos reciben título genérico y `modelTarget = 'auto'`.

**Resultado visible**: En lugar de ver "Gemini Puro (agy)", "Claude del Paquete (agy_clau)", "Gemini 2 (agy2)", el usuario ve "Pool DEFAULT", "Pool CLAU", "Pool AGY2" sin iconos semánticos ni modelos correctos.

**Fix sugerido**: Expandir la heurística de reconocimiento con las familias reales:
```js
if (prof === 'default' || prof === 'clau' || prof.startsWith('clau')) {
  // agy_clau -> Claude
  title = 'Claude del Paquete Antigravity';
  modelTarget = 'claude-sonnet-4-6';
  dotColor = '#a855f7';
} else if (prof.startsWith('g') || activePref === base || /^agy\d*$/.test(activePref)) {
  // agy, agy2 -> Gemini
  title = `Gemini Puro (${activePref})`;
  modelTarget = 'gemini-3.8-flash-high';
  dotColor = 'var(--dot-emerald, #34d399)';
}
```

### BUG MAJOR-1: activeFile matching también contaminado

**Archivo**: `components/ControlSwitcher.jsx` líneas ~385-395

```js
const activeFile = matchingFiles.find((f) => {
  const pref = (f.note || f.prefix || '').trim();
  return pref === def.activePrefix;
});
```

Aunque esta búsqueda es por igualdad exacta y no tiene el bug del `startsWith`, el `matchingFiles` YA está contaminado por CRITICAL-1. Esto causa que la cuenta activa podría aparecer correcta, pero la lista de reservas es incorrecta.

---

## 2. PrefixManager (Crear Prefijos) — 🟡 FUNCIONAL con gaps

### BUG MAJOR-2: Filtro "Claude" no captura agy_clau correctamente en todos los casos

**Archivo**: `components/PrefixManager.jsx` líneas ~80-90

```js
if (filterCategory === 'claude') {
  return prefix.includes('son') || prefix.includes('claude') || prefix.includes('clau');
}
```

Este filtro captura `agy_clau` porque contiene "clau". ✅ Funciona.

**PERO** — el filtro `gemini` tiene un gap sutil:
```js
if (filterCategory === 'gemini') {
  return prefix.includes('g1') || prefix.includes('g2') || prefix.includes('g3') || prefix.includes('gemini');
}
```

Con los pools reales `agy` y `agy2`, **ninguno** contiene "g1", "g2", "g3" ni "gemini". El filtro Gemini no encuentra NADA.

**Severidad**: MAJOR — Los filtros por familia no reflejan la estructura real de pools.

**Fix sugerido**: Reconocer `agy` y `agy2` como Gemini:
```js
if (filterCategory === 'gemini') {
  return prefix.includes('g1') || prefix.includes('g2') || prefix.includes('g3') 
    || prefix.includes('gemini')
    || (/^agy\d*$/.test(prefix) || /^agy\d*_\d+$/.test(prefix)); // agy, agy2, agy_1, agy2_1
}
```

### Funcionalidad CORRECTA de PrefixManager

- ✅ `classifyPrefixRole()` clasifica correctamente todos los prefijos reales:
  - `agy_clau` → "👑 CUENTA PRINCIPAL (ROOT)"
  - `agy_clau_1` → "🛡️ RESERVA 1"
  - `agy` → "👑 CUENTA PRINCIPAL (ROOT)"
  - `agy2` → "👑 CUENTA PRINCIPAL (ROOT)"
- ✅ La tabla renderiza todos los nodos
- ✅ Collision detection funciona
- ✅ Filtro `agy_clau` tab funciona correctamente

---

## 3. GroupManager (Crear Group/Perfiles) — 🟢 CORRECTO

### Análisis positivo

- ✅ `existingPools` usa `^(.*)_(\d+)$` (regex greedy) y correctamente agrupa:
  - Pool `agy_clau`: root + 3 reservas
  - Pool `agy`: root + 1 reserva
  - Pool `agy2`: root + 1 reserva
- ✅ `isPoolDescendant("agy", "agy_clau")` retorna `false` (el sufijo "clau" no es numérico)
- ✅ `isPoolDescendant("agy", "agy_1")` retorna `true` ✅
- ✅ Dissolve funciona correctamente para pools individuales
- ✅ Family selection y subtype selection correctos

**Sin bugs detectados** en GroupManager para los pools reales.

---

## 4. Visual Profile / ProfileGraph — 🟢 CORRECTO

### Análisis de buildGraphFromAuthFiles (managementClient.js)

**Archivo**: `api/managementClient.js` líneas ~600-670

La lógica de edges usa la misma regex `^(.*)_(\d+)$`:

- `agy_clau_1` → candidateParentPrefix = `agy_clau` → busca archivos con prefix = `agy_clau` → edge ✅
- `agy_1` → candidateParentPrefix = `agy` → busca archivos con prefix = `agy` → edge ✅
- `agy2_1` → candidateParentPrefix = `agy2` → busca archivos con prefix = `agy2` → edge ✅
- `agy_clau` → no tiene sufijo numérico → NO se busca padre → NO edge a `agy` ✅ CORRECTO

**Sin bugs detectados** en la construcción del grafo.

---

## 5. Pulse Tokens — 🟡 LIMITADO

### BUG MAJOR-3: Datos 100% mock estáticos

**Archivo**: `analytics/adapter.js`

PulseTokens usa `getSnapshot()` que retorna `CANONICAL_24H_MOCK` — datos fijos hardcodeados. No consulta la API real de telemetría ni se adapta a los pools actuales. Las cuentas mostradas son de una configuración antigua (`antigravity-g1-maribelluz.json`, `antigravity-g2-infosoytec.json`) que ya no existen con esos prefijos.

**Impacto**: El dashboard de telemetría muestra datos obsoletos que no corresponden a la configuración actual de pools (agy_clau, agy, agy2).

**Nota**: Si la telemetría real está en desarrollo, esto es un gap de diseño más que un bug. Pero los datos mock NO corresponden a los pools actuales.

---

## 6. Tests Existentes — Cobertura vs Realidad

### Tests que NO cubren los pools reales

| Test File | ¿Cubre agy_clau/agy/agy2? | Gap |
|---|---|---|
| `ControlSwitcher.test.jsx` | ❌ NO | Solo usa `agy_g1`, `agy_g2`, `agy_son` |
| `App.test.jsx` | ❌ NO | Usa mock genérico |
| `PulseTokens.test.jsx` | ❌ NO | Usa mock canónico fijo |

### Tests que SÍ cubren parcialmente

| Test File | Cobertura |
|---|---|
| `managementClient.test.js` | ✅ Incluye `agy_clau_*` en tests de buildGraphFromAuthFiles |
| `PrefixManager.test.jsx` | ✅ Incluye filtro `agy_clau` |
| `GroupManager.test.jsx` | ✅ Incluye pools con `agy_clau` y virtualización |

---

## 7. Escenarios TDD Faltantes (Propuestas)

### TDD-1: ControlSwitcher con pools reales (agy_clau + agy + agy2)

```
ROJO: Verificar que con 8 cuentas (agy_clau x4, agy x2, agy2 x2):
  - Se descubren exactamente 3 pools
  - Pool agy_clau tiene 1 activa + 3 reservas (NO contaminación)
  - Pool agy tiene 1 activa + 1 reserva (NO absorbe agy_clau)
  - Pool agy2 tiene 1 activa + 1 reserva
  - Títulos contienen "Claude" / "Gemini" según familia
  - modelTarget apropiado para cada pool
```

### TDD-2: ControlSwitcher desambiguación startsWith

```
ROJO: Verificar que la búsqueda de reservas usando startsWith
  NO incluye pools de prefijo similar pero familia diferente.
  Específicamente: "agy_clau" NO es reserva de "agy".
```

### TDD-3: PrefixManager filtros con pools reales

```
ROJO: Verificar que el filtro "Gemini" incluye cuentas
  con prefijos agy y agy2 (no solo g1/g2/g3).
```

### TDD-4: ControlSwitcher "agy" como pool directo (sin _profile suffix)

```
ROJO: Verificar que cuando activePref === base ("agy" === "agy"),
  el pool se reconoce como Gemini puro y no como "Pool DEFAULT".
```

---

## 8. Matriz de Severidad

| ID | Componente | Severidad | Descripción |
|---|---|---|---|
| CRITICAL-1 | ControlSwitcher | 🔴 CRITICAL | Pool "agy" absorbe cuentas de "agy_clau" por startsWith sin validación numérica |
| CRITICAL-2 | ControlSwitcher | 🔴 CRITICAL | Pools sin reconocimiento de familia (títulos genéricos, modelos "auto") |
| MAJOR-1 | ControlSwitcher | 🟠 MAJOR | Reservas contaminadas por matchingFiles con startsWith sin filtro |
| MAJOR-2 | PrefixManager | 🟠 MAJOR | Filtro "Gemini" no captura agy/agy2 (espera g1/g2/g3) |
| MAJOR-3 | PulseTokens | 🟠 MAJOR | Datos 100% mock estáticos, no reflejan pools actuales |

---

## 9. Archivos Clave para Corrección

| Archivo | Líneas afectadas | Acción |
|---|---|---|
| `components/ControlSwitcher.jsx` | ~300-400 | Reescribir descubrimiento y matching de pools |
| `components/PrefixManager.jsx` | ~80-90 | Expandir filtro Gemini para incluir agy/agy2 |
| `components/ControlSwitcher.test.jsx` | (nuevo test) | TDD con datos reales agy_clau + agy + agy2 |
| `analytics/adapter.js` | todo el archivo | Conectar a API real o actualizar mock a pools actuales |
