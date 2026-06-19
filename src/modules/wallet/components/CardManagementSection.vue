<template>
  <div class="management-content">
    <img src="@/assets/front_card_no_mcx2.png" alt="card" />
    <div class="management-column-content">
      <h3 class="management-heading">{{ t('card.manageYourCardInSeconds') }}</h3>
      <p class="management-description">
        {{ t('card.getCardReadySteps') }}
      </p>
      <div class="feature-list steps-list">
        <FeatureListItem :text="t('card.registerOnKaiserex')" icon="check" />
        <FeatureListItem :text="t('card.activateViaEmail')" icon="check" />
        <FeatureListItem :text="t('card.signInCompleteKYC')" icon="check" />
        <FeatureListItem :text="t('card.onceApprovedOrder')" icon="check" />
      </div>
      <div class="promo-section">
        <p class="promo-title">{{ t('card.enjoyZeroFeesUntil') }}</p>
        <div class="feature-list">
          <FeatureListItem :text="t('card.zeroMonthlyFees')" icon="check" />
          <FeatureListItem :text="t('card.zeroAdaEurFees')" icon="check" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import FeatureListItem from '@/modules/wallet/components/FeatureListItem.vue';

const { t } = useTranslation();
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.management-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-4xl;
  width: 100%;
  padding: $spacing-3xl;

  @include mobile {
    flex-direction: column;
    gap: $spacing-2xl;
  }
}

.management-column-content {
  @include flex-column;
  gap: $spacing-lg;

  .featured-icon {
    width: 48px;
    height: 48px;
    background: #0b4a6f;
    border-radius: 50%;
    @include flex-center;
  }

  .management-heading {
    @include heading-style($font-size-3xl);
  }

  .management-description {
    @include body-text($font-size-base);
  }

  .feature-list {
    @include flex-column;
    gap: $spacing-md;

    &.steps-list {
      margin-bottom: $spacing-xl;
    }
  }

  .promo-section {
    @include flex-column;
    gap: $spacing-md;
    margin-top: $spacing-lg;
    padding-top: $spacing-lg;
    border-top: 1px solid rgba(255, 255, 255, 0.1);

    .promo-title {
      @include body-text($font-size-lg);
      font-weight: $font-weight-semibold;
      color: $text-primary;
      margin: 0;
    }
  }
}
</style>
