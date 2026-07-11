<template>
  <v-app dark>
    <notifications></notifications>

    <!-- Pre-switch unlock: authenticate the target MPC wallet before switching to
         it, without logging out the current wallet. -->
    <LockScreen
      v-if="pendingSwitchWallet"
      :key="'preswitch-' + pendingSwitchWallet.id"
      :target-wallet="pendingSwitchWallet"
      @switch-unlocked="onSwitchUnlocked"
      @cancel="pendingSwitchWallet = null"
    />

    <!-- No wallet exists -->
    <NoWalletScreen v-else-if="!hasWallets" />

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
      <AgentDock v-if="isCopilotEnabled" />
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
import AgentDock from '@/sidepanel/components/AgentDock.vue';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import { Wallet } from '@/models/types';
import { useChainContext } from './composables/useChainContext';

const { t } = useTranslation();

// Initialize chain context — applies CSS variables for the active wallet's theme.
// Other components that call useChainContext() reuse the singleton CSS-variable watcher.
useChainContext();

const showWalletSwitcher = ref(false);
// When set, a full-screen pre-switch unlock overlay is shown for this target MPC
// wallet — we authenticate it (Google + passkey/password) BEFORE switching, so the
// current wallet stays active until the switch actually completes.
const pendingSwitchWallet = ref<Wallet | null>(null);

const hasWallets = computed(() => Object.keys(geroStore.wallets || {}).length > 0);
const hasActiveWallet = computed(() => !!walletStore.loggedWallet);
const isLocked = computed(() => walletStore.isLocked);
const isCopilotEnabled = computed(() => featureFlagsStore.isCopilotEnabled());

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

async function doLogin(wallet: Wallet) {
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });
    if (!response['data'].success) {
      console.error('Login failed:', response['data'].error);
    }
  } catch (e) {
    console.error('Login error:', e);
  }
}

async function onWalletSelect(wallet: Wallet) {
  // Already the active, unlocked wallet → nothing to do.
  if (wallet.id === walletStore.loggedWallet?.id && !walletStore.isLocked) {
    showWalletSwitcher.value = false;
    return;
  }
  // MPC "Sign in with Google" wallets are authenticated BEFORE the switch: show the
  // pre-switch unlock overlay (Google + passkey/password) which reconstructs the
  // target's key WITHOUT logging out the current wallet. onSwitchUnlocked then does
  // the real LOGIN; cancel keeps the current wallet. Non-MPC wallets log in directly.
  if (wallet.encryptionMethod === 'mpc') {
    showWalletSwitcher.value = false;
    pendingSwitchWallet.value = wallet;
    return;
  }
  await doLogin(wallet);
}

function onWalletSwitch(wallet: Wallet) {
  showWalletSwitcher.value = false;
  onWalletSelect(wallet);
}

async function onSwitchUnlocked(wallet: Wallet) {
  pendingSwitchWallet.value = null;
  await doLogin(wallet);
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
