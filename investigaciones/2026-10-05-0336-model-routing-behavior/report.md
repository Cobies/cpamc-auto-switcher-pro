# Comportamiento de Enrutamiento de Modelos y Compatibilidad con los 4 Perfiles de CPAMC

## Executive Summary

La infraestructura de CLIProxyAPI (CPAMC, puerto 8317) acaba de desplegar la **Opción A**, compuesta por **4 pools dedicados de cuentas activas** organizados con sus respectivas reservas:
1. `agy` (Gemini Pool 1)
2. `agy2` (Gemini Pool 2)
3. `agy_son` (Claude Sonnet Pool)
4. `agy_opus` (Claude Opus Pool)

Esta investigación analizó en profundidad el flujo completo de descubrimiento, filtrado, almacenamiento en caché y presentación visual en jok3r-pi, evaluando la interacción entre:
- El proveedor dinámico `/home/wilox/.pi/agent-j0k3r/extensions/cliproxyapi-dynamic-provider.ts`
- La caché local `/home/wilox/.pi/agent-j0k3r/cpamc-models-cache.json`
- El selector jerárquico `/home/wilox/.pi/agent-j0k3r/extensions/j0k3r-model-picker/` (`/model-select`, `/ms`)
- El comando nativo `/model` del núcleo de Pi (`@earendil-works/pi-coding-agent`)
- El motor de rotación backend `cpamc-auto-switcher` (Go)

**Conclusiones Principales:**
- **La cadena funcional opera y expone 10 modelos válidos** en caché y en vivo [S-001, S-004]. La exclusión de cuentas de reserva (`/_(\d+)$/`) funciona de forma limpia e impide que reservas internas como `agy_1`, `agy2_1`, `agy_son_1` o `agy_opus_1` saturen la UI [S-001, S-005].
- **Divergencia entre `/model` y `/model-select` (`/ms`)**: El comando `/model` es reservado nativamente por el núcleo de Pi antes del ciclo de extensiones. Invocar `/model` abre el selector plano estándar de Pi (que mezcla todos los providers configurados como `nvidia` y `opencode-go`). El selector jerárquico optimizado de jok3r (`j0k3r-model-picker`) solo se activa con `/model-select` o `/ms`, donde filtra estrictamente para mostrar únicamente el provider `cpamc` [S-002, S-003].
- **Discrepancia en `isParent` y prefijos obsoletos**: En `cliproxyapi-dynamic-provider.ts`, la condición para asignar la marca `⭐ [ACTIVA] ` está anclada a prefijos legacy (`agy_g1`, `agy_g2`, `agy_son`). Como consecuencia, solo `agy_son` recibe la estrella; `agy`, `agy2` y `agy_opus` aparecen sin el distintivo de cuenta activa [S-001, S-004].
- **Vulnerabilidad en modo fallback**: La lista `KNOWN_ACCOUNT_PREFIXES` en `cliproxyapi-dynamic-provider.ts` contiene prefijos deprecados (`agy_g1`, `agy_g2`, `agy_clau`) pero **carece de `agy_opus`**. Si la Management API de CPAMC no responde a tiempo, todos los modelos de `agy_opus` desaparecen silenciosamente del catálogo [S-001].
- **Fuga de modelo en credenciales físicas de Gemini**: Los archivos de `agy` y `agy2` no excluyen `claude-opus-5-5-high`. Esto genera una fuga donde dicho modelo de Claude aparece triplicado en la UI bajo `agy/`, `agy2/` y `agy_opus/`, permitiendo que peticiones a Opus consuman cuota del pool de Gemini [S-004, S-005].
- **Incompatibilidad de análisis en `cpamc-auto-switcher`**: El motor CLI en Go asume una base `agy` y perfiles con guión bajo `agy_<perfil>`. Por tanto, clasifica `agy2` y `agy2_1` como `[OTHER]`, impidiendo su rotación automática dentro del provider `antigravity` sin configuración manual de prefijo base [S-006, S-007].

---

## Research Question

1. ¿Cómo interactúan el comando `/model` de Pi y el selector `j0k3r-model-picker` con los 4 perfiles activos de CPAMC (`agy`, `agy2`, `agy_son`, `agy_opus`)?
2. ¿Cómo se usan exactamente estos 4 perfiles desde la interfaz de usuario de Pi?
3. ¿Coincide la lógica de `cliproxyapi-dynamic-provider.ts`, `j0k3r-model-picker` y `cpamc-models-cache.json` con las nuevas convenciones de prefijos de la Opción A?
4. ¿Qué discrepancias, vacíos o comportamientos no deseados existen en el ecosistema actual?

---

## Recommendation or Answer

### 1. Modelo de Interacción y Flujo de Ejecución

El ciclo de vida del catálogo de modelos en jok3r-pi transcurre en 4 fases secuenciales:

```
[CPAMC :8317]
  ├─ /v0/management/auth-files  ──> Prefijos de cuentas activas & Exclusiones
  └─ /v1/models?client_version=1 ─> Modelos enriquecidos (tokens, razonamiento, modalidades)
           │
           ▼
[cliproxyapi-dynamic-provider.ts]
  ├─ Descarta reservas: /_(\d+)$/ (agy_1, agy2_1, agy_son_1, agy_opus_1)
  ├─ Valida prefijo contra validPrefixes
  ├─ Filtra modelos en prefixExclusions
  ├─ Asigna ⭐ [ACTIVA] si prefix ∈ {agy_g1, agy_g2, agy_son} [DISCREPANCIA]
  └─ Guarda en cpamc-models-cache.json (10 modelos)
           │
   ┌───────┴─────────────────────────────────────────┐
   ▼                                                 ▼
Comando: /model (Pi Core)               Comando: /model-select ó /ms (Extensión)
- Selector plano nativo                 - Modal flotante jerárquico
- Muestra TODOS los proveedores         - Allowlist estricto: solo provider 'cpamc'
- Agrupa por ID plano                   - Agrupa por Slug Canónico -> Cuentas
- 10 modelos bajo etiqueta [cpamc]      - 6 Grupos de Modelos Canónicos
```

### 2. Cómo se Usan los 4 Perfiles

En la interfaz interactiva (TUI), el usuario debe utilizar preferentemente `/model-select` o `/ms`. 

Dentro del panel jerárquico, la estructura desplegada se organiza por **Modelo Canónico** (lo que hace el modelo) y dentro de cada modelo muestra las **Rutas de Pool** (las cuentas que lo sirven) [S-002, S-003]:

| Grupo Canónico en `/ms` | ID Completo de Ruta | Perfil / Pool Subyacente | Caso de Uso |
|---|---|---|---|
| **Claude Opus 4.6 (Thinking)** | `cpamc/agy_opus/claude-opus-4-6-thinking` | `agy_opus` (wilsonlavio11) | Razonamiento profundo complejo (Claude Opus con thinking) |
| **Claude Opus 5.5 (High)** | `cpamc/agy_opus/claude-opus-5-5-high` | `agy_opus` (wilsonlavio11) | Tareas de arquitectura pesada en Opus (Ruta legítima) |
| *(Fuga de Gemini)* | `cpamc/agy/claude-opus-5-5-high` | `agy` (maribelluz) | *No recomendado: consume cuota de Gemini en Opus* |
| *(Fuga de Gemini)* | `cpamc/agy2/claude-opus-5-5-high` | `agy2` (wilsonlavio11) | *No recomendado: consume cuota de Gemini en Opus* |
| **Claude Sonnet 4.6 (Thinking)** | `cpamc/agy_son/claude-sonnet-4-6` | `agy_son` (maribelluz) | **Programación diaria y agente principal de Pi** |
| **Claude Sonnet 5.5 (High)** | `cpamc/agy_son/claude-sonnet-5-5-high` | `agy_son` (maribelluz) | Programación de alto rendimiento sin thinking forzado |
| **Gemini 3.8 Flash** | `cpamc/agy/gemini-3.8-flash-high` | `agy` (maribelluz) | Contextos gigantes (370k), visión y velocidad |
| **Gemini 3.8 Flash** | `cpamc/agy2/gemini-3.8-flash-high` | `agy2` (wilsonlavio11) | Segundo pool de Gemini para alta concurrencia |
| **GPT-OSS 120B (Medium)** | `cpamc/agy_opus/gpt-oss-120b-medium` | `agy_opus` (wilsonlavio11) | Modelo libre/secundario en pool Opus |
| **GPT-OSS 120B (Medium)** | `cpamc/agy_son/gpt-oss-120b-medium` | `agy_son` (maribelluz) | Modelo libre/secundario en pool Sonnet |

---

## Key Findings

### 1. Incompatibilidad de Nombres Activos en `toPiModelFromCPA` (`cliproxyapi-dynamic-provider.ts:173`)
En el archivo `cliproxyapi-dynamic-provider.ts`:
```typescript
const isParent = prefix === "agy_g1" || prefix === "agy_g2" || prefix === "agy_son";
const rolePrefix = isParent ? "⭐ [ACTIVA] " : "";
```
- `agy_g1` y `agy_g2` son nombres arcaicos que ya no existen en CPAMC tras el despliegue de la Opción A [S-001, S-005].
- Los prefijos reales desplegados son `agy`, `agy2`, `agy_son`, y `agy_opus`.
- **Efecto visual**: En `cpamc-models-cache.json`, los modelos de `agy_son` reciben el prefijo `"⭐ [ACTIVA] Claude Sonnet..."`, pero los modelos de `agy`, `agy2` y `agy_opus` quedan con su nombre estándar sin destacar como cuentas activas [S-004].

### 2. Omisión Crítica en Fallback Defensivo (`cliproxyapi-dynamic-provider.ts:337`)
Si la consulta a `/v0/management/auth-files` falla o supera el timeout de 5 segundos, la función `isCleanIncludedModel` recurre a la lista estática `KNOWN_ACCOUNT_PREFIXES`:
```typescript
const KNOWN_ACCOUNT_PREFIXES = new Set([
    "agy_g1", "agy_g2", "agy_son",
    "agy", "agy2", "agy_clau",
    "nan", "nv", "ocgo"
]);
```
- **`agy_opus` no está en la lista**.
- Si ocurre una degradación temporal de red o del endpoint de administración, **todos los modelos Opus desaparecen de Pi**, mientras que prefijos inactivos (`agy_g1`, `agy_g2`, `agy_clau`) siguen permitidos [S-001].

### 3. Asimetría Semántica en el CLI de `cpamc-auto-switcher` (`internal/config/config.go:101`)
El analizador `ParsePrefix(prefix, baseActive)` descompone prefijos tomando como base `agy`:
- `agy` -> Cuenta activa pool default.
- `agy_1` -> Reserva 1 pool default.
- `agy_son` -> Cuenta activa perfil `son`.
- `agy_opus` -> Cuenta activa perfil `opus`.
- **`agy2` y `agy2_1`** -> Al no contener un guión bajo tras la base (`agy_`), la función no los reconoce como parte del árbol de `agy`.
- Al ejecutar `cpamc-auto-switcher -list`, `agy2` y `agy2_1` reciben el estado `[OTHER]` [S-007]. Esto implica que el demonio de rotación automático en segundo plano **no vigila ni rota automáticamente el pool `agy2`** salvo que se ejecute una instancia específica con `-active_prefix agy2`.

### 4. Fuga de Modelos Opus en los Auth Files de Gemini
En CPAMC, las credenciales físicas de Gemini (`antigravity-maribelluzbonitaaquinocastro@gmail.com.json` y `antigravity-wilsonlavio11@gmail.com.json`):
- Excluyen 12 modelos: Sonnet 4.6, Sonnet 5.5, Gemini 3 Flash, etc.
- **No excluyen `claude-opus-5-5-high`** [S-005].
- En consecuencia, CPAMC expone `agy/claude-opus-5-5-high` y `agy2/claude-opus-5-5-high`.
- En el picker, el usuario ve tres opciones para Opus 5.5. Si selecciona una ruta bajo `agy/` o `agy2/`, la petición se enruta a una cuenta configurada para Gemini, arriesgando un consumo cruzado no deseado de cuota [S-003, S-004].

### 5. Heurística de Íconos en `j0k3r-model-picker/src/modal.ts:718`
El asignador visual de insignias e íconos en `modal.ts` evalúa:
```typescript
} else if (prefix.startsWith("agy_clau")) {
    roleIcon = "👑 🔶 ";
} else if (prefix.startsWith("clau") || prefix.startsWith("son")) {
    roleIcon = "👑 🤖 ";
} else if (prefix.startsWith("agy") || prefix.startsWith("g")) {
    roleIcon = "👑 ✨ ";
}
```
Dado que tanto `agy_son` como `agy_opus` comienzan con `"agy"`, entran en la tercera rama (`👑 ✨ `) antes de llegar a la lógica de Claude o Sonnet (`👑 🤖 `). Todos los modelos de la Opción A se presentan con destellos de estrella (`✨`), perdiendo la distinción visual de robots (`🤖`) para modelos Claude [S-002].

### 6. Reserva del Comando `/model` por Pi Core
En Pi, el handler del editor intercepta el string literal `/model` a bajo nivel antes de disparar el pipeline de comandos de extensiones [S-003]. Por ello, `j0k3r-model-picker` registra y atrapa exclusivamente:
- `/model-select`
- `/ms`
Un usuario que teclee `/model` obtendrá el selector nativo de Pi (componente `ModelSelectorComponent`), donde los modelos se presentan en lista plana con nombres largos y rodeados de modelos externos [S-002, S-003].

---

## Evidence Review

### Evidencia 1: Modelos en Caché Local (`cpamc-models-cache.json`)
La inspección directa de `cpamc-models-cache.json` arroja exactamente 10 modelos clasificados en los 4 perfiles [S-004]:
```json
[
  { "id": "agy_opus/claude-opus-4-6-thinking", "name": "Claude Opus 4.6 (Thinking) (agy_opus/claude-opus-4-6-thinking)" },
  { "id": "agy/claude-opus-5-5-high", "name": "Claude Opus 5.5 (High) (agy/claude-opus-5-5-high)" },
  { "id": "agy2/claude-opus-5-5-high", "name": "Claude Opus 5.5 (High) (agy2/claude-opus-5-5-high)" },
  { "id": "agy_opus/claude-opus-5-5-high", "name": "Claude Opus 5.5 (High) (agy_opus/claude-opus-5-5-high)" },
  { "id": "agy_son/claude-sonnet-4-6", "name": "⭐ [ACTIVA] Claude Sonnet 4.6 (Thinking) (agy_son/claude-sonnet-4-6)" },
  { "id": "agy_son/claude-sonnet-5-5-high", "name": "⭐ [ACTIVA] Claude Sonnet 5.5 (High) (agy_son/claude-sonnet-5-5-high)" },
  { "id": "agy/gemini-3.8-flash-high", "name": "Gemini 3.8 Flash (agy/gemini-3.8-flash-high)" },
  { "id": "agy2/gemini-3.8-flash-high", "name": "Gemini 3.8 Flash (agy2/gemini-3.8-flash-high)" },
  { "id": "agy_opus/gpt-oss-120b-medium", "name": "GPT-OSS 120B (Medium) (agy_opus/gpt-oss-120b-medium)" },
  { "id": "agy_son/gpt-oss-120b-medium", "name": "⭐ [ACTIVA] GPT-OSS 120B (Medium) (agy_son/gpt-oss-120b-medium)" }
]
```
*Observación comprobada*: Solo las entradas con prefijo `agy_son/` poseen `⭐ [ACTIVA]`. Las de `agy`, `agy2` y `agy_opus` carecen de ella debido a la condición `isParent` en `cliproxyapi-dynamic-provider.ts:173` [S-001, S-004].

### Evidencia 2: Estado Vivo en CLIProxyAPI (`http://192.168.10.150:8317`)
La consulta en vivo a `/v0/management/auth-files` confirma 8 credenciales físicas configuradas con la Opción A [S-005]:
- `antigravity-maribelluz...json` -> prefijo `agy` (Líder Gemini 1)
- `antigravity-infosoytec...json` -> prefijo `agy_1` (Reserva Gemini 1)
- `antigravity-wilsonlavio11...json` -> prefijo `agy2` (Líder Gemini 2)
- `antigravity-wilsonlavio9...json` -> prefijo `agy2_1` (Reserva Gemini 2)
- `antigravity-maribelluz...agy_son.json` -> prefijo `agy_son` (Líder Sonnet)
- `antigravity-infosoytec...agy_son_1.json` -> prefijo `agy_son_1` (Reserva Sonnet)
- `antigravity-wilsonlavio11...agy_opus.json` -> prefijo `agy_opus` (Líder Opus)
- `antigravity-wilsonlavio9...agy_opus_1.json` -> prefijo `agy_opus_1` (Reserva Opus)

Todas las cuentas de reserva (`agy_1`, `agy2_1`, `agy_son_1`, `agy_opus_1`) son filtradas exitosamente por el regex `/_(\d+)$/` tanto en `cliproxyapi-dynamic-provider.ts:327` como en `j0k3r-model-picker/src/api.ts:394` [S-001, S-002].

### Evidencia 3: Comprobación de Agrupamiento en `j0k3r-model-picker`
La lógica en `j0k3r-model-picker/src/api.ts:144-170` trata de forma especial al proveedor `cpamc`:
```typescript
if (id.toLowerCase() === "cpamc") {
    // Agrupa por slug canónico (porción después del '/')
    const slash = model.id.indexOf("/");
    const canonicalSlug = model.id.slice(slash + 1).trim();
    // Deriva nombre de grupo y ordena alfabéticamente
}
```
Esto genera exactamente 6 grupos canónicos limpios:
1. `Claude Opus 4.6 (Thinking)`
2. `Claude Opus 5.5 (High)`
3. `Claude Sonnet 4.6 (Thinking)`
4. `Claude Sonnet 5.5 (High)`
5. `Gemini 3.8 Flash`
6. `GPT-OSS 120B (Medium)`

Al expandir cualquiera de ellos con `Enter`, se revelan los pools disponibles [S-002].

### Evidencia 4: Evaluación de Estado en `cpamc-auto-switcher`
La ejecución de `go run cmd/cpamc-auto-switcher/main.go -list -endpoint http://192.168.10.150:8317` produjo [S-007]:
```
STATUS      PROVIDER      PROFILE   ACCOUNT ID            PREFIX       5H CONSUMED   WEEKLY CONSUMED   MIN AVAILABLE
[ACTIVE]    antigravity   default   mar...tro@gmail.com   agy          0.0%          60.7%             39.3%
[OTHER]     antigravity   default   wil...o11@gmail.com   agy2         10.5%         67.8%             32.2%
[OTHER]     antigravity   default   wil...io9@gmail.com   agy2_1       N/A           100.0%            0.0%
[RESERVE]   antigravity   default   inf...tec@gmail.com   agy_1        0.0%          51.9%             48.1%
[ACTIVE]    antigravity   opus      wil...o11@gmail.com   agy_opus     10.5%         67.8%             32.2%
[RESERVE]   antigravity   opus      wil...io9@gmail.com   agy_opus_1   N/A           100.0%            0.0%
[ACTIVE]    antigravity   son       mar...tro@gmail.com   agy_son      0.0%          60.7%             39.3%
[RESERVE]   antigravity   son       inf...tec@gmail.com   agy_son_1    0.0%          51.9%             48.1%
```
Esto demuestra de forma concluyente que el analizador de `cpamc-auto-switcher` identifica los perfiles `son` y `opus` sin problemas, pero clasifica `agy2` y su reserva `agy2_1` como cuentas ajenas (`[OTHER]`), dejándolas fuera de la rotación automática [S-006, S-007].

---

## Trade-offs and Risks

| Decisión / Estado Actual | Trade-off / Beneficio | Riesgo Técnico |
|---|---|---|
| **Doble selector (`/model` vs `/ms`)** | Permite mantener el selector estándar de Pi intacto sin parchar el binario core. | Confusión para el usuario que escribe `/model` y ve una lista plana no filtrada. |
| **Agrupamiento por slug canónico en el picker** | El usuario elige primero qué modelo quiere usar (`Claude Sonnet 4.6`) y luego decide por qué pool enrutar. | Si el usuario no expande el nodo, puede no percatarse de qué cuenta física o pool está respaldando la sesión. |
| **Preservar `agy2` en lugar de `agy_g2`** | Nombre conciso y limpio para el segundo pool de Gemini. | Incompatibilidad con `ParsePrefix` en Go, que espera formato `agy_<nombre>` o requiere soporte explícito de bases múltiples. |
| **No excluir Opus en pools `agy` y `agy2`** | Flexibilidad si se desea usar Opus 5.5 desde cuentas Gemini si el pool Opus se agota. | Agotamiento imprevisto de la cuota semanal de cuentas Gemini en tareas pesadas de código Claude. |

---

## Alternatives Considered

1. **Reemplazar forzosamente `/model` a nivel de proceso**:
   - *Descartado*: Pi intercepta `/model` antes del registro de extensiones. Sobrescribir el comando requiere parchar los archivos distribuidos en `node_modules/@earendil-works/pi-coding-agent`, lo cual viola la política de inmutabilidad de dependencias y se rompería tras una actualización.
2. **Renombrar `agy2` a `agy_gem2` o `agy_g2`**:
   - *Alternativa evaluada*: Resolvería la detección automática en `cpamc-auto-switcher` sin tocar Go. Sin embargo, alteraría la convención acordada en la Opción A y obligaría a regenerar los auth-files y la caché de Pi.
3. **Normalizar `isParent` por regex en lugar de strings fijos**:
   - *Recomendado para futura fase*: Considerar activa cualquier cuenta cuyo prefijo no termine en `_\d+` y coincida con un pool registrado.

---

## Unknowns and Limits

- **Límite de inspección**: Esta investigación fue estrictamente de solo lectura; no se modificó ningún archivo de configuración ni código fuente.
- **Tolerancia a fallos de red**: No se midió el impacto de latencia en arranques en frío de Pi si la Management API de CPAMC tarda más de 5000 ms en responder durante un refresco interactivo.

---

## Recommended Next Actions

Para alinear completamente el sistema con la Opción A sin sobreingeniería (KISS/YAGNI):

1. **Actualizar `isParent` en `cliproxyapi-dynamic-provider.ts`**:
   - Sustituir la comprobación fija `agy_g1 || agy_g2 || agy_son` por:
     `prefix === "agy" || prefix === "agy2" || prefix === "agy_son" || prefix === "agy_opus"`
   - Esto garantizará que los 4 perfiles activos muestren el indicador `"⭐ [ACTIVA] "` en Pi.
2. **Añadir `agy_opus` al fallback `KNOWN_ACCOUNT_PREFIXES`**:
   - Incluir `"agy_opus"` en el Set defensivo de `cliproxyapi-dynamic-provider.ts:337` y remover los prefijos muertos `agy_g1`, `agy_g2`, `agy_clau`.
3. **Corregir exclusiones en los auth files de `agy` y `agy2`**:
   - Agregar `claude-opus-5-5-high` a la lista `excluded_models` de `antigravity-maribelluzbonitaaquinocastro@gmail.com.json` y `antigravity-wilsonlavio11@gmail.com.json`.
   - Con esto se eliminarán las 2 opciones fantasmas de Opus en los pools de Gemini, dejando exactamente 8 rutas limpias en lugar de 10.
4. **Soporte de pool `agy2` en `cpamc-auto-switcher`**:
   - Añadir soporte en `internal/config/config.go` para reconocer sufijos alfanuméricos como `agy2` / `agy2_1` como pools válidos, o documentar la ejecución con `-active_prefix agy2`.
5. **Divulgar el uso de `/ms` o `/model-select`**:
   - Mantener documentado en el workspace que para acceder a la vista agrupada y limpia por pools se debe invocar `/ms`.
