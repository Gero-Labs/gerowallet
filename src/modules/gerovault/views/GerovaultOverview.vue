<template>
  <div class="gerovault-page">
    <header class="gerovault-page__header">
      <div class="gerovault-page__title">
        <h1 class="t-title">{{ $t('gerovault.title') }}</h1>
        <InfoTooltip :label="$t('gerovault.about.label')" :text="$t('gerovault.about.text')" />
      </div>
      <div class="gerovault-page__actions">
        <DetailsToggle v-model="detailsOn" :peeking="peeking" />
        <!-- Placeholders: importing and creating arrive with their own screens. -->
        <GButton tier="secondary" disabled>{{ $t('gerovault.importPackage') }}</GButton>
        <GButton tier="primary" disabled>{{ $t('gerovault.createVault') }}</GButton>
      </div>
    </header>

    <section class="glass-panel">
      <EmptyState icon="mdi-shield-lock-outline" :message="$t('gerovault.overview.empty')" />
    </section>
  </div>
</template>

<script setup lang="ts">
import DetailsToggle from '@/shared/components/DetailsToggle.vue';
import InfoTooltip from '@/shared/components/InfoTooltip.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import { useDetailsLayer } from '@/shared/composables/useDetailsLayer';

defineOptions({ name: 'GerovaultOverview' });

// No technical layer to show yet; the toggle is wired so the real overview only fills it.
const { enabled: detailsOn, peeking } = useDetailsLayer('gerovault.overview');
</script>

<style scoped>
.gerovault-page {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.gerovault-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-4);
}
.gerovault-page__title {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  min-width: 0;
}
.gerovault-page__title h1 {
  margin: 0;
}
.gerovault-page__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-3);
}
</style>
