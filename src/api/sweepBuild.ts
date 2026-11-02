import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import i18n from '@/plugins/i18n';
import { cardanoUtxoToNexusInput, nexusTxApi } from './nexus-tx-api';
import { ownOutputsAsUtxos, type MergePlan } from './sweepPlan';

/** Merges built at once: a ten-merge sweep stays quick without a burst at Nexus. */
const MERGE_BUILD_CONCURRENCY = 3;

export interface BuiltSweep {
  /** Unsigned merge transactions, in the order they are submitted. */
  merges: Cardano.Tx[];
  /**
   * The same merges as Nexus built them (CBOR hex), index-aligned with `merges`: signed
   * and submitted byte for byte, so their ids stay the ones the payment spends.
   */
  mergeCbors: string[];
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
  /** Called after each merge is built and checked, with how many are built so far and how many the plan has. */
  onMergeBuilt?: (built: number, total: number) => void;
}

/**
 * Build a plan's merges through Nexus. Each spends one batch, all of it (`selectAll`),
 * into one output at the wallet's own address; buildTransferTx refuses any result that
 * pays elsewhere or spends a UTxO outside the batch. The first failure stops the
 * remaining builds and rejects the whole sweep.
 */
export async function buildSweep(plan: MergePlan, context: SweepBuildContext): Promise<BuiltSweep> {
  const merges: Cardano.Tx[] = new Array(plan.batches.length);
  const mergeCbors: string[] = new Array(plan.batches.length);
  let next = 0;
  let built = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < plan.batches.length) {
      const index = next++;
      try {
        const { tx_cbor: txCbor } = await nexusTxApi.buildTransferTx({
          outputs: [{ address: context.ownAddress, lovelace: '0' }],
          changeAddress: context.ownAddress,
          utxos: plan.batches[index].map(cardanoUtxoToNexusInput),
          network: context.network,
          selectAll: true,
        }, context.walletNetwork);
        const tx = Serialization.Transaction.fromCbor(HexBlob(txCbor)).toCore();
        // A merge pays its whole batch to one output. A second (change) output would add
        // an input to the payment and push it over the request limit.
        if (tx.body.outputs.length !== 1 || ownOutputsAsUtxos(tx, context.ownAddress).length !== 1) {
          throw new Error(String(i18n.t('txGuard.builtTxMismatch')));
        }
        merges[index] = tx;
        mergeCbors[index] = txCbor;
        // Merges finish out of order: report the count, not the index.
        context.onMergeBuilt?.(++built, plan.batches.length);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MERGE_BUILD_CONCURRENCY, plan.batches.length) }, worker));
  return {
    merges,
    mergeCbors,
    mergeOutputs: merges.flatMap((tx) => ownOutputsAsUtxos(tx, context.ownAddress)),
    direct: plan.direct,
    mergeFee: merges.reduce((sum, tx) => sum + BigInt(tx.body.fee), BigInt(0)),
    utxoCount: plan.direct.length + plan.batches.reduce((sum, batch) => sum + batch.length, 0),
  };
}
