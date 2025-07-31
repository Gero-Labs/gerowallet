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
    <div class="bottom-cta">
      <GradientButton text="Order your card today" @click="handleOrderCard" />
    </div>
    <OrderCardModal :open="showModal" @close="showModal = false" />
  </section>
</template>

<script setup lang="ts">
import GradientButton from './GradientButton.vue';
import FeatureCard from './FeatureCard.vue';
import type { FeatureCardProps } from '@/models/types';
import OrderCardModal from './OrderCardModal.vue';
import { ref } from 'vue';

const showModal = ref(false);

const features: FeatureCardProps[] = [
  {
    icon: 'conversion',
    title: 'Real-Time Conversion',
    description: 'Your crypto is instantly converted to fiat at the moment of purchase—no delays, no manual swaps.',
  },
  {
    icon: 'global',
    title: 'Global Acceptance',
    description: 'Shop online or in-store worldwide, just like a traditional debit or credit card.',
  },
  {
    icon: 'track',
    title: 'Track & Manage Easily',
    description: 'Monitor balances, spending, and top-ups—all in one sleek wallet app.',
  },
];

const handleOrderCard = () => {
  showModal.value = true;
};
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
