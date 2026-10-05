<template>
  <div class="home-section">
    <HeroSection />
    <RecentTransactionsSection v-if="selectedCard" />
    <KaiserexPartnershipBadge />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useIntervalFn } from '@vueuse/core';
import cardStore from '@/stores/modules/card';
import HeroSection from '../components/HeroSection.vue';
import RecentTransactionsSection from '../components/dashboard/RecentTransactionsSection.vue';
import KaiserexPartnershipBadge from '../components/KaiserexPartnershipBadge.vue';

const selectedCard = computed(() => cardStore.getSelectedCard());

function refreshBalance(): void {
  if (!cardStore.isAuthenticated || cardStore.currentState !== 'approved') return;
  Promise.allSettled([cardStore.fetchCardBalance(), cardStore.getExchangeRate()]);
}

// Registered at setup so the interval stops with the page (it used to outlive sign-out).
useIntervalFn(refreshBalance, 60000);

onMounted(refreshBalance);
</script>

<style scoped>
.home-section {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-6);
  width: 100%;
  max-width: var(--g-content-max);
  margin: 0 auto;
  padding: var(--g-s-5) clamp(16px, 3vw, 32px) var(--g-s-6);
}
</style>
