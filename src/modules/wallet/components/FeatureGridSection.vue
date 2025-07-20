<template>
  <section class="feature-grid-section">
    <div class="feature-grid">
      <FeatureCard
        icon="conversion"
        title="Real-Time Conversion"
        description="Your crypto is instantly converted to fiat at the moment of purchase—no delays, no manual swaps."
      />
      <FeatureCard
        icon="global"
        title="Global Acceptance"
        description="Shop online or in-store worldwide, just like a traditional debit or credit card."
      />
      <FeatureCard
        icon="track"
        title="Track & Manage Easily"
        description="Monitor balances, spending, and top-ups—all in one sleek wallet app."
      />
    </div>
    <div class="bottom-cta">
      <GradientButton text="Order your card today" @click="openModal" />
    </div>
    <OrderCardModal :open="showModal" @close="showModal = false" />
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import FeatureCard from './FeatureCard.vue';
import GradientButton from './GradientButton.vue';
import OrderCardModal from './OrderCardModal.vue';

const showModal = ref(false);

const openModal = () => {
  showModal.value = true;
};
</script>

<style scoped>
.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
  padding: 32px;
}

.bottom-cta {
  display: flex;
  justify-content: center;
  padding: 32px;
}
</style>
