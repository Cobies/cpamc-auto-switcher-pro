# Investigación: plugin "Auto switcher pro" (plugins/visual-profile) — arquitectura y análisis crítico de la función "agrupar"

## Executive Summary

El plugin "Auto switcher pro" (`plugins/visual-profile`, binario `visual-profile-linux-amd64.so`, v0.1.0, autor `gonzalez962`) **no es un conmutador automático**: es una biblioteca C-ABI que expone una SPA React embebida (5 submenús) sobre la Management API de CLIProxyAPI. Toda la lógica de negocio (leer auth-files, asignar prefijos, armar/disolver pools) vive en JavaScript en el navegador y se ejecuta vía `PATCH /v0/management/auth-files/fields`; el binario Go solo sirve estáticos y registra menús. El motor real de rotación automática es el binario host `cmd/cpamc-auto-switcher`, un proceso separado que solo comparte con el plugin la **convención de prefijos**.

La función "agrupar" no existe como entidad de datos: **un "grupo/pool" es puramente una convención de nomenclatura de prefijos** (`<base>` para el líder, `<base>_<N>` para reservas) escrita en el campo `prefix` de cada auth-file. Esta decisión de diseño genera el problema central del plugin: la lógica de agrupar está **duplicada en tres implementaciones divergentes** (GroupManager, modal de ProfileGraph, conexión manual del grafo), con semánticas de persistencia y numeración incompatibles entre sí.

Hallazgos críticos principales:

1. **[ALTO] GroupManager reporta éxito aunque los PATCH fallen**: `saveAuthFilePrefixes` nunca lanza excepciones (usa `Promise.allSettled` y devuelve `{successful, failed}`), pero `handleCreateGroup` y `handleDissolvePool` ignoran el campo `failed` y muestran "creado y guardado con éxito" incondicionalmente [S-009][S-005].
2. **[ALTO] Creación de pools no atómica**: los PATCH multi-cuenta son independientes; un fallo parcial deja pools a medio armar (líder renombrado sin reservas, o reservas huérfanas con prefijo de pool inexistente).
3. **[ALTO] Ambigüedad estructural de la convención**: la regex greedy `^(.*)_(\d+)$` hace indistinguibles `agy_team_2` como "reserva #2 de agy_team" vs "perfil team_2"; un nieto `agy_p1_1_1` es interpretado por el host como un **pool activo fantasma** `p1_1` [S-014][S-015][S-008].
4. **[MEDIO] El botón "Chequeo Forzado" del header promete "evaluación y rotación inmediata" pero solo recarga la lista de auth-files; no dispara rotación alguna** [S-012].

En contraste, el núcleo del editor de grafo (reducer atómico puro con guardas de descendientes) está bien diseñado y densamente testeado. El riesgo se concentra en la capa de orquestación de grupos, no en el editor.

## Research Question

¿Cómo funciona el plugin "Auto switcher pro" (`plugins/visual-profile-linux-amd64.so`, v0.1.0, gonzalez962), con foco crítico en la función "agrupar" y todas sus derivaciones/variantes: perfiles, visual profiles, disparadores de conmutación y manejo de estado? Objetivo: identificar arquitectura,flujo de datos, y defectos/casos límite/redundancias con evidencia `archivo:línea`.

## Recommendation or Answer

**Cómo funciona (hechos):**

- **Ciclo de vida C-ABI**: el host CLIProxyAPI carga el `.so` y llama `cliproxy_plugin_init`, que rellena la tabla `cliproxy_plugin_api` con `call`, `free_buffer` y `shutdown` (`main.go:22-37` [S-001]). Toda comunicación entra por `cliproxyPluginCall(método, payload JSON)` y se responde con un envelope `{ok, result|error}` (`internal/plugin/plugin.go:44-116` [S-002]). Métodos soportados: `plugin.register`/`plugin.reconfigure` (metadatos "Auto switcher pro", v0.1.0, gonzalez962, capability `management_api`), `management.register` (declara los 5 menús: `/create-prefixes`, `/create-groups`, `/control-switcher`, `/profiles`, `/pulse-tokens`), `management.handle` (sirve estáticos) y `unknown_method` como default.
- **Servido de UI**: `management.handle` parsea un payload HTTP serializado, aplica guardas (solo GET/HEAD — 405; segmento exacto — 404; traversal/`..`/null byte — 400), resuelve el asset desde `//go:embed` (`internal/web/embed.go`) y devuelve el cuerpo **base64** con cabeceras `nosniff` y `no-cache` (`plugin.go:168-288` [S-002]; `internal/handlers/resource.go:22-30` [S-003]).
- **Flujo de datos real**: el frontend obtiene la management key del `localStorage` del padre (iframe CPAMC) de-obfuscando el esquema `enc::v1::` (XOR con clave derivada de `salt|host|User-Agent`) (`managementClient.js:120-165, 200-260` [S-005]); lista auth-files (`GET /v0/management/auth-files`), descarga cada uno para extraer **solo** el campo `prefix` (descartando credenciales), reconstruye el grafo y persiste cambios con `PATCH /v0/management/auth-files/fields` (`managementClient.js:434-500, 565-690, 691-790`).
- **La rotación automática real no está en el plugin**: es el binario `cmd/cpamc-auto-switcher` (proceso externo con cooldown en disco, `state.go`), que descubre perfiles con `config.ParsePrefix`, evalúa umbrales (5h ≥ 90 %, semanal ≥ 95 %) e intercambia prefijos activo↔reserva con la misma PATCH (`switcher.go:300-640`, `config.go:110-202`, `main.go:203-280` [S-014][S-015][S-016]).

**Cómo funciona "agrupar" (deep-dive):**

No hay modelo de datos de grupo. Un pool es un **invariante de nomenclatura**: líder con prefijo base `B`, reservas con `B_1…B_N`. Derivaciones:

| Variante | Implementación | Deriva prefijos por | Persistencia |
|---|---|---|---|
| Armar pool (pantalla completa) | `GroupManager.jsx:115-167` [S-009] | Orden de selección: `${base}_${idx+1}` (línea 145), **sin chequeo de colisiones** | **PATCH inmediato** (`saveAuthFilePrefixes`, línea 153) |
| Disolver pool (pantalla completa) | `GroupManager.jsx:170-196` | — | **PATCH inmediato** (prefijo `''` a todos, línea 188) |
| Armar pool (modal del grafo) | `ProfileGraph.jsx:742-807` [S-008] | Reducer `CONNECT` con `getNextChildNumber` anti-colisión (`graphReducer.js:46-115`, `connection.js:66-100` [S-007][S-006]) | **Solo staging local** (marca `isDirty`); requiere "Save Changes" manual |
| Disolver pool (modal del grafo) | `ProfileGraph.jsx:809-855` | — | **Solo staging local** (`LOAD_GRAPH`) |
| Conexión manual en canvas | `graphReducer.js:46-115` vía `onConnect` (`ProfileGraph.jsx:225-238`) | `${padre}_${n+1}` con anti-colisión | Staging local |
| Asignación libre | `PrefixManager.jsx:117-155` [S-011] | Cualquier cadena (con detección de colisión visual, líneas 63-72) | PATCH inmediato |
| **Reconstrucción** del grafo al recargar | `buildGraphFromAuthFiles` (`managementClient.js:565-660`) | Regex greedy `^(.*)_(\d+)$`; arista solo si existe **exactamente 1** candidato a padre; duplicados → nodo "ambiguo" desconectado | Solo lectura |
| Lectura de pools (telemetría) | `ControlSwitcher.jsx:256-470` [S-010] | Regex sobre prefijos + pools canónicos hardcodeados g1/g2/son | Solo lectura |
| Ejecución de rotación (host) | `config.ParsePrefix` (`config.go:110-190`) + `switcher.RunProvider` [S-014][S-015] | Descomposición `<base>_<perfil>_<N>` greedy | PATCH swap 2 pasos |

**Recomendación**: tratar la capa de agrupado como la zona de riesgo del plugin. Antes de confiar en ella en producción: (a) hacer que GroupManager respete el `failed` de `saveAuthFilePrefixes`; (b) unificar la numeración de reservas en una única función anti-colisión compartida con el grafo; (c) prohibir jerarquías de profundidad > 2 (nietos) tanto en UI como en convención; (d) renombrar el botón "Chequeo Forzado" o conectarlo realmente al binario rotador.

## Key Findings

### Arquitectura y ciclo de vida

- **F1 — Shell estático sin backend propio** (PRIMARY, HIGH). El binario no implementa ninguna operación de negocio: `management.handle` solo sirve assets embebidos; el estado y las mutaciones ocurren 100 % en el navegador contra la Management API del host [S-002][S-005]. Implicación: todas las validaciones (regex de prefijo, un-solo-padre, anti-colisión) son **client-side** y pueden eludirse con cualquier otro cliente HTTP; el servidor acepta cualquier valor de `prefix` vía PATCH.
- **F2 — Multiplexado de rutas en un solo segmento** (PRIMARY, MEDIUM). `MatchProfilesRoute` acepta el segmento objetivo en **cualquier posición** del path (`plugin.go:121-152`): `/foo/profiles` y `/profiles` sirven lo mismo, y las 6 rutas (`profiles`, `control-switcher`, `pulse-tokens`, `pulso-tokens`, `create-prefixes`, `create-groups`) devuelven el mismo `index.html`; la SPA decide la vista por `window.location.pathname` (`App.jsx:10-31` [S-012]). El README afirma "exact segment matching" rechazando `/myprofiles`, lo cual es cierto, pero la coincidencia "en cualquier parte del path" es más laxa de lo que la descripción sugiere [S-004].
- **F3 — Doble implementación redundante del servidor de estáticos** (PRIMARY, LOW). Existen dos servidores de assets: `handlers.ResourceHandler` (net/http estándar, traversal → **404**, `resource.go:53-110` [S-003]) y `HandleManagementHTTP` (envelope C-ABI, traversal → **400**, `plugin.go:216-244` [S-002]). Solo el segundo parece usarse en el camino C-ABI; semánticas de error divergentes y código probablemente muerto.
- **F4 — Cuerpos base64 en cada respuesta** (PRIMARY, LOW). `ManagementResponsePayload.Body` va codificado en base64 (`plugin.go:39-42`), inflando ~33 % cada asset servido. Aceptable para un bundle único, pero es un impuesto permanente en cada carga.

### La función "agrupar" y derivaciones

- **F5 — [CRÍTICO] GroupManager ignora fallos de guardado** (IMPLEMENTATION, HIGH). `saveAuthFilePrefixes` resuelve siempre `{successful, failed}` sin lanzar (`managementClient.js:791-831` [S-005]). `handleCreateGroup` hace `await saveAuthFilePrefixes(updates)` y a continuación muestra `⚡ Pool "X" creado y guardado con éxito (N cuentas configuradas)` (`GroupManager.jsx:153-161`); ídem `handleDissolvePool` (`GroupManager.jsx:188-196`). Si todos los PATCH fallan (p. ej. 401 por key expirada), el usuario ve **éxito**. El pool queda a medio armar sin ningún aviso.
- **F6 — [CRÍTICO] No-atomicidad multi-cuenta** (IMPLEMENTATION, HIGH). Los PATCH son independientes (`Promise.allSettled`, `managementClient.js:806-812`). Escenarios de corrupción: (a) líder renombrado a `agy_g3` pero una reserva no recibe `agy_g3_1` → cascada con hueco; (b) una reserva renombrada pero el líder falla → reserva con prefijo de pool inexistente; el switcher host reportará "no account currently has active prefix" o tratará la reserva como `<otra_cosa>` según `ParsePrefix`. El propio código reconoce la no-atomicidad en la documentación del cliente (`managementClient.js:782-785`), pero la UI no lo comunica ni reintent.
- **F7 — [ALTO] Numeración de reservas divergente y sin colisión-check en GroupManager** (IMPLEMENTATION, HIGH). GroupManager asigna `${base}_${idx+1}` según orden de marcado (`GroupManager.jsx:140-149`) mientras el grafo usa `getNextChildNumber`, que evita colisiones contra todos los prefijos existentes (`connection.js:66-100` [S-006]). Además no se valida que `base` o `base_1…N` colisionen con prefijos ya asignados a otras cuentas. Los prefijos duplicados se permiten deliberadamente ("legitimate pool rotation", `managementClient.js:520-527, 797-799`), pero el host **aborta con error** ante dos activos con el mismo prefijo (`switcher.go:458-462` [S-015]). Es decir: el plugin permite por diseño un estado que rompe al rotador.
- **F8 — [ALTO] Ambigüedad estructural de la convención de prefijos** (PRIMARY+IMPLEMENTATION, HIGH). Tanto la inferencia del grafo (`managementClient.js:612`) como `ParsePrefix` del host (`config.go:110-190`) usan greedo `_(\d+)$` → cualquier prefijo terminado en `_N` es "reserva", sin distinción con perfiles cuyo nombre termina en número:
  - `agy_team_2` = reserva #2 del pool `agy_team` (nunca perfil `team_2`).
  - Un **nieto** `agy_p1_1_1` (el editor permite conectar un hijo como fuente de otro hijo, `validateConnection` no limita profundidad, `connection.js:152-206`) es parseado por el host como **perfil activo `p1_1`** (`config.go:150-165`: tail `1` dígito → `profilePart = "p1_1"` → IsActive). El switcher crea entonces un **pool fantasma** `p1_1` con la cuenta del nieto como activa.
  - Peor aún: `handleDissolvePool` del grafo solo limpia el root y sus **reservas directas** (`ProfileGraph.jsx:809-855`); si había nietos, sus prefijos `agy_p1_1_1` sobreviven y alimentan el pool fantasma tras guardar.
- **F9 — [MEDIO] Dos semánticas de persistencia opuestas para la misma acción** (IMPLEMENTATION, MEDIUM). "Armar pool" en GroupManager persiste al instante (PATCH); "Armar Grupo en Canvas" en el modal de ProfileGraph solo muta el grafo local y marca `isDirty` (`ProfileGraph.jsx:742-807`), requiriendo después ir a Visual Profile y pulsar "Save Changes". Un usuario que usa el modal y cierra sin guardar pierde todo silenciosamente; uno que usa GroupManager ya escribió en el servidor sin revisión previa.
- **F10 — [MEDIO] Tres definiciones de "cuenta libre"** (IMPLEMENTATION, MEDIUM). GroupManager: prefijo vacío o `unlinked_*`, **ignora aristas** (`GroupManager.jsx:25-33`). ProfileGraph modal: además sin aristas entrantes ni salientes (`ProfileGraph.jsx:637-650`). Además, en GroupManager una cuenta conectada como hija en el canvas pero con prefijo `unlinked_1` (estado posible tras `ADD_CHILD_NODE` + `removeEdgesAtomic` parcial) aparece como "libre" y puede agruparse dejando aristas residuales al recargar.
- **F11 — [MEDIO] Filtro de proveedor binario frágil** (IMPLEMENTATION, MEDIUM). La compatibilidad de reservas es `esCodex ? esCodex : !esCodex` (`GroupManager.jsx:39-52`): cualquier proveedor nuevo o campo `provider` vacío se mezcla con antigravity. El campo `provider` puede llegar vacío (el cliente lo copia tal cual, `managementClient.js:480-483`).
- **F12 — [MEDIO] Dos fuentes de verdad desincronizadas** (IMPLEMENTATION, MEDIUM). GroupManager/PrefixManager reciben `graphData.nodes` del servidor (`App.jsx:61-75, 425-437` [S-012]), no el estado vivo editado en ProfileGraph (que vive en el reducer interno accesible solo por ref). Ediciones staged en Visual Profile son **invisibles** para GroupManager: se puede armar un pool sobre prefijos que el usuario ya cambió (sin guardar) en el grafo, con resultado impredecible al reconciliar.
- **F13 — [BAJO] El botón "Chequeo Forzado" no fuerza nada** (IMPLEMENTATION, MEDIUM para expectativas). `handleHeaderForceCheck` solo re-ejecuta `loadProfiles()` (`App.jsx:82-98`), con feedback "⚡ Chequeo forzado y rotación completados". No invoca al binario rotador ni a endpoint de rotación alguno; el título ("Fuerza evaluación y rotación inmediata de cuotas") es engañoso. El `--force` real existe en el binario host (`main.go:60, 246-252` [S-016]) pero no está conectado.
- **F14 — [BAJO] Datos inventados presentados como telemetría en ControlSwitcher** (IMPLEMENTATION, MEDIUM de confianza). `resetDate: isAgotada ? '02 de Octubre' : null` es un literal fijo (`ControlSwitcher.jsx:416`); los pools canónicos g1/g2/son y sus modelos (`gemini-3.8-flash-high`, `claude-sonnet-4-6`, `gpt-5.6-codex`, `ControlSwitcher.jsx:266-285, 333-342`) y el pie de "Reglas de Rotación / Cooldown 5 min · Debounce 3 seg" son cadenas hardcodeadas, no leídas del estado del rotador. El panel mezcla cuotas reales (obtenidas vía `api-call` proxy, `ControlSwitcher.jsx:130-205`) con literales decorativos.
- **F15 — [BAJO] Polling agresivo sin backoff** (IMPLEMENTATION, LOW). ControlSwitcher consulta cuotas de **todas** las cuentas cada 20 s (`ControlSwitcher.jsx:251`), cada una con un download + un `api-call` proxied al proveedor upstream; con N cuentas son 2N peticiones/20 s contra la Management API y contra Google/OpenAI, con riesgo de rate-limit upstream y sin backoff ni caché.

### Manejo de estado (puntos positivos)

- **F16 — Reducer atómico puro, bien diseñado** (IMPLEMENTATION, HIGH de calidad). `graphReducer` es puro, idempotente bajo StrictMode, con guardas: anti-duplicado, un-solo-padre, anti-huérfanos (`partitionEdgeRemovals` con poda iterativa de lotes, `connection.js:246-315`), conciliación post-guardado (`RECONCILE_SAVED_NODES`, `graphReducer.js:414-470`) y baseline anti-stale en `ProfileGraph` (`ProfileGraph.jsx:120-135, 380-460`). El desvío documentado del patrón `setNodes/setEdges` hacia `useReducer` está bien justificado (README [S-004], `ProfileGraph.jsx:88-101`) y respaldado por 1 046 líneas de tests del reducer.
- **F17 — Inconsistencia de señalización en edición manual de prefijos** (IMPLEMENTATION, LOW). El guard "padre con hijos no renombrable" está duplicado: el componente devuelve `{success:false, error}` (`ProfileGraph.jsx:240-268`) y el reducer además lo rechaza en silencio (`graphReducer.js:261-265`); en cambio, la edición de un hijo **desengancha silenciosamente** su arista entrante (`graphReducer.js:267-271`) — comportamiento sorprendente y sin feedback.
- **F18 — Privacidad razonable en el cliente** (IMPLEMENTATION, MEDIUM de calidad). Los emails se enmascaran (`abbreviateEmail`), solo se extrae `prefix` del auth-file descargado y los errores se sanitizan (`managementClient.js:26-115, 434-500`); los nodos sintéticos del demo nunca se persisten (`ProfileGraph.jsx:294-300`, `managementClient.js:796-799`). La ofuscación `enc::v1::` (XOR con clave derivable de host+UA) es criptográficamente débil, pero es el esquema del host CPAMC, no del plugin [S-005].

## Evidence Review

| # | Claim | Fuentes | Confianza | Limitaciones |
|---|---|---|---|---|
| C1 | El plugin solo expone estáticos + registro de menús vía C-ABI v1 | [S-001][S-002][S-004] | HIGH | El `.so` no se inspeccionó binariamente; se asume que corresponde a este fuente (`.h` generado coincide con `main.go`) |
| C2 | Toda mutación de grupos pasa por `PATCH /v0/management/auth-files/fields` desde el navegador | [S-005][S-009][S-008] | HIGH | No se observó tráfico en vivo (investigación estática, read-only) |
| C3 | GroupManager muestra éxito ignorando `failed` | [S-005][S-009] | HIGH | Verificado por lectura directa de ambas funciones; ninguna prueba cubre el camino de fallo en GroupManager.test.jsx |
| C4 | La convención `base`/`base_N` es ambigua y el host la resuelve greedy | [S-006][S-014][S-015] | HIGH | Confirmado por lectura de `ParsePrefix`; no se ejecutó el switcher (no se muta estado) |
| C5 | Un nieto `X_N_M` se convierte en pool activo fantasma | [S-014][S-015] | MEDIUM–HIGH | Inferencia de código sólida; escenario no reproducido en runtime |
| C6 | "Chequeo Forzado" no rota | [S-012][S-016] | HIGH | — |
| C7 | La rotación automática real la ejecuta el binario externo con cooldown | [S-016][S-017] | HIGH | — |
| C8 | ControlSwitcher presenta literales hardcodeados como telemetría | [S-010] | HIGH | Es posible que algunos literales pretendan ser decorativos, pero se muestran sin distinción |

## Trade-offs and Risks

- **Riesgo operativo máximo**: pool a medio armar silencioso (F5+F6) degrada el enrutamiento CPAMC sin señal para el usuario; combinado con F7, puede dejar dos cuentas con el mismo prefijo activo, lo que **aborta** el ciclo completo de rotación del host (`switcher.go:458-462`).
- **Trade-off de diseño aceptado**: convención-de-nombres en vez de entidad-de-datos → cero esquema, pero todas las garantías son convencionales y cada cliente (plugin UI, binario host, cualquier script) puede reinterpretarlas. La ambigüedad `_(\d+)$` es el coste estructural permanente (F8).
- **Trade-off UX**: dos UIs de agrupar con semánticas opuestas (F9) favorecen prototipado rápido a costa de previsibilidad; el usuario no puede saber si una acción es local o remota.
- **Riesgo de confianza en telemetría**: mezclar cuotas reales con literales hardcodeados (F14) erosiona la fiabilidad del panel de control como instrumento de decisión.

## Alternatives Considered

- **Modelo de datos explícito de grupos** (p. ej. campo `pool` o `group` en el auth-file via PATCH de campos adicionales): eliminaría la ambigüedad `_(\d+)$` y los pools fantasma; requiere soporte del host CLIProxyAPI para campos extra (fuera del alcance de este repo).
- **Endpoint de plugin con lógica server-side** (`management_api` con métodos propios de "armar pool" atómico): el capability ya declara `management_api: true` pero solo sirve estáticos; centralizaría validaciones y haría la creación de pools transaccional.
- **Unificar las tres implementaciones de agrupar** en `graph/connection.js` (ya es la única con anti-colisión y tests): cambio de bajo riesgo, alta relación beneficio/coste.
- Descartadas: mantener estado de grupos en localStorage del navegador (frágil, multi-cliente) o derivar grupos por otro delimitador (rompe compatibilidad con el host ya desplegado).

## Unknowns and Limits

- No se inspeccionó el binario `.so` (solo el fuente y el `.h` generado); se asume sincronía fuente-binario (el flujo de build con Docker está documentado en [S-004], y la memoria de sesiones previas confirma el deploy [S-018]).
- No se verificó en runtime el comportamiento del host CLIProxyAPI frente al envelope `management.handle` (formato del payload `ManagementRequestPayload` se tomó del propio plugin, no del código del host CLIProxyAPI, que no está en este repo).
- El detalle de qué hace CLIProxyAPI con `PATCH /auth-files/fields` (validaciones server-side de `prefix`, atomicidad interna) es desconocido desde este repo; las conclusiones de atomicidad se limitan al cliente.
- Los nombres de modelos en ControlSwitcher (`gemini-3.8-flash-high`, etc.) no se contrastaron con catálogos externos; se reportan como literales del código, sin afirmar si corresponden a modelos reales.
- Investigación estrictamente read-only: no se ejecutaron tests ni builds (exclusión de la tarea).

## Recommended Next Actions

1. **Corregir F5/F6 (prioridad alta)**: en `GroupManager.jsx`, consumir `{successful, failed}` de `saveAuthFilePrefixes`, mostrar fallos por cuenta y ofrecer reintento selectivo (el mecanismo ya existe en ProfileGraph: `RECONCILE_SAVED_NODES` + banner "Retry").
2. **Unificar la numeración de reservas**: reemplazar `${base}_${idx+1}` de GroupManager por `getNextChildNumber` de `graph/connection.js`.
3. **Cerrar la puerta a los nietos (F8)**: en `validateConnection`, rechazar conexiones cuyo source ya tenga arista entrante (profundidad máx. 2), y en `handleDissolvePool` limpiar recursivamente descendientes o bloquear la disolución (la función `partitionEdgeRemovals` ya implementa la poda — reutilizarla).
4. **Corregir el copy de "Chequeo Forzado"** o invocar realmente al binario rotador (p. ej. endpoint/scheduler del host).
5. **Etiquetar los literales de ControlSwitcher** como decorativos o derivarlos del estado real; eliminar `resetDate` fijo.
6. **Agregar test de regresión** para el camino de fallo de GroupManager (hoy `GroupManager.test.jsx` no cubre `failed`).
