<template>
  <div class="wallet-selector" :class="{ 'wallet-selector--compact': compact }">
    <div v-if="!compact" class="selector-header">
      <img :src="geroLogo" alt="Gero" class="gero-logo" />
    </div>
    <div v-if="errorMessage" class="wallet-selector-error mb-2" role="alert">
      <v-icon size="14" color="error" class="mr-1">mdi-alert-circle-outline</v-icon>
      <span class="error--text text-caption">{{ errorMessage }}</span>
    </div>

    <!-- Keep list scrolling/sorting separate from the sheet's dismissal gesture. -->
    <WalletLibrary :available-wallets="availableWallets" :loading-wallet-id="loadingWalletId"
      @select="selectWallet" @pointerdown.native.stop />

    <!-- Add wallet -->
    <div class="add-wallet-section">
      <button type="button" class="add-wallet-btn" @click="openSetup">
        <v-icon size="20" color="var(--g-accent)">mdi-plus-circle-outline</v-icon>
        <span>{{ $t('miniGero.enterSetup') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Wallet } from '@/models/types';
import assets from '@/utils/assets';
import WalletLibrary from '@/shared/components/WalletLibrary/WalletLibrary.vue';
import { useAvailableWallets } from '@/shared/composables/useAvailableWallets';

const geroLogo = assets.geroLogo;
const { availableWallets } = useAvailableWallets();

function selectWallet(id: number) {
  if (props.loadingWalletId !== null) return;
  const wallet = availableWallets.value.find(item => item.id === id);
  if (wallet) emit('select', wallet);
}

function openSetup() {
  // addWallet=1 tells the router's /welcome guard to let this tab through
  // despite the caller already being logged in (router.ts) — no longer logs
  // out first, which used to kill the current session (and every other open
  // tab's) just to add a new wallet.
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/welcome?addWallet=1') });
}

const props = withDefaults(defineProps<{
  compact?: boolean;
  loadingWalletId?: number | null;
  errorMessage?: string;
}>(), {
  loadingWalletId: null,
  errorMessage: '',
});
const emit = defineEmits<{
  (e: 'select', wallet: Wallet): void;
}>();
</script>

<style scoped>
.wallet-selector {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: transparent;
  padding: 24px 16px 16px;
}

.wallet-selector--compact { padding: 0; }

.selector-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 12px;
}

.gero-logo {
  width: 40px;
  height: 40px;
}

.wallet-selector-error {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  border-radius: var(--g-r-control);
}

.add-wallet-section {
  flex: none;
  margin-top: 16px;
  padding-top: 8px;
  border-top: 1px solid var(--g-hairline-1);
}

.add-wallet-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: color-mix(in srgb, var(--g-accent) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 15%, transparent);
  border-radius: var(--g-r-control);
  cursor: pointer;
  transition: background var(--g-dur-base);
  width: 100%;
  text-align: left;
}

.add-wallet-btn span {
  color: var(--g-text-2);
  font-size: 13px;
}

.add-wallet-btn:hover {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
}
</style>
