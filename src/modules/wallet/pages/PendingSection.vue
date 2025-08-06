<template>
  <div class="block">
    <ApplicationStatusSection />
    <div class="soon">
      <div class="soon-content">
        <AccountOverviewHeader />

        <BalanceCardsSection :card-balance="'0'" :cardano-balance="'0'" :gero-earned="'0'" :total-deposit="'0'" />
        <div class="dashboard-layout">
          <div class="left-column">
            <RecentTransactionsSection :transactions="[]" />
          </div>
          <div class="right-column">
            <ChartSection />
            <ExchangeRateSection />
            <RecentActivitiesSection />
          </div>
        </div>
      </div>
      <h2 class="error-message">Account overview will be available once your card has been issued</h2>
    </div>

    <!-- <HeroSection />
    <CallToActionSection />
    <FeatureGridSection /> -->
  </div>
</template>

<script setup lang="ts">
import ApplicationStatusSection from '@/modules/wallet/components/ApplicationStatusSection.vue';
import HeroSection from '@/modules/wallet/components/HeroSection.vue';
import CallToActionSection from '@/modules/wallet/components/CallToActionSection.vue';
import FeatureGridSection from '@/modules/wallet/components/FeatureGridSection.vue';
import AccountOverviewHeader from '@/modules/wallet/components/dashboard/AccountOverviewHeader.vue';
import BalanceCardsSection from '@/modules/wallet/components/dashboard/BalanceCardsSection.vue';
import ChartSection from '@/modules/wallet/components/dashboard/ChartSection.vue';
import RecentTransactionsSection from '@/modules/wallet/components/dashboard/RecentTransactionsSection.vue';
import ExchangeRateSection from '@/modules/wallet/components/dashboard/ExchangeRateSection.vue';
import RecentActivitiesSection from '@/modules/wallet/components/dashboard/RecentActivitiesSection.vue';
import cardStore from '@/stores/modules/card';

const cardHistoryRecords = computed(() => {
  return cardStore.state.cardHistory?.history.records || [];
});
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.block {
  display: flex;
  flex-direction: column;
  gap: 32px;
  position: relative;
}
.error-message {
  position: absolute;
  color: #ff7777;
  padding: 10px;
  display: none;
  font-size: $font-size-sm;
  font-weight: $font-weight-medium;
  line-height: $line-height-normal;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  top: 75%;
  left: 50%;
  transform: translate(-50%, -50%);
  &:hover {
    display: block;
  }
}
.soon {
  display: flex;
  flex-direction: column;
  gap: 32px;
  width: 100%;
  .soon-content {
    opacity: 0.5;
    cursor: not-allowed;
    display: flex;
    flex-direction: column;
    gap: 16px;

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
  &:hover {
    .soon-content {
      filter: blur(4px);
    }
    .error-message {
      display: block;
    }
  }
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
