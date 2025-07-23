<template>
  <div class="home-section">
    <!-- Account Overview Section -->
    <WelcomeCard @top-up="handleTopUp" @manage-card="handleManageCard" @qr-scan="handleQrScan" />
    <AccountOverviewHeader @top-up="$emit('topUp')" @manage-card="$emit('manageCard')" @qr-scan="$emit('qrScan')" />

    <BalanceCardsSection />

    <ChartSection @filter="handleFilter" />

    <!-- Two Column Layout -->
    <div class="dashboard-layout">
      <div class="left-column">
        <RecentTransactionsSection />
      </div>
      <div class="right-column">
        <ExchangeRateSection />
        <RecentActivitiesSection />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import WelcomeCard from '../components/dashboard/WelcomeCard.vue';
import AccountOverviewHeader from '../components/dashboard/AccountOverviewHeader.vue';
import BalanceCardsSection from '../components/dashboard/BalanceCardsSection.vue';
import ChartSection from '../components/dashboard/ChartSection.vue';
import RecentTransactionsSection from '../components/dashboard/RecentTransactionsSection.vue';
import RecentActivitiesSection from '../components/dashboard/RecentActivitiesSection.vue';
import ExchangeRateSection from '../components/dashboard/ExchangeRateSection.vue';

const handleTopUp = () => {
  console.log('Top up clicked');
  // Handle top up action
};

const handleManageCard = () => {
  console.log('Manage card clicked');
  // Handle manage card action
};

const handleQrScan = () => {
  console.log('QR scan clicked');
  // Handle QR scan action
};

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
    width: 100%;
  }

  .right-column {
    display: flex;
    flex-direction: column;
    gap: $spacing-lg;
    width: 357px;
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
