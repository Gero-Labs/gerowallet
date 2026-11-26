<template>
  <!-- Placeholder: each tab gets its own screen in a later change. -->
  <section class="glass-panel">
    <EmptyState :icon="TAB_EMPTY[tab].icon" :message="$t(TAB_EMPTY[tab].messageKey)" />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import { gerovaultTabOf, type GerovaultTab } from '@/modules/gerovault/gerovaultRoutes';

defineOptions({ name: 'GerovaultTabPanel' });

const TAB_EMPTY: Readonly<Record<GerovaultTab, { icon: string; messageKey: string }>> = {
  proposals: { icon: 'mdi-file-sign', messageKey: 'gerovault.tabEmpty.proposals' },
  policy: { icon: 'mdi-account-group-outline', messageKey: 'gerovault.tabEmpty.policy' },
  history: { icon: 'mdi-history', messageKey: 'gerovault.tabEmpty.history' },
  settings: { icon: 'mdi-cog-outline', messageKey: 'gerovault.tabEmpty.settings' },
};

const route = useRoute();
const tab = computed<GerovaultTab>(() => gerovaultTabOf(typeof route.name === 'string' ? route.name : null) ?? 'proposals');
</script>
