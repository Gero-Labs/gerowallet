import { computed, ComputedRef, toRefs } from 'vue';
import { geroStore } from '@/stores/geroStore';
import networks from '@/utils/networks';
import { Wallet, WalletType } from '@/models/types';

/**
 * The single wallet-eligibility rule for the welcome/sign-in surfaces.
 *
 * A wallet is "available" when its chain/network resolves to a known network
 * AND it is not a legacy (non-MPC) Google wallet — those are handled by a
 * separate flow. MPC "Sign in with Google" wallets (encryptionMethod 'mpc')
 * behave like any other wallet here.
 *
 * Consumers: WalletsListLogin (renders the list), WalletCreation (heading),
 * Welcome (layout: split sign-in vs full-width onboarding hero). Keeping the
 * rule here means those three can never disagree about what counts.
 */
export function useAvailableWallets(): {
  availableWallets: ComputedRef<Wallet[]>;
  hasWallets: ComputedRef<boolean>;
} {
  const { wallets } = toRefs(geroStore);

  const availableWallets = computed<Wallet[]>(() =>
    (Object.values(wallets.value) as Wallet[]).filter(
      (wallet: Wallet) =>
        !!networks.resolveNetwork(wallet?.chain, wallet?.network)
        && (wallet.type !== WalletType.Google || wallet.encryptionMethod === 'mpc'),
    ));

  const hasWallets = computed<boolean>(() => availableWallets.value.length > 0);

  return { availableWallets, hasWallets };
}
