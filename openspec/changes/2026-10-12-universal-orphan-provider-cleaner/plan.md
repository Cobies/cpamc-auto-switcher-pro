# Universal Orphan Provider Cleaner (Auto Switcher Pro · Salud & Mant.)

## Workflow Status
- Status: APPLIED (direct execution authorized by user)
- Branch: `feature/universal-orphan-cleaner`

## Goal
Detect and purge, in a 100% dynamic and provider-agnostic way, any entry under `api-keys.openai-compatibility` in CPAMC's `config.yaml` that has no active authentication files in the auth-dir. Removes catalog inflation (247→255 phantom models from 3 orphan providers: opencode-go, nvidia, nan) and prevents recurrence via the Maintenance UI.

## Scope & Exclusions
- Allowed root: `plugins/auto-switcher-pro/**`
- Backend: `internal/plugin/maintenance.go` (+ tests) — scan/clean routes already exist (`/auto-switcher-pro/maintenance/scan|clean`).
- Frontend: `web/src/components/Maintenance.jsx` — new incident card `incident-orphan-providers` with dynamic table (name, prefix, models_count, reason) and purge button.
- Excluded: CPAMC native core, Docker configs, `/root/.cli-proxy-api/*` auth files (read-only reference).

## Design Decisions
1. **Agnostic parser**: `extractOpenAICompatBlocks` parses `openai-compatibility` blocks by indentation (provider-level `- ` entries only; model `- name:` lines never spawn blocks). No provider names are hardcoded — works for any N current or future providers.
2. **Orphan criterion**: no auth file references the provider by `provider`/`type`/`prefix` field or filename match.
3. **Atomic write**: `atomicWriteFile` (temp + Sync + rename) — a crash can never leave a truncated `config.yaml`.
4. **Structural guards**: cleaned result must be non-empty, contain `openai-compatibility`, and preserve the first root key of the original. (A 20% size-ratio guard was rejected: legitimate full purges shrink the real config to ~12%.)
5. **EOF normalization**: `openai-compatibility: []` collapse happens in-line during removal, so it works when the section is the last one in the file.

## Incident Note (2026-10-12)
An intermediate `.so` (deployed 21:06 by a parallel session with the parser mid-implementation) executed `/maintenance/clean` at 21:10:53 and truncated production `config.yaml` to 73 bytes, crash-looping CPAMC on next restart. Remediation: restored from the plugin's own `config.yaml.bak-pre-clean-20261012-021053`; hardened writer + structural guards + EOF regression test added; validated against a copy of the real production config via temp harness (13311 → 1710 bytes, all root sections intact); redeployed and cleaned safely.

## Validation
- `go test ./...` (auto-switcher-pro): PASS, incl. `TestUniversalOrphanProvidersInConfigScanAndClean` and `TestCleanOrphanProvidersNeverTruncatesWhenSectionIsLast`.
- Web suite (vitest): 378 tests PASS.
- Production verification: `/v1/models` 255 → 11 (2 pool facades + 9 native Antigravity models); container `Up`, both plugins registered, no config errors.

## Depends on
- None.
