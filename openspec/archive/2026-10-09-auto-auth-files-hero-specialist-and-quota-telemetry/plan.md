## Workflow Status
- Status: READY
- Blockers: None

## Goal
Implement the hero active model banner, fix the specialist model retention bug across auth file reloads, and homologate quota telemetry (Plan Pro badge, Gemini 5h/weekly limits, Claude & GPT 5h/weekly limits, and per-card refresh) on Auto Auth Files cards.

## Scope & Exclusions
- Scope: `plugins/visual-profile/web/src/` (management client, AutoAuthFiles component, CSS stylesheets, test suites).
- Exclusions: Out-of-scope backend core alterations, routing daemon modifications, or changes outside `plugins/visual-profile/**`.

## Execution Scope
- Root: /home/wilox/projects/cpamc-auto-switcher
- Allowed Paths:
  - /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/**
- Writable Paths:
  - /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/**
- Allowed Bash:
  - npm --prefix plugins/visual-profile/web run test
  - npm --prefix plugins/visual-profile/web run build
- Notes: Restrict changes strictly to visual-profile web application and its test suite. Follow TDD and anti-overengineering principles.

## MINI Items

### MINI-001: Retain Excluded Models across Auth-Files Download & Graph Pipeline
- Contract: Extend `downloadAuthFilePrefix`, `loadAuthFilesWithPrefixes`, and `buildGraphFromAuthFiles` in `managementClient.js` to preserve `excluded_models` arrays from downloaded auth credentials, ensuring nodes and managed cards maintain exclusion metadata through reload events.
- Acceptance:
  1. `downloadAuthFilePrefix` extracts `excluded_models` (or `excludedModels`) from downloaded payload and returns `{ name, prefix, excluded_models: string[] }`.
  2. `loadAuthFilesWithPrefixes` propagates `excluded_models` into each auth file descriptor record.
  3. `buildGraphFromAuthFiles` forwards `excluded_models` and `excludedModels` to `node.data` and root node properties.
  4. `buildManagedPoolCards` retains exclusion metadata so `detectSpecialistState` accurately recognizes single-model specialist status immediately after card refresh.
- Canonical sources:
  - `plugins/visual-profile/web/src/api/managementClient.js`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`
- Validation:
  - Vitest unit tests in `managementClient.test.js` verifying `downloadAuthFilePrefix` and `loadAuthFilesWithPrefixes` output `excluded_models`.
  - Integration check in `AutoAuthFiles.test.jsx` verifying specialist state persistence upon reload.
- Depends on: None

### MINI-002: Prominent Hero Model Banner for Auto Auth Files Cards
- Contract: Introduce a prominent hero active model banner on both master and 2N managed cards in `AutoAuthFiles.jsx` with dedicated CSS styling in `AutoAuthFiles.css`.
- Acceptance:
  1. If `detectSpecialistState` is active: Render a dedicated hero banner container with badge `🎯 MODELO ESPECIALISTA ACTIVO`, the target specialist model name displayed prominently in large typography (>= 18px, bold, highlighted color), and helper text indicating single-model exclusive traffic and number of excluded models.
  2. If card is in multipurpose mode: Render a distinct hero container showing the default active model for that card family (e.g. `gemini-2.5-pro` for Gemini, `claude-3-7-sonnet` for Claude) with label `✨ MODELO PREDETERMINADO (MULTIPROPÓSITO)`.
  3. The hero banner is positioned prominently at the top of the card body, making the active/default model immediately visible at a glance.
- Canonical sources:
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.css`
- Validation:
  - Vitest test asserting presence and text content of `hero-model-banner`, `hero-model-name`, and `badge-specialist-active` / `badge-multipurpose-default`.
- Depends on: MINI-001

### MINI-003: Quota Telemetry Homologation & On-Demand Card Refresh
- Contract: Homologate quota telemetry on Auto Auth Files cards matching user specification: Plan Pro badge, dual family limit tracking (GEMINI MODELS + CLAUDE AND GPT MODELS, each with 5-Hour Limit and Weekly Limit progress bars and remaining percentages), and an independent per-card refresh button.
- Acceptance:
  1. Add quota retrieval and parser helper in `managementClient.js` (or reusable hook in `AutoAuthFiles.jsx`) that queries `/v0/management/api-call` for Antigravity credentials using account `auth_index` or file identifier.
  2. Parse and present `Plan Pro` badge prominently on the card header/telemetry section.
  3. Render `GEMINI MODELS` telemetry block:
     - 5-Hour Limit: display remaining percentage (e.g. `100%`) and progress bar styled by remaining health.
     - Weekly Limit: display remaining percentage (e.g. `98%`) and progress bar.
  4. Render `CLAUDE AND GPT MODELS` telemetry block:
     - 5-Hour Limit: display remaining percentage and progress bar.
     - Weekly Limit: display remaining percentage and progress bar.
  5. Include an on-demand refresh button (`🔄 Actualizar Cuota` or `↻`) per card that updates that specific card's quota with loading spinner state and error handling.
  6. Display graceful fallback or placeholder state when quota is loading or uninitialized, without breaking card layout.
- Canonical sources:
  - `plugins/visual-profile/web/src/api/managementClient.js`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.css`
- Validation:
  - Unit tests verifying quota payload parser unwraps Antigravity response and calculates 5h/weekly remaining percentages.
  - Vitest component tests verifying `Plan Pro` badge, both Gemini and Claude quota limit groups, and clicking per-card refresh triggers telemetry reload.
- Depends on: MINI-001

### MINI-004: Regression Suite Verification & Build Validation
- Contract: Verify all new and existing tests pass cleanly without regressions, ensuring production bundle builds successfully.
- Acceptance:
  1. `npm --prefix plugins/visual-profile/web run test` passes 100% across all suites.
  2. `npm --prefix plugins/visual-profile/web run build` compiles clean single-file assets without syntax or bundle errors.
- Canonical sources:
  - `plugins/visual-profile/web/package.json`
- Validation:
  - Vitest test runner output.
  - Vite build bundle confirmation.
- Depends on: MINI-001, MINI-002, MINI-003

## Risks & Constraints
- Privacy invariant VP-7: Raw credential tokens, refresh tokens, and passwords must never be stored in component state, telemetry caches, or logged.
- Single-page CSS consistency: Visual-profile uses pure CSS; new classes must be fully declared in `AutoAuthFiles.css` without relying on uninstalled utility frameworks.
- Network resilience: If `/v0/management/api-call` returns rate-limited or non-200 responses, fallback UI must indicate warning state without crashing the card rendering.

## Open Decisions
- None. Requirements, hero banner design, and quota homologation layout are fully specified and approved.

## Next Permitted Action
- Run 02-apply on `openspec/changes/auto-auth-files-hero-specialist-and-quota-telemetry/plan.md`.
