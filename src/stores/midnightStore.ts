/**
 * Midnight Wallet Store
 *
 * Vue Observable state for Midnight chain. Mirrors the broadcast/hydrate pattern
 * used by `walletStore.ts` and other per-chain stores:
 *
 * - **Background context** is the source of truth. It receives updates from
 *   gero-sync's `/ws/sync` (live tip + tx events for the active wallet's
 *   addresses) and from Nexus REST (DUST status, contract state, etc.) via
 *   `walletBg`/the network layer, then broadcasts via
 *   `backgroundStoreMessaging.broadcastUpdate(STORE_NAME, ...)`.
 * - **Browser contexts** (popup, options, sidepanel) subscribe via
 *   `storeMessaging.subscribe(STORE_NAME, ...)` and reflect the broadcast in
 *   their own `Vue.observable` copy. They also hydrate from `chrome.storage`
 *   on init for fast cold starts.
 * - **`broadcastFromBackground`** is the only mutation entry point — actions
 *   call it after updating the in-memory state. Never write to `chrome.storage`
 *   from outside this file.
 *
 * Persisted via `chrome.storage.local` under the key `midnightStore`. BigInt
 * values are serialized as strings (Chrome storage doesn't accept BigInt
 * natively) and deserialized on read.
 *
 * Ported 2026-05-04 from the `new-midnight-backup` prototype branch:
 * - Decoupled from the prototype's mock-data import path
 * - Type definitions now come from `@/chains/midnight/midnightTypes` with
 *   corrected NIGHT/DUST decimals (6/15 vs prototype's 12/12)
 * - `initializeMockData` action removed; replaced by `setActive` +
 *   per-event actions (`applyTipUpdate`, `applyTransaction`, ...) driven by
 *   gero-sync WS messages and Nexus REST responses
 */

import Vue from 'vue';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { debugLog } from '@/utils/debug';
import type {
  MidnightBalances,
  MidnightAddresses,
  MidnightTransaction,
  MidnightUnshieldedUtxo,
  MidnightDustState,
  DustRegistrationStatus,
} from '@/chains/midnight/midnightTypes';

/**
 * Live tip metadata as observed by gero-sync (or Nexus tip query). Block
 * height drives the wallet's "syncing" indicator and tx-history sort order.
 */
export interface MidnightChainTip {
  hash: string | null;
  height: number;
  timestamp: number; // Unix seconds
}

/**
 * One in-progress ZK proof generation. Used by the wallet UI to show a
 * spinner + stage label during the (~10s) proof gen on shielded sends.
 */
export interface MidnightProvingOperation {
  operationId: string;
  stage: 'preparing' | 'proving' | 'finalizing';
  progress: number; // 0-100
  startTime: number; // Unix ms
}

/**
 * Live progress of the DUST-ledger sync sub-step of a send, broadcast from
 * the background so the send dialog's stage timeline can show a real bar
 * instead of an indeterminate spinner. `null` when no send is in flight.
 *
 * Only the background-driven sub-steps live here (the DUST replay is the one
 * long, measurable phase). The dialog owns the high-level stage sequence
 * (authorize → build → sync → sign → submit) locally via its onStage
 * callback and attaches this percentage to whichever phase is active.
 */
export interface MidnightSendProgress {
  /** Which background phase this refers to (e.g. 'syncingDust'). */
  phase: 'syncingDust';
  /** 0-100 within the phase; -1 = indeterminate (highest not known yet). */
  percent: number;
  /** Optional human detail, e.g. "1,259,015 / 1,261,599 events". */
  detail?: string;
}

/**
 * Midnight wallet state. All fields are populated reactively as the wallet
 * receives gero-sync WS events and Nexus REST responses.
 */
export interface MidnightStore {
  /** Whether the user is currently logged into a Midnight wallet. */
  isActive: boolean;
  /** Last successful sync time, Unix ms. `null` until first event arrives. */
  lastSync: number | null;
  /** Current chain tip from gero-sync's live `blocks` subscription. */
  tip: MidnightChainTip;
  /** WS connection state to gero-sync — drives the dashboard's online indicator. */
  networkStatus: 'disconnected' | 'connecting' | 'connected' | 'error';

  /** Five-balance system — see `MidnightBalances` for unit conventions. */
  balances: MidnightBalances;

  /** Three-address system (shielded / unshielded / dust). */
  addresses: MidnightAddresses;

  /**
   * Transaction history, newest first. Populated by gero-sync's
   * `unshieldedTransactions` subscription (live + historical replay) and
   * the wallet's local note-tracking for shielded txs.
   */
  transactions: MidnightTransaction[];

  /** Unshielded UTxOs visible to this wallet, used by the DUST registration UI. */
  utxos: MidnightUnshieldedUtxo[];

  /** Composite DUST tank state, computed from balances + Nexus dust-status response. */
  dustState: MidnightDustState | null;

  /**
   * Live ZK proving operations keyed by operation id. Empty when no shielded
   * transactions are in flight. The wallet's send sheet renders one progress
   * indicator per entry while the SDK runs `finalizeRecipe`.
   */
  provingOperations: Map<string, MidnightProvingOperation>;

  /**
   * Highest indexer transactionId we've successfully applied to the UTxO set.
   * Persisted across reloads; on WS reconnect the wallet sends this value as
   * the `midnightLastTxId` resume cursor so gero-sync's subscription resumes
   * at {@code transactionId: lastMidnightTxId + 1} instead of replaying full
   * history. Null = never applied a tx (fresh install / cleared state).
   */
  lastMidnightTxId: number | null;

  /**
   * Record of the user's consent to send shielded-tx witness data through
   * Gero Cloud's proving service. Required before the first shielded send
   * and persisted so subsequent sends don't re-prompt — until the
   * {@code version} is bumped by a future plan change (e.g. proof-server
   * routing options diverge, or wording materially changes), at which
   * point the consent must be re-acquired.
   *
   * {@code null} → never accepted. The send dialog routes shielded sends
   * through the consent dialog first; cancelling the consent aborts the
   * send. Accepting writes {@code {version, acceptedAt}} here.
   */
  shieldedProvingConsent: { version: number; acceptedAt: number } | null;

  /**
   * Identity of the wallet whose balances/utxos/tx-history/cursor are
   * currently loaded — the active unshielded address (`mn_addr_<network>1…`),
   * unique per (wallet, network). Persisted so a cold start can detect that
   * the rehydrated state belongs to a DIFFERENT wallet/network than the one
   * now logging in.
   *
   * Without this, switching from wallet A (or preview) to wallet B (or
   * preprod) leaves A's persisted NIGHT balance on screen until the first
   * sync event arrives — and a tx with no matching owner never clears it,
   * so a stale balance can linger indefinitely (this is the class of bug
   * that made a switched wallet look funded when it wasn't). `setActive`
   * resets the per-wallet state whenever this key changes. Null = never set.
   */
  activeWalletKey: string | null;

  /**
   * Transient live progress of an in-flight send's background sub-step.
   * Deliberately NOT hydrated from chrome.storage on cold start (see the
   * hydrate block) so a reload can never resurrect a stale mid-send bar.
   * `null` whenever no send is running.
   */
  sendProgress: MidnightSendProgress | null;
}

/**
 * Current consent version. Bump only when the agreement materially
 * changes (e.g. proof-server-routing options land and require disclosure,
 * or the wording around what Gero servers see / log changes). A bump
 * invalidates every existing accepted record and re-prompts on next send.
 */
export const SHIELDED_PROVING_CONSENT_VERSION = 1;

const STORE_NAME = 'midnightStore';
const context = getContextType();

const EMPTY_BALANCES: MidnightBalances = {
  nightShielded: 0n,
  nightUnshielded: 0n,
  nightRegistered: 0n,
  dust: 0n,
  dustGenerating: 0n,
};

const EMPTY_ADDRESSES: MidnightAddresses = {
  dust: '',
  shielded: '',
  unshielded: '',
};

const EMPTY_TIP: MidnightChainTip = {
  hash: null,
  height: 0,
  timestamp: 0,
};

export const midnightStore = Vue.observable<MidnightStore>({
  isActive: false,
  lastSync: null,
  tip: { ...EMPTY_TIP },
  networkStatus: 'disconnected',
  balances: { ...EMPTY_BALANCES },
  addresses: { ...EMPTY_ADDRESSES },
  transactions: [],
  utxos: [],
  dustState: null,
  provingOperations: new Map(),
  lastMidnightTxId: null,
  shieldedProvingConsent: null,
  activeWalletKey: null,
  sendProgress: null,
});

// ---------------------------------------------------------------- serializer

/**
 * JSON.stringify replacer — converts BigInt → string and Map/Set → array forms.
 * Matches the project's standard pattern (see other stores' broadcastFromBackground).
 */
function serializeValue(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Map) return Array.from(value.entries());
  if (value instanceof Set) return Array.from(value);
  return value;
}

/** Canonical tx-hash key for dedup: lowercase, no leading `0x`. */
function normalizeTxHash(hash: string): string {
  const h = (hash || '').toLowerCase();
  return h.startsWith('0x') ? h.slice(2) : h;
}

// ---------------------------------------------------------------- hydration

function hydrateBalances(stored: any): MidnightBalances {
  if (!stored || typeof stored !== 'object') return { ...EMPTY_BALANCES };
  return {
    nightShielded: toBig(stored.nightShielded),
    nightUnshielded: toBig(stored.nightUnshielded),
    nightRegistered: toBig(stored.nightRegistered),
    dust: toBig(stored.dust),
    dustGenerating: toBig(stored.dustGenerating),
  };
}

function hydrateUtxos(stored: any): MidnightUnshieldedUtxo[] {
  if (!Array.isArray(stored)) return [];
  return stored.map((u: any): MidnightUnshieldedUtxo => ({
    owner: u.owner ?? '',
    tokenType: u.tokenType ?? '',
    value: toBig(u.value),
    intentHash: u.intentHash ?? '',
    outputIndex: u.outputIndex ?? 0,
    ctime: u.ctime,
    initialNonce: u.initialNonce ?? '',
    registeredForDustGeneration: !!u.registeredForDustGeneration,
  }));
}

function hydrateTransactions(stored: any): MidnightTransaction[] {
  if (!Array.isArray(stored)) return [];
  return stored.map((t: any): MidnightTransaction => ({
    hash: t.hash,
    type: t.type,
    token: t.token,
    amount: toBig(t.amount),
    counterparty: t.counterparty ?? '',
    timestamp: t.timestamp ?? 0,
    status: t.status,
    fee: toBig(t.fee),
    blockHeight: t.blockHeight,
    isShielded: !!t.isShielded,
    proofTimeMs: t.proofTimeMs,
    raw: t.raw,
  }));
}

function hydrateDustState(stored: any): MidnightDustState | null {
  if (!stored || typeof stored !== 'object') return null;
  return {
    status: stored.status,
    current: toBig(stored.current),
    cap: toBig(stored.cap),
    generationRate: toBig(stored.generationRate),
    timeRemainingSeconds: stored.timeRemainingSeconds ?? null,
    registrationStatus: stored.registrationStatus as DustRegistrationStatus,
  };
}

function hydrateProvingOperations(stored: any): Map<string, MidnightProvingOperation> {
  if (!Array.isArray(stored)) return new Map();
  return new Map(stored as Array<[string, MidnightProvingOperation]>);
}

function toBig(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.length > 0) {
    try { return BigInt(value); } catch { return 0n; }
  }
  return 0n;
}

// ---------------------------------------------------------------- browser-context

if (context === 'browser') {
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<MidnightStore>) => {
    // Mirror walletStore's pattern — direct per-key assignment is what triggers
    // Vue 2's reactivity reliably. Re-hydrate the typed collections (BigInts,
    // Maps) but write to top-level keys directly so the outer observable's
    // setters fire for every changed property.
    Object.keys(updates as object).forEach((key) => {
      const k = key as keyof MidnightStore;
      const val = (updates as any)[k];
      if (k === 'balances') {
        (midnightStore as any).balances = hydrateBalances(val);
      } else if (k === 'utxos') {
        (midnightStore as any).utxos = hydrateUtxos(val);
      } else if (k === 'transactions') {
        (midnightStore as any).transactions = hydrateTransactions(val);
      } else if (k === 'dustState') {
        (midnightStore as any).dustState = hydrateDustState(val);
      } else if (k === 'provingOperations') {
        (midnightStore as any).provingOperations = hydrateProvingOperations(val);
      } else if (k in midnightStore) {
        (midnightStore as any)[k] = val;
      }
    });
  });

  // Hydrate from chrome.storage.local on cold start
  chrome.storage.local.get(STORE_NAME, (result) => {
    const stored = result[STORE_NAME];
    if (!stored) return;

    midnightStore.isActive = !!stored.isActive;
    midnightStore.lastSync = stored.lastSync ?? null;
    midnightStore.networkStatus = stored.networkStatus ?? 'disconnected';
    midnightStore.tip = stored.tip ?? { ...EMPTY_TIP };
    midnightStore.addresses = stored.addresses ?? { ...EMPTY_ADDRESSES };
    midnightStore.balances = hydrateBalances(stored.balances);
    midnightStore.utxos = hydrateUtxos(stored.utxos);
    midnightStore.transactions = hydrateTransactions(stored.transactions);
    midnightStore.dustState = hydrateDustState(stored.dustState);
    midnightStore.provingOperations = hydrateProvingOperations(stored.provingOperations);
    midnightStore.lastMidnightTxId = typeof stored.lastMidnightTxId === 'number'
      ? stored.lastMidnightTxId
      : null;
    midnightStore.shieldedProvingConsent = hydrateShieldedProvingConsent(stored.shieldedProvingConsent);
    midnightStore.activeWalletKey = typeof stored.activeWalletKey === 'string'
      ? stored.activeWalletKey
      : null;
  });
}

/**
 * Hydrate the consent record from chrome.storage. Reject anything that
 * doesn't match the expected shape so corrupt state can't accidentally
 * be read as "consented".
 */
function hydrateShieldedProvingConsent(
  stored: unknown,
): { version: number; acceptedAt: number } | null {
  if (!stored || typeof stored !== 'object') return null;
  const v = (stored as { version?: unknown }).version;
  const at = (stored as { acceptedAt?: unknown }).acceptedAt;
  if (typeof v !== 'number' || typeof at !== 'number') return null;
  return { version: v, acceptedAt: at };
}

/**
 * Apply a partial update from the background context. Browser-side only —
 * background writes via `broadcastFromBackground` directly.
 */
function applyUpdates(updates: Partial<MidnightStore>) {
  if (updates.balances) {
    midnightStore.balances = hydrateBalances(updates.balances);
  }
  if (updates.utxos) {
    midnightStore.utxos = hydrateUtxos(updates.utxos);
  }
  if (updates.transactions) {
    midnightStore.transactions = hydrateTransactions(updates.transactions);
  }
  if (updates.dustState !== undefined) {
    midnightStore.dustState = hydrateDustState(updates.dustState);
  }
  if (updates.provingOperations) {
    midnightStore.provingOperations = hydrateProvingOperations(updates.provingOperations);
  }
  // Plain-typed fields — copy directly (no BigInt nesting to handle)
  for (const key of [
    'isActive', 'lastSync', 'networkStatus', 'tip', 'addresses', 'lastMidnightTxId',
    'shieldedProvingConsent', 'activeWalletKey', 'sendProgress',
  ] as const) {
    if (key in updates) {
      (midnightStore as any)[key] = updates[key];
    }
  }
}

// ---------------------------------------------------------------- background-context

let storageWriteTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Background-context broadcaster. Updates the in-memory store, broadcasts
 * the partial to every connected browser context, and persists to
 * `chrome.storage.local` (debounced unless `immediate` is set).
 *
 * Uses the in-memory state as the persistence base — never reads from
 * `chrome.storage.local` to avoid race conditions where two near-simultaneous
 * updates clobber each other (project CLAUDE.md guidance).
 */
function broadcastFromBackground(updates: Partial<MidnightStore>, immediate = false) {
  if (context !== 'background') return;

  // Apply to in-memory state in background context
  applyUpdates(updates);

  const serializedUpdates = JSON.parse(JSON.stringify(updates, serializeValue));
  backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serializedUpdates);

  const writeNow = () => {
    const serializedState = JSON.parse(JSON.stringify(midnightStore, serializeValue));
    chrome.storage.local.set({ [STORE_NAME]: serializedState });
  };

  if (immediate || 'isActive' in updates) {
    if (storageWriteTimeout) {
      clearTimeout(storageWriteTimeout);
      storageWriteTimeout = null;
    }
    writeNow();
    debugLog('💾 Midnight store persisted (immediate)');
    return;
  }

  if (storageWriteTimeout) clearTimeout(storageWriteTimeout);
  storageWriteTimeout = setTimeout(() => {
    writeNow();
    debugLog('💾 Midnight store persisted (debounced)');
  }, 300);
}

// ---------------------------------------------------------------- actions

/**
 * Background-context actions. Browser code should never call these directly —
 * trigger them via Chrome messaging if needed.
 */
export const midnightActions = {
  /**
   * Mark the wallet as active and seed initial addresses (called when the user
   * logs into a Midnight wallet). Balances/transactions stay empty until
   * gero-sync events arrive.
   */
  setActive(addresses: MidnightAddresses) {
    // Identity of the wallet being activated. The unshielded address is
    // unique per (wallet, network), so a change here means we're now looking
    // at a different wallet or network than whatever state was rehydrated.
    const newKey = addresses.unshielded || null;
    const prevKey = midnightStore.activeWalletKey;
    const isSwitch = !!prevKey && !!newKey && prevKey !== newKey;

    if (isSwitch) {
      // Wipe per-wallet state that belongs to the PREVIOUS wallet/network so
      // a stale NIGHT balance / UTxO set / cursor can't leak across the
      // switch. Without this the old balance lingers until the first sync
      // event, and a no-matching-owner tx never clears it. Addresses +
      // activeWalletKey are set below to the new wallet.
      Object.assign(midnightStore, {
        lastSync: null,
        tip: { ...EMPTY_TIP },
        balances: { ...EMPTY_BALANCES },
        transactions: [],
        utxos: [],
        dustState: null,
        lastMidnightTxId: null,
      });
      debugLog(`🌙 Midnight wallet switch detected (${prevKey.slice(-8)} → ${newKey.slice(-8)}) — cleared stale state`);
    }

    midnightStore.isActive = true;
    midnightStore.addresses = addresses;
    midnightStore.activeWalletKey = newKey;
    midnightStore.networkStatus = 'connecting';
    broadcastFromBackground(
      isSwitch
        ? {
          isActive: true,
          addresses,
          activeWalletKey: newKey,
          networkStatus: 'connecting',
          lastSync: null,
          tip: { ...EMPTY_TIP },
          balances: { ...EMPTY_BALANCES },
          transactions: [],
          utxos: [],
          dustState: null,
          lastMidnightTxId: null,
        }
        : { isActive: true, addresses, activeWalletKey: newKey, networkStatus: 'connecting' },
      true,
    );
  },

  /**
   * Deactivate on wallet logout, but PRESERVE the per-wallet data
   * (balances / utxos / transactions / dustState / tip / lastSync /
   * lastMidnightTxId cursor / activeWalletKey / addresses).
   *
   * Why not wipe: wiping forces the next login of the SAME wallet to
   * re-derive everything from a full gero-sync history replay (cursor sent as
   * null → server replays from the start of the indexer → the visible 5-10s
   * "no data yet" gap). Keeping the state lets a same-wallet re-login render
   * instantly and resume the WS from the saved cursor (delta only), exactly
   * like the Cardano side restores its persisted UTxOs from DB.
   *
   * Safety: this is never shown while logged out (the router is on /welcome
   * and isActive=false gates the Midnight views). A genuine wallet/network
   * SWITCH still wipes the stale state in {@link setActive} via the
   * activeWalletKey guard, so a different wallet can never inherit these
   * balances. Only in-flight proving operations are dropped — they don't
   * survive a session.
   */
  clear() {
    Object.assign(midnightStore, {
      isActive: false,
      networkStatus: 'disconnected',
      provingOperations: new Map(),
    });
    broadcastFromBackground({
      isActive: false,
      networkStatus: 'disconnected',
      provingOperations: new Map(),
    }, true);
    debugLog('🌙 Midnight store deactivated (per-wallet state preserved for fast re-login)');
  },

  /**
   * Record the user's consent to send shielded-tx witness data through Gero
   * Cloud's proving service. Called by the BG handler after the consent
   * dialog's accept button is clicked. Persists immediate so the value
   * survives a SW restart between the consent acceptance and the send.
   */
  acceptShieldedProvingConsent() {
    const consent = {
      version: SHIELDED_PROVING_CONSENT_VERSION,
      acceptedAt: Date.now(),
    };
    midnightStore.shieldedProvingConsent = consent;
    broadcastFromBackground({ shieldedProvingConsent: consent }, true);
  },

  /**
   * Clear the user's shielded-proving consent. Used by settings / "revoke
   * privacy consent" UI flows. The next shielded send will re-prompt.
   */
  clearShieldedProvingConsent() {
    midnightStore.shieldedProvingConsent = null;
    broadcastFromBackground({ shieldedProvingConsent: null }, true);
  },

  /** Network/WS status update (driven by the gero-sync client wrapper). */
  setNetworkStatus(status: MidnightStore['networkStatus']) {
    midnightStore.networkStatus = status;
    broadcastFromBackground({ networkStatus: status });
  },

  /**
   * Publish (or clear) the live background progress of an in-flight send so
   * the send dialog's stage timeline can render a real bar. Pass `null` when
   * the send finishes or fails.
   *
   * The browser broadcast is always immediate (that's what drives the bar);
   * only the chrome.storage write is debounced here — sendProgress is
   * transient and never hydrated, so there's no reason to burst full-store
   * writes to disk on every sync tick.
   */
  setSendProgress(progress: MidnightSendProgress | null) {
    midnightStore.sendProgress = progress;
    broadcastFromBackground({ sendProgress: progress });
  },

  /** New chain tip observed by gero-sync (or Nexus tip query). */
  applyTipUpdate(tip: MidnightChainTip) {
    midnightStore.tip = tip;
    midnightStore.lastSync = Date.now();
    broadcastFromBackground({ tip, lastSync: midnightStore.lastSync });
  },

  /**
   * One transaction event from gero-sync's `unshieldedTransactions` subscription
   * (live or historical backfill). Inserted at the front to keep newest-first
   * order; deduplicated by hash so historical replays don't duplicate entries
   * the wallet already has.
   */
  applyTransaction(tx: MidnightTransaction) {
    // Normalize (strip 0x, lowercase) so an optimistic pending entry inserted
    // right after submit — whose hash may carry a `0x` prefix or different
    // case than gero-sync's later confirmed hash — is replaced in place rather
    // than duplicated when the confirmed event arrives.
    const key = normalizeTxHash(tx.hash);
    const existing = midnightStore.transactions.findIndex(t => normalizeTxHash(t.hash) === key);
    if (existing >= 0) {
      midnightStore.transactions.splice(existing, 1, tx);
    } else {
      midnightStore.transactions.unshift(tx);
    }
    broadcastFromBackground({ transactions: midnightStore.transactions });
  },

  /** Bulk-replace transactions (e.g. after catch-up). */
  setTransactions(transactions: MidnightTransaction[]) {
    midnightStore.transactions = transactions;
    broadcastFromBackground({ transactions });
  },

  /** Partial balance update — caller passes only the fields that changed. */
  updateBalances(balances: Partial<MidnightBalances>) {
    midnightStore.balances = { ...midnightStore.balances, ...balances };
    broadcastFromBackground({ balances: midnightStore.balances });
  },

  /** Replace the UTxO list (typical pattern after a sync cycle). */
  setUtxos(utxos: MidnightUnshieldedUtxo[]) {
    midnightStore.utxos = utxos;
    broadcastFromBackground({ utxos });
  },

  /** Partial UTxO update (e.g. registration status change for a single UTxO). */
  updateUtxo(intentHash: string, outputIndex: number, updates: Partial<MidnightUnshieldedUtxo>) {
    const utxo = midnightStore.utxos.find(
      u => u.intentHash === intentHash && u.outputIndex === outputIndex,
    );
    if (!utxo) return;
    Object.assign(utxo, updates);
    broadcastFromBackground({ utxos: midnightStore.utxos });
  },

  /**
   * Apply UTxO deltas from a sync event (created + spent for our address) and
   * incrementally update `balances.nightUnshielded`. Idempotent by
   * `(intentHash, outputIndex)` — re-deliveries of the same tx during history
   * replay are no-ops on both the set and the derived balance.
   *
   * Performance: O(|added| + |removed|), independent of the steady-state
   * UTxO set size. A wallet with 50k lifetime txs replays in N×k ops, not
   * N×|set| ops — the previous full re-sum would have been ~25M ops at
   * |set|=500 vs ~50k here.
   */
  applyUtxoDeltas(deltas: {
    added: MidnightUnshieldedUtxo[];
    removed: Array<{ intentHash: string; outputIndex: number }>;
    /** Highest indexer txId seen in this batch — advances the resume cursor. */
    maxTxId?: number;
  }) {
    const byKey = new Map<string, MidnightUnshieldedUtxo>();
    for (const u of midnightStore.utxos) {
      byKey.set(`${u.intentHash}:${u.outputIndex}`, u);
    }

    let balanceDelta = 0n;
    const isNight = (u: MidnightUnshieldedUtxo) => {
      const tt = u.tokenType ?? '';
      return tt === '' || /^0+$/.test(tt);
    };

    // ORDER MATTERS: removals BEFORE additions, and callers apply deltas
    // PER TRANSACTION. DUST registration flags a UTxO in place — the tx
    // event carries the SAME (intentHash, outputIndex) in both spent and
    // created (now-flagged) lists. Adds-first treated the re-add as a
    // duplicate and then the removal wiped it: balance zeroed on every
    // registration. Removes-first re-admits the flagged version. The
    // opposite pattern (created in tx A, spent in tx B) stays correct
    // because each tx's deltas are applied separately, in order.
    for (const r of deltas.removed) {
      const key = `${r.intentHash}:${r.outputIndex}`;
      const existing = byKey.get(key);
      if (!existing) continue; // never had it (or already removed) — no-op
      byKey.delete(key);
      if (isNight(existing)) balanceDelta -= existing.value;
    }
    for (const u of deltas.added) {
      const key = `${u.intentHash}:${u.outputIndex}`;
      if (byKey.has(key)) {
        // Duplicate replay — refresh metadata (e.g. registeredForDustGeneration)
        // without touching the balance.
        byKey.set(key, u);
        continue;
      }
      byKey.set(key, u);
      if (isNight(u)) balanceDelta += u.value;
    }

    // Advance the persisted resume cursor whether or not the UTxO set
    // actually changed: a duplicate delivery still means we've "seen" the
    // event, and we don't want gero-sync to replay it again on next reconnect.
    let cursorAdvanced = false;
    if (typeof deltas.maxTxId === 'number' && deltas.maxTxId >= 0) {
      const prev = midnightStore.lastMidnightTxId ?? -1;
      if (deltas.maxTxId > prev) {
        midnightStore.lastMidnightTxId = deltas.maxTxId;
        cursorAdvanced = true;
      }
    }

    if (
      balanceDelta === 0n
      && deltas.added.length === 0
      && deltas.removed.length === 0
      && !cursorAdvanced
    ) {
      return;
    }

    midnightStore.utxos = Array.from(byKey.values());
    const currentNight = midnightStore.balances.nightUnshielded ?? 0n;
    const nextNight = currentNight + balanceDelta;
    // Clamp at zero defensively. A negative result indicates a missing prior
    // delivery (e.g., resume cursor advanced past a receive the wallet never
    // saw). The set-based dedup makes this unreachable in normal operation;
    // the clamp guards against partial gero-sync replays during the gap
    // period before persistence handshake completes.
    midnightStore.balances = {
      ...midnightStore.balances,
      nightUnshielded: nextNight < 0n ? 0n : nextNight,
    };

    broadcastFromBackground({
      utxos: midnightStore.utxos,
      balances: midnightStore.balances,
      lastMidnightTxId: midnightStore.lastMidnightTxId,
    });
  },

  /** DUST tank state from Nexus's `/dust/status` endpoint. */
  setDustState(state: MidnightDustState | null) {
    midnightStore.dustState = state;
    broadcastFromBackground({ dustState: state });
  },

  /** Begin tracking a new ZK proof operation (fires when SDK starts proof gen). */
  startProvingOperation(operationId: string) {
    midnightStore.provingOperations.set(operationId, {
      operationId,
      stage: 'preparing',
      progress: 0,
      startTime: Date.now(),
    });
    broadcastFromBackground({ provingOperations: midnightStore.provingOperations });
  },

  updateProvingProgress(operationId: string, stage: MidnightProvingOperation['stage'], progress: number) {
    const op = midnightStore.provingOperations.get(operationId);
    if (!op) return;
    op.stage = stage;
    op.progress = Math.max(0, Math.min(100, progress));
    broadcastFromBackground({ provingOperations: midnightStore.provingOperations });
  },

  completeProvingOperation(operationId: string) {
    midnightStore.provingOperations.delete(operationId);
    broadcastFromBackground({ provingOperations: midnightStore.provingOperations });
  },
};

export default midnightStore;
