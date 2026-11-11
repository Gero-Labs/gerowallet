/**
 * "Check for update" and "Restart GeroWallet to finish updating".
 *
 * `chrome.runtime.requestUpdateCheck()` asks the store for a newer version now
 * instead of at Chrome's next automatic check. It exists in every
 * Chromium-based browser the extension installs into from the Chrome Web
 * Store (Chrome, Edge, Brave, Opera); where it doesn't, the button is not
 * offered and the "update required" text stands alone. A found update is
 * downloaded but only installed when the extension restarts, which
 * `chrome.runtime.reload()` does.
 *
 * Chrome answers `update_available`, `no_update` or `throttled` (asked too
 * often). Everything but `update_available`, including an error and no answer
 * at all, reads as "no update yet", so the user is never left without a message.
 */

export type ExtensionUpdateCheck = 'available' | 'none';

/** How long to wait for Chrome's answer before saying there is no update yet. */
export const UPDATE_CHECK_TIMEOUT_MS = 20_000;

type UpdateCheckRuntime = {
  requestUpdateCheck?: (callback: (status: string, details?: { version?: string }) => void) => void;
  reload?: () => void;
  lastError?: unknown;
};

function runtime(): UpdateCheckRuntime | undefined {
  try {
    return typeof chrome !== 'undefined' ? (chrome.runtime as unknown as UpdateCheckRuntime) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether this browser can be asked for an update check. */
export function canCheckForExtensionUpdate(): boolean {
  return typeof runtime()?.requestUpdateCheck === 'function';
}

/** Ask the store for a newer version of the extension. Never throws. */
export function checkForExtensionUpdate(timeoutMs: number = UPDATE_CHECK_TIMEOUT_MS): Promise<ExtensionUpdateCheck> {
  const rt = runtime();
  if (typeof rt?.requestUpdateCheck !== 'function') return Promise.resolve('none');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: ExtensionUpdateCheck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish('none'), timeoutMs);
    try {
      rt.requestUpdateCheck?.((status) => {
        // Read lastError so Chrome doesn't log it as unchecked; it means no answer.
        void rt.lastError;
        finish(status === 'update_available' ? 'available' : 'none');
      });
    } catch {
      finish('none');
    }
  });
}

/** Restart the extension so a downloaded update installs. Closes every GeroWallet page. */
export function restartExtensionForUpdate(): void {
  try {
    runtime()?.reload?.();
  } catch { /* nothing to restart outside the extension */ }
}
