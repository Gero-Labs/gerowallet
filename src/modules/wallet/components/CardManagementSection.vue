<template>
  <div class="management-content">
    <img src="@/modules/wallet/icons/card.svg" alt="card" />
    <div class="management-column-content">
      <h3 class="management-heading">Manage Your Card in Seconds</h3>
      <p class="management-description">
        Get your Gero Card ready in just a few steps:
      </p>
      <div class="feature-list steps-list">
        <FeatureListItem text="Register on Kaiserex" icon="check" />
        <FeatureListItem text="Activate your account via email" icon="check" />
        <FeatureListItem text="Sign in and complete KYC" icon="check" />
        <FeatureListItem text="Once approved, order your card!" icon="check" />
      </div>
      <div class="promo-section">
        <p class="promo-title">Enjoy ZERO FEES until May 1 (6 months)</p>
        <div class="feature-list">
          <FeatureListItem text="0% monthly & issuance fees" icon="check" />
          <FeatureListItem text="0% fees on ADA-to-EUR conversions" icon="check" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import FeatureListItem from '@/modules/wallet/components/FeatureListItem.vue';
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
