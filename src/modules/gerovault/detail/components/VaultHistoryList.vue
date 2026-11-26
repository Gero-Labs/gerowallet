<template>
  <section class="vault-history glass-panel" data-test="vault-history" :aria-busy="state === 'loading' ? 'true' : 'false'">
    <div class="vault-history__head">
      <h2 class="t-heading">{{ $t('gerovault.tabs.history') }}</h2>
      <InfoTooltip :label="$t('gerovault.detail.history.aboutLabel')" :text="$t('gerovault.detail.history.about')" />
    </div>

    <div v-if="state === 'loading' || state === 'idle'" class="g-skeleton vault-history__skeleton" role="status" :aria-label="$t('common.loading')"></div>
    <p v-else-if="state === 'unavailable'" class="t-body-sm">{{ $t('gerovault.detail.chainUnavailable') }}</p>
    <ErrorState v-else-if="state === 'error'" :message="$t('gerovault.detail.history.failed')" retryable @retry="$emit('retry')" />
    <EmptyState v-else-if="entries.length === 0" icon="mdi-history" :message="$t('gerovault.tabEmpty.history')" />
    <template v-else>
      <ul class="vault-history__list" data-test="vault-history-list">
        <li v-for="entry in entries" :key="entry.txHash" class="vault-history__row" data-test="vault-history-row">
          <div class="vault-history__when">
            <span class="t-body-sm g-num">{{ entry.blockTime !== null ? formatTime(entry.blockTime) : $t('gerovault.detail.history.pending') }}</span>
            <span v-if="entry.blockHeight !== null" class="t-caption g-num">{{ $t('gerovault.detail.history.block', { height: entry.blockHeight.toLocaleString('en-US') }) }}</span>
          </div>
          <div class="vault-history__tx">
            <ChunkedValue :value="entry.txHash" copy :copy-label="$t('gerovault.detail.history.copyTx')" />
            <ExplorerLink type="tx" :id="entry.txHash" x-small :network="explorerNetwork" />
          </div>
        </li>
      </ul>
      <GButton v-if="more" tier="secondary" compact :loading="loadingMore" data-test="vault-history-more" @click="$emit('more')">
        {{ $t('gerovault.detail.history.more') }}
      </GButton>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import InfoTooltip from '@/shared/components/InfoTooltip.vue';
import ExplorerLink from '@/shared/components/ExplorerLink.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import type { VaultHistoryEntry } from '@/modules/gerovault/contracts';
import type { VaultNetwork } from '@/shared/gerovault';
import type { ChainReadState } from '@/modules/gerovault/detail/useVaultChain';
import ChunkedValue from './ChunkedValue.vue';

defineOptions({ name: 'VaultHistoryList' });

const props = defineProps<{
  state: ChainReadState;
  entries: readonly VaultHistoryEntry[];
  more: boolean;
  loadingMore: boolean;
  network: VaultNetwork;
}>();
defineEmits<{ (e: 'retry'): void; (e: 'more'): void }>();

/** The explorer names networks as the wallet record does ('Preprod'). */
const explorerNetwork = computed(() => props.network.charAt(0).toUpperCase() + props.network.slice(1));

const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function formatTime(unixSeconds: number): string {
  return formatter.format(new Date(unixSeconds * 1000));
}
</script>

<style scoped>
.vault-history {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
}
.vault-history__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
}
.vault-history__head h2,
.vault-history p {
  margin: 0;
}
.vault-history__skeleton {
  height: var(--g-row-h-panel);
}
.vault-history__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.vault-history__row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) 3fr;
  gap: var(--g-s-3);
  padding: var(--g-s-3) 0;
  border-top: 1px solid var(--g-hairline-1);
}
.vault-history__when {
  display: flex;
  flex-direction: column;
}
.vault-history__tx {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-1);
  min-width: 0;
}
@media (max-width: 600px) {
  .vault-history__row {
    grid-template-columns: 1fr;
  }
}
</style>
