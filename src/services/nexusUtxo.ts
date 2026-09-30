import { Cardano } from '@cardano-sdk/core';
import { debugLog } from '@/utils/debug';
import { inlineDatumCbor, inlineDatumFromCbor } from '@/shared/utils/utxoCbor';
import { toScriptReference } from '@/shared/utils/scriptReference';

/**
 * Convert Nexus UTxO format to Cardano.Utxo[] (TxIn/TxOut tuples).
 * Nexus: {txHash, txIndex, address, value, assetList, datumHash, inlineDatum, referenceScript}
 * Wallet: [[{txId, index, address}, {address, value: {coins, assets}, datumHash, datum, scriptReference}]]
 *
 * gero-sync pushes Nexus rows verbatim (an inline datum is `{ bytes, value | json }`), plus
 * rows of its own for outputs it takes from a block before Nexus has indexed them (the
 * inline datum is bare hex).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Nexus payload shape documented above; fields normalized defensively below
export function convertNexusUtxos(nexusUtxos: any[]): Cardano.Utxo[] {
  const result: Cardano.Utxo[] = [];
  for (const u of nexusUtxos) {
    try {
      const txHash = u.txHash || u.tx_hash;
      const txIndex = u.txIndex ?? u.tx_index ?? u.output_index ?? 0;
      const address = u.address || u.owner_addr;
      const lovelace = BigInt(u.value || u.lovelace_amount || '0');

      // Build assets map from assetList
      const assets = new Map<Cardano.AssetId, bigint>();
      const assetList = u.assetList || u.assets || u.amounts || [];
      for (const a of assetList) {
        const unit = a.unit || (a.policyId && a.assetName ? a.policyId + a.assetName : null);
        if (unit && unit !== 'lovelace') {
          assets.set(Cardano.AssetId(unit), BigInt(a.quantity || '0'));
        }
      }

      const txIn: Cardano.HydratedTxIn = {
        txId: Cardano.TransactionId(txHash),
        index: txIndex,
        address: address as Cardano.PaymentAddress,
      };

      const inlineDatum = inlineDatumCbor(u.inlineDatum);

      const txOut: Cardano.TxOut = {
        address: address as Cardano.PaymentAddress,
        value: {
          coins: lovelace,
          assets: assets.size > 0 ? assets : undefined,
        },
        // An output holds an inline datum or a datum hash, never both. The hash Nexus
        // reports beside an inline datum is derived from it; keeping it would serialize
        // the output as a datum-HASH output.
        datumHash: inlineDatum ? undefined : u.datumHash || undefined,
        datum: inlineDatum ? inlineDatumFromCbor(inlineDatum) : undefined,
        scriptReference: toScriptReference(u.referenceScript),
      };

      result.push([txIn, txOut]);
    } catch (e) {
      debugLog('Failed to convert Nexus UTxO:', e, u);
    }
  }
  return result;
}
