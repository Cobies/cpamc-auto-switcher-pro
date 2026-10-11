# Plan: Auto Auth Files Single-Model Specialist Gear (⚙️) & Model Inheritance/Exclusion Engine

## Overview & Context

In CPAMC Auto Switcher Pro (`visual-profile` plugin), the '🗂️ Auto Auth Files' view provides origin traceability and managed lifecycle for physical OAuth master accounts and derived virtual pool cards (scalable $N \rightarrow 2N$ model).

Users require granular, card-level model specialization:
1. Each card in Auto Auth Files must display a gear icon (**⚙️**).
2. Clicking the gear opens a **Specialist Configuration Modal**.
3. The modal inherits the card's available model catalog from CPAMC native auth-files / `/v1/models` (filtering out models already globally disabled in CPAMC or irrelevant to the account family).
4. The user can switch between:
   - **Specialist Mode (Modo Especialista)**: Selects **EXACTLY ONE** target model for that card, automatically excluding all other models (`auto-exclusion`).
   - **Multipurpose / Family Mode (Modo Multipropósito)**: Clears single-model specialization and restores standard family-wide serving (preserving default family boundaries and any manual exclusions).
5. Cards display visible real-time badges:
   - `🎯 Modelo Activo: [model-id]`
   - `🚫 Excluidos: [N modelos]`
6. Persists updates cleanly in-place via `PATCH /v0/management/auth-files/fields` (`{ name, excluded_models }`) without creating disk clones or corrupting physical OAuth master tokens.

---

## Architectural Invariants & Safety Guardrails

1. **Zero-Clone In-Place Mutation**:
   - Specialist configuration updates `excluded_models` directly on the target auth-file via `PATCH /v0/management/auth-files/fields`.
   - Never calls `/auto-switcher-pro/virtualize` or creates `.json.xxx.json` clones on disk.
2. **Master Credential Isolation**:
   - For virtual cards (`card.virtualFileName`), updates target the virtual file.
   - For physical master cards (`card.masterFileName`), updates target the physical file's `excluded_models` field only, preserving OAuth tokens and refresh credentials intact.
3. **Deterministic Inheritance & Auto-Exclusion**:
   - The inherited model list is computed from active catalog models matching the card family (Gemini vs Claude vs Codex).
   - Globally disabled models are omitted from selectable targets.
   - Selecting target $M_k$ from $\{M_1, \dots, M_n\}$ automatically produces exclusions $E = \{M_i \mid i \neq k\}$.
4. **Fail-Closed Security & Masking**:
   - Exact physical filenames are sanitized.
   - Display labels mask all embedded emails using `maskDisplayIdentifier`.
   - Bearer authentication and same-origin rules are enforced via `apiFetch`.

---

## Planned Workflow (MINI Steps)

### MINI-01: Model Inheritance & Exclusion Engine (Client & Plugin Helpers)
- **Goal**: Implement deterministic model inheritance resolution, specialist exclusion computation, and in-place field patching in web client and Go plugin.
- **Scope**:
  - `plugins/visual-profile/web/src/api/managementClient.js`
  - `plugins/visual-profile/internal/plugin/virtualize.go`
  - Unit test suites for web client and Go plugin.
- **Acceptance Criteria**:
  1. `computeSpecialistExclusions(availableModels, targetModel)`: Given a list of available models and a chosen target model, returns a sorted, deduplicated array containing every available model except the target.
  2. `resolveInheritedCardModels(card, catalogModels, globalDisabledModels)`: Resolves the available models for a given card based on its family (`gemini`, `claude`, `codex`) and strips route prefixes (`toBaseModelId`). Excludes any model in `globalDisabledModels`.
  3. `patchAuthFileExclusions(fileName, excludedModels, options)`: Dispatches `PATCH /v0/management/auth-files/fields` with `{ name, excluded_models }` safely via `apiFetch`.
  4. Go helper `ComputeSpecialistExclusions(allModels []string, targetModel string) []string` implemented and verified with Go unit tests.
- **Verification**:
  - `npm test` in `plugins/visual-profile/web/` covering new client methods.
  - `go test ./...` in `plugins/visual-profile/internal/plugin/`.

### MINI-02: Specialist Gear Modal Component (`SpecialistModal.jsx`)
- **Goal**: Build the interactive modal for configuring specialist single-model targeting and toggling multipurpose mode.
- **Scope**:
  - `plugins/visual-profile/web/src/components/SpecialistModal.jsx`
  - `plugins/visual-profile/web/src/components/SpecialistModal.css`
  - Unit tests in `plugins/visual-profile/web/src/components/SpecialistModal.test.jsx`.
- **Acceptance Criteria**:
  1. Modal opens with target card metadata: masked email, filename, and family role.
  2. Displays mode switcher:
     - **Modo Especialista (🎯)**: Radio list of inherited models allowing strictly ONE selection.
     - **Modo Multipropósito (✨)**: All family models active.
  3. Auto-exclusion counter: Displays live preview of the active model and count of excluded models (`🚫 N modelos excluidos`).
  4. Save action: Calls `patchAuthFileExclusions`, handles loading/error feedback, triggers `onSaved()` callback, and closes modal on success.
  5. Close/Cancel button and backdrop click dismiss without saving.
- **Verification**:
  - Vitest component tests testing modal rendering, radio selection, mode switching, error handling, and save dispatch.

### MINI-03: AutoAuthFiles Card Integration & Visual Badges
- **Goal**: Integrate the gear icon into AutoAuthFiles cards and display real-time specialist badges.
- **Scope**:
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.css`
  - Unit tests in `plugins/visual-profile/web/src/components/AutoAuthFiles.test.jsx`.
- **Acceptance Criteria**:
  1. Every card in Managed Cards (and Master Cards) renders a gear icon button (`btn-card-gear` with `⚙️`) in the top right actions area.
  2. Specialist state detection: Inspects card's `excluded_models`. If all inherited models except one are excluded, identifies the card as Specialist Mode with `activeSpecialistModel`.
  3. Badge rendering:
     - In Specialist Mode:
       - `🎯 Modelo Activo: [model-id]`
       - `🚫 Excluidos: [N modelos]`
     - In Multipurpose Mode:
       - Displays standard family badge (`✨ Serves: ...`) and standard exclusions.
  4. Clicking ⚙️ opens `SpecialistModal` with the card's inherited models catalog.
  5. On modal save completion, calls `onReloadRequested()` to refresh CPAMC state and shows temporary success toast.
- **Verification**:
  - Vitest integration tests in `AutoAuthFiles.test.jsx` verifying gear button, modal launch, badge display, and state refresh.

### MINI-04: Full Suite Verification & Build Validation
- **Goal**: Run complete test suites and verify frontend build to prevent regressions.
- **Scope**:
  - `plugins/visual-profile/web/`
  - `plugins/visual-profile/`
- **Acceptance Criteria**:
  1. `npm test` passes 100% across all web test suites.
  2. `npm run build` succeeds cleanly producing embedded single-file assets.
  3. `go test ./...` passes in `plugins/visual-profile`.
- **Verification**:
  - Automated test runs and production build check.

---

## Execution Scope

- **Narrowest Directory Root**: `plugins/visual-profile/`
- **Modification Areas**:
  - `plugins/visual-profile/web/src/`
  - `plugins/visual-profile/internal/plugin/`
- **Read-Only Context Areas**:
  - `internal/client/`
  - `internal/switcher/`

---

## Validation Plan (TDD)

1. **Engine Level (TDD First)**:
   - Test `computeSpecialistExclusions` with single target, empty lists, and multi-model catalogs.
   - Test `resolveInheritedCardModels` across Gemini, Claude, and Codex families.
   - Test Go `ComputeSpecialistExclusions` against edge cases.
2. **Component Level**:
   - Render `SpecialistModal` with mock models; verify single selection radio behavior.
   - Verify toggle from Specialist to Multipurpose Mode clears auto-exclusions.
3. **Integration Level**:
   - Render `AutoAuthFiles` with cards in specialist and multipurpose states.
   - Verify badge texts: `🎯 Modelo Activo: ...` and `🚫 Excluidos: N modelos`.
   - Simulate clicking ⚙️ and persisting via mocked `patchAuthFileExclusions`.
4. **End-to-End Build**:
   - `npm run build` and `go test ./...`.

---

## Dependencies & Blockers

- **Dependencies**: Native CPAMC Management endpoint `PATCH /v0/management/auth-files/fields` supporting `excluded_models`.
- **Blockers**: None. Requirements are clear, bounded, and architecture is validated.

---

## Open Decisions

- None. All architectural constraints and functional flows are fully specified.
