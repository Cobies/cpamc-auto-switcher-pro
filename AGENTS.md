# Project Agent Operating Rules: cpamc-auto-switcher

## Build & Artifact Sanitation Policy (Mandatory)
1. **No In-Source CGO Builds**: Never run `go build -buildmode=c-shared` directly inside `plugins/` without directing output to `bin/`. Compiling with `-buildmode=c-shared` generates paired `.h` header files that pollute the source tree.
2. **Canonical Build Script**: Always use `scripts/build-plugin.sh [amd64|arm64]` for local or automated plugin compilation. This script directs outputs to `bin/` and cleans any residual header files.
3. **No Sudo / Root Builds**: Never execute build commands under `sudo` or inside unmapped root containers that leave files owned by `root:root`.
4. **Pre-Commit Cleanliness Check**: Before committing or finishing any task, verify that `git status --ignored --short` does not report unexpected untracked or ignored artifacts in source directories (e.g. `*.h`, `*.so`, `*.bak`, `.vite`, `node_modules` in root).

## Diagnostic & Health Engine Compliance
- All health inspection features must be exposed through the native `Maintenance` module (`/auto-switcher-pro/maintenance/scan` and `/clean`).
- Any detected stray build artifacts outside `bin/` must be reported under `orphan_artifacts` and purgeable through the clean action.
