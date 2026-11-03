import { computed, ref, shallowRef } from 'vue';
import { Serialization, type Cardano } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import i18n from '@/plugins/i18n';
import { walletStore } from '@/stores/walletStore';
import {
  cardanoUtxoToNexusInput,
  nexusTxApi,
  requiredAssetsFromOutputs,
  selectInputCandidates,
  type NexusCallOptions,
  type NexusTxOutput,
} from '@/api/nexus-tx-api';
import type { InputSelection } from '@/api/nexusInputSelection';
import { buildSweep, type BuiltSweep } from '@/api/sweepBuild';
import { planMerges, shortOnlyByLimit, type SweepPrerequisites } from '@/api/sweepPlan';
import { shortfallLovelaceFromMessage } from '@/shared/utils/txErrors';

/** The payment a flow asks for: its outputs, and where its change goes. */
export interface PaymentRequest {
  outputs: NexusTxOutput[];
  changeAddress: string;
}

/** Merges kept longer than this are planned again: Nexus gives a transaction two hours to land. */
const SWEEP_FRESH_MS = 60 * 60 * 1000;

/**
 * One payment from a wallet whose candidates for one Nexus request (its largest UTxOs, at most
 * NEXUS_MAX_INPUTS) cannot cover it although the whole wallet can. It then goes out as Quick
 * Send's Max does: merges into the wallet's own address first, then the payment from their
 * outputs and the rest, signed under one approval (hand `prerequisites` to
 * useTransactionSigning). Quick Send runs its own, for several recipients and live rebuilds;
 * this one serves a flow that pays one request.
 */
export function usePaymentSweep() {
  const sweep = shallowRef<(BuiltSweep & { builtAt: number }) | null>(null);
  /** While the merges are built: how many of how many, and whether a build waits out the rate limit. */
  const preparing = ref<{ built: number; total: number; utxoCount: number; waiting: boolean } | null>(null);
  /** The sweep's payment and the request it was built for, so the same request signs the same transaction. */
  const payment = shallowRef<{ key: string; tx: Cardano.Tx } | null>(null);
  const prerequisites = computed<SweepPrerequisites | null>(() =>
    sweep.value ? { cbors: sweep.value.mergeCbors, outputs: sweep.value.mergeOutputs } : null);
  /** The build in progress, given up by reset(). */
  let abort: AbortController | null = null;

  function fragmented(selection: InputSelection): Error {
    return new Error(i18n.t('send.inputLimitFragmented', { count: selection.total, max: selection.limit }) as string);
  }

  async function buildPayment(request: PaymentRequest, utxos: Cardano.Utxo[], selectAll: boolean, call?: NexusCallOptions): Promise<Cardano.Tx> {
    const { tx_cbor: txCbor } = await nexusTxApi.buildTransferTx({
      ...request,
      utxos: utxos.map(cardanoUtxoToNexusInput),
      ...(selectAll ? { selectAll: true } : {}),
    }, walletStore.loggedWallet.network, call);
    if (!txCbor) throw new Error(i18n.t('errors.buildTransactionFailed') as string);
    return Serialization.Transaction.fromCbor(HexBlob(txCbor)).toCore();
  }

  async function buildMerges(utxos: Cardano.Utxo[], selection: InputSelection, controller: AbortController): Promise<void> {
    const plan = planMerges(utxos);
    // Its token holders leave too few ADA-only UTxOs to merge: there is no sweep to offer.
    if (!plan) throw fragmented(selection);
    const utxoCount = plan.direct.length + plan.batches.reduce((sum, batch) => sum + batch.length, 0);
    const ours = () => abort === controller;
    preparing.value = { built: 0, total: plan.batches.length, utxoCount, waiting: false };
    try {
      const built = await buildSweep(plan, {
        ownAddress: walletStore.keys.payment[0].address,
        network: walletStore.loggedWallet.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
        walletNetwork: walletStore.loggedWallet.network,
        signal: controller.signal,
        onMergeBuilt: (count, total) => { if (ours()) preparing.value = { built: count, total, utxoCount, waiting: false }; },
        // The server asked for a pause: the count stays, and the card says so until the next merge lands.
        onRateLimited: () => { if (ours() && preparing.value) preparing.value = { ...preparing.value, waiting: true }; },
      });
      if (ours()) sweep.value = { ...built, builtAt: Date.now() };
    } finally {
      if (ours()) preparing.value = null;
    }
  }

  /**
   * Builds `request` from `utxos`. As one transaction when the candidates one request carries
   * cover it. When only that limit stands in the way: with `canSweep`, as a sweep (the merges,
   * then a payment that spends every candidate, as the signer requires); without, refused with
   * send.inputLimitFragmented. A sweep's payment is kept, so the same request returns the same
   * transaction and a retry after an interrupted sweep signs it again, skipping the merges
   * already sent. Any other refusal is passed on as Nexus gave it.
   */
  async function build(request: PaymentRequest, utxos: Cardano.Utxo[], canSweep: boolean): Promise<Cardano.Tx> {
    const key = JSON.stringify(request);
    if (sweep.value && Date.now() - sweep.value.builtAt > SWEEP_FRESH_MS) reset();
    if (sweep.value && payment.value?.key === key) return payment.value.tx;

    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    if (!sweep.value) {
      const selection = selectInputCandidates(utxos, { requiredAssets: requiredAssetsFromOutputs(request.outputs) });
      try {
        return await buildPayment(request, selection.utxos, false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!shortOnlyByLimit(shortfallLovelaceFromMessage(message), selection, utxos)) throw error;
        if (!canSweep) throw fragmented(selection);
        await buildMerges(utxos, selection, controller);
      }
    }
    const built = sweep.value;
    if (!built || abort !== controller) throw controller.signal.reason ?? new Error(i18n.t('errors.buildTransactionFailed') as string);
    const tx = await buildPayment(request, [...built.direct, ...built.mergeOutputs], true, { rateLimitRetry: true, signal: controller.signal });
    if (abort !== controller) throw controller.signal.reason;
    payment.value = { key, tx };
    return tx;
  }

  /** Forget the sweep and its payment, and give up a build in progress. */
  function reset(): void {
    abort?.abort();
    abort = null;
    sweep.value = null;
    preparing.value = null;
    payment.value = null;
  }

  return { sweep, preparing, payment, prerequisites, build, reset };
}
