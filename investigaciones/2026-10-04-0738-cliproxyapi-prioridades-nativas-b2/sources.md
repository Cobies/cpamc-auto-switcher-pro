# Sources

## Source Index

### S-001: CLIProxyAPI upstream repo — router-for-me/CLIProxyAPI @ v8.0.13 (d7914af)
- Family: PRIMARY
- URL or locator: https://github.com/router-for-me/CLIProxyAPI (clone: /tmp/CLIProxyAPI, tag `v8.0.13`, commit `d7914afdedca7af95ee974a42453dc49fc1388ce`, date 2026-10-03)
- Date/version: v8.0.13 (publicado 2026-10-03T09:02:46Z)
- Access method: git clone (shallow) + GitHub API (`releases/latest`) + bash/grep/sed
- Used for: base de todo el análisis de enrutamiento nativo (secciones (a),(b),(d))
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: imagen desplegada es `eceasy/cli-proxy-api:latest`; el tag v8.0.13 coincide con la última release al momento del análisis.

### S-002: `sdk/cliproxy/auth/priority.go` (ApplyAuthPriorityMetadata, AttributeFilePriority)
- Family: IMPLEMENTATION
- URL or locator: /tmp/CLIProxyAPI/sdk/cliproxy/auth/priority.go; aplicado en `sdk/auth/filestore.go:301` y `internal/watcher/synthesizer/file.go:141,216`
- Date/version: v8.0.13
- Access method: read/grep
- Used for: (a) cómo el campo `priority` del auth file llega a `Attributes["priority"]`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: copia el valor a `Metadata`/`Attributes` y marca `file_priority="true"`.

### S-003: `sdk/cliproxy/auth/selector.go` (authPriority, availableAuthsFromPriorityBuckets, isAuthBlockedForModel, FillFirstSelector)
- Family: IMPLEMENTATION
- URL or locator: /tmp/CLIProxyAPI/sdk/cliproxy/auth/selector.go (líneas ~552, ~823, ~937)
- Date/version: v8.0.13
- Access method: read/sed
- Used for: (a) semántica de tiers (tier más alto disponible) y (b) bloqueo por modelo vs credencial
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `isAuthBlockedForModel` con `len(ModelStates)>0` y modelo no presente ⇒ no bloqueado (clave para cooldown por modelo).

### S-004: `sdk/cliproxy/auth/conductor_selection.go` (availableAuthsForRouteModelWithPriorityMode, availableAuthsForSelector)
- Family: IMPLEMENTATION
- URL or locator: /tmp/CLIProxyAPI/sdk/cliproxy/auth/conductor_selection.go
- Date/version: v8.0.13
- Access method: read/sed
- Used for: (a) selección de candidatos por prioridad para un `routeModel` sin prefijo
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: agrupa por prioridad solo los no-bloqueados; `modelCooldownError` cuando todos en cooldown.

### S-005: `sdk/cliproxy/auth/conductor_cooldown.go` (applyAuthFailureState, CredentialScope, isCredentialScopedError, quotaCooldownAfterFailure/nextQuotaCooldown)
- Family: IMPLEMENTATION
- URL or locator: /tmp/CLIProxyAPI/sdk/cliproxy/auth/conductor_cooldown.go
- Date/version: v8.0.13
- Access method: read/sed
- Used for: (a)(b) duración de cooldown (RetryAfter o backoff exponencial) y propagación credential-scoped
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `minQuotaCooldownFloor=10s`, `quotaBackoffBase=1s`, `quotaBackoffMax=30min` (en `conductor_refresh.go:37-40`).

### S-006: `sdk/cliproxy/auth/conductor_execution.go` (Execute/ExecuteStream/executeMixedOnce retry loop)
- Family: IMPLEMENTATION
- URL or locator: /tmp/CLIProxyAPI/sdk/cliproxy/auth/conductor_execution.go (líneas ~134-313, ~483-690)
- Date/version: v8.0.13
- Access method: read/sed
- Used for: (b) failover intra-petición tras un 429 (reintenta otra credencial)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `maxRetryCredentials=0` ⇒ intenta todas las credenciales disponibles en la ronda.

### S-007: Management API `auth-files/fields` (PatchAuthFileFields) y campos `prefix`/`priority`/`note`
- Family: PRIMARY
- URL or locator: /tmp/CLIProxyAPI/internal/api/handlers/management/auth_files_fields.go (257-450) y auth_files.go (395-470); rutas en `internal/api/server_management.go:183-187` y `server_management_v8.go:49`
- Date/version: v8.0.13
- Access method: read/grep
- Used for: (d) viabilidad de PATCH de `priority`/`note` sin tocar otro endpoint
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `PATCH /v0/management/auth-files/fields` (y v8 `PATCH /v0/management/credentials/fields`) acepta campos de metadatos arbitrarios.

### S-008: `sdk/cliproxy/service_models.go` (applyModelPrefixes, filtrado de excluded_models)
- Family: IMPLEMENTATION
- URL or locator: /tmp/CLIProxyAPI/sdk/cliproxy/service_models.go (600-673)
- Date/version: v8.0.13
- Access method: read/sed
- Used for: (a)(e) coexistencia de ID base y clon `prefijo/modelo`; exclusión aplicada antes del clonado
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: clon = `trimmedPrefix + "/" + baseID`; `forceModelPrefix=false` mantiene el ID base.

### S-009: Executor Antigravity (decideAntigravity429, umbrales, markAntigravityShortCooldownRequired, newAntigravityStatusErr)
- Family: IMPLEMENTATION
- URL or locator: /tmp/CLIProxyAPI/internal/runtime/executor/antigravity_executor_credits.go (200-380, 720-760), antigravity_executor.go (46-47), antigravity_executor_execute.go (155-190)
- Date/version: v8.0.13
- Access method: read/sed
- Used for: (b) clasificación 429 y ausencia de `credentialScoped` en Antigravity
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `antigravityInstantRetryThreshold=3s`, `antigravityShortQuotaCooldownThreshold=5min`; `statusErr` sin `credentialScoped=true`.

### S-010: Live Management API `/v0/management/auth-files` (cooldown vivo)
- Family: PRIMARY
- URL or locator: http://127.0.0.1:8317/v0/management/auth-files (Bearer mgmt key, en memoria)
- Date/version: observado 2026-10-04 (CLIProxyAPI v8.0.13)
- Access method: curl (solo lectura) + python json
- Used for: (b) prueba viva de cooldown `scope=model`, `reason=quota`, `remaining_seconds≈21071 (~5.85h)`, `http_status=429`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: la clave de management se usó solo en memoria; no se imprime en el informe. Campos expuestos: `cooldowns`, `unavailable`, `failed`, `success`, `quota.signals`, etc.

### S-011: Live `/v1/models` (IDs canónicos sin prefijo)
- Family: PRIMARY
- URL or locator: http://127.0.0.1:8317/v1/models
- Date/version: observado 2026-10-04
- Access method: curl + python
- Used for: (e) 218 modelos totales; IDs planos de Antigravity (`claude-sonnet-4-6`, `gemini-3.8-flash-high`, `claude-opus-4-6-thinking`, etc.)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: coexisten 212 clones con prefijo y los IDs base sin prefijo.

### S-012: Live Management API `/v0/management/config` (efectivo)
- Family: PRIMARY
- URL or locator: http://127.0.0.1:8317/v0/management/config
- Date/version: observado 2026-10-04
- Access method: curl + python
- Used for: (b)(d) `force-model-prefix=false`, `disable-cooling=false`, `save-cooldown-status=false`, `request-retry=0`, `max-retry-credentials=0`, `routing={}`, `quota-exceeded` todo en false
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: confirma cooldowns en memoria (Home off) y selector por defecto.

### S-013: Código local `internal/switcher/switcher.go`
- Family: IMPLEMENTATION
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/internal/switcher/switcher.go
- Date/version: estado del repo local (2026-10-04)
- Access method: read
- Used for: (d) actuador actual por prefijo, ParsePrefix por perfil/rol, rotación 2-pasos, umbrales
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: el grueso del cambio B2 vive aquí.

### S-014: Código local `internal/client/client.go`
- Family: IMPLEMENTATION
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/internal/client/client.go
- Date/version: estado del repo local
- Access method: read
- Used for: (d) `PatchAuthPrefix` (solo prefix+note) y `GetAuthFileDetails` (solo prefix+chatgpt id)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: requiere generalizar a PATCH de `priority`.

### S-015: Código local `internal/quota/quota.go`
- Family: IMPLEMENTATION
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/internal/quota/quota.go
- Date/version: estado del repo local
- Access method: read
- Used for: (d) clasificación 5h/semanal, `ShouldRotate`, `MinAvailableRemaining`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: casi sin cambios para B2.

### S-016: Código local `internal/config/config.go`
- Family: IMPLEMENTATION
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/internal/config/config.go
- Date/version: estado del repo local
- Access method: read
- Used for: (d) convenciones de prefijo/proveedor y umbrales por defecto
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: `DefaultFiveHourThreshold=90`, `DefaultWeeklyThreshold=95`, `DefaultCooldownMinutes=5`.

### S-017: Plugin `plugins/visual-profile/internal/plugin/plugin.go` (registro de capacidades)
- Family: IMPLEMENTATION
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/internal/plugin/plugin.go
- Date/version: v0.1.0 ("Auto switcher pro"), ABI 1
- Access method: read
- Used for: (c) solo `management_api: true`; rutas UI y `virtualize`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: no declara `scheduler` ni `auth_provider`.

### S-018: Plugin `plugins/visual-profile/internal/plugin/virtualize.go` (escritura de prefix+excluded_models)
- Family: IMPLEMENTATION
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/internal/plugin/virtualize.go
- Date/version: v0.1.0
- Access method: read
- Used for: (c)(d) qué escribe realmente el plugin y por qué no enruta
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `POST /v0/management/visual-profile/virtualize`; `metadata["prefix"]=prefix` y `excluded_models`.

### S-019: Informe previo `2026-10-04-0536-model-picker-auth-files-orchestration/report.md`
- Family: SECONDARY
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/investigaciones/2026-10-04-0536-model-picker-auth-files-orchestration/report.md
- Date/version: 2026-10-04
- Access method: read (contexto reutilizado)
- Used for: antecedente del modelo de prefijos y del problema de `/model` con la extensión de Pi
- Usefulness: CONTEXT
- Confidence impact: MEDIUM
- Notes: conclusión previa: el plumbing de enrutamiento se filtra a la UI `/model`.

### S-020: Informe previo `2026-10-04-0522-leader-indicator-model-picker/report.md`
- Family: SECONDARY
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/investigacion/2026-10-04-0522-leader-indicator-model-picker/report.md
- Date/version: 2026-10-04
- Access method: read (contexto reutilizado)
- Used for: alternativa de decoración client-side y descarte de inyección server-side
- Usefulness: CONTEXT
- Confidence impact: MEDIUM
- Notes: marcador de líder 👑/⭐ vía estructura del pool.

### S-021: Selectores y `routing.strategy` (`sdk/cliproxy/service_config.go`, `internal/config/config_types.go`)
- Family: PRIMARY
- URL or locator: /tmp/CLIProxyAPI/sdk/cliproxy/service_config.go (55-90), internal/config/config_types.go (353-355)
- Date/version: v8.0.13
- Access method: read/sed
- Used for: (a)(d) estrategias `round-robin` (default), `weighted-round-robin`, `fill-first`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `FillFirstSelector` es determinista ("quema" una cuenta antes de pasar a la siguiente).

### S-022: `sdk/cliproxy/auth/cooldown_view.go` (CooldownView por modelo)
- Family: IMPLEMENTATION
- URL or locator: /tmp/CLIProxyAPI/sdk/cliproxy/auth/cooldown_view.go
- Date/version: v8.0.13
- Access method: read/sed
- Used for: (b) formato `scope=model`/`model_key` observado en vivo y su origen en ModelStates
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: los cooldowns por modelo se derivan de `auth.ModelStates`.

### S-023: Capacidad `scheduler` de plugins (`sdk/pluginapi/types.go`, `examples/plugin/scheduler`, `internal/pluginhost/scheduler.go`, `rpc_schema.go`)
- Family: PRIMARY
- URL or locator: /tmp/CLIProxyAPI/sdk/pluginapi/types.go (486-543), internal/pluginhost/rpc_schema.go (27), examples/plugin/scheduler/go/main.go
- Date/version: v8.0.13
- Access method: read/grep
- Used for: Alternativas — enrutamiento/conmutación server-side vía plugin `scheduler` (`MethodSchedulerPick`)
- Usefulness: SUPPORTING
- Confidence impact: MEDIUM
- Notes: candidatos incluyen `Priority`, `Attributes`, `Metadata`; no se probó en vivo.

### S-024: Persistencia de cooldowns (`sdk/cliproxy/auth/cooldown_state.go`, `sdk/cliproxy/service_auth.go`, `config.go`)
- Family: IMPLEMENTATION
- URL or locator: /tmp/CLIProxyAPI/sdk/cliproxy/auth/cooldown_state.go (59-276), sdk/cliproxy/service_auth.go (549-567), internal/config/config.go (75-76)
- Date/version: v8.0.13
- Access method: read/grep
- Used for: (b)(d) existencia de `FileCooldownStateStore` y `save-cooldown-status`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `cfg.SaveCooldownStatus=false` ⇒ cooldowns no persistidos.

### S-025: Configuración local del servicio `/home/wilox/services/cliproxy/config.yaml` y `compose.yaml`
- Family: PRIMARY
- URL or locator: /home/wilox/services/cliproxy/config.yaml, /home/wilox/services/cliproxy/compose.yaml
- Date/version: 2026-10-04
- Access method: read (sed, con redacción de secretos)
- Used for: (d) `routing.cooldown.disable-cooling: false`, ausencia de `strategy`, plugin visual-profile habilitado, imagen/volúmenes
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: secretos redactados; no se exponen claves.
