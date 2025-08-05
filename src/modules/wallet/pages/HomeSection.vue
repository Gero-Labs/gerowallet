<template>
  <div class="home-section">
    <!-- Account Overview Section -->
    <!-- <WelcomeCard :user-name="userName" /> -->
    <HeroSection />
    <AccountOverviewHeader />

    <BalanceCardsSection
      :card-balance="cardBalanceFormatted"
      :cardano-balance="cardanoBalanceFormatted"
      :gero-earned="geroEarnedFormatted"
      :total-deposit="totalDepositFormatted"
    />
    <div class="dashboard-layout">
      <div class="left-column">
        <RecentTransactionsSection :transactions="cardHistoryRecords" />
      </div>
      <div class="right-column">
        <ChartSection @filter="handleFilter" />
        <ExchangeRateSection />
        <RecentActivitiesSection />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import cardStore from '@/stores/modules/card';
import { useMockCardData } from '@/models/card-example';
import geroStore from '@/stores/geroStore';
import WelcomeCard from '../components/dashboard/WelcomeCard.vue';
import AccountOverviewHeader from '../components/dashboard/AccountOverviewHeader.vue';
import BalanceCardsSection from '../components/dashboard/BalanceCardsSection.vue';
import ChartSection from '../components/dashboard/ChartSection.vue';
import RecentTransactionsSection from '../components/dashboard/RecentTransactionsSection.vue';
import RecentActivitiesSection from '../components/dashboard/RecentActivitiesSection.vue';
import ExchangeRateSection from '../components/dashboard/ExchangeRateSection.vue';
import HeroSection from '../components/HeroSection.vue';

const { initializeMockData } = useMockCardData();

// Computed properties for formatted data
const userName = computed(() => {
  if (cardStore.state.userInfo?.email) {
    return cardStore.state.userInfo.email.split('@')[0]; // Extract name from email
  }
  return 'User';
});

const cardBalanceFormatted = computed(() => {
  if (cardStore.state.cardBalance?.currentBalance) {
    const amount = cardStore.state.cardBalance.currentBalance.amount;
    const currency = cardStore.state.cardBalance.currentBalance.currencyCode;
    return `${amount.toFixed(2)}`;
  }
  return '€0.00';
});

const cardanoBalanceFormatted = computed(() => {
  // This would come from Cardano wallet balance
  return '₳846.15';
});

const geroEarnedFormatted = computed(() => {
  // This would come from GERO rewards
  return '0.00K';
});

const totalDepositFormatted = computed(() => {
  // This would come from Cardano wallet balance
  return '1692.31';
});

const cardHistoryRecords = computed(() => {
  return cardStore.state.cardHistory?.history.records || [];
});

// Initialize data
onMounted(async () => {
  console.log('HomeSection mounted, DEV mode:', import.meta.env.DEV);
  if (import.meta.env.DEV) {
    // Use mock data in development
    console.log('Initializing mock data...');
    await initializeMockData();
    console.log('Mock data initialized');
  } else {
    // Use real API in production
    console.log('Initializing real API...');
    await cardStore.initialize(geroStore.state.wallets);
    console.log('Real API initialized');
  }
});

const handleFilter = () => {
  console.log('Filter clicked');
  // Handle filter action
};
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
