# Sources

> Convención: cada entrada de fuentes materiales se cita en `report.md` con su ID (`[S-0NN]`).
> Los accesos pueden contener variables de entorno sin valor; **no se incluyen secretos**.

## Source Index

### S-001: Extensión `cliproxyapi-dynamic-provider.ts` (jok3r-pi)
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/extensions/cliproxyapi-dynamic-provider.ts`
- Date/version: consultado 2026-10-04 (sin versión declarada)
- Access method: read / grep (`read` tool + `grep -n`)
- Used for: `PROVIDER_ID="cpamc"` (L33); `CACHE_PATH` (L37); `loadCachedModels`/`saveCachedModels` (L39-58); `resolveManagementKey` (L252); `fetchAccountPrefixesAndExclusions` (L279-335); `isCleanIncludedModel` + `KNOWN_ACCOUNT_PREFIXES` (L337-380); `fetchCLIProxyModels` y endpoint `/v1/models?client_version=1` (L382-429); `pi.registerProvider` y `models: cachedModels` (L438-458). Base de la sección 2, 4, 6 y del runbook.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Es la **única** fuente que registra un provider en jok3r-pi. Contiene el fallback de prefijos `nv` que puede inyectar modelos `[cpamc]` inexistentes.

### S-002: `dist/core/model-runtime.js` (pi-coding-agent)
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js`
- Date/version: paquete `@earendil-works/pi-coding-agent` v1.0.0
- Access method: read / sed / grep
- Used for: `available: all.filter(configuredProviders.has(provider))` (L181, L653); `configuredProviders` desde `checkAuth` (L195-203); `queueAvailabilityRefresh` (L210-265); `getAvailable` (L308-325); `getAvailableSnapshot` (L327); `hasConfiguredAuth` (L362); `refresh()` (L581-624); `markProvisionallyConfigured` (L641-655); `registerProvider` (L657-675); `registerVirtualModel` (L677-710).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Define la regla de visibilidad `/model`. `registerProvider` marca el provider como "provisionally configured" cuando `configuredRequestAuthStatus` lo considera configurado.

### S-003: `dist/core/provider-composer.js` (pi-coding-agent)
- Family: IMPLEMENTATION
- URL or locator: `.../dist/core/provider-composer.js`
- Date/version: v1.0.0
- Access method: read
- Used for: orden de composición `composeModelProvider`; semántica de `config.models` (reemplaza la lista), `applyModelsJson`, `applyExtension`, `oauth.modifyModels`, `modelOverrides`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Explica por qué `models: cachedModels` de CPAMC reemplaza el catálogo completo del provider.

### S-004: `dist/modes/interactive/components/model-selector.js` (selector nativo `/model`)
- Family: IMPLEMENTATION
- URL or locator: `.../dist/modes/interactive/components/model-selector.js`
- Date/version: v1.0.0
- Access method: read / grep
- Used for: hint `"Only showing models from configured providers. Use /login to add providers."` (L67); `loadModelsFromSnapshot()` usa `getAvailableSnapshot()` (L104); scopes `all|scoped`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: El selector nativo no filtra por provider distinto de los autenticados; sí mostraría el fantasma `cliproxyapi`.

### S-005: `dist/modes/interactive/model-catalog-refresh.js`
- Family: IMPLEMENTATION
- URL or locator: `.../dist/modes/interactive/model-catalog-refresh.js`
- Date/version: v1.0.0
- Access method: read
- Used for: `refreshModelCatalogs(modelRuntime)` → `modelRuntime.refresh({signal})` sin `providers` (refresco completo al abrir el selector); coordinación de refrescos concurrentes.
- Usefulness: SUPPORTING
- Confidence impact: MEDIUM
- Notes: Soporta la afirmación de que abrir `/model` dispara refresco de red (y potencial re-persistencia de overlays).

### S-006: `@earendil-works/pi-ai` `dist/models.js` (`ModelsImpl`)
- Family: IMPLEMENTATION
- URL or locator: `.../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/models.js`
- Date/version: pi-ai v1.0.0
- Access method: read
- Used for: `checkAuth` (L285); `getAuthenticatedProviders` (L297-305); `getAvailable` = providers autenticados → `getModels()` (L307-316); `publishProviderModels` (`persist===null` → delete; `!==undefined` → write) (L134-160); `runProviderRefreshPhase` (L163-173); `refresh` (`allowNetwork ?? true`) (L174-200).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirma que `getAvailable` excluye providers sin credencial resoluble. Fuente decisiva para descartar que providers no autenticados puedan aparecer.

### S-007: Catálogos estáticos built-in `pi-ai/dist/providers/data/*.json`
- Family: PRIMARY (artefacto empaquetado del runtime)
- URL or locator: `.../pi-ai/dist/providers/data/{nvidia,opencode-go,opencode,zai,zai-coding-cn,…}.json` (42 archivos)
- Date/version: pi-ai v1.0.0, datadir mtime 2026-10-03 12:11
- Access method: read + parseo Python
- Used for: `nvidia` = 19 ids (incluye `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-3-ultra-550b-a55b`, `nvidia/nemotron-3.5-lightning-30b-a3b`, `nvidia/llama-3.1-nemotron-ultra-253b-v1`); `opencode-go` = 29 ids (incluye `deepseek-v4-pro`, `gpt-5.6-luna`); `opencode` = 81. Base de la corrección "borrar models-store no elimina los ghosts".
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Los ids coinciden con los usados en sesiones de jok3r → demuestran que los ghosts son catálogo estático, no derivados de CPAMC. La fecha de generación del datadir no se mapeó a un commit.

### S-008: Documentación oficial de Pi (`docs/*.md`)
- Family: PRIMARY
- URL or locator: `.../pi-coding-agent/docs/{models.md, providers.md, custom-provider.md, virtual-models.md, extensions.md, cli.md, settings.md, slash-commands.md}`
- Date/version: v1.0.0
- Access method: read / grep
- Used for: `--list-models [search]` (cli.md L73); `--models <patterns>` (cli.md L71); `enabledModels` como patrón de selección/cyclo (settings.md L16); `/scoped-models` (slash-commands.md L14, keybindings.md L186); `pi update --models` fuerza refresco (cli.md L266); composición de `models.json` sobre provider nativo y presencia de modelos virtuales en `/model`.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Documentación de producto; complementa (no sustituye) la lectura de código.

### S-009: Estado local del agente j0k3r (`auth.json`, `models-store.json`, `cpamc-models-cache.json`, `settings.json`)
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/{auth.json, models-store.json, cpamc-models-cache.json, settings.json, crashes.json}`
- Date/version: consultado 2026-10-04 08:2x; mtimes: auth.json 03:27 (`{}`), cpamc-models-cache.json 08:24 (35 entradas), models-store.json 08:21 (`{}`)
- Access method: read / `ls -la` / parseo Python
- Used for: `auth.json = {}` (sin credenciales almacenadas); ausencia de `models.json` en `/home/wilox/.pi/models.json`, `/home/wilox/.pi/agent/models.json`, `/home/wilox/.pi/agent-j0k3r/models.json`; `settings.json` (defaultProvider `cpamc`, defaultModel `nv/mistralai/mistral-nemotron`, sin `enabledModels`); `crashes.json` (4 entradas, `uncaught_exception` por `ctx` stale el 2026-10-04T07:06).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `models-store.json` fue vaciado (poda manual) en 08:21, por lo que no fue posible hacer diff id-a-id contra el catálogo estático; sólo cardinales (19/29) pre-poda registrados en sesión.

### S-010: CLIProxyAPI `/v1/models?client_version=1` (catálogo vivo)
- Family: PRIMARY
- URL or locator: `http://192.168.10.150:8317/v1/models?client_version=1`
- Date/version: consultado 2026-10-04 (respuesta 535 KB, `http=200`)
- Access method: curl (Bearer `$CLIPROXYAPI_API_KEY`) + parseo Python
- Used for: 218 entradas con campo `slug`; prefijos `nv`=79, `nvidia`=33, `nan`=26, `google`=9, `meta`=6, `mistralai`=6, `agy_clau`(+`_1/_2/_3`)=5 c/u, `ibm`=4, `writer`=4, `agy`=2, `agy2`=2, `agy2_1`=2, `agy_1`=2, singletons; pares duplicados `nan/nan/*` (13).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: La forma de la respuesta es `{"models":[{"slug":…}]}` (no `{"data":[…]}`); el primer parseo con la clave `data` devolvió 0 y fue corregido. El fallback `GET /v1/models` (OpenAI-style `data`) lo usa la extensión sólo si el enriquecido falla.

### S-011: CLIProxyAPI Management API (`/v0/management/auth-files` + `download`)
- Family: PRIMARY
- URL or locator: `http://192.168.10.150:8317/v0/management/auth-files` y `/v0/management/auth-files/download?name=<urlencoded>`
- Date/version: consultado 2026-10-04
- Access method: curl (Bearer `$CLIPROXYAPI_MANAGEMENT_KEY`) + parseo Python
- Used for: 10 archivos de autenticación; prefijos válidos `agy, agy2, agy2_1, agy_1, agy_clau, agy_clau_1, agy_clau_2, agy_clau_3, nan, ocgo`; campos `prefix`/`note` y `excluded_models`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: El campo `prefix` sólo aparece en el endpoint `download`; el endpoint de listado no lo expone (por eso la extensión descarga cada archivo). No se imprimieron valores sensibles.

### S-012: Sesiones de j0k3r-pi (`*.jsonl`) — histograma de modelos usados
- Family: IMPLEMENTATION (evidencia local de uso real)
- URL or locator: `/home/wilox/.pi/agent-j0k3r/sessions/**/*.jsonl`
- Date/version: sesiones hasta 2026-10-04
- Access method: grep + sed (histograma `"model":"<provider>/<id>"`)
- Used for: `nvidia/*` (810; p.ej. `nvidia/nemotron-3-super-120b-a12b` 580, `nvidia/nemotron-3-ultra-550b-a55b` 190, `nvidia/nemotron-3.5-lightning-30b-a3b` 39), `cliproxyapi/*` (95; p.ej. `cliproxyapi/agy3/gemini-3.8-flash-high` 80), `z-ai/glm-5.3` (34), `opencode-go/deepseek-v4-pro` (2), `agy_g1` (5070), `nan` (580), y el render del picker `actual: opencode-go/gpt-5.6-luna` + `3 proveedores · 21 cuentas · 41 modelos`.
- Usefulness: MATERIAL
- Confidence impact: MEDIUM-HIGH
- Notes: Evidencia de que esos providers estuvieron **autenticados** (fueron modelo activo). No prueba el estado exacto de `auth.json` en el instante del síntoma. Las cifras incluyen sesiones históricas de varios proyectos.

### S-013: Extensión `j0k3r-model-picker`
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/extensions/j0k3r-model-picker/{index.ts, src/api.ts, src/modal.ts}`
- Date/version: consultado 2026-10-04
- Access method: read / grep
- Used for: reemplaza el render de `/model`; usa `ctx.modelRegistry.getAvailable()` / `getProviderAuthStatus` / `getProviderDisplayName`; agrupa por provider→cuenta→modelo; **oculta el provider fantasma `cliproxyapi`**; no registra providers.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Es la razón por la que ver u ocultar `cliproxyapi` identifica qué componente renderizó el selector.

### S-014: Extensión `cpamc-runtime-ui`
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/extensions/cpamc-runtime-ui/src/picker.ts` (symlink desde `agent-j0k3r/extensions/cpamc-runtime-ui`)
- Date/version: consultado 2026-10-04
- Access method: read / grep
- Used for: registra el comando `/cpamc-model` (no `/model`); usa `context.modelRegistry?.getAvailable?.()`; el `/model` nativo queda intacto.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Descarta esta extensión como inyector del catálogo de `/model`.

### S-015: Entorno de los procesos Pi vivos (`/proc/<pid>/environ`)
- Family: IMPLEMENTATION
- URL or locator: `/proc/{412563,475939,499589,1674649,1756509}/environ`
- Date/version: consultado 2026-10-04
- Access method: `tr '\0' '\n' < /proc/<pid>/environ | grep`
- Used for: sólo `CLIPROXYAPI_API_KEY`, `CLIPROXYAPI_BASE_URL`, `CLIPROXYAPI_MANAGEMENT_KEY`, `GENTLE_PI_QUIET_TOOLS`, `PI_CODING_AGENT_DIR`; **ausencia** de claves built-in (NVIDIA/OPENCODE/ANTHROPIC).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Valores no impresos. Explica por qué los ghosts no deberían aparecer en el estado actual.

### S-016: `dist/core/remote-catalog-provider.js` (overlay pi.dev)
- Family: IMPLEMENTATION
- URL or locator: `.../dist/core/remote-catalog-provider.js`
- Date/version: v1.0.0
- Access method: read
- Used for: `DEFAULT_CATALOG_BASE_URL="https://pi.dev"`; `REMOTE_CATALOG_REFRESH_INTERVAL_MS=4h`; `withRemoteCatalog.refreshModels` (fases restore + red); nunca publica `persist:null`; `mergeModels` mezcla estático + overlay.
- Usefulness: MATERIAL
- Confidence impact: MEDIUM
- Notes: Soporta que el overlay no elimina catálogo estático y que un `models-store.json` vacío se vuelve a poblar en el siguiente refresco con red.

### S-017: `crashes.json` de j0k3r
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/crashes.json`
- Date/version: entradas 2026-10-04 (p.ej. 07:06:18)
- Access method: read / parseo Python
- Used for: 4 entradas `uncaught_exception` por `ctx` stale tras reemplazo de sesión/reload.
- Usefulness: CONTEXT
- Confidence impact: LOW
- Notes: No es causa directa del catálogo, pero indica reinicios/reloads que disparan `registerProvider` → re-siembra del caché de CPAMC.

### S-018: Directorio de agente backup (`agent-j0k3r-backup-20260924-131802`) y agente "gentle"
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r-backup-20260924-131802/{auth.json, models-store.json}`, `/home/wilox/.pi/agent/auth.json`
- Date/version: 2026-09-24 / 2026-10-04
- Access method: `ls` + parseo Python
- Used for: `auth.json` con credencial almacenada `opencode-go` (tipo `api_key`); `models-store.json` con `opencode-go` (32 modelos en el backup).
- Usefulness: SUPPORTING
- Confidence impact: MEDIUM
- Notes: Demuestra que `opencode-go` fue un provider autenticado en este entorno (en el agente gentle hoy; en j0k3r históricamente).

### S-019: Inventario de extensiones y paquetes de j0k3r-pi
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/extensions/**` (incl. symlinks a `cpamc-auto-switcher` y `cpamc-runtime-ui`), `/home/wilox/.pi/agent-j0k3r/settings.json` (`packages`), `/home/wilox/projects/cpamc-auto-switcher/pi extensions/cpamc-auto-switcher/index.ts`
- Date/version: consultado 2026-10-04
- Access method: `find` / `grep -rn "registerProvider|registerVirtualModel|registerNativeProvider"` (excluyendo `node_modules`, `sessions`, `pi-runtime`)
- Used for: única coincidencia `cliproxyapi-dynamic-provider.ts:438`; `cpamc-auto-switcher` sólo maneja `after_provider_response` (429); `typesafe` sólo registra herramientas + hook `before_agent_start`; `pi-subagents-j0k3r`, `gentle-engram@0.1.13`, `pi-mcp-adapter@2.37.0` sin registro de providers.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Es la evidencia negativa que descarta "extensiones ocultas inyectando modelos".

### S-020: Variables de shell (`~/.bashrc`) y ausencia de claves built-in
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.bashrc`, `/home/wilox/.profile`, `/home/wilox/.bash_profile`, `/home/wilox/.config/**`
- Date/version: consultado 2026-10-04
- Access method: `grep -oE "(export )?[A-Z_]*(API_KEY|TOKEN|KEY)[A-Z_]*="` (nombres) y `grep -rin "NVIDIA|OPENCODE|OPENAI_API_KEY|ANTHROPIC"` (redactado)
- Used for: sólo `CLIPROXYAPI_API_KEY` y `CLIPROXYAPI_MANAGEMENT_KEY`; sin claves de providers built-in.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Nombres de variables sí; valores redactados.

### S-021: Parseo inicial incorrecto de `/v1/models` (descartado)
- Family: UNKNOWN (artefacto de análisis)
- URL or locator: análisis propio sobre la misma respuesta de S-010
- Date/version: 2026-10-04
- Access method: script Python (clave `data`)
- Used for: —
- Usefulness: DISCARDED
- Confidence impact: LOW
- Notes: Se documenta para trazabilidad: una primera lectura asumió la forma OpenAI (`{"data":[…]}`) y devolvió 0 modelos; la forma real es `{"models":[{"slug":…}]}`. Corregido; no afectó conclusiones porque se re-parseó antes de escribir el informe.

### S-022: Sesión previa (07:25) con la hipótesis "48 fantasmas = filas de models-store.json" (contradicha parcialmente)
- Family: SECONDARY (afirmación previa dentro del mismo proyecto)
- URL or locator: `/home/wilox/.pi/agent-j0k3r/sessions/--home-wilox-projects-cpamc-auto-switcher--/2026-10-04T07-25-49-800Z_01a105ce-*.jsonl`
- Date/version: 2026-10-04T07:25Z
- Access method: grep + lectura de toolResults
- Used for: registrar la contradicción (los ghosts no se deben al archivo `models-store.json` ni son "no utilizables"); origen de la instrucción de "podar".
- Usefulness: CONTRADICTORY
- Confidence impact: MEDIUM
- Notes: La cifra "48" (29 `opencode-go` + 19 `nvidia`) coincide con los cardinales del store, pero el mecanismo de visibilidad es `configuredProviders`, no el store.
