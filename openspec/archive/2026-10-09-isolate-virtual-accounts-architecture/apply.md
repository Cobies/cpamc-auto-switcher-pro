## Workflow Status
- Status: READY
- Blockers: None

## Workflow & Contracts
- **Change Slug**: `isolate-virtual-accounts-architecture`
- **Plan Artifact**: `openspec/changes/isolate-virtual-accounts-architecture/plan.md`
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
- **Authority Artifact**: `openspec/changes/isolate-virtual-accounts-architecture/plan.md`
- **Change Slug**: `isolate-virtual-accounts-architecture`

## Planned Workflow Items

### MINI-001: Scalable $N \rightarrow 2N$ Managed Card Model Data Layer
- **Implementation Evidence**:
  - `plugins/visual-profile/web/src/api/managementClient.js`:
    - Implemented `buildManagedPoolCards(nodes)`: deterministically maps each physical OAuth master account into exactly 2 managed cards:
      1. **Gemini Card**: `familyRole: 'gemini'`, default prefix hint `agy`, targeted to Gemini models, excluding Claude/GPT.
      2. **Claude Card**: `familyRole: 'claude'`, default prefix hint `agy_son`/`agy_opus`, targeted to Claude models, excluding Gemini.
    - Each managed card maintains deterministic attributes: `cardId`, `masterFileName`, `maskedEmail`, `familyRole`, `assignedPrefix`, `poolRole` (`'leader'` | `'reserve'` | `'unassigned'`), `activePoolBase`, `exclusionBadges`, and `virtualFileName`.
    - Handles $N \rightarrow 2N$ scalability: 4 physical masters produce exactly 8 cards; adding a 5th master produces 10 cards.
    - Non-Antigravity providers (e.g. Codex) are cleanly separated from the Antigravity package cards.
    - Reconciles active virtual credentials on disk into their corresponding managed cards without duplicate cards.
    - Strictly upholds VP-7 identifier and email masking invariants.
  - `plugins/visual-profile/web/src/api/managementClient.test.js`:
    - Unit test suite verifying:
      - 4 physical masters generate exactly 8 managed cards (4 Gemini + 4 Claude).
      - Active virtual credentials on disk merge into their Claude cards without duplicate cards.
      - Adding a 5th master node scales to exactly 10 cards without schema migrations.
      - Classification helpers identify master origin and model exclusions accurately.
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web -- src/api/managementClient.test.js`
  - Result: PASS (59 tests passed).
- **Acceptance Coverage**:
  - 4 masters generate 8 cards (4 Gemini + 4 Claude): Verified.
  - Existing on-disk virtual credentials reflect active prefix and exclusions: Verified.
  - 5th master yields 10 cards: Verified.
  - VP-7 privacy masking preserved: Verified.

---

### MINI-002: Auto Auth Files Card Registry & Traceability View
- **Implementation Evidence**:
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`:
    - Refactored to utilize `buildManagedPoolCards(nodes)` for scalable $2N$ managed card rendering.
    - Top metrics ribbon clearly differentiates:
      - **Cards Gestionadas**: $2N$ cards (`metric-total-accounts`, `metric-managed-cards`).
      - **Cuentas Maestras (OAuth)**: $N$ accounts (`metric-master-accounts`).
      - **Cuentas Virtuales**: Derived Claude cards count (`metric-virtual-accounts`).
      - **Activas en Pools**: Cards actively assigned to routing prefixes (`metric-active-pools`).
      - **Clones Huérfanos**: Residual unlinked or obsolete clones (`metric-orphan-clones`).
    - Two structured sections:
      - **Panel de Cards Gestionadas (Modelo 2N)**: Visual grid displaying family badges (`💎 Gemini Card`, `🎭 Claude Card`), master origin link (`🔗 Origen: [maskedEmail] (Master)` via `origin-traceability-badge`), assigned prefix, pool status (`LÍDER`, `RESERVA`, `LIBRE`), model exclusion tags, and per-card dissolution action (`btn-delete-virtual-...`).
      - **Panel de Cuentas Maestras (OAuth Core)**: Summary list of the $N$ physical identities recognized by CPAMC core (`section-masters`).
    - Orphan clone banner with batch purge button (`btn-purge-orphans`) only flags files that do not correspond to the valid $2N$ managed card schema.
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.css`:
    - Styling for gold master and purple virtual borders, origin traceability badges, and alert banners.
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.test.jsx`:
    - Added test verifying that 4 master accounts alone render exactly 8 managed cards (4 Gemini + 4 Claude) displaying family specialization badges.
    - Tested metric ribbon counts, individual card dissolution, and orphan purging.
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web -- src/components/AutoAuthFiles.test.jsx`
  - Result: PASS (5 tests passed).
- **Acceptance Coverage**:
  - Component renders 8 managed cards when 4 master accounts are present: Verified.
  - Family specialization and master origin email clearly indicated: Verified.
  - Deleting virtual card removes file from disk without corrupting master account: Verified.
  - Orphan banner flags only invalid/residual files: Verified.

---

### MINI-003: GroupManager Integration with Managed Cards Registry
- **Implementation Evidence**:
  - `plugins/visual-profile/web/src/components/GroupManager.jsx`:
    - Integrated with `buildManagedPoolCards(nodes)`.
    - Family-specific candidate dropdown filtering:
      - When selecting Gemini (`gemini_pure`): candidate list displays strictly the $N$ Gemini cards. Claude cards are completely hidden.
      - When selecting Claude (`gemini_sonnet`, `gemini_opus`, `gemini_claude`): candidate list displays strictly the $N$ Claude cards. Gemini cards are completely hidden.
      - Eliminates duplicate entries and "copia" clutter in dropdowns: exactly 1 entry per physical account per family.
    - Pool assembly: assigns routing prefixes to pre-existing managed cards. When assembling Claude pools, resolves virtualization source to master origin (`<master>.<prefix>.json`), preventing nested clone sprawl.
    - Pool dissolution: `handleDissolvePool` safely deletes virtual files via `deleteAuthFile` while resetting physical master accounts with `prefix: ''`, returning cards to `'unassigned'` status without dangling ghost clones.
  - `plugins/visual-profile/web/src/components/GroupManager.test.jsx`:
    - Added acceptance test verifying that for 4 master accounts, Gemini and Claude dropdowns show strictly 4 candidates with zero duplicate emails and clean cross-family isolation.
- **Validation Evidence**:
  - Command: `npm test --prefix plugins/visual-profile/web -- src/components/GroupManager.test.jsx`
  - Result: PASS (25 tests passed).
- **Acceptance Coverage**:
  - Gemini dropdown shows strictly 4 candidates (no Claude cards, no duplicate emails): Verified.
  - Claude dropdown shows strictly 4 candidates (no Gemini cards, no duplicate emails): Verified.
  - Assembling Claude pool virtualizes deterministically from master: Verified.
  - Dissolving pool deletes virtual clones and frees master accounts: Verified.

---

### MINI-004: Backend Plugin Virtualization Idempotency & Live Routing Guard
- **Implementation Evidence**:
  - `plugins/visual-profile/internal/plugin/virtualize.go`:
    - Declared and mounted management routes `/v0/management/auto-switcher-pro/virtualize` with legacy fallback `/v0/management/visual-profile/virtualize`.
    - Implemented `DeleteVirtual(name string)` bridging to host callback `host.auth.delete`.
    - Implemented `handleDeleteVirtualHTTP` handling `DELETE` requests with path traversal guards.
    - Model exclusion calculation isolates families: Gemini pools exclude Claude and GPT models; Claude pools exclude Gemini models.
    - Preserves OAuth refresh tokens inherited from master files on disk, ensuring CPAMC live routing under `/v1/models` (`agy`, `agy_1`, `agy2`, `agy2_1`, `agy_son`, `agy_son_1`, `agy_opus`, `agy_opus_1`) operates with zero auth errors or cross-depletion.
  - `plugins/visual-profile/internal/plugin/virtualize_test.go`:
    - Added unit tests `TestDeleteVirtual_DeletesAuthFileViaHost` and `TestHandleManagementHTTP_VirtualizeRouteDelete`.
    - Added routing tests for `/v0/management/auto-switcher-pro/virtualize`.
- **Validation Evidence**:
  - Command: `go -C plugins/visual-profile test -v ./internal/plugin/...`
  - Result: PASS (all 19 Go test suites passed).
- **Acceptance Coverage**:
  - `Virtualize` is idempotent and returns OK: Verified.
  - Target prefix and correct exclusions applied: Verified.
  - `DeleteVirtual` deletes clone file via host bridge: Verified.

---

### MINI-005: Full Verification & Ecosystem Integration Suite
- **Implementation Evidence**:
  - Verified entire web test suite with zero failures across 15 test files (293 tests).
  - Built production web assets using `npm run build` resulting in inlined bundle `plugins/visual-profile/internal/web/assets/index.html` (591.27 kB singlefile distribution).
  - Executed root Go test suite (`go test ./...`) covering switcher, quota, client, and config packages.
  - Confirmed zero regressions in quota gauges, routing prefix conventions, or model filtering.
- **Validation Evidence**:
  - `npm --prefix plugins/visual-profile/web run test`: PASS (15 test files, 293 tests passed).
  - `npm --prefix plugins/visual-profile/web run build`: PASS (built in 8.26s, singlefile HTML generated).
  - `go -C plugins/visual-profile test ./internal/plugin/...`: PASS.
  - `go test ./...`: PASS (all packages passed).
- **Acceptance Coverage**:
  - All web tests pass (0 failures): Verified.
  - All Go tests pass (0 failures): Verified.
  - Web asset build succeeds: Verified.

## Approved Deviations
- None. All implementations strictly follow the approved architecture in `plan.md`.

## Attempt Record
- Attempt 1: Addressed transient provider auth error from previous subagent delegation.
- Attempt 2: Refactored `AutoAuthFiles.jsx` and `GroupManager.jsx` to consume `buildManagedPoolCards`, added unit and acceptance tests for MINI-002 and MINI-003, verified MINI-001 through MINI-005.

## Candidate Identity
- Branch: `main`
- Modified implementation files:
  - `plugins/visual-profile/web/src/api/managementClient.js`
  - `plugins/visual-profile/web/src/api/managementClient.test.js`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.css`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.test.jsx`
  - `plugins/visual-profile/web/src/components/GroupManager.jsx`
  - `plugins/visual-profile/web/src/components/GroupManager.test.jsx`
  - `plugins/visual-profile/internal/plugin/virtualize.go`
  - `plugins/visual-profile/internal/plugin/virtualize_test.go`
  - `plugins/visual-profile/internal/web/assets/index.html`

## Residual Risks
- CPAMC core container must support the `host.auth.delete` host callback when dissolving virtual files; if running an older CPAMC binary without that callback, file deletion will return the descriptive bridge error while preserving safe UI state.

## Verification Inputs
- `npm --prefix plugins/visual-profile/web run test`
- `npm --prefix plugins/visual-profile/web run build`
- `go -C plugins/visual-profile test -v ./internal/plugin/...`
- `go test ./...`

## Next Permitted Action
- Delegate to `03-verify` subagent to audit acceptance criteria and continuity snapshots against `openspec/changes/isolate-virtual-accounts-architecture/plan.md`.
