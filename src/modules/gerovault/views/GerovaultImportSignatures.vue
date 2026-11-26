<template>
  <div class="gerovault-import-signatures">
    <header class="gerovault-import-signatures__header">
      <GButton tier="tertiary" compact :to="{ name: GEROVAULT_VAULT_ROUTE, params: { vaultId } }">
        <v-icon size="small" start aria-hidden="true">mdi-chevron-left</v-icon>{{ $t('common.back') }}
      </GButton>
      <h1 class="t-title">{{ $t('gerovault.spend.importSignatures.title') }}</h1>
    </header>

    <!-- Placeholder: loading witness files and submitting arrive in their own change. -->
    <section class="glass-panel">
      <EmptyState icon="mdi-file-sign" :message="$t('gerovault.spend.importSignatures.unavailable')" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import { GEROVAULT_VAULT_ROUTE } from '@/modules/gerovault/gerovaultRoutes';

defineOptions({ name: 'GerovaultImportSignatures' });

const route = useRoute();
const vaultId = computed(() => String(route.params['vaultId'] ?? ''));
</script>

<style scoped>
.gerovault-import-signatures {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.gerovault-import-signatures__header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
}
.gerovault-import-signatures__header h1 {
  margin: 0;
}
</style>
