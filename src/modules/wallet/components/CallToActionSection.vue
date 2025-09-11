<template>
  <section class="call-to-action-section">
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
import { walletStore } from '@/stores/walletStore';
const showModal = ref(false);

const kycStatus = computed(() => cardStore.state.walletStatus.kycStatus);

const handleOrderCard = async () => {
  await cardStore.orderCard(walletStore.loggedWallet);
  await cardStore.fetchCardData(walletStore.loggedWallet);
};

const startKYC = () => {
  cardStore.fetchKYCLink(walletStore.loggedWallet);
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
</style>
