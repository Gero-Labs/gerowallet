<template>
  <div class="block">
    <HeroSection />
    <CallToActionSection />
    <CardManagementSection />
    <FeatureGridSection />
  </div>
</template>

<script setup lang="ts">
import HeroSection from '@/modules/wallet/components/HeroSection.vue';
import CallToActionSection from '@/modules/wallet/components/CallToActionSection.vue';
import CardManagementSection from '@/modules/wallet/components/CardManagementSection.vue';
import FeatureGridSection from '@/modules/wallet/components/FeatureGridSection.vue';
</script>

<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: 32px;
}
</style>
