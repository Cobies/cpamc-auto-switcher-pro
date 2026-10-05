# Sources

## Source Index

### S-001: Deployment local CLIProxyAPI — listado de auth-files (v0 y alias v8, en vivo)
- Family: PRIMARY
- URL or locator: contenedor `cli-proxy-api` (imagen `eceasy/cli-proxy-api:latest`), `http://127.0.0.1:8317`; `GET /v0/management/auth-files` y `GET /v8/management/credentials` (Bearer `~/.cliproxy_management_key`)
- Date/version: CLIProxyAPI v8.0.13, commit d7914af; captura `Sun, 04 Oct 2026 04:43Z`
- Access method: curl (solo lectura; GET)
- Used for: F3, F19, F20, C1 (existencia y forma del listado; `auth_index` por archivo; ausencia de `prefix` en el listado; 6 archivos, 4 `antigravity`, ninguno con prefix expuesto)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `GET /v8/management/credentials` → HTTP 200 (alias vivo); `GET /v8/management/auth-files` → 404 (v8 usa `/credentials`). No se registraron ni persistieron tokens.

### S-002: Deployment local — metadatos de auth-file (download, en vivo)
- Family: PRIMARY
- URL or locator: `GET http://127.0.0.1:8317/v0/management/auth-files/download?name=antigravity-infosoytec@gmail.com.json`
- Date/version: 2026-10-04T04:43Z (v8.0.13, d7914af)
- Access method: curl (solo lectura); se imprimieron SOLO campos no secretos (`type`, `prefix`, `excluded_models`, `disabled`, `project_id`, `email`) y la mera presencia booleana de tokens
- Used for: F19, RISK-4, C12 (archivo con `prefix:"agy"`, `excluded_models` de 12 ids, `project_id:"aicode-consumers"`; el `refresh_token` presente)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: los valores de `access_token`/`refresh_token` NO se registraron. El listado v0 no muestra `prefix` (S-020), por eso se usó download.

### S-003: Deployment local — sondeo CORS OPTIONS (en vivo)
- Family: PRIMARY
- URL or locator: `OPTIONS /v0/management/auth-files` → HTTP 204 con `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
- Date/version: 2026-10-04T04:43Z
- Access method: curl
- Used for: (no citado en report.md)
- Usefulness: DISCARDED
- Confidence impact: LOW
- Notes: evidencia débil — las cabeceras CORS parecen genéricas para toda la ruta de management, no específicas del método POST. Descartada como prueba de existencia de ruta.

### S-004: CLIProxyAPI — `sdk/pluginapi/types.go` (host callbacks y tipos)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/sdk/pluginapi/types.go (`MethodHostAuthList/Get/GetRuntime/Save`; `HostAuthFileEntry`; `HostAuthGetRequest/Response{JSON}`; `HostAuthSaveRequest{Name,JSON}`/`HostAuthSaveResponse{Name,Path}`)
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: F1, F5, F20, C1, C2; base de la arquitectura server-side
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `HostAuthFileEntry` NO incluye campo `Prefix` ⇒ `get_runtime` no sirve para leer prefijos.

### S-005: CLIProxyAPI — `internal/pluginhost/auth_callbacks.go` (implementación host.auth.*)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/internal/pluginhost/auth_callbacks.go (`callHostAuthGet`, `callHostAuthSave`, `saveAuthFile`, `buildAuthFromFileData`, `upsertAuthRecord`, `authIDForPath`, `authPhysicalJSONByIndex`, `resolvedAuthDir`)
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: F1, F5, F6, F20, C1, C2, C3
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `saveAuthFile` escribe (0o600) y hace upsert; `buildAuthFromFileData` NO aplica `prefix`/`excluded_models`/`disabled` al registro runtime (raíz de F6/RISK-2/RISK-3).

### S-006: CLIProxyAPI — `internal/pluginhost/host_callbacks.go` (dispatch de callbacks)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/internal/pluginhost/host_callbacks.go (`callFromPlugin`, `callHostHTTPDo`)
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: Alternatives Considered (evaluación de `host.http.do`)
- Usefulness: SUPPORTING
- Confidence impact: MEDIUM
- Notes: `HTTPRequest.URL` documentado como "absolute upstream URL"; sin prueba de que un plugin pueda llamar a la Management API local.

### S-007: CLIProxyAPI — tabla de rutas de management (v0 y v8)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/internal/api/server_management.go (líneas 180-188) y .../internal/api/server_management_v8.go (líneas 43-50)
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: C1, C10, F2, F3, F4, RISK-8
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: v0: GET `/auth-files`, GET `/auth-files/models`, GET `/auth-files/download`, POST `/auth-files`, DELETE `/auth-files`, PATCH `/auth-files/status`, PATCH `/auth-files/fields`, POST `/auth-files/refresh`. v8 `/credentials` mapea a los MISMOS handlers. Sin endpoint "copy".

### S-008: CLIProxyAPI — `internal/api/handlers/management/auth_files_crud.go` (UploadAuthFile)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/internal/api/handlers/management/auth_files_crud.go (`UploadAuthFile`, `writeAuthFile`, `buildAuthFromFileData` con `SynthesizeAuthFile`, 207 MultiStatus)
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: F2, F11, RISK-3
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: acepta multipart o JSON crudo con `?name=`; la síntesis inmediata aplica `prefix`/`excluded_models` (a diferencia de `host.auth.save`).

### S-009: CLIProxyAPI — `internal/api/handlers/management/auth_files_fields.go` (PatchAuthFileFields)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/internal/api/handlers/management/auth_files_fields.go (`PatchAuthFileFields`, `syncAuthFileMetadataFields`)
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: Arquitectura (paso de fijar reserva `agy_clau_N`); base del flujo actual del plugin
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: `prefix` se sincroniza a `auth.Prefix`; otros campos (`excluded_models`) se escriben a metadata pero el atributo calculado se actualiza vía la re-síntesis del watcher.

### S-010: CLIProxyAPI — `internal/watcher/synthesizer/file.go` (síntesis de archivos y ParseAuths)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/internal/watcher/synthesizer/file.go
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: F7, F10, C4, C5, RISK-4
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `synthesizeFileAuths` aplica `prefix` desde metadata (líneas ~178-183 y ~135 para virtuales) y `ApplyAuthExcludedModelsMeta` por archivo (línea ~148). El parser de plugin se invoca con `AuthParseRequest`.

### S-011: CLIProxyAPI — `internal/watcher/synthesizer/helpers.go` (ApplyAuthExcludedModelsMeta)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/internal/watcher/synthesizer/helpers.go
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: F10, C5
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: para OAuth mezcla `perKey` (archivo físico) con la config global y **sobreescribe** `auth.Attributes["excluded_models"]` ⇒ virtuales comparten exclusiones.

### S-012: CLIProxyAPI — `internal/watcher/events.go` + `internal/watcher/clients.go` (fsnotify)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/internal/watcher/events.go y .../internal/watcher/clients.go
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: F7, F8, RISK-2, RISK-3
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Create/Write sobre `.json` → `addOrUpdateClientLocked` → `SynthesizeAuthFile` → `AuthUpdate`; `authFileUnchanged` compara SHA-256 y **suprime** si el contenido no cambió. `observeAuthFile` incrementa `fileObservations`.

### S-013: CLIProxyAPI — `sdk/cliproxy/auth/types.go` (auth_index)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/sdk/cliproxy/auth/types.go (`indexSeed`, `stableAuthIndex`, `EnsureIndex`, `AttributeAuthIndexSeed`)
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: F9, C6, RISK-6
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: para `.json`: `authType + ":" + absFilePath` → `sha256[:8]`. Virtuales usan seed propio.

### S-014: CLIProxyAPI — `sdk/cliproxy/auth/conductor_lifecycle.go` (Register/Update/persist)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/sdk/cliproxy/auth/conductor_lifecycle.go
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: F11, C5, C8
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `persist()` omite `IsPluginVirtualAuth` y `runtime_only`; sin dedupe por token; `updateInternal` usa `CredentialsChanged` por ID.

### S-015: CLIProxyAPI — `sdk/cliproxy/auth/conductor_refresh.go` (persistencia de refresco, CredentialsChanged)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/sdk/cliproxy/auth/conductor_refresh.go
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: F13, RISK-1
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `UpdateRefreshedAuth` persiste el auth refrescado; estados `invalid_grant`/`unauthorized` se registran; `CredentialsChanged` compara tokens por ID.

### S-016: CLIProxyAPI — `sdk/auth/filestore.go` (FileTokenStore.Save)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/sdk/auth/filestore.go
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: F11, F13, RISK-1
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: escribe `auth.Metadata` al `path` del auth; cada archivo conserva su propio `access_token`.

### S-017: CLIProxyAPI — ejecutor Antigravity (refresh y singleflight)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/internal/runtime/executor/antigravity_executor_auth.go y .../antigravity_executor_credits.go (`antigravityRefreshGroup singleflight.Group`)
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: F12, F13, C7, C12, RISK-1
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `RefreshToken` solo se reescribe si la respuesta lo incluye; la clave del singleflight es el propio `refresh_token` ⇒ coalescencia entre credenciales distintas dentro del proceso.

### S-018: CLIProxyAPI — `sdk/cliproxy/builder.go` (runtimeAuthSyncHook)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/sdk/cliproxy/builder.go
- Date/version: v8.0.13, d7914af
- Access method: curl (raw)
- Used for: (no citado directamente en report.md)
- Usefulness: CONTEXT
- Confidence impact: MEDIUM
- Notes: `WithPostAuthPersistHook(service.runtimeAuthSyncHook())` despacha `AuthUpdate` tras saves de management; respalda por qué PATCH/upload convergen.

### S-019: GitHub issue router-for-me/CLIProxyAPI #5381
- Family: IMPLEMENTATION
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/issues/5381
- Date/version: abierto 2026-09-01 (aún abierto a d7914af)
- Access method: GitHub API (read)
- Used for: F6, F8, RISK-2, RISK-3
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: describe exactamente que `host.auth.save` reconstruye el auth ignorando `prefix`/`disabled` y provoca pérdida de prefijos de modelo; confirma de forma independiente el análisis de código (F6).

### S-020: GitHub issue router-for-me/CLIProxyAPI #5351
- Family: IMPLEMENTATION
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/issues/5351
- Date/version: abierto 2026-08-30
- Access method: GitHub API (read)
- Used for: F20, S-002/RISK (verificación de prefix)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: confirma que el listado no expone `prefix` y que la única forma actual es descargar el archivo (tokens al navegador).

### S-021: GitHub issue router-for-me/CLIProxyAPI #2669
- Family: IMPLEMENTATION
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/issues/2669
- Date/version: abierto 2026-04-10
- Access method: GitHub API (read)
- Used for: (no citado en report.md)
- Usefulness: CONTEXT
- Confidence impact: LOW
- Notes: reporta asimetría save/load de `prefix` en OAuth; posiblemente obsoleto en d7914af; incluido como contexto de fragilidad del campo `prefix`.

### S-022: Código local — `plugins/visual-profile/main.go`
- Family: PRIMARY (código de aplicación)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/main.go
- Date/version: estado del repo 2026-10-04
- Access method: read
- Used for: F17, C11
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `stored_host` se captura en la C estática pero no existe función Go que invoque `stored_host->call` ⇒ el puente de host debe añadirse.

### S-023: Código local — `plugins/visual-profile/internal/plugin/plugin.go`
- Family: PRIMARY (código de aplicación)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/internal/plugin/plugin.go
- Date/version: estado del repo 2026-10-04
- Access method: read
- Used for: Executive Summary, F17, C11
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `plugin.register` declara `capabilities.management_api: true`; `management.handle` solo sirve estáticos; no declara `auth_provider`.

### S-024: Código local — `plugins/visual-profile/web/src/api/managementClient.js`
- Family: PRIMARY (código de aplicación)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/web/src/api/managementClient.js
- Date/version: estado del repo 2026-10-04
- Access method: read
- Used for: Executive Summary, F18, Alternativas
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `listAuthFiles` (GET), `downloadAuthFilePrefix` (descarga JSON completo y extrae solo `prefix`), `patchAuthFilePrefix`/`saveAuthFilePrefixes` (PATCH fields). La cabecera afirma que las credenciales nunca se almacenan/devuelven, pero el JSON crudo transita el navegador.

### S-025: Código local — `plugins/visual-profile/web/src/components/GroupManager.jsx`
- Family: PRIMARY (código de aplicación)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/web/src/components/GroupManager.jsx
- Date/version: estado del repo 2026-10-04
- Access method: read
- Used for: Arquitectura (GroupManager), F16, RISK-7
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `isPoolDescendant` excluye sufijos alfabéticos; `matchesFamilyModel` ya contempla `agy_clau*`; `geminiSubtype 'pure'|'claude'`; `handleCreateGroup` solo PATCH-ea nodos existentes.

### S-026: Código local — `plugins/visual-profile/web/src/components/PrefixManager.jsx`
- Family: PRIMARY (código de aplicación)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/web/src/components/PrefixManager.jsx
- Date/version: estado del repo 2026-10-04
- Access method: read
- Used for: (no citado en report.md)
- Usefulness: CONTEXT
- Confidence impact: MEDIUM
- Notes: edición de prefijos por fila y por lote vía PATCH; heurísticas de familia por substring (`g1/g2/g3/gemini`, `son/claude`).

### S-027: Código local — `internal/config/config.go` (switcher)
- Family: PRIMARY (código de aplicación)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/internal/config/config.go
- Date/version: estado del repo 2026-10-04
- Access method: read
- Used for: F16, C9, RISK-7
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `ParsePrefix` (greedy `^(.*)_(\d+)$` con `LastIndex`), `ConventionForProfile` ⇒ activo `agy_clau`, reservas `agy_clau_`.

### S-028: Código local — `internal/quota/quota.go` (switcher)
- Family: PRIMARY (código de aplicación)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/internal/quota/quota.go
- Date/version: estado del repo 2026-10-04
- Access method: read
- Used for: F15, C9, RISK-5
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `ParseQuotaSummary` filtra por perfil: `agy_clau*`/`clau*`/`son*` → Claude/GPT; `agy*`/`g*` → Gemini (`HasPrefix`).

### S-029: Código local — `internal/switcher/switcher.go`
- Family: PRIMARY (código de aplicación)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/internal/switcher/switcher.go
- Date/version: estado del repo 2026-10-04
- Access method: read
- Used for: Executive Summary, F15, RISK-5/RISK-6
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: descubre perfiles dinámicamente (`discoveredMap[parsed.Profile]`), cuota por `f.AuthIndex`, y estado solo con `last_check`.

### S-030: Código local — `internal/client/client.go` (switcher)
- Family: PRIMARY (código de aplicación)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/internal/client/client.go
- Date/version: estado del repo 2026-10-04
- Access method: read
- Used for: Executive Summary (mecanismo de lectura de prefijo/cuota del switcher)
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: `ListAuthFiles`, `GetAuthFileDetails` (descarga JSON, extrae `prefix`), `doAPICall` (POST `/v0/management/api-call` con `authIndex`).

### S-031: Engram obs 1190 — precedente de 12 cuentas virtuales
- Family: IMPLEMENTATION (memoria interna)
- URL or locator: mem:1190
- Date/version: registro previo (estado del repo 2026-10)
- Access method: mem_get_observation
- Used for: Executive Summary, F19, RISK-4
- Usefulness: MATERIAL
- Confidence impact: MEDIUM
- Notes: 12 virtuales desde 6 físicas (`agy_g1`,`agy_g1_1`,`agy_g1_2`,`agy_g2`,`agy_g2_1`,`agy_g2_2`,`agy_son`,`agy_son_1..5`); Gemini excluye `claude-sonnet-4-6`, Sonnet excluye `gemini-3.8-flash-high`. NO desplegadas actualmente (S-001).

### S-032: Reporte previo `investigaciones/2026-10-03-2234-visual-profile-plugin`
- Family: PRIMARY (documento interno)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/investigaciones/2026-10-03-2234-visual-profile-plugin/report.md (+ sources.md)
- Date/version: 2026-10-03
- Access method: read
- Used for: Executive Summary, F17, F18, RISK-7
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: establece que la lógica de pools vive en JS y se persiste vía PATCH; documenta ambigüedad de la convención y pools fantasma.

### S-033: Reporte previo `investigaciones/2026-10-03-2351-quota-groups-routing`
- Family: PRIMARY (documento interno)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/investigaciones/2026-10-03-2351-quota-groups-routing/report.md (+ sources.md)
- Date/version: 2026-10-03
- Access method: read
- Used for: F15, RISK-2
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: confirma 2 grupos de cuota (Gemini / Claude+GPT), doble registro `prefijo/modelo`, y `force-model-prefix:false` en el deployment.
