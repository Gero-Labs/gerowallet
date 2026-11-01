/**
 * The copy of the remote feature flags that the background reads.
 *
 * The flag service is EventSource-based and only runs in the UI contexts, so the
 * UI mirrors its values for the service worker. The mirror used to live in
 * chrome.storage.local, which every content script (and the Bring SDK inside
 * ours) can rewrite, and the worker based security decisions on it: which dApps
 * may draw on Gero's pooled collateral, whether WalletConnect, CIP-45 and
 * cross-device signing are on, which secret envelope to write. It now lives in
 * the extension-origin private store, which content scripts cannot open.
 *
 * Nothing is carried over from the old chrome.storage copy: it may have been
 * written by a page. Until a UI context next loads the flags, every reader sees
 * an empty mirror and falls back to its own default.
 */
import { getPrivate, setPrivate } from '@/utils/privateStore';

export const FEATURE_FLAG_MIRROR_KEY = 'featureFlags';

export type FeatureFlagMirror = Record<string, unknown>;

function isPlainRecord(value: unknown): value is FeatureFlagMirror {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The mirrored flags; empty when nothing was mirrored yet or the store is unreadable. */
export async function readFeatureFlagMirror(): Promise<FeatureFlagMirror> {
  try {
    const value = await getPrivate(FEATURE_FLAG_MIRROR_KEY);
    return isPlainRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/** Replace the mirror, and drop the copy older releases kept in chrome.storage.local. */
export async function writeFeatureFlagMirror(flags: FeatureFlagMirror): Promise<void> {
  await setPrivate(FEATURE_FLAG_MIRROR_KEY, JSON.parse(JSON.stringify(flags)));
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.remove(FEATURE_FLAG_MIRROR_KEY);
    } catch {
      // A stale copy is harmless now that nothing reads it.
    }
  }
}
