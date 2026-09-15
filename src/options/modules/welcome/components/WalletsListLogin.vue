<template>
  <v-card class="transparent-override" flat style="max-width: 600px; width: 100%; box-shadow: unset!important; background: transparent!important; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;">
    <template v-if="!hideHeader">
      <v-card-title class="justify-center px-6" style="color: var(--g-text-1); font-size: 32px;">
        {{ $t('welcome.welcomeMessage') }}
      </v-card-title>
      <v-card-subtitle class="text-center px-0" style="font-size: 20px">
        {{ $t('welcome.chooseAWallet') }}
      </v-card-subtitle>
    </template>
    <WalletLibrary :available-wallets="availableWallets" :locked-wallet-id="isLocked ? loggedWallet?.id : null"
      @select="submitLogin" @focus-wallet="onWalletHover" />

    <!-- Unlock Wallet Dialog -->
    <UnlockWalletDialog
      v-model="showUnlockDialog"
      :pre-login-wallet-id="preLoginWalletId"
      :pre-login-wallet-name="preLoginWalletName"
      :pre-login-wallet-icon="preLoginWalletIcon"
      @unlocked="handleWalletUnlocked"
      @logged-out="handleLoggedOut"
    />
  </v-card>
</template>
<script setup lang="ts">
import WalletLibrary from '@/shared/components/WalletLibrary/WalletLibrary.vue';
import { Wallet } from '@/models/types';
import { ref, toRefs, getCurrentInstance, watch, onMounted } from 'vue';
import networks, { NetworkInfo } from '@/utils/networks';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';
import UnlockWalletDialog from '@/modules/dashboard/dialogs/UnlockWalletDialog.vue';
import { useAvailableWallets } from '@/shared/composables/useAvailableWallets';

const selectedWallet = ref<string | null>(null);
const showUnlockDialog = ref<boolean>(false);
const pendingNavigation = ref<string | null>(null);
const pendingLoginWalletId = ref<number | null>(null);

// Pre-login unlock props
const preLoginWalletId = ref<number | null>(null);
const preLoginWalletName = ref<string | null>(null);
const preLoginWalletIcon = ref<string | null>(null);

const { loggedWallet, isLocked } = toRefs(walletStore);

const { wallets } = toRefs(geroStore);

// Shared eligibility rule (see useAvailableWallets for the Google/MPC nuance):
// login for MPC Google wallets still goes through the pre-login unlock gate.
const { availableWallets } = useAvailableWallets();

defineProps<{ hideHeader?: boolean }>();
const emit = defineEmits<{ (e: 'network-change', n: NetworkInfo): void }>();

// Drive the welcome background from the wallet the user is focused on, instead
// of leaving it frozen on the default chain during login.
const onWalletHover = (item: Wallet): void => {
  const network = networks.resolveNetwork(item.chain, item.network);
  if (network) emit('network-change', network);
};

onMounted(() => {
  const first = availableWallets.value[0];
  if (first) onWalletHover(first);
});

const vmProxy = getCurrentInstance()!.proxy

const submitLogin = async (walletId: number): Promise<void> => {
  // Check if wallet is locked
  if (isLocked.value) {
    // If clicking on a different wallet while current wallet is locked, logout and login to new wallet
    if (loggedWallet.value?.id !== walletId) {
      debugLog('🔄 Switching from locked wallet to different wallet - logging out first');
      try {
        // Logout from current wallet
        await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.LOGOUT,
          data: {}
        });

        // Wait for logout to complete using watcher (event-driven, not polling)
        const logoutSuccess = await new Promise<boolean>((resolve) => {
          // Check immediately first
          if (loggedWallet.value === null) {
            debugLog('✅ Logout already confirmed - loggedWallet is null');
            resolve(true);
            return;
          }

          // Set up watcher for state change
          const unwatch = watch(
            () => loggedWallet.value,
            (newValue) => {
              if (newValue === null) {
                debugLog('✅ Logout confirmed - loggedWallet is null');
                unwatch();
                resolve(true);
              }
            }
          );

          // Safety timeout (2 seconds)
          setTimeout(() => {
            unwatch();
            console.warn('⚠️ Timeout waiting for logout to complete');
            resolve(false);
          }, 2000);
        });

        if (!logoutSuccess) {
          console.error('❌ Logout did not complete in time');
          return;
        }

        debugLog('🔄 Logout completed, proceeding with login to new wallet');
        // Now proceed with login to the new wallet (fall through to login logic below)
      } catch (error) {
        console.error('❌ Logout failed during wallet switch:', error);
        return;
      }
    } else {
      // Clicking on the same locked wallet - show unlock dialog
      debugLog('🔒 Wallet is locked, showing unlock dialog');
      showUnlockDialog.value = true;
      return;
    }
  }

  console.log('submitLogin')
  try {
    const wallet = (Object.values(wallets.value) as Wallet[]).filter((wallet: Wallet) => networks.resolveNetwork(wallet?.chain, wallet?.network)).find((wal: Wallet) => wal.id === walletId);

    // **PRE-LOGIN UNLOCK CHECK** - If logged out, check if wallet has unlock method
    if (!loggedWallet.value && wallet) {
      debugLog('🔍 Checking for unlock method before login');
      const { getDb } = await import('@/db/wallet-db');
      const db = await getDb(wallet.id);
      const configTable = db.table('config');
      const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();

      // MPC wallets have no `unlockMethod` config row (reconstruct-at-unlock
      // always needs Google + spending password) — gate on encryptionMethod too.
      if (unlockMethodConfig?.value || wallet.encryptionMethod === 'mpc') {
        debugLog('🔐 Wallet has unlock method configured - showing pre-login unlock dialog');
        // Store wallet info for pre-login unlock
        preLoginWalletId.value = wallet.id;
        preLoginWalletName.value = wallet.name || 'Wallet';
        preLoginWalletIcon.value = wallet.icon || 'mdi-wallet';
        pendingLoginWalletId.value = walletId;

        // Show unlock dialog
        showUnlockDialog.value = true;
        return; // Don't proceed with login yet
      }
    }

    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });

    // Trust the background response
    if (!response || response['error']) {
      console.error('❌ Login failed:', (response as { error?: unknown })?.error || 'Unknown error');
      return;
    }

    // Wait for login state to propagate AND sync to complete (event-driven, not polling)
    const loginSuccess = await new Promise<boolean>((resolve) => {
      const checkReady = () => {
        // Don't navigate while wallet is restoring/syncing
        if (walletStore.isSyncing) return false;
        return loggedWallet.value?.id === walletId;
      };

      // Check immediately first
      if (checkReady()) {
        debugLog('✅ Login already confirmed - loggedWallet.id matches target wallet');
        resolve(true);
        return;
      }

      // Set up watchers for both loggedWallet and restoring state
      const unwatchWallet = watch(
        () => [loggedWallet.value?.id, walletStore.isSyncing],
        () => {
          if (checkReady()) {
            debugLog('✅ Login confirmed and restore complete');
            unwatchWallet();
            resolve(true);
          }
        }
      );

      // Safety timeout (5 minutes — full restore can take time)
      setTimeout(() => {
        unwatchWallet();
        if (loggedWallet.value?.id === walletId) {
          resolve(true); // wallet is set, just navigate
        } else {
          console.warn('⚠️ Timeout waiting for login state to propagate');
          resolve(false);
        }
      }, 300000);
    });

    if (!loginSuccess) {
      console.error('❌ Login state did not propagate in time');
      return;
    }

    debugLog('✅ Login state confirmed, proceeding with navigation');

    // Store the intended navigation path
    const queryParams = vmProxy.$route.query;
    if (queryParams['redirect']) {
      pendingNavigation.value = decodeURIComponent(queryParams['redirect'].toString());
    } else {
      pendingNavigation.value = '/';
    }

    // Proceed with navigation
    await navigateAfterLogin();
  } catch (error) {
    console.error(error);

  }
};

const navigateAfterLogin = async (): Promise<void> => {
  const queryParams = vmProxy.$route.query;
  debugLog('🧭 Starting navigation, current route:', vmProxy.$route.path);
  debugLog('🧭 Query params:', queryParams);

  const targetPath = pendingNavigation.value || (queryParams['redirect'] ? decodeURIComponent(queryParams['redirect'].toString()) : '/');

  debugLog('🧭 Navigating to:', targetPath);
  await vmProxy.$router.push(targetPath).catch(err => {
    if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
      console.error('Navigation error:', err);
    }
  });

  debugLog('🧭 Navigation completed, new route:', vmProxy.$route.path);

  // Clear pending navigation
  pendingNavigation.value = null;
};

const handleWalletUnlocked = async (): Promise<void> => {
  debugLog('🔓 Wallet unlocked successfully');
  showUnlockDialog.value = false;

  // If this was a pre-login unlock, proceed with login
  if (pendingLoginWalletId.value) {
    debugLog('✅ Pre-login unlock successful - proceeding with login');
    const walletId = pendingLoginWalletId.value;

    // Clear pre-login state first
    pendingLoginWalletId.value = null;
    preLoginWalletId.value = null;
    preLoginWalletName.value = null;
    preLoginWalletIcon.value = null;

    // Proceed with login directly (don't call submitLogin to avoid re-checking unlock method)
    try {
      const wallet = (Object.values(wallets.value) as Wallet[])
        .filter((wallet: Wallet) => networks.resolveNetwork(wallet?.chain, wallet?.network))
        .find((wal: Wallet) => wal.id === walletId);

      if (!wallet) {
        console.error('❌ Wallet not found:', walletId);
    
        return;
      }

      debugLog('🔑 Sending LOGIN message after pre-login unlock');
      const response = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.LOGIN,
        data: { wallet },
      });

      if (!response || response['error']) {
        console.error('❌ Login failed:', (response as { error?: unknown })?.error || 'Unknown error');
    
        return;
      }

      // Wait for login state to propagate
      const loginSuccess = await new Promise<boolean>((resolve) => {
        if (loggedWallet.value?.id === walletId) {
          debugLog('✅ Login already confirmed');
          resolve(true);
          return;
        }

        const unwatch = watch(
          () => loggedWallet.value?.id,
          (newId) => {
            if (newId === walletId) {
              debugLog('✅ Login confirmed');
              unwatch();
              resolve(true);
            }
          }
        );

        setTimeout(() => {
          unwatch();
          console.warn('⚠️ Timeout waiting for login state');
          resolve(false);
        }, 2000);
      });

      if (!loginSuccess) {
        console.error('❌ Login state did not propagate in time');
    
        return;
      }

      debugLog('✅ Login complete, proceeding with navigation');

      // Store navigation path
      const queryParams = vmProxy.$route.query;
      if (queryParams['redirect']) {
        pendingNavigation.value = decodeURIComponent(queryParams['redirect'].toString());
      } else {
        pendingNavigation.value = '/';
      }

      await navigateAfterLogin();
    } catch (error) {
      console.error('❌ Login error after pre-login unlock:', error);

    }
    return;
  }

  // Post-login unlock scenario - wallet is already logged in, just locked
  // Just navigate to the wallet
  debugLog('✅ Post-login unlock - navigating to wallet');
  await navigateAfterLogin();
};

const handleLoggedOut = async (): Promise<void> => {
  debugLog('👋 User logged out from unlock dialog');
  showUnlockDialog.value = false;
  pendingNavigation.value = null;

  // Clear pre-login state if it was a pre-login unlock
  pendingLoginWalletId.value = null;
  preLoginWalletId.value = null;
  preLoginWalletName.value = null;
  preLoginWalletIcon.value = null;

  // Clear selected wallet to remove highlight
  selectedWallet.value = null;

  // Stay on the welcome screen
};
</script>
