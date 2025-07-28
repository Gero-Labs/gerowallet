<template>
  <div class="feature-list-item">
    <div class="feature-icon">
      <img src="@/modules/wallet/icons/check.svg" alt="check" />
    </div>
    <span class="feature-text">{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
interface Props {
  text: string;
  icon?: string;
}

defineProps<Props>();
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.feature-list-item {
  display: flex;
  align-items: center;
  gap: $spacing-md;

  .feature-icon {
    @include flex-center;
    flex-shrink: 0;
  }

  .feature-text {
    @include body-text($font-size-base);
  }
}
</style>
