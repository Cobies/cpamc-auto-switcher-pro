# Project Agent Operating Rules: cpamc-auto-switcher

## Build & Artifact Sanitation Policy (Mandatory)
1. **No In-Source CGO Builds**: Never run `go build -buildmode=c-shared` directly inside `plugins/` without directing output to `bin/`. Compiling with `-buildmode=c-shared` generates paired `.h` header files that pollute the source tree.
2. **Canonical Build Script**: Always use `scripts/build-plugin.sh [amd64|arm64]` for local or automated plugin compilation. This script directs outputs to `bin/` and cleans any residual header files.
3. **No Sudo / Root Builds**: Never execute build commands under `sudo` or inside unmapped root containers that leave files owned by `root:root`.
4. **Pre-Commit Cleanliness Check**: Before committing or finishing any task, verify that `git status --ignored --short` does not report unexpected untracked or ignored artifacts in source directories (e.g. `*.h`, `*.so`, `*.bak`, `.vite`, `node_modules` in root).

## Diagnostic & Health Engine Compliance
- All health inspection features must be exposed through the native `Maintenance` module (`/auto-switcher-pro/maintenance/scan` and `/clean`).
- Any detected stray build artifacts outside `bin/` must be reported under `orphan_artifacts` and purgeable through the clean action.

## Universal Orphan Provider Cleaner & config.yaml Safety Contract (MANDATORY)
1. **Universal & Dynamic Detection**: Orphan provider detection in `config.yaml` (`api-keys.openai-compatibility`) MUST be 100% agnostic: never hardcode provider names. Any declared provider without active credentials in the auth-dir is an orphan, reportable under `orphan_providers` in `/maintenance/scan` and purgeable via `/maintenance/clean`.
2. **Atomic Writes Only**: ANY mutation of `config.yaml` (or any YAML/JSON production file) MUST use atomic write (temp file + `Sync` + `rename`). Direct `os.WriteFile` against production configs is PROHIBITED. A crash mid-write must never leave a truncated file (regression of the 2026-10-12 truncation incident, which crash-looped CPAMC).
3. **Structural Preservation Guards**: Before writing a cleaned config, the cleaner MUST verify the result is non-empty, still contains the `openai-compatibility` section key, and preserves the first root key of the original document. Fixed size-ratio thresholds are PROHIBITED as sole guards: a legitimate full purge shrinks the real config to ~12% of its size.
4. **End-of-File Section Handling**: Section normalization (`openai-compatibility: []`) MUST work when the section is the last one in the file (the real production layout); do not rely on regexes requiring trailing newlines.
5. **No Unvalidated Deploys**: Never copy a compiled `.so` into the runtime plugins directory without the full Go test suite passing first (an intermediate build deployed at 2026-10-11 21:06 truncated `config.yaml` in production). The canonical flow is: tests green → `scripts/build-plugin.sh amd64` → copy → restart.
6. **Backup Chain**: Every config mutation by the cleaner MUST leave a timestamped backup (`config.yaml.bak-pre-clean-<UTC-ts>`) next to the original.

## Domain Boundary & Entity Differentiation Contract (MANDATORY)

Every agent MUST strictly distinguish between these two completely separate domains and NEVER confuse them:

1. **"Auth Files Management" (CPAMC Nativo / CLIProxyAPI)**:
   - **Propiedad**: Pertenece al core de CLIProxyAPI (`/static/management.html` y `GET /v0/management/auth-files`).
   - **Regla Estricta**: NUNCA modificar, alterar ni intentar cambiar el código, interfaz o endpoints nativos de CPAMC. Son componentes nativos y protegidos por Configuration Lock.
   - **Naturaleza**: Visor de archivos físicos en disco (`/root/.cli-proxy-api/*.json`).

2. **"Auto Auth Files & Trazabilidad" (Auto Switcher Pro Plugin)**:
   - **Propiedad**: Componente React del plugin (`plugins/auto-switcher-pro/web/src/components/AutoAuthFiles.jsx`).
   - **Naturaleza**: Capa visual avanzada con tarjetas de failover (Gemini / Claude), telemetría de cuotas en vivo, y Tuerca ⚙️ de Modo Especialista.

Cualquier orden del usuario que mencione "Auth Files" debe ser disambiguada antes de actuar: las modificaciones solo aplican al plugin (`Auto Switcher Pro`), jamás a CPAMC nativo.

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
- **Bimodal Catalog Invariant**:
  - **$N = 0$ (Zero Pools)**: Auto Switcher Pro publishes no virtual facades to `/model`; CPAMC serves its native credentials and models without plugin intervention.
  - **$N \ge 1$ (Active Pools)**: Every registered pool exposes strictly **1 facade route** for its chosen specialist model (`<pool_prefix>/<specialist_model>`).
- **STRICT PROHIBITION**: No agent or code rule may ever collapse, hide, or "shadow" sibling pools (e.g., hiding `agy2`, `agy3`, `codex2`, or `clau2` under the assumption of "duplicate families"). Each pool is an independent routing unit.

### 3. Strict Specialist Model Governance (1 Pool = 1 Specialist Model & Pure Virtual Isolation)
- **Zero Wildcards / No Multipurpose Mode**: Pools never operate in open/multipurpose mode. Every pool is strictly locked to **1 specialist model** chosen dynamically at pool creation based on provider nature.
- **Pure Virtual Isolation (Zero Disk Mutilation)**:
  - Pool specialist isolation is governed **100% virtually** by the Auto Switcher Pro plugin engine (`pool.policy.target_models`, `model.route`, `scheduler.pick`).
  - **PROHIBITION**: Creating or editing pools MUST NEVER mutate or inject `excluded_models` into physical credential `.json` files on disk. Physical credentials MUST retain `excluded_models: []` (or only explicit user-configured manual exclusions) so CPAMC native "Auth Files Management" always displays the full native model catalog in its credential inspection modal.
- **Foreign Vendor Sanitization**: If any manual exclusion is ever processed, foreign models (NVIDIA, OpenCode, etc.) are strictly filtered out.
- **Independent Governance**: Each pool independently governs its own specialist model; pools must never impose restrictions on sibling pools or on unassigned free accounts.

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

### 6. Separation of Concerns: CPAMC Native Inspection vs Pool Routing
- **CPAMC Native Credential Inspection (`GET /v8/management/credentials/models`)**:
  - The native CPAMC "Auth Files Management" credential inspection modal (`GET /v8/management/credentials/models?name=...`, handled via RPC `model.for_auth`) represents the physical capability of an OAuth credential.
  - Auto Switcher Pro ALWAYS returns the full native provider baseline models (`baselineAntigravityModels` for Google Antigravity) alongside any active pool targets.
  - This ensures native CPAMC credential management, model pickers, and exclusion editors always have access to the complete catalog of native models, regardless of pool specialist assignments.
- **Pi `/model` Selector & Route Facades (`GET /v1/models`)**:
  - Pi's `/model` catalog exposes only the active pools' virtual routes (e.g. `agy/gemini-3.8-flash-high`, `agy2/gemini-3.8-flash-high`).
  - Physical accounts rotate transparently behind these facades with zero disruption.

