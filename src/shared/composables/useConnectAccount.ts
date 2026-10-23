import { computed, ref, watch } from 'vue';
import WalletStore from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
import type { Wallet } from '@/models/types';
import { accountGroup } from '@/shared/utils/walletAccount';
import { connectApprovalData } from '@/chrome/connectApproval';

/**
 * The accounts a dApp connect prompt offers (#1331): every account of the logged
 * wallet, account #0 first, with the logged one chosen. `approval()` is the
 * prompt's answer for the chosen account; the background switches to it before
 * connecting, so connections stay per account.
 */
export function useConnectAccount() {
  // The record from the wallet list, not loggedWallet, so a rename shows at once.
  const logged = computed<Wallet | null>(() => {
    const wallet = WalletStore.state.loggedWallet as Wallet | null;
    return wallet ? geroStore.wallets[wallet.id] ?? wallet : null;
  });
  const accounts = computed(() => (logged.value ? accountGroup(logged.value, geroStore.wallets) : []));
  const loggedId = computed(() => logged.value?.id);
  const selectedId = ref<number | undefined>(loggedId.value);

  /** Back to the logged account, for the next prompt. */
  function reset() {
    selectedId.value = loggedId.value;
  }
  watch(loggedId, reset);

  const approval = () => connectApprovalData(selectedId.value, accounts.value.length);

  return { accounts, loggedId, selectedId, reset, approval };
}
