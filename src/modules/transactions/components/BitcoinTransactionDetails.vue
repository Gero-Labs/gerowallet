<template>
  <div class="tx-details">
    <!-- Hero: what happened, how much, and how final it is -->
    <header class="tx-hero">
      <div class="tx-hero__head">
        <TxGlyph :icon="kindIcon" :tone="kindTone" />
        <div class="tx-hero__heading">
          <div class="tx-hero__title-row">
            <span class="tx-hero__title">{{ title }}</span>
          </div>
          <span class="t-caption">{{ absoluteTime }} · {{ relativeTime }}</span>
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
        <div class="tx-hero__amount">
          <span v-if="verb" class="t-caption">{{ verb }}</span>
          <span :class="['t-display', 'g-num', 'tx-hero__amount-value', amountClass]">{{ heroAmount }}</span>
          <span class="t-caption g-num">{{ subLine }}</span>
        </div>
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
              {{ filters.truncate(tx.id) }}
            </a>
            <span v-else class="g-mono">{{ filters.truncate(tx.id) }}</span>
            <CopyButton x-small :value="tx.id" />
          </dd>
        </div>
        <div v-if="tx.block_height" class="tx-fact">
          <dt class="t-label">{{ $t('transactions.blockHeight') }}</dt>
          <dd class="g-num">{{ formatInt(tx.block_height) }}</dd>
        </div>
        <div v-if="tx.block_hash" class="tx-fact tx-fact--wide">
          <dt class="t-label">{{ $t('miniGero.block') }}</dt>
          <dd>
            <a v-if="blockUrl" class="g-mono tx-fact__link" :href="blockUrl" target="_blank" rel="noopener noreferrer">
              {{ filters.truncate(tx.block_hash) }}
            </a>
            <span v-else class="g-mono">{{ filters.truncate(tx.block_hash) }}</span>
            <CopyButton x-small :value="tx.block_hash" />
          </dd>
        </div>
        <div v-if="!tx.pending && tx.confirmations !== undefined" class="tx-fact">
          <dt class="t-label">{{ $t('bitcoin.confirmations') }}</dt>
          <dd class="g-num">{{ formatInt(tx.confirmations) }}</dd>
        </div>
        <div v-if="tx.fee !== undefined" class="tx-fact">
          <dt class="t-label">{{ $t('signTx.networkFee') }}</dt>
          <dd class="g-num">{{ $t('bitcoin.satsValue', { value: formatSats(tx.fee) }) }}</dd>
        </div>
        <div v-if="feeRate" class="tx-fact">
          <dt class="t-label">{{ $t('bitcoin.feeRate') }}</dt>
          <dd class="g-num">{{ $t('bitcoin.feeRateValue', { value: feeRate }) }}</dd>
        </div>
        <div v-if="tx.vsize" class="tx-fact">
          <dt class="t-label">{{ $t('bitcoin.virtualSize') }}</dt>
          <dd class="g-num">{{ $t('bitcoin.vbytesValue', { value: formatInt(tx.vsize) }) }}</dd>
        </div>
        <div v-if="tx.size" class="tx-fact">
          <dt class="t-label">{{ $t('mempool.size') }}</dt>
          <dd class="g-num">{{ filters.humanFileSize(tx.size) }}</dd>
        </div>
        <div v-if="tx.weight" class="tx-fact">
          <dt class="t-label">{{ $t('bitcoin.weight') }}</dt>
          <dd class="g-num">{{ $t('bitcoin.weightValue', { value: formatInt(tx.weight) }) }}</dd>
        </div>
        <div v-if="ioSummary" class="tx-fact">
          <dt class="t-label">{{ $t('bitcoin.inputs') }} → {{ $t('bitcoin.outputs') }}</dt>
          <dd class="g-num">{{ ioSummary }}</dd>
        </div>
      </dl>
    </header>

    <!-- Inputs → fee → outputs, in the same glass disclosure list as Cardano's sections -->
    <div v-if="ioSummary" class="tx-sections glass-tier">
      <section :class="['tx-section', { 'tx-section--open': ioOpen }]">
        <button
          type="button"
          class="tx-section__head"
          :aria-expanded="ioOpen ? 'true' : 'false'"
          @click="ioOpen = !ioOpen"
        >
          <span class="tx-section__icon"><v-icon size="small">mdi-cube-outline</v-icon></span>
          <span class="tx-section__title">{{ $t('bitcoin.inputsAndOutputs') }}</span>
          <span class="tx-count g-num">{{ ioSummary }}</span>
          <v-icon size="small" class="tx-section__chevron">mdi-chevron-down</v-icon>
        </button>

        <div v-if="ioOpen" class="tx-section__body">
          <div class="tx-io-head">
            <span class="t-label">{{ $t('bitcoin.inputs') }}</span>
            <span class="tx-count g-num">{{ inputs.length }}</span>
          </div>
          <div v-for="row in inputRows" :key="row.key" class="tx-utxo">
            <div class="tx-utxo__top">
              <div class="tx-utxo__ids">
                <div v-if="row.ref" class="tx-utxo__line tx-utxo__line--primary">
                  <span class="g-mono">{{ filters.truncate(row.ref) }}</span>
                  <CopyButton x-small :value="row.ref" />
                  <ExplorerLink type="tx" :id="row.prevTxid" x-small />
                </div>
                <div class="tx-utxo__line">
                  <template v-if="row.address">
                    <span class="g-mono">{{ filters.truncate(row.address) }}</span>
                    <CopyButton x-small :value="row.address" />
                    <span v-if="row.own" class="tx-you">{{ $t('governance.you') }}</span>
                  </template>
                  <span v-else class="t-caption">{{ $t('bitcoin.coinbase') }}</span>
                </div>
              </div>
              <span class="tx-utxo__ada g-num">{{ row.amount }}</span>
            </div>
          </div>
          <button
            v-if="inputs.length > IO_LIMIT"
            type="button"
            class="tx-more tx-io-more"
            @click="showAllInputs = !showAllInputs"
          >
            {{ showAllInputs ? $t('governance.showLess') : $t('transactions.showAllInputs', { count: inputs.length }) }}
          </button>

          <div class="tx-flow">
            <span class="tx-flow__rule"></span>
            <v-icon size="x-small" class="tx-flow__icon">mdi-arrow-down</v-icon>
            <span v-if="tx.fee !== undefined">{{ $t('signTx.networkFee') }} {{ $t('bitcoin.satsValue', { value: formatSats(tx.fee) }) }}</span>
            <span class="tx-flow__rule"></span>
          </div>

          <div class="tx-io-head">
            <span class="t-label">{{ $t('bitcoin.outputs') }}</span>
            <span class="tx-count g-num">{{ outputs.length }}</span>
          </div>
          <div v-for="row in outputRows" :key="row.key" class="tx-utxo">
            <div class="tx-utxo__top">
              <div class="tx-utxo__ids">
                <div class="tx-utxo__line tx-utxo__line--primary">
                  <template v-if="row.address">
                    <span class="g-mono">{{ filters.truncate(row.address) }}</span>
                    <CopyButton x-small :value="row.address" />
                    <span v-if="row.own" class="tx-you">{{ $t('governance.you') }}</span>
                  </template>
                  <span v-else class="t-caption">{{ $t('bitcoin.dataOutput') }}</span>
                </div>
              </div>
              <span class="tx-utxo__ada g-num">{{ row.amount }}</span>
            </div>
          </div>
          <button
            v-if="outputs.length > IO_LIMIT"
            type="button"
            class="tx-more tx-io-more"
            @click="showAllOutputs = !showAllOutputs"
          >
            {{ showAllOutputs ? $t('governance.showLess') : $t('transactions.showAllOutputs', { count: outputs.length }) }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import ExplorerLink from '@/shared/components/ExplorerLink.vue';
import TxGlyph from '@/modules/transactions/components/TxGlyph.vue';
import filters from '@/shared/utils/filters';
import time from '@/plugins/time';
import networks from '@/utils/networks';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { formatBtc, formatInt, formatSats } from '@/shared/utils/format';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useExplorer } from '@/shared/composables/useExplorer';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { buildClassifyContext, TX_KIND_ICON, TX_KIND_TONE, type TxKind } from '@/modules/dashboard/utils/transactionClassifier';
import { TransactionType, type UnifiedTransaction } from '@/chains/bitcoin/bitcoinTransactionParser';

// The Bitcoin counterpart of TransactionDetails.vue, in the same layout (shared
// styles in _tx-details.scss). Used by the dashboard dialog and the history
// page's detail pane.
const props = defineProps<{
  transactionInfo: UnifiedTransaction;
}>();

/** Rows shown per side before "Show all". */
const IO_LIMIT = 10;
/** Six blocks deep is the customary point a Bitcoin payment counts as final. */
const FINAL_CONFIRMATIONS = 6;

const { t, tc } = useTranslation();
const { explorerUrl } = useExplorer();
const { convertFiat, getCurrencySymbol } = useCurrencyConverter();
const { loggedWallet } = toRefs(walletStore);

// The store's current record: a pending transaction picks up its confirmations
// as sync replaces the record, while the pane keeps the object that was clicked.
const tx = computed<UnifiedTransaction>(() => {
  const id = props.transactionInfo?.id;
  // Bitcoin records share walletStore.transactions, typed for Cardano.
  const stored = (walletStore.transactions ?? []) as unknown as UnifiedTransaction[];
  const live = id ? stored.find((record) => record.id === id) : undefined;
  return live ?? props.transactionInfo;
});

const ticker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)
);

// ── Hero ─────────────────────────────────────────────────────────
const kind = computed<TxKind>(() => {
  if (tx.value.pending) return 'pending';
  if (tx.value.type === TransactionType.SELF) return 'self';
  if (tx.value.type === TransactionType.RECEIVE || tx.value.ada > 0) return 'in';
  if (tx.value.type === TransactionType.SEND || tx.value.ada < 0) return 'out';
  return 'neutral';
});
const kindIcon = computed(() => TX_KIND_ICON[kind.value]);
const kindTone = computed(() => TX_KIND_TONE[kind.value]);

// Same titles as the history row (transactionClassifier.buildTxTitle for Bitcoin records)
const title = computed(() => {
  if (tx.value.type === TransactionType.SELF) return t('transactions.selfTransfer');
  if (tx.value.ada > 0) return t('transactions.receivedFunds');
  if (tx.value.ada < 0) return t('transactions.sentFunds');
  return t('transactions.transaction');
});

const txDate = computed(() => new Date(tx.value.tx_timestamp * 1000));
const absoluteTime = computed(() => txDate.value.toLocaleString());
const relativeTime = computed(() => time.format(txDate.value));

const verb = computed(() => {
  // A self transfer moves nothing out of the wallet but the fee
  if (tx.value.type === TransactionType.SELF) return t('signTx.networkFee');
  if (tx.value.ada > 0) return t('transactions.received');
  if (tx.value.ada < 0) return t('transactions.sent');
  return '';
});

const heroAmount = computed(() => {
  const sats = tx.value.ada;
  const sign = sats > 0 ? '+ ' : sats < 0 ? '− ' : '';
  return `${sign}${formatBtc(Math.abs(sats))} ${ticker.value}`;
});

const amountClass = computed(() => {
  if (tx.value.pending) return 'tx-hero__amount-value--pending';
  return tx.value.ada > 0 ? 'tx-hero__amount-value--in' : '';
});

// Sats, then fiat at the live BTC price, labelled as such (it is not the historical value)
const subLine = computed(() => {
  const sats = Math.abs(tx.value.ada);
  const parts = [t('bitcoin.satsValue', { value: formatSats(sats) })];
  const price = priceStore.btcUsd?.lastPrice || 0;
  if (price && sats) {
    // Sats × USD price is the value in 1e-8 USD, hence the 8 decimals.
    const value = filters.toCurrency(convertFiat(sats * price), false, 0, getCurrencySymbol(), '', false, 8);
    parts.push(t('transactions.fiatAtTodaysPrice', { value }));
  }
  return parts.join(' · ');
});

const status = computed<'confirmed' | 'pending'>(() =>
  !tx.value.pending && (tx.value.confirmations ?? FINAL_CONFIRMATIONS) >= FINAL_CONFIRMATIONS ? 'confirmed' : 'pending'
);
const statusIcon = computed(() => (status.value === 'confirmed' ? 'mdi-check-circle-outline' : 'mdi-clock-outline'));
const statusLabel = computed(() => {
  if (tx.value.pending) return t('transactions.pending');
  if (status.value === 'confirmed') return t('transactions.confirmed');
  const count = tx.value.confirmations ?? 0;
  return tc('bitcoin.confirmationsCount', count, { count });
});

const feeRate = computed(() => {
  const { fee, vsize } = tx.value;
  return fee && vsize ? (fee / vsize).toFixed(1) : '';
});

const transactionUrl = computed(() => explorerUrl('tx', tx.value.id) || null);
const blockUrl = computed(() => explorerUrl('block', tx.value.block_hash) || null);

// ── Inputs / outputs ─────────────────────────────────────────────
const inputs = computed(() => tx.value.inputs ?? []);
const outputs = computed(() => tx.value.outputs ?? []);
const ioSummary = computed(() =>
  inputs.value.length || outputs.value.length ? `${inputs.value.length} → ${outputs.value.length}` : ''
);

// Few inputs and outputs is the common case, so the section starts open.
const ioOpen = ref(true);
const showAllInputs = ref(false);
const showAllOutputs = ref(false);

watch(() => props.transactionInfo?.id, () => {
  ioOpen.value = true;
  showAllInputs.value = false;
  showAllOutputs.value = false;
});

const ownAddresses = computed(() => {
  const { walletAddresses } = buildClassifyContext(loggedWallet.value, walletStore.keys, null);
  if (loggedWallet.value?.baseAddress) walletAddresses.add(loggedWallet.value.baseAddress);
  return walletAddresses;
});

const btcAmount = (sats: number) => `${formatBtc(sats)} ${ticker.value}`;

const inputRows = computed(() =>
  (showAllInputs.value ? inputs.value : inputs.value.slice(0, IO_LIMIT)).map((input, index) => ({
    key: `in-${index}`,
    // The previous output this input spends (txid:vout); a coinbase input has none
    ref: input.txid ? `${input.txid}:${input.vout}` : '',
    prevTxid: input.txid,
    address: input.address,
    own: ownAddresses.value.has(input.address),
    amount: btcAmount(input.value),
  }))
);

const outputRows = computed(() =>
  (showAllOutputs.value ? outputs.value : outputs.value.slice(0, IO_LIMIT)).map((output, index) => ({
    key: `out-${index}`,
    address: output.address,
    own: ownAddresses.value.has(output.address),
    amount: btcAmount(output.value),
  }))
);
</script>

<style scoped lang="scss">
@import '@/shared/styles/tx-details';
</style>
