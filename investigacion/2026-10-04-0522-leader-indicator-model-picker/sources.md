# Sources

## Source Index

### S-001: Pi Coding Agent Interactive Model Selector Component
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/model-selector.js`
- Date/version: v0.85.1
- Access method: Targeted file inspection via bash (`grep`, `sed`)
- Used for: Architecture of `/model` in native Pi; proof that list rows strictly render `item.id` and completely omit `model.name` and `display_name`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirms that modifying `model.name` or `display_name` in backend responses has zero visual effect on the scrollable row items of `/model` in native Pi.

### S-002: Pi Coding Agent Interactive Mode Dispatch
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js`
- Date/version: v0.85.1
- Access method: Targeted file inspection via bash
- Used for: Built-in command handling for `/model` and `/model <search>`; instantiation of `ModelSelectorComponent`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Documents that Pi's CLI traps `/model` before extensions unless an editor wrapper or distinct command name (`/model-select`, `/ms`) is used.

### S-003: Pi AI OpenAI Completions API Client
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`
- Date/version: v0.85.1
- Access method: Targeted file inspection via bash
- Used for: Demonstrating that `params.model = model.id` is sent directly over the wire in HTTP JSON payloads to `${baseUrl}/chat/completions`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Proves conclusively that altering `model.id` to contain an emoji or icon corrupts the wire protocol sent to CLIProxyAPI.

### S-004: Pi Extension API Specification and Virtual Models Documentation
- Family: PRIMARY
- URL or locator: `/home/wilox/.pi/agent-j0k3r/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts` and `docs/virtual-models.md`
- Date/version: v0.85.1
- Access method: File inspection via bash
- Used for: Capabilities of Pi extensions (`registerProvider`, `registerVirtualModel`, `registerCommand`, `ctx.ui.custom`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirms that virtual models separate selection name from dispatch physical model, and that UI custom modals can display arbitrary TUI components.

### S-005: j0k3r Model Picker Extension Implementation
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/extensions/j0k3r-model-picker/` (`index.ts`, `src/api.ts`, `src/modal.ts`)
- Date/version: 2026-09-30
- Access method: Targeted code review via bash
- Used for: Analysis of custom picker implementation in `jok3r-pi`; proof that `roleIcon = isParent ? "⭐ " : ""` is hardcoded in `modal.ts` and prepended to `model.id` only at display time.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Shows existing working precedent of TUI row decoration in Pi without altering wire `model.id`.

### S-006: CLIProxyAPI Dynamic Provider Extension for Pi
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent-j0k3r/extensions/cliproxyapi-dynamic-provider.ts`
- Date/version: 2026-10-03
- Access method: Targeted code review via bash
- Used for: How Pi queries CLIProxyAPI (`/v1/models?client_version=1` and `/v0/management/auth-files`); filtering of reserve accounts (`/(\d+)$/`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Demonstrates that reserve accounts are already filtered out on client side, and that hardcoded active prefixes (`agy_g1`, `agy_g2`, `agy_son`) were used previously.

### S-007: CLIProxyAPI Model Registry & Prefix Synthesis
- Family: PRIMARY
- URL or locator: `/tmp/cliproxy-src/sdk/cliproxy/service_models.go`, `service_executors.go`, `internal/registry/model_registry.go`
- Date/version: CLIProxyAPI v8.0.13 (commit d7914af)
- Access method: Source code inspection via bash
- Used for: Mechanics of `applyModelPrefixes`, `clone.ID = trimmedPrefix + "/" + baseID`, and registry client support check (`ClientSupportsModel`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Proves that CLIProxyAPI routes models based on `prefix/` matching the auth record `Prefix`. Changing `model.id` to include an emoji causes route failure.

### S-008: CLIProxyAPI Model List Handler & Plugin Response Interceptor
- Family: PRIMARY
- URL or locator: `/tmp/cliproxy-src/internal/api/server_routes.go`, `sdk/api/handlers/handlers_interceptors.go`
- Date/version: CLIProxyAPI v8.0.13 (commit d7914af)
- Access method: Source code inspection via bash
- Used for: Proof that `WriteModelListResponse` on `/v1/models` passes the payload to plugin response interceptors (`MethodResponseInterceptAfter`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Shows that a plugin can alter the HTTP response of `/v1/models`, but cannot overcome client-side renderer limitations in native Pi.

### S-009: CLIProxyAPI C-ABI Plugin Specification
- Family: PRIMARY
- URL or locator: `/tmp/cliproxy-src/sdk/pluginabi/types.go`, `sdk/pluginapi/types.go`
- Date/version: CLIProxyAPI v8.0.13 (commit d7914af)
- Access method: Source code inspection via bash
- Used for: Plugin capabilities (`management_api`, `response_interceptor`, `model_provider`), ABI schema versions, and host callbacks.
- Usefulness: SUPPORTING
- Confidence impact: HIGH
- Notes: Clarifies that `visual-profile` is registered as a `management_api` plugin and does not currently intercept model listing responses.

### S-010: CPAMC Auto Switcher Core Logic & Prefix Parsing
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/internal/config/config.go`, `internal/switcher/switcher.go`
- Date/version: Current repository main branch
- Access method: Targeted code review via bash
- Used for: Definition of pools, active leader prefix (`baseActive`), reserve indices (`_1`, `_2`), and prefix rotation mechanics (`PatchAuthPrefix`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Proves that in CPAMC, the active leader prefix is invariant (`agy_g1`, `agy_son`), while the underlying physical account credential is what swaps during rotation.

### S-011: CPAMC Visual Profile & Control Switcher Plugin
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/internal/plugin/plugin.go`, `web/src/components/ControlSwitcher.jsx`
- Date/version: Current repository main branch
- Access method: Targeted code review via bash
- Used for: How visual-profile discovers pools (`base::prof`), identifies active vs reserve accounts (`reserveMatch = pref.match(/^(.*)_(\d+)$/)`).
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Validates the single source of truth for pool discovery and reserve classification across the entire CPAMC ecosystem.

### S-012: Gentle-Pi Package & Gentle-Shell Harness Architecture
- Family: IMPLEMENTATION
- URL or locator: `/home/wilox/.pi/agent/npm/node_modules/gentle-pi/package.json`, `bin/gentle-shell.mjs`, `/home/wilox/.bashrc`
- Date/version: gentle-pi v3.7.0
- Access method: Package inspection and grep via bash
- Used for: Verifying that `gentle-pi` and `gentle-shell` use Pi's standard `ModelSelectorComponent` without `j0k3r-model-picker`.
- Usefulness: MATERIAL
- Confidence impact: HIGH
- Notes: Confirms profile separation between `gentle-pi` (`~/.pi/agent`) and `jok3r-pi` (`~/.pi/agent-j0k3r`), explaining why icons appeared in one but not the other.
