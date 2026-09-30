import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { walletStore, type Account } from '@/stores/walletStore';
import { getStakeRegistrationState } from '@/shared/utils/stakeRegistration';

interface StakeWallet {
  id: number;
  stakeAddress?: string;
  network: string;
}

/** Never build registration certificates from a cached or balance-only sync record. */
export async function refreshStakeAccount(wallet: StakeWallet): Promise<Account> {
  const identity = { walletId: wallet.id, stakeAddress: wallet.stakeAddress, network: wallet.network };
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.REFRESH_STAKE_ACCOUNT,
    data: identity,
  }) as { data?: Account; error?: string } | undefined;
  const current = walletStore.loggedWallet;
  if (!current || current.id !== identity.walletId || current.network !== identity.network ||
      current.stakeAddress !== identity.stakeAddress) {
    throw new Error('The active wallet changed. Please try again.');
  }
  if (response?.error) throw new Error(response.error);
  if (!response?.data || getStakeRegistrationState(response.data) === undefined) {
    throw new Error('Could not verify stake registration. Refresh the wallet and try again.');
  }
  return response.data;
}
