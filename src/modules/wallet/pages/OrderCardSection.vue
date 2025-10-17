<template>
  <div class="block">
    <div>
      <img src="@/modules/wallet/icons/cardBanner.svg" alt="card-banner" class="card-banner" />
    </div>
    <CallToActionSection />
    <CardManagementSection />
    <FeatureGridSection />
  </div>
</template>

<script setup lang="ts">
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
