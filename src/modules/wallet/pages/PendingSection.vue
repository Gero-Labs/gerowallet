<template>
  <div class="block">
    <ApplicationStatusSection />
    <div class="soon">
      <div class="soon-content">
        <div class="dashboard-layout">
          <div class="left-column">
            <RecentTransactionsSection :transactions="[]" />
          </div>
          <div class="right-column">
            <ChartSection />
            <RecentActivitiesSection />
          </div>
        </div>
      </div>

      <!-- Prominent Pending State Overlay -->
      <div class="pending-overlay">
        <div class="pending-content">
          <div class="pending-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="#2DF0F7" stroke-width="2" fill="none"/>
              <path d="M12 6v6l4 2" stroke="#2DF0F7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h2 class="pending-title">{{ $t('card.accountOverviewPending') }}</h2>
          <p class="pending-description">{{ $t('card.accountOverviewAvailableOnce') }}</p>
          <div class="pending-status">
            <div class="status-indicator"></div>
            <span class="status-text">{{ $t('card.processingYourApplication') }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- <HeroSection />
    <CallToActionSection />
    <FeatureGridSection /> -->
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import ApplicationStatusSection from '@/modules/wallet/components/ApplicationStatusSection.vue';
// import AccountOverviewHeader from '@/modules/wallet/components/dashboard/AccountOverviewHeader.vue';
// import BalanceCardsSection from '@/modules/wallet/components/dashboard/BalanceCardsSection.vue';
import ChartSection from '@/modules/wallet/components/dashboard/ChartSection.vue';
import RecentTransactionsSection from '@/modules/wallet/components/dashboard/RecentTransactionsSection.vue';
import RecentActivitiesSection from '@/modules/wallet/components/dashboard/RecentActivitiesSection.vue';
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
// Removed old error-message styles
.soon {
  display: flex;
  flex-direction: column;
  gap: 32px;
  width: 100%;

  position: relative;
  .soon-content {
    opacity: 0.4;
    cursor: not-allowed;
    display: flex;
    flex-direction: column;
    gap: 16px;
    filter: blur(8px);
    pointer-events: none;
    user-select: none;

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
}

// Pending State Overlay Styles
.pending-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 100;
  background: rgba(12, 17, 29, 0.95);
  border: 1px solid #2DF0F7;
  border-radius: 16px;
  padding: 48px 32px;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(45, 240, 247, 0.1);
  width: 90%;
  max-width: 500px;

  .pending-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 24px;
  }

  .pending-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: rgba(45, 240, 247, 0.1);
    margin-bottom: 8px;

    svg {
      filter: drop-shadow(0 0 8px rgba(45, 240, 247, 0.3));
    }
  }

  .pending-title {
    font-family: $font-family-primary;
    font-weight: $font-weight-bold;
    font-size: 28px;
    line-height: 1.2;
    color: #FFFFFF;
    margin: 0;
    letter-spacing: -0.02em;
  }

  .pending-description {
    font-family: $font-family-primary;
    font-weight: $font-weight-medium;
    font-size: 16px;
    line-height: 1.5;
    color: #CECFD2;
    margin: 0;
    max-width: 400px;
  }

  .pending-status {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    background: rgba(45, 240, 247, 0.05);
    border: 1px solid rgba(45, 240, 247, 0.2);
    border-radius: 8px;
    margin-top: 8px;

    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #2DF0F7;
      animation: pulse 2s infinite;
    }

    .status-text {
      font-family: $font-family-primary;
      font-weight: $font-weight-medium;
      font-size: 14px;
      color: #2DF0F7;
    }
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.2);
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
