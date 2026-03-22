<template>
  <header class="mini-header">
    <div class="header-left" @click="$emit('wallet-switch')">
      <v-avatar size="28" class="mr-2">
        <v-img :src="geroLogo" contain width="20" height="20" />
      </v-avatar>
      <span class="wallet-name text-body-2 white--text text-truncate">
        {{ walletName }}
      </span>
      <v-icon size="14" color="#888" class="ml-1">mdi-chevron-down</v-icon>
    </div>
    <div class="header-right">
      <v-tooltip bottom>
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

const geroLogo = assets.geroLogo;

const walletName = computed(() => walletStore.loggedWallet?.name || 'Wallet');

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
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  position: relative;
  z-index: 2;
}

.header-left {
  display: flex;
  align-items: center;
  cursor: pointer;
  max-width: 60%;
}

.wallet-name {
  max-width: 120px;
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
