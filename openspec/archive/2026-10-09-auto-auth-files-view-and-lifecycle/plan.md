## Workflow Status
- Status: READY
- Blockers: None

## Goal
Design and implement the dedicated "🗂️ Auto Auth Files" sub-tab and lifecycle cleanup engine in `plugins/visual-profile`. This establishes a clean architectural separation between the 4 physical OAuth master accounts and 4 virtual/derived Claude pool accounts, provides full origin traceability and model exclusion badges, and eliminates residual clone sprawl through clean dissolution and orphan purging.

## Scope & Exclusions
- **Included**:
  - `plugins/visual-profile/internal/plugin/`: registration of `/auto-auth-files` resource in C-ABI management manifest, route routing in `MatchProfilesRoute`, and virtual credential deletion/cleanup bridge.
  - `plugins/visual-profile/web/src/api/`: helpers in `managementClient.js` for account classification (master vs virtual), origin extraction, exclusion badges derivation, and auth file deletion via `DELETE /v0/management/auth-files`.
  - `plugins/visual-profile/web/src/components/GroupManager.jsx`: lifecycle fix so dissolving pools cleans up virtual clone files from disk instead of merely setting `prefix: ''` (which generated residual clone sprawl).
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx` & `AutoAuthFiles.css`: new dedicated view displaying the 8 accounts (4 Master + 4 Virtual) with origin badges, model exclusion indicators, individual dissolution, and orphan clone purging.
  - `plugins/visual-profile/web/src/App.jsx`: tab navigation button and routing for `auto-auth-files`.
  - Unit and component regression test suites (`AutoAuthFiles.test.jsx`, `managementClient.test.js`, `GroupManager.test.jsx`, `plugin_test.go`).
- **Excluded**:
  - Modifying CLIProxyAPI core binaries or docker daemon configs.
  - Storing or transmitting raw OAuth tokens/secrets (strictly conforms to VP-7 privacy invariants).
  - Disrupting existing `/create-prefixes`, `/create-groups`, `/control-switcher`, `/profiles`, or `/pulse-tokens` workflows.

## Execution Scope
- Root: /home/wilox/projects/cpamc-auto-switcher
- Allowed Paths:
  - /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/**
  - /home/wilox/projects/cpamc-auto-switcher/investigaciones/**
- Writable Paths:
  - /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/**
- Allowed Bash:
  - npm test --prefix plugins/visual-profile/web
  - npm run build --prefix plugins/visual-profile/web
  - go test ./plugins/visual-profile/internal/plugin/...
- Notes: Plain text boundaries. Modifications are strictly bounded to visual-profile web frontend and Go plugin internals. Investigations and main binary are read-only references.

## Planned Workflow Items

### MINI-001: Register '🗂️ Auto Auth Files' Resource and Routing in C-ABI Plugin
- Contract:
  Register `/auto-auth-files` with menu title `🗂️ Auto Auth Files` and description in `plugins/visual-profile/internal/plugin/plugin.go` under `management.register` resources. Update `MatchProfilesRoute` to recognize `auto-auth-files` as a valid path segment alongside existing routes.
- Acceptance:
  - `HandlePluginMethod("management.register", nil)` includes `{ "Path": "/auto-auth-files", "Menu": "🗂️ Auto Auth Files", ... }` in returned resources.
  - `MatchProfilesRoute("/v0/management/auto-auth-files")` and `MatchProfilesRoute("/auto-auth-files")` return `("index.html", true)`.
  - Go unit tests pass in `plugin_test.go`.
- Canonical sources:
  - `investigaciones/2026-10-09-0415-cpamc-auth-files-duplication-and-architecture-audit/report.md` (Sec. 3: Propuesta de Wilox)
  - `plugins/visual-profile/internal/plugin/plugin.go:50-130`
- Validation:
  `go test ./plugins/visual-profile/internal/plugin/...`
- Depends on:
  None

---

### MINI-002: Master vs Virtual Account Classification and Origin Traceability Model
- Contract:
  Implement classification and origin parsing in `plugins/visual-profile/web/src/api/managementClient.js`:
  1. `classifyAuthAccount(fileOrNode)`: classifies an account as either `master` (physical OAuth account, e.g. `antigravity-<email>.json`) or `virtual` (derived pool account with secondary prefix, e.g. `<base>.<prefix>.json` or `.agy_son*.json`).
  2. `extractVirtualOrigin(fileName)`: extracts the base email / master account identity from a virtual filename.
  3. `extractExclusionBadges(excludedModels = [])`: converts raw excluded model strings into human-readable badges (e.g. "Excluye 5.5", "Excluye Gemini", "Claude Only").
  4. Masks all emails per VP-7 / CLIProxyAPI privacy invariants using `extractSafeMaskedEmail` and `maskDisplayIdentifier`.
- Acceptance:
  - Accounts matching `<base>.<prefix>.json` (such as `antigravity-infosoytec@gmail.com.agy_son.json`) are classified as `isVirtual = true`, with `masterOrigin` pointing to `antigravity-infosoytec@gmail.com.json` and masked email `inf...tec@gmail.com`.
  - Original OAuth accounts (e.g. `antigravity-infosoytec@gmail.com.json`) are classified as `isVirtual = false`, `isMaster = true`.
  - Detection safely ignores trailing suffixes like `.agy_son_1.json` and identifies origin correctly.
  - Unit tests in `managementClient.test.js` verify classification, origin extraction, and exclusion badge formatting without secret leaks.
- Canonical sources:
  - `investigaciones/2026-10-09-0415-cpamc-auth-files-duplication-and-architecture-audit/report.md` (Sec. 1.2 & Sec. 2)
  - `plugins/visual-profile/web/src/api/managementClient.js:40-100`
- Validation:
  `npm test --prefix plugins/visual-profile/web -- -t "classifyAuthAccount"`
- Depends on:
  MINI-001

---

### MINI-003: Auth File Deletion & Dissolution Cleanup in Management Client and GroupManager
- Contract:
  1. Add `deleteAuthFile(fileName, options)` to `managementClient.js` calling `DELETE /v0/management/auth-files?name=${encodeURIComponent(fileName)}` with authoritative Bearer header, URL sanitization, and error handling.
  2. In `plugins/visual-profile/internal/plugin/virtualize.go` & `plugin.go`, support fallback virtual deletion route if needed by host environment.
  3. Update `handleDissolvePool` in `GroupManager.jsx`:
     - Detect all descendant nodes in the pool.
     - For virtual/derived accounts (e.g. clones matching `isVirtual = true`), invoke `deleteAuthFile` so the cloned `.json` files are physically removed from CPAMC disk, preventing residual clone sprawl.
     - For physical master accounts, update prefix to empty `''` via `saveAuthFilePrefixes`.
  4. Ensure pool virtualization does not generate orphan numbered suffixes (`_1`, `_2`, `_3`, `_4`) when an existing virtual file for that master and prefix already exists.
- Acceptance:
  - `deleteAuthFile` sends authenticated `DELETE /v0/management/auth-files?name=...` and rejects directory traversal characters (`..`, `/`, `\`).
  - Dissolving a pool with 2 master and 2 virtual accounts deletes the 2 virtual accounts and resets the 2 master accounts to unassigned, leaving no orphaned `.json` clones on disk.
  - Vitest tests in `managementClient.test.js` and `GroupManager.test.jsx` verify dissolution deletion behavior.
- Canonical sources:
  - `investigaciones/2026-10-09-0415-cpamc-auth-files-duplication-and-architecture-audit/report.md` (Sec. 2: Causa Raíz & Sec. 3: Limpieza de Archivos Residuales)
  - `plugins/visual-profile/web/src/components/GroupManager.jsx:700-760`
  - `plugins/visual-profile/internal/plugin/virtualize.go`
- Validation:
  `npm test --prefix plugins/visual-profile/web -- -t "deleteAuthFile|dissolve"`
- Depends on:
  MINI-002

---

### MINI-004: Dedicated 'Auto Auth Files' Sub-Tab UI Component
- Contract:
  Build `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx` and `AutoAuthFiles.css`:
  - **Metrics Header**: Summary cards showing total accounts (target 8), physical master accounts (4), virtual accounts (4), and detected orphan clones count.
  - **Section 1: 👑 Cuentas Físicas Maestras (OAuth Masters)**:
    - 4 distinct cards for master accounts.
    - Badges: `👑 Cuenta Maestra (OAuth)`, Provider (`Antigravity` / `Google`), Assigned Pool Role (Leader / Reserve / Libre).
    - Safe masked email display (e.g. `inf...tec@gmail.com`).
    - Derived pools status list (indicates whether this account is currently virtualized in Claude Sonnet or Opus pools).
  - **Section 2: 🔀 Cuentas Virtuales Derivadas (Pool Accounts)**:
    - 4 cards for derived virtual accounts.
    - Badges: `🔀 Virtual / Pool Derivado`, Target Family (`Claude Sonnet` / `Claude Opus`), Pool Prefix (`agy_son`, `agy_son_1`).
    - **Origin Traceability**: Prominent indicator `Origen: <masked-email> (Master)`.
    - **Model Exclusion Badges**: Visual tags showing excluded models (e.g. `🚫 Excluye 5.5`, `🚫 Excluye Gemini`) and served models (`✨ Serves: Claude Sonnet 4.6 & 5.5-high`).
    - Action button: "💥 Disolver / Eliminar Clon" with confirmation modal/dialog.
  - **Section 3: 🧹 Purgar Clones Huérfanos (Consolidation)**:
    - If any residual clones are detected (virtual files with empty prefix or stale duplicates from previous runs), display an alert banner with button "🧹 Purgar Clones Huérfanos" to delete them cleanly in batch.
- Acceptance:
  - Component renders without crash and displays separate Master and Virtual card grids.
  - Renders 4 master cards and 4 virtual cards given an 8-account dataset.
  - Origin traceability badge shows corresponding master account for each virtual card.
  - Model exclusion badges accurately reflect exclusion settings (including 5.5 exclusion).
  - Clicking "Disolver / Eliminar Clon" calls `deleteAuthFile` and triggers profile reload.
  - Clicking "Purgar Clones Huérfanos" deletes unassigned/stale clones.
  - Component unit tests in `AutoAuthFiles.test.jsx` pass.
- Canonical sources:
  - `investigaciones/2026-10-09-0415-cpamc-auth-files-duplication-and-architecture-audit/report.md` (Sec. 3: Evaluación Técnica y Viabilidad)
  - `plugins/visual-profile/web/src/components/PrefixManager.jsx` (role classification styling pattern)
- Validation:
  `npm test --prefix plugins/visual-profile/web -- -t "AutoAuthFiles"`
- Depends on:
  MINI-003

---

### MINI-005: Navigation Integration & End-to-End Test Suite
- Contract:
  1. In `plugins/visual-profile/web/src/App.jsx`:
     - Add route detection for `auto-auth-files` in `initialTab`.
     - Add navigation button in `header-tabs-nav`: `🗂️ Auto Auth Files` with `data-testid="tab-auto-auth-files"`.
     - Mount `<AutoAuthFiles nodes={graphData.nodes} onReloadRequested={loadProfiles} />` when `activeTab === 'auto-auth-files'`.
  2. In `plugins/visual-profile/web/src/App.test.jsx`:
     - Test tab switching to `auto-auth-files`.
  3. Execute complete regression suites across frontend and plugin backend.
- Acceptance:
  - Clicking `🗂️ Auto Auth Files` switches `activeTab` and renders the AutoAuthFiles view.
  - All existing tabs (`create-prefixes`, `create-groups`, `control-switcher`, `profiles`, `pulse-tokens`) remain intact and functional.
  - Vitest test suite passes with 0 failures (`npm test --prefix plugins/visual-profile/web`).
  - Production build succeeds without errors (`npm run build --prefix plugins/visual-profile/web`).
  - Go tests pass (`go test ./plugins/visual-profile/internal/plugin/...`).
- Canonical sources:
  - `plugins/visual-profile/web/src/App.jsx:30-80, 200-260`
  - `plugins/visual-profile/web/src/App.test.jsx`
- Validation:
  - `npm test --prefix plugins/visual-profile/web`
  - `npm run build --prefix plugins/visual-profile/web`
  - `go test ./plugins/visual-profile/internal/plugin/...`
- Depends on:
  MINI-004

## Risks & Constraints
- **Disk Residual Duplication**: Virtualizing without cleanup permanently polluted disk in previous revisions. Deletion must strictly target only virtual/derived files (`isVirtual = true`) and never touch physical OAuth master files.
- **Credential Privacy (VP-7)**: In accordance with CLIProxyAPI security invariants, secret tokens and keys must never be parsed, stored, displayed, or logged in web state.
- **Fail-Closed API Guard**: In iframe or standalone mode, missing management key must fail closed with clean unauthorized state rather than leaking errors.
- **Zero Disruption to Existing Pools**: Active Gemini pools (`agy`, `agy_1`) and Claude pools (`agy_son`) must continue routing seamlessly.

## Open Decisions
- None. Requirements, visual layout, lifecycle cleanup mechanics, and architecture separation are resolved and documented in discovery report `investigaciones/2026-10-09-0415-cpamc-auth-files-duplication-and-architecture-audit/report.md`.

## Next Permitted Action
- Implement MINI-001 in 02-apply.
