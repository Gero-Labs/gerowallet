<template>
  <div class="right-column">
    <RecentActivitiesSection />
    <ExchangeRateSection />
  </div>
</template>

<script setup lang="ts">
import RecentActivitiesSection from './RecentActivitiesSection.vue';
import ExchangeRateSection from './ExchangeRateSection.vue';
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.right-column {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
  width: 357px;
}
</style> 