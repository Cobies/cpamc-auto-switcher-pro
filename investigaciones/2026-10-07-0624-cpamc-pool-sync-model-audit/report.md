# Auditoría Técnica: Pipeline de Sincronización de Pools en CPAMC / Auto Switcher Pro y Causas Raíz de Omisión en `/model` de Pi

## Executive Summary

Esta investigación profunda de solo lectura analizó por qué los pools de cuentas configurados o virtualizados en **CPAMC / Auto Switcher Pro** (a través del plugin Visual Profile, la Management API o el backend Go) no se sincronizan completamente ni se reflejan de forma predecible en el selector nativo de modelos de Pi (`/model`) ni en el comando complementario `/cpamc-model`.

La auditoría auditó la totalidad de la cadena de sincronización de 5 capas:
1. **Capa de Autoría y Virtualización**: UI Web (`GroupManager.jsx`, `PrefixManager.jsx`) y puente de host Go (`virtualize.go`, `managementClient.js`) [S-003][S-004][S-005].
2. **Capa del Enrutador Backend CLIProxyAPI**: Generación de prefijos virtuales en `/v1/models` y endpoints de gestión `/v0/management/auth-files` [S-012].
3. **Capa del Proveedor Dinámico Pi**: Módulo TypeScript `extensions/cpamc-auto-switcher/src/provider.ts` y su caché persistente `cpamc-models-cache.json` [S-006][S-013].
4. **Capa de Registro y Runtime de Pi**: `ModelRuntime`, `ModelRegistry` y `ModelSelectorComponent` en `@earendil-works/pi-coding-agent` [S-010][S-011].
5. **Capa de Presentación y Comandos TUI**: El comando nativo `/model`, el selector interactivo `/cpamc-model` (`src/picker.ts`), y los adaptadores de estado (`src/store.ts`, `src/adapter.ts`) [S-007][S-008].

### Conclusiones Principales

1. **Desconexión Asíncrona Total (Causa Raíz Arquitectural)**: La creación o modificación de pools en la interfaz web de CPAMC actualiza archivos en disco dentro de CLIProxyAPI (`/root/.cli-proxy-api/*.json`), pero **no emite ningún evento, señal IPC ni webhook hacia el proceso en ejecución de Pi** [S-004][S-005]. Al arrancar, Pi carga su catálogo dinámico con `{ allowNetwork: false }` desde el archivo local congelado `cpamc-models-cache.json` [S-011][S-013]. Si un pool se crea o cambia después de iniciar Pi (o si la caché en disco no se ha refrescado), Pi desconoce por completo la existencia del pool.
2. **`/cpamc-model` Opera sobre una Foto Estática (P0 Funcional)**: En `extensions/cpamc-auto-switcher/src/picker.ts`, la función `registerModelPicker` consulta únicamente `context.modelRegistry.getAvailable()` y `querySwitcherAccounts()`. **Nunca invoca `ctx.modelRegistry.refresh()` ni `fetchCLIProxyModels()`** [S-008]. Por diseño actual, `/cpamc-model` jamás descubre pools creados en tiempo de ejecución hasta que ocurra un reinicio completo o una recarga forzada.
3. **Frágil Descubrimiento Fan-Out y Fallback Bloqueante en `provider.ts` (P0 Catálogo)**:
   - Para descubrir prefijos legítimos, `fetchAccountPrefixesAndExclusions` ejecuta una petición inicial a `/v0/management/auth-files` seguida de $N$ descargas HTTP concurrentes (`/download?name=...`) bajo un timeout compartido estricto de 5000 ms [S-006].
   - Si la red o CLIProxyAPI demoran más de 5 segundos, la función falla silenciosamente y cae al fallback codificado en duro `KNOWN_ACCOUNT_PREFIXES`.
   - **En `extensions/cpamc-auto-switcher/src/provider.ts`, `KNOWN_ACCOUNT_PREFIXES` omite `agy_opus`, omite `codex` y omite cualquier pool con nombre personalizado** (ej. `team_a`, `dev`, `clau`, `mi_pool`) [S-006]. Todo pool fuera del set rígido queda descartado de inmediato con `isCleanIncludedModel() === false`.
4. **Desvanecimiento de Pools por Salud de Cuentas y Ocultación de Reservas (P1 Operativo)**:
   - CLIProxyAPI no genera slugs de ruta (`prefix/<model>`) para credenciales cuyos tokens fallan en refrescarse (`failed > 0`) o se encuentran en enfriamiento transitorio [S-012].
   - Al mismo tiempo, `provider.ts` excluye deliberadamente todas las cuentas de reserva mediante la regla `/_(\d+)$/` [S-006].
   - Se verificó en vivo durante esta auditoría que la cuenta principal del pool `agy2` (`wilsonlavio11@gmail.com.json`) acumuló fallos transitorios (`failed: 3`), provocando que CLIProxyAPI omitiera temporalmente `agy2/gemini-3.8-flash-high`. Como su reserva `agy2_1/gemini-3.8-flash-high` fue filtrada por la regla de reservas, **el pool `agy2` completo desapareció del catálogo disponible** [S-006][S-012].
5. **Divergencia entre Selectores y Falta de Intercepción de `/model`**:
   - El comando `/model` pertenece al núcleo de Pi y renderiza una lista plana no agrupada de todos los proveedores configurados (`[cpamc]`, `[nvidia]`, `[opencode-go]`) [S-010][S-014].
   - `/model` lanza un refresco en segundo plano con timeout de 15 segundos, pero si el usuario selecciona antes de finalizar el refresco o si el proveedor dinámico falla en su fan-out, solo se ven los modelos viejos del snapshot [S-010].
   - La extensión `cpamc-auto-switcher` no intercepta el input `/model`, dejando al usuario con dos comandos desconectados: uno nativo sin noción de líderes ni cuotas (`/model`), y uno enriquecido pero sordo a cambios dinámicos (`/cpamc-model`) [S-008][S-017].
6. **Políticas de Exclusión Excesivamente Agresivas en `GroupManager.jsx`**:
   - Al virtualizar un pool para Gemini (`agy`, `agy2`), `matchesFamilyModel` clasifica todos los modelos de Claude, GPT y Codex como opuestos, colocándolos en `excluded_models` [S-003][S-005].
   - Esto confina el pool a un único modelo (`gemini-3.8-flash-high`). Si ese modelo específico sufre un fallo de token o cuota, el pool entero queda vacío en el enrutador [S-003][S-012].

---

## Research Question

1. ¿Cuál es el pipeline completo y el ciclo de vida de mapeo y sincronización desde que se crea un pool en CPAMC / Auto Switcher Pro hasta que llega al registro de modelos de Pi?
2. ¿Por qué los pools creados (ej. `agy2`, `agy_opus`, o pools personalizados) no aparecen de forma completa ni predecible en `/model` o `/cpamc-model`?
3. ¿En qué puntos exactos de la arquitectura los datos se pierden, se filtran, se enfrían en caché o quedan desmapeados?
4. ¿Qué soluciones y mejoras técnicas de ingeniería resuelven de forma duradera la sincronización integral?

---

## Recommendation or Answer

### 1. Resumen de la Solución Arquitectural Recomendada

Para lograr que cualquier pool creado en CPAMC se refleje inmediatamente y sin pérdidas en Pi, se requiere intervenir cuatro cuellos de botella específicos:

1. **Refresco Proactivo en `/cpamc-model` (P0)**: Modificar `extensions/cpamc-auto-switcher/src/picker.ts` para que, antes de desplegar el selector o al recibir un flag `--refresh`, ejecute `await ctx.modelRegistry.refresh({ allowNetwork: true })` o invoque internamente `fetchCLIProxyModels()`, garantizando que la caché en memoria y en disco estén al día.
2. **Reemplazo del Fan-Out N+1 por Endpoint Consolidado o Aumento de Timeout en `provider.ts` (P0)**:
   - CLIProxyAPI ya expone el campo `note` (que contiene el prefijo asignado) directamente en la respuesta de `GET /v0/management/auth-files` [S-012]. Utilizar directamente ese prefijo evita lanzar decenas de peticiones GET `/download` simultáneas.
   - Enriquecer `KNOWN_ACCOUNT_PREFIXES` en `provider.ts` para que incluya `agy_opus`, familias `codex*` y cualquier prefijo alfanumérico detectado en los slugs de `/v1/models` que no sea una reserva `/_(\d+)$/` [S-006].
3. **Resiliencia de Pool ante Cuentas en Cooldown / Fallo (P1)**:
   - Si la cuenta líder activa de un pool no expone modelos en `/v1/models` (por fallo transitorio de token o cuota), el proveedor dinámico debe permitir como fallback temporal que los modelos de la primera reserva disponible (`_1`) se expongan como alias del pool base, evitando que el pool desaparezca por completo [S-006][S-012].
4. **Ciclo Periódico de Refresco de Catálogo en Segundo Plano (P1)**:
   - Incorporar en el `setInterval` de `extensions/cpamc-auto-switcher/index.ts` una llamada periódica ligera (cada 60–120 segundos) que ejecute `fetchCLIProxyModels()` y sincronice `cpamc-models-cache.json` sin bloquear la TUI [S-009].
5. **Unificación o Intercepción Transparente de `/model` (P2)**:
   - Añadir un interceptor en `pi.on("input")` que capture `/model` y ofrezca la vista enriquecida de CPAMC con coronas e insignias, asegurando paridad de experiencia para usuarios habituados al comando nativo [S-008][S-017].

---

## Key Findings

### 1. Mapa Completo del Pipeline de Sincronización (End-to-End)

El flujo de vida de un pool atraviesa 5 etapas secuenciales:

```
[ ETAPA 1: Creación de Pool ]
  Visual Profile WebUI (GroupManager.jsx / PrefixManager.jsx)
    │
    ├─► PATCH /v0/management/auth-files/fields  (Cuentas Físicas)
    └─► POST /v0/management/auto-switcher-pro/virtualize (Cuentas Virtuales)
           │  (Host bridge en plugins/visual-profile/internal/plugin/virtualize.go)
           ▼
[ ETAPA 2: Persistencia & Enrutamiento en CPAMC Host ]
  CLIProxyAPI (:8317)
    │  - Escribe /root/.cli-proxy-api/<archivo>.json con campo "prefix" y "excluded_models"
    │  - Si la cuenta tiene credencial válida: publica rutas en /v1/models y /v1/models?client_version=1
    │  - Formato de slugs publicados: <prefix>/<canonical_model> (ej: agy2/gemini-3.8-flash-high)
    │  - ⚠️ SI EL TOKEN FALLA O ESTÁ EN ENFRIAMIENTO: NO PUBLICA EL SLUG.
           │
   [ BRECHA ASÍNCRONA: No hay notificación hacia Pi ]
           │
           ▼
[ ETAPA 3: Consumo en Extensión Pi (Dynamic Provider) ]
  extensions/cpamc-auto-switcher/src/provider.ts
    │
    ├─► Al iniciar Pi: Carga estática de cpamc-models-cache.json (sin red)
    └─► Al refrescar (refreshModels):
          ├─ 1. Consulta /v0/management/auth-files (obtiene archivos)
          ├─ 2. Descarga individual (N peticiones) con timeout de 5000ms
          ├─ 3. Si timeout/falla: cae a KNOWN_ACCOUNT_PREFIXES (omite agy_opus, codex y custom)
          ├─ 4. Filtra reservas con regex /_(\d+)$/ (descarta agy_1, agy2_1, etc.)
          ├─ 5. Descarta modelos sin prefijo legítimo o excluidos
          └─ 6. Guarda resultado en ~/.gentle-shell/agent/cpamc-models-cache.json
           │
           ▼
[ ETAPA 4: Registro Central en Pi Core ]
  @earendil-works/pi-coding-agent (ModelRuntime & ModelRegistry)
    │  - Registra provider "cpamc"
    │  - Almacena lista en snapshot.all
    │  - Filtra en snapshot.available según proveedores autenticados
           │
           ▼
[ ETAPA 5: Presentación al Usuario ]
  Comandos Slash en la TUI
    ├─► /model (Pi Core): Muestra snapshot.available plano; refresca en background (15s timeout).
    ├─► /cpamc-model (Extensión): Consulta getAvailable() estático en memoria; NO refresca.
    └─► /model-select / /ms (j0k3r-model-picker): Agrupa por modelo canónico y filtra allowlist.
```

---

### 2. Análisis Detallado de los 6 Puntos de Fuga y Pérdida de Datos

#### Fuga 1: Desconexión Asíncrona entre CPAMC y el Proceso de Pi
- **Mecanismo**: El plugin Visual Profile y la herramienta Go `cpamc-auto-switcher` operan contra el servidor HTTP de CLIProxyAPI (`http://192.168.10.150:8317`) [S-001][S-004]. No tienen ningún canal de señalización hacia la sesión interactiva de Pi (Gentle-Shell o jok3r-pi).
- **Impacto**: Un usuario entra a la interfaz web de CPAMC, crea un pool llamado `agy2` o `codex`, asigna cuentas y guarda. CLIProxyAPI tiene las credenciales listas. Sin embargo, Pi sigue corriendo con el catálogo que leyó de `cpamc-models-cache.json` al arrancar. Para Pi, el nuevo pool no existe [S-011][S-013].

#### Fuga 2: El Comando `/cpamc-model` no Dispara Refresco de Red
- **Mecanismo en Código**: En `extensions/cpamc-auto-switcher/src/picker.ts` (líneas 13–21):
  ```typescript
  export function registerModelPicker(pi: any): void {
      pi.registerCommand("cpamc-model", {
          description: "Seleccionar modelo con indicador de líderes de rotación...",
          handler: async (args: string, cmdCtx: ExtensionContext) => {
              const context = cmdCtx;
              const availableModels: Model<any>[] = context.modelRegistry?.getAvailable?.() || [];
              if (availableModels.length === 0) { ... }
              await querySwitcherAccounts();
              ...
  ```
- **Fallo**: `context.modelRegistry.getAvailable()` devuelve una copia sincrónica del snapshot actual en memoria [S-010][S-011]. No existe ninguna instrucción `await context.modelRegistry.refresh({ allowNetwork: true })`. Por ende, el usuario puede ejecutar `/cpamc-model` cientos de veces y jamás verá reflejados los nuevos pools a menos que algo externo haya forzado un refresco de red [S-008].

#### Fuga 3: Timeout de 5 Segundos en el Fan-Out de Descargas y Fallback Rígido en `provider.ts`
- **Mecanismo en Código**: En `extensions/cpamc-auto-switcher/src/provider.ts` (líneas 270–306):
  ```typescript
  async function fetchAccountPrefixesAndExclusions(baseUrl: string, signal?: AbortSignal) {
      const timeout = AbortSignal.timeout(5000);
      ...
      const res = await fetch(`${baseUrl}/v0/management/auth-files`, ...);
      ...
      await Promise.allSettled(
          files.map(async (file) => {
              const dlRes = await fetch(`${baseUrl}/v0/management/auth-files/download?name=...`, ...);
  ```
  Y en `isCleanIncludedModel` (líneas 325–334):
  ```typescript
      if (!filterData) {
          const KNOWN_ACCOUNT_PREFIXES = new Set([
              "agy_g1", "agy_g2", "agy_son",
              "agy", "agy2", "agy3", "agy_clau",
              "nan", "nv", "ocgo"
          ]);
          return KNOWN_ACCOUNT_PREFIXES.has(prefix) || /^agy\d+$/.test(prefix) || /^agy_g\d+$/.test(prefix);
      }
  ```
- **Fallo Comprobado**:
  1. Si hay 8 o más archivos de autenticación en CLIProxyAPI (como se verificó en vivo [S-012]), la función lanza 8 peticiones HTTP concurrentes. Si la red o el servidor demoran más de 5000 ms, `fetchAccountPrefixesAndExclusions` devuelve `null`.
  2. Cuando `filterData === null`, entra el fallback `KNOWN_ACCOUNT_PREFIXES`.
  3. En `extensions/cpamc-auto-switcher/src/provider.ts`, **`KNOWN_ACCOUNT_PREFIXES` no contiene `agy_opus`**. Tampoco contiene `codex`, `codex2`, ni ningún prefijo arbitrario [S-006].
  4. Resultado: Todos los modelos de `agy_opus` y de pools personalizados son descartados silenciosamente del catálogo.

#### Fuga 4: Desaparición de Pools por Fallo de Token en la Cuenta Principal
- **Mecanismo en CLIProxyAPI**: Cuando una credencial de cuenta física o virtual sufre un error de refresco OAuth (en `auth-files`, campo `failed > 0`), o si la cuenta está en enfriamiento (HTTP 429), CLIProxyAPI deja de generar y publicar sus modelos en `/v1/models` y `/v1/models?client_version=1` [S-012].
- **Mecanismo en la Extensión**: En `provider.ts`:
  ```typescript
  // Omitir prefijos de cuentas de reserva (ej. _1, _2)
  if (/_(\d+)$/.test(prefix)) {
      return false;
  }
  ```
- **Evidencia Empírica Obtenida en Vivo**:
  - Al inicio de esta investigación, se consultó CLIProxyAPI:
    - `antigravity-wilsonlavio11@gmail.com.json` (prefijo líder `agy2`) tenía `failed: 3` en su metadata [S-012].
    - `/v1/models` **no contenía `agy2/gemini-3.8-flash-high`**, pero sí contenía `agy2_1/gemini-3.8-flash-high` [S-012].
    - Dado que `agy2_1` es reserva, `isCleanIncludedModel` la descartó.
    - Como `agy2` no estaba en la lista de CLIProxyAPI, **el pool `agy2` tuvo 0 modelos y no apareció en ninguna parte de Pi** [S-006][S-012].
  - 10 minutos más tarde, CLIProxyAPI refrescó exitosamente el token de `wilsonlavio11@gmail.com`:
    - Inmediatamente apareció `agy2/gemini-3.8-flash-high` en `/v1/models` [S-012].
    - Sin embargo, como Pi no había refrescado su caché en disco (`cpamc-models-cache.json` seguía con 7 modelos viejos), en Pi continuó sin aparecer [S-013].

#### Fuga 5: Exclusiones Extremas al Virtualizar en `GroupManager.jsx`
- **Mecanismo**: Cuando un usuario crea un grupo para la familia Gemini (`pure`) en `GroupManager.jsx`:
  ```javascript
  function matchesFamilyModel(base, modelId, exclude55 = false) {
      ...
      if (b.startsWith('agy') || b.startsWith('g')) {
          return id.includes('gemini');
      }
  ```
  Todos los modelos de Claude (`claude-sonnet-4-6`, `claude-opus-4-6-thinking`, etc.) y de GPT se marcan como "opuestos" y se guardan en el array `excluded_models` del archivo de autenticación en CLIProxyAPI [S-003][S-005].
- **Fallo**: El pool queda condicionado a un único modelo: `gemini-3.8-flash-high`. Si ese único modelo falla o entra en cooldown, el pool entero se queda sin modelos válidos y se extingue de la interfaz de Pi [S-003][S-012].

#### Fuga 6: Incompatibilidad de Nombres en el Motor Go (`internal/config` y `internal/quota`)
- **Mecanismo**: El backend en Go `cpamc-auto-switcher` parsea prefijos usando `config.ParsePrefix(prefix, baseActive)` [S-001].
  - Si un usuario crea un pool con un nombre que no empiece por `agy` o `codex` (por ejemplo, `team_alpha`, `work_claude`, `dev_gemini`):
  - `ParsePrefix` retorna `Matched: false`.
  - En `cpamc-auto-switcher -list`, la cuenta se clasifica como `[OTHER]` [S-001][S-007].
  - El switcher **nunca rota automáticamente esa cuenta** ante un error 429 [S-001].
  - En `store.ts`, `classifyModel` la cataloga como `🌐 Proxy General`, perdiendo la iconografía de líder (👑) y la asociación con reservas [S-007].
  - En `internal/quota/quota.go`, `ParseQuotaSummary` no aísla las cuotas de Gemini vs Claude para ese perfil desconocido, evaluando el peor caso entre todas las familias y provocando rotaciones falsas [S-002].

---

### 3. Matriz de Estado de Modelos y Pools Identificada en la Auditoría

A continuación se resume el estado empírico de los 4 pools configurados en el entorno activo (desplegados bajo la topología de 4 perfiles Opción A [S-015], y auditados en el marco de coexistencia modular entre gentle-shell y jok3r-pi [S-016]):

| Pool / Prefijo Base | Familia de Cuota | Cuenta Activa (Líder) | Cuenta de Reserva | ¿Presente en CLIProxyAPI? | ¿Presente en Caché Pi? | ¿Visible en `/model` / `/cpamc-model`? | Causa Raíz de Bloqueo / Visibilidad |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`agy`** | Gemini Models | `mar...tro@gmail.com` | `inf...tec@gmail.com` (`agy_1`) | Sí (`agy/gemini-3.8-flash-high`) | Sí | Sí | Visible normalmente [S-012][S-013]. |
| **`agy2`** | Gemini Models | `wil...o11@gmail.com` | `wil...io9@gmail.com` (`agy2_1`) | Sí (tras refresco de token) | **NO** (0 modelos en caché) | **NO** | Token falló inicialmente; caché local desincronizada; `/cpamc-model` no refresca red [S-008][S-012][S-013]. |
| **`agy_son`** | Claude & GPT | `mar...tro@gmail.com` | `inf...tec@gmail.com` (`agy_son_1`) | Sí (`agy_son/claude-sonnet-4-6`, `5-5`) | Sí | Sí | Visible normalmente [S-012][S-013]. |
| **`agy_opus`** | Claude & GPT | `wil...o11@gmail.com` | `wil...io9@gmail.com` (`agy_opus_1`) | Sí (`agy_opus/claude-opus-4-6`, `5-5`) | Sí | Sí (parcial) | Visible en caché, pero si `filterData` cae al fallback de `provider.ts`, desaparece por omisión de `agy_opus` en `KNOWN_ACCOUNT_PREFIXES` [S-006][S-013]. |
| **Pools Custom** (ej. `team_a`) | General / Desconocida | N/A | N/A | Depende de creación | **NO** | **NO** | Descartados por fallback en `provider.ts`; clasificados como `[OTHER]` en Go CLI [S-001][S-006]. |

---

## Evidence Review

| # | Afirmación / Hallazgo | Fuentes | Nivel de Confianza | Justificación Empírica / Código |
|---|---|---|---|---|
| E-01 | Creación de pools en Visual Profile no notifica a Pi | [S-003], [S-004], [S-005] | **HIGH** | Verificado en `GroupManager.jsx` y `virtualize.go`: la API solo interactúa con CLIProxyAPI vía HTTP. No existe socket, bus ni hook hacia Pi. |
| E-02 | `/cpamc-model` nunca ejecuta refresco de red en el registro | [S-008] | **HIGH** | Verificado en `picker.ts`: solo invoca `context.modelRegistry.getAvailable()`, leyendo el snapshot sincrónico de inicio de sesión. |
| E-03 | CLIProxyAPI omite modelos de cuentas con fallo transitorio | [S-012] | **HIGH** | Comprobado en vivo: `agy2/gemini-3.8-flash-high` no aparecía en `/v1/models` mientras `failed === 3`, pero sí apareció en cuanto el token se refrescó. |
| E-04 | Las reservas (`_1`, `_2`) se filtran deliberadamente en `provider.ts` | [S-006] | **HIGH** | Código explícito en `isCleanIncludedModel`: `if (/_(\d+)$/.test(prefix)) return false;`. |
| E-05 | `KNOWN_ACCOUNT_PREFIXES` en `provider.ts` carece de `agy_opus` y pools libres | [S-006] | **HIGH** | Líneas 327–332 de `extensions/cpamc-auto-switcher/src/provider.ts`: la lista blanca fija omite `agy_opus` y cualquier pool fuera de la convención rígida. |
| E-06 | `cpamc-models-cache.json` permanece desfasado respecto a CLIProxyAPI | [S-012], [S-013] | **HIGH** | Comparación directa: CLIProxyAPI expone 16 modelos de Antigravity en vivo; la caché local contiene exactamente 7 modelos obsoletos. |
| E-07 | Go CLI clasifica pools con nombres no estándar como `[OTHER]` | [S-001], [S-007] | **HIGH** | `config.ParsePrefix` solo reconoce prefijos que comiencen estrictamente con `agy` o `codex`. |
| E-08 | Pi Core `/model` y `/cpamc-model` están desacoplados | [S-008], [S-010], [S-017] | **HIGH** | Pi Core reserva `/model` en modo interactivo; la extensión registra `/cpamc-model` sin interceptar la entrada nativa. |

---

## Trade-offs and Risks

1. **Refresco Forzado en `/cpamc-model` vs Latencia de Apertura**:
   - *Riesgo*: Si `/cpamc-model` invoca `await fetchCLIProxyModels()` cada vez que el usuario abre el selector, la UI se demorará entre 100 ms y 1500 ms en desplegarse si hay latencia de red.
   - *Compensación*: Implementar un refresco no bloqueante (mostrar catálogo de caché inmediatamente y actualizar en segundo plano) o respetar un TTL corto (ej. 30 segundos) para no consultar la red si la caché es reciente.
2. **Descubrimiento Dinámico Total de Prefijos vs Fuga de Namespaces Externos**:
   - *Riesgo*: Si se elimina por completo la lista blanca de prefijos en `provider.ts`, podrían colarse prefijos de proveedores no deseados (ej. `nan/`, `meta/`, `01-ai/`) en el selector de CPAMC.
   - *Compensación*: Mantener una regla estructural: aceptar cualquier prefijo que esté presente en la lista de archivos de `auth-files` de CLIProxyAPI (donde el usuario configuró credenciales), descartando únicamente los namespaces nativos que provienen de gateways remotos de terceros.
3. **Exposición de Reservas como Alias de Emergencia**:
   - *Riesgo*: Si el líder está caído y se expone la reserva en `/model`, el usuario podría seleccionar directamente `agy2_1/modelo`, alterando el orden de rotación.
   - *Compensación*: Exponer la ruta siempre bajo el slug canónico del líder (`agy2/modelo`), pero permitiendo que el proxy resuelva internamente contra la reserva activa si el líder no está saludable.

---

## Alternatives Considered

1. **Obligar a los usuarios a reiniciar Pi (`/reload` o reinicio de proceso) tras crear un pool**:
   - *Descartada*: Degrada severamente la experiencia de usuario. La creación de pools en CPAMC debe ser transparente y sincronizarse automáticamente con el agente.
2. **Eliminar el filtrado de cuentas de reserva en `provider.ts`**:
   - *Descartada*: Llenaría el selector de modelos con duplicados masivos (`agy_son/sonnet`, `agy_son_1/sonnet`, `agy_son_2/sonnet`), confundiendo al usuario y rompiendo el propósito del Auto Switcher (donde solo se selecciona el líder y el switcher rota las reservas internamente).
3. **Inyectar Webhooks HTTP desde Visual Profile hacia Pi**:
   - *Descartada*: Pi no expone un servidor HTTP de escucha para webhooks entrantes de extensiones en su configuración predeterminada. Un modelo de sondeo inteligente (polling ligero) o refresco reactivo al abrir el menú es mucho más robusto y no requiere abrir puertos adicionales.

---

## Unknowns and Limits

1. **Frecuencia de Refresco de Tokens en CLIProxyAPI**: CLIProxyAPI renueva tokens OAuth de Google y Antigravity en intervalos definidos internamente. Si un token entra en backoff tras un fallo de red, CLIProxyAPI puede demorar entre 5 y 15 minutos en reintentar, lapso durante el cual la cuenta permanecerá ausente de `/v1/models`.
2. **Límite de Conexiones Simultáneas de la Management API**: El fan-out actual de $N$ descargas HTTP en `fetchAccountPrefixesAndExclusions` puede saturar entornos con decenas de cuentas configuradas en hardware con bajos recursos.

---

## Recommended Next Actions

### Matriz de Prioridad y Complejidad

| Prioridad | Componente | Acción Correctiva | Complejidad | Impacto |
| :--- | :--- | :--- | :--- | :--- |
| **P0 (Inmediata)** | `extensions/cpamc-auto-switcher/src/picker.ts` | Disparar refresco del registro (`refreshModels`) antes de mostrar opciones o si la caché supera 30s. | Baja (15 líneas TS) | Crítico: Elimina la ceguera de `/cpamc-model`. |
| **P0 (Inmediata)** | `extensions/cpamc-auto-switcher/src/provider.ts` | Añadir `agy_opus` y comodín `codex*` al fallback `KNOWN_ACCOUNT_PREFIXES`. | Trivial (2 líneas TS) | Crítico: Evita pérdida de Opus y Codex en modo degraded. |
| **P1 (Alta)** | `extensions/cpamc-auto-switcher/src/provider.ts` | Optimizar `fetchAccountPrefixesAndExclusions` para leer el prefijo directamente de `file.note` sin descargar los $N$ archivos. | Media (25 líneas TS) | Alto: Elimina timeouts de 5s y caídas al fallback. |
| **P1 (Alta)** | `extensions/cpamc-auto-switcher/index.ts` | Agregar refresco periódico de catálogo de modelos en el intervalo de 25s/60s. | Baja (10 líneas TS) | Alto: Mantiene `cpamc-models-cache.json` siempre sincronizado. |
| **P2 (Media)** | `plugins/visual-profile/web/src/components/GroupManager.jsx` | Moderar exclusiones en pools Gemini para no bloquear modelos si el único modelo asignado entra en falla. | Media (20 líneas JS) | Medio: Mayor tolerancia ante fallos de tokens individuales. |
| **P3 (Mejora UX)** | `extensions/cpamc-auto-switcher/src/picker.ts` | Añadir hook `pi.on("input")` para interceptar opcionalmente `/model` nativo. | Baja (15 líneas TS) | Medio: Unifica la experiencia de usuario. |

---

### Plan de Implementación Concreto

#### 1. Corrección en `extensions/cpamc-auto-switcher/src/picker.ts`
En el manejador del comando `/cpamc-model`, refrescar el registro si está desactualizado:
```typescript
pi.registerCommand("cpamc-model", {
    description: "Seleccionar modelo con indicador de líderes de rotación...",
    handler: async (args: string, cmdCtx: ExtensionContext) => {
        const context = cmdCtx;
        
        // 1. Refrescar catálogo dinámico si el contexto lo soporta
        if (typeof context.modelRegistry?.refresh === "function") {
            try {
                await context.modelRegistry.refresh({ allowNetwork: true });
            } catch {
                // Silencioso: usa snapshot actual si la red no responde
            }
        }
        
        const availableModels: Model<any>[] = context.modelRegistry?.getAvailable?.() || [];
        await querySwitcherAccounts(true);
        ...
```

#### 2. Corrección en `extensions/cpamc-auto-switcher/src/provider.ts`
1. **Enriquecer fallback**:
   ```typescript
   const KNOWN_ACCOUNT_PREFIXES = new Set([
       "agy_g1", "agy_g2", "agy_son", "agy_opus",
       "agy", "agy2", "agy3", "agy_clau",
       "codex", "codex2", "codex3", "clau",
       "nan", "nv", "ocgo"
   ]);
   ```
2. **Eliminar el Fan-Out N+1 en `fetchAccountPrefixesAndExclusions`**:
   Dado que `GET /v0/management/auth-files` ya entrega `file.note` con el prefijo exacto de cada archivo, construir `validPrefixes` directamente a partir de la lista general sin hacer descargas individuales a menos que se requieran exclusiones explícitas.
