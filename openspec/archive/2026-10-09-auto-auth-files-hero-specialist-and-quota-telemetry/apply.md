## Workflow Status
- Status: READY
- Blockers: None

## Workflow & Contracts
- **Change Slug**: `auto-auth-files-hero-specialist-and-quota-telemetry`
- **Plan Artifact**: `openspec/changes/auto-auth-files-hero-specialist-and-quota-telemetry/plan.md`
- **Governing Skills**:
  - `skills/subagent-artifact-contracts/SKILL.md`
  - `skills/anti-overengineering/SKILL.md`
  - `skills/tdd/SKILL.md`

## Authorization Record
- **Author**: Orchestrator / User
- **Reference**: Delegation prompt
- **Action**: Apply implementation of MINI-001 through MINI-004
- **Scope**: `plugins/visual-profile/**`
- **Authority Artifact**: `openspec/changes/auto-auth-files-hero-specialist-and-quota-telemetry/plan.md`
- **Change Slug**: `auto-auth-files-hero-specialist-and-quota-telemetry`

## Planned Workflow Items

### MINI-001: Retain Excluded Models across Auth-Files Download & Graph Pipeline
- **Implementation Evidence**:
  - `plugins/visual-profile/web/src/api/managementClient.js`:
    - Updated `downloadAuthFilePrefix`: extracts `excluded_models` and `excludedModels` from downloaded credential JSON payload and returns `{ name, prefix, excluded_models: string[] }`.
    - Updated `loadAuthFilesWithPrefixes`: propagates `excluded_models` into each loaded descriptor record, preserving `auth_index` and `project_id`.
    - Updated `buildGraphFromAuthFiles`: forwards `excluded_models` and `excludedModels` to root node and `node.data`, preserving metadata across graph rebuilds.
    - Updated `buildManagedPoolCards`: passes exclusion metadata and `excluded_models` arrays so `detectSpecialistState` accurately detects single-model specialist state across refreshes.
  - Tests added to `plugins/visual-profile/web/src/api/managementClient.test.js`:
    - `downloadAuthFilePrefix extracts excluded_models array from payload and returns clean list`
    - `loadAuthFilesWithPrefixes propagates excluded_models into each auth file descriptor record`
    - `buildGraphFromAuthFiles forwards excluded_models and excludedModels to node.data and root node properties`
    - `buildManagedPoolCards retains exclusion metadata so detectSpecialistState recognizes single-model specialist status`
  - Integration test added to `plugins/visual-profile/web/src/components/AutoAuthFiles.test.jsx`:
    - `preserves specialist active state when auth files with excluded_models are reloaded`
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web -- src/api/managementClient.test.js`
  - Result: PASS (80 tests passed)
  - Command: `npm test --prefix plugins/visual-profile/web -- src/components/AutoAuthFiles.test.jsx`
  - Result: PASS (13 tests passed)
- **Acceptance Coverage**:
  - `downloadAuthFilePrefix` extracts `excluded_models`: Verified.
  - `loadAuthFilesWithPrefixes` propagates `excluded_models`: Verified.
  - `buildGraphFromAuthFiles` forwards metadata to nodes: Verified.
  - `buildManagedPoolCards` retains specialist recognition: Verified.

---

### MINI-002: Prominent Hero Model Banner for Auto Auth Files Cards
- **Implementation Evidence**:
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`:
    - Introduced prominent Hero Active Model Banner positioned at the top of the card body on both Master Cards and 2N Managed Cards.
    - Specialist Mode: renders container with class `hero-model-banner specialist`, badge `🎯 MODELO ESPECIALISTA ACTIVO` (`badge-specialist-active`), prominent model name typography (`hero-model-name`, >= 18px bold highlighted `#fbbf24`), and helper text indicating single-model exclusive traffic and number of excluded models.
    - Multipurpose Mode: renders container with class `hero-model-banner multipurpose`, badge `✨ MODELO PREDETERMINADO (MULTIPROPÓSITO)` (`badge-multipurpose-default`), default active model for the family (`gemini-2.5-pro` for Gemini, `claude-3-7-sonnet` for Claude), and helper text indicating balanced traffic distribution.
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.css`:
    - Added styles for `.hero-model-banner`, `.hero-model-banner.specialist`, `.hero-model-banner.multipurpose`, `.hero-model-badge-row`, `.badge-multipurpose-default`, `.hero-model-name`, and `.hero-model-helper`.
  - Tests added to `plugins/visual-profile/web/src/components/AutoAuthFiles.test.jsx`:
    - `renders prominent hero active model banner with badge-specialist-active in specialist mode`
    - `renders distinct hero container with badge-multipurpose-default in multipurpose mode`
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web -- src/components/AutoAuthFiles.test.jsx`
  - Result: PASS (13 tests passed)
- **Acceptance Coverage**:
  - Hero banner container present on all cards: Verified.
  - Specialist mode active banner with badge and large typography: Verified.
  - Multipurpose mode default model banner with badge and helper text: Verified.

---

### MINI-003: Quota Telemetry Homologation & On-Demand Card Refresh
- **Implementation Evidence**:
  - `plugins/visual-profile/web/src/api/managementClient.js`:
    - Implemented `parseAntigravityTierSummary(payload)`: parses `loadCodeAssist` response mapping tier IDs to `Plan Pro`, `Plan Free`, `Plan Ultra`.
    - Implemented `formatQuotaDuration(dateStr, offset)`: formats delta time into readable `Xh Ym` / `Xd Xh`.
    - Implemented `parseAntigravityQuotaPayload(payload, offset)`: extracts groups for `GEMINI MODELS` and `CLAUDE AND GPT MODELS`, computing 5-Hour Limit and Weekly Limit remaining percentages, reset durations, and health status.
    - Implemented `fetchCardQuota(cardOrNode, options)`: dispatches requests to `/v0/management/api-call` querying Antigravity subscription and quota summary endpoints.
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`:
    - Homologated UI matching installed `control-account` plugin:
      - `Plan Pro` badge rendered prominently (`.plan-row`, `.plan-badge`).
      - Dual telemetry limit blocks: `GEMINI MODELS` and `CLAUDE AND GPT MODELS`.
      - Five Hour Limit & Weekly Limit meters with remaining percentages, reset text (`Refreshes in Xh Ym`), and health-colored progress tracks (`.track`, `.fill`, `.fill.warning`, `.fill.critical`).
      - Mini activity indicator: `0 reqs · 100% ok`.
      - On-demand refresh button per card (`🔄 Actualizar Cuota` / `.btn-card-refresh`) with loading spinner state (`.spinning`) and error handling.
      - Graceful fallback for uninitialized or loading quota states.
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.css`:
    - Added styles for `.card-quota-telemetry`, `.plan-row`, `.plan-badges`, `.plan-badge`, `.quota-group`, `.group-title`, `.meter-row`, `.meter-header`, `.meter-label`, `.meter-meta`, `.meta-percent`, `.meta-reset`, `.meta-reset-soon`, `.track`, `.fill`, `.card-activity-wrap`, `.activity-header`, `.activity-title`, `.activity-meta`, `.card-quota-footer`, `.btn-card-refresh`, `.spinning`.
  - Tests added:
    - Unit tests in `managementClient.test.js` verifying tier parsing, duration formatting, quota payload parsing, and api-call proxy dispatch.
    - Component tests in `AutoAuthFiles.test.jsx` verifying `Plan Pro` badge, both quota limit groups, and clicking per-card refresh triggers telemetry reload with spinner.
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web -- src/api/managementClient.test.js`
  - Result: PASS (80 tests passed)
  - Command: `npm test --prefix plugins/visual-profile/web -- src/components/AutoAuthFiles.test.jsx`
  - Result: PASS (13 tests passed)
- **Acceptance Coverage**:
  - Quota retrieval and parser helper in managementClient: Verified.
  - Plan Pro badge: Verified.
  - GEMINI MODELS telemetry block: Verified.
  - CLAUDE AND GPT MODELS telemetry block: Verified.
  - Per-card refresh button with spinner: Verified.
  - Homologation to control-account specification: Verified.

---

### MINI-004: Regression Suite Verification & Build Validation
- **Implementation Evidence**:
  - Full Vitest suite executed across all 16 test files.
  - Vite production single-file bundle build executed successfully.
  - Go test suite across `plugins/visual-profile` executed successfully.
- **Validation Evidence**:
  - Command: `npm --prefix plugins/visual-profile/web run test`
  - Result: PASS (16 test files, 331 tests passed, 0 failures)
  - Command: `npm --prefix plugins/visual-profile/web run build`
  - Result: PASS (`plugins/visual-profile/internal/web/assets/index.html` 622.26 kB built in 4.88s)
  - Command: `go -C plugins/visual-profile test ./...`
  - Result: PASS (all tests passed)
- **Acceptance Coverage**:
  - 100% tests passing without regressions: Verified.
  - Clean production build: Verified.

## Approved Deviations
- None. Implementation strictly adheres to planned contracts, user guidance, and execution boundaries.

## Attempt Record
- **Attempt 1**:
  - Executed baseline tests (318 passed).
  - TDD RED -> GREEN cycle for MINI-001: extended `downloadAuthFilePrefix`, `loadAuthFilesWithPrefixes`, and `buildGraphFromAuthFiles` to preserve `excluded_models`. (PASS)
  - TDD RED -> GREEN cycle for MINI-002: implemented Hero Active Model Banner for specialist and multipurpose modes with dedicated CSS styling. (PASS)
  - TDD RED -> GREEN cycle for MINI-003: implemented quota parsing, subscription tier parsing, and control-account homologated UI with Plan Pro badge, dual limit blocks, and per-card refresh. (PASS)
  - MINI-004: full regression test suite (331 tests passed) and production single-file Vite build. (PASS)

## Candidate Identity
- Modified files:
  - `plugins/visual-profile/web/src/api/managementClient.js`
  - `plugins/visual-profile/web/src/api/managementClient.test.js`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.css`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.test.jsx`
  - `plugins/visual-profile/internal/web/assets/index.html`

## Residual Risks
- None. Privacy invariant VP-7 is strictly upheld: tokens, secrets, and raw credentials are never stored, logged, or exposed in UI state. Quota requests proxy safely through `/v0/management/api-call`.

## Verification Inputs
- `npm --prefix plugins/visual-profile/web run test`
- `npm --prefix plugins/visual-profile/web run build`
- `go -C plugins/visual-profile test ./...`

## Next Permitted Action
- Proceed to independent verification in `03-verify`.
