import type { SolanaWalletState } from '@/stores/walletStore';

const positive = (raw: unknown): boolean => {
  try {
    return BigInt(String(raw ?? '0')) > 0n;
  } catch {
    return false;
  }
};

/**
 * Whether a Solana wallet holds nothing: no lamports and no SPL token with a balance.
 * Not yet synced (lamports null) counts as empty, as an unsynced Cardano account does.
 */
export function isSolanaWalletEmpty(state: Pick<SolanaWalletState, 'lamports' | 'tokens'> | null | undefined): boolean {
  if (!state) return true;
  if (positive(state.lamports)) return false;
  return !(state.tokens ?? []).some((token) => positive(token.amount));
}
