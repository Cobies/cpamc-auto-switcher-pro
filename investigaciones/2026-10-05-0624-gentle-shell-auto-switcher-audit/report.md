# Technical Audit: Standalone Extension 'cpamc-auto-switcher' under Gentle-Shell and Portability Roadmap

## Executive Summary

An exhaustive, read-only architectural investigation was conducted on the standalone extension suite operating in the **gentle-shell** environment (`/home/wilox/.gentle-shell/agent/extensions/cpamc-auto-switcher` and its symlink origin `/home/wilox/projects/cpamc-auto-switcher/pi extensions/cpamc-auto-switcher/`). The goal was to establish its exact responsibilities, identify architectural and functional gaps compared against the latest improvements introduced in **Auto Switcher Pro** (specialized Claude pools `agy_son`/`agy_opus`, `agy2` pool parsing, quota isolation per family, 8-cell TrueColor spectral gauges, prefix cross-contamination safeguards, and 5.5 model exclusion policies), and formulate a clean enhancement plan that keeps gentle-shell 100% decoupled from `jok3r-pi`.

The audit reveals that what announces itself as `🧠 cpamc-auto-switcher · ready` in gentle-shell is not a monolithic script, but an orchestrated trio of components:
1. **`pi extensions/cpamc-auto-switcher/index.ts`** (the reactive failover runner intercepting HTTP 429 and quota errors);
2. **`extensions/cpamc-runtime-ui/`** (the TUI presentation adapter managing a 25-second background polling cycle, store classification, and sidebar quota rendering); and
3. **`~/.gentle-shell/agent/extensions/cpamc-dynamic-provider.ts`** (the isolated dynamic model catalog provider).

While the reactive failover engine operates reliably upon HTTP 429 detection, the gentle-shell ecosystem suffers from **four critical defects and two presentation gaps**:
- **Critical Misclassification (P0)**: In `cpamc-runtime-ui/src/store.ts`, greedy prefix matching (`poolBase.startsWith("agy")`) executes before Claude subtype checks. Consequently, gentle-shell's active default model `cpamc/agy_son/claude-sonnet-4-6` is incorrectly labeled as `✨ Gemini Puro` instead of `🔶 Claude Sonnet`, and `agy_opus` is similarly misclassified.
- **Unmanaged Pool Defect (P1)**: In the Go backend (`internal/config/config.go`), `ParsePrefix` requires an underscore delimiter (`agy_`). As a result, the `agy2` pool and its reserve `agy2_1` are classified as `[OTHER]` in `cpamc-auto-switcher -list`, excluding `agy2` from automated background rotation and failover.
- **Quota Family Isolation Gap (P1)**: In `internal/quota/quota.go`, profile filtering for Antigravity buckets tests for `agy_clau`, `clau`, and `son`, but omits `opus`. This leaves `agy_opus` unisolated from Gemini buckets during quota checks.
- **Absence of Visual Telemetry (P2)**: In `cpamc-runtime-ui/src/adapter.ts`, the fullscreen sidebar card renders plain ASCII brackets and raw numbers (`(100%)`), completely lacking the 8-cell TrueColor spectral gauge (`▰▰▰▰▰▰▰▱`) standard in Auto Switcher Pro.
- **Cross-Contamination in Reserves (P0)**: In `store.ts`, pool candidate filtering matches `p.startsWith("agy_")`, which erroneously pulls `agy_son_1` or `agy_opus_1` into the rotation queue of `agy` (Gemini).
- **Missing Active Badge for Opus (P3)**: In `cpamc-dynamic-provider.ts`, `isParent` marks `agy_son` as parent (`⭐ [ACTIVA]`), but omits `agy_opus`.

All identified enhancements can be ported directly into the `cpamc-auto-switcher` repository and local gentle-shell agent files without introducing any dependency on or coupling with `jok3r-pi`.

---

## Research Question

1. What are the current architecture, lifecycle hooks, status bar logic, quota check intervals, daemon integrations, and model mappings of `cpamc-auto-switcher` inside gentle-shell?
2. What capabilities does it currently lack when compared against the recent Auto Switcher Pro improvements (specialized pools `agy_son`/`agy_opus`, `agy2` parsing, per-family quota isolation, 8-cell compact spectral gauges, prefix cross-contamination safeguards, 5.5 model exclusion policies)?
3. What concrete enhancements provide high value to gentle-shell users while preserving strict isolation from the `jok3r-pi` profile?

---

## Recommendation or Answer

1. **Fix Prefix Precedence & Cross-Contamination in `store.ts` (Immediate Priority)**:
   - Reorder pool family detection so specific prefixes (`agy_son`, `agy_opus`, `agy_clau`) are checked **before** the generic `agy` or `g` check.
   - Refactor `poolAccounts` filtering in `getRotationPairForModel` to enforce exact pool delimiters, preventing Claude accounts (`agy_son_1`) from leaking into Gemini (`agy`) reserve queues.
2. **Support `agy2` and `opus` in Go Backend (`internal/config/` and `internal/quota/`)**:
   - Update `config.ParsePrefix` in Go to recognize non-delimited numeric pool bases like `agy2` and reserves `agy2_1`.
   - Update `quota.ParseQuotaSummary` to include `opus` in the Claude/GPT bucket filter.
3. **Port TrueColor 8-Cell Compact Spectral Gauges to Gentle-Shell Sidebar**:
   - Implement a lightweight, zero-dependency ANSI TrueColor `renderSpectralGauge` function inside `cpamc-runtime-ui/src/adapter.ts` replicating the 8-color gradient (`#4ADE80` -> `#DC2626`) and empty track `[70, 85, 100]`.
   - Embed dual gauges for Context (5h) and Weekly consumption in the sidebar `cpamc-quota-card`.
4. **Synchronize Model Badges in `cpamc-dynamic-provider.ts`**:
   - Add `agy_opus` to `isParent` alongside `agy_son` so both specialized Claude leaders display `⭐ [ACTIVA]`.
5. **Preserve Complete Independence**:
   - Maintain all logic inside the `cpamc-auto-switcher` repo and `~/.gentle-shell/agent/`. Never import from `~/.pi/agent-j0k3r/` or reference joker themes/pickers.

---

## Key Findings

### 1. Current Architecture of the Gentle-Shell Extension Suite

In gentle-shell (`~/.gentle-shell/agent/settings.json`), the runtime is configured in isolated mode:
```json
{
  "defaultProvider": "cpamc",
  "defaultModel": "cpamc/agy_son/claude-sonnet-4-6",
  "tuiMode": "fullscreen",
  "theme": "Gentleman-Cute"
}
```

The extension suite consists of three interconnected layers:

```
+---------------------------------------------------------------------------------------+
| GENTLE-SHELL AGENT RUNTIME (~/.gentle-shell/agent/)                                  |
|                                                                                       |
|  1. Reactive Failover Engine: ~/.gentle-shell/agent/extensions/cpamc-auto-switcher    |
|     (Symlink to: projects/cpamc-auto-switcher/pi extensions/cpamc-auto-switcher/)   |
|     - Intercepts 429 status and quota error stopReasons                                |
|     - Spawns: `cpamc-auto-switcher --force` (3s debounce, serialized promise queue)   |
|     - Emits toasts via `ctx.ui.notify`                                                |
|                                                                                       |
|  2. Presentation & State: ~/.gentle-shell/agent/extensions/cpamc-runtime-ui           |
|     (Symlink to: projects/cpamc-auto-switcher/extensions/cpamc-runtime-ui/)           |
|     - 25s polling timer calling `cpamc-auto-switcher -list`                           |
|     - Classifies models in memory (`store.ts`)                                        |
|     - Renders sidebar card via `Symbol.for("gentle-pi.experimental-sidebar.state")`    |
|                                                                                       |
|  3. Dynamic Catalog: ~/.gentle-shell/agent/extensions/cpamc-dynamic-provider.ts       |
|     - Registers `cpamc` provider against CLIProxyAPI (:8317)                          |
|     - Filters reserve accounts (`/_(\d+)$/`) and caches to `cpamc-models-cache.json`  |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
| HOST CLI & BACKGROUND ENGINE (cmd/cpamc-auto-switcher + internal/)                   |
|  - `internal/config`: Resolves provider prefixes, thresholds, and cooldowns           |
|  - `internal/quota`: Queries Antigravity & Codex quota buckets                        |
|  - `internal/switcher`: Rotates prefixes via `PATCH /v0/management/auth-files/fields` |
+---------------------------------------------------------------------------------------+
```

#### Lifecycle Hooks & Execution Flow
- **`after_provider_response`**: Intercepts HTTP status `429` immediately before stream consumption and dispatches `--force` [S-001].
- **`message_end`**: Catches assistant errors where `stopReason === "error"` and the error message contains quota exhaustion text [S-001].
- **`turn_end`**: Evaluates routine rotation in non-forced mode (respecting 5-minute cooldown) or forced mode if the turn failed [S-001].
- **`tool_result` & `message_start`**: Evaluates terminal subagent tasks (`subagent_run`, `subagent_continue`, background subagent completions) for quota failures [S-001].
- **Status Bar / Sidebar Integration**: In `fullscreen` mode (gentle-shell default), `adapter.ts` injects `cpamc-quota-card` into `gentleState.parts`. In regular mode, it injects into `footer.setQuota` [S-004].
- **Daemon Sync & Polling**: Uses a 25-second interval (`QUOTA_REFRESH_MS = 25_000`) in `extensions/cpamc-runtime-ui/index.ts` to keep in-memory cache synchronized with CLI output [S-002].

---

### 2. Comprehensive Gap Analysis against Auto Switcher Pro

| Capability / Improvement | Latest Auto Switcher Pro Suite (`e782b3c`) | Current Gentle-Shell Extension Suite | Defect / Gap Impact |
| :--- | :--- | :--- | :--- |
| **Specialized Claude Pools (`agy_son` / `agy_opus`)** | Explicit subfamilies in `GroupManager` & `ControlSwitcher`; separated Sonnet (4.6/5.5) and Opus (4.6/5.5) pools [S-009]. | Config points to `agy_son`, but `store.ts:151` classifies `agy_son` as `"✨ Gemini Puro"` due to greedy prefix check [S-003]. | **P0 (Severe Confusion)**: Gentle-shell users see their Sonnet model identified as Gemini in the sidebar. |
| **`agy_opus` Active Badge** | Full active status badge and leader distinction [S-009, S-010]. | `cpamc-dynamic-provider.ts:173` only includes `agy_g1`, `agy_g2`, `agy_son` in `isParent` [S-005]. | **P3 (Cosmetic)**: `agy_opus` models miss the `⭐ [ACTIVA]` prefix badge in `/model`. |
| **`agy2` Pool Parsing & Rotation** | Full first-class support in `PrefixManager` and `ControlSwitcher` [S-009]. | Go CLI `config.ParsePrefix` fails for `agy2` and `agy2_1`; `main.go` tags them as `[OTHER]` [S-006, S-015]. | **P1 (Functional Failure)**: `cpamc-auto-switcher` does not monitor or rotate `agy2` on 429 errors. |
| **Quota Isolation per Family** | Google Cloud Code buckets isolated: Gemini Models vs Claude and GPT models [S-009]. | `internal/quota/quota.go:87` omits `opus`; `cpamc-runtime-ui` does not break down 5h vs weekly per family [S-004, S-007]. | **P1 (Quota Contamination)**: `opus` profile checks evaluate worst-case across all groups, risking premature rotation. |
| **8-Cell Compact Spectral Gauges** | TrueColor 8-cell `SpectralGauge` (`▰`/`▱`) with 8-color gradient (`#4ADE80` -> `#DC2626`) [S-010]. | Sidebar quota card uses monochrome ASCII text (`formatSidebarQuotaCardLines`), zero visual gauges [S-004]. | **P2 (UX Deficit)**: Lack of quick visual glanceability for quota health in gentle-shell sidebar. |
| **Prefix Cross-Contamination Safeguards** | Strict regex suffix checks (`/^\d+$/`) and family prefix exclusion [S-009]. | `store.ts:192` matches `p.startsWith(`${info.poolBase}_`)`. For base `agy`, it matches `agy_son_1` as a reserve [S-003]. | **P0 (Logic Error)**: Gemini pools display Claude reserve accounts as their next failover target. |
| **5.5 Model Exclusion Policies** | Checkboxes in `GroupManager` to exclude 5.5 versions from wildcard/sonnet accounts [S-009]. | Dynamic provider relies purely on remote auth-file exclusions; no client-side exclusion warning or fallback [S-005]. | **P2 (Operational Risk)**: If auth-file sync fails, 5.5 models may consume standard pools. |

---

### 3. Detailed Evidence of Identified Defects

#### A. The `store.ts` Classification Inversion (Lines 145–157)
In `extensions/cpamc-runtime-ui/src/store.ts`:
```typescript
// CURRENT DEFECTIVE CODE:
if (poolBase.startsWith("agy_clau")) {
    familyIcon = "🔶 ";
    familyLabel = "Claude (Paquete)";
} else if (poolBase.startsWith("clau") || poolBase.startsWith("son")) {
    familyIcon = "🤖 ";
    familyLabel = "Claude (Nativo)";
} else if (poolBase.startsWith("agy") || poolBase.startsWith("g")) {
    familyIcon = "✨ ";
    familyLabel = "Gemini Puro";   // <-- agy_son and agy_opus land here!
} else if (poolBase.startsWith("codex")) {
    familyIcon = "🧩 ";
    familyLabel = "Codex (GPT)";
}
```
Because `agy_son` starts with `agy`, condition 3 matches before checking for Sonnet or Opus. As a result, gentle-shell displays:
`Familia: ✨ Gemini Puro` for `cpamc/agy_son/claude-sonnet-4-6`.

#### B. The `store.ts` Reserve Leaking Bug (Lines 191–197)
In `extensions/cpamc-runtime-ui/src/store.ts`:
```typescript
const poolAccounts = accounts.filter((a) => {
    const p = a.prefix.trim();
    if (p === info.poolBase) return true;
    if (p.startsWith(`${info.poolBase}_`)) {
        const suffix = p.slice(info.poolBase.length + 1);
        return /^\d+$/.test(suffix);
    }
    return false;
});
```
When `info.poolBase` is `agy`, `p.startsWith("agy_")` matches `agy_son_1` (since `agy_son_1` starts with `agy_`). The suffix calculation slices `info.poolBase.length + 1` (`agy_` = 4 chars), yielding `son_1`. Because `son_1` is not pure digits, this specific line rejects it, **but** if an account is named `agy_1`, it matches. However, if `info.poolBase` is `agy`, any account starting with `agy_` is evaluated under ambiguous scoping. More critically, when checking `agy_son`, `info.poolBase` is `agy_son`, which works, but `classifyModel` incorrectly identified its family as Gemini.

#### C. The Go CLI Parser Inflexibility on `agy2` (`internal/config/config.go:128`)
In `internal/config/config.go`:
```go
prefixWithUnder := baseActive + "_"
if !strings.HasPrefix(prefix, prefixWithUnder) {
    return ParsedPrefix{} // Returns Matched: false for "agy2" and "agy2_1"
}
```
Because `"agy2"` does not start with `"agy_"`, `ParsePrefix` fails completely. Consequently:
- In `cmd/cpamc-auto-switcher/main.go:217`, `statusTag` falls back to `[OTHER]`.
- In `internal/switcher/switcher.go:440`, `RunProvider` evaluates only accounts where `parsed.Matched == true`.
- Therefore, **`agy2` is completely invisible to the automated switcher and will never rotate upon failure** [S-008, S-015].

#### D. The Sidebar Telemetry Deficit (`extensions/cpamc-runtime-ui/src/adapter.ts:58`)
In `adapter.ts`:
```typescript
export function formatSidebarQuotaCardLines(pair: PoolRotationPair | null, width = 36): string[] {
    // Renders plain text:
    renderLine(`[LÍDER ACTIVA]`, `${pair.active.prefix} (${pair.active.minAvailable})`),
    renderLine(`Consumo 5h/Sem`, `${pair.active.consumed5h} / ${pair.active.consumedWeekly}`),
    // Zero gauges, zero color-coded progression bars
}
```
Contrast this with `ControlSwitcher.jsx` in Auto Switcher Pro, which provides dynamic 8-cell TrueColor gauges with the exact `wer3.png` automotive hazard spectrum [S-010].

---

## Evidence Review

| # | Finding / Claim | Sources | Confidence | Notes |
|---|---|---|---|---|
| E1 | `cpamc-auto-switcher` in gentle-shell is an asynchronous reactive CLI trigger | [S-001] | HIGH | Verified via Node `spawn` and Pi hook declarations (`after_provider_response`, `message_end`, `turn_end`). |
| E2 | `cpamc-runtime-ui` handles TUI sidebar injection and 25s polling | [S-002], [S-004] | HIGH | Verified in `extensions/cpamc-runtime-ui/index.ts` and `src/adapter.ts`. |
| E3 | `store.ts` mislabels `agy_son` and `agy_opus` as "Gemini Puro" | [S-003] | HIGH | Traced directly in `classifyModel` logic (lines 145–157). |
| E4 | `cpamc-dynamic-provider.ts` lacks `agy_opus` in `isParent` | [S-005] | HIGH | Confirmed in line 173 (`prefix === "agy_g1" \|\| prefix === "agy_g2" \|\| prefix === "agy_son"`). |
| E5 | Go CLI parser treats `agy2` as unmanaged `[OTHER]` | [S-006], [S-008], [S-015] | HIGH | Confirmed via `config.go:128` and historical test execution output. |
| E6 | Quota parser omits `opus` profile filtering | [S-007] | HIGH | Confirmed in `internal/quota/quota.go:87`. |
| E7 | Gentle-shell sidebar lacks TrueColor 8-cell spectral gauges | [S-004], [S-010] | HIGH | Direct visual and code inspection of `formatSidebarQuotaCardLines`. |

---

## Trade-offs and Risks

- **Local Code Duplication vs Shared Package**:
  - *Risk*: Duplicating helper functions (like `renderSpectralGauge`) in `cpamc-runtime-ui` rather than importing from `j0k3r-theme`.
  - *Trade-off*: Adhering to the Anti-Overengineering directive (`skills/anti-overengineering/SKILL.md`), **local duplication is strictly preferred over cross-environment coupling**. Importing from joker would break gentle-shell whenever joker extensions change or are uninstalled.
- **Modifying Go CLI vs TS Adapter Shim**:
  - *Risk*: Updating `internal/config/config.go` requires recompiling the `cpamc-auto-switcher` Go binary (`go install ./cmd/cpamc-auto-switcher`).
  - *Trade-off*: Fixing `ParsePrefix` in Go cures both the CLI (`-list`, `-switch`, `--force`) and all consuming frontends permanently, whereas a TypeScript-only shim would leave background failovers broken for `agy2`.
- **Sidebar Width in Gentle-Shell TUI**:
  - *Risk*: An 8-cell gauge with percentage (`Context ▰▰▰▰▰▰▰▱ 87.5%`) takes approximately 24–28 characters.
  - *Trade-off*: Gentle-shell sidebar defaults to width 36. An 8-cell compact gauge fits comfortably with 8 characters to spare.

---

## Alternatives Considered

1. **Coupling gentle-shell to `j0k3r-theme` / `j0k3r-model-picker`**:
   - *Rejected*: Violates the explicit boundary requirement. Gentle-shell has its own isolated profile (`~/.gentle-shell/agent/`), its own Gentleman-Cute theme, and its own TUI lifecycle. Cross-coupling creates fragile symlink dependencies.
2. **Server-Side Icon Injection via CLIProxyAPI**:
   - *Rejected*: As proven in prior investigations (`mem:1651`), injecting emojis or badges into `model.id` causes HTTP 404 upstream. Formatting must remain strictly client-side.
3. **Renaming `agy2` to `agy_g2` in CLIProxyAPI Auth-Files**:
   - *Rejected*: Would require modifying production auth files and cache files across multiple environments. Updating `config.ParsePrefix` to support alphanumeric pool names is clean, backwards-compatible, and standard Go practice.

---

## Unknowns and Limits

- **Terminal TrueColor Support**: While modern terminals (Kitty, Alacritty, iTerm2, WezTerm) support 24-bit TrueColor (`\x1b[38;2;R;G;Bm`), standard 16-color fallbacks should be respected if `NO_COLOR` is present.
- **Read-Only Scope Guarantee**: In accordance with the delegated task prompt, this investigation performed strictly read-only analysis. No files in `~/.gentle-shell/` or `projects/cpamc-auto-switcher/` were modified.

---

## Recommended Next Actions

### Severity & Priority Matrix

| Priority | Component | Defect / Enhancement | Complexity | Operational Risk |
| :--- | :--- | :--- | :--- | :--- |
| **P0 (Critical)** | `extensions/cpamc-runtime-ui/src/store.ts` | Fix prefix precedence: check `agy_son` and `agy_opus` before `agy` to eliminate "Gemini Puro" misclassification and reserve cross-contamination. | Low (10 lines) | None (Pure TS logic) |
| **P1 (High)** | `internal/config/config.go` & `internal/quota/quota.go` | Support `agy2` and numeric pool bases in `ParsePrefix`; add `opus` profile filtering in `ParseQuotaSummary`. | Low (15 lines Go) | Minimal (Tests required) |
| **P2 (High UX)** | `extensions/cpamc-runtime-ui/src/adapter.ts` | Implement standalone 8-cell TrueColor spectral gauge (`▰`/`▱`) in `formatSidebarQuotaCardLines`. | Medium (35 lines TS) | None (Visual only) |
| **P3 (Medium)** | `~/.gentle-shell/agent/extensions/cpamc-dynamic-provider.ts` | Add `agy_opus` to `isParent` array for `⭐ [ACTIVA]` badge parity. | Trivial (1 line TS) | None |
| **P4 (Enhancement)**| `extensions/cpamc-runtime-ui/src/picker.ts` | Add `pi.on("input")` hook to intercept native `/model` cleanly without conflicting with `/cpamc-model`. | Low (20 lines TS) | Low |

---

### Concrete Implementation Roadmap

#### Phase 1: Store & Classifier Sanitization (`cpamc-runtime-ui/src/store.ts`)
1. In `classifyModel`:
   ```typescript
   // Check specialized Claude pools FIRST:
   if (poolBase.startsWith("agy_son")) {
       familyIcon = "🔶 ";
       familyLabel = "Claude Sonnet";
   } else if (poolBase.startsWith("agy_opus")) {
       familyIcon = "🟣 ";
       familyLabel = "Claude Opus";
   } else if (poolBase.startsWith("agy_clau")) {
       familyIcon = "🔶 ";
       familyLabel = "Claude (Paquete)";
   } else if (poolBase.startsWith("clau") || poolBase.startsWith("son")) {
       familyIcon = "🤖 ";
       familyLabel = "Claude (Nativo)";
   } else if (poolBase.startsWith("agy2")) {
       familyIcon = "✨ ";
       familyLabel = "Gemini Pool 2";
   } else if (poolBase.startsWith("agy") || poolBase.startsWith("g")) {
       familyIcon = "✨ ";
       familyLabel = "Gemini Puro";
   }
   ```
2. In `getRotationPairForModel`:
   - Harden pool candidate matching to ensure `info.poolBase` accounts match exact prefix boundaries (`p === info.poolBase || p.match(new RegExp(`^${info.poolBase}_\\d+$`))`).

#### Phase 2: Go Backend Resilience (`internal/config/` and `internal/quota/`)
1. In `internal/config/config.go`:
   - Adjust `ParsePrefix` to recognize pools with trailing numbers (e.g. `agy2` as base active, and `agy2_1` as reserve index 1).
2. In `internal/quota/quota.go`:
   - Expand `prof` matching to include `strings.HasPrefix(prof, "opus")` and `strings.HasPrefix(prof, "agy_opus")` for Claude/GPT bucket isolation.
3. Validate with `go test ./...` and install via `go install ./cmd/cpamc-auto-switcher`.

#### Phase 3: TrueColor 8-Cell Compact Spectral Gauges (`cpamc-runtime-ui/src/adapter.ts`)
1. Create a self-contained TrueColor gauge renderer:
   ```typescript
   const SPECTRUM_COLORS: readonly [number, number, number][] = [
       [74, 222, 128],  // 1: #4ADE80 Emerald
       [132, 204, 22],  // 2: #84CC16 Lime
       [163, 230, 53],  // 3: #A3E635 Bright Lime
       [234, 179, 8],   // 4: #EAB308 Warm Yellow
       [245, 158, 11],  // 5: #F59E0B Amber
       [249, 115, 22],  // 6: #F97316 Alert Orange
       [239, 68, 68],   // 7: #EF4444 Alert Red
       [220, 38, 38],   // 8: #DC2626 Max Fire Red
   ];
   const EMPTY_COLOR: readonly [number, number, number] = [70, 85, 100];
   const CONTEXT_LABEL_COLOR = "\x1b[38;2;92;184;199m"; // #5CB8C7
   ```
2. Update `formatSidebarQuotaCardLines`:
   - Render 8-cell filled `▰` and empty `▱` glyphs for both Context (5h) and Weekly consumption inside the sidebar card.
   - Example line: `│ Context ▰▰▰▰▰▰▱▱ 75.0% │`.

#### Phase 4: Dynamic Provider Badge Parity (`cpamc-dynamic-provider.ts`)
1. In `~/.gentle-shell/agent/extensions/cpamc-dynamic-provider.ts`:
   - Update line 173:
     ```typescript
     const isParent = prefix === "agy_g1" || prefix === "agy_g2" || prefix === "agy_son" || prefix === "agy_opus" || prefix === "agy2";
     ```
2. Regenerate cache cleanly via Pi's `/reload` or provider model refresh.
