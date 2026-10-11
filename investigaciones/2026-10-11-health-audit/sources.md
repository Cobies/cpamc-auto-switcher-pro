# Sources

## Source Index

### S-001: Git working tree and branch state
- Family: IMPLEMENTATION
- URL or locator: `git status --short`, `git log --oneline origin/main..main`, `git ls-files` in /home/wilox/projects/cpamc-auto-switcher
- Date/version: snapshot 2026-10-11 ~02:55 local; HEAD e782b3c
- Access method: `bash` (read-only git commands only)
- Used for: F-01, F-02, F-08, F-11
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: No mutating git commands run. Counts: 26 modified, 57 staged (rename entries R/RM), 42 untracked; main 3 ahead of origin/main.

### S-002: Repository file inventory and source tree
- Family: IMPLEMENTATION
- URL or locator: `find` excluding node_modules, "pi extensions", .git; `wc -l internal/*/*.go cmd/...`
- Date/version: working tree, 2026-10-11
- Access method: `bash`
- Used for: architecture coherence, test-ratio observation, F-09 scope
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Root module ~4,809 LOC across cmd+internal with near-1:1 test/impl ratio.

### S-003: Go build/vet/test results (root and plugin modules)
- Family: IMPLEMENTATION
- URL or locator: `go vet ./...`, `go test ./...` (root); `go build ./...`, `go test ./...` (plugins/auto-switcher-pro)
- Date/version: go.mod `go 1.22`, executed 2026-10-11
- Access method: `bash` (read-only; writes only to Go build cache outside repo)
- Used for: Executive Summary, Evidence Review (test executability), F-10
- Usefulness: MATERIAL
- Confidence impact: MEDIUM (results marked "cached"; pass status is authoritative but run timings are not fresh)
- Notes: Root: 6/6 packages ok; plugin: 5/5 packages ok; vet clean.

### S-004: Vitest run of web SPA
- Family: IMPLEMENTATION
- URL or locator: `npx vitest run` in plugins/auto-switcher-pro/web
- Date/version: vitest 2.1.9, executed 2026-10-11
- Access method: `bash`
- Used for: Executive Summary, Evidence Review
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: 19 test files, 375 tests, all passed, 40.52s. Writes only to untracked `.vite/` cache dir.

### S-005: Module and package manifests
- Family: PRIMARY
- URL or locator: `go.mod`, `plugins/auto-switcher-pro/go.mod`, `plugins/auto-switcher-pro/web/package.json`, `extensions/cpamc-auto-switcher/package.json`, `.gitignore`
- Date/version: working tree, 2026-10-11
- Access method: `read`/`bash cat`
- Used for: F-04, F-08, F-10, F-11, dependency surface analysis
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Both Go modules are stdlib-only (no require directives). Extension has no scripts and no lockfile.

### S-006: Rename drift and documentation checks
- Family: IMPLEMENTATION
- URL or locator: grep for "visual-profile|auto-switcher-pro" across .md/.yml/.json/.go; `.github/workflows/visual-profile-release.yml:12,123-159`; README.md diffs
- Date/version: working tree, 2026-10-11
- Access method: `bash`
- Used for: F-03, documentation drift assessment
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: "visual-profile" matches outside the workflow exist only in openspec archive records (legitimate history). Workflow paths already updated to auto-switcher-pro; only file name and concurrency group are stale.

### S-007: npm outdated for web dependencies
- Family: PRIMARY (registry metadata)
- URL or locator: `npm outdated` in plugins/auto-switcher-pro/web
- Date/version: registry query 2026-10-11
- Access method: `bash` (read-only)
- Used for: F-05, Trade-offs
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Wanted columns at current pins; majors behind: react 19.3.0, vite 8.3.4, vitest 5.0.3, jsdom 30.1.2, @vitejs/plugin-react 6.1.2.

### S-008: TODO/FIXME/dead-code grep
- Family: IMPLEMENTATION
- URL or locator: grep `-rn "TODO|FIXME|XXX|HACK"` over cmd, internal, extensions, plugins/auto-switcher-pro/{internal,web/src}
- Date/version: working tree, 2026-10-11
- Access method: `bash`
- Used for: F-09
- Usefulness: SUPPORTING
- Confidence impact: MEDIUM
- Notes: All hits were Spanish comments containing "TODOS" (= "all"), not debt markers. Dead code assessed by inspection only; no coverage tooling run.

### S-009: install.sh content review
- Family: IMPLEMENTATION
- URL or locator: /home/wilox/projects/cpamc-auto-switcher/install.sh (head -30)
- Date/version: working tree (untracked file), 2026-10-11
- Access method: `bash`
- Used for: F-02 context; confirms install.sh is the product's universal installer and depends on extensions/
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Read only; not executed (it compiles/installs into user environment by design).
