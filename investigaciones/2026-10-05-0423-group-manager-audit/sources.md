# Sources

## Source Index

### S-001: GroupManager React Component Implementation
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/web/src/components/GroupManager.jsx`
- Date/version: v1.0.13-dynamic-subtypes (2026-10-04)
- Access method: local file read
- Used for: Analysis of state management, hint texts, capacity calculations, policy checkboxes, prefix collision rules, and group save orchestration.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Direct primary codebase file controlling the "Estructuración de Grupo & Pool" workflow and UI state.

### S-002: GroupManager Unit and Integration Test Suite
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/web/src/components/GroupManager.test.jsx`
- Date/version: Vitest test suite (2026-10-04)
- Access method: local file read
- Used for: Verification of test coverage for subtypes (`sonnet`, `opus`), model policy checkboxes, and pool dissolution safety boundaries.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Contains unit tests validating UI behavior, mock virtualization requests, and cascade preview logic.

### S-003: Backend Virtualization Engine (Go Plugin)
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/internal/plugin/virtualize.go`
- Date/version: Go plugin visual-profile (2026-10-04)
- Access method: local file read
- Used for: Examination of `Virtualize`, `computeVirtualExclusions`, pattern matching, and credential cloning mechanisms via host bridge.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demonstrates that model exclusions (`excluded_models`) are strictly managed in this Go handler and are not applied by standard auth-file patch calls.

### S-004: Management API Client
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/web/src/api/managementClient.js`
- Date/version: Management API Client v1.0 (2026-10-04)
- Access method: local file read
- Used for: Audit of `saveAuthFilePrefixes`, `patchAuthFilePrefix`, and `virtualizeAccount` network contracts and payloads.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirms that `patchAuthFilePrefix` only transmits `{ name, prefix }` to `/v0/management/auth-files`, omitting model exclusion lists.

### S-005: ControlSwitcher Component and Quota Routing Engine
- Family: IMPLEMENTATION
- URL or locator: `plugins/visual-profile/web/src/components/ControlSwitcher.jsx`
- Date/version: ControlSwitcher v1.0 (2026-10-04)
- Access method: local file read
- Used for: Verifying dynamic discovery of `agy_son*`, `agy_opus*`, `agy_clau*`, and quota isolation boundaries.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Validates ecosystem naming conventions, target model badges, and quota parsing for Antigravity, Claude, and Codex.

### S-006: Engram Observation 1639: Compaction Recovery and Pool Architecture
- Family: IMPLEMENTATION
- URL or locator: `mem:1639`
- Date/version: 2026-10-04
- Access method: `mem_search`
- Used for: Historical context on splitting `agy_clau` into `agy_son` and `agy_opus`, prefix naming invariants, and architectural decisions.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Explains the architectural motivation behind specialized Claude pools in CPAMC CLIProxyAPI.
