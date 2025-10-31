<template>
  <div class="home-section">
    <div class="content-wrapper">
      <HeroSection />
      <!-- <ExchangeRateSection/> -->
      <div class="dashboard-layout" v-if="selectedCard">
        <!-- <div class="left-column"> -->
        <RecentTransactionsSection :transactions="cardHistoryRecords" :loading="loading" />
        <!-- </div> -->
        <!-- <div class="right-column">
           <ChartSection @filter="handleFilter" /
        </div>> -->
      </div>
    </div>

    <!-- Kaiserex Partnership Info - Always at bottom -->
    <v-footer class="footer transparent px-0">
      <KaiserexPartnershipBadge/>
    </v-footer>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, onMounted, ref } from 'vue';
import cardStore from '@/stores/modules/card';
import RecentTransactionsSection from '../components/dashboard/RecentTransactionsSection.vue';
import HeroSection from '../components/HeroSection.vue';
import KaiserexPartnershipBadge from '../components/KaiserexPartnershipBadge.vue';
import { useIntervalFn } from '@vueuse/core';
import ExchangeRateSection from '@/modules/wallet/components/dashboard/ExchangeRateSection.vue';

const { t } = useTranslation();
const loading = ref(false);

const currentState = computed(() => cardStore.currentState)

const selectedCard = computed(() => cardStore.getSelectedCard());

onMounted(async () => {
  loading.value = true;

  await Promise.all([cardStore.fetchCardHistory(), cardStore.fetchCardBalance()])
  loading.value = false;
  useIntervalFn(() => { //TODO need to fix this to occur only when the card is active or becoming active - terminate when logging out
    initData();
  }, 60000);
});

const initData = () => {
  if (cardStore.isAuthenticated && (currentState.value === 'approved' || currentState.value === 'new')) {
    cardStore.fetchCardHistory();
    cardStore.fetchCardBalance();
    cardStore.getExchangeRate();
  }
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
  padding: 12px 32px 0;
  height: 100%;
  position: relative;
  overflow-y: auto;
  min-height: calc(100vh - 100px);
  display: flex;
  flex-direction: column;
  gap: 32px;
  justify-content: space-between;
}

.content-wrapper {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.dashboard-layout {
  display: flex;
  gap: $spacing-lg;
  align-items: flex-start;
  width: 100%;
  // .left-column {
  //   flex: 1;
  //   max-width: 100%;
  // }

  // .right-column {
  //   display: flex;
  //   flex-direction: column;
  //   gap: $spacing-lg;
  //   width: calc(33% - 8px);
  //   flex-shrink: 0;
  // }
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
    padding: 8px 16px 0;
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
