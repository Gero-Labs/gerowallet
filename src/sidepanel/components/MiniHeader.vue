<template>
  <header class="mini-header">
    <div class="header-left" @click="$emit('wallet-switch')">
      <div class="header-icon">
        <v-avatar size="30" class="wallet-avatar">
          <v-img :src="walletIcon" />
        </v-avatar>
        <v-avatar v-if="networkIcon" size="14" class="chain-badge">
          <v-img contain :src="networkIcon" />
        </v-avatar>
      </div>

      <div class="wallet-info">
        <span class="wallet-name text-body-2 white--text text-truncate">
          {{ walletName }}
        </span>
        <div class="ada-handle" v-if="adaHandle">
          <span class="text-truncate" style="color: #0fd25b; font-weight: 600">$</span>{{ adaHandle.replace(/^\$/, '') }}
        </div>

      </div>
      <v-icon size="14" color="rgba(255,255,255,0.4)" class="chevron-icon">mdi-chevron-down</v-icon>
    </div>
    <div class="header-right">
      <v-tooltip bottom content-class="custom-tooltip">
        <template v-slot:activator="{ on }">
          <v-btn icon x-small @click="openFullDashboard" class="toolbar-btn" v-on="on">
            <v-icon size="18" color="#888">mdi-arrow-expand</v-icon>
          </v-btn>
        </template>
        <span>{{ $t('miniGero.openFullDashboard') }}</span>
      </v-tooltip>
      <v-btn icon x-small @click="$emit('settings')" class="toolbar-btn">
        <v-icon size="18" color="#888">mdi-cog-outline</v-icon>
      </v-btn>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import assets from '@/utils/assets';
import networks from '@/utils/networks';

const ADA_HANDLE_POLICY = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';

const walletName = computed(() => walletStore.loggedWallet?.name || 'Wallet');
const walletIcon = computed(() => assets.resolveIcon(walletStore.loggedWallet?.icon));
const adaHandle = computed(() => {
  const collections = walletStore.collections;
  if (!collections) return '';
  const handleCollection = collections[ADA_HANDLE_POLICY];
  if (!handleCollection?.items?.length) return '';
  return handleCollection.items[0].name || '';
});
const networkIcon = computed(() => {
  const wallet = walletStore.loggedWallet;
  if (!wallet) return '';
  const network = networks.resolveNetwork(wallet.chain, wallet.network);
  return network ? network.icon : '';
});

function openFullDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
}
</script>

<style scoped>
.mini-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  height: 48px;
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(10, 12, 16, 0.55);
  backdrop-filter: blur(24px) saturate(1.8);
  -webkit-backdrop-filter: blur(24px) saturate(1.8);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  cursor: pointer;
  max-width: 60%;
  gap: 8px;
  padding: 4px 8px 4px 4px;
  border-radius: 10px;
  transition: background 0.15s ease;
}

.header-left:hover {
  background: rgba(255, 255, 255, 0.08);
}

.header-left:hover .chevron-icon {
  color: rgba(255, 255, 255, 0.7) !important;
}

.header-icon {
  position: relative;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
}

.wallet-avatar {
  border: 1.5px solid rgba(255, 255, 255, 0.12);
}

.chain-badge {
  position: absolute;
  bottom: -2px;
  right: -4px;
  border: 1.5px solid rgba(0, 0, 0, 0.6);
  background: #1a1a1a;
}

.wallet-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

.wallet-name {
  max-width: 120px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.ada-handle {
  font-size: 10px;
  opacity: 0.85;
}

.chevron-icon {
  transition: color 0.15s ease;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-btn {
  width: 32px;
  height: 32px;
}
</style>
