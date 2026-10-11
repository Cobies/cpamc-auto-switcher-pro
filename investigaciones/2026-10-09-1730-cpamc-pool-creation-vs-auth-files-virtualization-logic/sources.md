# Sources

## Source Index

### S-001: Go Plugin Virtualization Core (`internal/plugin/virtualize.go`)
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/internal/plugin/virtualize.go`
- Date/version: 2026-10-09 (Current codebase)
- Access method: Direct file read
- Used for: Technical analysis of `Virtualize()`, `host.auth.save` invocation, deterministic file naming `<source>.<prefix>.json`, and model exclusion calculation (`computeVirtualExclusions`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirms that virtualizing an account executes `host.auth.save`, which instructs CPAMC host to write a new `.json` file to `/root/.cli-proxy-api/` on disk.

### S-002: Management Client API (`web/src/api/managementClient.js`)
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/web/src/api/managementClient.js`
- Date/version: 2026-10-09 (Current codebase)
- Access method: Direct file read
- Used for: Analysis of `virtualizeAccount`, 2N Managed Cards builder `buildManagedPoolCards`, `classifyAuthAccount`, `extractVirtualOrigin`, and `deleteAuthFile`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Defines the $N \to 2N$ card abstraction mapping physical masters and virtual derived files in-memory and handles API operations with CPAMC endpoints.

### S-003: Group Manager Component (`web/src/components/GroupManager.jsx`)
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/web/src/components/GroupManager.jsx`
- Date/version: 2026-10-09 (Current codebase)
- Access method: Direct file read
- Used for: Analysis of candidate selection (`leaderCandidates`, `reserveCandidates`), pool creation handler (`handleCreateGroup`), `isVirtualSource` logic, `virtualJobs` dispatcher, and pool dissolution (`handleDissolvePool`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Identifies the architectural root cause: `isVirtualSource` evaluates to `true` for all non-Gemini pool creations, forcing `virtualizeAccount` even when an existing virtual file could be updated via `PATCH`.

### S-004: Auto Auth Files Dashboard (`web/src/components/AutoAuthFiles.jsx`)
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/web/src/components/AutoAuthFiles.jsx`
- Date/version: 2026-10-09 (Current codebase)
- Access method: Direct file read
- Used for: Analysis of 2N managed cards dashboard, metrics display ($N$ physical masters, $N$ virtual cards), individual virtual clone dissolution, and orphan clone detection (`metric-orphan-clones`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demonstrates how Auto Switcher Pro presents the 2N card model cleanly to the user and manages virtual file deletion from disk.

### S-005: Feasibility Report on Multi-Prefix Virtualization (Mechanism A)
- Family: PRIMARY
- URL or locator: `investigaciones/2026-10-04-0435-viabilidad-multiprefix-plugin/report.md`
- Date/version: 2026-10-04
- Access method: Direct file read
- Used for: Historical architecture background on why Mechanism A (server-side `.json` cloning on disk via `host.auth.save`) was originally chosen over in-memory or core-modifying approaches.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Explains that CPAMC core relies on disk file scanning (`fsnotify`) to instantiate routing prefixes and exclusion lists.

### S-006: Architecture Report on CPAMC Auth Files & Auto Switcher Pool Architecture
- Family: PRIMARY
- URL or locator: `investigaciones/2026-10-09-1500-cpamc-auth-files-auto-switcher-pool-architecture/report.md`
- Date/version: 2026-10-09
- Access method: Direct file read
- Used for: Reference on physical master vs virtual account separation, $N \to 2N$ card model, and quota isolation principles.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Contextualized the $N \to 2N$ model mapping Antigravity master accounts across Gemini and Claude pools.

### S-007: Engram Memory Observations (#1888, #1900, #1901)
- Family: IMPLEMENTATION
- URL or locator: `mem:<observation_id>` (Engram memory records #1888, #1900, #1901)
- Date/version: 2026-10-09
- Access method: Engram tool (`mem_search`)
- Used for: Historical Context on 12-file disk accumulation incident, manual purge down to 8 cards, and decision record establishing the deterministic 2N card model.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Confirmed Wilox's previous findings regarding disk file accumulation when pool creation invoked redundant virtualizations.

### S-008: Native CPAMC Auth Loader (`cmd/cli-proxy-api`)
- Family: PRIMARY
- URL or locator: `/root/.cli-proxy-api/*.json` raw disk listing endpoint (`GET /v0/management/auth-files`)
- Date/version: 2026-10-09
- Access method: Code/System context analysis
- Used for: Verification of CPAMC native disk scanning behavior (`fsnotify` + `readdir`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Establishes that native CPAMC reads all `.json` files in `/root/.cli-proxy-api/` indiscriminately as physical auth entries.
