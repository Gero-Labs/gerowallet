<template>
  <div class="wallet-selector">
    <div v-if="!compact" class="selector-header">
      <img :src="geroLogo" alt="Gero" class="gero-logo mb-3" />
      <h2 class="white--text text-h6">{{ $t('miniGero.selectWallet') }}</h2>
    </div>
    <div class="wallet-list">
      <div
        v-for="wallet in availableWallets"
        :key="wallet.id"
        class="wallet-item"
        @click="$emit('select', wallet)"
      >
        <div class="wallet-icon-wrapper">
          <v-avatar size="36" class="wallet-avatar">
            <v-img :src="assets.resolveIcon(wallet.icon)" />
          </v-avatar>
          <v-avatar size="16" class="network-badge">
            <v-img contain :src="resolveNetworkIcon(wallet)" />
          </v-avatar>
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
        <v-img
          v-else-if="wallet.type === WalletType.Google && wallet.encryptionMethod === 'mpc'"
          :src="assets.googleSvg"
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
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
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
      // WalletType.Google is overloaded: legacy smart-wallets (hidden here)
      // vs MPC "Sign in with Google" wallets (real Cardano wallets — must show).
      return networks.resolveNetwork(wallet?.chain, wallet?.network)
        && (wallet.type != WalletType.Google || wallet.encryptionMethod === 'mpc');
    })
);

const resolveNetworkIcon = (item: Wallet): string => {
  const network = networks.resolveNetwork(item.chain, item.network);
  return network ? network.icon : '';
};

async function openSetup() {
  // Logout so both dashboard and mini gero return to wallet selection
  try {
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGOUT,
      data: {},
    });
  } catch (e) {
    console.error('Logout before setup error:', e);
  }
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/welcome') });
}

defineProps<{ compact?: boolean }>();
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
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    inset 0 -1px 0 rgba(0, 0, 0, 0.1),
    0 2px 8px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  transition: all 0.2s ease;
}

.wallet-item:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.14);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    inset 0 -1px 0 rgba(0, 0, 0, 0.1),
    0 4px 16px rgba(0, 0, 0, 0.3);
}

.wallet-item:active {
  transform: scale(0.98);
  background: rgba(255, 255, 255, 0.06);
}

.wallet-icon-wrapper {
  position: relative;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
}

.wallet-avatar {
  border: 1.5px solid rgba(255, 255, 255, 0.1);
}

.network-badge {
  position: absolute;
  bottom: -2px;
  right: -4px;
  border: 1.5px solid rgba(0, 0, 0, 0.5);
  background: rgba(20, 20, 20, 0.8);
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
  margin: 8px;
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
  background: color-mix(in srgb, var(--chain-primary) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--chain-primary) 15%, transparent);
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
  background: color-mix(in srgb, var(--chain-primary) 12%, transparent);
}
</style>
