<template>
  <div class="pending-page">
    <ApplicationStatusSection :kycStatus="kycStatus" :isCardRejected="isCardRejected" @logout="handleLogout" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useWalletStatus } from '@/composables/useWalletStatus';
import ApplicationStatusSection from '@/modules/wallet/components/ApplicationStatusSection.vue';
import cardStore from '@/stores/modules/card';

const { kycStatus } = useWalletStatus();

// Check if any card is rejected
const isCardRejected = computed(() => {
  const cards = cardStore.state.cards || [];
  return cards.some(card => {
    const status = card.cardData?.status;
    return status === 'rejected' || status === 'REJECTED';
  });
});

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
