# Sources

## Source Index

### S-001: CPAMC Host Directory & Docker Auth Volume
- Family: PRIMARY
- URL or locator: `/var/lib/docker/volumes/cliproxy_auth/_data` -> `/root/.cli-proxy-api/*.json` inside `cli-proxy-api` Docker container
- Date/version: 2026-10-10
- Access method: `docker exec cli-proxy-api ls -la /root/.cli-proxy-api/`
- Used for: Documenting CPAMC native auth files storage location, OAuth master files (`antigravity-*.json`), and JSON file structure.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Stores native OAuth login credentials generated when accounts log in via CPAMC.

### S-002: CLIProxyAPI Host Configuration
- Family: PRIMARY
- URL or locator: `/home/wilox/services/cliproxy/config.yaml`
- Date/version: 2026-10-05 (config-version 8)
- Access method: `read`
- Used for: Verifying management key setting, server port (8317), OAuth auth-dir (`/root/.cli-proxy-api`), and plugin enablement (`auto-switcher-pro-linux-amd64`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Management secret key `$2a$10$...` and auth directory binding configuration.

### S-003: Auto Switcher Pro Virtualization Backend
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/internal/plugin/virtualize.go`
- Date/version: 2026-10-09
- Access method: `read`
- Used for: Documenting Go backend virtualization logic, hostcalls (`host.auth.list`, `host.auth.get`, `host.auth.save`, `host.auth.delete`), virtual file naming (`<base>.<prefix>.json`), and model exclusion calculation (`computeVirtualExclusions`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Exposes management route `/v0/management/auto-switcher-pro/virtualize` for non-destructive account virtualization.

### S-004: Visual Profile Management Client API
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/web/src/api/managementClient.js`
- Date/version: 2026-10-09
- Access method: `read`
- Used for: Documenting 2N managed card abstraction (`buildManagedPoolCards`), XOR deobfuscation (`enc::v1::`), classification (`classifyAuthAccount`), virtual origin extraction (`extractVirtualOrigin`), and Management API calls.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Implements fail-closed authentication and privacy-preserving identifier masking (VP-7 compliance).

### S-005: AutoAuthFiles Frontend Control View
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`
- Date/version: 2026-10-09
- Access method: `read`
- Used for: Documenting origin traceability, model exclusion badges, individual card dissolution, batch orphan purging, single-model specialist gear modal (⚙️), and account telemetry.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Separates physical master OAuth accounts from derived virtual pool cards in the visual UI.

### S-006: GroupManager Component & Pool Architecture
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/web/src/components/GroupManager.jsx`
- Date/version: 2026-10-09
- Access method: `read`
- Used for: Documenting pool creation, model family classification (`gemini`, `claude`, `codex`), Gemini subtypes (`pure`, `sonnet`, `opus`, `claude`), Leader vs Cascading Reserve prefix generation (`<base>` vs `<base>_N`), and pool dissolution.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Establishes naming conventions (`agy`, `agy2`, `agy_son`, `agy_opus`, `clau`, `codex`) and collision-free prefix generation.

### S-007: CPAMC Auto-Switcher Pi Extension Provider
- Family: IMPLEMENTATION
- URL or locator: `extensions/cpamc-auto-switcher/src/provider.ts`
- Date/version: 2026-10-09
- Access method: `read`
- Used for: Documenting Pi extension consumption of auto auth-files, reserve prefix suppression (`/_(\d+)$/`), pool label conjugation (`buildPoolLabelMap`), and multi-target cache saving (`resolveCacheTargets`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Homologated dynamic provider script for Pi coding agent and gentle-shell environments.

### S-008: Global Pi Dynamic Provider Extension
- Family: IMPLEMENTATION
- URL or locator: `~/.pi/agent-j0k3r/extensions/cliproxyapi-dynamic-provider.ts`
- Date/version: 2026-10-09
- Access method: `read`
- Used for: Verifying live dynamic provider script deployed in J0k3r Pi extensions directory.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Synchronized with `extensions/cpamc-auto-switcher/src/provider.ts`.

### S-009: CPAMC Models Cache File
- Family: IMPLEMENTATION
- URL or locator: `~/.pi/agent-j0k3r/cpamc-models-cache.json`
- Date/version: 2026-10-09
- Access method: `bash` (`cat` / `jq`)
- Used for: Inspecting cached model definitions, pool labels (`⭐ [ACTIVA]`), reasoning effort mapping, and context window limits.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Stores parsed models delivered to Pi UI pickers.

### S-010: Engram Observation #1900 - Virtual Account Architecture Isolation 2N Card Model
- Family: IMPLEMENTATION
- URL or locator: `mem:1900`
- Date/version: 2026-10-09
- Access method: `mem_search`
- Used for: Historical context on N -> 2N managed card abstraction and deterministic virtual naming (`<master>.<prefix>.json`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Context on preventing clone sprawl and duplicate candidate dropdowns in CPAMC.

### S-011: Engram Observation #1919 - Homologated cpamc-auto-switcher extension provider logic
- Family: IMPLEMENTATION
- URL or locator: `mem:1919`
- Date/version: 2026-10-09
- Access method: `mem_search`
- Used for: Context on fixing background cache overwrite bug by aligning dynamic provider pool conjugation and reserve prefix filtering.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Details 56 conjugated pool models and multi-target cache saving.

### S-012: Engram Observation #1682 - Dedicated agy_son and agy_opus pools support
- Family: IMPLEMENTATION
- URL or locator: `mem:1682`
- Date/version: 2026-10-04
- Access method: `mem_search`
- Used for: Context on extending Antigravity model families to support dedicated `agy_son` and `agy_opus` pools alongside `agy` and `agy_clau`.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Explains routing conventions `cpamc/agy_son/...` and `cpamc/agy_opus/...`.

### S-013: Engram Observation #1730 - Audit gentle-shell cpamc-auto-switcher architecture and gaps
- Family: IMPLEMENTATION
- URL or locator: `mem:1730`
- Date/version: 2026-10-05
- Access method: `mem_search`
- Used for: Context on past prefix-order bugs (`startsWith("agy")` greedy check) and model catalog unification.
- Usefulness: CONTEXT
- Confidence impact: MEDIUM
- Notes: Identified prefix classification gaps resolved in current release.

### S-014: CPAMC Management API HTTP Server
- Family: PRIMARY
- URL or locator: `http://192.168.10.150:8317`
- Date/version: 2026-10-10
- Access method: `bash` (`curl`)
- Used for: Verifying live Management API endpoint structure and fail-closed security response for unauthorized requests.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Host server running CLIProxyAPI with C-ABI plugin integration.
