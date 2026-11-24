import { computed, type Ref } from 'vue';
import { midnightStore } from '@/stores/midnightStore';
import { isNativeNight } from '@/chains/midnight/midnightTokenBalances';
import { reservedSwapCoins, utxoRef, type MidnightSwapOfferRecord } from '@/chains/midnight/midnightSwapRecords';
import { NIGHT_TOKEN_TYPE } from './swapTokens';

/**
 * What the wallet can give, per token type: its synced coins minus those set
 * aside for its open offers (the worker selects from the same set).
 */
export function useSwapBalances(offers: Ref<readonly MidnightSwapOfferRecord[]>, now: Ref<number>) {
  return computed(() => {
    const reserved = reservedSwapCoins(offers.value, now.value);
    const totals = new Map<string, bigint>();
    for (const utxo of midnightStore.utxos) {
      if (reserved.has(utxoRef(utxo))) continue;
      const type = isNativeNight(utxo.tokenType) ? NIGHT_TOKEN_TYPE : utxo.tokenType.toLowerCase();
      totals.set(type, (totals.get(type) ?? 0n) + utxo.value);
    }
    return totals as ReadonlyMap<string, bigint>;
  });
}
