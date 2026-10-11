## Workflow Status
- Status: READY
- Blockers: None

## Goal
Implement an automatic management console update on startup for CPAMC when enabled by user preference:
1. Provide an auto-update checkbox toggle in the Maintenance view (`Maintenance.jsx`) persisted in `localStorage` under `auto_update_console_on_boot`.
2. Coordinate a background startup check in the host application (`App.jsx`) when authenticated, checking a 6-hour cooldown (`last_console_check_ts`) to respect GitHub rate limits.
3. Automatically trigger `updateManagementConsole()` when an update is available (`console_update_available: true`).
4. Display a floating notification toast in `App.jsx` announcing the successful update ("⚡ AUTO SWITCHER PRO: Consola de Gestión actualizada automáticamente a la versión [vX.Y.Z] (Oficial)") that stays visible for exactly 12 seconds with automatic dismissal and a manual close button.

## Scope & Exclusions
- Allowed root: `plugins/visual-profile/web/src/**`
- Target files:
  - `plugins/visual-profile/web/src/components/Maintenance.jsx` and `plugins/visual-profile/web/src/components/Maintenance.test.jsx`
  - `plugins/visual-profile/web/src/App.jsx` and `plugins/visual-profile/web/src/App.test.jsx`
- Excluded paths: Docker configs, Go backend files, root configurations, and other plugins.

## Execution Scope
- Root: /home/wilox/projects/cpamc-auto-switcher
- Allowed Paths:
  - /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/web/src/**
- Writable Paths:
  - /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/web/src/**
- Allowed Bash:
  - cd /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/web && npm test
- Notes: Modifications are strictly confined to plugins/visual-profile/web/src. Backend, Docker, and other plugin paths are strictly excluded.

## MINI-001: Auto-Update Preference Checkbox in Maintenance View
- Contract: Add a user-configurable setting checkbox in `Maintenance.jsx` allowing users to enable or disable automatic console updates on boot. Persist setting in browser `localStorage` under key `auto_update_console_on_boot` (`'true'` or `'false'`). Default to enabled (`'true'`) when unconfigured or read from storage.
- Acceptance:
  1. Checkbox element with `data-testid="chk-auto-update-console"` rendered in `Maintenance.jsx` (within the console card or phase configuration area).
  2. Initial state reflects `localStorage.getItem('auto_update_console_on_boot') !== 'false'`.
  3. Clicking the checkbox toggles the value and immediately persists the updated boolean string (`'true'` or `'false'`) in `localStorage`.
  4. Unit/component tests in `Maintenance.test.jsx` verify default state, user toggle interaction, and `localStorage` persistence.
- Canonical sources:
  - `plugins/visual-profile/web/src/components/Maintenance.jsx`
  - `plugins/visual-profile/web/src/components/Maintenance.test.jsx`
- Validation:
  - Run `cd /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/web && npm test -- src/components/Maintenance.test.jsx`
- Depends on: None

## MINI-002: Startup Cooldown & Background Auto-Update Orchestration
- Contract: In `App.jsx`, execute a background version check and update routine upon successful authentication/mount when `auto_update_console_on_boot` is enabled:
  1. Inspect `localStorage.getItem('auto_update_console_on_boot')`. If `'false'`, skip background check.
  2. Inspect `localStorage.getItem('last_console_check_ts')`. If less than 6 hours (21,600,000 ms) have elapsed since the recorded timestamp, skip check to avoid GitHub API rate limits.
  3. When cooldown has elapsed and setting is enabled:
     - Update `last_console_check_ts` with current timestamp (`Date.now().toString()`).
     - Call `scanSystemHealth()`.
     - If `res.console_update_available` is true and `res.console_latest_github` is present:
       - Invoke `updateManagementConsole()`.
       - Upon resolution, trigger notification state with the updated target version string (`res.console_latest_github`).
  4. Non-blocking error handling: Any network or API failure during background scan/update must be caught and logged without disrupting application bootstrap or profile loading.
- Acceptance:
  1. Does not call `scanSystemHealth` or `updateManagementConsole` if `auto_update_console_on_boot` is `'false'`.
  2. Does not call `scanSystemHealth` or `updateManagementConsole` if last check occurred within 6 hours.
  3. Calls `scanSystemHealth` and then `updateManagementConsole` when preference is enabled and cooldown elapsed.
  4. Updates `last_console_check_ts` upon check execution.
  5. Any caught exception in background check does not throw or break the app status.
- Canonical sources:
  - `plugins/visual-profile/web/src/App.jsx`
  - `plugins/visual-profile/web/src/api/managementClient.js`
  - `plugins/visual-profile/web/src/App.test.jsx`
- Validation:
  - Run `cd /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/web && npm test -- src/App.test.jsx`
- Depends on: MINI-001

## MINI-003: 12-Second Auto-Dismissing Toast Notification
- Contract: In `App.jsx`, render a floating notification toast when the background console auto-update successfully completes:
  1. Content message: `⚡ AUTO SWITCHER PRO: Consola de Gestión actualizada automáticamente a la versión [vX.Y.Z] (Oficial).` where `[vX.Y.Z]` is replaced with the target version (e.g., `res.console_latest_github`).
  2. Include an explicit manual dismiss button (`×`) with `data-testid="btn-close-console-toast"`.
  3. Include an automatic timer that dismisses the toast after exactly 12 seconds (12000 ms).
  4. Clear timer on unmount or manual dismiss to prevent memory leaks or dangling timers.
- Acceptance:
  1. Element `data-testid="toast-auto-update-console"` appears when background update finishes.
  2. Element displays the exact formatted message with the target version string.
  3. Clicking manual close button dismisses the toast immediately.
  4. Using Vitest fake timers (`vi.advanceTimersByTime(12000)`), the toast disappears automatically after 12 seconds.
- Canonical sources:
  - `plugins/visual-profile/web/src/App.jsx`
  - `plugins/visual-profile/web/src/App.test.jsx`
- Validation:
  - Run `cd /home/wilox/projects/cpamc-auto-switcher/plugins/visual-profile/web && npm test -- src/App.test.jsx`
- Depends on: MINI-002

## Risks & Constraints
- Rate limiting: GitHub API can throttle requests if polled repeatedly; 6-hour cooldown strictly enforces safe intervals.
- Concurrent updates: If the user simultaneously clicks manual update in Maintenance view, state must not clash; background check only triggers on boot.
- Timer leaks: 12-second toast timeout must clean up its `setTimeout` ID on component unmount or manual dismiss.
- Non-blocking execution: Background check must never delay initial profile graph loading or block UI rendering.

## Open Decisions
- None. All requirements, storage keys, cooldown duration (6h), and notification dismissal timing (12s) are concrete and approved.

## Next Permitted Action
- Orchestrator Pre-Mutation Summary Gate for user approval prior to implementation.
