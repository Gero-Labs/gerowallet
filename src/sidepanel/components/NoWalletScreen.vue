<template>
  <div class="no-wallet-screen">
    <div class="content">
      <img :src="geroLogo" alt="Gero" class="mb-4" style="width: 64px; height: 64px;" />
      <h2 class="white--text text-h5 mb-2">{{ $t('miniGero.welcome') }}</h2>
      <p class="grey--text text-body-2 text-center mb-6">
        {{ $t('miniGero.createOrImport') }}
      </p>
      <v-btn class="geroButton" rounded depressed @click="openDashboard">
        {{ $t('miniGero.getStarted') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import assets from '@/utils/assets';
const geroLogo = assets.geroLogo;

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/welcome') });
}
</script>

<style scoped>
.no-wallet-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: #0a0a0a;
}

.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px;
}
</style>
