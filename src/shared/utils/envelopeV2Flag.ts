/**
 * Runtime kill switch for writing the `gpw2` secret envelope and for the
 * on-unlock migration to it (`isKeyEnvelopeV2Enabled`).
 *
 * Ships DARK (default false). Off means exactly the pre-gpw2 behaviour: writers
 * emit `gpw1` / raw PBKDF2 hex and nothing is migrated. Every release since the
 * reader-only one opens `gpw2`, so turning the flag off again never strands a
 * wallet that was already migrated — it only stops new `gpw2` writes.
 *
 * Read from the `featureFlags` mirror in chrome.storage.local (the UI contexts
 * mirror flag values there; the EventSource flag service cannot run in the MV3
 * service worker). Same pattern as `src/chrome/cip113Flag.ts`, but this module is
 * context-agnostic because writers run in the UI and in the background.
 */
const FLAG_KEY = 'isKeyEnvelopeV2Enabled';

let enabled = false;
let forced: boolean | null = null;

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
}

/**
 * Re-read the mirror. Writers and the migration call this before deciding the
 * format, so a flip applies to the next write without a restart. Any failure to
 * read reports false: an unreadable mirror is not a reason to change formats.
 */
export async function refreshEnvelopeV2Flag(): Promise<boolean> {
  if (forced !== null) return forced;
  if (!hasChromeStorage()) return enabled;
  try {
    const stored = await chrome.storage.local.get('featureFlags');
    const flags = (stored?.['featureFlags'] as Record<string, unknown>) ?? {};
    enabled = flags[FLAG_KEY] === true;
  } catch {
    enabled = false;
  }
  return enabled;
}

/** Test seam: pin the flag (or `null` to go back to the mirror). Not used by production code. */
export function setEnvelopeV2EnabledForTest(value: boolean | null): void {
  forced = value;
}
