/**
 * Remote kill-switch for CIP-113 programmable-token support.
 *
 * `cip113Deployments.ts` is a build-time constant: emptying it to turn the feature off
 * costs a rebuild plus a Web Store review, which is days. This flag is the runtime half —
 * gero-sync can take the whole surface down without a client release. Both gates must
 * pass, and either one alone disables CIP-113.
 *
 * Ships DARK (default false), like every other value-adjacent flag. Off is not a
 * degraded mode: `WalletBg.programmableBaseScriptHashes()` returns an empty set, so the
 * partition, the refusal index and the client-side credential filter all go back to
 * exactly what they were before CIP-113 existed.
 *
 * A flip is picked up immediately by the gate, but nothing re-partitions on its own: the
 * store reflects it from the next sync push (or the next login, which is also where the
 * gero-sync subscription is rebuilt with or without the server-side credential filter).
 *
 * Read from the `featureFlags` mirror in chrome.storage.local rather than
 * featureFlagsStore — the EventSource-based flag service cannot run in an MV3 service
 * worker, so the UI contexts mirror flag values there for the background to read.
 */
const FLAG_KEY = 'isCip113Enabled';

/** Last mirrored value. False until a refresh says otherwise, so a cold worker fails closed. */
let enabled = false;

let listening = false;

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
}

/**
 * Watch the mirror so a live flip lands without waiting for the next login. Registered on
 * the first refresh rather than at import time: this module is pulled into the options
 * bundle too, and there is nothing to listen to outside the extension.
 */
function startListening(): void {
  if (listening || !hasChromeStorage() || !chrome.storage.onChanged) return;
  listening = true;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes['featureFlags']) return;
    const flags = changes['featureFlags'].newValue as Record<string, unknown> | undefined;
    enabled = flags?.[FLAG_KEY] === true;
  });
}

/** Re-read the mirror. Call before anything that depends on the gate, e.g. at login. */
export async function refreshCip113Flag(): Promise<boolean> {
  if (!hasChromeStorage()) return enabled;
  startListening();
  try {
    const stored = await chrome.storage.local.get('featureFlags');
    const flags = (stored?.['featureFlags'] as Record<string, unknown>) ?? {};
    enabled = flags[FLAG_KEY] === true;
  } catch {
    // A mirror we cannot read is not a reason to enable a feature that ships dark.
    enabled = false;
  }
  return enabled;
}

/** Synchronous read of the last refreshed value — safe to call on hot paths. */
export function isCip113Enabled(): boolean {
  return enabled;
}

/** Test seam. Not used by production code. */
export function setCip113EnabledForTest(value: boolean): void {
  enabled = value;
}
