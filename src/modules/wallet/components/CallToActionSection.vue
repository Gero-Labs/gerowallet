<template>
  <section class="call-to-action-section">
    <v-btn
      icon
      class="logout-btn"
      @click="handleLogout"
      title="Logout"
    >
      <v-icon>mdi-logout</v-icon>
    </v-btn>

    <h2 class="cta-heading">Spend Crypto Anywhere, Instantly</h2>
    <p class="cta-description">Your digital assets, now swipe-ready. Use your crypto like cash</p>
    <GradientButton v-if="kycStatus === 'approved'" text="Order your card today" @click="handleOrderCard" />

    <GradientButton v-else text="Start KYC" @click="startKYC" />

    <OrderCardModal :open="showModal" @close="showModal = false" />
  </section>
</template>

<script setup lang="ts">
import GradientButton from './GradientButton.vue';
import OrderCardModal from './OrderCardModal.vue';
import { ref, computed } from 'vue';
import cardStore from '@/stores/modules/card';
const showModal = ref(false);

const kycStatus = computed(() => cardStore.state.walletStatus.kycStatus);

const handleOrderCard = async () => {
  await cardStore.orderCard();
  await cardStore.fetchCardData();
};

const startKYC = () => {
  cardStore.fetchKYCLink();
};

const handleLogout = async () => {
  try {
    await cardStore.logout();
  } catch (error) {
    console.error('Logout failed:', error);
  }
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.call-to-action-section {
  @include flex-column;
  @include flex-center;
  position: relative;
}

.logout-btn {
  position: absolute;
  top: 0;
  right: 0;
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 77, 77, 0.15) !important;
    border-color: rgba(255, 77, 77, 0.3);
  }

  :deep(.v-icon) {
    color: $text-secondary;
  }

  &:hover :deep(.v-icon) {
    color: #ff4d4d;
  }
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
</style>
