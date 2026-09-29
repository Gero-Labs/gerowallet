/**
 * Collateral for the swap widget's Plutus spends (order cancels) when the wallet holds no
 * ADA-only UTxO of 5 ADA or more: borrow one from the Nexus pool, the way trusted dApps do
 * through CIP-30 `getCollateral`. A borrowed collateral input needs the pool's co-signature:
 * the worker's SIGN_TX adds it for password and PassKey wallets (it asks Nexus about every
 * collateral input), and `cosignLentCollateral` adds it for the hardware wallets that sign
 * in the page.
 */
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { nexusCollateralApi, lendRef } from '@/api/nexus-collateral-api';
import { toNexusNetwork } from '@/api/nexus-tx-api';
import { mergeWitnessSets } from '@/shared/utils/witnessSets';

const LENT_TTL_MS = 10 * 60 * 1000;
const lentRefs = new Map<string, number>();

/** True when this page borrowed `utxoRef` from the pool within the last ten minutes. */
export function isLentHere(utxoRef: string): boolean {
  const at = lentRefs.get(utxoRef);
  if (at === undefined) return false;
  if (Date.now() - at > LENT_TTL_MS) { lentRefs.delete(utxoRef); return false; }
  return true;
}

/**
 * Borrow a pool UTxO for the wallet's network and return it as CIP-30 hex. Also tells the
 * worker (MARK_NEXUS_LENT) so a failed co-signature there fails loudly instead of yielding an
 * under-signed transaction. Throws when the pool is empty or the network mismatches.
 */
export async function lendPoolCollateral(walletNetwork: string | undefined): Promise<string> {
  const { buildNexusUtxoCbor } = await import('@/chrome/serialization');
  const lent = await nexusCollateralApi.lend(toNexusNetwork(walletNetwork));
  const cbor = buildNexusUtxoCbor(lent);
  const ref = lendRef(lent);
  lentRefs.set(ref, Date.now());
  Messaging.sendToBackgroundFromOptions({ method: MessageTypes.MARK_NEXUS_LENT, data: { utxoRef: ref } }).catch(() => undefined);
  return cbor;
}

/** The `txHash#index` refs of a transaction's collateral inputs. */
export async function collateralRefsOf(unsignedTxCbor: string): Promise<string[]> {
  const { Serialization } = await import('@cardano-sdk/core');
  const { HexBlob } = await import('@cardano-sdk/util');
  const core = Serialization.Transaction.fromCbor(HexBlob(unsignedTxCbor)).toCore();
  return (core.body.collaterals ?? []).map((c) => `${c.txId}#${c.index}`);
}

/**
 * For every collateral input this page borrowed, fetch the pool's witness and merge it into
 * the user's witness set. Refs the page did not borrow are the user's own and are left alone.
 * A co-signature that fails for a borrowed ref throws: the transaction could not be submitted.
 */
export async function cosignLentCollateral(unsignedTxCbor: string, witnessSetCbor: string, walletNetwork: string | undefined, refs?: string[]): Promise<string> {
  // Nothing borrowed from this page: the transaction's collateral is the user's own, and there
  // is nothing to co-sign, so the transaction is not even parsed.
  if (!refs && ![...lentRefs.keys()].some(isLentHere)) return witnessSetCbor;
  const collateralRefs = refs ?? await collateralRefsOf(unsignedTxCbor);
  let merged = witnessSetCbor;
  for (const ref of collateralRefs) {
    if (!isLentHere(ref)) continue;
    const { witness } = await nexusCollateralApi.cosign(unsignedTxCbor, ref, toNexusNetwork(walletNetwork));
    merged = await mergeWitnessSets(merged, witness);
  }
  return merged;
}
