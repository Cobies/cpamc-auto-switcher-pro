# Sources

## Source Index

### S-001: Pi Extension cliproxyapi-dynamic-provider.ts
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/extensions/cliproxyapi-dynamic-provider.ts`
- Date/version: 2026-10-03 / Live in agent-j0k3r
- Access method: read tool
- Used for: Key Findings (F1, F3, F5), Evidence Review (C1, C3), Diagnosis of `/model` listing and provider registration `[cpamc]`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Código fuente TypeScript responsable de registrar el proveedor `cpamc` en Pi, consultar `/v1/models` y `/v0/management/auth-files`, y filtrar prefijos descartando `_(\d+)$`. Es el causante directo de la exposición de `agy/`, `agy2/` y `agy_clau/` en `/model`.

### S-002: CLIProxyAPI Live Endpoint /v1/models
- Family: PRIMARY
- URL or locator: `http://127.0.0.1:8317/v1/models`
- Date/version: 2026-10-04T05:43Z / CLIProxyAPI v8.0.13 (commit d7914af)
- Access method: bash curl / python3 query con Authorization Bearer de `~/.cliproxy_management_key`
- Used for: Key Findings (F2, F4), Evidence Review (C2), Verificación exacta de modelos prefijados
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Consulta en vivo de solo lectura que confirmó 276 modelos en total, 242 con prefijo, y la presencia idéntica de `agy/claude-opus-5-5-high`, `agy2/claude-opus-5-5-high`, `agy_clau/claude-opus-5-5-high`, etc.

### S-003: CLIProxyAPI Live Endpoint /v0/management/auth-files
- Family: PRIMARY
- URL or locator: `http://127.0.0.1:8317/v0/management/auth-files` y subruta `/download`
- Date/version: 2026-10-04T05:41Z / CLIProxyAPI v8.0.13
- Access method: bash curl / python3 urllib con management key
- Used for: Key Findings (F2, F6), Evidence Review (C2, C4), Diagnosis de Auth Files Management y cuentas virtuales
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirmó los 10 archivos de credenciales activos (4 virtuales de Claude `agy_clau`, `agy_clau_1..3` con 218 exclusiones, y 4 físicos de Gemini con prefijos `agy`, `agy_1`, `agy2`, `agy2_1` con solo 12 exclusiones que omiten Claude).

### S-004: Pi Model Cache File cpamc-models-cache.json
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/cpamc-models-cache.json`
- Date/version: 2026-10-04
- Access method: read tool
- Used for: Key Findings (F1, F5), Diagnosis del selector `/model`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Archivo de persistencia de Pi que almacena el catálogo parseado por `cliproxyapi-dynamic-provider.ts`. Contiene textualmente la lista reportada por el usuario con el tag `[cpamc]`.

### S-005: Visual Profile C-ABI Plugin Source plugin.go
- Family: PRIMARY
- URL or locator: `plugins/visual-profile/internal/plugin/plugin.go`
- Date/version: 2026-10-04 / Commit 57b60f8 + Mechanism A
- Access method: read tool / mem:obs-1644
- Used for: Key Findings (F7), Status del plugin "Auto switcher pro 0.1.0 gonzalez962"
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Contiene los metadatos de registro del plugin `visual-profile-linux-amd64.so` (`Name: "Auto switcher pro"`, `Version: 0.1.0`, `Author: "gonzalez962"`), sus 5 submenús en CPAMC y la ruta POST `/v0/management/visual-profile/virtualize`.

### S-006: Pi Extension cpamc-auto-switcher index.ts & README.md
- Family: IMPLEMENTATION
- URL or locator: `pi extensions/cpamc-auto-switcher/index.ts` & `README.md`
- Date/version: 2026-09-28
- Access method: read tool
- Used for: Key Findings (F8), Orquestación de rotación de cuota y detección 429
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Extensión de Pi que detecta eventos 429 (`after_provider_response`, `message_end`, `turn_end`) y ejecuta `cpamc-auto-switcher --force` para rotar prefijos entre líder y reserva.

### S-007: Reporte Previo de Cuotas y Enrutamiento CLIProxyAPI
- Family: RESEARCH
- URL or locator: `investigaciones/2026-10-03-2351-quota-groups-routing/report.md`
- Date/version: 2026-10-03
- Access method: read tool
- Used for: Contexto de enrutamiento por prefijos `prefijo/modelo`, doble registro y grupos de cuota Antigravity
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Establece que CLIProxyAPI registra doble entrada (base y prefijo) y que Antigravity solo tiene 2 grupos de cuota ("Gemini Models" y "Claude and GPT models").

### S-008: Engram Memories #1642 y #1644 (Mecanismo A de Virtualización)
- Family: IMPLEMENTATION
- URL or locator: `mem:1642`, `mem:1644`
- Date/version: 2026-10-04
- Access method: mem_search / mem_get_observation
- Used for: Key Findings (F6), Explicación del origen de los archivos `agy_clau*`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Documenta la implementación del Mecanismo A donde una cuenta física se duplica server-side vía `host.auth.save` para crear una credencial virtual con prefijo `agy_clau` y `excluded_models` complementarias.

### S-009: Motor de Rotación switcher.go y quota.go
- Family: IMPLEMENTATION
- URL or locator: `internal/switcher/switcher.go`, `internal/quota/quota.go`
- Date/version: 2026-10-04
- Access method: read tool
- Used for: Key Findings (F8), Propuestas arquitectónicas de orquestación
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Define la convención de prefijos (`base` líder vs `base_N` reservas) y la rotación automática mediante parcheo de metadatos en CPAMC.
