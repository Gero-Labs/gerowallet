<template>
  <div class="home-section">
    <HeroSection />

    <div class="dashboard-layout">
      <div class="left-column">
        <RecentTransactionsSection :transactions="cardHistoryRecords" :loading="loading" />
      </div>
      <div class="right-column">
        <!-- <ChartSection @filter="handleFilter" /> -->
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import cardStore from '@/stores/modules/card';
import RecentTransactionsSection from '../components/dashboard/RecentTransactionsSection.vue';
import HeroSection from '../components/HeroSection.vue';
import { useIntervalFn } from '@vueuse/core';
const loading = ref(false);

onMounted(async () => {
  loading.value = true;

  // Fetch card details for the selected card (only once on mount)
  const selectedCardId = cardStore.state.selectedCardId;
  if (selectedCardId) {
    try {
      await cardStore.fetchCardDetails(selectedCardId);
    } catch (error) {
      console.error('Failed to fetch card details:', error);
    }
  }

  await cardStore.fetchCardHistory();
  await cardStore.fetchCardBalance();
  loading.value = false;
  useIntervalFn(() => {
    initData();
  }, 60000);
});

// Watch for card selection changes and fetch transaction details
watch(() => cardStore.state.selectedCardId, async (newCardId, oldCardId) => {
  if (newCardId && newCardId !== oldCardId) {
    loading.value = true;
    try {
      // Fetch card details (PAN, CVV, expiry) for the newly selected card
      await cardStore.fetchCardDetails(newCardId);
      // Fetch transaction history for the newly selected card
      await cardStore.fetchCardHistory({}, newCardId);
      // Fetch balance for the newly selected card
      await cardStore.fetchCardBalance(newCardId);
    } catch (error) {
      console.error('Failed to fetch card data:', error);
    } finally {
      loading.value = false;
    }
  }
});

const initData = () => {
  cardStore.fetchCardHistory();
  cardStore.fetchCardBalance();
  cardStore.getExchangeRate();
};

const cardHistoryRecords = computed(() => {
  const selectedCard = cardStore.getSelectedCard();
  const records = selectedCard?.cardHistory?.records || [];
  if (records.length > 0) {
    console.log('🏠 First record:', records[0]);
  }
  return records;
});
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';

.home-section {
  min-height: 100vh;
  padding: 12px 32px 96px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.dashboard-layout {
  display: flex;
  gap: $spacing-lg;
  align-items: flex-start;

  .left-column {
    flex: 1;
    width: calc(66% - 8px);
  }

  .right-column {
    display: flex;
    flex-direction: column;
    gap: $spacing-lg;
    width: calc(33% - 8px);
    flex-shrink: 0;
  }
}

@media (max-width: 1600px) {
  .dashboard-layout {
    flex-direction: column;
    gap: $spacing-lg;

    .right-column {
      width: 100%;
    }
    .left-column {
      width: 100%;
    }
  }
}

@media (max-width: $breakpoint-md) {
  .home-section {
    padding: 8px 16px 64px;
  }

  .dashboard-layout {
    flex-direction: column;
    gap: $spacing-lg;

    .right-column {
      width: 100%;
    }
  }
}
</style>
