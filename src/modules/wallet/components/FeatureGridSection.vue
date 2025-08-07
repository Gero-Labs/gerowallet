<template>
  <section class="feature-grid-section">
    <div class="feature-grid">
      <FeatureCard
        v-for="feature in features"
        :key="feature.title"
        :icon="feature.icon"
        :title="feature.title"
        :description="feature.description"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import FeatureCard from './FeatureCard.vue';
import type { FeatureCardProps } from '@/models/types';

const features: FeatureCardProps[] = [
  {
    icon: 'conversion',
    title: 'Real-Time Conversion',
    description: 'Your crypto is instantly converted to fiat at the moment of top-up.',
  },
  {
    icon: 'global',
    title: 'Global Acceptance',
    description: 'Shop online or in-store worldwide, just like a traditional debit or credit card.',
  },
  {
    icon: 'track',
    title: 'Track & Manage Easily',
    description: 'Monitor balances, spending, and top-upsall in one sleek wallet app.',
  },
];
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: $spacing-2xl;
  padding: $spacing-3xl;

  @include mobile {
    grid-template-columns: 1fr;
    gap: $spacing-xl;
  }
}

.bottom-cta {
  display: flex;
  justify-content: center;
  padding: $spacing-3xl;
}
</style>
