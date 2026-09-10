<template>
  <section class="route-page-state" :aria-busy="!failed" data-testid="route-page-state">
    <h1 class="t-display">{{ $t(titleKey) }}</h1>
    <div v-if="failed" role="alert">
      <ErrorState :message="$t('navigation.pageLoadFailed')" retryable :retry-label="$t('navigation.reloadPage')" @retry="$emit('reload')" />
    </div>
    <template v-else>
      <p class="t-body" role="status" aria-live="polite">{{ $t('common.loadingEllipsis') }}</p>
      <div aria-hidden="true">
        <v-skeleton-loader type="heading, paragraph, image" />
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
defineProps<{ titleKey: string; failed: boolean }>();
defineEmits<{ (event: 'reload'): void }>();
</script>

<style scoped>
.route-page-state {
  padding: var(--g-s-5);
}
.route-page-state h1 {
  margin-bottom: var(--g-s-4);
}
@media (prefers-reduced-motion: reduce) {
  .route-page-state ::v-deep .v-skeleton-loader__bone::after {
    animation: none;
  }
}
</style>
