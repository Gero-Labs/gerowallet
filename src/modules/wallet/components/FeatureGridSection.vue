<template>
  <section class="feature-grid" :aria-label="t('card.geroCard')">
    <FeatureCard
      v-for="feature in features"
      :key="feature.icon"
      :icon="feature.icon"
      :title="feature.title"
      :description="feature.description"
      :animated="animated"
    />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { FeatureCardProps } from '@/models/types';
import FeatureCard from './FeatureCard.vue';

withDefaults(defineProps<{ animated?: boolean }>(), { animated: false });

const { t } = useTranslation();

const features = computed<FeatureCardProps[]>(() => [
  { icon: 'conversion', title: t('card.realTimeConversion'), description: t('card.realTimeConversionDesc') },
  { icon: 'global', title: t('card.globalAcceptance'), description: t('card.globalAcceptanceDesc') },
  { icon: 'track', title: t('card.trackManageEasily'), description: t('card.trackManageEasilyDesc') },
]);
</script>

<style lang="scss" scoped>
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  gap: var(--g-s-4);
}
</style>
