# Verify — unify-pool-governance-and-hide-reserves

**Verification Result: PASS** — verified directly by orchestrator under explicit user direct-execution authorization (no delegation override active for this session).

## Date
2026-10-11

## MINI Coverage

### MINI-001/002: Specialist-only pool creation (GroupManager.jsx) — PASS
- Wildcard "disable isolation" mode removed; `data-testid="select-specialist-model"` enforces 1 Pool = 1 Specialist Model.
- `handleCreateGroup` computes `target_models: [selectedSpecialistModel]` and `oppositeModels` = rest of Antigravity family; patches auth files at birth.
- Evidence: `GroupManager.test.jsx` 31/31 green, including rewritten test `enforces specialist model selection (1 Pool = 1 Specialist Model) and computes opposite models as excluded` asserting `policy.target_models === ['claude-sonnet-4-6']`, `disable_isolation === false`, and per-family exclusions in the disk patch.

### MINI-003: Frontend suite regression — PASS
- Full Vitest suite: **19 files, 378/378 tests passed** (including `SpecialistModal.test.jsx` 13/13 with allow-all option removed, `AutoAuthFiles.test.jsx` 18/18).
- `./run.sh hygiene`: 0 residues outside `bin/`.

### MINI-004: Go backend prefix-free reserves — PASS
- `go test ./internal/plugin/...` (and full module) green.
- Registry-only reserves receive no disk `_N` prefixes; `modelCatalogForAuth` publishes the pool-prefixed virtual route only for registry-only members; disk-backed leaders expose the bare specialist model.

## Live Deployment Evidence (host 192.168.10.150:8317)

Build pipeline: Vite `npm run build` → `internal/web/assets/index.html` embedded → `./run.sh build` → copied to `/home/wilox/services/cliproxy/plugins/` → `docker restart cli-proxy-api`.

- Served UI asset contains `select-specialist-model`; `checkbox-disable-isolation` absent.
- **N = 0**: `/v1/models` returned 253 native models, 0 pool facades; pools endpoint `count: 0`.
- **N ≥ 1 (pool `agy`, specialist `gemini-3.8-flash-high`)**:
  - Registry: `count: 1`, leader `antigravity-infosoytec@gmail.com.json`, reserve `antigravity-infowilsonlavio@gmail.com.json`, targets `['gemini-3.8-flash-high']`, 8 excluded family models.
  - Disk: leader has `prefix: "agy"` + 8 exclusions; reserve has 8 exclusions and **no prefix** (Invariant #5 — no `agy_1` facade exists).
  - `/v1/models` exposes exactly **1 facade route**: `agy/gemini-3.8-flash-high`.
  - Real request `POST /v1/chat/completions` with model `agy/gemini-3.8-flash-high` → 200 OK ("pong!").

## Continuity Snapshot (pre-archive)
- `git status`: only the 6 verified modified files + `openspec/changes/` untracked; no drift since verification.
- GroupManager suite re-run: 31/31 green. Go plugin tests: green. Hygiene: clean.

## Pure Virtual Governance Addendum (Post-Verification Update)
- **Elimination of Disk Mutilation**: Writing physical `excluded_models` on disk was eliminated in `GroupManager.jsx`. Pool specialist isolation operates 100% through the plugin registry (`policy.target_models`), `model.route`, and `scheduler.pick`.
- **CPAMC Native Credential Inspection**: Preserves all 10 native provider models in `GET /v8/management/credentials/models` without truncating cards in CPAMC native "Auth Files Management".
- **Pi /v1/models Routing**: Continues exposing strictly the active virtual facades (e.g. `agy/gemini-3.8-flash-high`, `agy2/gemini-3.8-flash-high`) with zero reserve accounts visible.
- Full Vitest suite: 378/378 passed. Go plugin test suite: 100% green. Live chat verification: 200 OK.

