<template>
  <div class="gerovault-create">
    <header class="gerovault-create__header">
      <GButton tier="tertiary" compact :to="{ name: GEROVAULT_OVERVIEW_ROUTE }">
        <v-icon size="small" start aria-hidden="true">mdi-chevron-left</v-icon>{{ $t('common.back') }}
      </GButton>
      <h1 class="t-title">{{ $t('gerovault.createVault') }}</h1>
    </header>

    <!-- Placeholder: the create flow arrives in its own change. -->
    <section class="glass-panel">
      <EmptyState icon="mdi-shield-plus-outline" :message="$t('gerovault.createUnavailable')" />
    </section>
  </div>
</template>

<script setup lang="ts">
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import { GEROVAULT_OVERVIEW_ROUTE } from '@/modules/gerovault/gerovaultRoutes';

defineOptions({ name: 'GerovaultCreate' });
</script>

<style scoped>
.gerovault-create {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.gerovault-create__header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
}
.gerovault-create__header h1 {
  margin: 0;
}
</style>
