<template>
  <v-card class="transparent-override" flat style="max-width: 600px; margin: auto; box-shadow: unset!important; background: transparent!important;">
    <v-card-title class="justify-center px-6" style="color: white; font-size: 32px;">
      {{ $t('welcome.welcomeMessage') }}
    </v-card-title>
    <v-card-subtitle class="text-center px-6" style="font-size: 20px">
      {{ $t('welcome.chooseAWallet') }}
    </v-card-subtitle>
    <v-card-text class="px-2 pa-0 mt-4" style="max-height: 376px; overflow-y: auto; background: transparent!important;">
      <v-list nav dense class="pa-0 wallet-list" style="min-height: 51px;">
        <v-list-item-group v-model="selectedWallet" color="primary">
          <v-list-item
            class="wallet-row"
            :class="{ 'wallet-locked': isWalletLocked(item) }"
            v-for="(item, i) in availableWallets"
            :key="i"
            @click="submitLogin(item.id)"
          >
            <v-list-item-icon style="height: 40px" class="mr-4">
              <v-badge
                overlap
                avatar
                bottom
                bordered
                offset-y="20"
              >
                <template v-slot:badge>
                  <v-avatar>
                    <v-img :src="resolveNetworkIcon(item)"></v-img>
                  </v-avatar>
                </template>
                <v-avatar size="40">
                  <v-img :src="assets.resolveIcon(item.icon)"></v-img>
                </v-avatar>
              </v-badge>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>
                {{ item.name }}
                <v-chip
                  v-if="isWalletLocked(item)"
                  x-small
                  color="transparent"
                  text-color="primary"
                  class="mb-1 ml-1"
                >
                  <v-icon x-small left>mdi-lock</v-icon>
                  {{ $t('wallet.loggedIn') }}
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ item.chain }} - {{item.network}}
              </v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-avatar tile size="20" v-if="item.type === WalletType.Ledger">
              <v-img :src="assets.ledgerSvg" contain width="18"></v-img>
            </v-list-item-avatar>
            <v-list-item-avatar tile size="20" v-if="item.type === WalletType.Keystone">
              <v-img :src="assets.keystoneSvg" contain width="18"></v-img>
            </v-list-item-avatar>
          </v-list-item>
        </v-list-item-group>
      </v-list>
    </v-card-text>

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
import assets from '@/utils/assets';
import { Wallet, WalletType } from '@/models/types';
import { computed, ref, toRefs, getCurrentInstance, watch } from 'vue';
import networks from '@/utils/networks';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';
import UnlockWalletDialog from '@/modules/dashboard/dialogs/UnlockWalletDialog.vue';

const selectedWallet = ref<string | null>(null);
const showUnlockDialog = ref<boolean>(false);
const pendingNavigation = ref<string | null>(null);
const pendingLoginWalletId = ref<string | null>(null);

// Pre-login unlock props
const preLoginWalletId = ref<number | null>(null);
const preLoginWalletName = ref<string | null>(null);
const preLoginWalletIcon = ref<string | null>(null);

const { loggedWallet, isLocked } = toRefs(walletStore);

const { wallets } = toRefs(geroStore);

const availableWallets = computed<Wallet[]>(() => {
  return (Object.values(wallets.value) as Wallet[])
    .filter((wallet: Wallet) => {
      return networks.resolveNetwork(wallet?.chain, wallet?.network) && wallet.type != WalletType.Google;
    });
});

const resolveNetworkIcon = (item: Wallet): string => {
  const network = networks.resolveNetwork(item.chain, item.network);
  if (network) {
    return network.icon;
  }
  return '';
};

const isWalletLocked = (wallet: Wallet): boolean => {
  return loggedWallet.value?.id === wallet.id && isLocked.value;
};

const vmProxy = getCurrentInstance()!.proxy as any

const submitLogin = async (walletId: string): Promise<void> => {
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

      if (unlockMethodConfig?.value) {
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
    if (!response || (response as any).error) {
      console.error('❌ Login failed:', (response as any)?.error || 'Unknown error');
      return;
    }

    // Wait for login state to propagate using watcher (event-driven, not polling)
    const loginSuccess = await new Promise<boolean>((resolve) => {
      // Check immediately first
      if (loggedWallet.value?.id === walletId) {
        debugLog('✅ Login already confirmed - loggedWallet.id matches target wallet');
        resolve(true);
        return;
      }

      // Set up watcher for state change
      const unwatch = watch(
        () => loggedWallet.value?.id,
        (newId) => {
          if (newId === walletId) {
            debugLog('✅ Login confirmed - loggedWallet.id matches target wallet');
            unwatch();
            resolve(true);
          }
        }
      );

      // Safety timeout (2 seconds)
      setTimeout(() => {
        unwatch();
        console.warn('⚠️ Timeout waiting for login state to propagate');
        resolve(false);
      }, 2000);
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

      if (!response || (response as any).error) {
        console.error('❌ Login failed:', (response as any)?.error || 'Unknown error');
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
<style scoped>
/* Ensure all parent elements are transparent for backdrop-filter to work */
.transparent-override,
.transparent-override .v-card__title,
.transparent-override .v-card__subtitle,
.transparent-override .v-card__text {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

.wallet-list,
.wallet-list .v-list-item-group {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

.wallet-row {
  background:
    linear-gradient(135deg, rgba(19, 22, 27, 0.6) 0%, rgba(19, 22, 27, 0.4) 100%),
    radial-gradient(circle at 20% 50%, rgba(45, 240, 247, 0.03) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.02) 0%, transparent 50%) !important;
  backdrop-filter: blur(12px) saturate(1.3) !important;
  -webkit-backdrop-filter: blur(12px) saturate(1.3) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 8px !important;
  margin: 4px 0 !important;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
  transition: all 0.2s ease !important;
  position: relative !important;
  overflow: hidden !important;
}

.wallet-row:hover {
  background:
    linear-gradient(135deg, rgba(19, 22, 27, 0.7) 0%, rgba(19, 22, 27, 0.5) 100%),
    radial-gradient(circle at 20% 50%, rgba(45, 240, 247, 0.05) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.03) 0%, transparent 50%) !important;
  backdrop-filter: blur(16px) saturate(1.5) !important;
  -webkit-backdrop-filter: blur(16px) saturate(1.5) !important;
  border-color: rgba(45, 240, 247, 0.2) !important;
  box-shadow:
    0 6px 20px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
  transform: translateY(-1px) !important;
}

.wallet-row::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  z-index: 1;
}

/* Logged in wallet styling (teal/cyan) */
.wallet-locked {
  border-color: rgba(0, 199, 243, 0.5) !important;
  background:
    linear-gradient(135deg, rgba(0, 199, 243, 0.12) 0%, rgba(19, 22, 27, 0.4) 100%),
    radial-gradient(circle at 20% 50%, rgba(0, 199, 243, 0.08) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(0, 255, 209, 0.03) 0%, transparent 50%) !important;
}

.wallet-locked:hover {
  border-color: rgba(0, 199, 243, 0.7) !important;
  background:
    linear-gradient(135deg, rgba(0, 199, 243, 0.18) 0%, rgba(19, 22, 27, 0.5) 100%),
    radial-gradient(circle at 20% 50%, rgba(0, 199, 243, 0.12) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(0, 255, 209, 0.05) 0%, transparent 50%) !important;
}

/* Fallback for browsers without backdrop-filter support */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .wallet-row {
    background-color: rgba(19, 22, 27, 0.85) !important;
  }

  .wallet-row:hover {
    background-color: rgba(19, 22, 27, 0.95) !important;
  }

  .wallet-locked {
    background-color: rgba(255, 152, 0, 0.15) !important;
  }

  .wallet-locked:hover {
    background-color: rgba(255, 152, 0, 0.25) !important;
  }
}
</style>
