<template>
  <div class="gerovault-spend">
    <header class="gerovault-spend__header">
      <GButton tier="tertiary" compact :to="{ name: GEROVAULT_VAULT_ROUTE, params: { vaultId } }">
        <v-icon size="small" start aria-hidden="true">mdi-chevron-left</v-icon>{{ $t('common.back') }}
      </GButton>
      <h1 class="t-title">{{ $t('gerovault.spend.title') }}</h1>
    </header>

    <!-- Placeholder: the spend screen (build, then save the unsigned bundle) arrives in its own change. -->
    <section class="glass-panel">
      <EmptyState icon="mdi-bank-transfer-out" :message="$t('gerovault.spend.unavailable')" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import { GEROVAULT_VAULT_ROUTE } from '@/modules/gerovault/gerovaultRoutes';

defineOptions({ name: 'GerovaultSpend' });

const route = useRoute();
const vaultId = computed(() => String(route.params['vaultId'] ?? ''));
</script>

<style scoped>
.gerovault-spend {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.gerovault-spend__header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
}
.gerovault-spend__header h1 {
  margin: 0;
}
</style>
