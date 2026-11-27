<template>
  <div class="gerovault-vault">
    <header class="gerovault-vault__header">
      <div class="gerovault-vault__title">
        <GButton tier="tertiary" compact :to="{ name: GEROVAULT_OVERVIEW_ROUTE }">
          <v-icon size="small" start aria-hidden="true">mdi-chevron-left</v-icon>{{ $t('gerovault.backToVaults') }}
        </GButton>
        <h1 class="t-title">{{ $t('gerovault.vault.title') }}</h1>
        <!-- Technical layer: the vault's identifier as the route names it. -->
        <p v-if="detailsVisible" class="t-caption gerovault-vault__id">
          {{ $t('gerovault.vault.id') }} <span class="g-mono">{{ vaultId }}</span>
        </p>
      </div>
      <DetailsToggle v-model="detailsOn" :peeking="peeking" />
    </header>

    <v-tabs
      :model-value="activeTab"
      :aria-label="$t('gerovault.tabs.label')"
      bg-color="transparent"
      color="primary"
      density="compact"
    >
      <v-tab
        v-for="tab in GEROVAULT_TABS"
        :key="tab"
        :value="tab"
        :to="{ name: GEROVAULT_TAB_ROUTES[tab], params: { vaultId } }"
      >
        {{ $t(TAB_LABEL_KEYS[tab]) }}
      </v-tab>
    </v-tabs>

    <router-view />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import DetailsToggle from '@/shared/components/DetailsToggle.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useDetailsLayer } from '@/shared/composables/useDetailsLayer';
import {
  GEROVAULT_OVERVIEW_ROUTE,
  GEROVAULT_TAB_ROUTES,
  GEROVAULT_TABS,
  gerovaultTabOf,
  type GerovaultTab,
} from '@/modules/gerovault/gerovaultRoutes';

defineOptions({ name: 'GerovaultVault' });

const TAB_LABEL_KEYS: Readonly<Record<GerovaultTab, string>> = {
  proposals: 'gerovault.tabs.proposals',
  policy: 'gerovault.tabs.policy',
  history: 'gerovault.tabs.history',
  settings: 'common.settings',
};

const route = useRoute();

const vaultId = computed(() => String(route.params['vaultId'] ?? ''));
const activeTab = computed(() => gerovaultTabOf(typeof route.name === 'string' ? route.name : null));

const { enabled: detailsOn, peeking, visible: detailsVisible } = useDetailsLayer('gerovault.vault');
</script>

<style scoped>
.gerovault-vault {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.gerovault-vault__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-4);
}
.gerovault-vault__title {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
  min-width: 0;
}
.gerovault-vault__title h1 {
  margin: 0;
}
.gerovault-vault__id {
  margin: 0;
  color: var(--g-text-3);
  overflow-wrap: anywhere;
}
</style>
