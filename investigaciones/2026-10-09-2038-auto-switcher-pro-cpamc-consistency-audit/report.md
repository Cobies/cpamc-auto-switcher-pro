# Auditoría de Consistencia Full-Stack: Auto Switcher Pro + Arquitectura Nativa de Auth-Files de CPAMC

**Fecha:** 2026-10-09 20:38 (hora local del workspace)
**Alcance:** `/home/wilox/projects/cpamc-auto-switcher` @ `e782b3c` (+ working tree con modificaciones sin commit en `internal/`), plugin `auto-switcher-pro-linux-amd64` v0.1.0 registrado en vivo, host CPAMC `eceasy/cli-proxy-api:latest` (CLIProxyAPI v8, `config-version: 8`) en `192.168.10.150:8317`.
**Modo de acceso:** solo lectura (docker exec, HTTP GET con management key, suites de tests). No se modificó ningún archivo de `/root/.cli-proxy-api`, ni configuración, ni git.

## Workflow Status
- Status: READY
- Blockers: None

---

## Executive Summary

1. **El estado actual del disco es limpio y coincide con el invariant nativo**: exactamente **4 archivos maestros físicos** en `/root/.cli-proxy-api/` (container `cli-proxy-api`), con prefijos `agy`, `agy_1`, `agy_2`, `agy_3` (pool Gemini) y listas `excluded_models` que excluyen toda la familia Claude [S-004, S-010, S-016]. No hay clones en disco hoy. La vista nativa `management.html#/auth-files` muestra 4 tarjetas.

2. **La causa raíz del dilema "clobber vs clonación" está trazada línea a línea** en `GroupManager.jsx`: la función `isVirtualSource` (líneas 266–282) decide por el **prefijo actual del archivo físico** si una asignación a un pool de la familia opuesta se resuelve con (a) clonación en disco vía `virtualizeAccount` → `host.auth.save` (crea `<base>.<prefix>.json`, es decir 2N archivos y 2N tarjetas nativas) o (b) PATCH in-place (`saveAuthFilePrefixes`), que **sobrescribe el prefijo del maestro y destruye el pool anterior de ese archivo**. Con 1 prefijo nativo por archivo, estas son las únicas dos salidas que el código actual ofrece; ninguna cumple el objetivo del usuario [S-001, S-003, S-008].

3. **El C-ABI que el plugin usa hoy es mínimo**: el plugin Go (`plugins/visual-profile`) solo implementa `plugin.register` (capacidad única: `management_api: true`), `management.register` (2 rutas HTTP + 6 recursos UI) y `management.handle`, y solo invoca 4 callbacks del host: `host.auth.list`, `host.auth.get`, `host.auth.save`, `host.auth.delete` [S-001, S-002]. No expone hooks de enrutamiento, catálogo de modelos, enable/disable de cuentas ni intercepción de requests.

4. **HALLAZGO DECISIVO**: el **host** (binario CLIProxyAPI v8) expone un C-ABI de plugins mucho más rico de lo que Auto Switcher Pro usa. El análisis del binario (tabla de símbolos/tipos Go, strings de métodos y mensajes de pánico) evidencia capacidades registrables: `model_provider`, `model_registrar`, `model_router`, `scheduler`, `request_interceptor`, `response_interceptor`, `response_stream_interceptor`, `auth_provider`, `quota_provider`, `usage_plugin`, `executor`, con métodos RPC plugin-side `model.register`, `model.route`, `scheduler.pick`, `quota.fetch/reset`, `request.intercept_before/after`, etc., y callbacks host-side `host.model.execute/execute_stream`, `host.auth.get_runtime`, `host.routing.reset_cooldown`, `host.affinity.lookup` [S-005, S-006, S-007, S-011].

5. **Respuesta a la pregunta crítica**: con un solo prefijo nativo por archivo, la misma cuenta física **sí puede** servir dos pools familiares (Gemini + Claude) con solo 4 archivos nativos y cero clones, mediante una de estas dos vías soportadas por el host (sin modificar el binario nativo):
   - **Opción C (recomendada)**: el plugin se registra como `model_provider` + `model_router`; registra IDs de modelos virtuales de pool (p. ej. `agy_clau/claude-sonnet-4-6`) vía `model.register`, y cuando llega un request el host invoca `model.route` y el plugin responde `{Handled, TargetKind, Target: <auth_index del líder elegido>, TargetModel: <modelo real>, Reason}`. El enrutamiento y la rotación Líder/Reservas viven 100% en el plugin.
   - **Opción D (alternativa)**: el plugin se registra como `scheduler`; el host le pasa los candidatos de credencial y el plugin responde `{AuthID elegido | Reject | DelegateBuiltin}` por request (rotación con conciencia de cuota por familia dentro del plugin).
   Ambas requieren **trabajo solo del lado del plugin** (declarar capacidades + implementar los métodos RPC); el riesgo abierto es verificar el esquema exacto de wire contra la fuente upstream (`github.com/router-for-me/CLIProxyAPI/v8`) — ver Unknowns.

6. **La arquitectura objetivo de 4 puntos del usuario es viable** con la Opción C: los 4 maestros físicos permanecen intactos para siempre; GroupManager es el único generador (estado de pools/tarjetas 2N persistido en un archivo de estado propio del plugin, con precedente en el propio ecosistema: el plugin `control-account` ya persiste `ego.db` SQLite en `/CLIProxyAPI/plugins/`); AutoAuthFiles se convierte en visor puro del estado del plugin vía rutas de management registradas por el propio plugin.

---

## Research Question

¿Es viable la arquitectura objetivo del usuario — solo 4 archivos nativos maestros para siempre, GroupManager como único generador de pools/tarjetas, la abstracción 2N (tarjeta Gemini + tarjeta Claude por maestro) viviendo solo en el estado del plugin, y AutoAuthFiles como visor puro — dado el invariant nativo de CPAMC de 1 archivo = 1 prefijo = 1 tarjeta en `management.html#/auth-files`? Y en concreto: ¿cómo puede la misma cuenta física servir DOS pools familiares sin clonar archivos ni sobrescribir prefijos?

---

## Recommendation or Answer

**Sí es viable, pero NO con el código actual del plugin.** El plugin debe pasar de "gestor de archivos en disco" a "proveedor de enrutamiento virtual", usando capacidades que el host ya expone y que hoy el plugin no declara.

### Recomendación principal (Opción C — rutas de modelos virtuales registradas por el plugin)

1. El plugin Go declara en `plugin.register` las capacidades `model_provider`/`model_registrar` + `model_router` (además de `management_api`), e implementa:
   - `model.register` → responde `{Provider, Models []ModelInfo}` con los IDs virtuales derivados del estado de pools (p. ej. `agy/gemini-3-flash`, `agy_clau/claude-sonnet-4-6`, `agy_clau_1/...`). El host los agrega al catálogo `/v1/models` (evidencia: `"Registered new model %s from provider %s"` en el binario [S-006]).
   - `model.route` → por cada request a un modelo virtual, el plugin responde `{Handled: true, TargetKind: "auth_index", Target: <auth_index del maestro elegido como líder de ese pool familiar>, TargetModel: <modelo base>, Reason}` (forma reconstruida del tipo Go `callPlugin[go.shape.struct { Handled bool; TargetKind ModelRouteTargetKind; Target string; TargetModel string; Reason string }]` [S-006]).
2. La rotación Líder/Reservas, la asignación familiar y la política de exclusiones por tarjeta viven en el **estado del plugin** (archivo propio, p. ej. `plugins/auto-switcher-pro-state.json`), mutado únicamente por GroupManager vía rutas de management nuevas del plugin (`POST/PUT/DELETE /v0/management/auto-switcher-pro/pools`).
3. `virtualizeAccount`, `deleteAuthFile` de clones y el PATCH de prefijos dejan de usarse para poblar pools: **cero escrituras en el directorio de auth**.

### Alternativa técnica equivalente (Opción D — scheduler plugin)

El plugin declara `scheduler` y responde `scheduler.pick` con `{AuthID}` del líder familiar correspondiente (o `{Reject}` / `{DelegateBuiltin}`). Encaja mejor si se prefiere que los modelos sigan registrándose por el mecanismo nativo (prefijo por archivo), con los 4 maestros compartiendo un prefijo común y el plugin decidiendo qué cuenta sirve cada request. Menos invasive para el catálogo, pero el concepto "pool por prefijo" nativo se diluye.

### Fallback degradado (solo nativo, sin cambios de plugin)

Compartir prefijo (`agy`) entre los 4 maestros y confiar en el conductor nativo (`routing/strategy = round-robin` verificado en vivo [S-015], con `priority`, `weight`, cooldowns por modelo y `excluded_models` con wildcards documentados en `config.example.yaml` [S-009]). Factible y cero clones, pero pierde la semántica explícita Líder/Reservas y la rotación por umbral de cuota que da el plugin; no cumple el punto 2 del usuario (GroupManager dejaría de ser generador de nada routing-relevante).

**Ninguna opción requiere modificar el binario nativo de CPAMC ni crear archivos derivados.**

---

## Key Findings

### 1. Mapa completo de rutas de código que escriben/borran archivos del directorio de auth

Todos los writers convergen en 4 primitivas: `PATCH /v0/management/auth-files/fields` (mutación in-place de `prefix` y `excluded_models`), `DELETE /v0/management/auth-files?name=`, y las rutas del plugin `POST/DELETE /v0/management/auto-switcher-pro/virtualize` (que internamente usan `host.auth.save`/`host.auth.delete`).

| # | Componente | Función/Ubicación | Operación nativa | Efecto en disco | Efecto en tarjetas nativas |
|---|---|---|---|---|---|
| W1 | plugin Go `internal/plugin/virtualize.go` | `Virtualize()` (l.74–128) vía `saveAuthMetadata()` (l.267–278) | `host.auth.save` con `name=<base>.<prefix>.json` | **Crea/sobrescribe archivo clon** | +1 tarjeta nativa por clon |
| W2 | plugin Go `virtualize.go` | `DeleteVirtual()` (l.330–349) | `host.auth.delete` | **Borra archivo** | −1 tarjeta |
| W3 | `web/src/api/managementClient.js` | `patchAuthFilePrefix()` (l.796; body `{name, prefix}` l.805–808) | PATCH `/fields` | Mutación in-place del campo `prefix` | Misma tarjeta, nuevo prefijo (rutas `<prefix>/<model>` re-registradas) |
| W4 | ídem | `patchAuthFileExclusions()` (l.1597; body `{name, excluded_models}`) | PATCH `/fields` | Mutación in-place de `excluded_models` | Misma tarjeta, catálogo de modelos filtrado |
| W5 | ídem | `deleteAuthFile()` (l.1211) con fallback a `DELETE /v0/management/auto-switcher-pro/virtualize?name=` | DELETE auth-file | **Borra archivo** | −1 tarjeta |
| W6 | ídem | `virtualizeAccount()` (l.988) | POST ruta plugin → W1 | **Crea clon** | +1 tarjeta |
| W7 | ídem | `saveAuthFilePrefixes()` (l.915) → N× W3 | PATCH `/fields` por archivo | Mutación in-place | — |
| W8 | `GroupManager.jsx` | `handleCreateGroup()` (l.549–714): W7 en l.639, W4 en l.645, W6 en l.652 | mixto | Clona o parchea | Crea pools |
| W9 | ídem | `handleRetryFailed()` (l.716–757): W6/W7 según `kind` | mixto | — | — |
| W10 | ídem | `handleDissolvePool()` (l.785–855): W5 en l.820 (borra clones), W7 en l.823 (prefijo `''` a maestros) | mixto | **Borra clones + limpia prefijos** | −N tarjetas clon |
| W11 | `AutoAuthFiles.jsx` | `handleDeleteVirtual()` (l.537–567) → W5 | DELETE | Borra un clon | −1 tarjeta |
| W12 | ídem | `handlePurgeOrphans()` (l.568–600) → W5×N | DELETE | Purga clones huérfanos | −N tarjetas |
| W13 | `SpecialistModal.jsx` | `dispatchPatch` (l.86) → W4 | PATCH `/fields` | Mutación in-place de exclusiones | — |
| W14 | `PrefixManager.jsx` | `handleSaveRow()` (l.130–152) y `handleSaveBatch()` (l.154–176) → W7 | PATCH `/fields` | **Sobrescribe prefijo libremente (sin gate familiar/pool)** | Clobber posible |
| W15 | `ProfileGraph.jsx` | guardado de nodos sucios (l.330–354) → W7 | PATCH `/fields` | **Sobrescribe prefijo libremente** | Clobber posible |
| W16 | `ControlSwitcher.jsx` | **solo lecturas** (l.214, 229, 238: list/download/api-call); importa `patchAuthFilePrefix` (l.2) **sin usarlo nunca** (import muerto) | — | — | — |
| W17 | CLI raíz `internal/client/client.go` | `PatchAuthPrefix()` (l.309–340; body `{name, prefix, note}`) usado por `internal/switcher` | PATCH `/fields` | Mutación in-place; además sincroniza `note` | Rotación promote/demote |
| W18 | CLI raíz `internal/switcher/switcher.go` | `SwitchToAccount()` (l.211–385), `RunProvider()` (l.388+), `Run()` (l.681+) | W17×2 (promote + demote con rollback l.368–374) | Intercambio de prefijos activo/reserva | — |

**Generadores** (crean estado de pool desde cero): solo W8 (GroupManager). **Derivadores** (proyectan estado): `buildManagedPoolCards()` (managementClient.js l.1256–1480), AutoAuthFiles, ProfileGraph, ControlSwitcher, Pi extension. **Mutadores libres** (sin gate): W14, W15, W17/W18 — fuentes de clobber fuera de GroupManager.

### 2. Causa raíz exacta del clobber/duplicación de dos pools (traza línea a línea)

Estado inicial del usuario: 4 maestros, prefijos `agy` (líder), `agy_1`, `agy_2`, `agy_3` (reservas). Verificado en disco [S-010] y en vivo [S-016].

**Camino A — Clonación (duplicación de tarjetas nativas):**
1. El usuario abre "Crear Group/Perfiles" y elige familia Claude (`gemini_claude`/`gemini_sonnet`/`gemini_opus`/`claude`) → `targetFamilyRole = 'claude'` (GroupManager.jsx l.222–234).
2. `leaderCandidates` (l.286–331) usa `freeCardsInTargetRole` (l.259–262): las **tarjetas Claude** de `buildManagedPoolCards` están libres (`assignedPrefix=''`) porque el maestro solo tiene prefijo Gemini → todos los maestros aparecen como candidatos.
3. Para cada candidato, `isVirtualSource(node)` (l.266–282): `classification.isMaster=true`, `pref='agy…'` → `isGeminiPref=true` → con `targetFamilyRole==='claude'` devuelve **`true`** → `{node, virtual:true}` (l.324–327).
4. `handleCreateGroup` → `queueAssignment` (l.576–583): `isVirtualSource(node)` otra vez `true` → `virtualJobs.push({sourceFile: <master>.json, prefix: 'agy_clau'…})`.
5. l.652–661: `virtualizeAccount({sourceFileName, prefix, targetModels, targetPatterns, oppositeModels})` → POST `/v0/management/auto-switcher-pro/virtualize`.
6. Plugin Go `Virtualize()` (virtualize.go l.74–128): `resolveAuthIndex` (l.229–246, `host.auth.list`) → `readAuthMetadata` (l.248–264, `host.auth.get`) → `metadata["prefix"]=prefix` (l.100) + `metadata["excluded_models"]=…` (l.101–107) → `saveAuthMetadata(targetName…)` (l.267–278, **`host.auth.save`**) con `targetName=deriveVirtualName(source,prefix)` (l.131–134) = `<base>.agy_clau.json` (reservas: `.agy_clau_1.json`…).
7. Resultado: **8 archivos en disco** → la vista nativa auth-files lista 8 tarjetas ( readdir directo). **Duplicación de tarjetas nativas: exactamente lo que el usuario rechaza.** La re-ejecución con sufijos distintos (cambios de prefijo entre re-creaciones) produce el *clone sprawl* de 12 archivos documentado en la auditoría 0415 [S-017].

**Camino B — Clobber in-place (destrucción del pool anterior):**
1. Si el maestro tiene prefijo **vacío** (tras disolver, o estado fresco), `isVirtualSource` devuelve `false` en l.273 (`if (!pref || pref.startsWith('unlinked_')) return false;`) → `queueAssignment` lo manda a `updates` → `saveAuthFilePrefixes` → **PATCH in-place del prefijo del maestro**.
2. Si el usuario crea primero el pool Claude sobre maestros libres (parchea a `agy_clau`, `agy_clau_1`…) y luego quiere recrear el pool Gemini, cada maestro tiene prefijo Claude → `isVirtualSource` con `targetFamilyRole='gemini'` devuelve `true` (l.280: `return isClaudePref`) → clona de nuevo (Camino A). **Pero** si el usuario reasigna prefijos a mano en PrefixManager (W14) o ProfileGraph (W15), o usa el CLI (W17/W18), el PATCH in-place sobrescribe el prefijo sin ninguna validación familiar/pool → **el pool anterior pierde a ese miembro silenciosamente**. Las `note` residuales en vivo (`agy_clau_1`, `agy_clau`, `agy2`, `agy2_1` con prefijos reales `agy`, `agy_1`, `agy_2`, `agy_3` [S-016]) son el rastro forense de estos experimentos in-place.
3. Adicionalmente, en `buildManagedPoolCards` (managementClient.js l.1395 y l.1443) el poolRole se deriva por regex `^(.*)_(\d+)$` sobre el prefijo: `agy_clau_1` se interpreta como reserva del pool base `agy_clau` — cualquier PATCH que cambie el prefijo re-etiqueta la tarjeta al vuelo, sin estado persistente que defienda la pertenencia original.

**Conclusión de causa raíz**: la pertenencia a pool **no existe como estado**; se *deriva* del prefijo del archivo en disco. Como el nativo solo admite un prefijo por archivo, una misma identidad física no puede ostentar dos pertenencias simultáneas, y el plugin actual resuelve esa limitación con las dos salidas que el usuario rechaza (clonar archivo = duplicar tarjeta nativa; sobrescribir prefijo = destruir pool previo).

### 3. Matriz de consistencia (quién genera, deriva, muta)

| Componente | Rol sobre pools | Genera estado | Deriva/lee | Mutador de disco | Coherente con invariant nativo | Observaciones |
|---|---|---|---|---|---|---|
| **GroupManager** | **Generador único** (Líder+Reservas, familia) | Sí (vía prefijos/clones) | `buildManagedPoolCards`, `listModels` | Sí: W8–W10 | Parcial: impone 2N archivos o clobber | Puerta `freeCardsInTargetRole` bloquea reasignar tarjetas ocupadas *dentro del mismo rol familiar*, pero PrefixManager/ProfileGraph/CLI no tienen gate |
| **AutoAuthFiles** | Visor + limpieza | No | `buildManagedPoolCards` (desde nodos=disk) | Sí: W11, W12 (solo borrado de clones) | Sí (es un espejo del disco) | Hoy muestra derivación de disco, no estado de plugin; "purge orphans" es el único saneador |
| **ControlSwitcher** | Visor de telemetría/cuotas | No | list/download/api-call (l.214–260) | **No** (import muerto de `patchAuthFilePrefix`, l.2) | Sí | Riesgo latente: si alguien "conecta" ese import, se convierte en mutador sin gate |
| **PrefixManager** | Editor libre de prefijos | No | nodos | Sí: W14 (in-place sin gate) | **No** (permite clobber) | Fuente documentada de notas residuales y experimentos `agy2` |
| **ProfileGraph** | Editor topológico de prefijos | No | grafo | Sí: W15 (in-place sin gate) | **No** (permite clobber) | Guarda cualquier draft de prefijo por nodo |
| **Auth-files nativo (CPAMC)** | Fuente de verdad física | OAuth login crea maestros | readdir + fsnotify | PATCH `/fields`, DELETE, y `host.auth.save/delete` de plugins | Es el invariant | 1 archivo = 1 tarjeta = 1 prefijo [S-009, S-010] |
| **Pi extension (`cpamc-auto-switcher/src/provider.ts`)** | Consumidor downstream del catálogo | No | `/v1/models` + whitelist de prefijos conocidos (l.410: `agy`, `agy2`, `agy_son`, `agy_opus`, `agy_clau`) + `buildPoolLabelMap` (l.172) + exclusión de reservas `_(\d+)$` | No | Sí (read-only) | Depende del catálogo `/v1/models`; con Opción C los IDs virtuales aparecen ahí (prefixes ya whitelisted); con Opción D no cambia nada |
| **CLI raíz (`cmd/cpamc-auto-switcher`)** | Rotador externo por cuota | No | list/download/quota | Sí: W17/W18 (promote/demote in-place) | Parcial | Rota intercambiando prefijos activo↔reserva con rollback; quedaría obsoleto o repurpose bajo Opción C/D |

### 4. Capacidades reales del C-ABI del plugin (evidencia de código)

**(a) Contrato `cliproxy_plugin_init`** (main.go l.17–80, plugin.go): ABI v1 con 3 métodos plugin-side (`plugin.register|reconfigure`, `management.register`, `management.handle`) [S-001, S-002]. El registro actual declara `schema_version: 6` y `capabilities: {management_api: true}` únicamente (plugin.go l.39–56). `management.register` registra 2 rutas (POST/DELETE `/auto-switcher-pro/virtualize`) y 6 recursos UI (plugin.go l.59–107) — verificado en vivo (`/v0/management/plugins` devuelve los 6 menús) [S-014].

**(b) Host calls disponibles y usados**: solo 4 (`host.auth.list/get/save/delete`, virtualize.go l.16–19). `host.auth.delete` no aparece como string en el binario — se deduce que el host despacha la familia `host.auth.*` con despacho por prefijo/matching dinámico; el endpoint funciona (los tests previos y las purgas lo ejercitaron) [S-005, S-008]. No hay enable/disable de cuentas vía host call en el plugin actual (el campo `disabled` existe nativamente en el listing, pero ninguna UI del plugin lo muta).

**(c) Rotación (internal/switcher + internal/quota)**: NO usa enable/disable; **reescribe prefijos en runtime** vía `PatchAuthPrefix` (PATCH `/fields` con `{prefix, note}`) — `SwitchToAccount` promueve el objetivo a `agy` y demota el activo anterior a `agy_N` con rollback (switcher.go l.340–374). La selección es por umbrales de cuota 5h/semanal (`quota.ShouldRotate`, quota.go l.304–323; defaults 90%/95% en config.go l.14–15). Cooldown persistido en `~/.local/share/cpamc-auto-switcher/state.json` (state.go) — **fuera** del directorio de auth.

**(d) ¿Puede `excluded_models` emular aislamiento familiar?** Sí parcialmente, **por archivo**: `excluded_models` filtra qué modelos registra el archivo (verificado: los 4 maestros excluyen Claude y el catálogo `agy/*` solo contiene los 9 modelos gemini [S-016]). Soporta wildcards nativos (`gemini-2.5-*`, `*-preview`, `*flash*` — config.example.yaml l.478–481 [S-009]). **Pero** un archivo tiene UNA sola lista: no puede ser "Gemini-only" y "Claude-only" a la vez. Por tanto, `excluded_models` aísla familias **entre archivos**, no entre pools sobre el mismo archivo. Para 2 archivos gemini-only + 2 claude-only bajo el mismo prefijo sí construiría dos pools nativos — pero reparte cuentas entre familias (viola "la misma cuenta sirve ambos pools").

**(e) Otros mecanismos que el host soporta** (evidencia de binario [S-005, S-006] + probes en vivo [S-013–S-015]):
- **`model_provider`/`model_registrar` + `model.register`**: el plugin registra modelos en el catálogo del host (`callPlugin[go.shape.struct { Provider string; Models []pluginapi.ModelInfo }]`, `"Registered new model %s from provider %s"`, `"model provider panic: %v"`, `"model provider per-auth models panic: %v"`).
- **`model_router` + `model.route`**: respuesta `{Handled, TargetKind (auth_index|api_key|provider), Target, TargetModel, Reason}` → **re-dirige un request a una credencial física concreta con otro modelo base**. Es el mecanismo exacto que soporta tarjetas virtuales sin archivos.
- **`scheduler` + `scheduler.pick`**: respuesta `{AuthID, DelegateBuiltin, Handled, Reject, RejectReason, RejectCode}` (`"pluginhost: scheduler rejected auth pick"`) → el plugin elige la credencial por request.
- **Interceptores** `request.intercept_before/after`, `response.intercept_after`, `stream.intercept`, `response.normalize_after` con respuesta `{Path, Headers, Body, ClearHeaders, Terminate, StatusCode, …}` → reescritura total del request (incluido renombrar el modelo).
- **`quota_provider` + `quota.fetch/reset/describe`**; **`usage_plugin`**; **`executor` + `executor.execute/execute_stream`** (el plugin puede actuar de backend de modelo); **`auth_provider`/`frontend_auth_provider`** (flujos OAuth custom); **`command_line.register`**.
- Callbacks host-side adicionales: `host.model.execute/execute_stream/stream_close/stream_read`, `host.auth.get_runtime`, `host.routing.reset_cooldown`, `host.affinity.lookup` (sesiones pegajosas), `host.http.*` (outbound HTTP), `host.stream.close`, `host.log`.
- **Nativo de configuración**: `oauth-model-alias` (endpoint vivo `/v0/management/oauth-model-alias` → `{"oauth-model-alias":null}` [S-013]; tipo `{Items: map[provider][]config.OAuthModelAlias}`; strings `"oauth-model-alias[%s]: added (%d entries)"`) — alias de modelos por provider+channel; **alcance por-archivo no confirmado** (ver Unknowns). `force-model-prefix` (config.example.yaml l.152–153: cuando `true`, requests sin prefijo solo usan credenciales sin prefijo). `routing.session-affinity*`. `routing/strategy` vivo = `round-robin`; `weighted-round-robin`, `priority` (l.442) y `weight` (l.484) por credencial documentados.

### 5. Telemetría/cooldowns nativos soportan compartir archivo entre familias

El listing nativo expone `cooldowns[]` con `scope` + `model_key` + `retry_at` (managementClient.js l.463–479; ver en vivo [S-016]): el cooldown es **por modelo**, no por credencial completa — una cuenta en cooldown por Claude sigue sirviendo Gemini. Esto valida que un mismo maestro pueda servir dos familias concurrentemente sin que el agotamiento de una bloquee la otra a nivel de cooldown nativo (el agotamiento de cuota por familia se maneja igual: ventanas 5h/semanal separadas por familia en Antigravity, ya integradas por `fetchCardQuota`/`parseAntigravityQuotaPayload`).

---

## Evidence Review

| Conclusión clave | Fuentes | Confianza | Limitaciones |
|---|---|---|---|
| 1 archivo = 1 prefijo = 1 tarjeta; `prefix/model` dirige a la credencial | [S-009] config.example.yaml l.443, l.152–153; [S-010] disk; [S-016] catálogo vivo | HIGH | — |
| Causa raíz clone-vs-clobber en `isVirtualSource`/`queueAssignment` | [S-003] GroupManager.jsx l.266–282, 576–583, 639–661; [S-008] virtualize.go l.74–128, 267–278 | HIGH | Traza estática; no se ejecutó la creación de pools (prohibido mutar) |
| Plugin actual solo declara `management_api` y 4 host calls | [S-001] main.go; [S-002] plugin.go l.39–107; [S-008] virtualize.go l.16–19 | HIGH | — |
| Host expone `model_provider/model_router/scheduler/interceptores/quota/executor` como capacidades registrables de plugin | [S-005] strings+tipos binario: método `model.route`, `model.register`, `scheduler.pick`, tags JSON de capacidades, formas `callPlugin[…]`, panics; [S-006] rutas de código `/app/internal/pluginhost/*.go` | HIGH (existencia) / MEDIUM (esquema exacto de wire) | Binario sin símbolos de fuente; wire JSON reconstruido de metadatos de tipos Go; no se pudo consultar la fuente upstream en esta sesión (sin herramientas web) |
| Selección nativa round-robin/weighted con priority+weight+cooldowns por modelo | [S-015] `GET /v0/management/routing/strategy` = round-robin; [S-009] l.442/484; strings `weighted-round-robin`; archivos `conductor_selection.go` | HIGH | Comportamiento exacto del conductor no verificado por ejecución |
| `excluded_models` con wildcards filtra modelos por archivo | [S-009] l.477–481; [S-016] catálogo `agy/*` sin claude; disk exclusiones | HIGH | No aísla pools sobre el mismo archivo |
| Precedente de persistencia de estado por plugin | [S-012] `ego.db` (+wal/shm activos) escrito por `control-account` en `/CLIProxyAPI/plugins/` | HIGH | Patrón no documentado; es uso observado |
| `oauth-model-alias` existe nativo y está vacío | [S-013] HTTP 200 `{"oauth-model-alias":null}`; strings de tipos | HIGH (existencia) / LOW (semántica por-archivo) | No se probó escribir (prohibido); alcance de "channel" sin resolver |
| Estado vivo actual: 4 maestros, pool Gemini completo, notas residuales de experimentos previos | [S-010], [S-016] | HIGH | — |
| Tests actuales pasan: 339 vitest (16 archivos) + todos los paquetes Go | [S-018] ejecución de suites | HIGH | Cobertura de escenarios duales ausente (ver gaps) |

---

## Trade-offs and Risks

1. **Riesgo de contrato de wire (Opción C/D)**: el esquema exacto de `model.register`/`model.route`/`scheduler.pick` (nombres de campos, valores de `TargetKind`, versión de `schema_version` requerida) se reconstruyó del binario; un desajuste menor puede hacer que el host ignore o rechace el registro (`"unsupported schema-version %d"` existe). Mitigación: verificar contra la fuente upstream `github.com/router-for-me/CLIProxyAPI/v8` (paquete `sdk/pluginapi`) antes de implementar; el propio binario contiene los nombres de archivo fuente (`/app/sdk/pluginapi/...`) que delimitan el contrato.
2. **Rotación pierde "atomicidad de prefijo"**: hoy el intercambio Líder/Reserva es un PATCH de un campo; en la Opción C la rotación es una decisión por-request dentro del plugin (más granular, sin ventana de inconsistencia de fsnotify ~1–2 s, pero exige que el estado del plugin sea correcto y sobreviva reinicios del host).
3. **Compatibilidad de consumidores**: la extensión Pi filtra por whitelist de prefijos (`agy`, `agy2`, `agy_son`, `agy_opus`, `agy_clau`) — los IDs virtuales de la Opción C ya caen dentro de esa convención, pero si se cambia la convención de nombres de pool hay que actualizar `KNOWN_PREFIXES` (provider.ts l.410). El CLI raíz (`cmd/cpamc-auto-switcher`) queda obsoleto en su mecanismo (promoción por prefijo) y debería re-purposingarse a lector de telemetría o eliminarse.
4. **Perdida del "specialist gear" in-place**: `SpecialistModal` aplica exclusiones sobre el archivo físico; con 4 maestros compartidos entre familias, una exclusión in-place afecta a ambas tarjetas. En la arquitectura objetivo, la especialización debe ser atributo de la tarjeta virtual (estado del plugin) aplicado al enrutar (TargetModel fijo), no del archivo.
5. **Single point of failure del plugin**: si el plugin falla al cargar, las rutas virtuales desaparecen del catálogo (los maestros siguen sirviendo sus modelos base sin prefijo — `force-model-prefix: false`). El fallback nativo existe, pero los clientes que usen solo IDs de pool perderían servicio hasta que el plugin se recupere.
6. **Seguimiento de cuota**: las sondas de cuota por tarjeta (`fetchCardQuota`, POST `/v0/management/api-call`) operan sobre `auth_index` físico — sin cambio; pero la interpretación "cuota del líder familiar" exige que el plugin exponga su asignación líder↔auth_index en el estado para que la UI etiquete correctamente.

---

## Alternatives Considered

| Opción | Idea | Veredicto | Razón (evidencia) |
|---|---|---|---|
| A. Mantener 2N archivos (recomendación de la auditoría 1730) | 8 archivos deterministas: maestros + `<base>.<prefix>.json` por familia | **Rechazada por el usuario** (objetivo nuevo: 4 archivos para siempre); técnica pero viola el punto 1 | [S-003], [S-008], [S-017] |
| B. Modificar el core nativo (multi-prefijo por archivo) | `prefixes: [agy, agy_clau]` en un archivo | **Rechazada** | Rompería compatibilidad con actualizaciones del host (upstream `router-for-me/CLIProxyAPI`); además el usuario prohibió cambiar configs/binario |
| C. **Plugin como model_provider + model_router (RECOMENDADA)** | IDs virtuales de pool registrados por el plugin; `model.route` → `{target: auth_index}` | **Adoptar** | Cumple los 4 puntos; cero archivos derivados; capacidades presentes en el host [S-005, S-006]; riesgo acotado al wire-schema del plugin |
| D. Plugin como scheduler | `scheduler.pick` elige AuthID por request | **Alternativa válida** | Menos superficie de catálogo; pero las rutas `<pool>/<model>` nativas exigen que todos los maestros compartan prefijo y la familia se distingue solo por el modelo del request |
| E. Solo nativo: prefijo compartido + conductor | 4 archivos prefix `agy`, sin exclusiones, round-robin/weighted nativo | **Fallback degradado** | Cero plugin-routing; pierde Líder/Reservas explícito y umbrales de cuota por familia del switcher [S-009, S-015] |
| F. `oauth-model-alias` nativo | alias de modelos por provider/channel | **Insuficiente sola** | No hay evidencia de alcance por-archivo; sin él no puede construir pools por familia sobre las mismas cuentas [S-013] |
| G. Interceptor de requests (`request.intercept_before`) | reescribir el modelo del request en vuelo | **Complemento posible** | Más frágil que C (reescritura de payload por request); útil si C resulta limitado |

---

## Proposed Target Architecture (alineada a los 4 puntos del usuario)

**Punto 1 — Nativos: solo los 4 maestros para siempre.**
- `virtualizeAccount`/`DeleteVirtual` de clones se retiran del flujo de GroupManager (la ruta del plugin puede deprecarse o restringirse a saneamiento one-shot). Ningún componente del plugin vuelve a llamar `host.auth.save`/`host.auth.delete` salvo herramienta explícita de saneamiento con confirmación.
- Los 4 maestros mantienen `prefix` estable (p. ej. todos `agy` o vacío) y `excluded_models` gestionado solo como política de cuenta (no de pool).

**Punto 2 — GroupManager único generador.**
- Nuevo sub-sistema de estado en el plugin Go: `PoolRegistry` (persistido en `plugins/auto-switcher-pro-state.json`, precedente `ego.db` [S-012]) con esquema: `{ pools: [{ id, family, base_prefix, leader: {auth_index, master_file}, reserves: [{auth_index, master_file, n}], policy: {exclude55, specialist, exclusions} }], revision, updated_at }`.
- El plugin registra rutas de management propias (extensión de `management.register`): `GET/POST/PUT/DELETE /v0/management/auto-switcher-pro/pools` — GroupManager pasa a escribir **solo** estas rutas (JSON), nunca más `/auth-files/fields` para poblar pools.
- `model.register` publica al catálogo los IDs virtuales derivados del registro (p. ej. `agy/gemini-3-flash`, `agy_clau/claude-sonnet-4-6`, `agy_clau_1/...`).
- `model.route` resuelve líder→auth_index por familia con umbrales de cuota (reutilizando la lógica ya existente de `internal/quota` y sondas de cuota del host vía `host.auth.get_runtime`/api-call) y hace failover a reservas (reemplaza la promoción por PATCH del CLI).

**Punto 3 — Abstracción 2N en el estado del plugin.**
- La tarjeta Gemini y la tarjeta Claude de cada maestro son entradas del `PoolRegistry` (o entradas lazy de "card slots" por familia), no archivos. `buildManagedPoolCards` se re-escribe como lector del estado del plugin (fetch a las rutas de pools), manteniendo la misma forma de tarjeta para no romper AutoAuthFiles/GroupManager tests.
- La pertenencia familiar, el rol (leader/reserve/unassigned), las exclusiones por tarjeta y el gear especialista viven en el registro; el disco solo aporta identidad OAuth y telemetría.

**Punto 4 — AutoAuthFiles visor puro.**
- AutoAuthFiles consume `GET /v0/management/auto-switcher-pro/pools` + el listing nativo (solo para telemetría por auth_index y para detectar desviaciones): con registro vacío muestra **0 tarjetas**; cada pool creado por GroupManager materializa sus tarjetas 2N.
- Los detectores de clones huérfanos (`metric-orphan-clones`) se conservan como herramienta de saneamiento para el backlog histórico, pero al no generarse más clones dejan de ser parte del ciclo de vida normal.

**Migración (sin downtime destructivo):**
1. Fase 0 (verificación): confirmar el wire-schema de `model.register`/`model.route`/`scheduler.pick` contra upstream `sdk/pluginapi` (o prototipo contra el host vivo en un prefijo de prueba).
2. Fase 1: plugin declara capacidades nuevas manteniendo compatibilidad con la UI actual (sin eliminar aún `virtualize`).
3. Fase 2: GroupManager escribe en `PoolRegistry` (modo dual: escribe registro Y aplica PATCH/clones como hoy, para comparación A/B en un pool de prueba).
4. Fase 3: conmutar `model.route` como fuente de enrutamiento de pools; los prefijos de disco dejan de mutarse.
5. Fase 4: retirar clonación; AutoAuthFiles pasa a visor puro; CLI raíz se re-encuadra como herramienta de diagnóstico.

---

## Unknowns and Limits

1. **Wire-schema exacto de las capacidades plugin-side** (`model.register`, `model.route`, `scheduler.pick`): reconstruido de metadatos de tipos del binario; requiere confirmación con la fuente upstream `github.com/router-for-me/CLIProxyAPI/v8` (paquete `sdk/pluginapi` e `internal/pluginhost`). No había herramientas web en esta sesión para fetch de la fuente.
2. **`schema_version` aceptada para capacidades nuevas**: el plugin envía `schema_version: 6` (plugin.go l.42); el binario contiene checks `"unsupported schema-version %d"` y `"plugins[%d]: direct install requires schema_version %d"` — no se pudo determinar el rango aceptado ni si 6 habilita `model_provider`/`scheduler`.
3. **Semántica de `oauth-model-alias`** (alcance per-provider vs per-file vs per-"channel") y si "channel" equivale al prefijo de ruta: sin resolver; hoy está vacío en el host vivo.
4. **Comportamiento del conductor nativo con prefijos duplicados** (mismo prefijo en 4 archivos): la estrategia global es round-robin (verificado) y weight/priority existen, pero no se probó la selección real con 4 credenciales iguales (prohibido mutar el estado de disco para el experimento).
5. **`host.auth.delete`**: no aparece como string literal en el binario (0 hits) pese a que el plugin lo usa con éxito — el despacho del host probablemente matchea por prefijo de método; sin impacto práctico, pero documentado.
6. **Rotación por cuota dentro del plugin** (`model.route` consultando cuota por auth_index): se asume factible vía las sondas ya usadas por la UI (POST `/v0/management/api-call`) o `host.auth.get_runtime`; el contenido exacto de `HostAuthGetRuntimeResponse` no fue decodificado.
7. Los hallazgos de binario corresponden a la imagen `eceasy/cli-proxy-api:latest` (binario del 2026-10-03); actualizaciones del host pueden mover el contrato (el plugin ya degradó con elegancia en el pasado: fallback legacy `/visual-profile/virtualize` en managementClient.js l.1030–1040).

---

## Test Gap List (brechas de cobertura a cerrar)

Cobertura actual: 339 tests vitest (16 archivos) + Go completo en verde [S-018]; GroupManager tests ejercitan `virtualizeAccount` (25 tests) pero **ningún test cubre el escenario dual simultáneo**. Gaps:

1. **G1 — Dual-pool simultáneo**: test de `handleCreateGroup` creando pool Gemini `agy` y pool Claude `agy_clau` sobre los MISMOS 4 maestros, afirmando (a) qué mutaciones de disco se emiten y (b) que el resultado actual clona 4 archivos (test de caracterización que documenta el comportamiento a reemplazar).
2. **G2 — Clobber por reasignación**: test de PrefixManager/ProfileGraph cambiando el prefijo de un miembro de pool activo, documentando que hoy no hay gate (debe fallar tras el refactor con la nueva arquitectura).
3. **G3 — `isVirtualSource` matriz de decisión**: tabla de casos (prefijo vacío, `unlinked_*`, gemini-pref, claude-pref, pref no familiar como `codex`/`ocgo`, prefijo de segunda familia `agy2`) — hoy solo cubierta parcialmente.
4. **G4 — `buildManagedPoolCards` con estado del plugin**: tests del lector nuevo (registro vacío → 0 tarjetas; pool creado → 2N tarjetas; maestro sin pool → tarjetas unassigned).
5. **G5 — Contrato RPC del plugin**: tests Go para `model.register`/`model.route` con stubs del host (extendiendo el patrón `HostCaller` de `virtualize_test.go`), incluyendo failover líder→reserva y reject.
6. **G6 — Persistencia y recovery del `PoolRegistry`**: escritura atómica, carga corrupta (fail-closed a registro vacío + advertencia), revisión concurrente.
7. **G7 — Round-trip con el host**: test de integración (marcado skip si no hay host) registrando capacidades contra el host vivo y verificando que `/v1/models` incluye los IDs virtuales.
8. **G8 — Extensión Pi**: test de `provider.ts` con catálogo mezclado (IDs virtuales de plugin + rutas nativas de maestros), whitelist y supresión de reservas.
9. **G9 — Disolución sin disco**: `handleDissolvePool` sobre el registro del plugin no debe emitir ningún DELETE de auth-file (hoy emite `deleteAuthFile` para clones, GroupManager.jsx l.820).
10. **G10 — Invariant de auditoría**: test de humo que liste `/root/.cli-proxy-api` (vía API nativa) y afirme `len(files) == len(masters)` tras crear+disolver pools duales — la "tripwire" del punto 1 del usuario.

---

## Recommended Next Actions

1. **Verificar el contrato `sdk/pluginapi`** contra la fuente upstream de CLIProxyAPI v8 (fetch de `pluginapi` + `pluginhost` o prototipo del método `model.register` contra el host vivo con un plugin de prueba en un prefijo sandbox) — es la única incertidumbre que separa la recomendación de su implementación.
2. **Saneamiento de notas residuales** (opcional, decisión del usuario): las `note` (`agy_clau_1`, `agy_clau`, `agy2`, `agy2_1`) divergen de los prefijos reales; un PATCH `/fields` sincronizando `note` con `prefix` restaura la trazabilidad del listing nativo (requiere autorización explícita de escritura, fuera del alcance de esta auditoría).
3. **Redactar el OpenSpec del cambio** (`PoolRegistry` + capacidades `model_provider`/`model_router` + migración por fases) usando este informe como discovery, con los tests G1–G10 como criterios de aceptación.
4. **Eliminar el import muerto** `patchAuthFilePrefix` de ControlSwitcher.jsx l.2 (higiene; evita que un futuro cambio lo convierta en mutador sin gate).
