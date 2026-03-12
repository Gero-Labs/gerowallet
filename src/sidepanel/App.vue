<template>
  <v-app dark>
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
        @settings="showSettings = true"
      />
      <DAppOverlay />
    </template>

    <!-- Wallet switcher bottom sheet (available from header) -->
    <BottomSheet v-model="showWalletSwitcher" :title="$t('miniGero.selectWallet')" height="60%">
      <WalletSelector @select="onWalletSwitch" />
    </BottomSheet>

    <!-- Settings bottom sheet -->
    <BottomSheet v-model="showSettings" :title="$t('miniGero.allSettings')" height="70%">
      <SettingsSheet @close="showSettings = false" />
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
import SettingsSheet from './components/SettingsSheet.vue';

const showWalletSwitcher = ref(false);
const showSettings = ref(false);

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

async function onWalletSelect(wallet: any) {
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });
    if (!response.data.success) {
      console.error('Login failed:', response.data.error);
    }
  } catch (e: any) {
    console.error('Login error:', e);
  }
}

function onWalletSwitch(wallet: any) {
  showWalletSwitcher.value = false;
  onWalletSelect(wallet);
}
</script>
