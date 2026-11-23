import type { MidnightBalances, MidnightUnshieldedUtxo } from '@/chains/midnight/midnightTypes';
import { isNativeNight } from '@/chains/midnight/midnightTokenBalances';

const positive = (raw: unknown): boolean => {
  try {
    return BigInt(String(raw ?? '0')) > 0n;
  } catch {
    return false;
  }
};

/**
 * Whether a Midnight wallet holds nothing: no NIGHT (shielded or unshielded), no DUST, no
 * shielded token and no unshielded token (USDM and the like). Unshielded tokens have no
 * balance field: they are read from the UTxO set, as the holdings table does. Zero balances
 * before the first sync count as empty, as an unsynced Cardano account does. Amounts may
 * arrive as decimal strings after a broadcast.
 */
export function isMidnightWalletEmpty(
  balances: Pick<MidnightBalances, 'nightShielded' | 'nightUnshielded' | 'dust' | 'shieldedTokens'> | null | undefined,
  utxos?: ReadonlyArray<Pick<MidnightUnshieldedUtxo, 'tokenType' | 'value'>> | null,
): boolean {
  if ((utxos ?? []).some((u) => !isNativeNight(u.tokenType) && positive(u.value))) return false;
  if (!balances) return true;
  if (positive(balances.nightShielded) || positive(balances.nightUnshielded) || positive(balances.dust)) return false;
  return !Object.values(balances.shieldedTokens ?? {}).some(positive);
}
