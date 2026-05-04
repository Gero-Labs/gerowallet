import { walletStore } from '@/stores/walletStore';
import type { NexusTxWithdrawal } from '@/api/nexus-tx-api';

/**
 * Build the `withdrawals` entry for a Nexus BuildTxRequest / MaxAdaRequest
 * when the current wallet has the "Auto-withdraw staking rewards" setting on
 * and there's a positive withdrawable rewards balance. Returns undefined in
 * every other case so the caller can spread it conditionally.
 *
 * Shared by every send-path that hits Nexus (SendDialog, CollateralTab, etc.)
 * so the toggle applies uniformly — anything that pulls from the wallet also
 * sweeps outstanding rewards into the same tx.
 */
export function currentRewardWithdrawals(): NexusTxWithdrawal[] | undefined {
  const cfg = walletStore.config as { autoWithdrawRewards?: boolean } | undefined;
  if (!cfg?.autoWithdrawRewards) return undefined;

  const stakeAddr = walletStore.loggedWallet?.stakeAddress;
  const amount = walletStore.account?.withdrawable_amount;
  if (!stakeAddr || !amount) return undefined;

  try {
    if (BigInt(amount) <= BigInt(0)) return undefined;
  } catch {
    return undefined;
  }

  return [{ stakeAddress: stakeAddr, amount: String(amount) }];
}
