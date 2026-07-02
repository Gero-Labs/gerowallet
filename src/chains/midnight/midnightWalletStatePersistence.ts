// Persistence for the Midnight SDK wallets' serialized sync state.
//
// WHY: the dust + shielded wallets must `waitForSyncedState()` before they can
// balance/build a transaction. A cold sync walks the indexer from genesis —
// 30s to several minutes on preprod/mainnet — on EVERY send, because the BG
// service worker builds a fresh wallet per operation and MV3 evicts it after.
//
// The SDK exposes `serializeState()` / `restore(serialized)` on all three
// wallet types (dust 4.1.0, shielded 3.0.1, unshielded 3.1.0 — verified
// present in the installed versions). Persisting the serialized state and
// restoring it on the next send lets the wallet resume from its saved
// `appliedIndex` cursor and only catch up events since then, instead of
// replaying the whole chain. This mirrors what Nexus's sidecar already does
// server-side via its `midnight_wallet_state` Postgres table.
//
// STORAGE: `chrome.storage.local` (the extension has `unlimitedStorage`, so
// the per-item 10 MiB default quota is lifted — relevant because a synced
// ZswapLocalState carries a commitment tree). State survives SW eviction,
// which is exactly the lifetime we need. Keyed by network + wallet-kind + a
// non-reversible hash of the wallet's identifying secret seed, so two
// networks / two wallets / two roles never collide and a restore can never
// load another wallet's state.
//
// CORRECTNESS: restore resets `isConnected=false`; the wallet still needs one
// post-restore event for the SyncProgress to flip complete. On a non-empty
// ledger that arrives quickly; on an empty ledger the caller's bounded-timeout
// wrapper around `waitForSyncedState` handles it (same path as cold sync). A
// schema-version + network + kind guard on read means a stale/foreign blob is
// silently ignored and we fall back to cold init — never a wrong restore.

import { sha256 } from '@noble/hashes/sha2.js';
import { debugLog } from '@/utils/debug';

/** Bumped if the persisted shape or the SDK serialization contract changes. */
const SCHEMA_VERSION = 1;
const KEY_PREFIX = 'midnight_wallet_state';

export type MidnightWalletKind = 'dust' | 'shielded' | 'unshielded';

interface PersistedWalletState {
  schemaVersion: number;
  network: string;
  kind: MidnightWalletKind;
  /** Opaque SDK `serializeState()` output. Never parsed here. */
  serializedState: string;
  savedAt: number;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 1) s += b[i].toString(16).padStart(2, '0');
  return s;
}

/**
 * Storage key for a wallet's state. The identity is a SHA-256 of the wallet's
 * secret seed (dust seed / zswap seed / unshielded secret key), truncated to
 * 16 bytes. One-way — storing it leaks nothing about the secret — but stable
 * per (wallet, role), so the same wallet round-trips to the same key.
 */
function storageKey(network: string, kind: MidnightWalletKind, identitySeed: Uint8Array): string {
  const idHash = bytesToHex(sha256(identitySeed)).slice(0, 32);
  return `${KEY_PREFIX}_${network}_${kind}_${idHash}`;
}

/**
 * Load a previously-persisted serialized state, or null if none / stale /
 * foreign. A null return MUST make the caller fall back to a cold
 * `startWith*` — never treat absence as an error.
 */
export async function loadWalletState(
  network: string,
  kind: MidnightWalletKind,
  identitySeed: Uint8Array,
): Promise<string | null> {
  if (!hasChromeStorage()) return null;
  const key = storageKey(network, kind, identitySeed);
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime?.lastError) {
          debugLog('🌙 wallet-state load error (cold fallback)', chrome.runtime.lastError);
          resolve(null);
          return;
        }
        const blob = result?.[key] as PersistedWalletState | undefined;
        if (
          !blob
          || blob.schemaVersion !== SCHEMA_VERSION
          || blob.network !== network
          || blob.kind !== kind
          || typeof blob.serializedState !== 'string'
          || blob.serializedState.length === 0
        ) {
          resolve(null);
          return;
        }
        const ageMs = Date.now() - (blob.savedAt ?? 0);
        debugLog(`🌙 wallet-state HIT: ${kind}/${network} (age=${Math.round(ageMs / 1000)}s) — restoring warm`);
        resolve(blob.serializedState);
      });
    } catch (e) {
      debugLog('🌙 wallet-state load threw (cold fallback)', e);
      resolve(null);
    }
  });
}

/**
 * Persist the wallet's serialized state. Best-effort: a write failure (quota,
 * SW teardown) is logged and swallowed — it only costs a cold sync next time,
 * never a correctness problem.
 */
export async function saveWalletState(
  network: string,
  kind: MidnightWalletKind,
  identitySeed: Uint8Array,
  serializedState: string,
): Promise<void> {
  if (!hasChromeStorage()) return;
  if (typeof serializedState !== 'string' || serializedState.length === 0) return;
  const key = storageKey(network, kind, identitySeed);
  const blob: PersistedWalletState = {
    schemaVersion: SCHEMA_VERSION,
    network,
    kind,
    serializedState,
    savedAt: Date.now(),
  };
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [key]: blob }, () => {
        if (chrome.runtime?.lastError) {
          debugLog('🌙 wallet-state save failed (non-fatal)', chrome.runtime.lastError);
        } else {
          debugLog(`🌙 wallet-state SAVED: ${kind}/${network} (${serializedState.length} chars)`);
        }
        resolve();
      });
    } catch (e) {
      debugLog('🌙 wallet-state save threw (non-fatal)', e);
      resolve();
    }
  });
}

/**
 * Drop persisted state for one wallet — used when the SDK's `restore()` throws
 * (corrupt/incompatible blob) so the next send doesn't keep retrying a bad
 * restore. The caller cold-inits this run regardless.
 */
export async function clearWalletState(
  network: string,
  kind: MidnightWalletKind,
  identitySeed: Uint8Array,
): Promise<void> {
  if (!hasChromeStorage()) return;
  const key = storageKey(network, kind, identitySeed);
  return new Promise((resolve) => {
    try {
      chrome.storage.local.remove(key, () => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * Drop ALL persisted Midnight wallet-state blobs (every network / kind /
 * wallet), or just those for one network when `network` is given. This is the
 * "reset wallet cache / force full re-sync" escape hatch — modelled after
 * Dynamic.xyz's `resetWalletCache()`, which they document as a last resort
 * that "clears the wallet's persisted state and forces a full cold re-sync".
 *
 * We can't derive a specific wallet's storage key without its secret seed
 * (the key is a hash of it), so a user-facing reset must clear by prefix.
 * Callable from any context since it only touches chrome.storage.local
 * (shared across BG + browser). Pairs with the gero-sync cursor reset in
 * midnight-sync.service's forceResync so one action clears both halves of the
 * warm state.
 */
export async function clearAllWalletState(network?: string): Promise<void> {
  if (!hasChromeStorage()) return;
  const wantPrefix = network ? `${KEY_PREFIX}_${network}_` : `${KEY_PREFIX}_`;
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(null, (all) => {
        if (chrome.runtime?.lastError) {
          debugLog('🌙 wallet-state clear-all: get failed', chrome.runtime.lastError);
          resolve();
          return;
        }
        const toRemove = Object.keys(all ?? {}).filter((k) => k.startsWith(wantPrefix));
        if (toRemove.length === 0) {
          resolve();
          return;
        }
        chrome.storage.local.remove(toRemove, () => {
          debugLog(`🌙 wallet-state clear-all: removed ${toRemove.length} blob(s)${network ? ` for ${network}` : ''}`);
          resolve();
        });
      });
    } catch (e) {
      debugLog('🌙 wallet-state clear-all threw (non-fatal)', e);
      resolve();
    }
  });
}
