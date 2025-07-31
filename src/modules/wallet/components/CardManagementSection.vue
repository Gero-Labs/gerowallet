<template>
  <div class="management-content">
    <img src="@/modules/wallet/icons/card.svg" alt="card" />
    <div class="management-column-content">
      <h3 class="management-heading">Manage Your Card in Seconds</h3>
      <p class="management-description">
        An all-in-one platform that helps you manage everything about <br />
        your credit card account
      </p>
      <div class="feature-list">
        <FeatureListItem text="Approved within 24 hours" icon="check" />
        <FeatureListItem text="Apple Pay or Google Pay compatible" icon="check" />
        <FeatureListItem text="Physical card to you—anywhere, at no extra cost." icon="check" />
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
  width: 100%;

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
