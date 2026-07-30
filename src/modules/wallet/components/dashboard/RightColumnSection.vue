<template>
  <div class="right-column">
    <RecentActivitiesSection />
  </div>
</template>

<script setup lang="ts">
import RecentActivitiesSection from './RecentActivitiesSection.vue';
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