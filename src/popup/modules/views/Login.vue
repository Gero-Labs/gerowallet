<template>
  <v-form ref="form" class="fill-height">
    <v-card outlined class="pa-4 fill-height transparent">
      <div style="width: 100px; margin: auto" class="py-3">
        <img :alt="logoAlt" id="modal-logo-icon" width="100" :src="assets.geroLogo"/>
        <img :alt="logoAlt" id="modal-logo-text" width="100" :src="assets.geroText"/>
      </div>
      <v-card-title class="justify-center" style="font-size: 20px; font-weight: bold; color: white; word-break: break-word">{{ $t('wallet.selectWalletToLogin') }}</v-card-title>
      <v-card-text class="px-2 py-0 fill-height" style="max-width: 400px; margin: auto; height: 100%; max-height: 220px; overflow-y: auto">
        <v-list nav dense class="pa-0" style="background-color: #ffffff0a;" v-if="availableWallets?.length > 0">
          <v-list-item-group v-model="selectedWallet" color="primary">
            <v-list-item v-for="(item, i) in availableWallets" :key="`wallet-${i}`" @click="submitLogin(item)">
              <v-list-item-icon>
                <v-badge
                  overlap
                  avatar
                  bottom
                  bordered
                  offset-y="3"
                >
                  <template v-slot:badge>
                    <v-avatar>
                      <v-img :src="resolveNetworkIcon(item)"></v-img>
                    </v-avatar>
                  </template>
                  <v-avatar size="40">
                    <v-img :src="resolveIcon(item.icon)"></v-img>
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
        <div v-else>
          {{ $t('wallet.noCardanoMainnetWallets') }}
        </div>
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
  </v-form>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, onMounted, toRefs } from 'vue';
import networks from '@/utils/networks';
import { Blockchain, Network, WalletType } from '@/models/types';
import { Messaging } from '@/chrome/messaging';
import assets from '@/utils/assets';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { MessageTypes } from '@/models/MessageTypes';
import PasswordConfirmModal from '@/modules/wallet/components/dashboard/PasswordConfirmModal.vue';
import SessionStore from '@/stores/sessionStore';


const { t } = useTranslation();
const logoAlt = computed(() => String(t('common.geroLogo')));

const { wallets } = toRefs(geroStore);
const { config } = toRefs(walletStore);

const selectedWallet = ref<any | null>(null);
const controller = ref<any>(null);
const tabId = ref<number>();
const passwordModalOpen = ref(false);
const passwordModalSubtitle = ref('');
const passwordModalTitle = computed(() => t('wallet.confirmAction'));
const passwordModalConfirmText = computed(() => t('session.unlockButton'));
const passwordModalError = ref('');
const passwordModalLoading = ref(false);

const useSidePanel = computed(() => {
  return config.value?.useSidePanel || true;
});

const availableWallets = computed(() => {
  return wallets.value.filter(wallet => wallet.chain === Blockchain.CARDANO && wallet.network === Network.MAINNET);
});

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
    await controller.value?.returnData({ data: 'login', error: undefined });
    window.close();
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

const submitLogin = async (wallet: any) => {
  selectedWallet.value = wallet;
  if (wallet.type === WalletType.Normal) {
    openPasswordModal();
    return;
  }

  const result = await executeLogin(wallet);
  if (result.success) {
    await controller.value?.returnData({ data: 'login', error: undefined });
    window.close();
    return;
  }

  const message =
    result.errorCode === 'INVALID_SPENDING_PASSWORD'
      ? t('navigation.invalidPassword')
      : result.error ?? t('wallet.somethingWentWrong');
  openPasswordModal(undefined, message);
};

const executeLogin = async (
  wallet: any,
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

    return { success: false, errorCode };
  } catch (error: any) {
    console.warn('Login exception:', error?.message || error);
    return { success: false, error: error?.message || String(error) };
  }
};

const resolveIcon = (icon: string) => {
  if (icon) {
    return assets.resolveIcon(icon);
  }
  return '';
};

const resolveNetworkIcon = (item: any) => {
  const network = networks.resolveNetwork(item.chain, item.network);
  if (network) {
    return network.icon;
  }
  return '';
};

onMounted(() => {
  if (useSidePanel.value) {
    const params = new URLSearchParams(window.location.href);
    tabId.value = Number(params.get("tabId"));
    controller.value = Messaging.createInternalSidePanelController(tabId.value);
  } else {
    controller.value = Messaging.createInternalController();
  }
});
</script>
<style scoped>

</style>
