<template>
  <div class="pending-page">
    <CardJourney :current="1" />
    <ApplicationStatusSection :kycStatus="kycStatus" :isCardRejected="isCardRejected" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useWalletStatus } from '@/composables/useWalletStatus';
import ApplicationStatusSection from '@/modules/wallet/components/ApplicationStatusSection.vue';
import CardJourney from '@/modules/wallet/components/ui/CardJourney.vue';
import cardStore from '@/stores/modules/card';

const { kycStatus } = useWalletStatus();

const isCardRejected = computed(() =>
  (cardStore.state.cards || []).some(card => card.cardData?.status?.toLowerCase() === 'rejected'),
);

// Poll the verification status every 15 s; the page moves on by itself once Zione approves.
let kycPollInterval: ReturnType<typeof setInterval> | null = null;
let isPollInFlight = false;

function stopKYCPolling(): void {
  if (kycPollInterval) {
    clearInterval(kycPollInterval);
    kycPollInterval = null;
  }
}

async function pollKYCStatus(): Promise<void> {
  if (isPollInFlight) return;
  isPollInFlight = true;
  try {
    await cardStore.fetchUserKYCStatus();
  } catch {
    // A failed poll keeps the current screen; the next tick retries.
  } finally {
    isPollInFlight = false;
  }
}

onMounted(() => {
  kycPollInterval = setInterval(pollKYCStatus, 15000);
  pollKYCStatus();
});

onUnmounted(stopKYCPolling);
</script>

<style scoped>
.pending-page {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-6);
  width: 100%;
  max-width: var(--g-content-max);
  margin: 0 auto;
  padding: var(--g-s-5) clamp(16px, 3vw, 32px) var(--g-s-6);
}
</style>
