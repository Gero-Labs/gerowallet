import { computed, ref, watch, type Ref } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import { canonicalAddress } from '@/shared/utils/txIntentGuard';
import { historySource, koiosSource, outputRef, proveOutputs, sameOutput } from '@/shared/utils/provenInputs';

/**
 * The wallet UTxOs a dApp approval summary counts as "You pay", checked against
 * the transactions that created them (provenInputs.ts).
 *
 * The UTxO list comes from gero-sync. The summary is built from it at once and
 * never waits for the check. When the check shows that the list misstates an
 * input the transaction spends (the value, or whose it is), the summary is rebuilt
 * from the proven outputs (an input that turns out not to be the wallet's is
 * dropped, so the total becomes an estimate) and `misreported` asks the approval
 * to hold Sign for an explicit acknowledgement. An input that cannot be proven
 * (no history, Koios unreachable) changes nothing: it never blocks an approval.
 */
export function useProvenApprovalUtxos(
  tx: Ref<Cardano.Tx | null | undefined>,
  claimed: Ref<readonly Cardano.Utxo[]>,
  network: Ref<string | undefined>,
  transactions: () => readonly unknown[] | null | undefined,
) {
  const proven = ref<Map<string, Cardano.TxOut> | null>(null);
  const misreported = ref(false);

  /** The claimed UTxOs this transaction spends or puts up as collateral, keyed by ref. */
  const spentClaims = computed(() => {
    const body = tx.value?.body;
    const byRef = new Map(claimed.value.map(([txIn, txOut]) => [outputRef(txIn), txOut] as const));
    const spent = new Map<string, Cardano.TxOut>();
    for (const txIn of [...(body?.inputs ?? []), ...(body?.collaterals ?? [])]) {
      const ref = outputRef(txIn);
      const out = byRef.get(ref);
      if (out) spent.set(ref, out);
    }
    return spent;
  });

  // Re-check only when the spent refs or what the list says about them change,
  // not on every unrelated UTxO update.
  const checkKey = computed(() => [...spentClaims.value]
    .map(([ref, out]) => `${ref}:${String(out.address)}:${String(out.value?.coins ?? 0n)}:${out.value?.assets?.size ?? 0}`)
    .sort()
    .join('|'));

  let run = 0;
  watch(checkKey, async () => {
    const current = ++run;
    proven.value = null;
    misreported.value = false;
    const claims = spentClaims.value;
    if (claims.size === 0) return;
    let result;
    try {
      result = await proveOutputs(claims.keys(), [historySource(transactions()), koiosSource(network.value)]);
    } catch {
      return;
    }
    if (current !== run) return;
    proven.value = result.proven;
    misreported.value = [...claims].some(([ref, out]) => {
      const actual = result.proven.get(ref);
      return !!actual && !sameOutput(out, actual);
    });
  }, { immediate: true });

  const ownUtxos = computed<readonly Cardano.Utxo[]>(() => {
    const checked = proven.value;
    if (!misreported.value || !checked) return claimed.value;
    return claimed.value.flatMap(([txIn, txOut]): Cardano.Utxo[] => {
      const actual = checked.get(outputRef(txIn));
      if (!actual) return [[txIn, txOut]];
      return canonicalAddress(String(actual.address)) === canonicalAddress(String(txOut.address)) ? [[txIn, actual]] : [];
    });
  });

  return { ownUtxos, misreported };
}
