<template>
  <div class="management-content">
    <img src="@/modules/wallet/icons/card.svg" alt="card" />
    <div class="management-column-content">
      <h3 class="management-heading">Manage Your Card in Seconds</h3>
      <p class="management-description">
        An all-in-one platform that helps you manage everything about <br />
        your Gero Card account
      </p>
      <div class="feature-list">
        <FeatureListItem text="Enjoy 6 months of ZERO FEES" icon="check" />
        <FeatureListItem text="0% monthly & issuance fees" icon="check" />
        <FeatureListItem text="0% fees on ADA-to-euro conversions and spending." icon="check" />
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
  }
}
</style>
