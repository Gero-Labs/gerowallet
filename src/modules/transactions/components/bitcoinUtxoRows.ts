import type { IUnifiedUtxo } from '@/chains/common/interfaces';

/** The BIP32 chain of the address an output pays: 0 receives, 1 takes change. */
export type BitcoinUtxoKind = 'receive' | 'change';

/** One unspent output of a Bitcoin wallet, as the UTxOs tab lists it. */
export interface BitcoinUtxoRow {
  /** The outpoint, `txid:vout`. */
  id: string;
  txHash: string;
  index: number;
  address: string;
  sats: bigint;
  confirmed: boolean;
  /** Null when the sync did not record which chain the address is on. */
  kind: BitcoinUtxoKind | null;
  /** The address's index on its chain, when recorded. */
  addressIndex: number | null;
}

// `value` is a bigint in the worker and a decimal string everywhere else: store
// broadcasts and the IndexedDB copy both serialize bigints.
function toSats(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

/** A Bitcoin wallet's IUnifiedUtxo record as a row, or null for anything else (a Cardano `[input, output]` pair). */
export function toBitcoinUtxoRow(utxo: unknown): BitcoinUtxoRow | null {
  if (!utxo || typeof utxo !== 'object' || Array.isArray(utxo)) return null;
  const record = utxo as { [K in keyof IUnifiedUtxo]?: unknown };
  const { txHash, index, address, derivationChain, derivationIndex } = record;
  if (typeof txHash !== 'string' || typeof index !== 'number') return null;
  const sats = toSats(record.value);
  if (sats === null) return null;
  return {
    id: `${txHash}:${index}`,
    txHash,
    index,
    address: typeof address === 'string' ? address : '',
    sats,
    confirmed: record.confirmed === true,
    kind: derivationChain === 0 ? 'receive' : derivationChain === 1 ? 'change' : null,
    addressIndex: typeof derivationIndex === 'number' ? derivationIndex : null,
  };
}

/** The rows of `walletStore.utxos` on a Bitcoin wallet. The tab's count uses this too, so it matches the list. */
export function bitcoinUtxoRows(utxos: readonly unknown[] | null | undefined): BitcoinUtxoRow[] {
  return (utxos ?? []).flatMap((utxo) => toBitcoinUtxoRow(utxo) ?? []);
}

/** `txid:vout` with the txid cut to its ends, keeping the output index whole. */
export function shortOutpoint(row: Pick<BitcoinUtxoRow, 'txHash' | 'index'>): string {
  const { txHash, index } = row;
  const hash = txHash.length > 16 ? `${txHash.slice(0, 8)}…${txHash.slice(-6)}` : txHash;
  return `${hash}:${index}`;
}
