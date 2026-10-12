## Workflow Status
- Status: READY
- Blockers: None

## Goal
Unify pool model governance and hide reserve account facades from the `/model` catalog across Auto Switcher Pro web components and Go plugin. Transition reserve accounts from disk prefix stamping (`base_1`, `base_2`) to pure pool registry derivation, eliminate per-card Tuerca ⚙️ overrides on pooled accounts in AutoAuthFiles, sanitize Google credential model exclusions by filtering foreign non-Antigravity models, and provide regression test suites in both Vitest and Go.

## Scope & Exclusions
- Scope: `plugins/auto-switcher-pro/**` (Web frontend React components and Go backend plugin).
- Exclusions: Host configs, compose files, root module `cmd/` and `internal/`, and Git configuration.

## Execution Scope
- Root: /home/wilox/projects/cpamc-auto-switcher
- Allowed Paths:
  - /home/wilox/projects/cpamc-auto-switcher/plugins/auto-switcher-pro/**
- Writable Paths:
  - /home/wilox/projects/cpamc-auto-switcher/plugins/auto-switcher-pro/**
- Allowed Bash:
  - npm --prefix plugins/auto-switcher-pro/web test
  - go test -v ./internal/plugin/...
- Notes: Scope strictly restricted to plugins/auto-switcher-pro/**. No edits permitted outside this boundary. In-source CGO compilation without bin/ redirection is prohibited per project sanitation policy.

## Planned Workflow Items

### MINI-001: Stop Reserve Prefix Stamping & Derive Pool Roles from Pool Registry
- Contract:
  - In `plugins/auto-switcher-pro/web/src/components/GroupManager.jsx`, modify `handleCreateGroup` to stop stamping prefixes (e.g. `base_1`, `base_2`) on reserve accounts. Only the leader account receives `groupBasePrefix` via `saveAuthFilePrefixes`. Reserve accounts retain their empty or unlinked disk prefix and are recorded exclusively in `poolPayload.reserves` sent to `savePool`.
  - In `plugins/auto-switcher-pro/web/src/api/managementClient.js`, update `buildManagedPoolCards` so that when `registeredPools` is provided, accounts listed in `pool.reserves` receive `poolRole: 'reserve'` and `activePoolBase: basePrefix` with an empty `assignedPrefix` (rather than a synthesized `basePrefix_1`). In fallback / prefix-based detection, do not treat accounts as pool reserves purely from disk prefix regex without pool registry membership.
  - In `plugins/auto-switcher-pro/web/src/components/GroupManager.jsx`, ensure that reserve files are still included in `assignedFiles` passed to `computeUnionExclusions` and `patchAuthFileExclusions` so their model exclusions match pool isolation rules.
- Acceptance:
  - Creating a pool with 1 leader and N reserves stamps `prefix: base` only on the leader file; reserve accounts are not included in `saveAuthFilePrefixes` updates.
  - `savePool` receives `poolPayload.reserves` containing the exact file names of all selected reserve accounts.
  - `buildManagedPoolCards` with `registeredPools` creates reserve cards with `poolRole: 'reserve'`, `activePoolBase: pool.base_prefix`, and no stamped reserve prefix.
  - Reserve accounts are strictly invisible to disk-prefix route scrapers in CLIProxyAPI, upholding Invariant #5.
  - Existing tests in `GroupManager.test.jsx` and `managementClient.test.js` updated to reflect prefix-free reserves, and all pass.
- Canonical sources:
  - `plugins/auto-switcher-pro/web/src/components/GroupManager.jsx`
  - `plugins/auto-switcher-pro/web/src/api/managementClient.js`
  - `plugins/auto-switcher-pro/web/src/components/GroupManager.test.jsx`
  - `plugins/auto-switcher-pro/web/src/api/managementClient.test.js`
- Validation:
  - `npm --prefix plugins/auto-switcher-pro/web test src/components/GroupManager.test.jsx`
  - `npm --prefix plugins/auto-switcher-pro/web test src/api/managementClient.test.js`
- Depends on: None

### MINI-002: Filter Foreign Non-Antigravity Models in GroupManager computeUnionExclusions
- Contract:
  - In `plugins/auto-switcher-pro/web/src/components/GroupManager.jsx` inside `handleCreateGroup`, update `allBaseModels` computation to filter models using `isAntigravityModel`.
  - Ensure foreign models from multi-provider catalogs (e.g. NVIDIA, OpenCode, GLM, Grok) are never passed into `computeUnionExclusions` or patched into Google Antigravity credential `excluded_models`.
- Acceptance:
  - `allBaseModels` is filtered with `isAntigravityModel` before computing union differences.
  - When `listModels()` returns non-Antigravity models (e.g. `nvidia/llama-3.1-405b`, `glm-4`), `computeUnionExclusions` yields exclusions consisting strictly of Antigravity models (`gemini`, `claude`, `sonnet`, `opus`, `haiku`).
  - Google credential files never have foreign model IDs injected into their `excluded_models` array.
  - Unit test in `GroupManager.test.jsx` validates foreign model isolation during pool creation.
- Canonical sources:
  - `plugins/auto-switcher-pro/web/src/components/GroupManager.jsx`
  - `plugins/auto-switcher-pro/web/src/components/GroupManager.test.jsx`
- Validation:
  - `npm --prefix plugins/auto-switcher-pro/web test src/components/GroupManager.test.jsx`
- Depends on: None

### MINI-003: Unify AutoAuthFiles Governance for Pooled Cards (Read-Only Pool Targets)
- Contract:
  - In `plugins/auto-switcher-pro/web/src/components/AutoAuthFiles.jsx`, unify governance between pools and card views:
    - For pooled accounts (`card.poolRole === 'leader' || card.poolRole === 'reserve'` or card having an active pool membership), remove the Tuerca ⚙️ gear button / disable per-card specialist override, displaying pool targets and role as read-only governed by the pool policy.
    - For unassigned accounts (`card.poolRole === 'unassigned'` and no active pool), retain the native Tuerca ⚙️ button and modal controls.
    - Update card badges to clearly indicate pool governance (e.g., `[agy] LÍDER` or `[agy] RESERVA`) without rendering confusing disk prefixes or allowing independent model overrides that conflict with pool rotation.
- Acceptance:
  - Cards assigned to a pool (leader or reserve) do not render an active Tuerca ⚙️ override button (`btn-card-gear`), preventing per-card specialist mutation that diverges from pool policy.
  - Unassigned cards continue to render the Tuerca ⚙️ button and allow opening `SpecialistModal`.
  - Pooled cards display their pool role and active pool base cleanly.
  - Existing tests in `AutoAuthFiles.test.jsx` updated and new unit tests assert read-only governance on pooled cards.
- Canonical sources:
  - `plugins/auto-switcher-pro/web/src/components/AutoAuthFiles.jsx`
  - `plugins/auto-switcher-pro/web/src/components/AutoAuthFiles.test.jsx`
- Validation:
  - `npm --prefix plugins/auto-switcher-pro/web test src/components/AutoAuthFiles.test.jsx`
- Depends on: MINI-001

### MINI-004: Go Backend Model Provider & Scheduler Regression Coverage for Prefix-Free Reserves
- Contract:
  - In `plugins/auto-switcher-pro/internal/plugin/modelprovider.go` and `modelprovider_test.go`, confirm and add explicit test coverage ensuring:
    - `modelCatalogForAuth` for accounts with empty disk prefix (`diskPrefix == ""`) belonging to a pool's `Reserves` correctly registers the pool's target models and virtual routes (`pool.BasePrefix + "/" + target`).
    - `poolPrefixedCatalog` publishes strictly `pool.BasePrefix + "/" + target` virtual routes and never exposes reserve suffixes (`_1`, `_2`), upholding Invariant #5.
    - `schedulerPickCascade` successfully cascades from leader to prefix-free reserve accounts when the leader is exhausted or on cooldown.
- Acceptance:
  - `go test -v ./internal/plugin/...` passes with dedicated test cases covering prefix-free reserve accounts in `model.for_auth` and `scheduler.pick`.
  - Zero reserve accounts (`_1`, `_2`) appear in `handleModelStatic` or static virtual routes catalog.
  - Rotation to reserves operates with zero downtime.
- Canonical sources:
  - `plugins/auto-switcher-pro/internal/plugin/modelprovider.go`
  - `plugins/auto-switcher-pro/internal/plugin/modelprovider_test.go`
- Validation:
  - `go test -v ./internal/plugin/...`
- Depends on: MINI-001

## Risks & Constraints
- **Invariant #1 (Virtual Facade Concept)**: Pi `/model` selector must see only the active pool facade (`cpamc/<base>/<model>`), never physical reserve accounts.
- **Invariant #2 (Rule of 1 Entry per Active Pool $N \to \infty$)**: Every registered pool base must be published independently. Sibling pools (e.g. `agy`, `agy2`, `agy3`) must never be collapsed.
- **Invariant #3 (Independent Model Governance)**: Pool policy determines model availability for all member accounts; unassigned accounts retain standalone Tuerca ⚙️ configuration.
- **Invariant #5 (Strict Invisibility of Reserve Accounts)**: Reserve accounts (`_1`, `_2`...) are bench rotation infrastructure and must NEVER be exposed in `/model`. Ceasing disk prefix stamping permanently guarantees this.
- **Build Cleanliness**: No direct `go build -buildmode=c-shared` inside source tree without output redirection.

## Open Decisions
- None. User explicitly approved the bimodal architecture, pool-derived roles, and removal of per-card Tuerca overrides for pooled accounts.

## Next Permitted Action
User approval gate for openspec/changes/unify-pool-governance-and-hide-reserves/plan.md before 02-apply execution.
