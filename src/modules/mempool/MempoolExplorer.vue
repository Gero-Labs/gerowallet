<template>
  <div class="mp-page">
    <!-- Header -->
    <div class="mp-page__header">
      <div class="mp-page__headline">
        <span class="t-label">{{ $t('bitcoin.ecosystem') }}</span>
        <h1 class="t-title">{{ $t('mempool.title') }}</h1>
        <p class="t-body mp-page__subtitle">{{ $t('mempool.subtitle') }}</p>
      </div>
      <div class="mp-page__header-side">
        <v-btn
          icon
          variant="text"
          size="small"
          :loading="loading"
          :aria-label="$t('common.refresh')"
          :title="$t('common.refresh')"
          @click="refresh()"
        >
          <v-icon size="small">mdi-refresh</v-icon>
        </v-btn>
        <v-btn
          icon
          variant="text"
          size="small"
          :aria-label="$t('mempool.openOnMempool')"
          :title="$t('mempool.openOnMempool')"
          @click="openMempoolSpace()"
        >
          <v-icon size="small">mdi-open-in-new</v-icon>
        </v-btn>
      </div>
    </div>

    <!-- Fee rates, mempool totals and the fee distribution -->
    <section class="glass-panel mp-panel" :aria-label="$t('bitcoin.feeRate')">
      <div class="mp-fees">
        <div v-for="rate in feeRates" :key="rate.key" class="glass-tier mp-fee">
          <span class="mp-fee__top">
            <span class="t-body-sm mp-fee__name">{{ $t(rate.labelKey) }}</span>
            <!-- Speed as lit dots, the same scale as the send dialog's fee tiers -->
            <span class="mp-fee__dots" aria-hidden="true">
              <span v-for="d in 4" :key="d" :class="['mp-fee__dot', { 'mp-fee__dot--lit': d <= rate.dots }]" />
            </span>
          </span>
          <span class="t-body-lg g-num mp-fee__rate">
            {{ fees ? $t('bitcoin.feeRateValue', { value: fees[rate.key] }) : '—' }}
          </span>
          <span class="t-caption">{{ rate.eta }}</span>
        </div>
      </div>

      <dl class="mp-stats">
        <div class="mp-stat">
          <dt class="t-label">{{ $t('mempool.pendingTxs') }}</dt>
          <dd class="t-body-lg g-num">{{ mempoolStats ? formatInt(mempoolStats.count) : '—' }}</dd>
        </div>
        <div class="mp-stat">
          <dt class="t-label">{{ $t('mempool.mempoolSize') }}</dt>
          <dd class="t-body-lg g-num">{{ mempoolStats ? formatVsize(mempoolStats.vsize) : '—' }}</dd>
        </div>
        <div class="mp-stat">
          <dt class="t-label">{{ $t('mempool.totalFees') }}</dt>
          <dd class="t-body-lg g-num">
            {{ mempoolStats ? formatBtc(mempoolStats.total_fee) : '—' }}
            <span class="g-mono mp-stat__unit">{{ ticker }}</span>
          </dd>
        </div>
      </dl>

      <div v-if="feeHistogram.length > 0" class="mp-hist">
        <span class="t-label">{{ $t('mempool.feeDistribution') }}</span>
        <!-- One picture for assistive tech; the per-bar tooltips are for the pointer. -->
        <div class="mp-hist__bars" role="img" :aria-label="$t('mempool.feeDistribution')">
          <v-tooltip
            v-for="(bucket, index) in feeHistogram"
            :key="bucket.fee"
            location="top"
            :open-delay="100"
            content-class="custom-tooltip"
          >
            <template #activator="{ props: activatorProps }">
              <div class="mp-hist__col" v-bind="activatorProps">
                <div
                  :class="['mp-hist__bar', `mp-hist__bar--${barBand(bucket.fee)}`]"
                  :style="{ height: `${Math.max(4, (bucket.vsize / maxHistogramVsize) * 120)}px` }"
                />
                <!-- Every fifth bar is labelled: a label per 16px bar overlapped its neighbours and the bars -->
                <span class="t-caption g-num mp-hist__label">{{ index % HIST_LABEL_EVERY === 0 ? histFeeLabel(bucket.fee) : '' }}</span>
              </div>
            </template>
            <span class="g-num">{{ $t('bitcoin.feeRateValue', { value: bucket.fee }) }} · {{ formatVsize(bucket.vsize) }}</span>
          </v-tooltip>
        </div>
        <span class="t-caption mp-hist__axis">{{ $t('mempool.feeRateSatVb') }}</span>
      </div>
    </section>

    <!-- Recent blocks -->
    <section class="glass-panel mp-panel" aria-labelledby="mp-blocks-title">
      <h2 id="mp-blocks-title" class="t-body-lg mp-panel__title">
        <v-icon size="small" class="mp-panel__title-icon">mdi-cube-outline</v-icon>
        {{ $t('mempool.recentBlocks') }}
      </h2>
      <v-skeleton-loader v-if="loading && blocks.length === 0" type="list-item-two-line@4" />
      <div v-else-if="blocks.length > 0" class="mp-blocks">
        <button
          v-for="block in blocks.slice(0, 6)"
          :key="block.id"
          type="button"
          class="glass-tier mp-block"
          @click="openBlock(block.id)"
        >
          <span class="mp-block__icon"><v-icon size="small">mdi-cube-outline</v-icon></span>
          <span class="mp-block__text">
            <span class="t-body-sm g-num mp-block__height">#{{ formatInt(block.height) }}</span>
            <span class="t-caption g-num">{{ blockLine(block) }}</span>
          </span>
          <v-icon size="small" class="mp-block__chevron">mdi-open-in-new</v-icon>
        </button>
      </div>
    </section>

    <!-- Transaction lookup -->
    <section class="glass-panel mp-panel" aria-labelledby="mp-lookup-title">
      <h2 id="mp-lookup-title" class="t-body-lg mp-panel__title">
        <v-icon size="small" class="mp-panel__title-icon">mdi-magnify</v-icon>
        {{ $t('mempool.lookupTx') }}
      </h2>
      <form class="mp-lookup" @submit.prevent="lookupTx()">
        <!-- The input is the pill itself, so the baseline focus ring is the focus style -->
        <label class="mp-search">
          <v-icon size="small" class="mp-search__icon">mdi-magnify</v-icon>
          <input
            v-model="txSearch"
            type="search"
            class="t-body-sm mp-search__input"
            :placeholder="$t('mempool.txidPlaceholder')"
            :aria-label="$t('mempool.lookupTx')"
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <GButton tier="secondary" compact type="submit">{{ $t('common.search') }}</GButton>
      </form>

      <template v-if="txResult">
        <dl class="mp-facts">
          <div class="mp-fact">
            <dt class="t-label">{{ $t('mempool.status') }}</dt>
            <dd class="t-body-sm">
              <span :class="['t-caption', 'mp-status', txResult.status.confirmed ? 'mp-status--confirmed' : 'mp-status--pending']">
                <v-icon size="x-small">{{ txResult.status.confirmed ? 'mdi-check-circle' : 'mdi-clock-outline' }}</v-icon>
                {{ txResult.status.confirmed ? $t('mempool.confirmed') : $t('mempool.unconfirmed') }}
              </span>
            </dd>
          </div>
          <div v-if="txResult.status.confirmed" class="mp-fact">
            <dt class="t-label">{{ $t('mempool.blockHeight') }}</dt>
            <dd class="t-body-sm g-num">#{{ formatInt(txResult.status.block_height) }}</dd>
          </div>
          <div class="mp-fact">
            <dt class="t-label">{{ $t('mempool.fee') }}</dt>
            <dd class="t-body-sm g-num">{{ feeLine(txResult) }}</dd>
          </div>
          <div class="mp-fact">
            <dt class="t-label">{{ $t('mempool.size') }}</dt>
            <dd class="t-body-sm g-num">
              {{ $t('mempool.bytesValue', { value: formatInt(txResult.size) }) }} · {{ $t('bitcoin.weightValue', { value: formatInt(txResult.weight) }) }}
            </dd>
          </div>
          <div class="mp-fact mp-fact--wide">
            <dt class="t-label">{{ $t('transactions.transactionId') }}</dt>
            <!-- The whole id, so what was found can be checked against what was typed -->
            <dd class="t-body-sm">
              <span class="g-mono mp-fact__id">{{ txResult.txid }}</span>
              <CopyButton x-small :value="txResult.txid" />
            </dd>
          </div>
        </dl>
        <div class="mp-lookup__actions">
          <GButton tier="tertiary" compact @click="openTxOnMempool(txResult.txid)">
            <v-icon size="small" start>mdi-open-in-new</v-icon>
            {{ $t('mempool.openOnMempool') }}
          </GButton>
        </div>
      </template>

      <div v-if="txError" class="t-body-sm mp-notice mp-notice--error" role="alert">
        <v-icon size="small">mdi-alert-circle-outline</v-icon>
        <span class="mp-notice__text">{{ txError }}</span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { toRefs } from 'vue';
import mempoolApi, { type MempoolFeeEstimates, type MempoolBlock, type MempoolTransaction } from '@/api/mempool-api';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import networks from '@/utils/networks';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatBtc, formatInt, formatSats } from '@/shared/utils/format';
import { formatRelativeTime } from '@/shared/utils/relativeTime';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';

const { t, tc } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const loading = ref(false);
const fees = ref<MempoolFeeEstimates | null>(null);
const mempoolStats = ref<{ count: number; vsize: number; total_fee: number; fee_histogram: [number, number][] } | null>(null);
const blocks = ref<MempoolBlock[]>([]);
const txSearch = ref('');
const txResult = ref<MempoolTransaction | null>(null);
const txError = ref<string | null>(null);

const isTestnet = computed(() => loggedWallet.value?.network === Network.TESTNET);

const ticker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)
);

// Fastest first; `dots` is the speed on the send dialog's four-step scale
const feeRates = computed(() => [
  { key: 'fastestFee' as keyof MempoolFeeEstimates, labelKey: 'mempool.feeNextBlock', eta: t('bitcoin.etaMinutes', { minutes: 10 }), dots: 4 },
  { key: 'halfHourFee' as keyof MempoolFeeEstimates, labelKey: 'mempool.feeHalfHour', eta: t('bitcoin.etaMinutes', { minutes: 30 }), dots: 3 },
  { key: 'hourFee' as keyof MempoolFeeEstimates, labelKey: 'mempool.feeHour', eta: t('bitcoin.etaMinutes', { minutes: 60 }), dots: 2 },
  { key: 'economyFee' as keyof MempoolFeeEstimates, labelKey: 'mempool.feeEconomy', eta: t('mempool.etaOverHour'), dots: 1 },
]);

const feeHistogram = computed(() => {
  if (!mempoolStats.value?.fee_histogram) return [];
  return mempoolStats.value.fee_histogram
    .map(([fee, vsize]) => ({ fee, vsize }))
    .sort((a, b) => a.fee - b.fee)
    .slice(0, 40);
});

const HIST_LABEL_EVERY = 5;

/** A short axis label for a fee rate (sat/vB); the bar's tooltip keeps the exact value. */
function histFeeLabel(fee: number): string {
  if (fee >= 10) return fee.toFixed(0);
  if (fee >= 1) return fee.toFixed(1);
  return fee.toPrecision(2);
}

const maxHistogramVsize = computed(() =>
  Math.max(...feeHistogram.value.map(b => b.vsize), 1)
);

// Which fee tier a histogram bucket clears: 0 = next block … 3 = economy
function barBand(fee: number): number {
  if (fee >= (fees.value?.fastestFee ?? 999)) return 0;
  if (fee >= (fees.value?.halfHourFee ?? 50)) return 1;
  if (fee >= (fees.value?.hourFee ?? 10)) return 2;
  return 3;
}

function formatVsize(vsize: number): string {
  if (vsize > 1_000_000) return `${(vsize / 1_000_000).toFixed(1)} MB`;
  if (vsize > 1_000) return `${(vsize / 1_000).toFixed(1)} KB`;
  return `${vsize} B`;
}

function formatSize(bytes: number): string {
  if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000).toFixed(1)} KB`;
}

function feeRate(tx: MempoolTransaction): string {
  if (!tx.fee || !tx.weight) return '—';
  return (tx.fee / (tx.weight / 4)).toFixed(1);
}

// "12,345 sats · 8.2 sat/vB"
function feeLine(tx: MempoolTransaction): string {
  const sats = tx.fee != null ? t('bitcoin.satsValue', { value: formatSats(tx.fee) }) : '—';
  return `${sats} · ${t('bitcoin.feeRateValue', { value: feeRate(tx) })}`;
}

// "2,345 txs · 1.6 MB · 7m ago"
function blockLine(block: MempoolBlock): string {
  const txs = tc('mempool.txCount', block.tx_count, { count: formatInt(block.tx_count) });
  return `${txs} · ${formatSize(block.size)} · ${formatRelativeTime(block.timestamp * 1000)}`;
}

function openBlock(blockId: string) {
  window.open(mempoolApi.getBlockUrl(blockId, isTestnet.value), '_blank');
}

function openTxOnMempool(txid: string) {
  window.open(mempoolApi.getTxUrl(txid, isTestnet.value), '_blank');
}

function openMempoolSpace() {
  window.open(isTestnet.value ? 'https://mempool.space/testnet' : 'https://mempool.space', '_blank');
}

async function lookupTx() {
  if (!txSearch.value.trim()) return;
  txResult.value = null;
  txError.value = null;
  try {
    txResult.value = await mempoolApi.getTransaction(txSearch.value.trim(), isTestnet.value);
  } catch {
    txError.value = t('mempool.txNotFound');
  }
}

async function refresh() {
  loading.value = true;
  try {
    const [feesResult, statsResult, blocksResult] = await Promise.all([
      mempoolApi.getFeeEstimates(isTestnet.value).catch(() => null),
      mempoolApi.getMempoolStats(isTestnet.value).catch(() => null),
      mempoolApi.getRecentBlocks(isTestnet.value).catch(() => null),
    ]);
    fees.value = feesResult;
    mempoolStats.value = statsResult;
    blocks.value = blocksResult || [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => refresh());
</script>

<style scoped lang="scss">
.mp-page {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}

/* ─── Header ─────────────────────────────────────────────────── */
.mp-page__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-4);
  flex-wrap: wrap;
}

.mp-page__headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.mp-page__headline h1,
.mp-page__subtitle {
  margin: 0;
}

.mp-page__header-side {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

/* ─── Panels ─────────────────────────────────────────────────── */
/* Surface comes from the shared .glass-panel material; only layout lives here. */
.mp-panel {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}

.mp-panel__title {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: 0;
  font-weight: 600;
}

.mp-panel__title-icon {
  color: var(--g-text-3);
}

/* ─── Fee tiers ──────────────────────────────────────────────── */
.mp-fees {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--g-s-2);
}

@media (max-width: 600px) {
  .mp-fees {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.mp-fee {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  padding: var(--g-s-3);
}

.mp-fee__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-bottom: var(--g-s-1);
}

.mp-fee__name {
  color: var(--g-text-1);
  font-weight: 600;
}

.mp-fee__dots {
  display: inline-flex;
  gap: 3px;
}

.mp-fee__dot {
  width: 5px;
  height: 5px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-3);
}

.mp-fee__dot--lit {
  background: var(--g-accent);
}

.mp-fee__rate {
  font-weight: 600;
}

/* ─── Mempool totals ─────────────────────────────────────────── */
.mp-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  column-gap: var(--g-s-5);
  margin: 0;
  border-top: 1px solid var(--g-hairline-1);
}

@media (max-width: 600px) {
  .mp-stats {
    grid-template-columns: minmax(0, 1fr);
  }
}

.mp-stat {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--g-s-3) 0;
  border-bottom: 1px solid var(--g-hairline-1);
}

.mp-stat dd {
  display: flex;
  align-items: baseline;
  gap: var(--g-s-1);
  margin: 0;
}

.mp-stat__unit {
  color: var(--g-text-3);
}

/* ─── Fee histogram ──────────────────────────────────────────── */
.mp-hist {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.mp-hist__bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 140px;
  padding-bottom: var(--g-s-5);
  overflow-x: auto;
}

.mp-hist__col {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 16px;
}

.mp-hist__bar {
  width: 12px;
  min-height: 4px;
  border-radius: var(--g-r-chip);
  opacity: 0.8;
  transition: height var(--g-dur-slow) var(--g-ease), opacity var(--g-dur-fast) var(--g-ease);
}

.mp-hist__col:hover .mp-hist__bar {
  opacity: 1;
}

/* The four fee bands are the chain accent at falling strength: the same
   "more → less" scale as the tier dots, no second colour family. */
.mp-hist__bar--0 {
  background: var(--g-accent);
}

.mp-hist__bar--1 {
  background: color-mix(in srgb, var(--g-accent) 70%, transparent);
}

.mp-hist__bar--2 {
  background: color-mix(in srgb, var(--g-accent) 45%, transparent);
}

.mp-hist__bar--3 {
  background: color-mix(in srgb, var(--g-accent) 25%, transparent);
}

.mp-hist__label {
  min-height: 16px;
  margin-top: var(--g-s-1);
  white-space: nowrap;
}

.mp-hist__axis {
  text-align: center;
}

/* ─── Recent blocks ──────────────────────────────────────────── */
.mp-blocks {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.mp-block {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  width: 100%;
  padding: var(--g-s-3);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}

.mp-block:hover {
  @include g-glass-tier-hover;
}

.mp-block__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.mp-block__icon .v-icon {
  color: var(--g-text-2);
  transition: color var(--g-dur-fast) var(--g-ease);
}

.mp-block:hover .mp-block__icon .v-icon {
  color: var(--g-accent);
}

.mp-block__text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mp-block__height {
  color: var(--g-text-1);
  font-weight: 600;
}

.mp-block__chevron {
  flex: 0 0 auto;
  color: var(--g-text-3);
}

/* ─── Transaction lookup ─────────────────────────────────────── */
.mp-lookup {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.mp-search {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: block;
}

.mp-search .mp-search__icon {
  position: absolute;
  top: 50%;
  left: var(--g-s-3);
  color: var(--g-text-3);
  transform: translateY(-50%);
  pointer-events: none;
}

/* The input is the pill (a control, so a solid hairline fill); the baseline
   focus ring is its focus style. Left padding leaves room for the icon. */
.mp-search__input {
  display: block;
  width: 100%;
  height: var(--g-btn-h-compact);
  padding: 0 var(--g-s-3) 0 calc(var(--g-s-5) + var(--g-s-4));
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
  color: var(--g-text-1);
  font-family: inherit;
  line-height: inherit;
  transition: border-color var(--g-dur-fast) var(--g-ease);
}

.mp-search__input:focus {
  border-color: var(--g-accent);
}

.mp-search__input::placeholder {
  color: var(--g-text-3);
}

.mp-search__input::-webkit-search-cancel-button {
  cursor: pointer;
}

.mp-lookup__actions {
  display: flex;
}

.mp-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--g-s-5);
  margin: 0;
  border-top: 1px solid var(--g-hairline-1);
}

.mp-fact {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--g-s-3) 0;
  border-bottom: 1px solid var(--g-hairline-1);
}

.mp-fact--wide {
  grid-column: 1 / -1;
}

.mp-fact dd {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  min-width: 0;
  margin: 0;
  color: var(--g-text-1);
}

.mp-fact dd .g-mono {
  color: var(--g-text-1);
}

.mp-fact__id {
  min-width: 0;
  overflow-wrap: anywhere;
}

.mp-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--g-r-pill);
  font-weight: 600;
  white-space: nowrap;
}

.mp-status .v-icon {
  color: inherit;
}

.mp-status--confirmed {
  background: var(--g-success-fill);
  color: var(--g-success);
}

.mp-status--pending {
  background: var(--g-warning-fill);
  color: var(--g-warning);
}

.mp-notice {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
}

.mp-notice .v-icon {
  color: inherit;
}

.mp-notice__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.mp-notice--error {
  border-color: var(--g-error-line);
  background: var(--g-error-fill);
  color: var(--g-error);
}
</style>
