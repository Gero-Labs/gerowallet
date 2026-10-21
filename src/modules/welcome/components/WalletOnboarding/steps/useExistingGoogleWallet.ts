import { ref, watch, getCurrentInstance } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { findMpcGoogleWallet } from '@/db/gero-db';
import { walletStore } from '@/stores/walletStore';
import type { Wallet } from '@/models/types';
import type { NetworkInfo } from '@/utils/networks';

/** Decode the JWT payload's `sub` (does NOT verify — used only to match a local wallet). */
function subFromToken(token: string): string {
  try {
    const seg = token.split('.')[1];
    if (!seg) return '';
    const json = atob(seg.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { sub?: string }).sub || '';
  } catch {
    return '';
  }
}

/**
 * The MPC Google wallet already on this device for a signed-in Google account, and
 * the way to log in to it. Sign-in and restore both use it: a wallet that is already
 * here is logged in to, never created or restored a second time (issue 1343).
 *
 * Call during a step's setup. Bind `showUnlockDialog`, `preLoginWallet*` and
 * `onUnlocked` to an UnlockWalletDialog.
 */
export function useExistingGoogleWallet(network: () => NetworkInfo | undefined) {
  const vmProxy = getCurrentInstance()!.proxy;

  /** An MPC wallet already on THIS device for the signed-in Google account ON THIS
   *  NETWORK (matched by JWT `sub` === wallet.userId AND chain+network). If present,
   *  the user should log in rather than create a duplicate (the backend would reject
   *  a same-network enroll with a 409 anyway). The match is network-scoped because the
   *  backend enrolls per `(sub, chain, network)`, so the SAME account can hold a
   *  separate wallet on each network (e.g. Cardano mainnet AND preprod).
   *  DB-backed (queried on sign-in) so it doesn't depend on the store being hydrated. */
  const existingWallet = ref<Wallet | null>(null);

  async function findExistingWallet(token: string): Promise<void> {
    existingWallet.value = null;
    const sub = subFromToken(token);
    if (!sub) return;
    const chain = network()?.blockchain;
    const net = network()?.network;
    if (!chain || !net) return;
    try {
      existingWallet.value = await findMpcGoogleWallet(sub, chain, net);
    } catch {
      existingWallet.value = null;
    }
  }

  // Pre-login unlock dialog — logs into the already-enrolled wallet on this device.
  const showUnlockDialog = ref(false);
  const preLoginWalletId = ref<number | null>(null);
  const preLoginWalletName = ref<string | null>(null);
  const preLoginWalletIcon = ref<string | null>(null);

  const openUnlockExisting = (): void => {
    const w = existingWallet.value;
    if (!w) return;
    preLoginWalletId.value = w.id ?? null;
    preLoginWalletName.value = w.name || 'Wallet';
    preLoginWalletIcon.value = w.icon || 'mdi-wallet';
    showUnlockDialog.value = true;
  };

  // Unlock only reconstructs + caches the root key; we still have to LOG IN the wallet
  // (set loggedWallet) before navigating, or the dashboard bounces back.
  async function loginAndNavigate(wallet: Wallet): Promise<void> {
    const resp = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.LOGIN, data: { wallet } });
    if (!resp || (resp as { error?: unknown }).error) {
      console.error('Login after unlock failed');
      return;
    }
    await new Promise<void>((resolve) => {
      if (walletStore.loggedWallet?.id === wallet.id) return resolve();
      const unwatch = watch(() => walletStore.loggedWallet?.id, (id) => {
        if (id === wallet.id) { unwatch(); resolve(); }
      });
      setTimeout(() => { unwatch(); resolve(); }, 6000);
    });
    await vmProxy.$router.push('/').catch(() => { /* NavigationDuplicated is fine */ });
  }

  const onUnlocked = async (): Promise<void> => {
    showUnlockDialog.value = false;
    const wallet = existingWallet.value;
    if (!wallet) {
      await vmProxy.$router.push('/').catch(() => { /* NavigationDuplicated is fine */ });
      return;
    }
    try {
      await loginAndNavigate(wallet);
    } catch (error) {
      console.error('Login after unlock error:', error instanceof Error ? error.message : 'unknown error');
    }
  };

  return {
    existingWallet,
    findExistingWallet,
    showUnlockDialog,
    preLoginWalletId,
    preLoginWalletName,
    preLoginWalletIcon,
    openUnlockExisting,
    onUnlocked,
  };
}
