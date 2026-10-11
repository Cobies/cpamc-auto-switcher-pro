# Project Agent Operating Rules: cpamc-auto-switcher

## Build & Artifact Sanitation Policy (Mandatory)
1. **No In-Source CGO Builds**: Never run `go build -buildmode=c-shared` directly inside `plugins/` without directing output to `bin/`. Compiling with `-buildmode=c-shared` generates paired `.h` header files that pollute the source tree.
2. **Canonical Build Script**: Always use `scripts/build-plugin.sh [amd64|arm64]` for local or automated plugin compilation. This script directs outputs to `bin/` and cleans any residual header files.
3. **No Sudo / Root Builds**: Never execute build commands under `sudo` or inside unmapped root containers that leave files owned by `root:root`.
4. **Pre-Commit Cleanliness Check**: Before committing or finishing any task, verify that `git status --ignored --short` does not report unexpected untracked or ignored artifacts in source directories (e.g. `*.h`, `*.so`, `*.bak`, `.vite`, `node_modules` in root).

## Diagnostic & Health Engine Compliance
- All health inspection features must be exposed through the native `Maintenance` module (`/auto-switcher-pro/maintenance/scan` and `/clean`).
- Any detected stray build artifacts outside `bin/` must be reported under `orphan_artifacts` and purgeable through the clean action.

## Sacred Architectural Invariant: /model Catalog & Active Pools Routing Contract ($N \to \infty$)

Every AI agent, developer, and workflow MUST strictly uphold this non-negotiable contract:

### 1. Virtual Facade Concept ("Fictitious Leader")
- In Pi's `/model` selector, users and subagents NEVER invoke a fixed physical account.
- Every entry in `/model` represents a **Virtual Facade (an Active Pool)** registered in Auto Switcher Pro.
- Pi calls the pool's stable virtual route (`cpamc/<pool_prefix>/<model>`).
- Auto Switcher Pro dynamically maps that facade to whichever physical account is currently leader, and transparently rotates leaders and reserves (`_1`, `_2`...) on cooldown, rate limits (429), or exhaustion with **zero downtime**.
- The virtual facade in `/model` remains stable and immutable throughout rotations.

### 2. Rule of 1 Entry per Active Pool ($N \to \infty$ Across ALL Providers)
- Every active pool registered in Auto Switcher Pro (`base_prefix`) MUST be independently published to `/model`.
- If there are $N$ pools ($1, 2, 5, 20 \dots \infty$), `/model` MUST expose all $N$ pools.
- **STRICT PROHIBITION**: No agent or code rule may ever collapse, hide, or "shadow" sibling pools (e.g., hiding `agy2`, `agy3`, `codex2`, or `clau2` under the assumption of "duplicate families"). Each pool is an independent routing unit.

### 3. Independent Model Governance (Tuerca ⚙️)
- Each pool independently governs its own allowed models according to its Leader's physical exclusions (`excluded_models`) and pool policy.
- A specialist pool (e.g. `agy` locked to `gemini-3.8-flash-high`) exposes only its specialist model; a multipurpose sibling pool (e.g. `agy2`) exposes its full family. Pools must never impose model restrictions on each other.

### 4. Strict Claude Origin Separation
Claude models come from two entirely different technical providers that must NEVER be confused or merged:
1. **Google Antigravity Package (Cloud Code / Gemini Fleet)**:
   - Prefix MUST start with `agy_`.
   - Strictly specialized into 2 tiers only:
     - `agy_son*` -> Sonnet only (`claude-sonnet-4-6`).
     - `agy_opus*` -> Opus only (`claude-opus-4-6`).
     - Google does NOT offer generic Claude or Haiku.
2. **Direct Claude (Official Native Anthropic Accounts)**:
   - Prefix MUST be `clau*` or `claude*` (NEVER starting with `agy_`).
   - Exposes Anthropic's full official catalog (`claude-3-5-haiku`, `claude-3-7-sonnet`, `claude-3-opus`).

### 5. Strict Invisibility of Reserve Accounts
- Reserve accounts with numeric suffixes (`_1`, `_2`, `_3`...) are internal bench rotation infrastructure.
- They MUST NEVER be exposed in `/model`.

