<template>
  <v-card flat class="token-detail-panel">
    <!-- Header -->
    <div class="d-flex align-center pa-4 pb-2">
      <v-avatar size="36" class="mr-3">
        <img v-if="token.img" :src="token.img" :alt="token.ticker" />
        <img v-else-if="chainLogo" :src="chainLogo" :alt="token.ticker" style="opacity: 0.5" />
        <v-icon v-else>mdi-circle-outline</v-icon>
      </v-avatar>
      <div class="flex-grow-1">
        <div class="d-flex align-center">
          <span class="text-h6 font-weight-bold mr-2">{{ token.ticker }}</span>
          <v-icon v-if="token.verified" small color="primary" class="mr-1">mdi-check-decagram</v-icon>
        </div>
        <span class="text--secondary text-caption">{{ token.name }}</span>
      </div>
      <v-btn icon small @click="toggleWatch(token.unit)" class="mr-1">
        <v-icon :color="isWatched(token.unit) ? 'amber' : ''">
          {{ isWatched(token.unit) ? 'mdi-star' : 'mdi-star-outline' }}
        </v-icon>
      </v-btn>
      <v-btn icon small @click="openExplorer" class="mr-1">
        <v-icon small>mdi-open-in-new</v-icon>
      </v-btn>
      <v-btn icon small @click="$emit('close')">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </div>

    <!-- Two-column layout -->
    <div class="panel-columns">
      <!-- ═══ LEFT COLUMN: Chart + Recent Trades ═══ -->
      <div class="left-col">
        <!-- DUST generation line: NIGHT (cNIGHT) only, until dismissed. -->
        <DustGenerationLine
          v-if="showDustLine"
          variant="drawer"
          class="mb-3"
          @setup="$emit('dust-setup')"
          @dismiss="dismissDustLine"
        />

        <!-- DUST registration confirmation: persistent (survives promo dismissal),
             shows the on-chain registration tx once submitted/confirmed. -->
        <div v-if="showDustRegInfo" class="dust-reg-info">
          <span class="dust-reg-chip">{{ $t('midnight.dustRegistrationChip') }}</span>
          <span class="dust-reg-status" :class="{ 'is-live': dustRegConfirmed }">
            {{ dustRegConfirmed ? $t('midnight.dustLineGenerating') : $t('midnight.dustRegistrationPending') }}
          </span>
          <a
            class="dust-reg-tx"
            :href="dustRegTxUrl"
            target="_blank"
            rel="noopener noreferrer"
            :title="dustRegTxHash"
          >
            {{ shortTx(dustRegTxHash) }}
            <v-icon x-small>mdi-open-in-new</v-icon>
          </a>
        </div>

        <!-- Price + Currency Toggle -->
        <div class="pb-3">
          <div class="d-flex align-center" style="gap: 8px">
            <span class="text-h5 font-weight-bold">{{ displayPrice }}</span>
            <span
              class="g-num"
              :class="token.change24h >= 0 ? 'delta-up' : 'delta-down'"
              style="font-size: 13px; font-weight: 550;"
            >
              {{ formatSignedChange(token.change24h) }}
            </span>
          </div>
          <div class="text--secondary text-caption mt-1">{{ secondaryPrice }}</div>

          <!-- Currency toggle pills -->
          <div class="currency-pills mt-2">
            <span
              v-for="c in currencyOptions"
              :key="c"
              class="currency-pill"
              :class="{ active: selectedCurrency === c }"
              @click="selectedCurrency = c"
            >{{ c === 'NATIVE' ? nativeTicker : c }}</span>
          </div>
        </div>

        <!-- Chart Section -->
        <div class="pb-2 chart-shell">
          <!-- Timeframe + Indicators bar -->
          <div class="d-flex align-center mb-1" style="gap: 6px">
            <div class="timeframe-bar">
              <span
                v-for="tf in timeframeOptions"
                :key="tf.value"
                class="tf-btn"
                :class="{ active: selectedTimeframe === tf.value }"
                @click="selectedTimeframe = tf.value"
              >{{ tf.label }}</span>
            </div>

            <v-spacer />

            <!-- TA Indicator toggles -->
            <div class="d-flex align-center" style="gap: 2px">
              <v-tooltip bottom :open-delay="300" content-class="custom-tooltip" v-for="ind in indicatorOptions" :key="ind.value">
                <template v-slot:activator="{ on, attrs }">
                  <span
                    v-bind="attrs"
                    v-on="on"
                    class="ind-btn"
                    :class="{ active: activeIndicators.includes(ind.value) }"
                    @click="toggleIndicator(ind.value)"
                  >{{ ind.label }}</span>
                </template>
                <span>{{ $t(ind.tooltipKey) }}</span>
              </v-tooltip>
            </div>
          </div>

          <div v-if="!candlesLoading && convertedCandles.length === 0" class="chart-no-data d-flex align-center justify-center" :style="{ height: chartHeight }">
            <div class="text-center">
              <v-icon color="grey" size="32" class="mb-2">mdi-chart-line-variant</v-icon>
              <div class="text--secondary text-caption">{{ $t('market.noChartData') }}</div>
            </div>
          </div>
          <template v-else>
            <div v-if="staleDataWarning" class="stale-warning">
              <v-icon x-small color="warning" class="mr-1">mdi-alert-outline</v-icon>
              {{ staleDataWarning }}
            </div>
            <TechnicalAnalysisChart
              :key="selectedCurrency"
              :candles="convertedCandles"
              :height="chartHeight"
              :indicators="activeIndicators"
            />
          </template>
        </div>

        <!-- Buy vs Sell Volume (Cardano DEX data only) -->
        <div v-if="!isApex" class="pt-2">
          <BuySellVolume
            v-if="tokenPolicyId && tokenAssetName"
            :policy-id="tokenPolicyId"
            :asset-name="tokenAssetName"
          />
        </div>

        <!-- Recent Trades (Cardano DEX data only) -->
        <div v-if="!isApex" class="pt-2">
          <RecentTrades
            v-if="tokenPolicyId && tokenAssetName"
            :policy-id="tokenPolicyId"
            :asset-name="tokenAssetName"
          />
        </div>
      </div>

      <!-- ═══ RIGHT COLUMN: Swap/Depth tabs + Token Info ═══ -->
      <div class="right-col">
        <!-- Right column tabs -->
        <v-tabs v-model="rightTab" dense background-color="transparent" height="28" class="detail-sub-tabs mb-3">
          <v-tab tab-value="swap">{{ $t('market.swap') }}</v-tab>
          <v-tab tab-value="depth">{{ $t('market.depth') }}</v-tab>
          <v-tab v-if="!isApex && token.unit !== 'lovelace'" tab-value="markets">{{ $t('market.markets') }}</v-tab>
        </v-tabs>

        <!-- Swap tab -->
        <transition name="tab-fade" mode="out-in">
        <div v-if="rightTab === 'swap'" key="swap">
          <!-- GeroSwapEmbed (Cardano DEX only) -->
          <div v-if="!isApex && token.unit !== 'lovelace'" class="swap-shell">
            <GeroSwapEmbed
              :token-out="token.unit"
              context="dialog"
              @swap-submitted="onSwapComplete"
            />
          </div>
          <div v-else class="text-center py-4 text--secondary text-caption">
            {{ $t('market.na') }}
          </div>

          <!-- Token Info (compact grid) -->
          <div class="token-info-grid mt-4">
            <div class="info-item" v-for="stat in compactStats" :key="stat.label">
              <span class="info-label">{{ stat.label }}</span>
              <span class="info-value">
                <component :is="stat.component" v-if="stat.component" v-bind="stat.componentProps" />
                <template v-else>{{ stat.value }}</template>
              </span>
            </div>
          </div>

          <!-- Policy ID row -->
          <div v-if="tokenPolicyId" class="policy-row mt-2">
            <div class="d-flex align-center" style="gap: 4px">
              <v-icon x-small :color="token.policyLocked ? 'success' : 'error'">
                {{ token.policyLocked ? 'mdi-lock' : 'mdi-lock-open-variant' }}
              </v-icon>
              <span class="info-label">{{ $t('market.policy') }}</span>
              <span class="text-caption" :style="{ color: token.policyLocked ? 'var(--g-success)' : 'var(--g-error)' }">
                {{ token.policyLocked ? $t('market.locked') : $t('market.open') }}
              </span>
            </div>
            <div class="policy-id text-caption text--secondary mt-1" :title="tokenPolicyId" @click="copyPolicyId">
              {{ tokenPolicyId }}
              <v-icon x-small class="ml-1" style="opacity: 0.4">mdi-content-copy</v-icon>
            </div>
          </div>

          <!-- P&L Section (if user holds this token) -->
          <div v-if="tokenPnl" class="pnl-section mt-3">
            <span class="t-label d-block mb-2">{{ $t('market.pnl') }}</span>
            <v-simple-table dense class="transparent stats-table">
              <tbody>
                <tr>
                  <td class="pnl-cell-label">{{ $t('market.avgCostBasis') }}</td>
                  <td class="text-right pnl-cell-value g-num" style="color: var(--g-text-1)">{{ formatPnlValue(tokenPnl.avgCostBasisAda) }}</td>
                </tr>
                <tr>
                  <td class="pnl-cell-label">{{ $t('market.unrealizedPnlDetail') }}</td>
                  <td class="text-right pnl-cell-value g-num" :style="{ color: tokenPnl.unrealizedPnlAda >= 0 ? 'var(--g-success)' : 'var(--g-error)' }">
                    {{ formatPnlSigned(tokenPnl.unrealizedPnlAda) }}
                  </td>
                </tr>
                <tr>
                  <td class="pnl-cell-label">{{ $t('market.realizedPnlDetail') }}</td>
                  <td class="text-right pnl-cell-value g-num" :style="{ color: tokenPnl.realizedPnlAda >= 0 ? 'var(--g-success)' : 'var(--g-error)' }">
                    {{ formatPnlSigned(tokenPnl.realizedPnlAda) }}
                  </td>
                </tr>
                <tr>
                  <td class="pnl-cell-label pnl-cell-total">{{ $t('market.totalPnlDetail') }}</td>
                  <td class="text-right pnl-cell-value pnl-cell-total g-num" :style="{ color: totalPnl >= 0 ? 'var(--g-success)' : 'var(--g-error)' }">
                    {{ formatPnlSigned(totalPnl) }}
                  </td>
                </tr>
              </tbody>
            </v-simple-table>
          </div>
        </div>

        <!-- Depth tab (Cardano DEX data only) -->
        <div v-else-if="rightTab === 'depth'" key="depth">
          <div v-if="!isApex" style="display: flex; flex-direction: column; gap: 12px">
            <DepthChart
              v-if="tokenPolicyId && tokenAssetName"
              :policy-id="tokenPolicyId"
              :asset-name="tokenAssetName"
              style="max-height: 200px"
            />
            <OrderBookTable
              v-if="tokenPolicyId && tokenAssetName"
              :policy-id="tokenPolicyId"
              :asset-name="tokenAssetName"
            />
          </div>
          <div v-else class="text-center py-6 text--secondary text-caption">
            {{ $t('market.na') }}
          </div>
        </div>

        <!-- Markets tab (cross-DEX price comparison) -->
        <div v-else-if="rightTab === 'markets'" key="markets">
          <CrossDexPrices :asset-id="token.unit" />
        </div>
        </transition>
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, type Ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useWatchlist } from '@/modules/market/composables/useWatchlist';
import { useMarketData, type MarketToken, type CandlestickDataPoint } from '@/modules/market/composables/useMarketData';
import TechnicalAnalysisChart from './TechnicalAnalysisChart.vue';
import OrderBookTable from './OrderBookTable.vue';
import DepthChart from './DepthChart.vue';
import GeroSwapEmbed from '@/modules/swap/components/GeroSwapEmbed.vue';
import RecentTrades from './RecentTrades.vue';
import BuySellVolume from './BuySellVolume.vue';
import CrossDexPrices from './CrossDexPrices.vue';
import { useWalletPnl } from '@/modules/market/composables/useWalletPnl';
import { priceStore } from '@/stores/priceStore';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import networks from '@/utils/networks';
import DustGenerationLine from '@/modules/dashboard/components/DustGenerationLine.vue';
import { CNIGHT_ASSETS, DUST_LINE_DISMISS_KEY, useCnightDustRegistration } from '@/shared/composables/useCnightDustRegistration';
import { getDustPending } from '@/shared/composables/useDustPending';
import { getExplorerUrl } from '@/shared/utils/explorer';

const chainLogo = computed(() =>
  networks.resolveCurrencyImage(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network) || ''
);

const props = defineProps<{
  token: MarketToken;
}>();

defineEmits<{
  (e: 'close'): void;
  (e: 'dust-setup'): void;
}>();

/** Whether this drawer's token is the current network's cNIGHT/NIGHT on a
 *  Cardano wallet — the only token that can generate DUST. */
const isNightToken = computed(() => {
  if (walletStore.loggedWallet?.chain !== Blockchain.CARDANO) return false;
  const asset = CNIGHT_ASSETS[walletStore.loggedWallet?.network ?? ''];
  return !!asset && props.token.unit === asset.policyId + asset.assetNameHex;
});

// The dismissable promo/status strip. Dismissal hides it outright; the
// registration confirmation below (tx id + chip) is separate and persistent.
const dustLineDismissed = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(DUST_LINE_DISMISS_KEY) === '1',
);
const showDustLine = computed(() => isNightToken.value && !dustLineDismissed.value);

// Persistent DUST-registration confirmation: once a registration is submitted
// (local guard) or confirmed (indexer), surface its tx id + status regardless
// of whether the promo strip was dismissed.
const { registrationStatus: dustRegStatus, status: dustStatusDto, refreshStatus: refreshDustStatus } =
  useCnightDustRegistration();
onMounted(() => { if (isNightToken.value) void refreshDustStatus(); });
const dustRegTxHash = computed(() => {
  const stake = walletStore.loggedWallet?.stakeAddress ?? '';
  return dustStatusDto.value?.registrationUtxoTxHash || getDustPending(stake)?.txHash || '';
});
const showDustRegInfo = computed(() => isNightToken.value && !!dustRegTxHash.value);
const dustRegConfirmed = computed(() => dustRegStatus.value === 'Registered');
const dustRegTxUrl = computed(() =>
  getExplorerUrl(Blockchain.CARDANO, dustRegTxHash.value, 'tx', walletStore.loggedWallet?.network));
function shortTx(h: string): string {
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
}

function dismissDustLine() {
  dustLineDismissed.value = true;
  if (typeof localStorage !== 'undefined') localStorage.setItem(DUST_LINE_DISMISS_KEY, '1');
}

const { t } = useTranslation();
const { isWatched, toggleWatchlist } = useWatchlist();
const { getTokenCandles } = useMarketData();
const { getTokenPnl } = useWalletPnl();
const { usdToEurRate } = useCurrencyConverter();
const { currencySymbol: nativeSymbol, currencyTicker: nativeTicker } = useNativeCurrency();

const isApex = computed(() => {
  const chain = walletStore.loggedWallet?.chain;
  return chain === Blockchain.APEX_PRIME || chain === Blockchain.APEX_VECTOR;
});

type Currency = 'NATIVE' | 'USD' | 'EUR';
const isAda = computed(() => props.token.unit === 'lovelace' || props.token.ticker === 'ADA');
const currencyOptions = computed<Currency[]>(() => isAda.value ? ['USD', 'EUR'] : ['NATIVE', 'USD', 'EUR']);
const selectedCurrency = ref<Currency>('USD');

// Currency conversion helpers
const adaUsdPrice = computed(() => priceStore.adaUsd?.lastPrice || 0);

/** Convert a USD value to the selected currency */
function convertUsd(usdValue: number): number {
  switch (selectedCurrency.value) {
    case 'NATIVE': return adaUsdPrice.value > 0 ? usdValue / adaUsdPrice.value : 0;
    case 'EUR': return usdValue * (usdToEurRate.value || 1);
    case 'USD':
    default: return usdValue;
  }
}

const currencySymbol = computed(() => {
  switch (selectedCurrency.value) {
    case 'NATIVE': return nativeSymbol.value;
    case 'EUR': return '€';
    case 'USD':
    default: return '$';
  }
});

// Display prices based on selected currency
const displayPrice = computed(() => {
  const tok = props.token;
  switch (selectedCurrency.value) {
    case 'NATIVE': return formatPrice(tok.priceAda, nativeSymbol.value);
    case 'EUR': return formatPrice(tok.price * (usdToEurRate.value || 1), '€');
    case 'USD':
    default: return formatPrice(tok.price, '$');
  }
});

const secondaryPrice = computed(() => {
  const tok = props.token;
  switch (selectedCurrency.value) {
    case 'NATIVE': return '$' + formatPriceRaw(tok.price);
    case 'USD': return formatPriceRaw(tok.priceAda) + ' ' + nativeSymbol.value;
    case 'EUR': return formatPriceRaw(tok.priceAda) + ' ' + nativeSymbol.value;
    default: return '';
  }
});

const selectedTimeframe = ref('1h');
const rightTab = ref('swap');

const tokenPnl = computed(() => getTokenPnl(props.token.unit));
const totalPnl = computed(() => {
  const p = tokenPnl.value;
  return p ? p.realizedPnlAda + p.unrealizedPnlAda : 0;
});

const tokenPolicyId = computed(() => {
  if (props.token.unit === 'lovelace') return '';
  return props.token.unit.substring(0, 56);
});
const tokenAssetName = computed(() => {
  if (props.token.unit === 'lovelace') return '';
  return props.token.unit.substring(56);
});
const activeIndicators = ref<string[]>(['vol']);

const timeframeOptions = [
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
];

function toggleIndicator(value: string) {
  const idx = activeIndicators.value.indexOf(value);
  if (idx >= 0) {
    activeIndicators.value.splice(idx, 1);
  } else {
    activeIndicators.value.push(value);
  }
}

const indicatorOptions = computed(() => [
  { value: 'vol', label: t('market.volumeIndicator'), tooltipKey: 'market.volumeTooltip' },
  { value: 'sma', label: 'SMA', tooltipKey: 'market.smaTooltip' },
  { value: 'ema', label: 'EMA', tooltipKey: 'market.emaTooltip' },
  { value: 'rsi', label: 'RSI', tooltipKey: 'market.rsiTooltip' },
  { value: 'macd', label: 'MACD', tooltipKey: 'market.macdTooltip' },
  { value: 'bb', label: 'BB', tooltipKey: 'market.bbTooltip' },
]);

const chartHeight = computed(() => {
  let height = 200;
  if (activeIndicators.value.includes('rsi')) height += 60;
  if (activeIndicators.value.includes('macd')) height += 60;
  return height + 'px';
});

const candles: Ref<CandlestickDataPoint[]> = ref([]);
const candlesLoading = ref(true);

/** Map selected currency to the backend currency param (ada/usd/eur) */
function candleCurrency(): string {
  if (selectedCurrency.value === 'NATIVE') return 'ada';
  return selectedCurrency.value.toLowerCase();
}

// Backend returns candles already converted — just pass through
const convertedCandles = computed(() => candles.value);

const staleDataWarning = computed(() => {
  if (!candles.value.length) return '';
  const lastCandle = candles.value[candles.value.length - 1];
  const lastTime = typeof lastCandle.time === 'number' ? lastCandle.time * 1000 : new Date(lastCandle.time as string).getTime();
  const daysSince = (Date.now() - lastTime) / 86400000;
  if (daysSince > 7) {
    return `Chart data last updated ${Math.floor(daysSince)} days ago`;
  }
  return '';
});

let candleRequestId = 0;
async function loadCandles() {
  const requestId = ++candleRequestId;
  candlesLoading.value = true;

  try {
    const result = await getTokenCandles(
      props.token.unit === 'lovelace' ? 'lovelace' : props.token.unit,
      selectedTimeframe.value,
      candleCurrency(),
    );
    if (requestId === candleRequestId) {
      candles.value = result;
    }
  } finally {
    if (requestId === candleRequestId) {
      candlesLoading.value = false;
    }
  }
}

// Load candles on setup
loadCandles();

// Compact stats for the right column grid (removed liquidity, kept essentials)
const compactStats = computed(() => {
  const tok = props.token;
  const sym = currencySymbol.value;
  return [
    { label: t('market.marketCap'), value: tok.mcap != null ? sym + formatCompact(convertUsd(tok.mcap)) : t('market.na') },
    { label: t('market.volume24h'), value: sym + formatCompact(convertUsd(tok.volume24h)) },
    { label: t('market.tvl'), value: tok.tvl ? sym + formatCompact(convertUsd(tok.tvl)) : t('market.na') },
    {
      label: t('market.verified'),
      value: tok.verified ? '✓' : t('market.no'),
    },
  ];
});

function toggleWatch(unit: string) {
  toggleWatchlist(unit);
}

function onSwapComplete() {
  // Could refresh token data or recent trades here
}

function copyPolicyId() {
  if (tokenPolicyId.value) {
    navigator.clipboard.writeText(tokenPolicyId.value)
      .then(() => snackbar.fireSuccess(t('market.policyIdCopied')))
      .catch(() => snackbar.fireError(t('market.copyFailed')));
  }
}

/** Convert a native-token value to the selected currency */
function convertAda(adaValue: number): number {
  switch (selectedCurrency.value) {
    case 'USD': return adaValue * adaUsdPrice.value;
    case 'EUR': return adaValue * adaUsdPrice.value * (usdToEurRate.value || 1);
    case 'NATIVE':
    default: return adaValue;
  }
}

function formatPnlValue(adaValue: number | null): string {
  if (adaValue == null) return '—';
  const converted = convertAda(adaValue);
  const decimals = converted < 1 ? 6 : 2;
  return currencySymbol.value + converted.toFixed(decimals);
}

function formatPnlSigned(adaValue: number): string {
  const converted = convertAda(adaValue);
  const sign = converted >= 0 ? '+' : '';
  return sign + currencySymbol.value + converted.toFixed(2);
}

import { formatPriceRaw, formatPrice, formatCompact, formatSignedChange } from '@/modules/market/utils/formatters';

function openExplorer() {
  const fingerprint = props.token.fingerprint;
  const url = isApex.value
    ? `https://apexscan.org/en/token/${fingerprint}`
    : `https://cardanoscan.io/token/${fingerprint}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

// Reset timeframe and reload candles when token changes
watch(() => props.token, () => {
  selectedTimeframe.value = '1h';
  rightTab.value = 'swap';
  loadCandles();
});

// Reload candles when timeframe or currency changes
watch(selectedTimeframe, () => {
  loadCandles();
});

watch(selectedCurrency, () => {
  loadCandles();
});
</script>

<style scoped>
.token-detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  /* 70% of content area (viewport minus 270px nav drawer) */
  width: calc(70 * (100vw - 270px) / 100);
  z-index: var(--g-z-sticky);
  /* Darker surface so the chart / swap / info cards read as RAISED above the
     drawer frame (they were all the same overlay tone = flat). */
  background: var(--g-surface) !important;
  border-left: 1px solid var(--g-hairline-2) !important;
  border-radius: 0 var(--g-r-card) var(--g-r-card) 0;
  overflow: hidden;
  box-shadow: var(--g-shadow-sheet);
  animation: panelSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* Raised card wrappers give the chart and the swap widget depth against the
   darker drawer frame. */
.chart-shell,
.swap-shell {
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 10px;
}

.chart-shell {
  margin-top: 4px;
}

@keyframes panelSlideIn {
  from {
    transform: translateX(40px);
    opacity: 0.6;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

/* ═══ Two-column layout ═══ */
.panel-columns {
  display: flex;
  height: calc(100% - 60px);
  overflow: hidden;
}

.left-col {
  flex: 6;
  overflow-y: auto;
  padding: 0 16px 16px;
  border-right: 1px solid var(--g-hairline-1);
  scroll-behavior: smooth;
}

/* Persistent DUST registration confirmation row (gold, matches the DUST line). */
.dust-reg-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 12px;
}

.dust-reg-chip {
  padding: 1px 7px;
  border-radius: var(--g-r-chip);
  background: rgba(232, 199, 137, 0.14);
  color: rgb(245, 224, 178);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.dust-reg-status {
  color: var(--g-text-2);
}

.dust-reg-status.is-live {
  color: rgb(245, 224, 178);
}

.dust-reg-tx {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: var(--g-font-mono);
  color: var(--g-text-3);
  text-decoration: none;
}

.dust-reg-tx:hover {
  color: var(--g-accent);
}

.right-col {
  flex: 4;
  overflow-y: auto;
  padding: 0 16px 16px;
  scroll-behavior: smooth;
}

/* ═══ Chart controls ═══ */
.timeframe-bar {
  display: flex;
  align-items: center;
  gap: 1px;
  background: var(--g-hairline-1);
  border-radius: 4px;
  padding: 1px;
}

.tf-btn {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--g-text-3);
  user-select: none;
  transition: color 0.15s, background 0.15s;
}

.tf-btn:hover {
  color: var(--g-text-2);
}

.tf-btn.active {
  color: var(--g-text-1);
  background: var(--g-hairline-2);
}

.ind-btn {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 5px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--g-text-3);
  user-select: none;
  transition: color 0.15s, background 0.15s;
}

.ind-btn:hover {
  color: var(--g-text-2);
}

.ind-btn.active {
  color: var(--g-info);
  background: var(--g-hairline-2);
}

/* ═══ Token info grid ═══ */
.token-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  transition: border-color var(--g-dur-fast) ease, background-color var(--g-dur-fast) ease;
}

.info-item:hover {
  border-color: var(--g-hairline-2);
  background: var(--g-overlay);
}

/* Label is the quiet tier; the value is the bright answer. The tone gap is the
   hierarchy - without it the tile reads as one flat block of mid-grey. */
.info-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--g-text-3);
}

.info-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
  font-variant-numeric: tabular-nums;
}

/* ═══ Policy row ═══ */
.policy-row {
  padding: 6px 8px;
  background: var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

.policy-id {
  font-size: 11px;
  font-family: var(--g-font-mono);
  word-break: break-all;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
}

.policy-id:hover {
  opacity: 1;
}

/* ═══ P&L / Stats ═══ */
.pnl-section {
  border-top: 1px solid var(--g-hairline-1);
  padding-top: 12px;
}

/* Label muted, value bright/tabular - the same tone hierarchy as the info grid.
   Scoped under .stats-table td so they beat Vuetify's cell padding on
   specificity alone (no override flag needed). */
.stats-table td.pnl-cell-label {
  width: 40%;
  font-size: 12px;
  padding: 5px 8px;
  color: var(--g-text-3);
}
.stats-table td.pnl-cell-value {
  font-size: 13px;
  font-weight: 600;
  padding: 5px 8px;
}
.stats-table td.pnl-cell-total {
  font-weight: 700;
  color: var(--g-text-1);
}

.stats-table >>> td {
  border-bottom: 1px solid var(--g-hairline-1) !important;
}

.stats-table >>> tr:last-child td {
  border-bottom: none !important;
}

/* ═══ Tab transitions ═══ */
.tab-fade-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.tab-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.tab-fade-enter {
  opacity: 0;
  transform: translateY(6px);
}
.tab-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ═══ Stagger fade-in for info grid items ═══ */
.token-info-grid .info-item {
  animation: infoFadeIn 0.25s ease both;
}
.token-info-grid .info-item:nth-child(1) { animation-delay: 0.03s; }
.token-info-grid .info-item:nth-child(2) { animation-delay: 0.06s; }
.token-info-grid .info-item:nth-child(3) { animation-delay: 0.09s; }
.token-info-grid .info-item:nth-child(4) { animation-delay: 0.12s; }
.token-info-grid .info-item:nth-child(5) { animation-delay: 0.15s; }
.token-info-grid .info-item:nth-child(6) { animation-delay: 0.18s; }

@keyframes infoFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ═══ Tabs ═══ */
.detail-sub-tabs >>> .v-tab {
  text-transform: none !important;
  font-size: 12px;
  min-width: unset;
  padding: 0 10px;
  letter-spacing: 0;
  transition: color 0.15s ease;
}

.detail-sub-tabs >>> .v-tabs-slider {
  height: 2px;
  transition: left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ═══ Currency pills ═══ */
.currency-pills {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 2px;
  width: fit-content;
}

.currency-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--g-text-3);
  user-select: none;
  transition: color 0.15s, background 0.15s;
}

.currency-pill:hover {
  color: var(--g-text-2);
}

.currency-pill.active {
  color: var(--g-text-1);
  background: var(--g-hairline-2);
}

.chart-no-data {
  border-radius: var(--g-r-control);
  border: 1px solid var(--g-hairline-1);
  background: var(--g-surface);
}
</style>
