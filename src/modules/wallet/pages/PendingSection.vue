<template>
  <div class="pending-page">
    <ApplicationStatusSection :kycStatus="kycStatus" :isCardRejected="isCardRejected" @logout="handleLogout" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
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

// Poll KYC status every 15 seconds (between 10-20 as requested)
let kycPollInterval: ReturnType<typeof setInterval> | null = null;

async function pollKYCStatus() {
  try {
    await cardStore.fetchUserKYCStatus();
    // If KYC is verified, the page will automatically refresh via wallet status management
  } catch (error) {
    // Silent error handling - don't interrupt user experience
  }
}

onMounted(() => {
  // Start polling KYC status every 15 seconds
  kycPollInterval = setInterval(pollKYCStatus, 15000);
  // Also poll immediately on mount
  pollKYCStatus();
});

onUnmounted(() => {
  if (kycPollInterval) {
    clearInterval(kycPollInterval);
    kycPollInterval = null;
  }
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
