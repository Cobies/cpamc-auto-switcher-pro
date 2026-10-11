/**
 * Utility to notify CPAMC host console (management.html)
 * to reload plugin routes and re-render the sidebar navigation tree.
 */
export function triggerCPAMCSidebarRefresh() {
  if (typeof window === 'undefined') return false;

  let refreshed = false;
  try {
    const refreshEvent = new Event('plugin-resources-refresh');

    // 1. Dispatch on parent window (when embedded inside CPAMC iframe)
    if (window.parent && window.parent !== window) {
      window.parent.dispatchEvent(refreshEvent);
      refreshed = true;
    }

    // 2. Dispatch on current window as well
    window.dispatchEvent(refreshEvent);
    refreshed = true;
  } catch (err) {
    console.warn('Failed to dispatch plugin-resources-refresh:', err);
  }

  return refreshed;
}
