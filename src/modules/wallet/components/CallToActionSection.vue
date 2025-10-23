<template>
  <section class="call-to-action-section">
    <h2 class="cta-heading">{{ $t('wallet.spendCryptoAnywhere') }}</h2>
    <p class="cta-description">{{ $t('wallet.digitalAssetsSwipeReady') }}</p>
    <GradientButton v-if="kycStatus === 'approved'" :text="$t('wallet.orderYourCardToday')" @click="handleOrderCard" />

    <GradientButton v-else :text="$t('wallet.startKYC')" @click="startKYC" />

    <OrderCardModal :open="showModal" @close="showModal = false" />
  </section>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import GradientButton from './GradientButton.vue';
import OrderCardModal from './OrderCardModal.vue';
import { ref, computed } from 'vue';
import cardStore from '@/stores/modules/card';

const { t } = useTranslation();
const showModal = ref(false);

const kycStatus = computed(() => cardStore.state.walletStatus.kycStatus);

const handleOrderCard = async () => {
  await cardStore.orderCard();
  await cardStore.fetchCardData();
};

const startKYC = () => {
  cardStore.fetchKYCLink();
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
