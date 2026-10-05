/**
 * Purge of the legacy RAM-only Midnight viewing-key cache.
 *
 * Older releases stashed the zswap viewing key (`mn_shield-esk_…`, encryption
 * SECRET-key material: it decrypts every incoming shielded note of the wallet)
 * in `chrome.storage.session` so it could be sent to gero-sync after a
 * service-worker restart. Since PRIV-01 the key is neither sent nor stored:
 * the on-device private sync derives its keys from the seed at unlock. Only
 * the clear remains, so a session that predates the update is wiped on logout.
 *
 * BACKGROUND-CONTEXT ONLY.
 */

const SESSION_STORE_KEY = 'midnightViewingKeys';

type ViewingKeyMap = Record<string, string>;

function sessionArea() {
  // `session` is MV3-only; guard so this module is import-safe everywhere even
  // though it is only ever exercised in the background service worker. Return
  // type is inferred to avoid coupling to a specific @types/chrome type name.
  return (typeof chrome !== 'undefined' && chrome.storage?.session) || null;
}

async function readMap(): Promise<ViewingKeyMap> {
  const area = sessionArea();
  if (!area) return {};
  const res = await area.get(SESSION_STORE_KEY);
  const map = res?.[SESSION_STORE_KEY];
  return (map && typeof map === 'object' ? map : {}) as ViewingKeyMap;
}

async function writeMap(map: ViewingKeyMap): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.set({ [SESSION_STORE_KEY]: map });
}

/**
 * Drop the cached key(s). Pass a walletId to clear only that wallet's entries
 * (all its networks) on logout / wallet-switch; pass nothing to clear all.
 */
export async function clearSessionViewingKey(walletId?: number | string): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  if (walletId === undefined) {
    await area.remove(SESSION_STORE_KEY);
    return;
  }
  const map = await readMap();
  const prefix = `${walletId}:`;
  let changed = false;
  for (const k of Object.keys(map)) {
    if (k.startsWith(prefix)) {
      delete map[k];
      changed = true;
    }
  }
  if (changed) await writeMap(map);
}
