## Workflow Status
- Status: READY
- Blockers: None

## Execution Scope
- Root: /home/wilox/projects/cpamc-auto-switcher
- Allowed Paths:
  - /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/**
- Writable Paths:
  - /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/**
- Allowed Bash:
  - npm --prefix plugins/visual-profile/web run test
  - npm --prefix plugins/visual-profile/web run build
  - go test ./...
- Notes: Scope restricted to plugins/visual-profile web frontend and Go plugin backend. No changes outside visual-profile or to external CPAMC core binaries.

## 1. Goal
Design and implement the architectural separation between physical OAuth master accounts and derived virtual pool cards in CPAMC and Auto Switcher Pro. CPAMC core represents physical OAuth identities (4 master accounts, expandable to N), while the Auto Switcher Pro dedicated view ("Auto Auth Files") manages the derived pool cards ($2N$ managed cards: $N$ Gemini + $N$ Claude, currently 8 cards, expandable to 10 for 5 masters). GroupManager feeds directly from these managed cards to construct and dissolve pools without generating orphan clone sprawl or duplicate dropdown entries, while strictly preserving live routing under `/v1/models` (`agy`, `agy_1`, `agy2`, `agy2_1`, `agy_son`, `agy_son_1`, `agy_opus`, `agy_opus_1`).

## 2. Scope & Exclusions
- **In Scope**:
  - `plugins/visual-profile/web/src/api/managementClient.js`: Card model registry abstraction (`buildManagedPoolCards`), deterministic card identity, master-to-virtual derivation, and orphan detection.
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`: Dedicated 2N managed card view (4 Gemini + 4 Claude for 4 masters) with origin traceability, exclusion badges, and clean lifecycle management.
  - `plugins/visual-profile/web/src/components/GroupManager.jsx`: Candidate dropdowns feeding directly from the Auto Auth Files card registry by family, preventing clone sprawl and duplicate options during pool assembly and dissolution.
  - `plugins/visual-profile/internal/plugin/virtualize.go`: Backend virtualization idempotency, deterministic file naming, and model exclusion enforcement to protect live routing under `/v1/models`.
  - Associated Vitest tests (`AutoAuthFiles.test.jsx`, `GroupManager.test.jsx`) and Go unit tests (`virtualize_test.go`).
- **Exclusions**:
  - Direct modifications to CPAMC core engine or Docker container runtime outside the plugin C-ABI interface.
  - Telemetry pipeline modifications in `PulseTokens.jsx`.
  - Unrelated visual styling changes in `ProfileGraph.jsx`.

## 3. Execution Scope
*(Defined in canonical Execution Scope block above)*

## 4. Planned Workflow (MINI Items)

### MINI-001: Scalable $N \rightarrow 2N$ Managed Card Model Data Layer
- **Contract**: Implement `buildManagedPoolCards(nodes)` in `plugins/visual-profile/web/src/api/managementClient.js` that deterministically maps each physical OAuth master account into exactly 2 managed pool cards:
  1. **Gemini Card**: Role `gemini`, default prefix hint `agy`, targeted to Gemini models (`gemini-2.5-pro`, `flash`, etc.), excluding Claude/GPT models.
  2. **Claude Card**: Role `claude`, default prefix hint `agy_son` / `agy_opus`, targeted to Claude models (`claude-sonnet-4-6`, `claude-sonnet-5-5-high`, `claude-opus-4-6-thinking`), excluding Gemini models.
  - For $N=4$ masters, outputs exactly 8 cards; for $N=5$, outputs 10 cards ($2N$ scalability).
  - Each managed card maintains deterministic attributes: `cardId`, `masterFileName`, `maskedEmail`, `familyRole` (`'gemini'` | `'claude'`), `assignedPrefix`, `poolRole` (`'leader'` | `'reserve'` | `'unassigned'`), `activePoolBase`, `exclusionBadges`, and `virtualFileName`.
  - Strictly preserves VP-7 email and identifier masking invariants.
- **Acceptance**:
  - Given 4 physical master nodes, `buildManagedPoolCards` generates exactly 8 managed cards (4 Gemini + 4 Claude).
  - When an account already has an active virtual credential on disk (e.g. `.agy_son.json`), its card reflects the active prefix, pool role, and exclusion badges rather than creating a duplicate card.
  - If a 5th master node is added, exactly 10 cards are generated without manual schema migrations.
  - Existing helper `classifyAuthAccount` remains compatible, identifying master origin and virtual classification.
- **Canonical sources**:
  - `plugins/visual-profile/web/src/api/managementClient.js`
- **Validation**:
  - Vitest unit tests in `plugins/visual-profile/web/src/api/managementClient.test.js` or dedicated card model tests verifying $N \rightarrow 2N$ card derivation with 4 and 5 master inputs.
- **Depends on**: None

### MINI-002: Auto Auth Files Card Registry & Traceability View
- **Contract**: Refactor `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx` to render Wilox's scalable $2N$ managed card model:
  - Top metrics ribbon clearly separates:
    - **Physical Masters (OAuth)**: $N$ accounts (e.g. 4 físicas).
    - **Managed Pool Cards**: $2N$ cards (e.g. 8 gestionadas: 4 Gemini + 4 Claude).
    - **Active in Pools**: Count of cards assigned to live routing prefixes.
    - **Orphan / Clones Residuales**: Count of unlinked, obsolete clone files on disk.
  - Two structured sections / tabs:
    - **Panel de Cards Gestionadas**: Visual grid of the $2N$ cards displaying role badges (Gemini vs Claude), master origin link (`🔗 Origen: [maskedEmail]`), assigned prefix (`[agy]`, `[agy_son]`), pool status (Líder / Reserva / Libre), and model exclusion tags.
    - **Panel de Cuentas Maestras (OAuth Core)**: Summary list of the $N$ physical identities recognized by CPAMC core.
  - One-click actions: sync managed cards, dissolve individual cards back to unassigned state, and batch-purge true orphan files.
- **Acceptance**:
  - Component renders 8 managed cards when 4 master accounts are present.
  - Each card explicitly indicates its family specialization (Gemini vs Claude) and master origin email.
  - Deleting/dissolving a virtual card removes the virtual file from disk without corrupting the underlying master account.
  - Orphan banner only flags files that do not correspond to the valid $2N$ managed card schema.
- **Canonical sources**:
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`
  - `plugins/visual-profile/web/src/components/AutoAuthFiles.css`
- **Validation**:
  - `npm --prefix plugins/visual-profile/web run test -- -t "AutoAuthFiles"`
- **Depends on**: MINI-001

### MINI-003: GroupManager Integration with Managed Cards Registry
- **Contract**: Update `plugins/visual-profile/web/src/components/GroupManager.jsx` so candidate selection for both Leader ("Cuenta Principal") and Reserves feeds directly from the managed pool cards registry (`buildManagedPoolCards`):
  - When selecting family `gemini` (`gemini_pure`):
    - Candidate list displays strictly the $N$ Gemini cards.
    - Claude cards are completely hidden from Gemini candidate lists.
  - When selecting Claude (`gemini_sonnet`, `gemini_opus`, `gemini_claude`):
    - Candidate list displays strictly the $N$ Claude cards.
    - Gemini cards are completely hidden from Claude candidate lists.
  - Eliminates duplicate entries and "copia" clones in dropdowns: exactly 1 entry per physical account per family.
  - Pool assembly: assigns routing prefixes to the pre-existing/managed cards. If the card's virtual file does not yet exist on disk, it virtualizes it using deterministic naming (`<master>.<prefix>.json`), preventing unbounded clone sprawl.
  - Pool dissolution: disolves the pool by either clearing the prefix or safely deleting the virtual credential, returning the managed card to `'unassigned'` status without leaving ghost clones.
- **Acceptance**:
  - For 4 master accounts, Gemini dropdown shows exactly 4 candidates (no duplicate emails, no Claude cards).
  - Claude dropdown shows exactly 4 candidates (no duplicate emails, no Gemini cards).
  - Assembling a pool (`agy_son` + reserves) updates/creates only the deterministic virtual files for the selected cards.
  - Dissolving a pool frees all cards without leaving dangling unlinked files in Auto Auth Files.
- **Canonical sources**:
  - `plugins/visual-profile/web/src/components/GroupManager.jsx`
- **Validation**:
  - `npm --prefix plugins/visual-profile/web run test -- -t "GroupManager"`
- **Depends on**: MINI-001, MINI-002

### MINI-004: Backend Plugin Virtualization Idempotency & Live Routing Guard
- **Contract**: Harden `plugins/visual-profile/internal/plugin/virtualize.go` to guarantee idempotency and routing preservation:
  - `deriveVirtualName(source, prefix)` ensures consistent file naming. If a virtual file for the same master and family role already exists, `Virtualize` safely updates its metadata (prefix + exclusions) rather than failing or spawning duplicate files.
  - Model exclusion computation guarantees strict family isolation:
    - Gemini pool credentials (`agy*`) exclude Claude (`claude-*`) and GPT models.
    - Claude pool credentials (`agy_son*`, `agy_opus*`) exclude Gemini (`gemini-*`) models.
  - Live routing integrity: verifies that virtual credentials preserve valid OAuth refresh tokens inherited from the host master account, allowing CPAMC to serve requests under `/v1/models` (`agy`, `agy_1`, `agy2`, `agy2_1`, `agy_son`, `agy_son_1`, `agy_opus`, `agy_opus_1`) without auth errors or quota cross-depletion.
- **Acceptance**:
  - Calling `Virtualize` repeatedly with the same source and prefix is idempotent and returns OK.
  - Generated credential JSON contains the exact target prefix and correct `excluded_models` array.
  - Deleting a virtual credential via `DeleteVirtual` physically removes the clone file while leaving the source master file intact.
- **Canonical sources**:
  - `plugins/visual-profile/internal/plugin/virtualize.go`
  - `plugins/visual-profile/internal/plugin/virtualize_test.go`
- **Validation**:
  - `go test -v ./plugins/visual-profile/internal/plugin/...`
- **Depends on**: None

### MINI-005: Full Verification & Ecosystem Integration Suite
- **Contract**: Execute comprehensive end-to-end regression testing across frontend Vitest suites, Go plugin tests, and production build checks:
  - Run all Vitest test suites (covering `AutoAuthFiles`, `GroupManager`, `ControlSwitcher`, `PrefixManager`, `ConventionValidation`).
  - Run all Go package unit tests (`go test ./...`).
  - Run frontend asset build (`npm run build`) to generate the bundled distribution in `internal/web/assets/`.
  - Validate that zero regressions occur in existing quota gauges, routing prefix conventions, or model filtering.
- **Acceptance**:
  - All web tests pass (0 failures).
  - All Go tests pass (0 failures).
  - Web asset build succeeds with no bundling or circular dependency errors.
- **Canonical sources**:
  - Entire `plugins/visual-profile/**` workspace
- **Validation**:
  - `npm --prefix plugins/visual-profile/web run test`
  - `npm --prefix plugins/visual-profile/web run build`
  - `go test ./...`
- **Depends on**: MINI-001, MINI-002, MINI-003, MINI-004

## 5. Risks & Constraints
- **Live Routing Disruption**: Modifying virtual file metadata must never corrupt the physical master file's OAuth refresh tokens or break existing prefix routing in `/v1/models`.
- **Ecosystem Consistency**: CPAMC core lists files on disk; ensuring Auto Switcher Pro cleanly distinguishes the $N$ physical masters from the derived $2N$ managed cards prevents user confusion and administrative errors.
- **Privacy Compliance**: Strictly uphold VP-7 privacy invariants — never display full unmasked email addresses or expose OAuth credential secrets in UI state or logs.

## 6. Open Decisions
- None. Requirements, scalability model ($N \rightarrow 2N$), routing conventions, and isolation boundaries are fully approved and specified.

## 7. Next Permitted Action
- Delegate to `02-apply` subagent to begin TDD implementation starting with MINI-001 (`buildManagedPoolCards` data layer).
