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
    <template v-else-if="!hasWallets">
      <PendingRequestBanner />
      <NoWalletScreen />
    </template>

    <!-- Wallet selection needed -->
    <template v-else-if="!hasActiveWallet">
      <PendingRequestBanner />
      <WalletSelector
        :loading-wallet-id="loggingInWalletId"
        :error-message="loginError"
        @select="onWalletSelect"
      />
    </template>

    <!-- Wallet locked -->
    <template v-else-if="isLocked">
      <PendingRequestBanner />
      <LockScreen />
    </template>

    <!-- Logged in — show main UI -->
    <template v-else>
      <MiniLayout
        @wallet-switch="showWalletSwitcher = true"
        @settings="openDashboardSettings"
      />
      <AgentDock v-if="isAgentDockVisible" />
    </template>

    <!-- Approval overlay: rendered whenever a signable session exists, above AgentDock -->
    <DAppOverlay v-if="hasActiveWallet && !isLocked" />

    <!-- Wallet switcher bottom sheet (available from header) -->
    <BottomSheet v-model="showWalletSwitcher" :title="t('miniGero.selectWallet')" height="60%">
      <WalletSelector
        compact
        :loading-wallet-id="loggingInWalletId"
        :error-message="loginError"
        @select="onWalletSwitch"
      />
    </BottomSheet>

    <!-- Global, so every hardware-wallet signing path gets the "continue on
         your device" prompt without each sheet re-declaring it. -->
    <HardwareSignPrompt />

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
import PendingRequestBanner from './components/PendingRequestBanner.vue';
import BottomSheet from './components/BottomSheet.vue';
import { initDappRequestHub } from './services/dappRequestHub';
import AgentDock from '@/sidepanel/components/AgentDock.vue';
import HardwareSignPrompt from '@/shared/components/HardwareSignPrompt.vue';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import { Wallet } from '@/models/types';
import { useChainContext } from './composables/useChainContext';

const { t } = useTranslation();

// Initialize chain context — applies CSS variables for the active wallet's theme.
// Other components that call useChainContext() reuse the singleton CSS-variable watcher.
useChainContext();

// Panel-lifetime dApp port: must outlive lock/logout so requests park instead
// of being rejected when the overlay unmounts.
initDappRequestHub();

const showWalletSwitcher = ref(false);
// When set, a full-screen pre-switch unlock overlay is shown for this target MPC
// wallet — we authenticate it (Google + passkey/password) BEFORE switching, so the
// current wallet stays active until the switch actually completes.
const pendingSwitchWallet = ref<Wallet | null>(null);

const hasWallets = computed(() => Object.keys(geroStore.wallets || {}).length > 0);
const hasActiveWallet = computed(() => !!walletStore.loggedWallet);
const isLocked = computed(() => walletStore.isLocked);
// Gero Companion mounts on EITHER flag: isCopilotEnabled alone (legacy
// copilot-only dock) or isLiveChatEnabled alone (support-only dock, Assistant
// tab visible but disabled) — see featureFlagsStore's doc blocks for both.
const isAgentDockVisible = computed(() => featureFlagsStore.isCopilotEnabled() || featureFlagsStore.isLiveChatEnabled());

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

// Login was the single most-repeated moment in the panel with zero feedback
// — tapping a wallet did nothing visible until the whole screen swapped out
// from under the logged-in branch (or never did, on failure, with only a
// console.error). Per-row spinner + a real error message close that gap.
const loggingInWalletId = ref<number | null>(null);
const loginError = ref('');

// Core network login: performs the LOGIN round-trip and surfaces spinner/error
// feedback. Both the direct-select and switcher paths funnel through here.
async function doLogin(wallet: Wallet): Promise<boolean> {
  loggingInWalletId.value = wallet.id;
  loginError.value = '';
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });
    if (!response['data'].success) {
      console.error('Login failed:', response['data'].error);
      loginError.value = t('miniGero.loginFailed');
      return false;
    }
    return true;
  } catch (e) {
    console.error('Login error:', e);
    loginError.value = t('miniGero.loginFailed');
    return false;
  } finally {
    loggingInWalletId.value = null;
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

// From the wallet-switcher sheet. MPC and already-active wallets manage the sheet
// themselves inside onWalletSelect (the MPC path opens the pre-switch overlay). For
// a normal login we must await it and only close the sheet on success — closing it
// synchronously tore down this WalletSelector instance, and with it the spinner/error
// banner, before either could ever be seen from the switcher path.
async function onWalletSwitch(wallet: Wallet) {
  if (
    wallet.encryptionMethod === 'mpc' ||
    (wallet.id === walletStore.loggedWallet?.id && !walletStore.isLocked)
  ) {
    await onWalletSelect(wallet);
    return;
  }
  const success = await doLogin(wallet);
  if (success) showWalletSwitcher.value = false;
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
  background-color: var(--g-overlay) !important;
  border: 1px solid var(--g-hairline-3) !important;
  border-radius: var(--g-r-card) !important;
  box-shadow: var(--g-shadow-menu) !important;
  isolation: isolate !important;
  padding: 12px 16px !important;
  max-width: 300px !important;
}
</style>
