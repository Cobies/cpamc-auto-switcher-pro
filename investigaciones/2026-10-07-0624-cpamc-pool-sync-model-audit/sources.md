# Sources

## Source Index

### S-001: Go Core Configuration and Prefix Parsing
- Family: PRIMARY
- URL or locator: `internal/config/config.go` and `internal/config/config_test.go`
- Date/version: 2026-10-05, commit e782b3c
- Access method: read, bash
- Used for: ParsePrefix logic, baseActive rules, profile extraction, and [OTHER] unmanaged fallback
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Implements decomposition of numbered base prefixes (`agy2`, `agy2_1`) and profile matching. Unmatched prefixes return `Matched: false`.

### S-002: Go Quota Group Parsing and Family Isolation
- Family: PRIMARY
- URL or locator: `internal/quota/quota.go` and `internal/quota/quota_test.go`
- Date/version: 2026-10-05, commit e782b3c
- Access method: read, bash
- Used for: ParseQuotaSummary, model-family filtering per profile, and bucket window evaluations
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Isolates Gemini Models vs Claude/GPT models buckets. Only handles explicit prefixes (`agy_opus`, `opus`, `son`, `agy_son`, `clau`, `agy_clau`, `agy`, `g`, numeric). Unknown prefixes fall back to worst-case across all groups.

### S-003: Visual Profile Pool and Group Manager
- Family: PRIMARY
- URL or locator: `plugins/visual-profile/web/src/components/GroupManager.jsx`
- Date/version: 2026-10-05, Auto Switcher Pro v0.1.0
- Access method: read, bash
- Used for: Pool creation lifecycle, base prefix validation, family model matching (`matchesFamilyModel`), and candidate queueing
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Generates target models and opposite models during virtualization. Enforces minimum 2 accounts per group.

### S-004: Management API Client for Visual Profile
- Family: PRIMARY
- URL or locator: `plugins/visual-profile/web/src/api/managementClient.js`
- Date/version: 2026-10-05
- Access method: read, bash
- Used for: `patchAuthFilePrefix`, `virtualizeAccount`, `saveAuthFilePrefixes`, and `listAuthFiles`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Communicates with CLIProxyAPI management endpoints `/v0/management/auth-files/fields` and `/v0/management/auto-switcher-pro/virtualize`. Discards credentials from memory.

### S-005: Host Plugin Virtualization Bridge
- Family: PRIMARY
- URL or locator: `plugins/visual-profile/internal/plugin/virtualize.go`
- Date/version: 2026-10-05
- Access method: read, bash
- Used for: `Virtualize`, `computeVirtualExclusions`, and host callback communication (`host.auth.get`, `host.auth.save`)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Creates virtual cloned JSON credentials with target routing prefix and exclusion lists in CLIProxyAPI storage.

### S-006: Dynamic Provider and CLIProxyAPI Consumer
- Family: PRIMARY
- URL or locator: `extensions/cpamc-auto-switcher/src/provider.ts`
- Date/version: 2026-10-05
- Access method: read, bash
- Used for: `fetchCLIProxyModels`, `fetchAccountPrefixesAndExclusions`, `isCleanIncludedModel`, and `KNOWN_ACCOUNT_PREFIXES` fallback
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Filter logic discards reserve accounts (`/_(\d+)$/`). Hardcoded fallback `KNOWN_ACCOUNT_PREFIXES` omits `agy_opus` and custom pools. Fan-out download has a 5000ms timeout.

### S-007: Extension State and Account Classification Store
- Family: PRIMARY
- URL or locator: `extensions/cpamc-auto-switcher/src/store.ts`
- Date/version: 2026-10-05
- Access method: read, bash
- Used for: `querySwitcherAccounts`, `classifyModel`, and `getRotationPairForModel`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Executes `cpamc-auto-switcher -list` with 25s memory cache. Classifies models into leader (👑), reserve (🔄), or direct (⚡).

### S-008: Extension Model Picker Handler
- Family: PRIMARY
- URL or locator: `extensions/cpamc-auto-switcher/src/picker.ts`
- Date/version: 2026-10-05
- Access method: read, bash
- Used for: `registerModelPicker` (`/cpamc-model`) and `showInteractivePicker`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Reads `context.modelRegistry.getAvailable()` directly without invoking `refresh()`, causing stale pool presentation when new pools are created.

### S-009: Unified Extension Orchestrator Entry Point
- Family: PRIMARY
- URL or locator: `extensions/cpamc-auto-switcher/index.ts`
- Date/version: 2026-10-05
- Access method: read, bash
- Used for: Extension initialization, failover hook setup, background timer, and session transition cleanups
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Registers 25s polling interval for `querySwitcherAccounts`, but does not poll or refresh the model registry.

### S-010: Pi Native Model Selector Component
- Family: PRIMARY
- URL or locator: `@earendil-works/pi-coding-agent/dist/modes/interactive/components/model-selector.js`
- Date/version: 2026-10, pi-coding-agent v0.124.0 / gentle-pi v4.0.0
- Access method: read, bash
- Used for: `ModelSelectorComponent`, snapshot loading, and background `refreshModels()` lifecycle
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Displays `modelRuntime.getAvailableSnapshot()`. Initiates background refresh with 15s timeout on open.

### S-011: Pi Model Runtime Architecture
- Family: PRIMARY
- URL or locator: `@earendil-works/pi-coding-agent/dist/core/model-runtime.js`
- Date/version: 2026-10, pi-coding-agent v0.124.0
- Access method: read, bash
- Used for: `ModelRuntime`, `registerProvider`, `getAvailableSnapshot`, and provider refresh management
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: At startup Pi executes `modelRuntime.refresh({ allowNetwork: false })`, seeding exclusively from the local disk cache.

### S-012: CLIProxyAPI Live Service Endpoints
- Family: IMPLEMENTATION
- URL or locator: `http://192.168.10.150:8317` (`/v1/models`, `/v1/models?client_version=1`, `/v0/management/auth-files`)
- Date/version: 2026-10-07 14:00 - 14:40 UTC+8 live probe
- Access method: bash (curl, jq, node)
- Used for: Real-time verification of model slugs, account statuses, failed counts, and cooldowns
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Probed live. Proved that `agy2/gemini-3.8-flash-high` was omitted while `failed === 3` on the active account, and appeared immediately after token refresh.

### S-013: Model Catalog Cache Files
- Family: IMPLEMENTATION
- URL or locator: `~/.gentle-shell/agent/cpamc-models-cache.json` and `~/.pi/agent-j0k3r/cpamc-models-cache.json`
- Date/version: 2026-10-05 / 2026-10-07 inspection
- Access method: read, bash
- Used for: Verifying stale cache contents (exactly 7 models, missing `agy2`)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Proved that disk cache remained frozen with old models, causing Pi to start up without knowledge of newly created or refreshed pools.

### S-014: Prior Investigation on Pi /model Composition
- Family: IMPLEMENTATION
- URL or locator: `investigaciones/2026-10-04-0809-model-catalog-conexion-extensiones/report.md`
- Date/version: 2026-10-04
- Access method: read
- Used for: Context on how `/model` aggregates configured providers and why native `/model` is not an exclusive CPAMC view
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Detailed analysis of `pi-ai` static catalog, pi.dev overlay, and dynamic provider replacement.

### S-015: Prior Investigation on Option A Model Routing
- Family: IMPLEMENTATION
- URL or locator: `investigaciones/2026-10-05-0336-model-routing-behavior/report.md`
- Date/version: 2026-10-05
- Access method: read
- Used for: Option A 4-profile routing topology (`agy`, `agy2`, `agy_son`, `agy_opus`) and model leaks
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Documented `KNOWN_ACCOUNT_PREFIXES` gaps and `isParent` active badge anomalies.

### S-016: Prior Technical Audit on Gentle-Shell Auto Switcher
- Family: IMPLEMENTATION
- URL or locator: `investigaciones/2026-10-05-0624-gentle-shell-auto-switcher-audit/report.md`
- Date/version: 2026-10-05
- Access method: read
- Used for: Architecture of gentle-shell standalone extension suite and isolation requirements
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Confirmed that gentle-shell runs isolated from jok3r-pi and traced earlier `store.ts` classification defects.

### S-017: Engram Recorded Discoveries and Bug Fixes
- Family: IMPLEMENTATION
- URL or locator: `mem:1651`, `mem:1689`, `mem:1756`
- Date/version: 2026-10-04 - 2026-10-05
- Access method: mem_search, mem_get_observation
- Used for: Historical context on `pi.registerCommand("model")` vs `pi.on("input")` override limitations, Option A routing behavior, and numbered prefix contingency
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Confirmed that native `/model` cannot be overridden merely by registering a command named "model"; raw input event handling is required.
