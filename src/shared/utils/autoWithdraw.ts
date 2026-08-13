import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
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

  // Conway: the node rejects a rewards withdrawal unless the stake key is
  // DRep-delegated. Mirror useWithdrawal's precondition — silently skip the
  // auto-withdraw rather than attaching a withdrawal that fails every send.
  const isCardano = walletStore.loggedWallet?.chain === Blockchain.CARDANO;
  if (isCardano && !walletStore.account?.drep_id) return undefined;

  try {
    if (BigInt(amount) <= BigInt(0)) return undefined;
  } catch {
    return undefined;
  }

  return [{ stakeAddress: stakeAddr, amount: String(amount) }];
}

/**
 * Optimistically zero the in-memory withdrawable rewards balance right after
 * a transaction carrying a withdrawal was successfully submitted. Nothing
 * else resets it before the next background account sync, so a second send
 * (with auto-withdraw on) or a second withdrawal inside that window would
 * re-attach the already-claimed amount and be rejected by the node
 * (WithdrawalsNotInRewards). The next sync reconciles the true value.
 */
export function clearWithdrawableAmount(): void {
  const account = walletStore.account;
  if (account?.withdrawable_amount && account.withdrawable_amount !== '0') {
    account.withdrawable_amount = '0';
  }
}
