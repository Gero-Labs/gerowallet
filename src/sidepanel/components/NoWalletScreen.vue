<template>
  <div class="no-wallet-screen">
    <div class="content">
      <v-icon size="64" color="#00c7f3" class="mb-4">mdi-wallet-plus-outline</v-icon>
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
function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html#/welcome') });
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
