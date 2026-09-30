import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { walletStore, type Account } from '@/stores/walletStore';
import { getStakeRegistrationState, StakeAccountError } from '@/shared/utils/stakeRegistration';

export interface StakeWallet {
  id: number;
  stakeAddress?: string;
  network: string;
}

type Translate = (key: string) => string;

/** Check again after building, not just after fetching the account. */
export function assertStakeWalletUnchanged(wallet: StakeWallet, t: Translate): void {
  const current = walletStore.loggedWallet;
  if (!current || current.id !== wallet.id || current.network !== wallet.network ||
      current.stakeAddress !== wallet.stakeAddress) {
    throw new Error(t(StakeAccountError.WalletChanged));
  }
}

/** Never build registration certificates from a cached or balance-only sync record. */
export async function refreshStakeAccount(wallet: StakeWallet | null, t: Translate): Promise<Account> {
  if (!wallet?.stakeAddress) throw new Error(t(StakeAccountError.NoStakeAddress));
  const identity = { walletId: wallet.id, stakeAddress: wallet.stakeAddress, network: wallet.network };
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.REFRESH_STAKE_ACCOUNT,
    data: identity,
  }) as { data?: Account; error?: string } | undefined;
  assertStakeWalletUnchanged({ id: identity.walletId, network: identity.network, stakeAddress: identity.stakeAddress }, t);
  if (response?.error) {
    const key = Object.values(StakeAccountError).some(value => value === response.error)
      ? response.error : StakeAccountError.LookupFailed;
    throw new Error(t(key));
  }
  if (!response?.data || getStakeRegistrationState(response.data) === undefined) {
    throw new Error(t(StakeAccountError.RegistrationUnavailable));
  }
  return response.data;
}
