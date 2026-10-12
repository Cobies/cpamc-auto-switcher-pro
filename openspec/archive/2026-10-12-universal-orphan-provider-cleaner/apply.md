# Apply Summary — Universal Orphan Provider Cleaner

## What Was Implemented
- **Backend** (`plugins/auto-switcher-pro/internal/plugin/maintenance.go`):
  - `OrphanProviderInfo` type + `orphan_providers` field in `ScanResult`, `purged_providers` in `CleanResult`.
  - `scanOrphanConfigProviders(configPath, authDir)` — dynamic, agnostic detection of providers without linked credentials.
  - `extractOpenAICompatBlocks` — indentation-based YAML block parser (provider-level only).
  - `cleanOrphanConfigProviders` — purge with timestamped backup (`config.yaml.bak-pre-clean-<ts>`), structural sanity guards (`firstRootYAMLKey`), and atomic write (`atomicWriteFile`: temp + Sync + rename).
  - `removeOrphanBlocksCleanly` — in-line `openai-compatibility: []` collapse (EOF-safe).
  - `resolveConfigPath` — config discovery with `AUTO_SWITCHER_CONFIG_PATH` override.
  - `scanHealth`/`cleanHealth` wired to the new engine.
- **Frontend** (`plugins/auto-switcher-pro/web/src/components/Maintenance.jsx`):
  - New incident card `incident-orphan-providers` with dynamic table (Provider / Prefix / Models / Diagnóstico) and purge button `btn-clean-orphan-providers`; counted in `totalIncidents`.
- **Tests**:
  - `TestUniversalOrphanProvidersInConfigScanAndClean` — 3-provider fixture (2 orphans, 1 active), backup verification, preservation of unrelated config.
  - `TestCleanOrphanProvidersNeverTruncatesWhenSectionIsLast` — regression: EOF-shaped layout (the real production shape) must keep header and collapse to `[]`.

## Incident Remediation (2026-10-12)
- Restored production `config.yaml` from `config.yaml.bak-pre-clean-20261012-021053` after a crash loop caused by an unvalidated intermediate binary deployed by a parallel session.
- Replaced the parallel session's 20% size-ratio guard (blocked legitimate full purges: real config cleans to ~12%) with structural guards.
- Fixed EOF normalization gap (regex required trailing newline; real config ends at the section).

## Evidence
- `go test ./...` → PASS (all packages).
- Vitest → 378/378 PASS.
- Harness on real production backup copy: 13311 → 1710 bytes; root sections intact; 3 orphans detected and purged (`opencode-go` 22, `nvidia` 79, `nan` 13 models).
- Live: `docker ps` Up; plugins registered; `/v1/models` = 11 (2 pool facades `agy/`, `agy2/` + 9 native Antigravity models).
- Compiled via `scripts/build-plugin.sh amd64` → `bin/`; deployed to `/home/wilox/services/cliproxy/plugins/`; container restarted.

## Files Changed
- `plugins/auto-switcher-pro/internal/plugin/maintenance.go`
- `plugins/auto-switcher-pro/internal/plugin/maintenance_test.go`
- `plugins/auto-switcher-pro/web/src/components/Maintenance.jsx`
- `AGENTS.md` (Universal Orphan Provider Cleaner & config.yaml Safety Contract)
- `openspec/changes/2026-10-12-universal-orphan-provider-cleaner/plan.md`
