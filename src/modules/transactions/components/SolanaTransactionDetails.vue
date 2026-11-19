<template>
  <!-- The Solana counterpart of BitcoinTransactionDetails.vue (shared styles in
       _tx-details.scss). Gero Sync's history carries no amounts or direction yet,
       so the pane shows what it has and sends the transfers to Solscan. -->
  <div class="tx-details">
    <header class="tx-hero">
      <div class="tx-hero__head">
        <TxGlyph :icon="TX_KIND_ICON[kind]" :tone="TX_KIND_TONE[kind]" />
        <div class="tx-hero__heading">
          <div class="tx-hero__title-row">
            <span class="tx-hero__title">{{ $t('transactions.transaction') }}</span>
          </div>
          <span class="t-caption">{{ when }}</span>
        </div>
        <div class="tx-hero__actions">
          <GButton
            v-if="transactionUrl"
            tier="secondary"
            compact
            :href="transactionUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <v-icon size="small" start>mdi-open-in-new</v-icon>
            {{ $t('miniGero.viewOnExplorer') }}
          </GButton>
        </div>
      </div>

      <div class="tx-hero__value">
        <span class="t-caption">{{ $t('solana.detailsOnExplorer') }}</span>
        <span :class="['tx-status', `tx-status--${status}`]">
          <v-icon size="x-small">{{ statusIcon }}</v-icon>
          {{ statusLabel }}
        </span>
      </div>

      <dl class="tx-facts">
        <div class="tx-fact tx-fact--wide">
          <dt class="t-label">{{ $t('transactions.transactionId') }}</dt>
          <dd>
            <a v-if="transactionUrl" class="g-mono tx-fact__link" :href="transactionUrl" target="_blank" rel="noopener noreferrer">
              {{ filters.truncate(transactionInfo.signature) }}
            </a>
            <span v-else class="g-mono">{{ filters.truncate(transactionInfo.signature) }}</span>
            <CopyButton x-small :value="transactionInfo.signature" />
          </dd>
        </div>
        <div class="tx-fact">
          <dt class="t-label">{{ $t('poolOperator.slot') }}</dt>
          <dd class="g-num">{{ formatInt(transactionInfo.slot) }}</dd>
        </div>
        <div v-if="transactionInfo.fee !== undefined" class="tx-fact">
          <dt class="t-label">{{ $t('signTx.networkFee') }}</dt>
          <dd class="g-num">{{ formatSol(transactionInfo.fee) }} {{ ticker }}</dd>
        </div>
      </dl>
    </header>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import TxGlyph from '@/modules/transactions/components/TxGlyph.vue';
import filters from '@/shared/utils/filters';
import time from '@/plugins/time';
import networks from '@/utils/networks';
import { walletStore } from '@/stores/walletStore';
import { formatInt } from '@/shared/utils/format';
import { formatSol } from '@/chains/solana/solanaAmount';
import { solscanUrl } from '@/chains/solana/solanaExplorer';
import { useTranslation } from '@/shared/composables/useTranslation';
import { TX_KIND_ICON, TX_KIND_TONE, type TxKind } from '@/modules/dashboard/utils/transactionClassifier';
import { isConfirmedSolanaTx, type SolanaHistoryRow } from '@/chains/solana/solanaHistory';

const props = defineProps<{ transactionInfo: SolanaHistoryRow }>();

const { t } = useTranslation();

const network = computed(() => walletStore.loggedWallet?.network ?? '');
const ticker = computed(() => networks.resolveCurrencyTicker(walletStore.loggedWallet?.chain, network.value));

const confirmed = computed(() => isConfirmedSolanaTx(props.transactionInfo));
const kind = computed<TxKind>(() => {
  if (!props.transactionInfo.success) return 'failed';
  return confirmed.value ? 'neutral' : 'pending';
});

const when = computed(() => {
  if (!confirmed.value) return t('solana.pending');
  // Landed, but Nexus had no block time for it: the slot below dates it.
  if (!props.transactionInfo.blockTime) return t('transactions.confirmed');
  const date = new Date(props.transactionInfo.blockTime * 1000);
  return `${date.toLocaleString()} · ${time.format(date)}`;
});

const status = computed<'confirmed' | 'pending' | 'failed'>(() => {
  if (!props.transactionInfo.success) return 'failed';
  return confirmed.value ? 'confirmed' : 'pending';
});
const statusIcon = computed(() => ({
  confirmed: 'mdi-check-circle-outline',
  pending: 'mdi-clock-outline',
  failed: 'mdi-alert-circle-outline',
}[status.value]));
const statusLabel = computed(() => ({
  confirmed: t('transactions.confirmed'),
  pending: t('solana.pending'),
  failed: t('transactions.failed'),
}[status.value]));

const transactionUrl = computed(() => solscanUrl('tx', props.transactionInfo.signature, network.value) || null);
</script>

<style scoped lang="scss">
@import '@/shared/styles/tx-details';
</style>
