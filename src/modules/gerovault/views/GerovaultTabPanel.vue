<template>
  <!-- Owners & policy: who holds a key, how many must sign, and what this device checked. -->
  <VaultPolicyPanel
    v-if="tab === 'policy' && record && facts"
    :record="record"
    :facts="facts"
    :checks="view?.checks.value ?? []"
    :details-visible="detailsVisible"
  />

  <!-- History: transactions that touched the vault address, from the chain reader. -->
  <VaultHistoryList
    v-else-if="tab === 'history' && record && view"
    :state="view.chain.historyState.value"
    :entries="view.chain.history.value"
    :more="view.chain.historyMore.value"
    :loading-more="view.chain.loadingMore.value"
    :network="record.network"
    @retry="view.chain.refresh()"
    @more="view.chain.loadMoreHistory()"
  />

  <!-- Settings: the recovery package. -->
  <RecoveryPackagePanel
    v-else-if="tab === 'settings' && record && walletId !== undefined"
    :record="record"
    :wallet-id="walletId"
  />

  <!-- Proposals arrive with signing by file; until then, and without a vault, an empty state. -->
  <section v-else class="glass-panel">
    <EmptyState :icon="TAB_EMPTY[tab].icon" :message="$t(TAB_EMPTY[tab].messageKey)" />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import { useDetailsLayer } from '@/shared/composables/useDetailsLayer';
import { gerovaultTabOf, type GerovaultTab } from '@/modules/gerovault/gerovaultRoutes';
import { useVaultView } from '@/modules/gerovault/detail/vaultView';
import VaultHistoryList from '@/modules/gerovault/detail/components/VaultHistoryList.vue';
import VaultPolicyPanel from '@/modules/gerovault/detail/components/VaultPolicyPanel.vue';
import RecoveryPackagePanel from '@/modules/gerovault/recovery/RecoveryPackagePanel.vue';

defineOptions({ name: 'GerovaultTabPanel' });

const TAB_EMPTY: Readonly<Record<GerovaultTab, { icon: string; messageKey: string }>> = {
  proposals: { icon: 'mdi-file-sign', messageKey: 'gerovault.tabEmpty.proposals' },
  policy: { icon: 'mdi-account-group-outline', messageKey: 'gerovault.tabEmpty.policy' },
  history: { icon: 'mdi-history', messageKey: 'gerovault.tabEmpty.history' },
  settings: { icon: 'mdi-cog-outline', messageKey: 'gerovault.tabEmpty.settings' },
};

const route = useRoute();
const tab = computed<GerovaultTab>(() => gerovaultTabOf(typeof route.name === 'string' ? route.name : null) ?? 'proposals');

// The vault shell loads the record and the chain once and provides them here.
const view = useVaultView();
const record = computed(() => view?.record.value);
const facts = computed(() => view?.facts.value);
const walletId = computed(() => view?.walletId.value);

// Same screen key as the shell, so one toggle drives both.
const { visible: detailsVisible } = useDetailsLayer('gerovault.vault');
</script>
