import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { cardanoUtxoToNexusInput, nexusTxApi } from './nexus-tx-api';
import { ownOutputsAsUtxos, type MergePlan } from './sweepPlan';

/** Merges built at once: a ten-merge sweep stays quick without a burst at Nexus. */
const MERGE_BUILD_CONCURRENCY = 3;

export interface BuiltSweep {
  /** Unsigned merge transactions, in the order they are submitted. */
  merges: Cardano.Tx[];
  /** Their outputs at the wallet's own address, which the payment spends. */
  mergeOutputs: Cardano.Utxo[];
  /** UTxOs the payment also spends directly. */
  direct: Cardano.Utxo[];
  /** The merges' fees together, lovelace. */
  mergeFee: bigint;
  /** UTxOs the sweep spends in all. */
  utxoCount: number;
}

export interface SweepBuildContext {
  /** The wallet's change address: where every merge pays. */
  ownAddress: string;
  /** The request body's network, as buildTransferTx takes it. */
  network: 'MAINNET' | 'PREPROD';
  /** The wallet's network name, for the endpoint. */
  walletNetwork: string;
}

/**
 * Build a plan's merges through Nexus. Each spends one batch, all of it (`selectAll`),
 * into one output at the wallet's own address; buildTransferTx refuses any result that
 * pays elsewhere or spends a UTxO outside the batch.
 */
export async function buildSweep(plan: MergePlan, context: SweepBuildContext): Promise<BuiltSweep> {
  const merges: Cardano.Tx[] = new Array(plan.batches.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < plan.batches.length) {
      const index = next++;
      const { tx_cbor: txCbor } = await nexusTxApi.buildTransferTx({
        outputs: [{ address: context.ownAddress, lovelace: '0' }],
        changeAddress: context.ownAddress,
        utxos: plan.batches[index].map(cardanoUtxoToNexusInput),
        network: context.network,
        selectAll: true,
      }, context.walletNetwork);
      merges[index] = Serialization.Transaction.fromCbor(HexBlob(txCbor)).toCore();
    }
  };
  await Promise.all(Array.from({ length: Math.min(MERGE_BUILD_CONCURRENCY, plan.batches.length) }, worker));
  return {
    merges,
    mergeOutputs: merges.flatMap((tx) => ownOutputsAsUtxos(tx, context.ownAddress)),
    direct: plan.direct,
    mergeFee: merges.reduce((sum, tx) => sum + BigInt(tx.body.fee), BigInt(0)),
    utxoCount: plan.direct.length + plan.batches.reduce((sum, batch) => sum + batch.length, 0),
  };
}
