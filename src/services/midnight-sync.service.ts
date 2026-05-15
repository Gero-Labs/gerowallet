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
    );

    this.active = true;
    debugLog(`🌙 Midnight sync started for ${addresses.unshielded} on ${network} (gero-sync key: ${geroSyncNetwork})`);
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
   */
  forceResync(): void {
    if (!this.active) return;
    midnightActions.setTransactions([]);
    midnightActions.setUtxos([]);
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

    // 2) Transactions — also derive a delta-balance update per tx since
    // gero-sync's PR6/PR7 dispatched payloads include the indexer's parsed
    // unshielded outputs but no aggregated `account` field. We sum
    // `unshieldedCreatedOutputs[].value where owner == myUnshielded` and
    // subtract `unshieldedSpentOutputs[].value where owner == myUnshielded`,
    // applying the delta to `balances.nightUnshielded`. Only outputs with the
    // null tokenType (NIGHT) count toward this — other tokenTypes would be
    // custom asset balances we don't model yet.
    if (Array.isArray(data.transactions) && data.transactions.length > 0) {
      const myUnshielded = this.currentAddresses?.unshielded ?? '';
      let nightDelta = 0n;
      for (const rawTx of data.transactions) {
        const tx = this.parseTx(rawTx, myUnshielded);
        if (tx) midnightActions.applyTransaction(tx);
        if (myUnshielded) {
          nightDelta += this.computeNightDelta(rawTx, myUnshielded);
        }
      }
      if (nightDelta !== 0n) {
        const current = midnightStore.balances.nightUnshielded ?? 0n;
        const next = current + nightDelta;
        const clamped = next < 0n ? 0n : next;
        debugLog(`🌙 midnight-sync[bg] applying balance delta: ${current} + ${nightDelta} = ${clamped}`);
        midnightActions.updateBalances({
          nightUnshielded: clamped,
        });
      }
    }

    // 3) UTXOs (CATCH_UP_COMPLETE attaches them; live SYNC may too)
    if (Array.isArray(data.utxos)) {
      midnightActions.setUtxos(this.parseUtxos(data.utxos));
    }

    // 4) Account info — pull out balance + DUST state fields
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

    return {
      hash,
      type,
      token: 'NIGHT',
      // Net amount in NIGHT base units. Positive = received, negative = sent.
      // The UI displays absolute value with a +/- sign based on `type`.
      amount: netAmount < 0n ? -netAmount : netAmount,
      counterparty: '',
      timestamp: raw.txTimestamp ?? raw.tx_timestamp ?? 0,
      status: 'confirmed',
      fee: 0n,
      blockHeight: raw.blockHeight ?? raw.block_height,
      isShielded: false, // gero-sync's per-address subscription delivers unshielded only
      raw: raw.raw ?? raw.cbor,
    };
  }

  /**
   * Compute the net unshielded NIGHT delta for our address from a single tx's
   * created/spent outputs. Used by handleSync to update `balances.nightUnshielded`.
   */
  private computeNightDelta(raw: WsSyncTx, myUnshielded: string): bigint {
    const received = this.sumOutputsForOwner(this.readOutputs(raw, 'created'), myUnshielded);
    const spent = this.sumOutputsForOwner(this.readOutputs(raw, 'spent'), myUnshielded);
    return received - spent;
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
    const balances: Partial<MidnightBalances> = {};

    const unshielded = account.controlledAmount ?? account.controlled_amount;
    if (unshielded !== undefined) balances.nightUnshielded = this.toBig(unshielded);

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
