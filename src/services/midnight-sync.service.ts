/**
 * Midnight Sync Service
 *
 * Bridges the chain-agnostic gero-sync WebSocket (`webSocketService`) into the
 * Midnight-specific store (`midnightStore`). Mirrors the role `sync.service.ts`
 * plays for Cardano — the WS handlers translate `WsSyncMessage` payloads into
 * `midnightActions.*` calls.
 *
 * Lifecycle:
 * - {@link start} on Midnight wallet login — opens a WS connection to gero-sync
 *   with `chain: "MIDNIGHT"`, registers the wallet's unshielded address, and
 *   marks the store active.
 * - {@link stop} on logout / chain switch — closes the WS and clears the store.
 *
 * What flows through this service (per gero-sync's PR #1 wire format):
 * - **SYNC** events with one or more `transactions` plus optional `block` /
 *   `account` / `utxos` fields → `midnightActions.applyTransaction` +
 *   `applyTipUpdate` + `updateBalances` + `setUtxos`
 * - **CATCH_UP_COMPLETE** (handled inside `webSocketService` — combined into a
 *   single SYNC dispatch from there)
 * - **ROLLBACK** — Midnight uses Substrate finality; reorgs are rare. We log
 *   and bump the sync state but don't aggressively delete history; the next
 *   subscription cycle resumes from a corrected `transactionId`.
 * - **FORCE_RESYNC** — admin-triggered; we clear and reconnect from block 0.
 *
 * The wallet's `walletManager.service.ts` is responsible for actually invoking
 * `start()` / `stop()` — see the chain-aware login/logout branch added in the
 * Midnight integration plan. This service intentionally has no knowledge of
 * the wallet's lifecycle; it's a pure bridge.
 */

import webSocketService from './websocket.service';
import { midnightActions, midnightStore } from '@/stores/midnightStore';
import { debugLog } from '@/utils/debug';
import { Network } from '@/models/types';
import { getMidnightApi } from '@/api/midnight-api';
import type {
  MidnightAddresses,
  MidnightBalances,
  MidnightTransaction,
  MidnightUnshieldedUtxo,
} from '@/chains/midnight/midnightTypes';

/**
 * Map our project's `Network` constants to gero-sync's Midnight network keys.
 *
 * gero-sync's `MidnightSyncProvider.getSupportedNetworks()` returns
 * `["midnight-mainnet", "midnight-preprod", "midnight-preview"]` — the wallet
 * sends one of `Network.MAINNET | PREVIEW | PREPROD` ("Mainnet" / "Preview" /
 * "Preprod"), and the backend would otherwise reject with WS code 1011.
 */
function toGeroSyncMidnightNetwork(network: string): string {
  switch (network) {
    case Network.MAINNET: return 'midnight-mainnet';
    case Network.PREVIEW: return 'midnight-preview';
    case Network.PREPROD: return 'midnight-preprod';
    default:
      // Already in gero-sync form, or an unknown value — pass through and let
      // the backend respond. Logged so failures are easy to diagnose.
      return network;
  }
}

interface WsSyncBlock {
  hash?: string;
  height?: number;
  time?: number;
}

/**
 * Indexer's parsed unshielded UTxO — what the GraphQL `unshieldedCreatedOutputs`
 * / `unshieldedSpentOutputs` arrays carry. gero-sync forwards these inside
 * `TxData.utxo` for Midnight (see PR7 in `MidnightUnshieldedTxSubscriber`).
 */
interface WsMidnightOutput {
  owner: string;
  value: string | number; // base units; NIGHT uses 6 decimals
  tokenType?: string;
  token_type?: string;
  intentHash?: string;
  intent_hash?: string;
  outputIndex?: number;
  output_index?: number;
  registeredForDustGeneration?: boolean;
  registered_for_dust_generation?: boolean;
}

interface WsSyncTx {
  tx_hash?: string;
  txHash?: string;
  cbor?: string;
  raw?: string;
  block_height?: number;
  blockHeight?: number;
  block_hash?: string;
  blockHash?: string;
  tx_timestamp?: number;
  txTimestamp?: number;
  /**
   * Indexer-side Midnight transactionId (gero-sync emits via SnakeCaseStrategy).
   * Used by the wallet to advance the persisted resume cursor so reconnects
   * skip already-applied history. Null on non-Midnight chains or older
   * gero-sync versions that don't emit it.
   */
  midnight_tx_id?: number;
  midnightTxId?: number;
  /**
   * Carries Midnight's parsed unshielded outputs from PR7+ gero-sync.
   * Snake_case keys come from the indexer; gero-sync re-serializes via
   * Jackson's SnakeCaseStrategy so both forms can appear depending on the
   * indexer schema's casing.
   */
  utxo?: {
    unshieldedCreatedOutputs?: WsMidnightOutput[];
    unshielded_created_outputs?: WsMidnightOutput[];
    unshieldedSpentOutputs?: WsMidnightOutput[];
    unshielded_spent_outputs?: WsMidnightOutput[];
  };
}

const NIGHT_TOKEN_TYPE_NULL = '0000000000000000000000000000000000000000000000000000000000000000';

interface WsAccountInfo {
  controlled_amount?: string;
  controlledAmount?: string;
  /** Midnight-specific (added in gero-sync's SyncPayload.AccountInfo). */
  dust_balance?: string;
  dust_generating?: string;
  dust_cap?: string;
  night_shielded?: string;
  night_registered?: string;
  dust_registration_status?: string;
  dust_generation_status?: string;
  dust_time_remaining_seconds?: number;
}

interface WsSyncMessage {
  type: string;
  block?: WsSyncBlock;
  transactions?: WsSyncTx[];
  account?: WsAccountInfo;
  utxos?: any[];
  addresses?: string[];
  [key: string]: unknown;
}

class MidnightSyncService {
  private active = false;
  private currentNetwork: string | null = null;
  private currentAddresses: MidnightAddresses | null = null;

  /**
   * Start syncing a Midnight wallet. Idempotent — calling start while already
   * active for the same address is a no-op; switching networks/addresses
   * disconnects + reconnects via {@link webSocketService.connect}'s built-in
   * handover (`close()` → fresh `openConnection()`).
   *
   * @param network        Midnight network identifier (`Network.PREVIEW` etc.)
   * @param addresses      The wallet's three Midnight addresses; `unshielded` is
   *                       the one gero-sync uses to filter `unshieldedTransactions`
   * @param lastSyncedBlock Block height the wallet last saw — gero-sync resumes
   *                       events after this (passes through to the indexer's
   *                       per-address `transactionId` resume mechanism)
   */
  start(
    network: string,
    addresses: MidnightAddresses,
    lastSyncedBlock = 0,
    /**
     * Optional shielded-sync opt-in. When provided, gero-sync opens a
     * shielded-tx indexer subscription alongside the unshielded one and
     * forwards events to this WS session. Until the wallet's shielded-SDK
     * derivation lands at login, callers leave this undefined and the
     * sync stays unshielded-only.
     *
     * Held in the WS service for the session lifetime; not persisted. Re-
     * derive from the wallet at next login rather than caching the value.
     */
    shielded?: {
      /** Hex-encoded Zswap viewing key from the user's mnemonic. */
      viewingKey: string;
      /** Persisted resume cursor (highest applied shielded indexer endIndex). */
      lastIndex?: number | null;
    },
  ): void {
    if (!addresses.unshielded) {
      debugLog('Midnight sync: refusing to start without unshielded address');
      return;
    }

    this.currentNetwork = network;
    this.currentAddresses = addresses;

    midnightActions.setActive(addresses);
    midnightActions.setNetworkStatus('connecting');

    const geroSyncNetwork = toGeroSyncMidnightNetwork(network);

    // Persisted resume cursor: highest indexer txId the wallet already
    // applied. gero-sync uses it to open the indexer subscription at
    // (cursor + 1), skipping replay of already-known history. Null = fresh
    // install / cleared state → server falls back to full replay.
    const midnightLastTxId = midnightStore.lastMidnightTxId ?? null;
    // Privacy: log only whether shielded is enabled, never the viewing key.
    debugLog(`🌙 Midnight sync start: resume cursor=${midnightLastTxId} shielded=${shielded != null}`);

    webSocketService.connect(
      'MIDNIGHT',
      geroSyncNetwork,
      addresses.unshielded,
      lastSyncedBlock,
      {
        onSync: this.handleSync.bind(this),
        onRollback: this.handleRollback.bind(this),
        onForceResync: this.handleForceResync.bind(this),
      },
      // No credentials concept for Midnight in v1 — `MidnightSyncProvider.buildAddressesFromCredentials`
      // returns empty by default. When per-address derivation arrives, this
      // is where role-specific public keys would flow.
      [],
      midnightLastTxId,
      shielded?.viewingKey ?? null,
      shielded?.lastIndex ?? null,
    );

    this.active = true;
    debugLog(`🌙 Midnight sync started for ${addresses.unshielded} on ${network} (gero-sync key: ${geroSyncNetwork})`);

    // Bootstrap the chain tip from Nexus's indexer-backed `/api/blocks/latest`.
    // gero-sync only sends `block` data inside SYNC messages when there's
    // something to dispatch; if the wallet's already caught up at startup,
    // SYNC_CHECK_OK arrives with no `block` field, leaving `midnightStore.tip`
    // and `lastSync` at their empty defaults — so the navigation status
    // tooltip would otherwise show "Last Sync: N/A" / "Block: N/A" forever.
    // Fire-and-forget; a failure here is non-fatal (the tooltip just stays
    // at N/A until the next SYNC arrives).
    this.bootstrapTipFromNexus(network).catch((e) => {
      debugLog('🌙 Midnight tip bootstrap from Nexus failed (non-fatal):', e);
    });
  }

  /**
   * Read the current chain tip from Nexus's `/api/blocks/latest` and seed
   * {@link midnightStore.tip} + `lastSync`. Used at sync start so the
   * navigation tooltip has a value before any new blocks have arrived.
   */
  private async bootstrapTipFromNexus(network: string): Promise<void> {
    const api = getMidnightApi(network);
    const block = await api.getLatestBlock();
    debugLog('🌙 Midnight tip bootstrap response:', block);
    if (typeof block.height !== 'number' || block.height === 0) {
      debugLog('🌙 Midnight tip bootstrap: indexer returned no height — skipping');
      return;
    }
    midnightActions.applyTipUpdate({
      hash: block.hash ?? null,
      height: block.height,
      // Nexus's BlockDto returns `time` in epoch ms (chain-agnostic; same
      // shape as Cardano's tip carries). The Midnight tip type already uses
      // ms semantics for `timestamp` (see midnight-sync handleSync below).
      timestamp: typeof block.time === 'number' ? block.time : 0,
    });
    debugLog(`🌙 Midnight tip applied: height=${block.height} timestamp=${block.time}`);
  }

  /**
   * Stop syncing — closes the WS, clears `midnightStore`, resets state.
   * Safe to call when not active (no-op).
   */
  stop(): void {
    if (!this.active) return;
    webSocketService.close();
    midnightActions.setNetworkStatus('disconnected');
    midnightActions.clear();
    this.active = false;
    this.currentNetwork = null;
    this.currentAddresses = null;
    debugLog('🌙 Midnight sync stopped');
  }

  /**
   * Force a full re-sync from block 0. Triggered when the dashboard's
   * "force resync" admin action fires, OR when the wallet detects local
   * state drift.
   *
   * Clears BOTH halves of the warm state so the resync is genuinely full:
   *   1. the gero-sync WS cursor + store UTxO/tx snapshot (resubscribe(0))
   *   2. the persisted SDK wallet-state blobs (dust/shielded serializeState
   *      snapshots) — otherwise the next send would `restore()` a stale
   *      cursor and the "resync" wouldn't actually re-walk from genesis.
   * Modelled after Dynamic.xyz's `resetWalletCache()` semantics.
   */
  forceResync(): void {
    if (!this.active) return;
    midnightActions.setTransactions([]);
    midnightActions.setUtxos([]);
    // Fire-and-forget: clearing the SDK state blobs is best-effort and must
    // not block the WS resubscribe. Clear ALL of them (no network scope) —
    // the persistence keys are namespaced by the SDK network id ('preprod'),
    // not the gero-sync slug ('midnight-preprod') we hold here, so scoping by
    // the wrong string would silently match nothing. A full resync clearing
    // every network's SDK cache is safe: the worst case is one extra cold
    // sync on another network's next send.
    void import('@/chains/midnight/midnightWalletStatePersistence')
      .then(({ clearAllWalletState }) => clearAllWalletState())
      .catch(() => { /* non-fatal */ });
    webSocketService.resubscribe(0);
  }

  isActive(): boolean {
    return this.active;
  }

  /** The Midnight network this service is currently syncing, or `null` if stopped. */
  getNetwork(): string | null {
    return this.currentNetwork;
  }

  /** The addresses currently being watched, or `null` if stopped. */
  getAddresses(): MidnightAddresses | null {
    return this.currentAddresses;
  }

  // ---------------------------------------------------------------- handlers

  private async handleSync(data: WsSyncMessage): Promise<void> {
    // 1) Tip update
    if (data.block && typeof data.block.height === 'number') {
      midnightActions.applyTipUpdate({
        hash: data.block.hash ?? null,
        height: data.block.height,
        timestamp: data.block.time ?? 0,
      });
    }

    // 2) Transactions — UTxO-set model: add created outputs owned by us,
    // remove spent outputs owned by us, idempotently keyed by
    // (intentHash, outputIndex). Balance is then re-derived from the set
    // inside `applyUtxoDeltas` so history replays + reconnects can't drift
    // the balance up or down (was the old delta-running bug class).
    //
    // Deltas are applied PER TRANSACTION (removals first, inside the store).
    // Aggregating across the whole batch collapses tx ordering and broke
    // same-key respends: DUST registration spends and re-creates the SAME
    // (intentHash, outputIndex) — just flagged — and the aggregated
    // adds-first pass zeroed the balance on every registration.
    if (Array.isArray(data.transactions) && data.transactions.length > 0) {
      const myUnshielded = this.currentAddresses?.unshielded ?? '';
      for (const rawTx of data.transactions) {
        const tx = this.parseTx(rawTx, myUnshielded);
        if (tx) midnightActions.applyTransaction(tx);
        // gero-sync's per-tx WS payload carries `midnight_tx_id` (snake-cased
        // from SyncPayload.TxData.midnightTxId). Advancing the cursor per tx
        // is safe — the store only moves it forward.
        const txId = rawTx.midnight_tx_id ?? rawTx.midnightTxId;
        const maxTxId = typeof txId === 'number' ? txId : undefined;
        if (!myUnshielded) {
          if (maxTxId !== undefined) {
            midnightActions.applyUtxoDeltas({ added: [], removed: [], maxTxId });
          }
          continue;
        }
        const added: MidnightUnshieldedUtxo[] = [];
        const removed: Array<{ intentHash: string; outputIndex: number }> = [];
        for (const o of this.readOutputs(rawTx, 'created')) {
          if (o.owner !== myUnshielded) continue;
          if (!this.isNightOutput(o)) continue;
          added.push(this.outputToUtxo(o));
        }
        for (const o of this.readOutputs(rawTx, 'spent')) {
          if (o.owner !== myUnshielded) continue;
          // tokenType filter not needed for removal — if the wallet had it,
          // the matching add went through the NIGHT filter; if it didn't,
          // the remove is a no-op against an absent key.
          const intentHash = o.intentHash ?? o.intent_hash ?? '';
          const outputIndex = o.outputIndex ?? o.output_index ?? 0;
          if (intentHash) removed.push({ intentHash, outputIndex });
        }
        if (added.length > 0 || removed.length > 0 || maxTxId !== undefined) {
          midnightActions.applyUtxoDeltas({ added, removed, maxTxId });
        }
      }
    }

    // 3) UTXOs — bulk-replace path used by CATCH_UP_COMPLETE's absolute
    // snapshot. Re-derive balance from the new set to keep nightUnshielded
    // consistent with the UTxO source of truth.
    if (Array.isArray(data.utxos)) {
      const parsed = this.parseUtxos(data.utxos);
      midnightActions.setUtxos(parsed);
      let night = 0n;
      for (const u of parsed) {
        const tt = u.tokenType ?? '';
        if (tt === '' || /^0+$/.test(tt)) night += u.value;
      }
      midnightActions.updateBalances({ nightUnshielded: night });
    }

    // 4) Account info — pull out DUST/registered/shielded fields. We DON'T
    // accept `nightUnshielded` from this path (gero-sync's MidnightSyncProvider
    // already leaves `controlledAmount` unset for exactly this reason — the
    // sync-events-derived UTxO set is authoritative for that field).
    if (data.account) {
      this.applyAccountInfo(data.account);
    }

    midnightActions.setNetworkStatus('connected');
  }

  private async handleRollback(data: WsSyncMessage): Promise<void> {
    debugLog('🌙 Midnight rollback received', data);
    // Substrate uses GRANDPA finality; reorgs before finalization are possible
    // but rare. Conservative response: mark connection as connecting, wait for
    // the next SYNC to bring us back. Detailed rollback handling (drop affected
    // txs from history) is a follow-up — for v1, the per-address subscription's
    // resume mechanism on the gero-sync side replays correct state.
    midnightActions.setNetworkStatus('connecting');
  }

  private async handleForceResync(): Promise<void> {
    debugLog('🌙 Midnight force resync triggered');
    midnightActions.setTransactions([]);
    midnightActions.setUtxos([]);
    midnightActions.setNetworkStatus('connecting');
  }

  // ---------------------------------------------------------------- parsers

  private parseTx(raw: WsSyncTx, myUnshielded: string): MidnightTransaction | null {
    const hash = raw.txHash ?? raw.tx_hash;
    if (!hash) return null;

    // Categorize as send / receive from outputs: if any unshielded output's
    // owner matches our address, it's a receive (or self-send change). If
    // there are spent outputs owned by us but no created ones, it's a pure send.
    const created = this.readOutputs(raw, 'created');
    const spent = this.readOutputs(raw, 'spent');
    const receivedAmount = this.sumOutputsForOwner(created, myUnshielded);
    const spentAmount = this.sumOutputsForOwner(spent, myUnshielded);
    const netAmount = receivedAmount - spentAmount;

    let type: MidnightTransaction['type'] = 'receive';
    if (netAmount < 0n) type = 'send';
    else if (netAmount === 0n && spentAmount > 0n) type = 'send'; // pure forward to others

    // DUST registration: net-zero self-respend where every created output we
    // own comes back flagged registeredForDustGeneration. Without this it
    // renders as a confusing "Sent −0.00".
    if (netAmount === 0n && spentAmount > 0n) {
      const ownCreated = created.filter((o) => o?.owner === myUnshielded);
      const allRegistered = ownCreated.length > 0 && ownCreated.every(
        (o) => (o.registeredForDustGeneration ?? o.registered_for_dust_generation) === true,
      );
      if (allRegistered) type = 'register_dust';
    }

    // For sends, surface the recipient (largest NIGHT output NOT owned by us)
    // so history can render "To: mn_addr_…". A receive can't reliably name the
    // sender from a per-address unshielded subscription — the spent inputs
    // aren't ours to inspect — so counterparty stays empty there.
    let counterparty = '';
    if (type === 'send') {
      let best = 0n;
      for (const o of created) {
        if (!o || o.owner === myUnshielded) continue;
        const tt = o.tokenType ?? o.token_type ?? '';
        if (tt && tt !== NIGHT_TOKEN_TYPE_NULL) continue;
        const v = this.toBig(o.value);
        if (v > best) { best = v; counterparty = o.owner; }
      }
    }

    return {
      hash,
      type,
      token: 'NIGHT',
      // Net amount in NIGHT base units. Positive = received, negative = sent.
      // The UI displays absolute value with a +/- sign based on `type`.
      amount: netAmount < 0n ? -netAmount : netAmount,
      counterparty,
      timestamp: raw.txTimestamp ?? raw.tx_timestamp ?? 0,
      status: 'confirmed',
      // Midnight fees are paid in DUST, not NIGHT, and the unshielded
      // subscription doesn't carry the DUST fee — leave 0 until gero-sync
      // forwards it (tracked as a tx-history followup).
      fee: 0n,
      blockHeight: raw.blockHeight ?? raw.block_height,
      isShielded: false, // gero-sync's per-address subscription delivers unshielded only
      raw: raw.raw ?? raw.cbor,
    };
  }

  /** Empty token type or 32-byte-zero token type both mean native NIGHT. */
  private isNightOutput(o: WsMidnightOutput): boolean {
    const tt = o.tokenType ?? o.token_type ?? '';
    return tt === '' || tt === NIGHT_TOKEN_TYPE_NULL;
  }

  /** Map a gero-sync WS output payload to the wallet's UTxO record. */
  private outputToUtxo(o: WsMidnightOutput): MidnightUnshieldedUtxo {
    return {
      owner: o.owner,
      tokenType: o.tokenType ?? o.token_type ?? '',
      value: this.toBig(o.value),
      intentHash: o.intentHash ?? o.intent_hash ?? '',
      outputIndex: o.outputIndex ?? o.output_index ?? 0,
      ctime: undefined,
      initialNonce: '',
      registeredForDustGeneration:
        o.registeredForDustGeneration ?? o.registered_for_dust_generation ?? false,
    };
  }

  private readOutputs(raw: WsSyncTx, kind: 'created' | 'spent'): WsMidnightOutput[] {
    const u = raw.utxo;
    if (!u) return [];
    if (kind === 'created') {
      return u.unshieldedCreatedOutputs ?? u.unshielded_created_outputs ?? [];
    }
    return u.unshieldedSpentOutputs ?? u.unshielded_spent_outputs ?? [];
  }

  private sumOutputsForOwner(outputs: WsMidnightOutput[], owner: string): bigint {
    let sum = 0n;
    for (const o of outputs) {
      if (!o || o.owner !== owner) continue;
      const tokenType = o.tokenType ?? o.token_type ?? '';
      // Only count NIGHT (null token type). Non-null tokenTypes would be
      // custom assets we don't track in `nightUnshielded`.
      if (tokenType && tokenType !== NIGHT_TOKEN_TYPE_NULL) continue;
      sum += this.toBig(o.value);
    }
    return sum;
  }

  private parseUtxos(raw: any[]): MidnightUnshieldedUtxo[] {
    return raw
      .map((u): MidnightUnshieldedUtxo | null => {
        if (!u || typeof u !== 'object') return null;
        return {
          owner: u.owner ?? '',
          tokenType: u.token_type ?? u.tokenType ?? '',
          value: this.toBig(u.value),
          intentHash: u.intent_hash ?? u.intentHash ?? '',
          outputIndex: u.output_index ?? u.outputIndex ?? 0,
          ctime: u.ctime,
          initialNonce: u.initial_nonce ?? u.initialNonce ?? '',
          registeredForDustGeneration:
            !!(u.registered_for_dust_generation ?? u.registeredForDustGeneration),
        };
      })
      .filter((u): u is MidnightUnshieldedUtxo => u !== null);
  }

  private applyAccountInfo(account: WsAccountInfo): void {
    // Map snake_case (from gero-sync's JsonNaming) to Midnight balance fields.
    //
    // NOTE: `controlledAmount` is intentionally NOT mapped to nightUnshielded.
    // gero-sync's MidnightSyncProvider also doesn't set it for the same reason:
    // nightUnshielded is the wallet's sync-events-derived UTxO sum (full set,
    // not just registered ones), so an account-info override would clobber it
    // with a different / partial value.
    const balances: Partial<MidnightBalances> = {};

    const dust = account.dust_balance;
    if (dust !== undefined) balances.dust = this.toBig(dust);

    const dustGen = account.dust_generating;
    if (dustGen !== undefined) balances.dustGenerating = this.toBig(dustGen);

    const nightShielded = account.night_shielded;
    if (nightShielded !== undefined) balances.nightShielded = this.toBig(nightShielded);

    const nightRegistered = account.night_registered;
    if (nightRegistered !== undefined) balances.nightRegistered = this.toBig(nightRegistered);

    if (Object.keys(balances).length > 0) {
      midnightActions.updateBalances(balances);
    }

    // Optional dust state — only build it if all the relevant fields are present.
    const dustGenStatus = account.dust_generation_status;
    const dustRegStatus = account.dust_registration_status;
    if (dustGenStatus || dustRegStatus) {
      midnightActions.setDustState({
        status: (dustGenStatus as any) ?? 'empty',
        current: this.toBig(account.dust_balance),
        cap: this.toBig(account.dust_cap),
        generationRate: this.toBig(account.dust_generating),
        timeRemainingSeconds: account.dust_time_remaining_seconds ?? null,
        registrationStatus: (dustRegStatus as any) ?? 'Unregistered',
      });
    }
  }

  private toBig(value: unknown): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') return BigInt(Math.trunc(value));
    if (typeof value === 'string' && value.length > 0) {
      try { return BigInt(value); } catch { return 0n; }
    }
    return 0n;
  }
}

const midnightSyncService = new MidnightSyncService();
export default midnightSyncService;
