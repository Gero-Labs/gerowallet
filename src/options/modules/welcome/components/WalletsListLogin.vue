<template>
  <div class="wallet-login-root">
    <v-card class="transparent-override" flat style="max-width: 600px; margin: auto; box-shadow: unset!important; background: transparent!important;">
      <v-card-title class="justify-center px-6" style="color: white; font-size: 32px;">
        {{ $t('welcome.welcomeMessage') }}
      </v-card-title>
      <v-card-subtitle class="text-center px-6" style="font-size: 20px">
        {{ $t('welcome.chooseAWallet') }}
      </v-card-subtitle>
      <v-card-text class="px-2 pa-0 mt-4" style="max-height: 376px; overflow-y: auto; background: transparent!important;">
        <v-list nav dense class="pa-0 wallet-list" style="min-height: 51px;">
          <v-list-item-group v-model="selectedWalletId" color="primary">
            <v-list-item class="wallet-row" v-for="(item, i) in availableWallets" :key="i" @click="submitLogin(item)">
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
    </v-card>

    <PasswordConfirmModal
      :open="passwordModalOpen"
      :title="passwordModalTitle"
      :subtitle="passwordModalSubtitle"
      :confirm-button-text="passwordModalConfirmText"
      :loading="passwordModalLoading"
      :error-message="passwordModalError"
      @close="handlePasswordModalClose"
      @confirm="handlePasswordModalConfirm"
    />
  </div>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import assets from '@/utils/assets';
import { WalletType } from '@/models/types';
import { computed, ref, toRefs, getCurrentInstance } from 'vue';
import networks from '@/utils/networks';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';
import PasswordConfirmModal from '@/modules/wallet/components/dashboard/PasswordConfirmModal.vue';
import SessionStore from '@/stores/sessionStore';


const { t } = useTranslation();

const selectedWalletId = ref<string | null>(null);
const selectedWallet = ref<Wallet | null>(null);
const { loggedWallet } = toRefs(walletStore);

type WalletTypeValue = typeof WalletType[keyof typeof WalletType];

interface Wallet {
  id: string;
  name: string;
  chain: string;
  network: string;
  icon?: string;
  type?: WalletTypeValue;
}

const { wallets } = toRefs(geroStore);

const availableWallets = computed<Wallet[]>(() => {
  return (Object.values(wallets.value) as Wallet[])
    .filter((wallet: Wallet) => {
      return networks.resolveNetwork(wallet?.chain, wallet?.network) && wallet.type != WalletType.Google;
    });
});

const passwordModalOpen = ref(false);
const passwordModalSubtitle = ref('');
const passwordModalTitle = computed(() => t('wallet.confirmAction'));
const passwordModalConfirmText = computed(() => t('session.unlockButton'));
const passwordModalError = ref('');
const passwordModalLoading = ref(false);

const resolveNetworkIcon = (item: Wallet): string => {
  const network = networks.resolveNetwork(item.chain, item.network);
  if (network) {
    return network.icon;
  }
  return '';
};

const vmProxy = getCurrentInstance()!.proxy as any

const openPasswordModal = (subtitle?: string, error?: string) => {
  passwordModalSubtitle.value = subtitle ?? t('wallet.pleaseEnterPasswordToContinue');
  passwordModalError.value = error ?? '';
  passwordModalLoading.value = false;
  passwordModalOpen.value = true;
};

const handlePasswordModalClose = () => {
  passwordModalOpen.value = false;
  passwordModalLoading.value = false;
  passwordModalError.value = '';
};

const handlePasswordModalConfirm = async ({ password }: { password: string }) => {
  if (!selectedWallet.value) {
    return;
  }
  passwordModalLoading.value = true;
  passwordModalError.value = '';
  const result = await executeLogin(selectedWallet.value, password);
  passwordModalLoading.value = false;

  if (result.success) {
    passwordModalOpen.value = false;
    passwordModalSubtitle.value = '';
    passwordModalError.value = '';
    await handlePostLoginNavigation();
    return;
  }

  if (result.errorCode === 'INVALID_SPENDING_PASSWORD') {
    passwordModalError.value = t('navigation.invalidPassword');
    return;
  }

  if (result.errorCode === 'PASSWORD_REQUIRED_WHEN_LOCKED') {
    passwordModalError.value = '';
    return;
  }

  passwordModalError.value = result.error ?? t('wallet.somethingWentWrong');
};

const handlePostLoginNavigation = async () => {
  // Small delay to ensure store messaging has propagated
  await new Promise(resolve => setTimeout(resolve, 100));

  debugLog('✅ Login complete, wallet logged in:', !!loggedWallet.value);

  const queryParams = vmProxy.$route.query;
  debugLog('🧭 Starting navigation, current route:', vmProxy.$route.path);
  debugLog('🧭 Query params:', queryParams);

  if (queryParams['redirect']) {
    const redirectPath = decodeURIComponent(queryParams['redirect'].toString());
    debugLog('🧭 Navigating to redirect path:', redirectPath);
    await vmProxy.$router.push(redirectPath).catch(err => {
      if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
        console.error('Navigation error:', err);
      }
    });
  } else {
    debugLog('🧭 Navigating to home page: /');
    await vmProxy.$router.push('/').catch(err => {
      if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
        console.error('Navigation error:', err);
      }
    });
  }

  debugLog('🧭 Navigation completed, new route:', vmProxy.$route.path);
};

const executeLogin = async (
  wallet: Wallet,
  password?: string
): Promise<{ success: boolean; errorCode?: string; error?: string }> => {
  try {
    const isSessionLocked = !SessionStore.state.isUnlocked;
    const loggedWalletId = walletStore.loggedWallet?.id;
    const isSameWallet = loggedWalletId === wallet.id;

    if (isSessionLocked && isSameWallet && wallet.type === WalletType.Normal) {
      if (!password) {
        return { success: false, errorCode: 'PASSWORD_REQUIRED_WHEN_LOCKED' };
      }

      const response: any = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.UNLOCK_SESSION,
        data: { password },
      });

      if (response?.data?.success) {
        return { success: true };
      }

      return {
        success: false,
        errorCode: response?.data?.errorCode,
        error: response?.error,
      };
    }

    const requestData: Record<string, unknown> = { wallet };
    if (password) {
      requestData['password'] = password;
    }

    const response: any = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: requestData,
    });

    if (response?.data?.success) {
      return { success: true };
    }

    const errorCode: string | undefined = response?.data?.errorCode;

    if (response?.error) {
      console.warn('Login error:', response.error);
      return { success: false, errorCode, error: response.error };
    }

    if (!errorCode) {
      console.warn('Login failed without explicit error');
    }

    return { success: false, errorCode };
  } catch (error: any) {
    console.error(error);
    return {
      success: false,
      error: error?.message || t('wallet.somethingWentWrong'),
    };
  }
};

const submitLogin = async (wallet: Wallet): Promise<void> => {
  selectedWalletId.value = wallet.id;
  selectedWallet.value = wallet;
  if (wallet.type === WalletType.Normal) {
    openPasswordModal();
    return;
  }

  const result = await executeLogin(wallet);
  if (result.success) {
    await handlePostLoginNavigation();
    return;
  }

  const message =
    result.errorCode === 'INVALID_SPENDING_PASSWORD'
      ? t('navigation.invalidPassword')
      : result.error ?? t('wallet.somethingWentWrong');
  openPasswordModal(undefined, message);
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

/* Fallback for browsers without backdrop-filter support */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .wallet-row {
    background-color: rgba(19, 22, 27, 0.85) !important;
  }

  .wallet-row:hover {
    background-color: rgba(19, 22, 27, 0.95) !important;
  }
}

.wallet-login-root {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  box-sizing: border-box;
}
</style>
