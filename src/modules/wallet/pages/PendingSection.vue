<template>
  <div class="block">
    <ApplicationStatusSection />
    <HeroSection />
    <CallToActionSection />
    <FeatureGridSection />
  </div>
</template>

<script setup lang="ts">
import ApplicationStatusSection from '@/modules/wallet/components/ApplicationStatusSection.vue';
import HeroSection from '@/modules/wallet/components/HeroSection.vue';
import CallToActionSection from '@/modules/wallet/components/CallToActionSection.vue';
import FeatureGridSection from '@/modules/wallet/components/FeatureGridSection.vue';
</script>

<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: 32px;
}
</style>
