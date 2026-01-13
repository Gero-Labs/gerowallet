<template>
  <div class="pending-page">
    <ApplicationStatusSection :kycStatus="kycStatus" @logout="handleLogout" />
  </div>
</template>

<script setup lang="ts">
import { useWalletStatus } from '@/composables/useWalletStatus';
import ApplicationStatusSection from '@/modules/wallet/components/ApplicationStatusSection.vue';
import cardStore from '@/stores/modules/card';

const { kycStatus } = useWalletStatus();

async function handleLogout() {
  try {
    await cardStore.logout();
  } catch (error) {
    console.error('Logout failed:', error);
  }
}
</script>

<style lang="scss" scoped>
@import '../styles/variables';

.pending-page {
  display: flex;
  flex-direction: column;
  gap: $spacing-2xl;
  padding-top: $spacing-3xl; // Extra top padding for animation overflow
}
</style>
