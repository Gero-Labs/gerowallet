<template>
  <div class="feature-card">
    <div class="feature-icon">
      <img src="@/modules/wallet/icons/global.svg" alt="global" v-if="icon === 'global'" />

      <img src="@/modules/wallet/icons/conversion.svg" alt="conversion" v-if="icon === 'conversion'" />

      <img src="@/modules/wallet/icons/track.svg" alt="track" v-if="icon === 'track'" />
    </div>
    <div class="feature-card-content">
      <h4 class="feature-title">{{ title }}</h4>
      <p class="feature-description">{{ description }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  icon: 'conversion' | 'global' | 'track';
  title: string;
  description: string;
}

defineProps<Props>();
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.feature-card {
  padding: $spacing-2xl;
  @include flex-column;
  gap: $spacing-3xl;
  text-align: center;
  transition: transform var(--g-dur-slow) ease, box-shadow var(--g-dur-slow) ease;

  &:hover {
    transform: translateY(-4px);
    box-shadow: $shadow-lg;
  }

  .feature-icon {
    margin: 0 auto;
    width: 48px;
    height: 48px;
    border-radius: $border-radius-md;
    padding: $spacing-md;
    @include flex-center;
    border: 1px solid $border-primary;
    background: $background-dark;
    box-shadow: $shadow-button;
  }

  .feature-card-content {
    @include flex-column;
    gap: $spacing-sm;
  }

  .feature-title {
    @include text-style($font-size-xl, $font-weight-semibold, $line-height-tight);
  }

  .feature-description {
    @include body-text($font-size-base);
  }
}
</style>
