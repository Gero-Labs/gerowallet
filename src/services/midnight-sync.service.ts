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
import { isNativeNight } from '@/chains/midnight/midnightTokenBalances';
import type {
  MidnightAddresses,
  MidnightBalances,
  MidnightTransaction,
  MidnightUnshieldedUtxo,
  DustGenerationStatus,
  DustRegistrationStatus,
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

/**
 * Raw entry shape for the CATCH_UP snapshot's `utxos` array — like
 * {@link WsMidnightOutput} but also carries `ctime` / `initialNonce`, which
 * the per-tx created/spent payloads don't. Fields are optional because the
 * payload is unvalidated JSON off the wire; {@link MidnightSyncService.parseUtxos}
 * defends against missing/malformed entries at runtime regardless of this type.
 */
interface WsMidnightUtxoSnapshot {
  owner?: string;
  value?: string | number;
  tokenType?: string;
  token_type?: string;
  intentHash?: string;
  intent_hash?: string;
  outputIndex?: number;
  output_index?: number;
  ctime?: number;
  initialNonce?: string;
  initial_nonce?: string;
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

// Exported for the DApp Connector (background.ts) to normalize NIGHT balance
// keys against the same canonical zero-tokenType this file already uses to
// recognize NIGHT outputs — avoids a copy/pasted literal silently drifting.
export const NIGHT_TOKEN_TYPE_NULL = '0000000000000000000000000000000000000000000000000000000000000000';

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
  utxos?: WsMidnightUtxoSnapshot[];
  addresses?: string[];
  [key: string]: unknown;
}

/**
 * An output's index within its transaction, or `null` when the payload didn't
 * carry a usable one.
 *
 * Do NOT default a missing index to `0`. The UTxO set is deduped on
 * `${intentHash}:${outputIndex}` (see `applyUtxoDeltas`), so defaulting buckets
 * every index-less output of a transaction under the same key — two genuinely
 * different UTxOs then collapse into one entry and the balance stops matching
 * the set.
 *
 * Skipping cannot drop a legitimate index 0: gero-sync selects `outputIndex`
 * in its GraphQL subscription and forwards the indexer's map verbatim, and the
 * Nexus-bound records serialize it as a boxed `Integer` under
 * `@JsonInclude(NON_NULL)` — so index 0 arrives as `0`, which is an integer and
 * passes this check. Only a missing, null, or non-numeric value returns `null`.
 */
export function resolveOutputIndex(
  o: { outputIndex?: number; output_index?: number },
): number | null {
  const raw = o.outputIndex ?? o.output_index;
  return Number.isInteger(raw) ? (raw as number) : null;
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
    //
    // Only trust the cursor when there's a preserved UTxO set to resume ON TOP
    // of. With a cursor but an empty UTxO set, gero-sync is caught up and sends
    // no snapshot, so the wallet would show 0 forever. An empty set means
    // either a genuinely-empty wallet or state an earlier empty-snapshot bug
    // zeroed — a full replay correctly recovers both by rebuilding the UTxO set
    // from transaction deltas. No UX cost: there's no fast balance to render
    // when the preserved set is empty anyway.
    const hasPreservedUtxos = midnightStore.utxos.length > 0;
    const midnightLastTxId = hasPreservedUtxos
      ? (midnightStore.lastMidnightTxId ?? null)
      : null;
    if (!hasPreservedUtxos && midnightStore.lastMidnightTxId != null) {
      debugLog('🌙 Midnight sync: cursor present but no preserved UTxOs — forcing full replay to rebuild balance');
    }
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
      // `addresses` is BTC-only (CONTRACT-btc-wire.md); Midnight sends none.
      // MUST be passed explicitly: omitting it shifts every argument below it
      // one slot left, which put the shielded viewing key into
      // `midnightLastTxId` (gero-sync then closed the WS with 1011 on every
      // SUBSCRIBE) and silently disabled shielded sync.
      undefined,
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
        // One row per token color moved for us — a tx can carry NIGHT and a
        // custom color (e.g. USDM) at once, and each needs its own amount.
        const txs = this.parseTx(rawTx, myUnshielded);
        for (const tx of txs) midnightActions.applyTransaction(tx);
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
          // Mirrors the removal loop's guard below: a created output with no
          // intentHash would key into the store's byKey map as `":<index>"`,
          // sharing that bucket with every other intentHash-less output at
          // the same index — and since the removal loop also refuses to
          // enqueue a removal without an intentHash, that entry could never
          // be targeted for removal again.
          const intentHash = o.intentHash ?? o.intent_hash ?? '';
          if (!intentHash) {
            // Unproven premise: no in-repo fixture confirms `intent_hash` is
            // always present in the wire payload. Log so a real drop is
            // observable instead of silent — owner truncated, no key material.
            debugLog(`🌙 Midnight delta: created output missing intentHash, skipped — owner=${o.owner.slice(0, 12)}… tokenType=${o.tokenType ?? o.token_type ?? ''}`);
            continue;
          }
          // The index half of that same key, guarded the same way. Defaulting a
          // missing index to 0 buckets every index-less output of this tx under
          // `<intentHash>:0`, and the store's dedup then collapses genuinely
          // different UTxOs into one entry. With every color admitted below,
          // that silently swaps a NIGHT holding for a token one and leaves the
          // NIGHT value stranded in `nightUnshielded`. See resolveOutputIndex.
          const outputIndex = resolveOutputIndex(o);
          if (outputIndex === null) {
            debugLog(`🌙 Midnight delta: created output missing outputIndex, skipped — owner=${o.owner.slice(0, 12)}… tokenType=${o.tokenType ?? o.token_type ?? ''}`);
            continue;
          }
          // Admit every token color, matching the CATCH_UP snapshot path
          // (parseUtxos applies no token filter). Without this the delta path
          // removed spent token UTxOs but never re-added received ones, so
          // token balances decayed toward zero over a live session.
          //
          // `nightUnshielded` stays native-only: the delta path filters via
          // isNight() before touching balanceDelta, and the snapshot re-sum
          // below applies its own native check.
          added.push(this.outputToUtxo(o, outputIndex));
        }
        for (const o of this.readOutputs(rawTx, 'spent')) {
          if (o.owner !== myUnshielded) continue;
          // tokenType filter not needed for removal — the created loop above
          // now admits every color too, so any owned UTxO we could spend has
          // a matching key to remove; if we somehow never saw it created,
          // the remove is a no-op against an absent key.
          const intentHash = o.intentHash ?? o.intent_hash ?? '';
          const outputIndex = resolveOutputIndex(o);
          // Same reasoning as the created loop: a fabricated index would target
          // an unrelated UTxO for removal. The matching add was skipped for the
          // same reason, so there is nothing in the set to remove anyway.
          if (intentHash && outputIndex !== null) removed.push({ intentHash, outputIndex });
        }
        if (added.length > 0 || removed.length > 0 || maxTxId !== undefined) {
          midnightActions.applyUtxoDeltas({ added, removed, maxTxId });
        }
      }
    }

    // 3) UTXOs — bulk-replace path used by CATCH_UP_COMPLETE's absolute
    // snapshot. Re-derive balance from the new set to keep nightUnshielded
    // consistent with the UTxO source of truth.
    //
    // ONLY when the snapshot actually carries UTxOs. A caught-up keep-alive
    // (SYNC_CHECK_OK) is forwarded here as `{...data, type:'SYNC'}` with
    // `utxos: []`; `[]` is truthy and passes the websocket-layer guard, so it
    // reached this branch and `setUtxos([])` + a from-scratch re-sum zeroed the
    // preserved NIGHT balance on every same-wallet re-login (the "0 tNIGHT but
    // history/graph still show" bug). The genuinely-emptied-to-zero case is
    // already handled by the per-transaction deltas in section 2, so skipping
    // the empty snapshot here loses nothing.
    if (Array.isArray(data.utxos) && data.utxos.length > 0) {
      const parsed = this.parseUtxos(data.utxos);
      midnightActions.setUtxos(parsed);
      let night = 0n;
      for (const u of parsed) {
        const tt = u.tokenType ?? '';
        if (isNativeNight(tt)) night += u.value;
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

  /**
   * One row PER TOKEN COLOR moved for our address in this tx — a single tx
   * can carry NIGHT and a custom color (e.g. USDM) at once, and each needs
   * its own net amount, its own send/receive classification and its own
   * counterparty. (Previously this hardcoded `token: 'NIGHT'` and summed
   * only native outputs, so a USDM-only tx rendered as "Received +0.00
   * NIGHT" — wrong token AND wrong amount.)
   *
   * A tx that doesn't touch our address on either side (created or spent)
   * yields no rows at all, rather than a phantom net-zero "receive".
   */
  private parseTx(raw: WsSyncTx, myUnshielded: string): MidnightTransaction[] {
    const hash = raw.txHash ?? raw.tx_hash;
    if (!hash) return [];

    const created = this.readOutputs(raw, 'created');
    const spent = this.readOutputs(raw, 'spent');

    // Every color touched by an output we own, on either side. Canonicalized
    // through isNativeNight so an all-zero color of non-canonical length and
    // an empty string collapse into the SAME "NIGHT" bucket instead of
    // spuriously splitting into two rows.
    const colors = new Set<string>();
    for (const o of created) {
      if (o?.owner === myUnshielded) colors.add(this.canonicalColor(o));
    }
    for (const o of spent) {
      if (o?.owner === myUnshielded) colors.add(this.canonicalColor(o));
    }
    if (colors.size === 0) return [];

    const timestamp = raw.txTimestamp ?? raw.tx_timestamp ?? 0;
    const blockHeight = raw.blockHeight ?? raw.block_height;
    const rawHex = raw.raw ?? raw.cbor;

    const rows: MidnightTransaction[] = [];
    for (const color of colors) {
      const isNight = isNativeNight(color);

      // Categorize as send / receive from outputs of THIS color: if any
      // matching output's owner is us, it's a receive (or self-send change).
      // If there are spent outputs of this color owned by us but no created
      // ones, it's a pure send.
      const receivedAmount = this.sumOutputsForOwnerAndColor(created, myUnshielded, color);
      const spentAmount = this.sumOutputsForOwnerAndColor(spent, myUnshielded, color);
      const netAmount = receivedAmount - spentAmount;

      let type: MidnightTransaction['type'] = 'receive';
      if (netAmount < 0n) type = 'send';
      else if (netAmount === 0n && spentAmount > 0n) type = 'send'; // pure forward to others

      // DUST registration: net-zero NIGHT self-respend where every created
      // NIGHT output we own comes back flagged registeredForDustGeneration.
      // Without this it renders as a confusing "Sent −0.00". Registration
      // only ever concerns NIGHT (the mapping validator), so this never
      // fires for a custom color's row.
      if (isNight && netAmount === 0n && spentAmount > 0n) {
        const ownCreated = created.filter(
          (o) => o?.owner === myUnshielded && this.canonicalColor(o) === color,
        );
        const allRegistered = ownCreated.length > 0 && ownCreated.every(
          (o) => (o.registeredForDustGeneration ?? o.registered_for_dust_generation) === true,
        );
        if (allRegistered) type = 'register_dust';
      }

      // For sends, surface the recipient (largest output of THIS color NOT
      // owned by us) so history can render "To: mn_addr_…". Picking from the
      // matching color, not always NIGHT, is what keeps a USDM send from
      // showing whatever NIGHT change output happened to be largest. A
      // receive can't reliably name the sender from a per-address unshielded
      // subscription — the spent inputs aren't ours to inspect — so
      // counterparty stays empty there.
      let counterparty = '';
      if (type === 'send') {
        let best = 0n;
        for (const o of created) {
          if (!o || o.owner === myUnshielded) continue;
          if (this.canonicalColor(o) !== color) continue;
          const v = this.toBig(o.value);
          if (v > best) { best = v; counterparty = o.owner; }
        }
      }

      rows.push({
        hash,
        type,
        token: isNight ? 'NIGHT' : color,
        // Net amount in base units. Positive = received, negative = sent.
        // The UI displays absolute value with a +/- sign based on `type`.
        amount: netAmount < 0n ? -netAmount : netAmount,
        counterparty,
        timestamp,
        status: 'confirmed',
        // Midnight fees are paid in DUST, not NIGHT/other colors, and the
        // unshielded subscription doesn't carry the DUST fee — leave 0 until
        // gero-sync forwards it (tracked as a tx-history followup).
        fee: 0n,
        blockHeight,
        isShielded: false, // gero-sync's per-address subscription delivers unshielded only
        raw: rawHex,
      });
    }
    return rows;
  }

  /** Canonical color key for an output: NIGHT_TOKEN_TYPE_NULL for any native-NIGHT
   * spelling (see isNativeNight), the raw color hex otherwise. */
  private canonicalColor(o: WsMidnightOutput): string {
    const tt = o.tokenType ?? o.token_type ?? '';
    return isNativeNight(tt) ? NIGHT_TOKEN_TYPE_NULL : tt;
  }

  /**
   * Map a gero-sync WS output payload to the wallet's UTxO record.
   *
   * `outputIndex` is resolved and validated by the caller (see
   * `resolveOutputIndex`), which skips the output entirely when it has none —
   * so the record this builds always carries a real dedup key rather than a
   * fabricated `0`.
   */
  private outputToUtxo(o: WsMidnightOutput, outputIndex: number): MidnightUnshieldedUtxo {
    return {
      owner: o.owner,
      tokenType: o.tokenType ?? o.token_type ?? '',
      value: this.toBig(o.value),
      intentHash: o.intentHash ?? o.intent_hash ?? '',
      outputIndex,
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

  /** Sum outputs owned by `owner` whose canonical color matches `color` (see {@link canonicalColor}). */
  private sumOutputsForOwnerAndColor(outputs: WsMidnightOutput[], owner: string, color: string): bigint {
    let sum = 0n;
    for (const o of outputs) {
      if (!o || o.owner !== owner) continue;
      if (this.canonicalColor(o) !== color) continue;
      sum += this.toBig(o.value);
    }
    return sum;
  }

  private parseUtxos(raw: WsMidnightUtxoSnapshot[]): MidnightUnshieldedUtxo[] {
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
        status: (dustGenStatus as DustGenerationStatus) ?? 'empty',
        current: this.toBig(account.dust_balance),
        cap: this.toBig(account.dust_cap),
        generationRate: this.toBig(account.dust_generating),
        timeRemainingSeconds: account.dust_time_remaining_seconds ?? null,
        registrationStatus: (dustRegStatus as DustRegistrationStatus) ?? 'Unregistered',
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
