## Workflow Status
- Status: READY
- Blockers: None

# Health Audit — cpamc-auto-switcher (2026-10-11)

## Executive Summary

The project is functionally healthy: **all tests pass** (Go root module 6/6 packages, Go plugin 5/5 packages, React web 375/375 tests across 19 files) and `go vet` is clean. The dominant risk is **repo hygiene, not code quality**: the working tree is mid-rename (`visual-profile` → `auto-switcher-pro`), core deliverables (`extensions/`, `install.sh`, `docs/`) are entirely untracked, 3 commits are unpushed, and the release workflow still carries the old `visual-profile-release` identity. Secondary risks: the Pi extension (`extensions/cpamc-auto-switcher`) has zero tests and no build/test scripts, and the web stack is one full major generation behind (React 18→19, Vite 5→8, Vitest 2→5).

## Research Question

Read-only surgical audit of architecture coherence, code quality, tests, dependencies, config hygiene, documentation drift, dead code, TODO debt, build/test executability, and git hygiene for the repository at `/home/wilox/projects/cpamc-auto-switcher`.

## Recommendation or Answer

Proceed with development after a hygiene pass: (1) commit or intentionally discard the in-flight rename, (2) add `extensions/`, `docs/`, `install.sh` to version control, (3) push the 3 local commits, (4) rename the release workflow group/file, (5) schedule a web dependency major upgrade. No critical code defects were found.

## Key Findings

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| F-01 | ⚠ Warning | Dirty tree mid-rename: 26 modified, 57 staged (rename `plugins/visual-profile` → `plugins/auto-switcher-pro` staged but uncommitted), 42 untracked; branch `main` 3 commits ahead of `origin/main` | `git status --short`, `git log origin/main..main` |
| F-02 | ⚠ Warning | Core deliverables untracked: `extensions/cpamc-auto-switcher/` (the Pi extension itself), `install.sh` (universal installer), `docs/architecture/` (3 docs) — a fresh clone cannot build/install the product | `git status --short` (`?? docs/`, `?? extensions/`, `?? install.sh`) |
| F-03 | ⚠ Warning | Stale identity after rename: workflow file `.github/workflows/visual-profile-release.yml` and concurrency `group: visual-profile-release` (line 12) still use the old plugin name; internal paths were updated to `plugins/auto-switcher-pro` (lines 123–159), so the pipeline works but naming is inconsistent | `.github/workflows/visual-profile-release.yml:12` |
| F-04 | ⚠ Warning | Pi extension has no verification path: `extensions/cpamc-auto-switcher/package.json` declares no `scripts` (no test/build/lint), only `peerDependencies` on `@earendil-works/pi-*` with no lockfile; its 6 TS sources are untested | `extensions/cpamc-auto-switcher/package.json` |
| F-05 | ⚠ Warning | Web dependency staleness (majors behind): react/react-dom 18.3.1 → 19.3.0, vite 5.4.21 → 8.3.4, vitest 2.1.9 → 5.0.3, jsdom 25 → 30, @vitejs/plugin-react 4.7.0 → 6.1.2; `@xyflow/react` has a minor bump (12.11.6 → 12.12.0) | `npm outdated` in `plugins/auto-switcher-pro/web` |
| F-06 | ℹ Info | No CI for tests: the only workflow is a release pipeline; nothing runs `go test` or `vitest` on push/PR | `.github/workflows/` listing |
| F-07 | ℹ Info | No linter configuration anywhere (no golangci-lint, ESLint, or Biome config); `go vet` passes but TS/JS side is unlinted | repo-wide config search |
| F-08 | ℹ Info | Stray artifacts at repo root: empty `node_modules/` directory and untracked `.vite/` cache; both harmless but noisy and not covered by a `node_modules` entry in the root `.gitignore` | `ls node_modules` (empty), `git status` |
| F-09 | ℹ Info | No TODO/FIXME debt and no obvious dead code in Go/TS/JS sources (grep hits for "TODO(S)" were Spanish prose meaning "all") | grep over `cmd internal extensions plugins/.../web/src` |
| F-10 | ℹ Info | Go toolchain pinned at `go 1.22` in both modules; fine if the target environment matches, but 1.22 no longer receives security fixes upstream — consider 1.23+ | `go.mod:3`, `plugins/auto-switcher-pro/go.mod:3` |
| F-11 | ℹ Info | `.gitignore` covers `*.so`/`*.h`/`*.exe`, so the build artifacts in `bin/` (`auto-switcher-pro-linux-amd64.so`) are correctly protected from accidental commit | `.gitignore`, `git ls-files` |

## Evidence Review

- **Build/test executability**: `go test ./...` passes in both Go modules (11 packages total, cached results consistent with a prior green run); `go vet ./...` reports no issues on the root module. Vitest: **19 files / 375 tests, all passing** (40.5s) [S-003][S-004].
- **Test coverage by test-file ratio** (root module): ~2,277 LOC of tests vs ~2,532 LOC of implementation — a strong ratio for the Go core [S-002].
- **Architecture coherence**: three coherent layers — Go CLI (`cmd/` + `internal/`, zero third-party deps), Pi TS extension (`extensions/`), Go plugin + embedded React SPA (`plugins/auto-switcher-pro`). Openspec change history (`openspec/changes/auto-update-console-on-boot/`) shows disciplined plan/apply/verify workflow [S-002].
- **Config hygiene**: both `go.mod` files are dependency-free stdlib-only modules — zero Go supply-chain surface [S-005].
- **Documentation drift**: root `README.md`, `extensions/.../README.md` (91 lines), and `plugins/auto-switcher-pro/README.md` (113 lines) differ in head content but consistently describe current prefixes/pools behavior; the residual drift is in the CI workflow naming (F-03), not the prose docs. Stale "visual-profile" matches remain only in archived openspec change records, which is legitimate history [S-006].
- Renamed `plugins/visual-profile` → `plugins/auto-switcher-pro` is staged with `R` status entries; `RM` entries show post-rename modifications not yet staged, i.e., the commit boundary is half-prepared [S-001].

## Trade-offs and Risks

- **F-01/F-02 combined** mean a local disk loss would destroy the extension source, installer, docs, and 3 commits of work — the single largest exposure despite zero code defects (HIGH impact, MEDIUM probability).
- Upgrading React 19 / Vite 8 / Vitest 5 (F-05) is a coordinated major bump; `@xyflow/react` 12 compatibility with React 19 must be verified before upgrading. Staying put is viable short-term; Vite 5.x still receives patch releases (5.4.21 installed).
- Extension untestability (F-04) is structural — peer deps on a running Pi host — but a minimal `tsc --noEmit` script and smoke harness would close most of the gap.

## Alternatives Considered

- Running `npm audit` / full vulnerability scan: not performed (network-heavier, and Go side has no deps; web audit can be folded into the F-05 upgrade).
- Transpiling the TS extension to verify it compiles: skipped — peer dependencies (`@earendil-works/pi-*`) are not installed, so a typecheck would fail on missing modules, not on real defects (recorded as limitation).

## Unknowns and Limits

- TypeScript extension compile-correctness unverified (peer deps absent; no lockfile).
- Git worktree state will change; findings F-01–F-03 are a snapshot at 2026-10-11 ~02:55 local.
- `install.sh` was read but not executed (mutates user environment by design).
- Test results for Go came partially from cache; counts (`ok` per package) confirm pass status but timings are cached.
- Whether Vite 5.x patch support continues is a vendor decision outside this audit's evidence base.

## Recommended Next Actions

1. **(Critical-path hygiene)** Decide the rename commit boundary: stage the remaining `RM` modifications, commit, and push the 3 commits to `origin/main`.
2. `git add extensions/ docs/ install.sh` and commit — the product's installer and extension must be versioned.
3. Rename `.github/workflows/visual-profile-release.yml` → `auto-switcher-pro-release.yml` and update `group:` accordingly (keep the change README-documented).
4. Add minimal `test`/`typecheck` scripts to the extension `package.json`; add a push/PR CI job running `go test ./... ./plugins/...` and `vitest run`.
5. Schedule the web major upgrade (React 19 + Vite 8 + Vitest 5) as its own openspec change with a compatibility spike for `@xyflow/react`.
6. Add `node_modules/` and `.vite/` to the root `.gitignore` for noise reduction.
