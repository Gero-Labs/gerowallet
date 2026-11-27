<template>
  <div class="gerovault-vault">
    <header class="gerovault-vault__header">
      <div class="gerovault-vault__title">
        <GButton tier="tertiary" compact :to="{ name: GEROVAULT_OVERVIEW_ROUTE }">
          <v-icon size="small" start aria-hidden="true">mdi-chevron-left</v-icon>{{ $t('gerovault.backToVaults') }}
        </GButton>
        <div class="gerovault-vault__name">
          <h1 class="t-title" data-test="vault-name">{{ record?.name ? displayLabel(record.name) : $t('gerovault.vault.title') }}</h1>
          <template v-if="record && facts">
            <v-chip size="small" variant="outlined" data-test="vault-kind">{{ $t('gerovault.detail.kindNative') }}</v-chip>
            <v-chip size="small" variant="outlined" class="g-num" data-test="vault-threshold-chip">
              {{ $t('gerovault.detail.thresholdChip', { threshold: facts.template.threshold, owners: facts.template.ownerCount }) }}
            </v-chip>
            <v-chip v-if="record.status === 'candidate'" size="small" variant="outlined" color="var(--g-warning)" data-test="vault-candidate-chip">
              {{ $t('gerovault.detail.candidate.chip') }}
            </v-chip>
          </template>
        </div>
        <!-- Technical layer: the vault's identifier as the route names it. -->
        <p v-if="detailsVisible" class="t-caption gerovault-vault__id">
          {{ $t('gerovault.vault.id') }} <span class="g-mono">{{ vaultId }}</span>
        </p>
      </div>
      <div class="gerovault-vault__actions">
        <DetailsToggle v-model="detailsOn" :peeking="peeking" />
        <GButton
          v-if="record && facts && record.status === 'accepted'"
          tier="primary"
          :to="{ name: GEROVAULT_SPEND_ROUTE, params: { vaultId } }"
          data-test="vault-spend"
        >
          <v-icon size="small" start aria-hidden="true">mdi-bank-transfer-out</v-icon>{{ $t('gerovault.detail.spend') }}
        </GButton>
      </div>
    </header>

    <div v-if="state === 'loading'" class="g-skeleton gerovault-vault__skeleton" role="status" :aria-label="$t('common.loading')"></div>
    <section v-else-if="state === 'noWallet'" class="glass-panel">
      <EmptyState icon="mdi-wallet-outline" :message="$t('gerovault.detail.noWallet')" />
    </section>
    <section v-else-if="state === 'notFound'" class="glass-panel" data-test="vault-not-found">
      <EmptyState icon="mdi-shield-off-outline" :message="$t('gerovault.detail.notFound')" />
    </section>
    <section v-else-if="state === 'unavailable'" class="glass-panel" data-test="vault-unavailable">
      <ErrorState :message="$t('gerovault.detail.storeUnavailable')" retryable @retry="reload()" />
    </section>
    <section v-else-if="record && !facts" class="glass-panel" data-test="vault-unreadable">
      <ErrorState :message="$t('gerovault.detail.unreadable')" />
    </section>

    <template v-else-if="record && facts">
      <!-- A quarantined vault: shown for review, never funded from this wallet, never signed for. -->
      <section v-if="record.status === 'candidate'" class="glass-panel gerovault-vault__candidate" data-test="vault-candidate">
        <p class="t-body-sm">{{ $t(candidateTextKey) }}</p>
        <CandidateAcceptPanel v-if="record.origin !== 'created'" v-model:agreed="agreed" :busy="accepting" @accept="accept()" />
        <GNote v-if="acceptFailed" tone="error" role="alert">{{ $t('gerovault.detail.candidate.acceptFailed') }}</GNote>
      </section>

      <GNote v-if="funding && funding.verified === false" icon="mdi-cash-lock" role="status" data-test="vault-funding-blocked">
        <strong>{{ $t('gerovault.detail.funding.title') }}</strong>
        {{ $t(`gerovault.detail.funding.${funding.reason}`) }}
      </GNote>

      <div class="gerovault-vault__summary">
        <VaultBalancePanel
          :state="chain.balanceState.value"
          :balance="chain.balance.value"
          :details-visible="detailsVisible"
          @retry="chain.refresh()"
        />
        <VaultAddressPanel :address="facts.addresses.base" />
      </div>

      <!-- cNIGHT held by the vault and DUST generation for its stake credential. -->
      <VaultDustPanel v-if="record.status === 'accepted'" :record="record" :utxos="chain.utxos.value" />

      <VaultTechnicalPanel v-if="detailsVisible" :record="record" :facts="facts" />
    </template>

    <template v-if="record && facts">
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import DetailsToggle from '@/shared/components/DetailsToggle.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import { useDetailsLayer } from '@/shared/composables/useDetailsLayer';
import { displayLabel } from '@/shared/gerovault';
import {
  GEROVAULT_OVERVIEW_ROUTE,
  GEROVAULT_SPEND_ROUTE,
  GEROVAULT_TAB_ROUTES,
  GEROVAULT_TABS,
  gerovaultTabOf,
  type GerovaultTab,
} from '@/modules/gerovault/gerovaultRoutes';
import { useGerovaultStore } from '@/modules/gerovault/detail/context';
import { provideVaultView } from '@/modules/gerovault/detail/vaultView';
import CandidateAcceptPanel from '@/modules/gerovault/detail/components/CandidateAcceptPanel.vue';
import VaultAddressPanel from '@/modules/gerovault/detail/components/VaultAddressPanel.vue';
import VaultBalancePanel from '@/modules/gerovault/detail/components/VaultBalancePanel.vue';
import VaultTechnicalPanel from '@/modules/gerovault/detail/components/VaultTechnicalPanel.vue';
import VaultDustPanel from '@/modules/gerovault/dust/components/VaultDustPanel.vue';

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

const store = useGerovaultStore();
const { state, record, facts, funding, chain, reload, replace, walletId } = provideVaultView(vaultId);

const candidateTextKey = computed(() => {
  switch (record.value?.origin) {
    case 'restored':
      return 'gerovault.detail.candidate.restored';
    case 'imported':
      return 'gerovault.detail.candidate.imported';
    default:
      return 'gerovault.detail.candidate.created';
  }
});

// Accepting needs the user's explicit statement that they agreed to join this vault.
const agreed = ref(false);
const accepting = ref(false);
const acceptFailed = ref(false);
watch(vaultId, () => {
  agreed.value = false;
  acceptFailed.value = false;
});

async function accept(): Promise<void> {
  const row = record.value;
  const wallet = walletId.value;
  if (!row || wallet === undefined || !agreed.value || accepting.value) return;
  accepting.value = true;
  acceptFailed.value = false;
  try {
    replace(await store.accept(wallet, row.vaultId));
    agreed.value = false;
  } catch {
    acceptFailed.value = true;
  } finally {
    accepting.value = false;
  }
}
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
.gerovault-vault__name {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-2);
  min-width: 0;
}
.gerovault-vault__name h1 {
  margin: 0;
  overflow-wrap: anywhere;
}
.gerovault-vault__id {
  margin: 0;
  color: var(--g-text-3);
  overflow-wrap: anywhere;
}
.gerovault-vault__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-3);
}
.gerovault-vault__skeleton {
  height: calc(var(--g-row-h-panel) * 3);
}
.gerovault-vault__candidate {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
}
.gerovault-vault__candidate p {
  margin: 0;
}
.gerovault-vault__summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--g-s-4);
}
</style>
