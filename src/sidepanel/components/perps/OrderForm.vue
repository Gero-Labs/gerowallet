<template>
  <div class="order-form">
    <!-- Side Toggle -->
    <v-btn-toggle v-model="side" mandatory class="side-toggle">
      <v-btn value="buy" class="side-btn side-btn--buy" :class="{ active: side === 'buy' }">
        <v-icon size="13" class="mr-1">mdi-arrow-up</v-icon>
        {{ $t('perpetuals.placeBuyOrder') }}
      </v-btn>
      <v-btn value="sell" class="side-btn side-btn--sell" :class="{ active: side === 'sell' }">
        <v-icon size="13" class="mr-1">mdi-arrow-down</v-icon>
        {{ $t('perpetuals.placeSellOrder') }}
      </v-btn>
    </v-btn-toggle>

    <!-- Order Type -->
    <div class="order-type-row">
      <button
        v-for="ot in orderTypes"
        :key="ot.value"
        class="ot-chip"
        :class="{ 'ot-chip--active': orderType === ot.value }"
        @click="orderType = ot.value"
      >
        {{ $t(ot.label) }}
      </button>
    </div>

    <!-- Leverage + Margin Mode row -->
    <div class="lev-margin-row">
      <button class="lev-badge" @click="leverageDialog = true">
        <v-icon size="11" class="mr-1" style="color:#00c7f3">mdi-lightning-bolt</v-icon>
        {{ localLeverage }}x
      </button>
      <span class="margin-mode-label">
        {{ $t('perpetuals.marginCross') }}
      </span>
    </div>

    <!-- Price Input (limit / stop_limit / take_profit_limit) -->
    <v-text-field
      v-if="showPriceInput"
      v-model="price"
      :label="$t('perpetuals.price')"
      outlined
      dense
      dark
      hide-details
      class="perp-input mb-2"
      suffix="USD"
      type="number"
      min="0"
    />

    <!-- Trigger Price (stop, stop_limit) -->
    <v-text-field
      v-if="showTriggerInput"
      v-model="stopPrice"
      :label="$t('perpetuals.triggerPrice')"
      outlined
      dense
      dark
      hide-details
      class="perp-input mb-2"
      suffix="USD"
      type="number"
      min="0"
    />

    <!-- Size Input -->
    <v-text-field
      v-model="size"
      :label="$t('perpetuals.size')"
      outlined
      dense
      dark
      hide-details
      class="perp-input mb-1"
      :suffix="baseAsset"
      type="number"
      min="0"
    />

    <!-- Size % Slider -->
    <div class="pct-slider-row">
      <button
        v-for="pct in [25, 50, 75, 100]"
        :key="pct"
        class="pct-btn"
        :class="{ 'pct-btn--active': sizePercent === pct }"
        @click="applySizePercent(pct)"
      >{{ pct }}%</button>
    </div>
    <v-slider
      v-model="sizePercent"
      :min="0"
      :max="100"
      :step="1"
      dense
      hide-details
      class="perp-slider mb-2"
      :color="side === 'buy' ? '#26FAB0' : '#F97066'"
      track-color="rgba(255,255,255,0.1)"
      @input="onSliderChange"
    />

    <!-- TP/SL Toggle -->
    <div class="tpsl-header" @click="showTpSl = !showTpSl">
      <span class="tpsl-label">TP / SL</span>
      <v-icon size="14" class="tpsl-chevron" :class="{ rotated: showTpSl }">
        mdi-chevron-down
      </v-icon>
    </div>
    <div v-if="showTpSl" class="tpsl-body">
      <v-text-field
        v-model="tpPrice"
        :label="$t('perpetuals.takeProfitPrice')"
        outlined
        dense
        dark
        hide-details
        class="perp-input mb-2"
        suffix="USD"
        type="number"
        min="0"
      />
      <v-text-field
        v-model="slPrice"
        :label="$t('perpetuals.stopLossPrice')"
        outlined
        dense
        dark
        hide-details
        class="perp-input"
        suffix="USD"
        type="number"
        min="0"
      />
    </div>

    <!-- Advanced Toggles -->
    <div class="advanced-row">
      <label class="adv-check">
        <input type="checkbox" v-model="reduceOnly" class="adv-checkbox" />
        <span class="adv-checkmark"></span>
        {{ $t('perpetuals.reduceOnly') }}
      </label>
      <label class="adv-check" v-if="orderType === 'limit' || orderType === 'stop_limit'">
        <input type="checkbox" v-model="postOnly" class="adv-checkbox" />
        <span class="adv-checkmark"></span>
        {{ $t('perpetuals.postOnly') }}
      </label>
    </div>

    <!-- Margin Info -->
    <div class="margin-info-row">
      <div class="margin-info-item">
        <span class="mi-label">{{ $t('perpetuals.availableBalance') }}</span>
        <span class="mi-value">{{ availableBalance ? parseFloat(availableBalance).toFixed(2) : '—' }} <span class="mi-unit">USD</span></span>
      </div>
      <div class="margin-info-item">
        <span class="mi-label">{{ $t('perpetuals.collateral') }}</span>
        <span class="mi-value">{{ estimatedMargin }} <span class="mi-unit">USD</span></span>
      </div>
    </div>

    <!-- Live Estimates -->
    <transition name="estimates-fade">
      <div v-if="hasValidSize" class="estimates-block">
        <div v-if="orderType === 'market'" class="est-row">
          <span class="est-label">{{ $t('perpetuals.estEntryPrice') }}</span>
          <span class="est-value">{{ estEntryPriceDisplay }}</span>
        </div>
        <div class="est-row">
          <span class="est-label">{{ $t('perpetuals.estLiqPrice') }}</span>
          <span class="est-value">{{ estLiquidationPriceDisplay }}</span>
        </div>
        <div class="est-row">
          <span class="est-label">{{ $t('perpetuals.requiredMargin') }}</span>
          <span class="est-value">{{ requiredMarginDisplay }} <span class="mi-unit">USD</span></span>
        </div>
        <div class="est-row">
          <span class="est-label">{{ $t('perpetuals.estFee') }}</span>
          <span class="est-value">{{ estFeeDisplay }} <span class="mi-unit">USD</span></span>
        </div>
        <div v-if="slippageWarning" class="est-warning">
          <v-icon size="11" class="est-warning-icon">mdi-alert-outline</v-icon>
          <span>{{ slippageWarning }}</span>
        </div>
      </div>
    </transition>

    <!-- Place Order Button -->
    <v-btn
      block
      depressed
      :loading="submitting"
      :disabled="!canSubmit"
      class="place-order-btn"
      :class="side === 'buy' ? 'place-order-btn--buy' : 'place-order-btn--sell'"
      @click="handleSubmit()"
    >
      <v-icon size="14" class="mr-1">{{ side === 'buy' ? 'mdi-arrow-up-bold' : 'mdi-arrow-down-bold' }}</v-icon>
      {{ side === 'buy' ? $t('perpetuals.placeBuyOrder') : $t('perpetuals.placeSellOrder') }}
    </v-btn>

    <!-- Leverage Dialog -->
    <v-dialog v-model="leverageDialog" max-width="300" content-class="perp-dialog">
      <div class="lev-dialog-content">
        <div class="lev-dialog-title">{{ $t('perpetuals.leverage') }}</div>
        <div class="lev-value-display">{{ localLeverage }}<span class="lev-x">x</span></div>
        <v-slider
          v-model="localLeverage"
          :min="1"
          :max="125"
          :step="1"
          hide-details
          class="perp-slider lev-slider"
          color="#00c7f3"
          track-color="rgba(255,255,255,0.1)"
        />
        <div class="lev-presets">
          <button
            v-for="lv in [1, 5, 10, 25, 50, 100, 125]"
            :key="lv"
            class="lev-preset-btn"
            :class="{ active: localLeverage === lv }"
            @click="localLeverage = lv"
          >{{ lv }}x</button>
        </div>
        <v-btn block depressed class="lev-confirm-btn" @click="confirmLeverage()">
          {{ $t('perpetuals.leverage') }}: {{ localLeverage }}x
        </v-btn>
      </div>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useStrikeTrading } from '@/modules/market/composables/useStrikeTrading';
import { useStrikeMarket } from '@/modules/market/composables/useStrikeMarket';
import { strikeMarketApi } from '@/api/strike-v2.market';
import {
  calcLiquidationPriceIsolated,
  calcVwapMarketFill,
  getMarginTier,
  normalizeMarginTiers,
} from '@/modules/market/math';
import type {
  CreateOrderRequest, OrderType, OrderSide, StrikeMarketConfig, MarginTierNumeric,
} from '@/api/strike-v2.types';

// ── Props & Emits ────────────────────────────────────────────────────────────
const props = defineProps<{
  symbol: string;
}>();

const emit = defineEmits<{
  (e: 'order-placed'): void;
}>();

// ── Composables ──────────────────────────────────────────────────────────────
const { placeOrder, setLeverage, availableBalance, account } = useStrikeTrading();
const { getSymbolInfo, getTicker } = useStrikeMarket();

// ── Market config (margin tiers, tick size) — fetched once per session ──────
const marketConfig = ref<StrikeMarketConfig | null>(null);
const marketTiers = computed<MarginTierNumeric[]>(() =>
  marketConfig.value?.margin_tiers ? normalizeMarginTiers(marketConfig.value.margin_tiers) : [],
);

// Slim order-book snapshot for VWAP (refreshed on size change)
const obAsks = ref<[string, string][]>([]);
const obBids = ref<[string, string][]>([]);

async function loadMarketConfig() {
  try {
    const res = await strikeMarketApi.getMarkets();
    marketConfig.value = res.markets[props.symbol] ?? null;
  } catch {
    marketConfig.value = null;
  }
}

let obFetchTimer: ReturnType<typeof setTimeout> | null = null;
async function refreshOrderBookSnapshot() {
  if (orderType.value !== 'market') return;
  try {
    const snap = await strikeMarketApi.getOrderBook(props.symbol, 50);
    obAsks.value = snap.asks ?? [];
    obBids.value = snap.bids ?? [];
  } catch { /* keep previous snapshot */ }
}

function scheduleObRefresh() {
  if (obFetchTimer) clearTimeout(obFetchTimer);
  obFetchTimer = setTimeout(() => { refreshOrderBookSnapshot(); }, 250);
}

onMounted(() => {
  loadMarketConfig();
});

// ── Local State ──────────────────────────────────────────────────────────────
const side = ref<'buy' | 'sell'>('buy');
const orderType = ref<OrderType>('market');
const price = ref<string>('');
const stopPrice = ref<string>('');
const size = ref<string>('');
const tpPrice = ref<string>('');
const slPrice = ref<string>('');
const reduceOnly = ref(false);
const postOnly = ref(false);
const showTpSl = ref(false);
const leverageDialog = ref(false);
const localLeverage = ref(10);
const submitting = ref(false);
const sizePercent = ref(0);

// ── Order Type Config ────────────────────────────────────────────────────────
const orderTypes = [
  { value: 'market' as OrderType, label: 'perpetuals.orderTypeMarket' },
  { value: 'limit' as OrderType, label: 'perpetuals.orderTypeLimit' },
  { value: 'stop' as OrderType, label: 'perpetuals.orderTypeStop' },
  { value: 'stop_limit' as OrderType, label: 'perpetuals.orderTypeStopLimit' },
];

// ── Computed ─────────────────────────────────────────────────────────────────
const showPriceInput = computed(() =>
  ['limit', 'stop_limit', 'take_profit_limit'].includes(orderType.value),
);

const showTriggerInput = computed(() =>
  ['stop', 'stop_limit', 'take_profit', 'take_profit_limit'].includes(orderType.value),
);

const symbolInfo = computed(() => getSymbolInfo(props.symbol));

const baseAsset = computed(() => symbolInfo.value?.baseAsset ?? props.symbol.replace('USDT', ''));

const estimatedMargin = computed(() => {
  const s = parseFloat(size.value);
  if (!s || s <= 0) return '—';
  const p = parseFloat(price.value) || 1;
  const notional = orderType.value === 'market' ? s : s * p;
  return (notional / localLeverage.value).toFixed(2);
});

const canSubmit = computed(() => {
  if (!size.value || parseFloat(size.value) <= 0) return false;
  if (showPriceInput.value && (!price.value || parseFloat(price.value) <= 0)) return false;
  if (showTriggerInput.value && (!stopPrice.value || parseFloat(stopPrice.value) <= 0)) return false;
  return true;
});

// ── Live Estimates ───────────────────────────────────────────────────────────

const sizeNum = computed(() => parseFloat(size.value) || 0);
const hasValidSize = computed(() => sizeNum.value > 0);

const tickerLastPrice = computed(() => parseFloat(getTicker(props.symbol)?.lastPrice ?? '0') || 0);

/** Reference price used for non-VWAP estimates (limit price or last ticker). */
const refPriceForEstimates = computed(() => {
  if (orderType.value === 'market') {
    return tickerLastPrice.value;
  }
  return parseFloat(price.value) || tickerLastPrice.value;
});

const DEFAULT_TAKER_RATE = 0.0006;

/** Side normalised to LONG/SHORT for math layer. */
const sideUpper = computed<'LONG' | 'SHORT'>(() => (side.value === 'buy' ? 'LONG' : 'SHORT'));

/** VWAP fill estimate for market orders. */
const marketFill = computed(() => {
  if (orderType.value !== 'market' || sizeNum.value <= 0) return null;
  const levels = side.value === 'buy' ? obAsks.value : obBids.value;
  if (!levels.length) return null;
  return calcVwapMarketFill(levels, sizeNum.value);
});

const estEntryPrice = computed(() => {
  if (orderType.value === 'market') {
    return marketFill.value?.avgPrice ?? tickerLastPrice.value;
  }
  return refPriceForEstimates.value;
});

const notional = computed(() => sizeNum.value * estEntryPrice.value);

const requiredMargin = computed(() => {
  const lev = localLeverage.value || 1;
  if (notional.value <= 0 || lev <= 0) return 0;
  return notional.value / lev;
});

const estFee = computed(() => notional.value * DEFAULT_TAKER_RATE);

const estLiquidationPrice = computed(() => {
  if (notional.value <= 0 || estEntryPrice.value <= 0) return 0;
  const tier = getMarginTier(marketTiers.value, notional.value);
  if (!tier) return 0;
  // Use cross-as-isolated approximation: isoBalance = notional / leverage.
  // This matches the dashboard form's preview and avoids depending on the
  // full cross context (other positions, wallet balance) which the side
  // panel form does not have.
  const isoBalance = requiredMargin.value;
  return calcLiquidationPriceIsolated(
    sideUpper.value, estEntryPrice.value, isoBalance, sizeNum.value, tier,
  );
});

const pricePrecision = computed(() => marketConfig.value?.quote_prec ?? 4);

function fmtMoney(value: number, dp = 2): string {
  if (!isFinite(value) || value === 0) return '—';
  return value.toFixed(dp);
}

const estEntryPriceDisplay = computed(() => {
  if (estEntryPrice.value <= 0) return '—';
  return `$${estEntryPrice.value.toFixed(pricePrecision.value)}`;
});

const estLiquidationPriceDisplay = computed(() => {
  if (estLiquidationPrice.value <= 0) return '—';
  return `$${estLiquidationPrice.value.toFixed(pricePrecision.value)}`;
});

const requiredMarginDisplay = computed(() => fmtMoney(requiredMargin.value));
const estFeeDisplay = computed(() => fmtMoney(estFee.value));

/** Slippage warning shown when VWAP fill exceeds 50bps vs top-of-book. */
const slippageWarning = computed(() => {
  const fill = marketFill.value;
  if (!fill) return '';
  if (fill.insufficientDepth) {
    return 'Order exceeds available book depth';
  }
  if (fill.slippageBps > 50) {
    return `High slippage: ~${(fill.slippageBps / 100).toFixed(2)}%`;
  }
  return '';
});

// Refresh OB snapshot when size changes for market orders
watch([sizeNum, side, orderType], () => {
  if (orderType.value === 'market' && sizeNum.value > 0) {
    scheduleObRefresh();
  }
});

watch(() => props.symbol, () => {
  marketConfig.value = null;
  obAsks.value = [];
  obBids.value = [];
  loadMarketConfig();
});

// ── Methods ──────────────────────────────────────────────────────────────────
function applySizePercent(pct: number) {
  sizePercent.value = pct;
  onSliderChange(pct);
}

function onSliderChange(pct: number) {
  if (!availableBalance.value) return;
  const avail = parseFloat(availableBalance.value);
  if (isNaN(avail) || avail <= 0) return;
  const notional = avail * localLeverage.value * (pct / 100);
  const p = parseFloat(price.value);
  const refPrice = p > 0 ? p : 1;
  const qty = notional / refPrice;
  const precision = symbolInfo.value?.quantityPrecision ?? 3;
  size.value = qty.toFixed(precision);
}

async function handleSubmit() {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  try {
    const req: CreateOrderRequest & { takeProfitPrice?: string; stopLossPrice?: string } = {
      symbol: props.symbol,
      side: side.value as OrderSide,
      type: orderType.value,
      size: size.value,
      ...(showPriceInput.value && price.value ? { price: price.value } : {}),
      ...(showTriggerInput.value && stopPrice.value ? { stop_price: stopPrice.value } : {}),
      reduce_only: reduceOnly.value,
      post_only: postOnly.value,
      ...(tpPrice.value ? { takeProfitPrice: tpPrice.value } : {}),
      ...(slPrice.value ? { stopLossPrice: slPrice.value } : {}),
    };
    const result = await placeOrder(req);
    if (result) emit('order-placed');
  } finally {
    submitting.value = false;
  }
}

async function confirmLeverage() {
  leverageDialog.value = false;
  await setLeverage(props.symbol, localLeverage.value);
}

// ── Watchers ─────────────────────────────────────────────────────────────────
watch(() => props.symbol, () => {
  price.value = '';
  stopPrice.value = '';
  size.value = '';
  sizePercent.value = 0;
});

watch(() => account.value, (acc) => {
  if (!acc) return;
  const setting = acc.symbol_settings?.find((s) => s.symbol === props.symbol);
  if (setting?.leverage) localLeverage.value = setting.leverage;
}, { immediate: true });
</script>

<style scoped>
.order-form {
  padding: 10px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Side Toggle ── */
.side-toggle {
  width: 100%;
  display: flex !important;
  border-radius: 8px !important;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04) !important;
  border: 1px solid rgba(255, 255, 255, 0.07) !important;
  margin-bottom: 8px;
  height: 34px !important;
}

.side-btn {
  flex: 1 !important;
  height: 34px !important;
  min-width: 0 !important;
  border-radius: 6px !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  letter-spacing: 0.04em !important;
  text-transform: none !important;
  color: rgba(255, 255, 255, 0.35) !important;
  background: transparent !important;
  transition: all 0.18s ease !important;
  border: none !important;
}

.side-btn--buy.active,
.side-btn--buy.v-btn--active {
  color: #26FAB0 !important;
  background: rgba(38, 250, 176, 0.1) !important;
}

.side-btn--sell.active,
.side-btn--sell.v-btn--active {
  color: #F97066 !important;
  background: rgba(249, 112, 102, 0.1) !important;
}

/* ── Order Type Chips ── */
.order-type-row {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.ot-chip {
  padding: 3px 9px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: all 0.15s ease;
}

.ot-chip--active {
  border-color: #00c7f3;
  color: #00c7f3;
  background: rgba(0, 199, 243, 0.1);
}

/* ── Leverage / Margin Mode ── */
.lev-margin-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.lev-badge {
  display: flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
  color: #00c7f3;
  background: rgba(0, 199, 243, 0.1);
  border: 1px solid rgba(0, 199, 243, 0.25);
  cursor: pointer;
  transition: background 0.15s ease;
}

.lev-badge:hover {
  background: rgba(0, 199, 243, 0.18);
}

.margin-mode-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  font-weight: 500;
}

/* ── Inputs ── */
.perp-input :deep(.v-input__slot) {
  background: rgba(255, 255, 255, 0.04) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
  min-height: 34px !important;
}

.perp-input :deep(.v-label) {
  font-size: 11px !important;
  color: rgba(255, 255, 255, 0.4) !important;
}

.perp-input :deep(input) {
  font-size: 12px !important;
  font-family: 'JetBrains Mono', 'Fira Code', monospace !important;
  color: #ffffff !important;
  caret-color: #00c7f3 !important;
  padding: 0 8px !important;
}

.perp-input :deep(.v-text-field__suffix) {
  font-size: 10px !important;
  color: rgba(255, 255, 255, 0.35) !important;
  font-weight: 600 !important;
  margin-top: 0 !important;
}

.perp-input :deep(fieldset) {
  border-color: rgba(255, 255, 255, 0.1) !important;
}

.perp-input :deep(.v-input__slot:hover fieldset) {
  border-color: rgba(255, 255, 255, 0.22) !important;
}

.perp-input :deep(.v-input--is-focused fieldset) {
  border-color: #00c7f3 !important;
}

/* ── Size % Buttons ── */
.pct-slider-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 2px;
}

.pct-btn {
  flex: 1;
  padding: 2px 0;
  font-size: 9px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 3px;
  cursor: pointer;
  margin: 0 1px;
  transition: all 0.12s ease;
}

.pct-btn--active,
.pct-btn:hover {
  color: #00c7f3;
  border-color: rgba(0, 199, 243, 0.3);
  background: rgba(0, 199, 243, 0.08);
}

/* ── Slider ── */
.perp-slider {
  margin: 0 !important;
  padding: 0 !important;
}

.perp-slider :deep(.v-slider__thumb) {
  width: 12px !important;
  height: 12px !important;
}

.perp-slider :deep(.v-slider__track-container) {
  height: 3px !important;
}

/* ── TP/SL ── */
.tpsl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0 4px;
  cursor: pointer;
  user-select: none;
}

.tpsl-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
}

.tpsl-chevron {
  color: rgba(255, 255, 255, 0.3) !important;
  transition: transform 0.2s ease;
}

.tpsl-chevron.rotated {
  transform: rotate(180deg);
}

.tpsl-body {
  padding-bottom: 2px;
}

/* ── Advanced Toggles ── */
.advanced-row {
  display: flex;
  gap: 12px;
  padding: 6px 0;
}

.adv-check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  user-select: none;
}

.adv-checkbox {
  display: none;
}

.adv-checkmark {
  width: 12px;
  height: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.04);
  flex-shrink: 0;
  position: relative;
  transition: all 0.12s ease;
}

.adv-checkbox:checked + .adv-checkmark {
  background: #00c7f3;
  border-color: #00c7f3;
}

.adv-checkbox:checked + .adv-checkmark::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 0px;
  width: 6px;
  height: 9px;
  border: 2px solid #000;
  border-top: none;
  border-left: none;
  transform: rotate(45deg) scaleY(0.7);
}

/* ── Margin Info ── */
.margin-info-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 8px;
}

.margin-info-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.mi-label {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.3);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.mi-value {
  font-size: 11px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
}

.mi-unit {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.35);
  font-weight: 400;
}

/* ── Place Order Button ── */
.place-order-btn {
  height: 38px !important;
  border-radius: 8px !important;
  font-size: 12px !important;
  font-weight: 700 !important;
  letter-spacing: 0.04em !important;
  text-transform: none !important;
}

.place-order-btn--buy {
  background: rgba(38, 250, 176, 0.15) !important;
  color: #26FAB0 !important;
  border: 1px solid rgba(38, 250, 176, 0.3) !important;
}

.place-order-btn--buy:not(.v-btn--disabled):hover {
  background: rgba(38, 250, 176, 0.22) !important;
}

.place-order-btn--sell {
  background: rgba(249, 112, 102, 0.15) !important;
  color: #F97066 !important;
  border: 1px solid rgba(249, 112, 102, 0.3) !important;
}

.place-order-btn--sell:not(.v-btn--disabled):hover {
  background: rgba(249, 112, 102, 0.22) !important;
}

.place-order-btn.v-btn--disabled {
  opacity: 0.4 !important;
}

/* ── Leverage Dialog ── */
:deep(.perp-dialog) {
  background: #0f1117 !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6) !important;
}

.lev-dialog-content {
  padding: 20px;
}

.lev-dialog-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 8px;
}

.lev-value-display {
  font-size: 40px;
  font-weight: 800;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: #00c7f3;
  line-height: 1;
  margin-bottom: 12px;
}

.lev-x {
  font-size: 20px;
  opacity: 0.6;
}

.lev-slider {
  margin-bottom: 12px !important;
}

.lev-presets {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.lev-preset-btn {
  padding: 4px 8px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: all 0.12s ease;
}

.lev-preset-btn.active,
.lev-preset-btn:hover {
  color: #00c7f3;
  border-color: rgba(0, 199, 243, 0.35);
  background: rgba(0, 199, 243, 0.1);
}

.lev-confirm-btn {
  background: rgba(0, 199, 243, 0.15) !important;
  color: #00c7f3 !important;
  border: 1px solid rgba(0, 199, 243, 0.3) !important;
  border-radius: 8px !important;
  font-size: 12px !important;
  font-weight: 700 !important;
  text-transform: none !important;
}

/* ── Live Estimates ── */
.estimates-block {
  margin: 4px 0 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.est-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  line-height: 14px;
}

.est-label {
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 0.02em;
}

.est-value {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
}

.est-warning {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding: 4px 6px;
  border-radius: 4px;
  background: rgba(246, 190, 66, 0.08);
  border: 1px solid rgba(246, 190, 66, 0.2);
  color: #f6be42;
  font-size: 10px;
  line-height: 12px;
}

.est-warning-icon {
  color: #f6be42 !important;
}

.estimates-fade-enter-active,
.estimates-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.estimates-fade-enter,
.estimates-fade-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
</style>
