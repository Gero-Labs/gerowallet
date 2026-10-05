<template>
  <div class="card-verify">
    <CardJourney :current="1" />
    <CallToActionSection />
    <FeatureGridSection />
    <KaiserexPartnershipSection />
  </div>
</template>

<script setup lang="ts">
import CallToActionSection from '@/modules/wallet/components/CallToActionSection.vue';
import FeatureGridSection from '@/modules/wallet/components/FeatureGridSection.vue';
import KaiserexPartnershipSection from '@/modules/wallet/components/KaiserexPartnershipSection.vue';
import CardJourney from '@/modules/wallet/components/ui/CardJourney.vue';
</script>

<style scoped>
.card-verify {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-6);
  width: 100%;
  max-width: var(--g-content-max);
  margin: 0 auto;
  padding: var(--g-s-5) clamp(16px, 3vw, 32px) var(--g-s-6);
}
</style>
