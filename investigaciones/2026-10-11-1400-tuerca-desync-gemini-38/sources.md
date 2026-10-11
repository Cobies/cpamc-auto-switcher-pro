# Sources

## Source Index

### S-001: UI Screenshot 1 - AutoAuthFiles Managed Cards View
- Family: PRIMARY
- URL or locator: `/srv/share/Captura de pantalla 2026-10-11 135122.png`
- Date/version: 2026-10-11 13:51
- Access method: `read` (multimodal image inspect)
- Used for: Evidence of card banner rendering `✨ MODELO PREDETERMINADO (MULTIPROPÓSITO)` and `gemini-3.8-flash-high` across all 4 managed cards
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Visual confirmation of Card 1 (`mar...tro@gmail.com`), Card 2 (`wil...o11@gmail.com`), Card 3 (`inf...tec@gmail.com`), Card 4 (`inf...vio@gmail.com`).

### S-002: UI Screenshot 2 - SpecialistModal (Tuerca de Trabajo ⚙️) Dialog
- Family: PRIMARY
- URL or locator: `/srv/share/Captura de pantalla 2026-10-11 135116.png`
- Date/version: 2026-10-11 13:51
- Access method: `read` (multimodal image inspect)
- Used for: Evidence of SpecialistModal opening with `Permitir todos los modelos (Sin restricciones)` selected and `gemini-3.8-flash-high` unselected
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Displays Account: `mar...tro@gmail.com`, File: `antigravity-mar...tro@gmail.com.json`, Family: `GEMINI`, 9 models in family, radio checked on Option 1 (Abierto), Option 2 (`gemini-3.8-flash-high`) unchecked.

### S-003: AutoAuthFiles Component Source Code
- Family: IMPLEMENTATION
- URL or locator: `plugins/auto-switcher-pro/web/src/components/AutoAuthFiles.jsx`
- Date/version: commit 4f13679812cd28e83823bfda98fc00842149f7fc / HEAD
- Access method: `read` / `bash`
- Used for: Root cause diagnosis in `renderHeroBanner` (lines 389-402) and invocation with `defaultModel` (lines 951-965)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Shows that `specState.isSpecialist` evaluates to false, causing `renderHeroBanner` to inject `defaultModel` (`'gemini-3.8-flash-high'`) into `.hero-model-name`.

### S-004: SpecialistModal Component Source Code
- Family: IMPLEMENTATION
- URL or locator: `plugins/auto-switcher-pro/web/src/components/SpecialistModal.jsx`
- Date/version: commit 4f13679812cd28e83823bfda98fc00842149f7fc / HEAD
- Access method: `read` / `bash`
- Used for: Root cause diagnosis in modal state initialization (lines 56-70) and radio selection check (lines 230-295)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Detects `detectSpecialistState(card, inheritedModels)`. When not specialist, defaults `mode = 'all'`, keeping radio buttons for individual models unselected.

### S-005: Management Client API Library
- Family: IMPLEMENTATION
- URL or locator: `plugins/auto-switcher-pro/web/src/api/managementClient.js`
- Date/version: commit 4f13679812cd28e83823bfda98fc00842149f7fc / HEAD
- Access method: `bash` grep/sed
- Used for: Implementation of `detectSpecialistState` (lines 1855-1885), `resolveInheritedCardModels` (lines 1664-1748), and `patchAuthFileExclusions` (lines 1764-1845)
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: `detectSpecialistState` returns `isSpecialist: true` only if `activeModels.length === 1`. An empty `excluded_models` array yields `isSpecialist: false`.

### S-006: Runtime Physical Auth Credentials in CPAMC Docker Container
- Family: PRIMARY
- URL or locator: `docker:cli-proxy-api:/root/.cli-proxy-api/*.json`
- Date/version: 2026-10-12 02:34 runtime state
- Access method: `bash` (`docker exec cli-proxy-api cat ... | jq`)
- Used for: Verification of physical account state on disk
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirms that all 4 active JSON credentials (`antigravity-maribelluzbonitaaquinocastro@gmail.com.json`, `wilsonlavio11`, `infosoytec`, `infowilsonlavio`) have `excluded_models: []`. None are specialists on disk.

### S-007: Git Commit 4f13679812cd28e83823bfda98fc00842149f7fc
- Family: IMPLEMENTATION
- URL or locator: `git show 4f13679`
- Date/version: 2026-10-11 13:37:21 -0500
- Access method: `bash`
- Used for: Commit history analysis of how `SpecialistModal.jsx` and `AutoAuthFiles.jsx` drifted
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Changed `SpecialistModal.jsx` from hardcoded `mode: 'single'` (which gave false appearance of being locked to 3.8) to honest `mode: 'all'`, while simultaneously changing `defaultModel` in `AutoAuthFiles.jsx` to `gemini-3.8-flash-high`.

### S-008: OpenSpec Specification for Hero Specialist and Quota Telemetry
- Family: PRIMARY
- URL or locator: `openspec/archive/2026-10-09-auto-auth-files-hero-specialist-and-quota-telemetry/plan.md`
- Date/version: 2026-10-09
- Access method: `read` / `bash`
- Used for: Contract MINI-002 specification defining the multipurpose and specialist hero banner
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Established the requirement that multipurpose cards render a default active model for the family with label `✨ MODELO PREDETERMINADO (MULTIPROPÓSITO)`.

### S-009: Vitest Unit & Acceptance Test Suites
- Family: IMPLEMENTATION
- URL or locator: `plugins/auto-switcher-pro/web/src/components/SpecialistModal.test.jsx` & `AutoAuthFiles.test.jsx`
- Date/version: 2026-10-11 HEAD
- Access method: `bash` (`npm test`)
- Used for: Validation that both components pass their unit tests (30/30 passed) and examination of expected behavior
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Tests explicitly verify that multipurpose mode renders `badge-multipurpose-default` with the default model, and that SpecialistModal opens in allow-all mode when `excluded_models` is empty.

### S-010: Engram Memory Architecture Observation 1942
- Family: IMPLEMENTATION
- URL or locator: `mem:1942` (topic: `cpamc-tuerca-pools-model-architecture`)
- Date/version: 2026-10-11 06:57:39
- Access method: `mem_get_observation`
- Used for: Architectural intent of Tuerca ⚙️ (Role 1: Permitir todos vs Limitar a un solo modelo)
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Confirms that Tuerca ⚙️ was designed with two deliberate states: 'Permitir todos' (🔓 9 models pass) or 'Limitar a un solo modelo' (🔒 1 model passes).
