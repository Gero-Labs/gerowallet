import type { MidnightBalances } from '@/chains/midnight/midnightTypes';

const positive = (raw: unknown): boolean => {
  try {
    return BigInt(String(raw ?? '0')) > 0n;
  } catch {
    return false;
  }
};

/**
 * Whether a Midnight wallet holds nothing: no NIGHT (shielded or unshielded), no DUST and
 * no shielded token. Zero balances before the first sync count as empty, as an unsynced
 * Cardano account does. Amounts may arrive as decimal strings after a broadcast.
 */
export function isMidnightWalletEmpty(
  balances: Pick<MidnightBalances, 'nightShielded' | 'nightUnshielded' | 'dust' | 'shieldedTokens'> | null | undefined,
): boolean {
  if (!balances) return true;
  if (positive(balances.nightShielded) || positive(balances.nightUnshielded) || positive(balances.dust)) return false;
  return !Object.values(balances.shieldedTokens ?? {}).some(positive);
}
