## Workflow Status
- Status: READY
- Blockers: None

## Workflow & Contracts
- **Change Slug**: `auto-auth-files-view-and-lifecycle`
- **Plan Artifact**: `openspec/changes/auto-auth-files-view-and-lifecycle/plan.md`
- **Discovery Artifact**: `investigaciones/2026-10-09-0415-cpamc-auth-files-duplication-and-architecture-audit/report.md`
- **Governing Skills**:
  - `skills/subagent-artifact-contracts/SKILL.md`
  - `skills/anti-overengineering/SKILL.md`
  - `skills/tdd/SKILL.md`

## Authorization Record
- **Author**: Orchestrator / User
- **Reference**: Session delegation prompt
- **Action**: Apply implementation of MINI-001 through MINI-005
- **Scope**: `plugins/visual-profile/**`
- **Authority Artifact**: `openspec/changes/auto-auth-files-view-and-lifecycle/plan.md`
- **Change Slug**: `auto-auth-files-view-and-lifecycle`

## Planned Workflow Items

### MINI-001: Register '🗂️ Auto Auth Files' Resource and Routing in C-ABI Plugin
- **Implementation Evidence**:
  - `plugins/visual-profile/internal/plugin/plugin.go`:
    - Registered resource `/auto-auth-files` with menu title `🗂️ Auto Auth Files` and description in `HandlePluginMethod("management.register", ...)`.
    - Added `seg == "auto-auth-files"` segment recognition in `MatchProfilesRoute`.
  - `plugins/visual-profile/internal/plugin/plugin_test.go`:
    - Added verification for `/auto-auth-files` resource registration and menu title.
    - Added test cases in `TestMatchProfilesRoute_ExactSegmentScoped` for `/auto-auth-files`, `/auto-auth-files/`, and `/v0/management/auto-auth-files`.
- **Validation Evidence**:
  - Command: `go -C plugins/visual-profile test -v ./internal/plugin/...`
  - Result: PASS (`TestHandlePluginMethod_ManagementRegister`, `TestMatchProfilesRoute_ExactSegmentScoped`).
- **Acceptance Coverage**:
  - `HandlePluginMethod("management.register", nil)` returns `/auto-auth-files` resource: Verified.
  - `MatchProfilesRoute` matches `/auto-auth-files` and `/v0/management/auto-auth-files`: Verified.

---

### MINI-002: Master vs Virtual Account Classification and Origin Traceability Model
- **Implementation Evidence**:
  - `plugins/visual-profile/web/src/api/managementClient.js`:
    - Implemented `extractVirtualOrigin(fileName)`: parses email base and extracts the physical master origin file name (e.g. `antigravity-infosoytec@gmail.com.agy_son.json` -> `antigravity-infosoytec@gmail.com.json`) while returning `null` for physical master files.
    - Implemented `extractExclusionBadges(excludedModels)`: derives human-readable badges (`Excluye 5.5`, `Excluye Gemini`, `Excluye Claude`, `Claude Only`).
    - Implemented `classifyAuthAccount(fileOrNode)`: classifies account into `{ fileName, isVirtual, isMaster, role, masterOrigin, maskedEmail, prefix, exclusionBadges }`. Strictly enforces VP-7 email masking invariants.
  - `plugins/visual-profile/web/src/api/managementClient.test.js`:
    - Added unit test suite covering `extractVirtualOrigin`, `classifyAuthAccount`, and `extractExclusionBadges`.
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web -- src/api/managementClient.test.js`
  - Result: PASS (56 tests passed).
- **Acceptance Coverage**:
  - Virtual accounts classified with `isVirtual = true`, `masterOrigin`, and masked email: Verified.
  - Original OAuth accounts classified with `isVirtual = false`, `isMaster = true`: Verified.
  - Ignored trailing suffixes and safe privacy masking: Verified.

---

### MINI-003: Auth File Deletion & Dissolution Cleanup in Management Client and GroupManager
- **Implementation Evidence**:
  - `plugins/visual-profile/web/src/api/managementClient.js`:
    - Implemented `deleteAuthFile(fileName, options)` with directory traversal guards (`..`, `/`, `\`), `.json` check, and authenticated `DELETE /v0/management/auth-files?name=...` with automatic fallback to `/v0/management/auto-switcher-pro/virtualize`.
  - `plugins/visual-profile/internal/plugin/virtualize.go` & `plugin.go`:
    - Added `DeleteVirtual(name string)` calling host bridge `host.auth.delete`.
    - Added `handleDeleteVirtualHTTP` and registered `DELETE` method on `virtualizeRoutePath`.
  - `plugins/visual-profile/internal/plugin/virtualize_test.go`:
    - Added unit tests `TestDeleteVirtual_DeletesAuthFileViaHost` and `TestHandleManagementHTTP_VirtualizeRouteDelete`.
  - `plugins/visual-profile/web/src/components/GroupManager.jsx`:
    - Updated `handleDissolvePool`: separates pool members into master accounts and virtual clones; calls `deleteAuthFile` for virtual accounts so clone files are removed from CPAMC disk, and calls `saveAuthFilePrefixes` with `prefix: ''` for physical master accounts.
    - Updated `queueAssignment`: always resolves virtualization source file to master origin account (`classification.masterOrigin || node.data.fileName`), preventing cascading nested clone names (`...agy_son.agy_son_1.json`).
  - `plugins/visual-profile/web/src/components/GroupManager.test.jsx`:
    - Added regression test `dissolving pool with 2 master and 2 virtual accounts deletes virtual files from disk and resets master accounts`.
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web -- src/components/GroupManager.test.jsx`
  - Result: PASS (24 tests passed).
  - Command: `go -C plugins/visual-profile test ./internal/plugin/...`
  - Result: PASS (all Go tests passed).
- **Acceptance Coverage**:
  - `deleteAuthFile` sends authenticated DELETE and validates filenames: Verified.
  - Pool dissolution deletes virtual accounts from disk and resets master accounts: Verified.

---

### MINI-004: Dedicated 'Auto Auth Files' Sub-Tab UI Component
- **Implementation Evidence**:
  - Created `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`:
    - Metrics ribbon: Total accounts (`metric-total-accounts`), Physical OAuth Masters (`metric-master-accounts`), Virtual Derived (`metric-virtual-accounts`), Orphan clones count (`metric-orphan-clones`).
    - Section 1 (OAuth Masters): renders master cards with badges (`👑 Cuenta Maestra (OAuth)`, provider, role) and derived pool affiliations.
    - Section 2 (Virtual Pool Accounts): renders derived accounts with `🔀 Virtual / Pool Derivado`, target family, pool prefix, Origin Traceability badge (`Origen: <masked-email> (Master)`), Model Exclusion badges, and individual clone dissolution button `btn-delete-virtual-<fileName>`.
    - Section 3 (Consolidation): orphan clone alert banner with batch purge button `btn-purge-orphans`.
  - Created `plugins/visual-profile/web/src/components/AutoAuthFiles.css`:
    - Responsive dark theme layout, color-coded master (gold) and virtual (purple) borders, origin boxes, and action buttons.
  - Created `plugins/visual-profile/web/src/components/AutoAuthFiles.test.jsx`:
    - Unit tests covering metrics rendering, 8-account layout (4 masters, 4 virtuals), origin traceability display, individual deletion, and batch orphan purge.
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web -- src/components/AutoAuthFiles.test.jsx`
  - Result: PASS (4 tests passed).
- **Acceptance Coverage**:
  - Master and virtual cards grid: Verified.
  - Origin traceability badge linking clone to master: Verified.
  - Model exclusion badges (including 5.5 exclusion): Verified.
  - Individual deletion and orphan purging: Verified.

---

### MINI-005: Navigation Integration & End-to-End Test Suite
- **Implementation Evidence**:
  - `plugins/visual-profile/web/src/App.jsx`:
    - Added route detection for `/auto-auth-files` in `initialTab`.
    - Added navigation button `data-testid="tab-auto-auth-files"` (`🗂️ Auto Auth Files`).
    - Added route badge support `/auto-auth-files`.
    - Mounted `<AutoAuthFiles nodes={graphData.nodes} onReloadRequested={loadProfiles} />` when `activeTab === 'auto-auth-files'`.
  - `plugins/visual-profile/web/src/App.test.jsx`:
    - Added integration test `switches to Auto Auth Files tab and renders AutoAuthFiles view`.
  - Full web build execution (`npm run build --prefix plugins/visual-profile/web`):
    - Produced updated single-file bundle at `plugins/visual-profile/internal/web/assets/index.html` (588.19 kB).
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web`
  - Result: PASS (15 test files, 288 tests passed, 0 failures).
  - Command: `npm run build --prefix plugins/visual-profile/web`
  - Result: PASS (built in 4.70s).
  - Command: `go -C plugins/visual-profile test ./internal/plugin/...`
  - Result: PASS (all Go tests passed).
- **Acceptance Coverage**:
  - Tab navigation and rendering: Verified.
  - Regression stability across all other tabs: Verified.
  - Production build generation: Verified.

## Approved Deviations
- None. Implementation strictly adheres to planned items and discovery findings.

## Attempt Record
- **Attempt 1**:
  - MINI-001 implemented: resource registration and route matching in Go plugin internals. (PASS)
  - MINI-002 implemented: TDD RED -> GREEN cycle for classification, origin extraction, and exclusion formatting. (PASS)
  - MINI-003 implemented: TDD RED -> GREEN cycle for Go DELETE route and GroupManager dissolution cleanup. (PASS)
  - MINI-004 implemented: TDD RED -> GREEN cycle for AutoAuthFiles component and CSS. (PASS)
  - MINI-005 implemented: TDD RED -> GREEN cycle for App navigation, complete test suites, and production single-file build. (PASS)

## Candidate Identity
- Modified files:
  - `plugins/visual-profile/internal/plugin/plugin.go`
  - `plugins/visual-profile/internal/plugin/plugin_test.go`
  - `plugins/visual-profile/internal/plugin/virtualize.go`
  - `plugins/visual-profile/internal/plugin/virtualize_test.go`
  - `plugins/visual-profile/internal/web/assets/index.html`
  - `plugins/visual-profile/web/src/App.jsx`
  - `plugins/visual-profile/web/src/App.test.jsx`
  - `plugins/visual-profile/web/src/api/managementClient.js`
  - `plugins/visual-profile/web/src/api/managementClient.test.js`
  - `plugins/visual-profile/web/src/components/GroupManager.jsx`
  - `plugins/visual-profile/web/src/components/GroupManager.test.jsx`
- Created files:
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.css`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.test.jsx`

## Residual Risks
- CPAMC runtime environment must support `DELETE /v0/management/auth-files` or the fallback `DELETE /v0/management/auto-switcher-pro/virtualize` for file deletion. The implementation supports both endpoints with fail-closed error reporting.

## Verification Inputs
- `npm test --prefix plugins/visual-profile/web`
- `npm run build --prefix plugins/visual-profile/web`
- `go -C plugins/visual-profile test ./internal/plugin/...`

## Next Permitted Action
- Proceed to independent verification in `03-verify`.
