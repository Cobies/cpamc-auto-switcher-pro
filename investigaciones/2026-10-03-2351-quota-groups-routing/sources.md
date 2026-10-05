# Sources

## Source Index

### S-001: Payload real de `retrieveUserQuotaSummary` (captura en vivo, 2 cuentas)
- Family: PRIMARY
- URL or locator: `POST http://127.0.0.1:8317/v0/management/api-call` → upstream `https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` (payload completo reproducido en report.md, Parte 1)
- Date/version: 2026-10-03T23:44:04Z (header `Date` de la respuesta upstream)
- Access method: curl (Authorization Bearer con key local; solo lectura — POST de consulta de cuota autorizado por la tarea)
- Used for: F1, F2, F3, F8 (displayName de grupos/buckets, estructura, bucket 5h `disabled: true`)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: capturado para ambos auth_index antigravity (`024c6ab99ae9f690`, `05c8eb9525e2d133`), ambos con `project: "aicode-consumers"`; HTTP 200; el payload no contiene credenciales ni datos personales. Endpoints de fallback (`sandbox`, `cloudcode-pa`) no fueron necesarios. Estado efímero: `remainingFraction` cambia con el uso.

### S-002: Deployment local CLIProxyAPI (Docker, vivo)
- Family: PRIMARY
- URL or locator: contenedor `cli-proxy-api` (imagen `eceasy/cli-proxy-api:latest`), puerto 8317; `GET /v1/models`, `GET /v0/management/auth-files`, `GET /v0/management/auth-files/download?name=...`, `GET /v0/management/force-model-prefix`
- Date/version: CLIProxyAPI v8.0.13, Commit d7914af, BuiltAt 2026-10-03T09:03:16Z (log de arranque)
- Access method: curl + docker logs (solo lectura)
- Used for: F5-F6 (prefijos `agy_` y `agy__1` en vivo, doble registro base+prefijado en catálogo, `force-model-prefix: false`)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: la descarga de auth-files se hizo para leer solo campos no secretos (`prefix`, `email`, `disabled`); los tokens/credenciales no se registraron ni persistieron. Estado puede cambiar con rotaciones del switcher.

### S-003: internal/client/client.go (cliente Management API de CPAMC)
- Family: PRIMARY (código de aplicación)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/internal/client/client.go
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: formato exacto de la petición `api-call` usada en la captura (GetQuotaSummary, líneas 196-239; doAPICall 142-193; endpoints fallback 13-17)
- Usefulness: MATERIAL
- Confidence impact: HIGH

### S-004: internal/quota/quota.go (parseo de grupos/buckets y filtro por perfil)
- Family: PRIMARY (código de aplicación)
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/internal/quota/quota.go
- Date/version: estado del repo 2026-10-03
- Access method: read
- Used for: C2/F2 (structs `Group`/`Bucket` líneas 14-21), F8 (ClassifyWindow 51-62; filtro por perfil 66-79; no parsea `disabled` ni `bucketId`)
- Usefulness: MATERIAL
- Confidence impact: HIGH

### S-005: router-for-me/CLIProxyAPI — sdk/cliproxy/service_models.go y sdk/cliproxy/auth/conductor_models.go (registro de modelos con prefijo y reescritura)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/sdk/cliproxy/service_models.go (applyModelPrefixes 623-663; llamadas 231-299) y .../sdk/cliproxy/auth/conductor_models.go (rewriteModelForAuth 700-711; executionModelCandidates 171-189)
- Date/version: v8.0.13, commit d7914af (misma release que el deployment local)
- Access method: curl (codeload tarball a /tmp, eliminado tras análisis)
- Used for: C3/F5 (doble registro base+`prefix/modelo`; supresión del modelo base si `force-model-prefix`; strip del prefijo antes del upstream)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `force-model-prefix` está bajo `routing.force-model-prefix` (internal/config/config_v8.go:77; sdk_config.go:48-51).

### S-006: router-for-me/CLIProxyAPI — sdk/cliproxy/auth/selector.go y conductor_selection.go (selección de credenciales)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/sdk/cliproxy/auth/selector.go y .../conductor_selection.go
- Date/version: v8.0.13, commit d7914af
- Access method: curl (tarball a /tmp, eliminado)
- Used for: C4/F7 (RoundRobinSelector.Pick 614-655 con clave `provider:model`; FillFirst 812; SessionAffinity 927+; prioridad 364-377; filtrado/cooldowns 471-560; authSupportsRouteModel conductor_selection.go:996-1009; pickNext 1980, pickNextMixed 2154)
- Usefulness: MATERIAL
- Confidence impact: HIGH

### S-007: router-for-me/CLIProxyAPI — config y catálogo (internal/config, internal/registry/models)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI/blob/d7914af/internal/config/config_types.go (RoutingConfig 352-375), internal/registry/models/models.json, config.example.yaml; y config local ~/services/cliproxy/config.yaml (leído read-only)
- Date/version: v8.0.13, commit d7914af
- Access method: curl (tarball) + read local
- Used for: C4 (estrategias selector, default round-robin), cooldown activo y `request-retry: 0` del deployment, catálogo antigravity embebido
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: config local contiene claves/secrets; solo se extrajeron las claves `routing.*`, `server.port` y `plugins.*`. El hash bcrypt del management key visible en config no se reprodujo en el reporte.

### S-008: /v1/models en vivo (catálogo público del deployment)
- Family: PRIMARY
- URL or locator: `GET http://127.0.0.1:8317/v1/models`
- Date/version: 2026-10-03T23:47Z
- Access method: curl
- Used for: F5/F6 (289 modelos; rutas `agy_/gemini-3.7-flash-high`, `agy__1/gemini-3.8-flash-high`, `gemini-3.8-flash-high` base, etc.)
- Usefulness: MATERIAL
- Confidence impact: HIGH

### S-009: Catálogo remoto de modelos router-for-me/models
- Family: PRIMARY
- URL or locator: https://raw.githubusercontent.com/router-for-me/models/refs/heads/main/models.json
- Date/version: ref main, consultado 2026-10-03T23:49Z
- Access method: curl
- Used for: C6 (14 modelos antigravity: `gemini-3.7-flash-high`, `gemini-3.8-flash-high`, `claude-sonnet-4-6`, `gpt-oss-120b-medium`, etc.; no existe `gemini-3.8-pro`)
- Usefulness: SUPPORTING
- Confidence impact: MEDIUM
- Notes: se refresca cada 3 h por CLIProxyAPI (log del contenedor: `periodic model refresh started (interval=3h0m0s)`); IDs sujetos a cambio externo.

### S-010: Repositorio router-for-me/CLIProxyAPI (metadatos)
- Family: PRIMARY
- URL or locator: https://api.github.com/repos/router-for-me/CLIProxyAPI
- Date/version: consultado 2026-10-03T23:40Z; pushed_at 2026-10-03T21:50Z
- Access method: curl (GitHub API)
- Used for: identificación del upstream (luispater/CLIProxyAPI ya no existe como repo con ese nombre; el activo es router-for-me/CLIProxyAPI)
- Usefulness: CONTEXT
- Confidence impact: LOW

## Discarded / Low-value sources

- `internal/registry/models/models.json` embebido (solo 2 modelos antigravity 3.x): superado por el catálogo remoto [S-009] que el binario refresca; se cita solo como contexto.
- Tests de CLIProxyAPI (`selector_test.go`, `conductor_*_test.go`, `catalog_credential_quota_regression_test.go`): útiles para orientación, no citados como prueba (no se evaluaron asserts en detalle).
- Docs del repo (`docs/management-api-v8.md`, READMEs): solo confirman round-robin multi-cuenta en el README (línea 131); la evidencia de enrutamiento se tomó del código.
- Engram memory: sin registros relevantes para estas dos incógnitas (mem_search sin resultados).
