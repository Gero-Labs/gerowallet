import { MIDNIGHT_PROVING_CONSENT_VERSION, type MidnightProvingConsent, type MidnightRemoteProver } from '@/chains/midnight/midnightProvingConsent';
import type { MidnightSyncIdentity } from '@/chains/midnight/midnightSyncGeneration';
import { hydrateSiteActivity, reduceSiteActivity } from '@/chains/midnight/midnightSiteActivity';
import type { MidnightSiteActivity, SiteActivityEvent } from '@/chains/midnight/midnightSiteActivity';
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
import { DEFAULT_LOCAL_PROOF_SERVER_URL, DEFAULT_LOCAL_PROOF_SERVER_URL_LEDGER9 } from '@/chains/midnight/midnightConfig';
import { isNativeNight } from '@/chains/midnight/midnightTokenBalances';
import { midnightTxRowKey, normalizeMidnightTxHash } from '@/chains/midnight/midnightTxHash';
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
  /**
   * Epoch MILLISECONDS. Both writers pass ms (midnight-sync's tip bootstrap
   * documents Nexus's BlockDto as epoch ms) and ContentLayout feeds it
   * straight to `new Date()`. The old `// Unix seconds` note here was the
   * only claim to the contrary and would have cost someone an afternoon.
   */
  timestamp: number;
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
 * One completed (or failed) LOCAL proving attempt — history, not live
 * progress (that's {@link MidnightProvingOperation}). Only the local proof
 * server path is instrumented: remote/cloud proving happens entirely inside
 * the Nexus sidecar, which this wallet has no visibility into. Newest first,
 * capped at {@link PROVING_HISTORY_LIMIT} entries. See
 * `midnightShieldedBuilder.ts`'s `LocalProvingError` for how a failed
 * attempt's duration is captured.
 */
export interface MidnightProvingLogEntry {
  timestamp: number; // Unix ms
  durationMs: number;
  success: boolean;
  /** Present only when {@code success} is false. Never the tx hex/witness. */
  error?: string;
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
/**
 * Live progress of the background private (shielded) sync, broadcast from
 * the ledger-8 loop so the dashboard can show a cold sync moving instead of
 * an indeterminate "Synchronizing…". Indexer event indices, not notes.
 * Transient like {@link MidnightSendProgress}; `null` when not syncing.
 */
export interface MidnightPrivateSyncProgress {
  /** Highest indexer event index the wallet has applied. */
  applied: number;
  /** Highest indexer event index known to be relevant to this wallet. */
  highest: number;
  /** Whether the SDK reports its indexer subscription as connected. */
  connected: boolean;
}

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
   * Recent WALLET-SIDE proving attempts (success and failure), newest
   * first, capped at {@link PROVING_HISTORY_LIMIT} — covers both local
   * docker proving and Arkhia zkPaaS proving (Gero Cloud proving happens
   * inside the Nexus sidecar, invisible to the wallet). See
   * {@link MidnightProvingLogEntry}. Empty for wallets that have never used
   * wallet-side proving, or on a fresh install.
   */
  provingHistory: MidnightProvingLogEntry[];

  /**
   * Highest indexer transactionId we've successfully applied to the UTxO set.
   * Persisted across reloads; on WS reconnect the wallet sends this value as
   * the `midnightLastTxId` resume cursor so gero-sync's subscription resumes
   * at {@code transactionId: lastMidnightTxId + 1} instead of replaying full
   * history. Null = never applied a tx (fresh install / cleared state).
   */
  lastMidnightTxId: number | null;
  chainIdentity: MidnightSyncIdentity | null;
  privateSyncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  /** See {@link MidnightPrivateSyncProgress}; only meaningful while `privateSyncStatus` is `syncing`. */
  privateSyncProgress: MidnightPrivateSyncProgress | null;
  /**
   * What a connected site's transaction is doing inside the wallet
   * (Prove → Fund → Submit), rendered by mini-Gero's site-activity card.
   * See `midnightSiteActivity.ts`; null when no site has been active.
   */
  siteActivity: MidnightSiteActivity | null;

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
  shieldedProvingConsent: MidnightProvingConsent | null;

  /**
   * Where shielded-tx ZK proofs are generated. {@code remote} (default)
   * proves through Gero Cloud and requires {@code shieldedProvingConsent}
   * before the first shielded send. {@code local} proves against a
   * self-hosted docker proof server at {@code localUrl} so witness data
   * never leaves the machine. {@code zkpaas} proves against the Midnight
   * ecosystem's hosted Arkhia zkPaaS (BCW-run, TEE-backed) using the
   * wallet-side proving path — witness data goes to Arkhia, NOT Gero, so
   * it is consent-gated like {@code remote} (see midnightZkpaas.ts).
   * Device-level, like {@code shieldedProvingConsent} above - NOT wiped on
   * wallet switch (see {@code setActive}).
   */
  proofServer: {
    mode: 'remote' | 'local' | 'zkpaas';
    /** Local proof server for the ledger-8 networks (mainnet, preprod). */
    localUrl: string;
    /**
     * Local proof server for the ledger-9 network (stagenet). One URL per
     * circuit family, chosen by the active wallet's network — replaces the
     * old device-global `localProfile` toggle, which had to be flipped by
     * hand on every network switch and, left on the wrong setting, made a
     * running server look like a missing one.
     */
    localUrlLedger9: string;
    /** Arkhia endpoint override; '' = derive per network (midnightConfig). */
    zkpaasUrl: string;
    /** Arkhia project API key ('' until the user pastes one). */
    zkpaasApiKey: string;
    /** Optional Arkhia API secret for hardened (2-layer) projects. */
    zkpaasApiSecret: string;
  };

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

  /**
   * Whether shielded (Zswap) sync is available for the active wallet — i.e.
   * the wallet record carries a valid `mn_shield-esk_` viewing key. This is
   * the ONLY thing browser-context UI is allowed to know about the viewing
   * key: the raw key itself is a forever-decrypt secret (see
   * `MidnightAddresses.zswapViewingKey` blast-radius note) and is
   * deliberately kept OUT of this store, because the store broadcasts to
   * `chrome.storage.local` which would persist it in plaintext. The
   * background reads the raw key straight from the wallet record and hands it
   * to the sync service; the UI only ever needs this boolean.
   */
  shieldedSyncAvailable: boolean;
}

/**
 * Current consent version. Bump only when the agreement materially
 * changes (e.g. proof-server-routing options land and require disclosure,
 * or the wording around what Gero servers see / log changes). A bump
 * invalidates every existing accepted record and re-prompts on next send.
 */
export const SHIELDED_PROVING_CONSENT_VERSION = MIDNIGHT_PROVING_CONSENT_VERSION;

const STORE_NAME = 'midnightStore';
const context = getContextType();

const EMPTY_BALANCES: MidnightBalances = {
  shieldedTokens: {},
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

/**
 * The network a Midnight unshielded address belongs to, as its bech32m HRP.
 *
 * `mn_addr1…` is mainnet and `mn_addr_<network>1…` is everything else (see the
 * prefix built in background.ts), and the bech32 data part cannot contain `1`,
 * so the separator is unambiguous. Returns null for anything unparseable, which
 * callers must treat as "not the same network".
 */
function midnightNetworkOf(address: string | null): string | null {
  if (!address) return null;
  const separator = address.lastIndexOf('1');
  return separator > 0 ? address.slice(0, separator) : null;
}

const EMPTY_TIP: MidnightChainTip = {
  hash: null,
  height: 0,
  timestamp: 0,
};

/**
 * Default proof-server preference. The URL is seeded from `midnightConfig`
 * rather than a second hardcoded literal here - all three Midnight networks
 * currently define the same default (`http://localhost:6300`), so Preview is
 * picked arbitrarily as the lookup key; the value does not vary by network.
 * The zkPaaS fields default empty: the endpoint derives per network at use
 * time (midnightZkpaas.ts) and the API key only exists once the user
 * pastes one from their Arkhia dashboard.
 */
const DEFAULT_PROOF_SERVER: MidnightStore['proofServer'] = {
  mode: 'remote',
  localUrl: DEFAULT_LOCAL_PROOF_SERVER_URL,
  localUrlLedger9: DEFAULT_LOCAL_PROOF_SERVER_URL_LEDGER9,
  zkpaasUrl: '',
  zkpaasApiKey: '',
  zkpaasApiSecret: '',
};

/** Ring-buffer cap for {@link MidnightStore.provingHistory}. */
export const PROVING_HISTORY_LIMIT = 10;

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
  provingHistory: [],
  lastMidnightTxId: null,
  chainIdentity: null,
  privateSyncStatus: 'idle',
  privateSyncProgress: null,
  siteActivity: null,
  shieldedProvingConsent: null,
  activeWalletKey: null,
  sendProgress: null,
  shieldedSyncAvailable: false,
  proofServer: { ...DEFAULT_PROOF_SERVER },
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

/**
 * A confirmed self-transfer arrives from gero-sync with amount 0: every output
 * of the color came back to us, and the chain cannot say which was the payment
 * and which the change (see `MidnightTransactionType`). The optimistic pending
 * row it replaces was built from what the user typed, so it is the one record
 * that knows — keep that amount rather than confirm the row as "0.00".
 *
 * The carry has to survive its own replacement, too: gero-sync replays history
 * on reconnects and full re-syncs, delivering the same confirmed row again.
 * A confirmed `self` row with a non-zero amount can only have come from an
 * earlier carry, so it is kept just like the pending row was.
 */
function withPendingAmount(previous: MidnightTransaction, incoming: MidnightTransaction): MidnightTransaction {
  if (incoming.type !== 'self' || incoming.amount !== 0n || previous.amount <= 0n) return incoming;
  const carry = previous.status === 'pending' || previous.type === 'self';
  return carry ? { ...incoming, amount: previous.amount } : incoming;
}

/**
 * Dedup key for a transaction row: hash + token. A single indexer tx that
 * moves more than one color now produces multiple `MidnightTransaction`
 * rows sharing one hash (one per color) — keying on hash alone would make
 * the second `applyTransaction` call overwrite the first instead of adding
 * a second row. Keying on hash+token keeps the original single-row dedup
 * behavior for NIGHT/DUST-only txs (including the optimistic pending-send
 * insert in background.ts, which is hardcoded to 'NIGHT') while letting
 * distinct colors of the same tx coexist.
 */
function txRowKey(tx: MidnightTransaction): string {
  return midnightTxRowKey(tx);
}

// ---------------------------------------------------------------- hydration

// Persisted shapes mirror the store's interfaces with BigInts serialized as
// strings — the casts below give typed field access while toBig() does the
// actual runtime coercion (same convention as hydrateProvingHistory).
function hydrateBalances(stored: unknown): MidnightBalances {
  if (!stored || typeof stored !== 'object') return { ...EMPTY_BALANCES };
  const s = stored as MidnightBalances;
  return {
    shieldedTokens: Object.fromEntries(Object.entries(s.shieldedTokens ?? {})
      .filter(([color]) => /^[0-9a-fA-F]{64}$/.test(color) && !/^0+$/.test(color))
      .map(([color, amount]) => [color.toLowerCase(), toBig(amount)])),
    nightShielded: toBig(s.nightShielded),
    nightUnshielded: toBig(s.nightUnshielded),
    nightRegistered: toBig(s.nightRegistered),
    dust: toBig(s.dust),
    dustGenerating: toBig(s.dustGenerating),
  };
}

function hydrateUtxos(stored: unknown): MidnightUnshieldedUtxo[] {
  if (!Array.isArray(stored)) return [];
  return stored.map((raw): MidnightUnshieldedUtxo => {
    const u = (raw ?? {}) as MidnightUnshieldedUtxo;
    return {
      owner: u.owner ?? '',
      tokenType: u.tokenType ?? '',
      value: toBig(u.value),
      intentHash: u.intentHash ?? '',
      outputIndex: u.outputIndex ?? 0,
      ctime: u.ctime,
      initialNonce: u.initialNonce ?? '',
      registeredForDustGeneration: !!u.registeredForDustGeneration,
    };
  });
}

function hydrateTransactions(stored: unknown): MidnightTransaction[] {
  if (!Array.isArray(stored)) return [];
  return stored.map((raw): MidnightTransaction => {
    const t = (raw ?? {}) as MidnightTransaction;
    return {
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
    };
  });
}

function hydrateDustState(stored: unknown): MidnightDustState | null {
  if (!stored || typeof stored !== 'object') return null;
  const s = stored as MidnightDustState;
  return {
    status: s.status,
    current: toBig(s.current),
    cap: toBig(s.cap),
    generationRate: toBig(s.generationRate),
    timeRemainingSeconds: s.timeRemainingSeconds ?? null,
    registrationStatus: s.registrationStatus as DustRegistrationStatus,
  };
}

function hydrateProvingOperations(stored: unknown): Map<string, MidnightProvingOperation> {
  if (!Array.isArray(stored)) return new Map();
  return new Map(stored as Array<[string, MidnightProvingOperation]>);
}

function hydrateProvingHistory(stored: unknown): MidnightProvingLogEntry[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      timestamp: typeof e.timestamp === 'number' ? e.timestamp : 0,
      durationMs: typeof e.durationMs === 'number' ? e.durationMs : 0,
      success: !!e.success,
      error: typeof e.error === 'string' ? e.error : undefined,
    }))
    .slice(0, PROVING_HISTORY_LIMIT);
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
      const val = (updates as Record<string, unknown>)[key];
      if (k === 'balances') {
        midnightStore.balances = hydrateBalances(val);
      } else if (k === 'utxos') {
        midnightStore.utxos = hydrateUtxos(val);
      } else if (k === 'transactions') {
        midnightStore.transactions = hydrateTransactions(val);
      } else if (k === 'dustState') {
        midnightStore.dustState = hydrateDustState(val);
      } else if (k === 'provingOperations') {
        midnightStore.provingOperations = hydrateProvingOperations(val);
      } else if (k === 'provingHistory') {
        midnightStore.provingHistory = hydrateProvingHistory(val);
      } else if (k in midnightStore) {
        (midnightStore as unknown as Record<string, unknown>)[key] = val;
      }
    });
  });

  // Hydrate from chrome.storage.local on cold start
  chrome.storage.local.get(STORE_NAME, (result) => {
    // Persisted shape mirrors MidnightStore (BigInts/Maps serialized); every
    // field below is read defensively with a fallback, so a typed view is
    // safe and removes the `unknown`-property-access noise this block had.
    const stored = result[STORE_NAME] as Partial<MidnightStore> | undefined;
    if (!stored) return;

    midnightStore.isActive = !!stored.isActive;
    midnightStore.lastSync = stored.lastSync ?? null;
    midnightStore.networkStatus = stored.networkStatus ?? 'disconnected';
    midnightStore.tip = stored.tip ?? { ...EMPTY_TIP };
    // Defensively strip any zswapViewingKey from a STALE persisted copy: a
    // wallet that was active before this fix landed still has the plaintext
    // key in its chrome.storage `addresses`. Derive the boolean from it, then
    // drop it so the in-memory store never carries the key (even transiently),
    // and re-persist the scrubbed shape below via setActive on next login.
    if (stored.addresses && typeof stored.addresses === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { zswapViewingKey: _staleVk, ...safeStored } = stored.addresses;
      midnightStore.addresses = safeStored;
      midnightStore.shieldedSyncAvailable = typeof stored.shieldedSyncAvailable === 'boolean'
        ? stored.shieldedSyncAvailable
        : isValidMidnightViewingKey(stored.addresses.zswapViewingKey);
    } else {
      midnightStore.addresses = { ...EMPTY_ADDRESSES };
      midnightStore.shieldedSyncAvailable = !!stored.shieldedSyncAvailable;
    }
    midnightStore.balances = hydrateBalances(stored.balances);
    midnightStore.utxos = hydrateUtxos(stored.utxos);
    midnightStore.transactions = hydrateTransactions(stored.transactions);
    midnightStore.dustState = hydrateDustState(stored.dustState);
    midnightStore.provingOperations = hydrateProvingOperations(stored.provingOperations);
    midnightStore.provingHistory = hydrateProvingHistory(stored.provingHistory);
    midnightStore.chainIdentity = stored.chainIdentity ?? null;
    midnightStore.lastMidnightTxId = typeof stored.lastMidnightTxId === 'number'
      ? stored.lastMidnightTxId
      : null;
    midnightStore.shieldedProvingConsent = hydrateShieldedProvingConsent(stored.shieldedProvingConsent);
    midnightStore.activeWalletKey = typeof stored.activeWalletKey === 'string'
      ? stored.activeWalletKey
      : null;
    midnightStore.proofServer = hydrateProofServer(stored.proofServer);
    // The private-note scan can start and finish while no dashboard is open
    // (the side panel's dApp prompt starts it). Without these two the
    // dashboard's "Private tokens" section boots at `idle` and tells the user
    // to unlock a scan the background already completed.
    midnightStore.privateSyncStatus = hydratePrivateSyncStatus(stored.privateSyncStatus);
    midnightStore.privateSyncProgress = hydratePrivateSyncProgress(stored.privateSyncProgress);
    // A site's transaction may be mid-flight when the panel opens; the card
    // applies its own staleness window, so restoring the record is safe.
    midnightStore.siteActivity = hydrateSiteActivity(stored.siteActivity);
  });
}

// ---------------------------------------------------------------- background-context

/**
 * Boot-race guards for the background hydrate below: a setter that runs
 * before the async storage read lands must win over the stored copy.
 */
const bgDurableTouched = {
  proofServer: false,
  shieldedProvingConsent: false,
  provingHistory: false,
  chainIdentity: false,
};

// The background service worker's in-memory store starts at defaults on
// every SW start (MV3 workers restart constantly), and broadcastFromBackground
// persists the WHOLE in-memory store — so without a BG-side hydrate, the
// first write after a restart silently reset every durable preference in
// chrome.storage (the proof-server mode kept flipping back to Gero Cloud,
// and the proving consent re-prompted after every reload). Hydrate the
// durable, user-set fields here. Per-wallet chain state (balances / utxos /
// transactions) is deliberately left out: sync repopulates it and
// setActive owns its wipe-on-switch lifecycle.
if (context === 'background') {
  chrome.storage.local.get(STORE_NAME, (result) => {
    const stored = result[STORE_NAME] as Partial<MidnightStore> | undefined;
    if (!stored) return;
    if (!bgDurableTouched.proofServer) {
      midnightStore.proofServer = hydrateProofServer(stored.proofServer);
    }
    if (!bgDurableTouched.shieldedProvingConsent) {
      midnightStore.shieldedProvingConsent = hydrateShieldedProvingConsent(stored.shieldedProvingConsent);
    }
    if (!bgDurableTouched.provingHistory) {
      midnightStore.provingHistory = hydrateProvingHistory(stored.provingHistory);
    }
    // The chain identity is what the generation queue compares the next sync
    // message against. Left at null after a worker restart, the first message
    // looks like a generation change and clearMidnightNetworkCheckpoints wipes
    // the private-note scan state — a full 1.5M-event rescan on Preprod after
    // every extension reload.
    if (!bgDurableTouched.chainIdentity) {
      midnightStore.chainIdentity = hydrateChainIdentity(stored.chainIdentity);
    }
  });
}

/**
 * Hydrate the consent record from chrome.storage. Reject anything that
 * doesn't match the expected shape so corrupt state can't accidentally
 * be read as "consented".
 */
function hydrateShieldedProvingConsent(
  stored: unknown,
): MidnightProvingConsent | null {
  if (!stored || typeof stored !== 'object') return null;
  const v = (stored as { version?: unknown }).version;
  const at = (stored as { acceptedAt?: unknown }).acceptedAt;
  const provider = (stored as { provider?: unknown }).provider;
  if (!Number.isSafeInteger(v) || typeof at !== 'number' || !Number.isFinite(at) || at <= 0
    || (provider !== 'cloud' && provider !== 'zkpaas')) return null;
  return { version: v as number, acceptedAt: at, provider };
}

/**
 * `localUrl` must be a well-formed http(s) URL - guards against a corrupted
 * or tampered stored value silently routing proving to an unexpected origin.
 */
function isValidProofServerUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Hydrate the proof-server preference from chrome.storage. Each field is
 * validated independently and falls back to its own default (remote,
 * localhost:6300) rather than discarding the whole record, so a corrupted
 * `mode` does not throw away an otherwise-valid custom `localUrl`.
 */
/** Persisted chain identity; only the exact `{network, generation, genesisHash}` shape survives. */
export function hydrateChainIdentity(stored: unknown): MidnightSyncIdentity | null {
  if (!stored || typeof stored !== 'object') return null;
  const { network, generation, genesisHash } = stored as Record<string, unknown>;
  if (typeof network !== 'string' || !/^midnight-(mainnet|preprod|stagenet)$/.test(network)) return null;
  if (!Number.isSafeInteger(generation) || (generation as number) < 1) return null;
  if (typeof genesisHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(genesisHash)) return null;
  return { network, generation: generation as number, genesisHash };
}

const PRIVATE_SYNC_STATUSES: ReadonlyArray<MidnightStore['privateSyncStatus']> = ['idle', 'syncing', 'synced', 'error'];

/** Persisted private-sync status; anything unknown boots as `idle`. */
export function hydratePrivateSyncStatus(stored: unknown): MidnightStore['privateSyncStatus'] {
  return (PRIVATE_SYNC_STATUSES as readonly unknown[]).includes(stored)
    ? stored as MidnightStore['privateSyncStatus']
    : 'idle';
}

/** Persisted scan counters; only a well-formed pair of numbers is kept. */
export function hydratePrivateSyncProgress(stored: unknown): MidnightPrivateSyncProgress | null {
  if (!stored || typeof stored !== 'object') return null;
  const { applied, highest, connected } = stored as Record<string, unknown>;
  if (typeof applied !== 'number' || typeof highest !== 'number') return null;
  return { applied, highest, connected: connected === true };
}

export function hydrateProofServer(stored: unknown): MidnightStore['proofServer'] {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_PROOF_SERVER };
  const mode = (stored as { mode?: unknown }).mode;
  const localUrl = (stored as { localUrl?: unknown }).localUrl;
  const zkpaasUrl = (stored as { zkpaasUrl?: unknown }).zkpaasUrl;
  const storedLedger9 = (stored as { localUrlLedger9?: unknown }).localUrlLedger9;
  // Migration from the retired `localProfile` toggle. A stored 'stagenet'
  // profile meant "the server at localUrl is ledger 9", so that URL moves to
  // the ledger-9 slot and the ledger-8 slot returns to its default — where a
  // missing server now reads as "not detected" for THAT network rather than
  // as a profile mismatch. The default profile ('legacy') needs no move.
  const legacyProfileWasStagenet = storedLedger9 === undefined
    && (stored as { localProfile?: unknown }).localProfile === 'stagenet'
    && isValidProofServerUrl(localUrl);
  return {
    mode: mode === 'remote' || mode === 'local' || mode === 'zkpaas' ? mode : DEFAULT_PROOF_SERVER.mode,
    localUrl: legacyProfileWasStagenet
      ? DEFAULT_PROOF_SERVER.localUrl
      : (isValidProofServerUrl(localUrl) ? localUrl : DEFAULT_PROOF_SERVER.localUrl),
    localUrlLedger9: legacyProfileWasStagenet
      ? localUrl as string
      : (isValidProofServerUrl(storedLedger9) ? storedLedger9 : DEFAULT_PROOF_SERVER.localUrlLedger9),
    // '' is the valid "derive per network" state, distinct from a corrupted
    // value — only non-empty overrides must parse as http(s) URLs.
    zkpaasUrl: zkpaasUrl === '' || isValidProofServerUrl(zkpaasUrl) ? zkpaasUrl as string : '',
    zkpaasApiKey: hydrateCredentialString((stored as { zkpaasApiKey?: unknown }).zkpaasApiKey),
    zkpaasApiSecret: hydrateCredentialString((stored as { zkpaasApiSecret?: unknown }).zkpaasApiSecret),
  };
}

/**
 * A stored Arkhia credential is any reasonable-length string; anything else
 * (corruption, absurd length) hydrates to '' = not configured. 512 chars is
 * far above any real Arkhia key/secret while still bounding storage abuse.
 */
function hydrateCredentialString(value: unknown): string {
  return typeof value === 'string' && value.length <= 512 ? value : '';
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
  if (updates.provingHistory) {
    midnightStore.provingHistory = hydrateProvingHistory(updates.provingHistory);
  }
  // Plain-typed fields — copy directly (no BigInt nesting to handle)
  for (const key of [
    'isActive', 'lastSync', 'networkStatus', 'tip', 'addresses', 'lastMidnightTxId', 'chainIdentity', 'privateSyncStatus',
    'shieldedProvingConsent', 'activeWalletKey', 'sendProgress', 'privateSyncProgress', 'shieldedSyncAvailable', 'siteActivity',
    'proofServer',
  ] as const) {
    if (key in updates) {
      (midnightStore as unknown as Record<string, unknown>)[key] = updates[key];
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
 * A viewing key is usable for shielded sync only in the bech32m `mn_shield-esk_`
 * form the indexer's `connect(viewingKey)` mutation accepts. Wallets created
 * before that form landed stored raw-hex / `mn_shield-epk_` and fall back to
 * unshielded-only. Shared by `setActive` (to publish the boolean) and
 * `walletManager.initializeWallet` (to decide the sync subscription) so the
 * two can never disagree on what "shielded available" means.
 */
export function isValidMidnightViewingKey(vk: string | undefined | null): boolean {
  return typeof vk === 'string' && vk.startsWith('mn_shield-esk_');
}

/**
 * Background-context actions. Browser code should never call these directly —
 * trigger them via Chrome messaging if needed.
 */
export const midnightActions = {
  setPrivateSyncStatus(privateSyncStatus: MidnightStore['privateSyncStatus']) {
    midnightStore.privateSyncStatus = privateSyncStatus;
    if (privateSyncStatus === 'syncing') {
      broadcastFromBackground({ privateSyncStatus });
      return;
    }
    // Progress counters only mean something mid-sync; drop them with the state.
    midnightStore.privateSyncProgress = null;
    broadcastFromBackground({ privateSyncStatus, privateSyncProgress: null });
  },

  /** Live cold-sync counters from the ledger-8 private loop (sampled, transient). */
  setPrivateSyncProgress(privateSyncProgress: MidnightPrivateSyncProgress | null) {
    midnightStore.privateSyncProgress = privateSyncProgress;
    broadcastFromBackground({ privateSyncProgress });
  },

  /** One connector event from a site's transaction (proving / balancing / submit). */
  recordSiteActivity(origin: string, event: SiteActivityEvent) {
    const siteActivity = reduceSiteActivity(midnightStore.siteActivity, origin, event, Date.now());
    midnightStore.siteActivity = siteActivity;
    broadcastFromBackground({ siteActivity });
  },

  clearSiteActivity() {
    midnightStore.siteActivity = null;
    broadcastFromBackground({ siteActivity: null });
  },
  applyPrivateSnapshot(shieldedTokens: Record<string, bigint>, transactions: MidnightTransaction[]) {
    const balances = { ...midnightStore.balances, shieldedTokens, nightShielded: 0n };
    const pending = midnightStore.transactions.filter(tx => tx.isShielded && tx.status === 'pending'
      && !transactions.some(confirmed => normalizeMidnightTxHash(confirmed.hash) === normalizeMidnightTxHash(tx.hash) && confirmed.token === tx.token));
    const combined = [...midnightStore.transactions.filter(tx => !tx.isShielded), ...pending, ...transactions]
      .sort((a, b) => b.timestamp - a.timestamp);
    Object.assign(midnightStore, { balances, transactions: combined, privateSyncStatus: 'synced' });
    broadcastFromBackground({ balances, transactions: combined, privateSyncStatus: 'synced' });
  },
  resetChainState(identity: MidnightSyncIdentity) {
    // `idle`, not `syncing`: this runs on every identity change, including the
    // first sync after a service-worker restart, and it starts no private
    // scan. A loop that IS running re-asserts `syncing` on its next sample;
    // a PassKey wallet has nothing running and must be offered the unlock,
    // not a "Synchronizing private notes…" line with no counter behind it.
    bgDurableTouched.chainIdentity = true;
    const updates: Partial<MidnightStore> = {
      chainIdentity: identity, privateSyncStatus: 'idle', privateSyncProgress: null, lastSync: null, tip: { ...EMPTY_TIP },
      balances: { ...EMPTY_BALANCES }, transactions: [], utxos: [], dustState: null,
      lastMidnightTxId: null, provingOperations: new Map(), sendProgress: null,
      networkStatus: 'connecting',
    };
    Object.assign(midnightStore, updates);
    broadcastFromBackground(updates, true);
  },
  /**
   * Mark the wallet as active and seed initial addresses (called when the user
   * logs into a Midnight wallet). Balances/transactions stay empty until
   * gero-sync events arrive.
   */
  setActive(addresses: MidnightAddresses) {
    // SECURITY: never let the zswap viewing key (a forever-decrypt secret —
    // see MidnightAddresses.zswapViewingKey) enter this store. The store
    // broadcasts to chrome.storage.local, so a copy here would be a plaintext
    // at-rest copy of the key. Strip it here, at the single chokepoint every
    // caller (walletManager.initializeWallet, midnight-sync.service.start,
    // DustRegistrationDialog) passes through, and publish only the boolean
    // `shieldedSyncAvailable`. The raw key never travels via the store: the
    // background reads it straight from the wallet record and hands it to the
    // sync service (walletManager.initializeWallet → midnightSyncService.start).
    const shieldedSyncAvailable = isValidMidnightViewingKey(addresses.zswapViewingKey);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { zswapViewingKey: _zswapViewingKey, ...safeAddresses } = addresses;

    // Identity of the wallet being activated. The unshielded address is
    // unique per (wallet, network), so a change here means we're now looking
    // at a different wallet or network than whatever state was rehydrated.
    const newKey = safeAddresses.unshielded || null;
    const prevKey = midnightStore.activeWalletKey;
    const isSwitch = !!prevKey && !!newKey && prevKey !== newKey;

    // The chain tip is a property of the NETWORK, not of the wallet: moving
    // between two wallets on the same Midnight network does not make the last
    // observed block untrue. Wiping it here left the network tooltip reading
    // "Block: N/A" and "Last Sync: N/A" until the first tip event arrived —
    // the same gap the Cardano side had before walletManager began seeding
    // NetworkStore.tip from the wallet's sync checkpoint. A NETWORK switch is
    // a different chain, so there the tip really is unknown and must clear.
    const prevNetwork = midnightNetworkOf(prevKey);
    const sameNetwork = prevNetwork !== null && prevNetwork === midnightNetworkOf(newKey);
    const carriedTip: MidnightChainTip = sameNetwork ? midnightStore.tip : { ...EMPTY_TIP };

    if (isSwitch) {
      // Wipe per-wallet state that belongs to the PREVIOUS wallet/network so
      // a stale NIGHT balance / UTxO set / cursor can't leak across the
      // switch. Without this the old balance lingers until the first sync
      // event, and a no-matching-owner tx never clears it. Addresses +
      // activeWalletKey are set below to the new wallet.
      bgDurableTouched.chainIdentity = true;
      Object.assign(midnightStore, {
        lastSync: null,
        tip: carriedTip,
        balances: { ...EMPTY_BALANCES },
        transactions: [],
        utxos: [],
        dustState: null,
        lastMidnightTxId: null,
        chainIdentity: null,
        privateSyncStatus: 'idle',
        privateSyncProgress: null,
        siteActivity: null,
      });
      debugLog(`🌙 Midnight wallet switch detected (${prevKey.slice(-8)} → ${newKey.slice(-8)}) — cleared stale state`);
    }

    midnightStore.isActive = true;
    midnightStore.addresses = safeAddresses;
    midnightStore.activeWalletKey = newKey;
    midnightStore.networkStatus = 'connecting';
    midnightStore.shieldedSyncAvailable = shieldedSyncAvailable;
    broadcastFromBackground(
      isSwitch
        ? {
          isActive: true,
          addresses: safeAddresses,
          activeWalletKey: newKey,
          networkStatus: 'connecting',
          shieldedSyncAvailable,
          lastSync: null,
          tip: carriedTip,
          balances: { ...EMPTY_BALANCES },
          transactions: [],
          utxos: [],
          dustState: null,
          lastMidnightTxId: null,
          chainIdentity: null,
          privateSyncStatus: 'idle',
          privateSyncProgress: null,
          siteActivity: null,
        }
        : { isActive: true, addresses: safeAddresses, activeWalletKey: newKey, networkStatus: 'connecting', shieldedSyncAvailable },
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
  acceptShieldedProvingConsent(provider: MidnightRemoteProver) {
    const consent = {
      version: SHIELDED_PROVING_CONSENT_VERSION,
      provider,
      acceptedAt: Date.now(),
    };
    bgDurableTouched.shieldedProvingConsent = true;
    midnightStore.shieldedProvingConsent = consent;
    broadcastFromBackground({ shieldedProvingConsent: consent }, true);
  },

  /**
   * Clear the user's shielded-proving consent. Used by settings / "revoke
   * privacy consent" UI flows. The next shielded send will re-prompt.
   */
  clearShieldedProvingConsent() {
    bgDurableTouched.shieldedProvingConsent = true;
    midnightStore.shieldedProvingConsent = null;
    broadcastFromBackground({ shieldedProvingConsent: null }, true);
  },

  /**
   * Update the user's proof-server preference (Gero Cloud vs a local
   * self-hosted docker proof server). Called by the Settings UI's
   * proof-server section and by the consent dialog's "use a local proof
   * server instead" shortcut. Persists immediately, like the consent
   * setters above, so a same-moment send picks up the new mode even across
   * a background service-worker restart.
   */
  setProofServer(next: MidnightStore['proofServer']) {
    bgDurableTouched.proofServer = true;
    midnightStore.proofServer = next;
    broadcastFromBackground({ proofServer: next }, true);
  },

  /**
   * Record one completed WALLET-SIDE proving attempt (success or failure)
   * — local docker or Arkhia zkPaaS — at the front of
   * {@link MidnightStore.provingHistory}, capped at
   * {@link PROVING_HISTORY_LIMIT}. Called from `walletBg.ts` right after
   * `buildAndSignShieldedTransfer` resolves or throws in a wallet-side
   * proving mode. Never pass tx hex or witness data as `error` — see the
   * file-header privacy note on `midnightLocalProver.ts`.
   */
  recordLocalProvingAttempt(entry: { durationMs: number; success: boolean; error?: string }) {
    bgDurableTouched.provingHistory = true;
    const next = [
      { timestamp: Date.now(), ...entry },
      ...midnightStore.provingHistory,
    ].slice(0, PROVING_HISTORY_LIMIT);
    midnightStore.provingHistory = next;
    broadcastFromBackground({ provingHistory: next }, true);
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
    broadcastFromBackground({ tip });
  },

  /** A generation-validated wallet sync message was successfully applied. */
  markSynced() {
    midnightStore.lastSync = Date.now();
    broadcastFromBackground({ lastSync: midnightStore.lastSync });
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
    // than duplicated when the confirmed event arrives. Keyed on hash+token
    // (see txRowKey) so a multi-color tx's rows land as separate entries
    // instead of clobbering each other.
    const key = txRowKey(tx);
    const existing = midnightStore.transactions.findIndex(t => txRowKey(t) === key);
    if (existing >= 0) {
      midnightStore.transactions.splice(existing, 1, withPendingAmount(midnightStore.transactions[existing], tx));
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
   * Performance: O(|set| + |added| + |removed|) per call, NOT independent of
   * the steady-state UTxO set size — `byKey` below is rebuilt from the
   * ENTIRE current `midnightStore.utxos` on every invocation (and written
   * back in full at the end), so every transaction applied pays a
   * map-rebuild proportional to |set| on top of the delta work itself.
   * Deltas are applied per-transaction (see midnight-sync.service.ts), so a
   * batch of N txs against a |set|=500 wallet costs N×500+ ops, not N×k.
   */
  applyUtxoDeltas(deltas: {
    added: MidnightUnshieldedUtxo[];
    removed: Array<{ intentHash: string; outputIndex: number }>;
    /** Highest indexer txId seen in this batch — advances the resume cursor. */
    maxTxId?: number;
  }) {
    let balanceDelta = 0n;
    const isNight = (u: MidnightUnshieldedUtxo) => isNativeNight(u.tokenType);

    const byKey = new Map<string, MidnightUnshieldedUtxo>();
    for (const u of midnightStore.utxos) {
      const key = `${u.intentHash}:${u.outputIndex}`;
      const collided = byKey.get(key);
      // `setUtxos` stores an array and does NOT dedup, so a persisted set can
      // hold two entries under one key. Folding them into the map here drops
      // one of them; without this its value would stay in nightUnshielded
      // while it vanished from the set.
      if (collided && isNight(collided)) balanceDelta -= collided.value;
      byKey.set(key, u);
    }

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
      const replaced = byKey.get(key);
      byKey.set(key, u);
      // A duplicate replay carries the same color and value, so the two
      // adjustments below cancel out and the balance is untouched — that is
      // the long-standing behaviour, which exists so a re-delivery can refresh
      // metadata like registeredForDustGeneration. They only bite when the key
      // collides between genuinely DIFFERENT UTxOs, which a malformed payload
      // can cause (see resolveOutputIndex in midnight-sync.service.ts). The
      // bare overwrite dropped the previous entry from the set while leaving
      // its value in nightUnshielded, and the eventual spend then decremented
      // against the wrong color — a permanent overstatement. Keep the balance
      // tied to whatever actually survives in the set.
      if (replaced && isNight(replaced)) balanceDelta -= replaced.value;
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
