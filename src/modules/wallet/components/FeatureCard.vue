<template>
  <article class="feature-card glass-tier">
    <IsoScene :name="SCENES[icon]" class="feature-card__art" />
    <h3 class="t-body-lg">{{ title }}</h3>
    <p class="t-body-sm">{{ description }}</p>
  </article>
</template>

<script setup lang="ts">
import type { FeatureCardProps } from '@/models/types';
import type { IsoSceneName } from '@/shared/components/iso/isoScenes';
import IsoScene from '@/shared/components/iso/IsoScene.vue';

// Vue 2.7 cannot take an imported type as the whole props type, so it is spelled out here.
defineProps<{
  icon: FeatureCardProps['icon'];
  title: string;
  description: string;
}>();

const SCENES: Record<FeatureCardProps['icon'], IsoSceneName> = {
  conversion: 'payment',
  global: 'virtual',
  track: 'pin',
};
</script>

<style lang="scss" scoped>
.feature-card {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-5);

  h3,
  p {
    margin: 0;
  }
}

.feature-card__art {
  width: 140px;
}
</style>
