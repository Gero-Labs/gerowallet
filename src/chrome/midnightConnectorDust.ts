/**
 * What the Midnight connector's `getDustBalance` answers (issue 1118): the logged
 * wallet's merged Path A + Path B DUST, the figure the battery shows. Never the
 * store's Path-A `dustState` alone: a wallet whose DUST comes from a Cardano cNIGHT
 * registration reads `{ cap: 0, balance: 0 }` there, and a dApp would conclude it
 * cannot pay fees.
 *
 * Null until both paths have reported; the handler then tells the dApp to retry.
 */
import type { DustFigures, reusedDustReader } from '@/chains/midnight/midnightDustBalance';

let reader: ReturnType<typeof reusedDustReader> | null = null;

export async function connectorDustBalance(
  network: string,
  unshielded: string | undefined,
  dust: string | undefined,
): Promise<DustFigures | null> {
  if (!unshielded || !dust) return null;
  const [{ midnightStore }, { getMidnightApi }, balance] = await Promise.all([
    import('@/stores/midnightStore'),
    import('@/api/midnight-api'),
    import('@/chains/midnight/midnightDustBalance'),
  ]);
  reader ??= balance.reusedDustReader();
  return reader(`${network}|${unshielded}|${dust}`, () => balance.readMergedDustBalance({
    api: getMidnightApi(network),
    unshieldedAddress: unshielded,
    dustAddress: dust,
    storeDustState: midnightStore.dustState,
    enumerateStakes: async () => {
      const { enumerateCardanoStakeIdentities } = await import('@/shared/composables/useCardanoStakeEnumeration');
      return (await enumerateCardanoStakeIdentities(network)).map((identity) => identity.stakeAddress).filter(Boolean);
    },
  }));
}

/** Tests only: forget the shared read. */
export function resetConnectorDustReader(): void {
  reader = null;
}
