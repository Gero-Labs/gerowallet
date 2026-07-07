/**
 * "Is the Midnight view still waiting for its first data?"
 *
 * After login / extension reload the gero-sync WS takes a few seconds to
 * deliver the first sync payload; during that window the store holds zeros
 * and every surface used to render "0.00 tNIGHT" — indistinguishable from a
 * genuinely empty wallet. This signal lets surfaces show a skeleton instead.
 *
 * Loading is true only while we're CONNECTING and hold no data at all —
 * hydrated non-zero state (from chrome.storage) renders immediately as
 * stale-but-real values, which beats a skeleton.
 */
import { computed, type ComputedRef } from 'vue';
import { midnightStore } from '@/stores/midnightStore';

export function useMidnightLoading(): ComputedRef<boolean> {
  return computed(() =>
    midnightStore.networkStatus !== 'connected'
    && (midnightStore.balances.nightUnshielded ?? 0n) === 0n
    && (midnightStore.balances.dust ?? 0n) === 0n
    && midnightStore.transactions.length === 0
    && midnightStore.utxos.length === 0,
  );
}
