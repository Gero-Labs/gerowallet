<template>
  <router-link
    :to="{ name: GEROVAULT_TAB_ROUTES.proposals, params: { vaultId: record.vaultId } }"
    class="vault-card glass-panel"
    :class="{ 'vault-card--candidate': record.status === 'candidate' }"
    data-test="vault-card"
  >
    <div class="vault-card__who">
      <div class="vault-card__name">
        <span class="t-body-lg" data-test="vault-card-name">{{ record.name ? displayLabel(record.name) : $t('gerovault.detail.overview.unnamed') }}</span>
        <v-chip size="x-small" variant="outlined">{{ $t('gerovault.detail.kindNative') }}</v-chip>
        <v-chip v-if="facts" size="x-small" variant="outlined" class="g-num">
          {{ $t('gerovault.detail.thresholdChip', { threshold: facts.template.threshold, owners: facts.template.ownerCount }) }}
        </v-chip>
        <v-chip v-if="record.status === 'candidate'" size="x-small" variant="outlined" color="var(--g-warning)" data-test="vault-card-candidate">
          {{ $t('gerovault.detail.candidate.chip') }}
        </v-chip>
        <v-chip v-if="otherNetwork" size="x-small" variant="outlined">{{ record.network }}</v-chip>
      </div>
      <span v-if="detailsVisible && facts" class="t-caption vault-card__address">
        <ChunkedValue :value="facts.addresses.base" bech32 />
      </span>
      <span v-if="record.status === 'candidate'" class="t-caption">{{ $t(originKey) }}</span>
    </div>

    <div v-if="record.status === 'accepted'" class="vault-card__balance">
      <span class="t-label">{{ $t('gerovault.detail.balance.title') }}</span>
      <span v-if="chain.balanceState.value === 'ready' && chain.balance.value" class="t-heading g-num" data-test="vault-card-balance">
        {{ $t('gerovault.detail.balance.ada', { amount: formatLovelaceAsAda(chain.balance.value.lovelace) }) }}
      </span>
      <span v-else-if="chain.balanceState.value === 'loading'" class="g-skeleton vault-card__skeleton" role="status" :aria-label="$t('common.loading')"></span>
      <span v-else class="t-caption">{{ $t('gerovault.detail.balance.unknown') }}</span>
      <span v-if="chain.balance.value && chain.balance.value.assets.length > 0" class="t-caption">
        {{ $t('gerovault.detail.overview.assets', { count: chain.balance.value.assets.length }) }}
      </span>
    </div>

    <v-icon class="vault-card__chevron" aria-hidden="true">mdi-chevron-right</v-icon>
  </router-link>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { displayLabel } from '@/shared/gerovault';
import { formatLovelaceAsAda } from '@/shared/utils/format';
import type { VaultRecord } from '@/modules/gerovault/contracts';
import { GEROVAULT_TAB_ROUTES } from '@/modules/gerovault/gerovaultRoutes';
import { useVaultChain, type VaultChainTarget } from '@/modules/gerovault/detail/useVaultChain';
import { vaultFacts } from '@/modules/gerovault/detail/vaultFacts';
import ChunkedValue from './ChunkedValue.vue';

defineOptions({ name: 'VaultListCard' });

const props = defineProps<{ record: VaultRecord; walletNetwork: string | undefined; detailsVisible: boolean }>();

const facts = computed(() => vaultFacts(props.record));
const otherNetwork = computed(() => props.walletNetwork !== undefined && props.walletNetwork !== props.record.network);
// A candidate's balance is not read: nothing about it is the user's until accepted.
const target = computed<VaultChainTarget | undefined>(() =>
  props.record.status === 'accepted' && facts.value ? { network: props.record.network, address: facts.value.addresses.base } : undefined);
const chain = useVaultChain(target, { history: false });

const originKey = computed(() => {
  switch (props.record.origin) {
    case 'restored':
      return 'gerovault.detail.overview.originRestored';
    case 'imported':
      return 'gerovault.detail.overview.originImported';
    default:
      return 'gerovault.detail.overview.originCreated';
  }
});
</script>

<style scoped>
.vault-card {
  display: flex;
  align-items: center;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-1);
  color: inherit;
  text-decoration: none;
}
.vault-card:hover {
  border-color: var(--g-hairline-3);
}
.vault-card--candidate {
  border-style: dashed;
  border-color: var(--g-hairline-2);
}
.vault-card__who {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  flex: 1 1 auto;
  min-width: 0;
}
.vault-card__name {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-2);
  min-width: 0;
}
.vault-card__address {
  overflow-wrap: anywhere;
}
.vault-card__balance {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--g-s-1);
  text-align: right;
}
.vault-card__skeleton {
  display: block;
  width: 120px;
  height: var(--g-s-5);
}
.vault-card__chevron {
  color: var(--g-text-3);
  flex: none;
}
@media (max-width: 600px) {
  .vault-card {
    flex-wrap: wrap;
  }
  .vault-card__balance {
    align-items: flex-start;
    text-align: left;
  }
}
</style>
