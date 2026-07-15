import { computed, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { getBalance } from '@/chrome/serialization';

/**
 * Reactive ADA balance (in lovelace) derived from the active wallet's UTxOs.
 * Shared by the mini-gero token list and home header so "is this wallet empty?"
 * is computed once, consistently. Returns 0 when there are no UTxOs or the
 * balance can't be read.
 */
export function useAdaLovelace() {
  const { utxos, collateral } = toRefs(walletStore);

  const adaLovelace = computed(() => {
    if (!utxos.value || utxos.value.length === 0) return 0;
    try {
      const balance = getBalance(utxos.value, collateral.value);
      return Number(balance.coin().toString());
    } catch {
      return 0;
    }
  });

  return { adaLovelace };
}
