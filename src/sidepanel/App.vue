<template>
  <v-app dark>
    <notifications></notifications>

    <!-- No wallet exists -->
    <NoWalletScreen v-if="!hasWallets" />

    <!-- Wallet selection needed -->
    <WalletSelector
      v-else-if="!hasActiveWallet"
      @select="onWalletSelect"
    />

    <!-- Wallet locked -->
    <LockScreen v-else-if="isLocked" />

    <!-- Logged in — show main UI -->
    <template v-else>
      <MiniLayout
        @wallet-switch="showWalletSwitcher = true"
        @settings="openDashboardSettings"
      />
      <DAppOverlay />
    </template>

    <!-- Wallet switcher bottom sheet (available from header) -->
    <BottomSheet v-model="showWalletSwitcher" :title="t('miniGero.selectWallet')" height="60%">
      <WalletSelector compact @select="onWalletSwitch" />
    </BottomSheet>

  </v-app>
</template>
<script setup lang="ts">
import { ref, computed, watch, getCurrentInstance } from 'vue';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import MiniLayout from './layouts/MiniLayout.vue';
import NoWalletScreen from './components/NoWalletScreen.vue';
import WalletSelector from './components/WalletSelector.vue';
import LockScreen from './components/LockScreen.vue';
import DAppOverlay from './components/DAppOverlay.vue';
import BottomSheet from './components/BottomSheet.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { Wallet } from '@/models/types';

const { t } = useTranslation();
const showWalletSwitcher = ref(false);

const hasWallets = computed(() => Object.keys(geroStore.wallets || {}).length > 0);
const hasActiveWallet = computed(() => !!walletStore.loggedWallet);
const isLocked = computed(() => walletStore.isLocked);

// Watch locale changes from geroStore
const vmProxy = getCurrentInstance()!.proxy;
watch(() => geroStore.config?.locale, async (newLocale, oldLocale) => {
  if (!newLocale || !vmProxy.$i18n) return;
  if (vmProxy.$i18n.locale === newLocale) return;
  if (!oldLocale && newLocale === 'us' && vmProxy.$i18n.locale !== 'us') return;

  const { loadLanguage } = await import('@/plugins/i18n');
  try {
    await loadLanguage(newLocale);
    vmProxy.$i18n.locale = newLocale;
  } catch (error) {
    console.error(`Failed to load language ${newLocale}:`, error);
  }
}, { immediate: true, deep: true });

async function onWalletSelect(wallet: Wallet) {
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });
    if (!response['data'].success) {
      console.error('Login failed:', response['data'].error);
    }
  } catch (e: any) {
    console.error('Login error:', e);
  }
}

function onWalletSwitch(wallet: Wallet) {
  showWalletSwitcher.value = false;
  onWalletSelect(wallet);
}

function openDashboardSettings() {
  chrome.storage.local.set({ openSettingsOnLoad: true });
  const dashboardUrl = chrome.runtime.getURL('index.html');
  try {
    chrome.tabs.query({ url: `${dashboardUrl}*` }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id !== undefined) {
        chrome.tabs.update(tabs[0].id, { active: true });
        if (tabs[0].windowId !== undefined) {
          chrome.windows.update(tabs[0].windowId, { focused: true });
        }
      } else {
        chrome.tabs.create({ url: dashboardUrl });
      }
    });
  } catch (e) {
    console.warn('Failed to query dashboard tabs, opening new tab:', e);
    chrome.tabs.create({ url: dashboardUrl });
  }
}

</script>
<style>
.custom-tooltip {
  background-color: rgba(0, 0, 0, 0.4) !important;
  backdrop-filter: blur(20px) saturate(1.8) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.8) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  isolation: isolate !important;
  padding: 12px 16px !important;
  max-width: 300px !important;
}
</style>
