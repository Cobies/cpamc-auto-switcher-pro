# Sources

## Source Index

### S-001: Pi CLIProxyAPI Dynamic Provider Extension
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/extensions/cliproxyapi-dynamic-provider.ts`
- Date/version: 2026-10-04 / Current extension codebase
- Access method: `read` tool
- Used for: Model ingestion, reserve regex filtering (`/_(\d+)$/`), `isParent` active indicator logic, fallback prefixes (`KNOWN_ACCOUNT_PREFIXES`), and CPAMC management API client
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirms that `isParent` still hardcodes legacy prefixes `agy_g1` and `agy_g2`, and that fallback prefixes lack `agy_opus`.

### S-002: j0k3r Model Picker Core Implementation
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/extensions/j0k3r-model-picker/src/api.ts` & `src/modal.ts`
- Date/version: 2026-10-04 / Current extension codebase
- Access method: `read` tool
- Used for: Catalog organization (Provider -> Canonical Model -> Accounts), provider allowlist (`cpamc`), badges ("👑 LÍDER"), icon heuristic, and keyboard/mouse interaction handling
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Verifies that CPAMC models are grouped by the portion after the slash (canonical model slug) and that only models from provider `cpamc` are rendered.

### S-003: j0k3r Model Picker Documentation and Command Registration
- Family: PRIMARY
- URL or locator: `/home/wilox/.pi/agent-j0k3r/extensions/j0k3r-model-picker/README.md` & `index.ts`
- Date/version: 2026-10-04 / Current extension codebase
- Access method: `read` tool
- Used for: Analysis of command aliases (`/model-select`, `/ms`) and explanation of why Pi Core reserves `/model` before extensions run
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Explicitly documents that Pi core reserves `/model` in its editor handler, necessitating `/model-select` / `/ms` and custom editor wrapping.

### S-004: CPAMC Models Cache File
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/cpamc-models-cache.json`
- Date/version: 2026-10-04 / Current active cache
- Access method: `read` tool and python JSON parse
- Used for: Verification of the 10 models actively loaded into Pi memory, showing exactly which receive `⭐ [ACTIVA]` and verifying prefix distribution
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: 10 models total: 2 in `agy`, 2 in `agy2`, 3 in `agy_son`, 3 in `agy_opus`. Only `agy_son` entries have the active star tag.

### S-005: CPAMC Management API Auth Files Endpoint
- Family: PRIMARY
- URL or locator: `http://192.168.10.150:8317/v0/management/auth-files` and `/v0/management/auth-files/download`
- Date/version: 2026-10-05 / Live CPAMC service
- Access method: `bash` tool (python urllib query with management key)
- Used for: Real-time verification of the 8 auth files under Option A, their prefixes (`agy`, `agy_1`, `agy2`, `agy2_1`, `agy_son`, `agy_son_1`, `agy_opus`, `agy_opus_1`), and their excluded models
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Proves that `agy` and `agy2` creds exclude only 12 models and omit `claude-opus-5-5-high`, while `agy_son` and `agy_opus` have comprehensive exclusions.

### S-006: cpamc-auto-switcher Configuration and Prefix Parser
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/internal/config/config.go`
- Date/version: 2026-10-04 / Commit b26f38a
- Access method: `read` tool
- Used for: Verification of prefix parsing rules in `ParsePrefix`, default provider prefixes, and profile decomposition logic
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demonstrates that `ParsePrefix` checks for `baseActive + "_"` for sub-profiles, causing `agy2` to fail match against base `agy`.

### S-007: cpamc-auto-switcher CLI Status & List Evaluation
- Family: IMPLEMENTATION
- URL or locator: `cmd/cpamc-auto-switcher/main.go` execution output against port 8317
- Date/version: 2026-10-05 / Live Go CLI execution
- Access method: `bash` tool (`go run cmd/cpamc-auto-switcher/main.go -list ...`)
- Used for: Confirming account classification: `agy` [ACTIVE], `agy_1` [RESERVE], `agy_son` [ACTIVE], `agy_son_1` [RESERVE], `agy_opus` [ACTIVE], `agy_opus_1` [RESERVE], and `agy2`/`agy2_1` [OTHER]
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Conclusively proves that `cpamc-auto-switcher` operates seamlessly on `agy`, `agy_son`, and `agy_opus`, but treats `agy2` as unmanaged `[OTHER]`.
