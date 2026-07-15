/**
 * In-memory (RAM-only) store for the Midnight zswap viewing key.
 *
 * WHY THIS EXISTS
 * The viewing key (`mn_shield-esk_…`) is encryption SECRET-key material: anyone
 * who holds it can decrypt every incoming shielded note for the wallet, forever
 * (see `MidnightAddresses.zswapViewingKey`). It is exactly as sensitive as the
 * mnemonic, yet historically it was persisted in PLAINTEXT on the wallet record
 * (and fanned out to `chrome.storage.local` snapshots) so the passwordless MV3
 * service-worker cold-start (`background.ts` → `walletManager.login`) could
 * resume shielded sync without re-decrypting the mnemonic.
 *
 * `chrome.storage.session` fixes the at-rest problem: it lives only in RAM,
 * survives service-worker restarts WITHIN a browser session, and is cleared the
 * moment the browser fully closes — so nothing is ever written to disk. The key
 * is re-derived from the mnemonic (a deterministic HD derivation, see
 * `midnightKeyManager.deriveMidnightAddresses`) at each credentialed moment
 * (login-with-password / unlock / PassKey ceremony) and stashed here for the
 * rest of the browser session. Trade-off: after a full browser restart, shielded
 * balances are unavailable until the next unlock — unshielded sync is
 * unaffected. For a privacy chain that is a defensible posture.
 *
 * BACKGROUND-CONTEXT ONLY. Browser contexts (options/popup/sidepanel) must never
 * read or write the raw key; they consume the `shieldedSyncAvailable` boolean
 * published by `midnightStore` instead. `chrome.storage.session`'s default
 * access level (TRUSTED_CONTEXTS) already excludes content scripts / web pages.
 *
 * Keyed by `${walletId}:${network}` because the encoded key is network-specific
 * (the bech32m HRP carries the network id), so the same wallet on preview vs
 * mainnet yields different encoded strings.
 */

const SESSION_STORE_KEY = 'midnightViewingKeys';

type ViewingKeyMap = Record<string, string>;

function entryKey(walletId: number | string, network: string): string {
  return `${walletId}:${network}`;
}

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
 * Stash the re-derived viewing key for this browser session. No-op if the key
 * is falsy (nothing to store) so callers can pass a maybe-undefined value.
 */
export async function setSessionViewingKey(
  walletId: number | string,
  network: string,
  viewingKey: string | undefined | null,
): Promise<void> {
  if (!viewingKey) return;
  const map = await readMap();
  map[entryKey(walletId, network)] = viewingKey;
  await writeMap(map);
}

/**
 * Read the session-cached viewing key, or `undefined` if it has not been
 * re-derived yet this browser session (fresh start before first unlock).
 */
export async function getSessionViewingKey(
  walletId: number | string,
  network: string,
): Promise<string | undefined> {
  const map = await readMap();
  return map[entryKey(walletId, network)];
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
