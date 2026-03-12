<template>
  <div class="wallet-selector">
    <div class="selector-header">
      <v-icon size="48" color="#00c7f3" class="mb-3">mdi-wallet</v-icon>
      <h2 class="white--text text-h6">{{ $t('miniGero.selectWallet') }}</h2>
    </div>
    <div class="wallet-list">
      <div
        v-for="wallet in wallets"
        :key="wallet.id"
        class="wallet-item"
        @click="$emit('select', wallet)"
      >
        <v-avatar size="36" :color="wallet.theme || '#1a1a1a'">
          <v-icon size="20" color="white">mdi-wallet</v-icon>
        </v-avatar>
        <div class="wallet-info">
          <span class="white--text text-body-2">{{ wallet.name }}</span>
        </div>
        <v-icon size="18" color="#888">mdi-chevron-right</v-icon>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { geroStore } from '@/stores/geroStore';

const wallets = computed(() => Object.values(geroStore.wallets || {}));

defineEmits<{
  (e: 'select', wallet: any): void;
}>();
</script>

<style scoped>
.wallet-selector {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0a0a;
  padding: 32px 16px;
}

.selector-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 24px;
}

.wallet-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.wallet-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}
</style>
