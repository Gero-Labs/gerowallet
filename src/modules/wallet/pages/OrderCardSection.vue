<template>
  <div class="block">
    <CallToActionSection />
    <FeatureGridSection />
    <KaiserexPartnershipSection />
  </div>
</template>

<script setup lang="ts">
import CallToActionSection from '@/modules/wallet/components/CallToActionSection.vue';
import FeatureGridSection from '@/modules/wallet/components/FeatureGridSection.vue';
import KaiserexPartnershipSection from '@/modules/wallet/components/KaiserexPartnershipSection.vue';
</script>
<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
</style>
