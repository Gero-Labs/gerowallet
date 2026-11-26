/**
 * The vault's balance from the chain reader's UTxOs. A provider's answer is a display, never proof
 * (contracts.ts): nothing here is used to build or sign.
 *
 * A UTxO that names a datum by its hash alone is locked by a datum this wallet does not know: it is
 * shown as locked and left out of every total, until someone supplies the datum (spec 6.10.7).
 */
import { Cardano } from '@cardano-sdk/core';

export interface AssetAmount {
  /** `policyId` followed by the asset name, hex. */
  readonly assetId: string;
  readonly policyId: string;
  /** Hex. */
  readonly assetName: string;
  readonly quantity: bigint;
}

export interface LockedUtxo {
  readonly txId: string;
  readonly index: number;
  readonly lovelace: bigint;
  readonly assets: readonly AssetAmount[];
  readonly datumHash: string;
}

export interface VaultBalance {
  /** Spendable lovelace: every UTxO but the locked ones. */
  readonly lovelace: bigint;
  /** Spendable native assets, by asset id, sorted by id. */
  readonly assets: readonly AssetAmount[];
  /** UTxOs counted in the totals. */
  readonly utxoCount: number;
  /** UTxOs left out of the totals: locked by a datum this wallet does not know. */
  readonly locked: readonly LockedUtxo[];
}

/** Locked by a datum this wallet does not know: a datum hash with no inline datum. */
export function isLockedByUnknownDatum(out: Pick<Cardano.TxOut, 'datum' | 'datumHash'>): boolean {
  return typeof out.datumHash === 'string' && out.datumHash.length > 0 && out.datum === undefined;
}

function assetsOf(value: Cardano.Value): AssetAmount[] {
  const out: AssetAmount[] = [];
  for (const [assetId, quantity] of value.assets ?? new Map<Cardano.AssetId, bigint>()) {
    out.push({
      assetId,
      policyId: Cardano.AssetId.getPolicyId(assetId),
      assetName: Cardano.AssetId.getAssetName(assetId),
      quantity,
    });
  }
  return out.sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0));
}

/** Totals of the spendable UTxOs and the list of locked ones. Never throws on a well-typed list. */
export function summarizeVaultUtxos(utxos: readonly Cardano.Utxo[]): VaultBalance {
  let lovelace = 0n;
  let utxoCount = 0;
  const totals = new Map<string, AssetAmount>();
  const locked: LockedUtxo[] = [];
  for (const [txIn, out] of utxos) {
    const assets = assetsOf(out.value);
    if (isLockedByUnknownDatum(out)) {
      locked.push({ txId: txIn.txId, index: txIn.index, lovelace: out.value.coins, assets, datumHash: out.datumHash as string });
      continue;
    }
    utxoCount++;
    lovelace += out.value.coins;
    for (const asset of assets) {
      const current = totals.get(asset.assetId);
      totals.set(asset.assetId, current ? { ...current, quantity: current.quantity + asset.quantity } : asset);
    }
  }
  const assets = [...totals.values()].sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0));
  return { lovelace, assets, utxoCount, locked };
}

/** Lovelace in the locked UTxOs, for the "not counted" line. */
export function lockedLovelace(balance: Pick<VaultBalance, 'locked'>): bigint {
  return balance.locked.reduce((sum, u) => sum + u.lovelace, 0n);
}

const PRINTABLE = /^[\x20-\x7e]+$/;

/**
 * An asset name for display: its UTF-8 text when that is printable ASCII, otherwise its hex. Never
 * trusted as text: screens still pass it through `displayLabel`.
 */
export function assetNameText(assetNameHex: string): string {
  if (!assetNameHex) return '';
  const bytes = assetNameHex.match(/../g)?.map(h => Number.parseInt(h, 16)) ?? [];
  const text = String.fromCharCode(...bytes);
  return PRINTABLE.test(text) ? text : assetNameHex;
}
