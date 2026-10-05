# Sources — Auditoría Menús AUTO SWITCHER PRO

## Archivos Fuente Analizados

| Archivo | Líneas | Propósito |
|---|---|---|
| `plugins/visual-profile/web/src/App.jsx` | 496 | Host principal, tabs, carga de datos |
| `plugins/visual-profile/web/src/components/PrefixManager.jsx` | 409 | Tab "Crear Prefijos" |
| `plugins/visual-profile/web/src/components/GroupManager.jsx` | 1226 | Tab "Crear Group/Perfiles" |
| `plugins/visual-profile/web/src/components/ControlSwitcher.jsx` | 801 | Tab "Control Switcher" |
| `plugins/visual-profile/web/src/components/ProfileGraph.jsx` | 1621 | Tab "Visual Profile" |
| `plugins/visual-profile/web/src/components/PulseTokens.jsx` | 1032 | Tab "Pulse Tokens" |
| `plugins/visual-profile/web/src/api/managementClient.js` | 931 | API client, auth, graph construction |
| `plugins/visual-profile/web/src/analytics/adapter.js` | 303 | Capa adaptadora de telemetría (mock) |
| `plugins/visual-profile/web/src/analytics/metrics.js` | 145 | Funciones de cálculo de KPIs |

## Archivos de Test Analizados

| Archivo | Tests | Cubre pools reales? |
|---|---|---|
| `src/components/ControlSwitcher.test.jsx` | 4 | ❌ Solo agy_g1/g2/son |
| `src/components/GroupManager.test.jsx` | 17 | ✅ Parcial (agy_clau, virtualización) |
| `src/components/PrefixManager.test.jsx` | 4 | ✅ Parcial (filtro agy_clau) |
| `src/components/ProfileGraph.test.jsx` | 44 | ❌ Mock genérico |
| `src/components/ProfileNode.test.jsx` | 23 | N/A (nodo individual) |
| `src/components/PulseTokens.test.jsx` | 7 | ❌ Mock canónico fijo |
| `src/components/onConnect.test.jsx` | 8 | N/A (conexión de edges) |
| `src/api/managementClient.test.js` | 49 | ✅ Incluye agy_clau_* |
| `src/graph/graphReducer.test.js` | 37 | N/A (reducer) |
| `src/graph/connection.test.js` | 28 | N/A (validación de conexiones) |
| `src/graph/layout.test.js` | 15 | N/A (layout) |
| `src/analytics/metrics.test.js` | 8 | N/A (funciones puras) |
| `src/App.test.jsx` | 9 | ❌ Mock genérico |

## Líneas Clave de Código con Bugs

### CRITICAL-1: Contaminación por startsWith
- `ControlSwitcher.jsx:365-390` — matching de archivos a pools
- Regex de reservas: `pref.startsWith(\`${def.activePrefix}_\`)`

### CRITICAL-2: Descubrimiento sin reconocimiento de familia
- `ControlSwitcher.jsx:300-360` — fase de discovery
- Variables: `base`, `activePref`, `prof`, `poolKey`

### MAJOR-2: Filtro Gemini incompleto
- `PrefixManager.jsx:82-84` — filtro por categoría gemini
- Solo busca `g1`, `g2`, `g3`, `gemini`

## Métodos de Verificación

1. **Tracing manual**: Se simuló la ejecución de cada algoritmo con los 8 prefijos reales
2. **Análisis estático**: Se verificó cada regex y comparación de strings
3. **Tests existentes**: 253 tests pasan, pero no cubren la configuración real actual
4. **Comparación cruzada**: GroupManager vs ControlSwitcher — misma regex con resultados diferentes por diferencia en fase de matching
