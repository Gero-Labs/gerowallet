<template>
  <div style="display: flex; flex-direction: column; min-height: 0; flex: 1;">
    <WalletLibrary :available-wallets="wallets" />
  </div>
</template>
<script setup lang="ts">
import WalletLibrary from '@/shared/components/WalletLibrary/WalletLibrary.vue';
import { wallets } from './fixtures';
</script>
