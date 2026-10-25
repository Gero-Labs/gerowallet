/**
 * What the Midnight connector's `getDustBalance` answers (issue 1118): the logged
 * wallet's merged Path A + Path B DUST, the figure the battery shows. Never the
 * store's Path-A `dustState` alone: a wallet whose DUST comes from a Cardano cNIGHT
 * registration reads `{ cap: 0, balance: 0 }` there, and a dApp would conclude it
 * cannot pay fees.
 *
 * Null until both paths have reported; the handler then tells the dApp to retry.
 *
 * Imports are static on purpose: the background is one iife, so a dynamic import
 * splits nothing off and can only leave a namespace declared after its reader
 * (scripts/check-bundle-tdz.mjs).
 */
import { midnightStore } from '@/stores/midnightStore';
import { getMidnightApi } from '@/api/midnight-api';
import { enumerateCardanoStakeIdentities } from '@/shared/composables/useCardanoStakeEnumeration';
import { readMergedDustBalance, reusedDustReader, type DustFigures } from '@/chains/midnight/midnightDustBalance';

let reader: ReturnType<typeof reusedDustReader> | null = null;

export async function connectorDustBalance(
  network: string,
  unshielded: string | undefined,
  dust: string | undefined,
): Promise<DustFigures | null> {
  if (!unshielded || !dust) return null;
  reader ??= reusedDustReader();
  return reader(`${network}|${unshielded}|${dust}`, () => readMergedDustBalance({
    api: getMidnightApi(network),
    unshieldedAddress: unshielded,
    dustAddress: dust,
    storeDustState: midnightStore.dustState,
    enumerateStakes: async () => (await enumerateCardanoStakeIdentities(network))
      .map((identity) => identity.stakeAddress)
      .filter(Boolean),
  }));
}

/** Tests only: forget the shared read. */
export function resetConnectorDustReader(): void {
  reader = null;
}
