## Workflow Status
- Status: READY
- Blockers: None

## Workflow & Contracts
- **Change Slug**: `auto-auth-files-single-model-specialist-gear`
- **Plan Artifact**: `openspec/changes/auto-auth-files-single-model-specialist-gear/plan.md`
- **Governing Skills**:
  - `skills/subagent-artifact-contracts/SKILL.md`
  - `skills/anti-overengineering/SKILL.md`
  - `skills/tdd/SKILL.md`

## Authorization Record
- **Author**: Orchestrator / User
- **Reference**: Delegation prompt
- **Action**: Apply implementation of MINI-01 through MINI-04
- **Scope**: `plugins/visual-profile/**`
- **Authority Artifact**: `openspec/changes/auto-auth-files-single-model-specialist-gear/plan.md`
- **Change Slug**: `auto-auth-files-single-model-specialist-gear`

## Planned Workflow Items

### MINI-01: Model Inheritance & Exclusion Engine (Client & Plugin Helpers)
- **Implementation Evidence**:
  - `plugins/visual-profile/web/src/api/managementClient.js`:
    - Implemented `computeSpecialistExclusions(availableModels, targetModel)`: sorts and deduplicates `availableModels` excluding the chosen target model.
    - Implemented `resolveInheritedCardModels(card, catalogModels, globalDisabledModels)`: extracts base models according to card family (`gemini`, `claude`, `codex`), strips route prefixes via `toBaseModelId`, and removes globally disabled models.
    - Implemented `patchAuthFileExclusions(fileName, excludedModels, options)`: dispatches `PATCH /v0/management/auth-files/fields` with `{ name, excluded_models }` safely via `apiFetch`.
    - Implemented `detectSpecialistState(card, inheritedModels)`: detects if exactly one inherited model remains active (all others excluded) to identify Specialist Mode.
    - Updated `buildManagedPoolCards`: attaches raw `excludedModels` / `excluded_models` arrays to 2N managed card models.
  - `plugins/visual-profile/internal/plugin/virtualize.go`:
    - Implemented `ComputeSpecialistExclusions(allModels []string, targetModel string) []string` in Go.
  - Unit tests:
    - `plugins/visual-profile/internal/plugin/virtualize_test.go`: Added `TestComputeSpecialistExclusions`, `TestComputeSpecialistExclusions_TargetNotInList`, `TestComputeSpecialistExclusions_Empty`.
    - `plugins/visual-profile/web/src/api/managementClient.test.js`: Added comprehensive unit tests for `computeSpecialistExclusions`, `resolveInheritedCardModels`, `patchAuthFileExclusions`, and `detectSpecialistState`.
- **Validation Evidence**:
  - Command: `go -C plugins/visual-profile test ./internal/plugin/...`
  - Result: PASS (`ok visual-profile/internal/plugin 0.395s`)
  - Command: `npm test --prefix plugins/visual-profile/web -- src/api/managementClient.test.js`
  - Result: PASS (72 tests passed)
- **Acceptance Coverage**:
  - `computeSpecialistExclusions`: Verified.
  - `resolveInheritedCardModels`: Verified.
  - `patchAuthFileExclusions`: Verified.
  - Go helper `ComputeSpecialistExclusions`: Verified.

---

### MINI-02: Specialist Gear Modal Component (`SpecialistModal.jsx`)
- **Implementation Evidence**:
  - Created `plugins/visual-profile/web/src/components/SpecialistModal.jsx`:
    - Renders target card metadata: masked email (`card.maskedEmail`), filename (`maskDisplayIdentifier(targetFileName)`), and family role badge.
    - Mode switcher: "Modo Especialista (🎯)" vs "Modo Multipropósito (✨)".
    - Specialist Mode: radio inputs allowing strictly ONE model target selection with real-time auto-exclusion count.
    - Multipurpose Mode: clears auto-exclusions and restores all family models.
    - Auto-exclusion preview banner: `🎯 Modelo Activo: [model-id]` and `🚫 [N] modelos excluidos automáticamente`.
    - Save action: dispatches `patchAuthFileExclusions` in-place, supports error feedback without modal dismissal, and triggers `onSaved` callback on success.
    - Cancel button, Close (✕) button, and backdrop click dismiss cleanly without mutating state.
  - Created `plugins/visual-profile/web/src/components/SpecialistModal.css`:
    - Modal backdrop blur, dark theme card dialog, mode switcher pills, radio list styling, and preview box.
  - Created `plugins/visual-profile/web/src/components/SpecialistModal.test.jsx`:
    - 9 component unit tests covering metadata display, mode switching, radio selection, auto-exclusion preview, save dispatch in specialist mode, save dispatch in multipurpose mode, error handling, cancel button, and backdrop dismissal.
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web -- src/components/SpecialistModal.test.jsx`
  - Result: PASS (9 tests passed)
- **Acceptance Coverage**:
  - Modal rendering with target card metadata: Verified.
  - Mode switcher and radio selection: Verified.
  - Auto-exclusion counter and live preview: Verified.
  - Save action and error handling: Verified.
  - Close / cancel dismiss without saving: Verified.

---

### MINI-03: AutoAuthFiles Card Integration & Visual Badges
- **Implementation Evidence**:
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`:
    - Integrated gear button `btn-card-gear` (`⚙️`) in top right actions area for all Master Cards and 2N Managed Cards.
    - Dynamic specialist state detection via `detectSpecialistState(card, inheritedModels)`.
    - Real-time badge rendering:
      - Specialist Mode: `🎯 Modelo Activo: [model-id]` and `🚫 Excluidos: [N] modelos`.
      - Multipurpose Mode: standard exclusions and `✨ Serves: ...` badge.
    - Gear click launches `SpecialistModal` populated with card metadata and resolved inherited catalog models.
    - On modal save completion: displays temporary success toast and invokes `onReloadRequested()` to refresh CPAMC state.
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.css`:
    - Added styles for `.btn-card-gear`, `.badge-specialist-active`, and `.badge-specialist-excluded`.
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.test.jsx`:
    - Added tests for gear button rendering across all cards, specialist badge rendering in specialist mode, modal opening upon gear click, and state reload on save.
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web -- src/components/AutoAuthFiles.test.jsx`
  - Result: PASS (8 tests passed)
- **Acceptance Coverage**:
  - Gear button rendered in top right of every card: Verified.
  - Specialist state detection from `excluded_models`: Verified.
  - Badge rendering for Specialist vs Multipurpose mode: Verified.
  - Modal opening and reload requested on save: Verified.

---

### MINI-04: Full Suite Verification & Build Validation
- **Implementation Evidence**:
  - Ran comprehensive automated test suite for web application.
  - Ran production single-file build (`npm run build`).
  - Ran full Go unit test suite across `plugins/visual-profile`.
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web`
  - Result: PASS (16 test files, 318 tests passed, 0 failures)
  - Command: `npm run build --prefix plugins/visual-profile/web`
  - Result: PASS (built cleanly in 8.78s producing `plugins/visual-profile/internal/web/assets/index.html` 608.98 kB)
  - Command: `go -C plugins/visual-profile test -v ./internal/plugin/...`
  - Result: PASS (all tests passed)
- **Acceptance Coverage**:
  - All web tests passing 100%: Verified.
  - Production build producing embedded single-file asset: Verified.
  - Go test suite passing 100%: Verified.

## Approved Deviations
- None. Implementation strictly adheres to planned items and architectural safety invariants.

## Attempt Record
- **Attempt 1**:
  - MINI-01 implemented: TDD RED -> GREEN cycle for Go and JS model inheritance/exclusion computation and PATCH API. (PASS)
  - MINI-02 implemented: TDD RED -> GREEN cycle for `SpecialistModal` component, CSS, and unit tests. (PASS)
  - MINI-03 implemented: TDD RED -> GREEN cycle for gear button integration, real-time badges, and state refresh in `AutoAuthFiles`. (PASS)
  - MINI-04 implemented: Complete test suites executed and production web bundle built cleanly. (PASS)

## Candidate Identity
- Modified files:
  - `plugins/visual-profile/internal/plugin/virtualize.go`
  - `plugins/visual-profile/internal/plugin/virtualize_test.go`
  - `plugins/visual-profile/internal/web/assets/index.html`
  - `plugins/visual-profile/web/src/api/managementClient.js`
  - `plugins/visual-profile/web/src/api/managementClient.test.js`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.css`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.test.jsx`
- Created files:
  - `plugins/visual-profile/web/src/components/SpecialistModal.css`
  - `plugins/visual-profile/web/src/components/SpecialistModal.jsx`
  - `plugins/visual-profile/web/src/components/SpecialistModal.test.jsx`

## Residual Risks
- None identified. Target mutations are performed in-place via native `PATCH /v0/management/auth-files/fields`, avoiding clone sprawl or master credential corruption.

## Verification Inputs
- `npm test --prefix plugins/visual-profile/web`
- `npm run build --prefix plugins/visual-profile/web`
- `go -C plugins/visual-profile test -v ./internal/plugin/...`

## Next Permitted Action
- Proceed to independent verification in `03-verify`.
