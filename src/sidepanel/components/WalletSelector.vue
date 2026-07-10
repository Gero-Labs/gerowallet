<template>
  <div class="wallet-selector">
    <div v-if="!compact" class="selector-header">
      <img :src="geroLogo" alt="Gero" class="gero-logo mb-3" />
      <h2 class="white--text text-h6">{{ $t('miniGero.selectWallet') }}</h2>
    </div>
    <div v-if="errorMessage" class="wallet-selector-error mb-2">
      <v-icon size="14" color="error" class="mr-1">mdi-alert-circle-outline</v-icon>
      <span class="error--text text-caption">{{ errorMessage }}</span>
    </div>

    <div class="wallet-list">
      <div
        v-for="wallet in availableWallets"
        :key="wallet.id"
        class="wallet-item"
        :class="{ 'is-disabled': loadingWalletId !== null && loadingWalletId !== wallet.id }"
        @click="loadingWalletId === null && $emit('select', wallet)"
      >
        <div class="wallet-icon-wrapper">
          <v-avatar size="36" class="wallet-avatar">
            <v-img :src="assets.resolveIcon(wallet.icon)" />
          </v-avatar>
          <v-avatar v-if="loadingWalletId !== wallet.id" size="16" class="network-badge">
            <v-img contain :src="resolveNetworkIcon(wallet)" />
          </v-avatar>
          <v-progress-circular
            v-else
            size="16"
            width="2"
            indeterminate
            :color="primaryColor"
            class="network-badge"
          />
        </div>
        <div class="wallet-info">
          <span class="white--text text-body-2">{{ wallet.name }}</span>
          <span class="grey--text text-caption">
            {{ loadingWalletId === wallet.id ? $t('miniGero.unlocking') : `${wallet.chain} - ${wallet.network}` }}
          </span>
        </div>
        <v-img
          v-if="wallet.type === WalletType.Ledger"
          :src="assets.ledgerSvg"
          contain
          max-width="18"
          max-height="18"
          class="hw-icon"
        />
        <v-img
          v-else-if="wallet.type === WalletType.Trezor"
          :src="assets.trezorSvg"
          contain
          max-width="18"
          max-height="18"
          class="hw-icon"
        />
        <v-img
          v-else-if="wallet.type === WalletType.Keystone"
          :src="assets.keystoneSvg"
          contain
          max-width="18"
          max-height="18"
          class="hw-icon"
        />
        <v-icon v-else size="18" color="var(--g-text-3)">mdi-chevron-right</v-icon>
      </div>
    </div>

    <!-- Add wallet -->
    <div class="add-wallet-section">
      <button class="add-wallet-btn" @click="openSetup">
        <v-icon size="20" :color="primaryColor">mdi-plus-circle-outline</v-icon>
        <span>{{ $t('miniGero.enterSetup') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { geroStore } from '@/stores/geroStore';
import { WalletType, Wallet } from '@/models/types';
import assets from '@/utils/assets';
import networks from '@/utils/networks';
import { useChainContext } from '../composables/useChainContext';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const geroLogo = assets.geroLogo;

const { wallets } = toRefs(geroStore);

const availableWallets = computed(() =>
  (Object.values(wallets.value) as Wallet[])
    .filter((wallet: Wallet) => {
      return networks.resolveNetwork(wallet?.chain, wallet?.network) && wallet.type != WalletType.Google;
    })
);

const resolveNetworkIcon = (item: Wallet): string => {
  const network = networks.resolveNetwork(item.chain, item.network);
  return network ? network.icon : '';
};

function openSetup() {
  // addWallet=1 tells the router's /welcome guard to let this tab through
  // despite the caller already being logged in (router.ts) — no longer logs
  // out first, which used to kill the current session (and every other open
  // tab's) just to add a new wallet.
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/welcome?addWallet=1') });
}

withDefaults(defineProps<{
  compact?: boolean;
  loadingWalletId?: number | null;
  errorMessage?: string;
}>(), {
  loadingWalletId: null,
  errorMessage: '',
});
defineEmits<{
  (e: 'select', wallet: Wallet): void;
}>();
</script>

<style scoped>
.wallet-selector {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
  padding: 24px 16px 16px;
}

.selector-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 20px;
}

.gero-logo {
  width: 48px;
  height: 48px;
}

.wallet-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  overflow-y: auto;
}

.wallet-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--g-raised);
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-1);
  cursor: pointer;
  transition: all 0.2s ease;
}

.wallet-item:hover {
  background: var(--g-overlay);
  border-color: var(--g-hairline-3);
}

.wallet-item:active {
  transform: scale(0.98);
  background: var(--g-raised);
}

.wallet-item.is-disabled {
  opacity: 0.45;
  cursor: default;
  pointer-events: none;
}

.wallet-selector-error {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  border-radius: var(--g-r-control);
}

.wallet-icon-wrapper {
  position: relative;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
}

.wallet-avatar {
  border: 1.5px solid var(--g-hairline-2);
}

.network-badge {
  position: absolute;
  bottom: -2px;
  right: -4px;
  border: 1.5px solid rgba(0, 0, 0, 0.5);
  background: var(--g-raised);
}

.wallet-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.hw-icon {
  flex-shrink: 0;
  opacity: 0.7;
}

.add-wallet-section {
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
  transition: background 0.2s;
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
