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
// STORAGE: its own extension-origin IndexedDB (`gero-midnight-wallet-state`).
// A synced ZswapLocalState carries the wallet's shielded coins, nullifiers and a
// commitment tree: multi-MB, and private. It used to live in chrome.storage.local,
// which every content script can read and rewrite (Gero's own, and the Bring SDK
// inside it, in every frame of every tab), and whose writes are copied into every
// storage.onChanged listener. Content scripts cannot open this database. The old
// chrome.storage copies are deleted once (purgeLegacyChromeWalletState), never
// read: a page could have written them, and a miss only costs one cold sync.
// State survives SW eviction, which is exactly the lifetime we need. Keyed by
// network + wallet-kind + a non-reversible hash of the wallet's identifying
// secret seed, so two networks / two wallets / two roles never collide and a
// restore can never load another wallet's state.
//
// CORRECTNESS: restore resets `isConnected=false`; the wallet still needs one
// post-restore event for the SyncProgress to flip complete. On a non-empty
// ledger that arrives quickly; on an empty ledger the caller's bounded-timeout
// wrapper around `waitForSyncedState` handles it (same path as cold sync). A
// schema-version + network + kind guard on read means a stale/foreign blob is
// silently ignored and we fall back to cold init — never a wrong restore.

import Dexie, { type Table } from 'dexie';
import { sha256 } from '@noble/hashes/sha2.js';
import { debugLog } from '@/utils/debug';

/** Bumped if the persisted shape or the SDK serialization contract changes. */
const SCHEMA_VERSION = 1;

// Indexer event IDs are provider-specific (each indexer database numbers its
// ledger events itself), so checkpoints made against one provider must not
// resume against another. Bump a network's version whenever its provider
// changes.
// - mainnet 2: Foundation -> Blockfrost (#1236). Moving to Gero's self-hosted
//   indexer (via gero-sync) keeps 2: its ids matched Blockfrost's at the
//   checked points (2026-10-03). Bump to 3 if the final dust-numbering check
//   before the switch shows a mismatch.
// - preprod 2: Foundation -> Gero's self-hosted indexer. The Foundation's
//   preprod indexer has a 22-id hole (989781-989802, midnight-wallet#781), so
//   its checkpoints cannot carry over.
// - mainnet 3, preprod 3: the ledger 9 upgrade. It reset DUST once at the
//   crossing and invalidates ledger 8 checkpoints: a ledger 8 SDK checkpoint
//   is no state a ledger 9 wallet can resume.
//   The ledger 9 shielded checkpoints live under their own chain-identity
//   namespace (midnightCheckpointNamespace) and are not affected.
function schemaVersion(network: string): number {
  switch (network) {
    case 'mainnet':
    case 'midnight-mainnet':
    case 'preprod':
    case 'midnight-preprod':
      return 3;
    default:
      return SCHEMA_VERSION;
  }
}
const KEY_PREFIX = 'midnight_wallet_state';

/**
 * `dust-light9`: the ledger 9 DUST light sync's spend checkpoint (midnightDustSpendCheckpoint.ts).
 * `shielded-sync9`: the ledger 9 private sync's own checkpoint, a shielded state and the
 * history saved with it (`loadPrivateSyncCheckpoint`).
 */
export type MidnightWalletKind = 'dust' | 'shielded' | 'unshielded' | 'dust-light9' | 'shielded-sync9';

interface PersistedWalletState {
  schemaVersion: number;
  network: string;
  kind: MidnightWalletKind;
  /** Opaque SDK `serializeState()` output. Never parsed here. */
  serializedState: string;
  savedAt: number;
}

export interface StoredWalletState extends PersistedWalletState {
  key: string;
}

/**
 * Where the rows live. The extension uses its own IndexedDB (Dexie, below);
 * another host of these modules (the mobile apps' bundle) supplies a small
 * adapter with `setMidnightWalletStateStore` instead of rewriting this file.
 * Rows are opaque to the store: keys are already one-way hashes, values are
 * the SDK's serialized state.
 */
export interface MidnightWalletStateStore {
  get(key: string): Promise<StoredWalletState | undefined>;
  put(row: StoredWalletState): Promise<void>;
  delete(key: string): Promise<void>;
  /** Delete every row whose key starts with one of `prefixes`. Throws when it cannot. */
  deleteByPrefixes(prefixes: string[]): Promise<void>;
}

class MidnightWalletStateDb extends Dexie {
  states!: Table<StoredWalletState, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('gero-midnight-wallet-state');
    this.version(1).stores({ states: 'key', meta: 'key' });
  }
}

let db: MidnightWalletStateDb | null = null;

function stateDb(): MidnightWalletStateDb {
  if (!db) db = new MidnightWalletStateDb();
  return db;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** The extension's store: its own extension-origin IndexedDB. */
const dexieStore: MidnightWalletStateStore = {
  get: (key) => stateDb().states.get(key),
  put: async (row) => { await stateDb().states.put(row); },
  delete: (key) => stateDb().states.delete(key),
  deleteByPrefixes: async (prefixes) => { await stateDb().states.where('key').startsWithAnyOf(prefixes).delete(); },
};

let injectedStore: MidnightWalletStateStore | null = null;

/** Replace the store (a host without IndexedDB), or pass null to go back to the extension's. */
export function setMidnightWalletStateStore(store: MidnightWalletStateStore | null): void {
  injectedStore = store;
}

/** The store in use, or null when there is none (no IndexedDB and nothing injected): every call is then a miss. */
function activeStore(): MidnightWalletStateStore | null {
  if (injectedStore) return injectedStore;
  return hasIndexedDb() ? dexieStore : null;
}

const LEGACY_PURGED = 'legacyChromeStoragePurged';
let legacyPurge: Promise<void> | null = null;

/**
 * Delete the state blobs older releases kept in chrome.storage.local, once per
 * profile (recorded in this database). Nothing is carried over: a content script
 * could have written them, and the cache rebuilds itself with a cold sync.
 */
export function purgeLegacyChromeWalletState(): Promise<void> {
  if (!legacyPurge) {
    legacyPurge = (async () => {
      if (!hasIndexedDb()) return;
      if ((await stateDb().meta.get(LEGACY_PURGED))?.value === true) return;
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const all = (await chrome.storage.local.get(null)) ?? {};
        const keys = Object.keys(all).filter((key) => key.startsWith(`${KEY_PREFIX}_`));
        if (keys.length > 0) await chrome.storage.local.remove(keys);
        debugLog(`🌙 wallet-state: removed ${keys.length} legacy chrome.storage blob(s)`);
      }
      await stateDb().meta.put({ key: LEGACY_PURGED, value: true });
    })().catch((e) => {
      legacyPurge = null; // retried on the next call
      debugLog('🌙 wallet-state legacy purge failed (retried later)', e);
    });
  }
  return legacyPurge;
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
  return `${walletStateKindPrefix(network, kind)}${idHash}`;
}

/** The key prefix of every wallet's `kind` state on `network`, for clearing them without a seed. */
export function walletStateKindPrefix(network: string, kind: MidnightWalletKind): string {
  return `${KEY_PREFIX}_${network}_${kind}_`;
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
  const store = activeStore();
  if (!store) return null;
  if (!injectedStore) void purgeLegacyChromeWalletState();
  const key = storageKey(network, kind, identitySeed);
  try {
    const blob = await store.get(key);
    if (
      !blob
      || blob.schemaVersion !== schemaVersion(network)
      || blob.network !== network
      || blob.kind !== kind
      || typeof blob.serializedState !== 'string'
      || blob.serializedState.length === 0
    ) {
      return null;
    }
    const ageMs = Date.now() - (blob.savedAt ?? 0);
    debugLog(`🌙 wallet-state HIT: ${kind}/${network} (age=${Math.round(ageMs / 1000)}s) — restoring warm`);
    return blob.serializedState;
  } catch (e) {
    debugLog('🌙 wallet-state load error (cold fallback)', e);
    return null;
  }
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
  // Keyed before the first await: the caller may wipe the seed as soon as this returns.
  await putWalletState(storageKey(network, kind, identitySeed), network, kind, serializedState);
}

/**
 * A writer for one wallet's row whose writes are stored in the order they were
 * asked for, one at a time. Separate `saveWalletState` calls promise no order: a
 * slow earlier write could replace a later one. The seed is hashed here, once;
 * the writer keeps the row key, never the seed, so the caller may wipe the seed
 * while writes are still queued. As best-effort as `saveWalletState`: a write the
 * store never finishes holds back this writer's later ones.
 */
export function walletStateWriter(
  network: string,
  kind: MidnightWalletKind,
  identitySeed: Uint8Array,
): (serializedState: string) => Promise<void> {
  const key = storageKey(network, kind, identitySeed);
  let tail: Promise<void> = Promise.resolve();
  return (serializedState) => {
    const write = () => putWalletState(key, network, kind, serializedState);
    tail = tail.then(write, write);
    return tail;
  };
}

async function putWalletState(key: string, network: string, kind: MidnightWalletKind, serializedState: string): Promise<void> {
  const store = activeStore();
  if (!store) return;
  if (typeof serializedState !== 'string' || serializedState.length === 0) return;
  if (!injectedStore) void purgeLegacyChromeWalletState();
  try {
    await store.put({
      key,
      schemaVersion: schemaVersion(network),
      network,
      kind,
      serializedState,
      savedAt: Date.now(),
    });
    debugLog(`🌙 wallet-state SAVED: ${kind}/${network} (${serializedState.length} chars)`);
  } catch (e) {
    debugLog('🌙 wallet-state save failed (non-fatal)', e);
  }
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
  const store = activeStore();
  if (!store) return;
  try {
    await store.delete(storageKey(network, kind, identitySeed));
  } catch {
    // Best-effort: the next restore fails the same way and clears again.
  }
}

/**
 * The ledger 9 private sync's own checkpoint: a shielded wallet state and the
 * transaction history saved with it, in ONE row. Its own row, not the
 * `shielded` one: the shielded send path writes that row too, with no history,
 * and this one must never resume a state its history has not caught up with.
 */
export interface PrivateSyncCheckpoint {
  /** The SDK's serialized shielded state. */
  state: string;
  /** The SDK's serialized transaction history (`InMemoryTransactionHistoryStorage.serialize()`). */
  history: string;
}

const PRIVATE_SYNC_KIND: MidnightWalletKind = 'shielded-sync9';
const PRIVATE_SYNC_FORMAT = 1;

/** The private sync's checkpoint, or null (cold replay): none, damaged or of another format. */
export async function loadPrivateSyncCheckpoint(namespace: string, identitySeed: Uint8Array): Promise<PrivateSyncCheckpoint | null> {
  const raw = await loadWalletState(namespace, PRIVATE_SYNC_KIND, identitySeed);
  if (!raw) return null;
  let record: unknown;
  try { record = JSON.parse(raw); } catch { return null; }
  const { v, state, history } = (record ?? {}) as { v?: unknown; state?: unknown; history?: unknown };
  if (v !== PRIVATE_SYNC_FORMAT || typeof state !== 'string' || state.length === 0 || typeof history !== 'string') return null;
  return { state, history };
}

/**
 * Save the private sync's checkpoint. The caller decides which state is safe
 * to save: one whose history is complete (midnightPrivateSync.ts saves only a
 * state that has settled past the SDK's history lookups).
 */
export async function savePrivateSyncCheckpoint(namespace: string, identitySeed: Uint8Array, checkpoint: PrivateSyncCheckpoint): Promise<void> {
  if (typeof checkpoint.state !== 'string' || checkpoint.state.length === 0 || typeof checkpoint.history !== 'string') return;
  await saveWalletState(namespace, PRIVATE_SYNC_KIND, identitySeed,
    JSON.stringify({ v: PRIVATE_SYNC_FORMAT, state: checkpoint.state, history: checkpoint.history }));
}

/** Drop the private sync's checkpoint (unreadable, or of another key). Never the send path's `shielded` row. */
export async function clearPrivateSyncCheckpoint(namespace: string, identitySeed: Uint8Array): Promise<void> {
  await clearWalletState(namespace, PRIVATE_SYNC_KIND, identitySeed);
}

/**
 * Delete every state blob whose key starts with one of `prefixes`. Throws when
 * the database cannot be written, so a caller that must not resume stale state
 * (a chain reset) can tell.
 */
export async function clearWalletStatesByPrefix(prefixes: string[]): Promise<void> {
  const store = activeStore();
  if (!store || prefixes.length === 0) return;
  await store.deleteByPrefixes(prefixes);
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
 * Callable from the worker and the extension pages, which share this database.
 * Pairs with the gero-sync cursor reset in midnight-sync.service's forceResync
 * so one action clears both halves of the warm state.
 */
export async function clearAllWalletState(network?: string): Promise<void> {
  const prefix = network ? `${KEY_PREFIX}_${network}_` : `${KEY_PREFIX}_`;
  try {
    await clearWalletStatesByPrefix([prefix]);
    debugLog(`🌙 wallet-state clear-all done${network ? ` for ${network}` : ''}`);
  } catch (e) {
    debugLog('🌙 wallet-state clear-all failed (non-fatal)', e);
  }
}

/** Test seam: drop the cached connection and the purge memo so a fresh fake IndexedDB can be installed. */
export function resetMidnightWalletStateDbForTest(): void {
  db?.close();
  db = null;
  legacyPurge = null;
}

/** Test seam: the stored rows. */
export function midnightWalletStatesForTest(): Table<StoredWalletState, string> {
  return stateDb().states;
}
