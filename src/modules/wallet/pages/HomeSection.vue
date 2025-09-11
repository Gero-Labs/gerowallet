<template>
  <div class="home-section">
    <!-- Account Overview Section -->
    <!-- <WelcomeCard :user-name="userName" /> -->
    <HeroSection />
    <AccountOverviewHeader />

    <BalanceCardsSection
      :card-balance="cardBalanceFormatted"
      :card-balance-ada="cardBalanceAda"
      :gero-earned="geroEarnedFormatted"
      :total-deposit="totalDepositFormatted"
      :total-deposit-ada="totalDepositAda"
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
import AccountOverviewHeader from '../components/dashboard/AccountOverviewHeader.vue';
import BalanceCardsSection from '../components/dashboard/BalanceCardsSection.vue';
import ChartSection from '../components/dashboard/ChartSection.vue';
import RecentTransactionsSection from '../components/dashboard/RecentTransactionsSection.vue';
import RecentActivitiesSection from '../components/dashboard/RecentActivitiesSection.vue';
import ExchangeRateSection from '../components/dashboard/ExchangeRateSection.vue';
import HeroSection from '../components/HeroSection.vue';
import { walletStore } from '@/stores/walletStore';
// ADA to EUR conversion rate (hardcoded)
const ADA_TO_EUR_RATE = 0.65;
onMounted(() => {
  cardStore.fetchCardBalance(walletStore.loggedWallet);
  cardStore.fetchCardHistory(walletStore.loggedWallet);
});

const cardBalanceFormatted = computed(() => {
  if (cardStore.state.cardBalance?.currentBalance) {
    const amount = cardStore.state.cardBalance.currentBalance.amount;
    return `${amount.toFixed(2)}`;
  }
  return '€0.00';
});

const cardBalanceAda = computed(() => {
  // Calculate ADA equivalent of card balance
  if (cardStore.state.cardBalance?.currentBalance) {
    const eurAmount = cardStore.state.cardBalance.currentBalance.amount;
    const adaAmount = eurAmount / ADA_TO_EUR_RATE;
    return `₳${adaAmount.toFixed(2)}`;
  }
  return '₳0.00';
});

const geroEarnedFormatted = computed(() => {
  // This would come from GERO rewards
  return '0.00K';
});

const totalDepositFormatted = computed(() => {
  // Start with the original hardcoded value and add new deposits
  const baseAmount = 1692.31;
  const additionalDeposits = cardStore.state.totalDeposits || 0;
  return (baseAmount + additionalDeposits).toFixed(2);
});

const totalDepositAda = computed(() => {
  // Calculate ADA equivalent of total deposits
  const baseAmount = 1692.31;
  const additionalDeposits = cardStore.state.totalDeposits || 0;
  const totalEur = baseAmount + additionalDeposits;
  const adaAmount = totalEur / ADA_TO_EUR_RATE;
  return `₳${adaAmount.toFixed(2)}`;
});

const cardHistoryRecords = computed(() => {
  const records = cardStore.state.cardHistory?.history.records || [];
  console.log('🏠 HomeSection cardHistoryRecords computed:', records.length, 'records');
  if (records.length > 0) {
    console.log('🏠 First record:', records[0]);
  }
  return records;
});

const handleFilter = () => {
  console.log('Filter clicked');
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
