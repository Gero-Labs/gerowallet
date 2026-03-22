<template>
  <div class="wallet-selector">
    <div v-if="!compact" class="selector-header">
      <img :src="geroLogo" alt="Gero" class="gero-logo mb-3" />
      <h2 class="white--text text-h6">{{ $t('miniGero.selectWallet') }}</h2>
    </div>
    <div class="wallet-list">
      <div
        v-for="wallet in wallets"
        :key="wallet.id"
        class="wallet-item"
        @click="$emit('select', wallet)"
      >
        <div class="wallet-icon-wrapper">
          <v-badge overlap avatar bottom bordered offset-y="18">
            <template v-slot:badge>
              <v-avatar size="16">
                <v-img :src="resolveNetworkIcon(wallet)"></v-img>
              </v-avatar>
            </template>
            <v-avatar size="36" :color="wallet.theme || '#1a1a1a'">
              <v-img :src="assets.resolveIcon(wallet.icon)"></v-img>
            </v-avatar>
          </v-badge>
        </div>
        <div class="wallet-info">
          <span class="white--text text-body-2">{{ wallet.name }}</span>
          <span class="grey--text text-caption">{{ wallet.chain }} - {{ wallet.network }}</span>
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
        <v-icon v-else size="18" color="#888">mdi-chevron-right</v-icon>
      </div>
    </div>

    <!-- Add wallet -->
    <div class="add-wallet-section">
      <button class="add-wallet-btn" @click="openSetup">
        <v-icon size="20" color="#00c7f3">mdi-plus-circle-outline</v-icon>
        <span>{{ $t('miniGero.enterSetup') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { geroStore } from '@/stores/geroStore';
import { WalletType, Wallet } from '@/models/types';
import assets from '@/utils/assets';
import networks from '@/utils/networks';

const geroLogo = assets.geroLogo;

const wallets = computed(() =>
  Object.values(geroStore.wallets || {}).filter((wallet: any) =>
    networks.resolveNetwork(wallet?.chain, wallet?.network)
  )
);

const resolveNetworkIcon = (item: Wallet): string => {
  const network = networks.resolveNetwork(item.chain, item.network);
  return network ? network.icon : '';
};

function openSetup() {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/welcome') });
}

defineProps<{ compact?: boolean }>();
defineEmits<{
  (e: 'select', wallet: any): void;
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
  background: #1a1a1a;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.wallet-item:hover {
  background: #222;
}

.wallet-icon-wrapper {
  flex-shrink: 0;
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
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.add-wallet-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: rgba(0, 199, 243, 0.06);
  border: 1px solid rgba(0, 199, 243, 0.15);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s;
  width: 100%;
  text-align: left;
}

.add-wallet-btn span {
  color: #ccc;
  font-size: 13px;
}

.add-wallet-btn:hover {
  background: rgba(0, 199, 243, 0.12);
}
</style>
