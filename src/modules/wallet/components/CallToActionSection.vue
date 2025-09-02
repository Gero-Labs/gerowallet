<template>
  <section class="call-to-action-section">
    <h2 class="cta-heading">Spend Crypto Anywhere, Instantly</h2>
    <p class="cta-description">Your digital assets, now swipe-ready. Use your crypto like cash</p>
    <GradientButton text="Order your card today" @click="handleOrderCard" />
    
    <!-- Development Reset Button -->
    <button 
      v-if="isDevelopment" 
      @click="resetRegistration" 
      class="dev-reset-button"
      title="Reset Kaiserex registration status for testing"
    >
      🔄 Reset Registration (Dev)
    </button>
    
    <OrderCardModal :open="showModal" @close="showModal = false" />
  </section>
</template>

<script setup lang="ts">
import GradientButton from './GradientButton.vue';
import OrderCardModal from './OrderCardModal.vue';
import { ref, computed } from 'vue';

const showModal = ref(false);
const isDevelopment = computed(() => import.meta.env.DEV);

const handleOrderCard = () => {
  showModal.value = true;
};

const resetRegistration = () => {
  localStorage.removeItem('kaiserexRegistered');
  localStorage.removeItem('kycStatus');
  console.log('Registration status reset - you can now test the flow again');
  alert('Registration reset! You can now test the Kaiserex registration flow again.');
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.call-to-action-section {
  @include flex-column;
  @include flex-center;
}

.new-tag {
  @include text-style($font-size-sm, $font-weight-medium, $line-height-normal);
  display: inline-block;
  background: #053321;
  color: #75e0a7;
  padding: $spacing-xs $spacing-md;
  border-radius: $border-radius-full;
  border: 1px solid #085d3a;
  margin-bottom: $spacing-2xl;
  text-align: center;
}

.cta-heading {
  @include heading-style($font-size-3xl);
  margin: 0 0 $spacing-md 0;
}

.cta-description {
  @include body-text($font-size-xl);
  margin: 0 0 $spacing-4xl 0;
  text-align: center;
}

.dev-reset-button {
  margin-top: $spacing-md;
  padding: $spacing-xs $spacing-md;
  background: rgba(255, 100, 100, 0.1);
  border: 1px solid rgba(255, 100, 100, 0.3);
  border-radius: $border-radius-md;
  color: #ff6464;
  font-size: $font-size-sm;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover {
    background: rgba(255, 100, 100, 0.2);
    border-color: rgba(255, 100, 100, 0.5);
  }
}
</style>
