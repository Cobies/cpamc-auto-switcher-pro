# Sources

## Source Index

### S-001: Gentle-Shell Extension Symlink and Entrypoint
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.gentle-shell/agent/extensions/cpamc-auto-switcher` -> `/home/wilox/projects/cpamc-auto-switcher/pi extensions/cpamc-auto-switcher/index.ts`
- Date/version: 2026-09-28 / v1.0.0
- Access method: `read`, `bash`
- Used for: Current Architecture & Capabilities, Reactive Failover Hook
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirmed symlink structure pointing to project root `pi extensions/cpamc-auto-switcher`. Discloses event listeners for `after_provider_response`, `message_end`, `turn_end`, `tool_result`, and `message_start`.

### S-002: CPAMC Runtime UI Extension Index and Polling Loop
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/extensions/cpamc-runtime-ui/index.ts`
- Date/version: 2026-10-04 / v1.0.0
- Access method: `read`
- Used for: Polling interval (25s), lifecycle teardown, TUI adapter wiring
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Manages 25-second periodic execution of `querySwitcherAccounts(true)`, session hook listeners, and safe context teardown.

### S-003: CPAMC Runtime UI Model Classification & Pool Store
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/extensions/cpamc-runtime-ui/src/store.ts`
- Date/version: 2026-10-04
- Access method: `read`
- Used for: Gap analysis, prefix cross-contamination, `agy_son`/`agy_opus` misclassification bug
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Proves `poolBase.startsWith("agy")` executes before Claude subtype checks, erroneously mislabeling `agy_son` and `agy_opus` as "Gemini Puro".

### S-004: CPAMC Runtime UI Polymorphic TUI Adapter
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/extensions/cpamc-runtime-ui/src/adapter.ts`
- Date/version: 2026-10-04
- Access method: `read`
- Used for: Gentle-shell sidebar quota card rendering, fullscreen detection
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Detects `Symbol.for("gentle-pi.experimental-sidebar.state")` and renders text-only ASCII quota box (`formatSidebarQuotaCardLines`), demonstrating total absence of visual 8-cell spectral gauges.

### S-005: Gentle-Shell Autonomous CPAMC Dynamic Provider
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.gentle-shell/agent/extensions/cpamc-dynamic-provider.ts`
- Date/version: 2026-10-05
- Access method: `read`
- Used for: Gentle-shell provider configuration, `isParent` active badges, fallback prefixes
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Discloses that `isParent` checks `agy_son` but omits `agy_opus`, missing the active star badge `⭐ [ACTIVA]` for Opus pools.

### S-006: Go CLI Configuration and Prefix Parser
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/internal/config/config.go`
- Date/version: 2026-09-28
- Access method: `read`
- Used for: `agy2` parsing gap, profile conventions
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirms `ParsePrefix` requires `baseActive + "_"` prefix, causing `agy2` (which lacks underscore after `agy`) to return `Matched: false`.

### S-007: Go CLI Quota Evaluation Engine
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/internal/quota/quota.go`
- Date/version: 2026-10-04
- Access method: `read`
- Used for: Quota family filtering, profile group isolation gap
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `ParseQuotaSummary` checks `prof` starting with `agy_clau`, `clau`, `son` for Claude/GPT, but misses `opus`, failing quota group isolation for `agy_opus`.

### S-008: Go CLI Switcher Core & Concurrency Engine
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/internal/switcher/switcher.go`
- Date/version: 2026-09-28
- Access method: `read`
- Used for: Automated rotation loop, profile discovery, skip of unparsed `agy2` accounts
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demonstrates that `RunProvider` filters by `parsed.Matched`, causing `agy2` accounts to be completely ignored during automated rotation evaluations.

### S-009: Auto Switcher Pro Option A Git Commit
- Family: IMPLEMENTATION
- URL or locator: Git commit `e782b3cc3713239e243f5832db8e4d6c599e8768` (`feat(visual-profile): specialize Claude pools into agy_son and agy_opus...`)
- Date/version: 2026-10-05 06:09:45 UTC
- Access method: `bash` (`git show --stat e782b3c`)
- Used for: Comparison baseline against latest Auto Switcher Pro features
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Details the full implementation of `agy_son`/`agy_opus`, 5.5 model exclusion policies, anti-contamination logic, and 275 passing tests.

### S-010: ControlSwitcher 8-Cell Compact Spectral Gauge Implementation
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/web/src/components/ControlSwitcher.jsx`
- Date/version: 2026-10-05
- Access method: `read`
- Used for: Spectral gauge color palette, glyph specification (`▰`/`▱`), threshold semantics
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Establishes the canonical 8-color TrueColor palette (`#4ADE80` -> `#DC2626`), empty carril color `rgb(70, 85, 100)`, label color `rgb(92, 184, 199)`, and dual 5h/Weekly gauge design.

### S-011: Engram Memory: Auto-Switcher Pool Redesign
- Family: IMPLEMENTATION
- URL or locator: mem:1641 (`Auto-switcher pool redesign: 4 families + min-2 accounts (deployed)`)
- Date/version: 2026-10-04 04:13:55
- Access method: `mem_get_observation` / `mem_search`
- Used for: Historical context on prefix ordering rules and quota group separation
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Records critical rule that quota prefix filtering must be longest-first (`agy_clau*` before `agy*`) and accounts must use numeric suffixes for reserves.

### S-012: Engram Memory: Antigravity Prefixes & Model Catalog in j0k3r-pi
- Family: IMPLEMENTATION
- URL or locator: mem:1663 (`Diagnostico: Prefijos Antigravity y visibilidad de modelos en j0k3r-pi`)
- Date/version: 2026-10-04 09:05:46
- Access method: `mem_get_observation` / `mem_search`
- Used for: Decoupling philosophy, active leader vs reserve filtering
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Explains intentional architectural separation between leader accounts (exposed to Pi picker) and reserve accounts (kept in background rotation).

### S-013: Engram Memory: Visual Profile Suite and Option A Consolidation
- Family: IMPLEMENTATION
- URL or locator: mem:1720 (`Local Git Commit for Option A and Visual Profile Suite`)
- Date/version: 2026-10-05 06:10:08
- Access method: `mem_get_observation` / `mem_search`
- Used for: Verification of local clean state and feature consolidation
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Records completion of Option A specialized pools, anti-clobbering, pagination, and convention validation.

### S-014: Gentle-Shell Agent Configuration & Isolation
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.gentle-shell/agent/settings.json`
- Date/version: 2026-10-05
- Access method: `read`
- Used for: Verification of active gentle-shell defaults (`defaultModel: cpamc/agy_son/claude-sonnet-4-6`, `fullscreen`)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirms gentle-shell natively consumes `agy_son/claude-sonnet-4-6` and operates in fullscreen TUI mode with Gentleman-Cute theme.

### S-015: Technical Audit: Model Routing Behavior & agy2 Defect
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/investigaciones/2026-10-05-0336-model-routing-behavior/report.md`
- Date/version: 2026-10-05 03:36:00
- Access method: `read`
- Used for: Diagnosis of `cpamc-auto-switcher -list` classifying `agy2` as `[OTHER]`
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Empirically verified via live command output that `cpamc-auto-switcher` treats `agy2` and `agy2_1` as unmanaged due to regex delimiter requirements.
