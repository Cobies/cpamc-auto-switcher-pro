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

### 1. Virtual Facade Concept & Pool-Centric Sovereign Identity ("Fictitious Leader")
- **Clean Pool Identifier in `/model` (`Pool-XX-<family>`)**:
  - In Pi's `/model` selector, users and subagents NEVER invoke a fixed physical account or a hardcoded model suffix.
  - Every entry in `/model` represents a clean **Active Pool Identifier**:
    - `Pool-01-gemini`
    - `Pool-02-gemini`
    - `Pool-03-codex`
    - `Pool-04-claude`
    (Pi automatically prepends the provider namespace `cpamc/`).
  - The model name is NOT appended in `/model` because each member account inside the pool can configure its own model within its family (`agy/gemini-3.8-flash-high`, `agy_1/gemini-3.7-flash-high`, etc.) without changing `/model`.
- **Pool-Centric Identity (No "Padre/Hijo" Coupling)**:
  - A pool is governed solely by its **Pool Identifier / Group Name** (`pool_id` / `Pool-01-gemini`), NEVER by being "the first account" or a physical "cuenta padre".
  - All physical accounts assigned to a pool are equal peer workers (`members`).
  - Pools do NOT depend on a fixed anchor account; if any physical account is released, rotated, or replaced, the pool retains its sovereign identity intact.
- **Dynamic Rotating Leadership (Fictitious Leader in RAM)**:
  - Auto Switcher Pro dynamically maps `Pool-XX-<family>` to whichever physical account is currently active (`ActiveLeader` in RAM) and its configured model, transparently rotating the leader and reserves on cooldown, rate limits (429), predictive threshold (>80%), or exhaustion with **zero downtime**.
  - The virtual facade in `/model` remains stable and immutable throughout rotations.

### 2. Rule of 1 Entry per Active Pool ($N \to \infty$ Across ALL Providers)
- Every active pool registered in Auto Switcher Pro MUST be independently published to `/model`.
- If there are $N$ pools ($1, 2, 5, 20 \dots \infty$), `/model` MUST expose all $N$ pools (`Pool-01-gemini`, `Pool-02-gemini`, etc.).
- **Bimodal Catalog Invariant**:
  - **$N = 0$ (Zero Pools)**: Auto Switcher Pro publishes no virtual facades to `/model`; CPAMC serves its native credentials and models without plugin intervention.
  - **$N \ge 1$ (Active Pools)**: Every registered pool exposes strictly **1 clean pool entry** (`Pool-XX-<family>`), while also accepting legacy `<pool_prefix>/<specialist_model>` routes for backward compatibility.
- **STRICT PROHIBITION**: No agent or code rule may ever collapse, hide, or "shadow" sibling pools. Each pool is an independent routing unit.

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

### 6. Pool Account Rotation Governance & Decision Policy (MANDATORY)
Every subagent, developer, and workflow MUST strictly uphold these 4 rotation pillars to guarantee continuous uptime, avoid flapping, and protect prompt caching:
1. **Belonging & Health Sanitization**:
   - Members must belong to the exact same pool and specialist model family.
   - Credentials in `[INVALID]` or `[EXPIRED]` states, or accounts with prefix `-` / status `[OTHER]` (unassigned free accounts) are strictly excluded from pool rotation queues.
2. **Predictive / Preventive Rotation (Before 429)**:
   - Evaluated by the RAM Predictive Engine (`ShouldPreventiveCool`).
   - If the active leader exceeds the fatigue threshold (>80% / >95% hourly request volume), it is rotated **ONLY IF** there is at least one healthy reserve with available quota (`hasHealthyReserve`).
   - If no healthy reserve exists, the system does NOT rotate, keeping the active leader to maximize remaining throughput.
   - Rotated accounts enter a mandatory cooling window (`CoolingMinutes`, 10-15m) to allow short-window (5h / RPM) quotas to recover.
3. **Hysteresis & Proactive Session Rebalance (on `/new` or Session Startup)**:
   - To preserve provider Prompt Caching and avoid rapid bouncing (flapping):
     - Active leader exhaustion floor: Active leader must have `< 50%` available quota.
     - Margin delta: Next reserve candidate must hold at least a `30%` quota advantage ($\Delta \ge 30\%$) over the active leader.
     - Selection strategy: **Least-Used First** (highest free quota percentage wins).
4. **Reactive Failover Rescue (Instant 429 / Connection Drops)**:
   - Immediate failover triggers on `HTTP 429` (Too Many Requests), `quota exceeded`, `resource exhausted`, or network drops (`502`, `503`, `504`, `ECONNRESET`, `UND_ERR_BODY_TERMINATED`, `socket hang up`).
   - Forces an instant rotation (`force = true`), bypassing hysteresis to immediately restore the execution stream.

### 7. Separation of Concerns: CPAMC Native Inspection vs Pool Routing & Granular Coexistence
- **CPAMC Native Credential Inspection (`GET /v8/management/credentials/models`)**:
  - The native CPAMC "Auth Files Management" credential inspection modal (`GET /v8/management/credentials/models?name=...`, handled via RPC `model.for_auth`) represents the physical capability of an OAuth credential.
  - Auto Switcher Pro ALWAYS returns the full native provider baseline models (`baselineAntigravityModels` for Google Antigravity) alongside any active pool targets.
  - This ensures native CPAMC credential management, model pickers, and exclusion editors always have access to the complete catalog of native models, regardless of pool specialist assignments.
- **Pi `/model` Selector & Granular Bimodal Coexistence Contract (Per-Account Surgical Precision)**:
  - **Accounts Assigned to Active Pools**: When a physical account or prefix is assigned to an active pool (e.g. `agy` in `Pool-01-gemini`, `agy2` in `Pool-02-gemini`), Pi's provider extension **strictly filters out and hides all individual broken-down physical routes** (`agy/gemini-3.8-flash-high`, `agy2/...`). The `/model` catalog exposes **exclusively the clean sovereign pool facades** (`cpamc/Pool-01-gemini`, `cpamc/Pool-02-gemini`). All member accounts and their configured specialist models rotate transparently behind this opaque facade in RAM (`ActiveLeader`).
  - **Unassigned Free Accounts (Same or Different Provider)**: Any physical account or provider NOT assigned to any pool (e.g. a newly linked 5th Gemini account, or free accounts from OpenAI, Direct Claude, DeepSeek, etc.) **strictly preserves 100% native CPAMC behavior ("Auth Files Management")**. Its credentials from disk, its physical prefix, and its native inclusions/exclusions configured in CPAMC native credential modal pass directly to `/model` without plugin intervention or artificial shadowing.
  - **Continuous Auto-Purge & Zero-Residue Contingency**: Upon creating, editing, adopting, or dissolving pools in Auto Switcher Pro, Pi's dynamic provider automatically reconciles and purges the local models cache (`cpamc-models-cache.json`) without lingering ghost models or manual intervention.

### 8. Bimodal Intelligence & Assisted Read-Only Governance for Standalone Accounts (MANDATORY)
Every subagent, developer, and workflow MUST strictly uphold these 4 pillars for standalone / unassigned accounts:
1. **Zero Disk & Config Mutation**: Standalone physical accounts (`.json`) MUST retain `excluded_models: []` intact. Never inject exclusions or mutate `config.yaml` for standalone accounts.
2. **First-Class Telemetry (Web & TUI)**:
   - In `AutoAuthFiles.jsx`, standalone accounts are displayed under their dedicated section `⚡ Cuentas Directas / Standalone (Solo Lectura)` with active `QuotaClock` live polling.
   - In Pi's TUI sidebar, standalone accounts render the symmetrical 48-column card (`⚡ CUENTA FIJA: ...`) with concentric 5H and Weekly clocks, colloquial pace analysis (`● Ritmo holgado`, `🛑 Vas muy rápido`), and reset countdowns.
3. **Session Telemetry & Resilience Warning**:
   - In the expanded view (`Ctrl+Alt+X`), standalone cards render `📊 TELEMETRÍA DE SESIÓN` (session tokens, sustained turns, network health) and `⚠️ ADVERTENCIA DE RESILIENCIA (SIN POOL)` warning that HTTP 429 has no failover reserve.
4. **Universal Runaway Guard Protection**: `CUIDANDO EL CHAT` (circuit breaker, loop detection, bash exploration limits, and KISS/YAGNI anti-overengineering) guards standalone accounts with the exact same rigor as pools to preserve finite quotas.

## Architectural Deployment & Third-Party Agent Invariant (MANDATORY)

Every AI agent, developer, and automated installer MUST strictly uphold this deployment policy:

### 1. Canonical Production Runtime: Plugin .so over CPAMC v8 (Zero Disk Mutation)
- **Authoritative Mode**: Auto Switcher Pro runs EXCLUSIVELY as a Go CGO dynamic library (`auto-switcher-pro-linux-amd64.so`) loaded natively by CPAMC v8 (CLIProxyAPI v8.0.13+).
- **Legacy CLI Deprecation**: The standalone CLI utility (`cmd/cpamc-auto-switcher`) and physical prefix mutation (`PatchAuthPrefix`) are HISTORICAL AND STRICTLY DEPRECATED. They MUST NEVER be deployed, invoked, or recommended in production.
- **Pure Virtual RAM Isolation**: All pool leadership, failover, quota evaluations, and account rotations occur 100% in memory RAM (`ActiveLeader`). The physical credentials in disco (`/root/.cli-proxy-api/*.json` or `auths/`) remain 100% immutable and intact.

### 2. Autonomous Installer & Third-Party Agent Decision Resolution (4/4 Pre-Checks)
When any third-party agent or automated installer prompts for environment choices:
1. **[1/4] Code**: Use the prebuilt standalone release (`cpamc-auto-switcher-release-linux-amd64.tar.gz`), containing only the compiled `.so` and the Pi/Gentle-Shell extension.
2. **[2/4] Version**: Select `Plugin .so sobre CPAMC v8` / `La que marque el repo de Wilox` (`origin/main`).
3. **[3/4] Credentials**: Select `Volumen separado (recomendado)` to isolate test OAuth tokens and eliminate any risk to production credentials.
4. **[4/4] Scope**: Select `También apuntar mis agentes al dev` so Pi / Gentle-Shell connects to the Auto Switcher Pro instance and activates active pools in `/model`.

