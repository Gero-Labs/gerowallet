import { computed, shallowRef, watch, type ComputedRef, type ShallowRef } from 'vue';
import type { PsbtReview } from '@/chains/bitcoin/psbtReview';

/** A Bitcoin approval view's PSBT request, with the logged wallet it is reviewed against. */
export interface BitcoinPsbtReviewSource {
  psbtHex?: string;
  /** The dApp's signing options: `{ toSignInputs, autoFinalized }`, or a bare list (WalletConnect). */
  options?: unknown;
  wallet: { publicKey?: string; addressType?: string; network?: string } | null | undefined;
  /** The wallet's synced UTxOs (`walletStore.utxos`). */
  utxos?: unknown;
  /**
   * A hardware device signs every input of its own, whatever toSignInputs
   * lists, so its review shows exactly that.
   */
  ignoreToSignInputs?: boolean;
}

/**
 * The approval view's decode of a dApp PSBT: the same `reviewBitcoinPsbt` the
 * background signer runs, so the inputs listed as signed are the inputs that
 * get signed. `review` is null until decoded; `blocked` holds signing back
 * until then, and for good when the review finds a problem.
 */
export function useBitcoinPsbtReview(
  source: () => BitcoinPsbtReviewSource | null | undefined,
): { review: ShallowRef<PsbtReview | null>; blocked: ComputedRef<boolean> } {
  const review = shallowRef<PsbtReview | null>(null);
  let generation = 0;

  watch(
    () => {
      const s = source();
      return [s?.psbtHex, s?.options, s?.ignoreToSignInputs, s?.wallet?.publicKey, s?.wallet?.addressType, s?.wallet?.network, s?.utxos] as const;
    },
    async ([psbtHex, options, ignoreToSignInputs, publicKey, addressType, network, utxos]) => {
      const mine = ++generation;
      review.value = null;
      if (!psbtHex || !network) return;
      // Loaded on demand: bitcoinjs-lib stays out of the views' initial chunk.
      const { bitcoinDerivedAddresses, bitcoinOwnAddresses, reviewBitcoinPsbt } = await import('@/chains/bitcoin/psbtReview');
      if (mine !== generation) return;
      const ownUtxos = (Array.isArray(utxos) ? utxos as Array<{ txHash?: unknown; index?: unknown; value?: unknown; address?: unknown }> : [])
        .filter((u) => typeof u?.txHash === 'string' && typeof u.index === 'number' && u.value !== undefined && u.value !== null)
        .map((u) => ({
          txHash: u.txHash as string,
          index: u.index as number,
          value: String(u.value),
          address: typeof u.address === 'string' ? u.address : undefined,
        }));
      review.value = reviewBitcoinPsbt(psbtHex, {
        network,
        ownAddresses: bitcoinOwnAddresses(publicKey, addressType, network, ownUtxos),
        ownUtxos,
        signOptions: ignoreToSignInputs ? undefined : options,
        // Outputs are the wallet's only by derivation, never by what a sync listed.
        derived: bitcoinDerivedAddresses(publicKey, addressType, network),
      });
    },
    { immediate: true },
  );

  const blocked = computed(() => !review.value || review.value.problems.length > 0);
  return { review, blocked };
}
