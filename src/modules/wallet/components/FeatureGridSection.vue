<template>
  <section class="feature-grid-section">
    <div class="feature-grid">
      <FeatureCard
        v-for="feature in features"
        :key="feature.title"
        :icon="feature.icon"
        :title="feature.title"
        :description="feature.description"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import FeatureCard from './FeatureCard.vue';
import type { FeatureCardProps } from '@/models/types';


const { t } = useTranslation();

const features: FeatureCardProps[] = [
  {
    icon: 'conversion',
    title: t('card.realTimeConversion'),
    description: t('card.realTimeConversionDesc'),
  },
  {
    icon: 'global',
    title: t('card.globalAcceptance'),
    description: t('card.globalAcceptanceDesc'),
  },
  {
    icon: 'track',
    title: t('card.trackManageEasily'),
    description: t('card.trackManageEasilyDesc'),
  },
];
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: $spacing-2xl;
  padding: $spacing-3xl;

  @include mobile {
    grid-template-columns: 1fr;
    gap: $spacing-xl;
  }
}

.bottom-cta {
  display: flex;
  justify-content: center;
  padding: $spacing-3xl;
}
</style>
