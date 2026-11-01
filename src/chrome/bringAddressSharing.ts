/**
 * When the wallet address may go to Bring, the cashback partner.
 *
 * The "Shop & Earn popups" switch in Advanced settings is Bring's own global
 * opt-out (the SDK's setTurnOff / getTurnOff). It is the single source of truth:
 * Bring's popup can set it too ("don't show for N days"), and the switch shows
 * whatever it holds, so a separate Gero flag would drift from what the user sees.
 *
 * The SDK keeps it in chrome.storage.local under `bring_optOut` as a
 * `[startMs, endMs]` window; the user is opted out while now is inside it, and
 * setTurnOff(true) writes `[now, now + Number.MAX_SAFE_INTEGER]`. The build fails
 * if the bundled SDK stops matching that format (scripts/bring-sdk-patch.mjs
 * pins it), and anything unrecognised here reads as opted out.
 */

import { debugLog } from '@/utils/debug';

export const BRING_OPT_OUT_KEY = 'bring_optOut';

/** Whether a stored `bring_optOut` value means cashback is turned off at `now`. */
export function isBringOptedOut(value: unknown, now: number = Date.now()): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) {
    const [start, end] = value as unknown[];
    if (value.length === 2 && typeof start === 'number' && typeof end === 'number' && start <= end) {
      return now >= start && now <= end;
    }
    return true;
  }
  // Older SDKs stored only the end timestamp; the SDK migrates it on update.
  if (typeof value === 'number' && Number.isFinite(value)) return value > now;
  // A format this code was not reviewed against: keep the address private.
  return true;
}

type LocalStorageArea = Pick<chrome.storage.LocalStorageArea, 'get'>;

/** Reads the opt-out. Fails closed: an unreadable value counts as opted out. */
export async function readBringOptOut(storage: LocalStorageArea = chrome.storage.local): Promise<boolean> {
  try {
    const stored = await storage.get(BRING_OPT_OUT_KEY);
    return isBringOptedOut((stored as Record<string, unknown> | undefined)?.[BRING_OPT_OUT_KEY]);
  } catch {
    return true;
  }
}

export interface AddressRequest {
  /** The relay-stamped page origin. Absent only on our own content script's call for Bring. */
  origin: string | undefined;
  locked: boolean;
  isWhitelisted: (origin: string) => boolean;
  bringOptedOut: () => Promise<boolean>;
}

/**
 * The address goes to a connected dApp (page requests always carry an origin),
 * or, from our own content script, to Bring while cashback is on. Never while
 * the wallet is locked.
 */
export async function mayReleaseAddress(request: AddressRequest): Promise<boolean> {
  if (request.locked) return false;
  if (request.origin !== undefined) return request.isWhitelisted(request.origin);
  return !(await request.bringOptedOut());
}

/**
 * Has the Bring SDK's worker drop the address it stored, through the SDK's own
 * message (an empty WALLET_ADDRESS_UPDATE removes it; the patch pins that).
 * Called when the user turns cashback off.
 */
export function forgetBringWalletAddress(): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ from: 'bringweb3', action: 'WALLET_ADDRESS_UPDATE' }, () => {
        // Reading lastError marks it handled. No receiver means nothing to forget.
        if (chrome.runtime.lastError) debugLog('Bring worker did not answer the address reset');
        resolve();
      });
    } catch {
      resolve();
    }
  });
}
