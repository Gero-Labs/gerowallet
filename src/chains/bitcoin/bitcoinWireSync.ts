/**
 * Bitcoin gero-sync wire → internal shape converters (Phase 3).
 *
 * Maps the CONTRACT-btc-wire.md payload objects (snake_case, satoshis) that the
 * gero-sync WebSocket emits for Bitcoin into the SAME internal shapes the Esplora
 * poller produces, so the UI renders WS-fed data identically to poller-fed data:
 *   - BtcUtxo[] → IUnifiedUtxo[]       (matches parseBitcoinUtxos, bitcoinUtxoManager.ts)
 *   - BtcTx[]   → UnifiedTransaction[] (matches parseBitcoinTransaction, bitcoinTransactionParser.ts)
 *
 * Pure + defensive: every wire field is optional (the server may omit Cardano-only
 * fields and, for BTC, some blocks). Amounts are satoshis (u64) — kept as bigint
 * for UTxOs (so WalletStore.setUtxos → calculateBitcoinBalance is unchanged) and as
 * number for tx `ada`/`fee` (the UnifiedTransaction contract). No Cardano code here.
 */

import type { IUnifiedUtxo } from '@/chains/common/interfaces';
import {
  TransactionType,
  type UnifiedTransaction,
  type TransactionInput,
  type TransactionOutput,
} from './bitcoinTransactionParser';

/** BtcUtxo `status` block (CONTRACT-btc-wire.md). All fields optional/defensive. */
export interface BtcUtxoStatus {
  confirmed?: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}

/** BtcUtxo wire shape (Esplora `/address/{a}/utxo` + server-added `address`). */
export interface BtcUtxo {
  txid?: string;
  vout?: number;
  value?: number | string;
  address?: string;
  status?: BtcUtxoStatus;
}

/** BtcTx `vin` entry (server resolves prevout address + value). */
export interface BtcTxVin {
  txid?: string;
  vout?: number;
  address?: string;
  value?: number;
}

/** BtcTx `vout` entry. */
export interface BtcTxVout {
  vout?: number;
  address?: string;
  value?: number;
}

/** BtcTx wire shape. Server stamps `net` (signed satoshis) + `direction`. */
export interface BtcTx {
  txid?: string;
  block_height?: number;
  block_time?: number;
  confirmed?: boolean;
  fee?: number;
  vin?: BtcTxVin[];
  vout?: BtcTxVout[];
  net?: number;
  direction?: 'in' | 'out' | 'self';
}

/** BtcAccount wire shape (satoshis). Cardano rewards/delegation fields omitted. */
export interface BtcAccount {
  balance?: number;
  unconfirmed_balance?: number;
  tx_count?: number;
}

/**
 * Convert wire `BtcUtxo[]` → `IUnifiedUtxo[]` (near-identity with parseBitcoinUtxos).
 *
 * `value` becomes a bigint so WalletStore.setUtxos → calculateBitcoinBalance works
 * unchanged; `confirmed` drives available-vs-total balance; `raw` keeps the wire
 * object (same fields the send-side reads off poller UTxOs, plus a harmless
 * `address`). Entries missing txid/vout are skipped rather than breaking the batch.
 */
export function convertBtcUtxos(wireUtxos: BtcUtxo[] | undefined | null): IUnifiedUtxo[] {
  if (!Array.isArray(wireUtxos)) {
    return [];
  }
  const result: IUnifiedUtxo[] = [];
  for (const u of wireUtxos) {
    if (!u || u.txid == null || u.vout == null) {
      continue;
    }
    try {
      result.push({
        txHash: u.txid,
        index: u.vout,
        address: u.address || '',
        value: BigInt(u.value ?? 0),
        confirmed: u.status?.confirmed ?? false,
        raw: u,
      });
    } catch {
      // Skip a malformed entry (e.g. non-integer value) rather than break the batch.
    }
  }
  return result;
}

/** Map the server-computed `direction` onto the UI's TransactionType. */
function directionToType(direction: BtcTx['direction']): TransactionType {
  switch (direction) {
    case 'in':
      return TransactionType.RECEIVE;
    case 'out':
      return TransactionType.SEND;
    case 'self':
    default:
      return TransactionType.SELF;
  }
}

/**
 * Convert wire `BtcTx[]` → `UnifiedTransaction[]` (matches parseBitcoinTransaction).
 *
 * - `ada`           = server-computed signed `net` (satoshis) — no client vin/vout math.
 * - `type`          = from server `direction` (in/out/self).
 * - `pending`       = !confirmed (confirmed inferred from `confirmed` or presence of block_height).
 * - `confirmations` = tipHeight - block_height + 1 (0 when pending or tip unknown).
 * - `block_hash`/`size`/`weight`/`vsize` are NOT on the wire (Cardano/Esplora-detail
 *   only) → left undefined (all optional on UnifiedTransaction).
 *
 * Sorted newest-first, mirroring parseBitcoinTransactionHistory.
 */
export function convertBtcTransactions(
  wireTxs: BtcTx[] | undefined | null,
  tipHeight?: number,
): UnifiedTransaction[] {
  if (!Array.isArray(wireTxs)) {
    return [];
  }
  const parsed: UnifiedTransaction[] = [];
  for (const tx of wireTxs) {
    if (!tx || !tx.txid) {
      continue;
    }
    const confirmed = tx.confirmed ?? tx.block_height != null;
    const confirmations =
      confirmed && tx.block_height != null && tipHeight != null && tipHeight > 0
        ? tipHeight - tx.block_height + 1
        : 0;

    const inputs: TransactionInput[] = Array.isArray(tx.vin)
      ? tx.vin.map((i) => ({
          address: i?.address || '',
          value: i?.value || 0,
          txid: i?.txid || '',
          vout: i?.vout ?? 0,
        }))
      : [];

    const outputs: TransactionOutput[] = Array.isArray(tx.vout)
      ? tx.vout.map((o) => ({
          address: o?.address || '',
          value: o?.value || 0,
        }))
      : [];

    parsed.push({
      id: tx.txid,
      tx_timestamp: tx.block_time || Math.floor(Date.now() / 1000),
      ada: tx.net || 0,
      assets: [],
      pending: !confirmed,
      block_height: tx.block_height,
      fee: tx.fee,
      inputs,
      outputs,
      type: directionToType(tx.direction),
      confirmations,
    });
  }
  return parsed.sort((a, b) => b.tx_timestamp - a.tx_timestamp);
}

/**
 * Merge freshly-converted transactions into the existing set, keyed by txid.
 *
 * Incoming wins so a pending tx re-sent later WITH a block_height upgrades the
 * stored one (pending → confirmed, confirmations refreshed). Existing txs absent
 * from a partial/real-time batch are preserved (never dropped). Result is sorted
 * newest-first to match the poller's ordering.
 */
export function mergeBtcTransactions(
  existing: UnifiedTransaction[] | undefined | null,
  incoming: UnifiedTransaction[],
): UnifiedTransaction[] {
  const byId = new Map<string, UnifiedTransaction>();
  if (Array.isArray(existing)) {
    for (const tx of existing) {
      if (tx && tx.id) {
        byId.set(tx.id, tx);
      }
    }
  }
  for (const tx of incoming) {
    if (tx && tx.id) {
      byId.set(tx.id, tx);
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.tx_timestamp - a.tx_timestamp);
}
