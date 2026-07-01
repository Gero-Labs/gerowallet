<template>
  <div class="col-right">
    <div class="order-form-scroll">

      <!-- Margin mode / Leverage / Position mode -->
      <div class="of-margin-row">
        <v-btn x-small outlined class="of-top-btn" @click="pendingMarginMode = marginMode; showMarginDialog = true">
          {{ marginMode === 'cross' ? $t('perpetuals.cross') : $t('perpetuals.isolated') }}
        </v-btn>
        <v-btn x-small outlined class="of-top-btn" @click="pendingLeverage = leverage; showLeverageDialog = true">
          {{ leverage }}x
        </v-btn>
        <v-btn x-small outlined class="of-top-btn" @click="showPosModeDialog = true">
          {{ $t('perpetuals.oneWay') }}
        </v-btn>
      </div>

      <!-- Margin Mode Dialog -->
      <v-dialog v-model="showMarginDialog" max-width="420" dark>
        <v-card class="perps-modal">
          <div class="perps-modal__header">
            <span class="perps-modal__title">{{ $t('perpetuals.marginMode') }}</span>
            <v-icon size="20" @click="showMarginDialog = false" class="perps-modal__close">mdi-close</v-icon>
          </div>
          <div class="perps-modal__body">
            <div
              class="perps-modal__option"
              :class="{ 'perps-modal__option--active': pendingMarginMode === 'cross' }"
              @click="pendingMarginMode = 'cross'"
            >
              <v-icon size="20" :color="pendingMarginMode === 'cross' ? '#26FAB0' : '#848e9c'" class="mr-2">
                {{ pendingMarginMode === 'cross' ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
              </v-icon>
              <div>
                <div class="perps-modal__option-title">{{ $t('perpetuals.cross') }}</div>
                <div class="perps-modal__option-desc">{{ $t('perpetuals.crossDesc') }}</div>
              </div>
            </div>
            <div
              class="perps-modal__option"
              :class="{ 'perps-modal__option--active': pendingMarginMode === 'isolated' }"
              @click="pendingMarginMode = 'isolated'"
            >
              <v-icon size="20" :color="pendingMarginMode === 'isolated' ? '#26FAB0' : '#848e9c'" class="mr-2">
                {{ pendingMarginMode === 'isolated' ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
              </v-icon>
              <div>
                <div class="perps-modal__option-title">{{ $t('perpetuals.isolated') }}</div>
                <div class="perps-modal__option-desc">{{ $t('perpetuals.isolatedDesc') }}</div>
              </div>
            </div>
          </div>
          <v-btn block color="#26FAB0" class="perps-modal__confirm" @click="applyMarginMode()">
            {{ $t('perpetuals.confirm') }}
          </v-btn>
        </v-card>
      </v-dialog>

      <!-- Leverage Dialog -->
      <v-dialog v-model="showLeverageDialog" max-width="420" dark>
        <v-card class="perps-modal">
          <div class="perps-modal__header">
            <span class="perps-modal__title">{{ $t('perpetuals.adjustLeverage') }}</span>
            <v-icon size="20" @click="showLeverageDialog = false" class="perps-modal__close">mdi-close</v-icon>
          </div>
          <div class="perps-modal__body text-center">
            <div class="leverage-display">{{ pendingLeverage }}x</div>
            <div class="leverage-max">{{ $t('perpetuals.maxLeverage') }}: {{ maxLeverage }}x</div>
            <v-slider
              v-model="pendingLeverage"
              min="1"
              :max="maxLeverage"
              step="1"
              color="#4efab080"
              track-color="#ffffff1a"
              hide-details
              class="mt-4 custom-slider"
              ticks="always"
              tick-size="4"
            />
            <div class="d-flex justify-space-between mt-1">
              <span class="slider-tick">1x</span>
              <span class="slider-tick">{{ maxLeverage }}x</span>
            </div>
          </div>
          <v-btn block color="#26FAB0" class="perps-modal__confirm" @click="leverage = pendingLeverage; applyLeverage(); showLeverageDialog = false">
            {{ $t('perpetuals.confirm') }}
          </v-btn>
          <div class="leverage-warning mt-3">
            {{ $t('perpetuals.leverageWarning') }}
          </div>
          <div class="leverage-max-size mt-2 text-center">
            {{ $t('perpetuals.maxPositionSize') }}: $5,000
          </div>
        </v-card>
      </v-dialog>

      <!-- Position Mode Dialog -->
      <v-dialog v-model="showPosModeDialog" max-width="420" dark>
        <v-card class="perps-modal">
          <div class="perps-modal__header">
            <span class="perps-modal__title">{{ $t('perpetuals.positionMode') }}</span>
            <v-icon size="20" @click="showPosModeDialog = false" class="perps-modal__close">mdi-close</v-icon>
          </div>
          <div class="perps-modal__body">
            <div class="perps-modal__option perps-modal__option--active">
              <v-icon size="20" color="#26FAB0" class="mr-2">mdi-checkbox-marked</v-icon>
              <div>
                <div class="perps-modal__option-title">{{ $t('perpetuals.oneWay') }}</div>
                <div class="perps-modal__option-desc">{{ $t('perpetuals.oneWayDesc') }}</div>
              </div>
            </div>
          </div>
          <v-btn block color="#26FAB0" class="perps-modal__confirm" @click="showPosModeDialog = false">
            {{ $t('perpetuals.confirm') }}
          </v-btn>
        </v-card>
      </v-dialog>

      <!-- Order type tabs -->
      <v-tabs
        :value="orderTypes.findIndex(tr => tr.value === orderType)"
        background-color="transparent"
        grow
        color="#eaecef"
        slider-color="#26FAB0"
        height="32"
        class="of-type-tabs"
        @change="(i) => orderType = orderTypes[i].value"
      >
        <v-tab v-for="t in orderTypes" :key="t.value" class="of-type-tab">
          {{ $t(t.label) }}
        </v-tab>
      </v-tabs>

      <!-- Side toggle: Long/Buy — Short/Sell -->
      <v-btn-toggle v-model="orderSide" mandatory dense class="of-side-toggle">
        <v-btn value="buy" class="of-side-btn of-side-btn--buy">
          {{ $t('perpetuals.buyLong') }}
        </v-btn>
        <v-btn value="sell" class="of-side-btn of-side-btn--sell">
          {{ $t('perpetuals.sellShort') }}
        </v-btn>
      </v-btn-toggle>

      <!-- Available balance + current position -->
      <div class="of-info-row">
        <span class="form-label">{{ $t('perpetuals.availableBalance') }}</span>
        <span class="form-value">${{ formatBalance(account?.available_balance) }}</span>
      </div>
      <div class="of-info-row">
        <span class="form-label">{{ $t('perpetuals.currentPosition') }}</span>
        <span class="form-value">{{ currentPositionSize }} {{ baseAsset }}</span>
      </div>

      <!-- Price field (limit / stop-limit) -->
      <div v-if="orderType !== 'market'" class="of-field mb-2">
        <span class="of-field__label">{{ $t('perpetuals.price') }}</span>
        <input v-model="limitPrice" type="number" class="of-field__input"  />
        <span class="of-field__suffix">USD</span>
      </div>

      <!-- Stop price (stop-limit) -->
      <div v-if="orderType === 'stop_limit'" class="of-field mb-2">
        <span class="of-field__label">{{ $t('perpetuals.stopPrice') }}</span>
        <input v-model="stopPrice" type="number" class="of-field__input"  />
        <span class="of-field__suffix">USD</span>
      </div>

      <!-- Size input -->
      <div class="of-field mb-2">
        <input
          :value="formatCurrencyInput(orderSize)"
          @input="onSizeInput"
          type="text"
          inputmode="decimal"
          class="of-field__input"
          :placeholder="t('perpetuals.size')"
        />
        <v-menu offset-y left :attach="true" content-class="of-asset-menu">
          <template #activator="{ on, attrs }">
            <span class="of-field__asset-trigger" v-bind="attrs" v-on="on">
              {{ sizeAsset }}
              <v-icon size="12" class="ml-1">mdi-chevron-down</v-icon>
            </span>
          </template>
          <v-list dense dark class="of-asset-list">
            <v-list-item
              v-for="a in ['USD', baseAsset]"
              :key="a"
              @click="sizeAsset = a"
              :class="{ 'of-asset-list__current-item': sizeAsset === a }"
            >
              <v-list-item-title>{{ a }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>

      <!-- Size slider -->
      <div class="of-slider-row">
        <v-slider
          v-model="_sizePercent"
          min="0"
          max="100"
          step="0.1"
          color="#4efab080"
          track-color="#ffffff1a"
          hide-details
          class="of-slider custom-slider"
        />
        <span class="of-slider-pct-box">{{ _sizePercent.toFixed(1) }}%</span>
      </div>

      <!-- Checkboxes: Reduce Only + TP/SL -->
      <div class="of-checkboxes">
        <v-checkbox
          v-model="reduceOnly"
          :label="$t('perpetuals.reduceOnly')"
          hide-details
          dense
          color="#26FAB0"
          class="of-checkbox"
          :ripple="false"
        />
        <v-checkbox
          v-model="showTpSl"
          :label="$t('perpetuals.tpSl')"
          hide-details
          dense
          color="#26FAB0"
          class="of-checkbox"
          :ripple="false"
        />
      </div>

      <!-- TP/SL inputs (expanded) -->
      <div v-if="showTpSl" class="of-tpsl">
        <v-text-field
          v-model="takeProfitPrice"
          :label="$t('perpetuals.takeProfitPriceUsd')"
          type="number"
          outlined
          dense
          hide-details
          class="of-input mb-2"
          prefix="$"
        />
        <v-text-field
          v-model="stopLossPrice"
          :label="$t('perpetuals.stopLossPriceUsd')"
          type="number"
          outlined
          dense
          hide-details
          class="of-input"
          prefix="$"
        />
      </div>

      <!-- Place Order button -->
      <v-btn
        block
        :color="(insufficientBalance || belowMinOrder || aboveMaxOrder) ? '#2b2f36' : (orderSide === 'buy' ? '#26FAB0' : '#F6465D')"
        :loading="placingOrder"
        :disabled="!canPlaceOrder"
        @click="placeOrderAction()"
        class="of-place-btn mt-3"
        :style="{ color: (insufficientBalance || belowMinOrder || aboveMaxOrder) ? '#F6465D' : (orderSide === 'buy' ? '#0b0e11' : '#ffffff') }"
      >
        {{ insufficientBalance ? $t('errors.insufficientBalance') : belowMinOrder ? $t('perpetuals.minOrderSize') : aboveMaxOrder ? $t('perpetuals.maxOrderSize') : $t('perpetuals.placeOrder') }}
      </v-btn>

      <v-alert v-if="tradingError" type="error" dense class="mt-2" dismissible @input="tradingError = null">
        {{ tradingError }}
      </v-alert>

      <!-- Order info estimates -->
      <div class="of-estimates mt-3">
        <div v-if="orderType === 'market'" class="of-est-row">
          <span>{{ $t('perpetuals.estEntryPrice') }}</span>
          <span class="form-value">{{ estEntryPriceDisplay }}</span>
        </div>
        <div class="of-est-row">
          <v-tooltip bottom content-class="custom-tooltip" max-width="220">
            <template #activator="{ on, attrs }">
              <span class="price-info-label--dashed" v-bind="attrs" v-on="on">{{ $t('perpetuals.estLiqPrice') }}</span>
            </template>
            <span>{{ $t('perpetuals.estLiqPriceTooltip') }}</span>
          </v-tooltip>
          <span class="form-value">{{ estLiquidationPrice }}</span>
        </div>
        <div class="of-est-row">
          <span>{{ $t('perpetuals.requiredMargin') }}</span>
          <span class="form-value">{{ estMargin }}</span>
        </div>
        <div class="of-est-row">
          <span>{{ $t('perpetuals.orderValue') }}</span>
          <span class="form-value">{{ notionalValue }}</span>
        </div>
        <div class="of-est-row">
          <v-tooltip bottom content-class="custom-tooltip" max-width="240">
            <template #activator="{ on, attrs }">
              <span class="price-info-label--dashed" v-bind="attrs" v-on="on">{{ $t('perpetuals.estFee') }}</span>
            </template>
            <span style="white-space: pre-line;">{{ $t('perpetuals.estFeeTooltip') }}</span>
          </v-tooltip>
          <span class="form-value">{{ estFee }}</span>
        </div>
        <v-alert
          v-if="slippageWarning"
          dense
          text
          color="#F0B90B"
          class="of-slippage-alert mt-2"
          icon="mdi-alert-outline"
        >
          {{ slippageWarning }}
        </v-alert>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { usePerpsFormatters } from '@/modules/market/composables/perps';
import { useStrikeTrading } from '@/modules/market/composables/useStrikeTrading';
import { strikeTradeApi } from '@/api/strike-v2.trade';
import {
  calcLiquidationPriceIsolated,
  calcVwapMarketFill,
  getMarginTier,
  normalizeMarginTiers,
} from '@/modules/market/math';
import type {
  AccountResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  CreateStrategyOrderRequest,
  MarginMode,
  Position,
  StrikeMarketConfig,
} from '@/api/strike-v2.types';
import snackbar from '@/plugins/snackbar';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();
const {
  formatBalance, snapToStep, formatCurrencyInput, parseCurrencyInput,
} = usePerpsFormatters();

// ---------------------------------------------------------------------------
// Props / emits
// ---------------------------------------------------------------------------

const props = withDefaults(defineProps<{
  symbol: string;
  baseAsset: string;
  account: AccountResponse;
  positions: Position[];
  marketConfig: StrikeMarketConfig | undefined;
  livePrice: number;
  walletAdaBalance: number;
  obAsks?: [string, string][];
  obBids?: [string, string][];
}>(), {
  obAsks: () => [],
  obBids: () => [],
});

const emit = defineEmits<{
  (e: 'order-placed'): void;
  (e: 'leverage-changed', leverage: number): void;
  (e: 'margin-mode-changed', mode: MarginMode): void;
}>();

// ---------------------------------------------------------------------------
// Trading API (shared singleton)
// ---------------------------------------------------------------------------

const {
  loadAccount,
  loadOpenOrders,
  setLeverage: apiSetLeverage,
  setMarginMode: apiSetMarginMode,
} = useStrikeTrading();

// ---------------------------------------------------------------------------
// Margin tier lookup (numeric form, memoised on marketConfig changes)
// ---------------------------------------------------------------------------

const marketTiers = computed(() =>
  props.marketConfig?.margin_tiers ? normalizeMarginTiers(props.marketConfig.margin_tiers) : [],
);

// ---------------------------------------------------------------------------
// Order form state
// ---------------------------------------------------------------------------

const orderTypes = [
  { value: 'market', label: 'perpetuals.market' },
  { value: 'limit', label: 'perpetuals.limit' },
  { value: 'stop_limit', label: 'perpetuals.stopLimit' },
] as const;

const orderType = ref<'market' | 'limit' | 'stop_limit'>('market');
const orderSide = ref<'buy' | 'sell'>('buy');
const orderSize = ref<string>('');
const limitPrice = ref<string>('');
const stopPrice = ref<string>('');
const leverage = ref<number>(20);
const marginMode = ref<MarginMode>('cross');
const sizeAsset = ref<string>('ADA');
const _sizePercent = ref(0);

const reduceOnly = ref(false);
const showTpSl = ref(false);
const showMarginDialog = ref(false);
const showLeverageDialog = ref(false);
const showPosModeDialog = ref(false);
const pendingMarginMode = ref<MarginMode>('cross');
const pendingLeverage = ref(20);
const takeProfitPrice = ref<string>('');
const stopLossPrice = ref<string>('');
const placingOrder = ref(false);
const tradingError = ref<string | null>(null);

// ---------------------------------------------------------------------------
// Derived computeds
// ---------------------------------------------------------------------------

const maxLeverage = computed(() => props.marketConfig?.margin_tiers?.[0]?.max_leverage ?? 20);

// Strike account `available_balance` is USD-denominated (it's a USD margin
// account). Fall back to the on-chain wallet ADA balance (converted to USD)
// only when there's no Strike balance yet.
const availableBalanceUsd = computed(() => {
  const strikeUsd = parseFloat(props.account?.available_balance ?? '0');
  if (strikeUsd > 0) return strikeUsd;
  return (props.walletAdaBalance || 0) * (props.livePrice || 0);
});

// Available balance expressed in the selected size asset. USD is the native
// unit; ADA = USD / live ADA price. (The previous code treated the USD balance
// as ADA 1:1 — a $28 balance showed as "28 ADA" instead of ~196 ADA.)
const availableBalanceInAsset = computed(() => {
  if (sizeAsset.value === 'USD') return availableBalanceUsd.value;
  return props.livePrice > 0 ? availableBalanceUsd.value / props.livePrice : 0;
});

// Open positions for current symbol
const openPositions = computed<Position[]>(() =>
  (props.positions ?? []).filter((p) => parseFloat(p.Size) !== 0),
);

const currentPositionSize = computed(() => {
  const pos = openPositions.value.find((p) => p.symbol === props.symbol);
  if (!pos) return '0.00';
  return parseFloat(pos.Size).toFixed(2);
});

const currentSymbolPosition = computed(() =>
  openPositions.value.find((p) => p.symbol === props.symbol) ?? null,
);

// ---------------------------------------------------------------------------
// Slider <-> size sync
// ---------------------------------------------------------------------------

let _syncingFromSlider = false;
let _syncingFromInput = false;

// Slider -> orderSize
watch(_sizePercent, (pct) => {
  if (_syncingFromInput) return;
  _syncingFromSlider = true;
  const total = availableBalanceInAsset.value;
  if (total > 0) {
    const size = (pct / 100) * total;
    orderSize.value = size > 0 ? size.toFixed(2) : '';
  }
  nextTick(() => { _syncingFromSlider = false; });
});

// orderSize -> slider
watch(orderSize, (val) => {
  if (_syncingFromSlider) return;
  _syncingFromInput = true;
  const total = availableBalanceInAsset.value;
  if (total > 0) {
    const size = parseFloat(val) || 0;
    _sizePercent.value = Math.min((size / total) * 100, 100);
  }
  nextTick(() => { _syncingFromInput = false; });
});

// Update sizeAsset when baseAsset prop changes
watch(() => props.baseAsset, (v) => { sizeAsset.value = v; });

// Set default leverage from market config when loaded
watch(() => props.marketConfig, (cfg) => {
  if (cfg?.default_leverage) {
    leverage.value = cfg.default_leverage;
    pendingLeverage.value = cfg.default_leverage;
  }
});

function onSizeInput(e: Event) {
  orderSize.value = parseCurrencyInput((e.target as HTMLInputElement).value);
}

// ---------------------------------------------------------------------------
// Entry price & estimates (math-layer backed)
// ---------------------------------------------------------------------------

// VWAP fill estimate for market orders, using the live order book.
const marketFill = computed(() => {
  if (orderType.value !== 'market') return null;
  const size = parseFloat(orderSize.value);
  if (!size || size <= 0) return null;
  const levels = orderSide.value === 'buy' ? props.obAsks : props.obBids;
  if (!levels?.length) return null;
  return calcVwapMarketFill(levels, size);
});

const estEntryPrice = computed<number>(() => {
  if (orderType.value === 'market') {
    return marketFill.value?.avgPrice || props.livePrice;
  }
  return parseFloat(limitPrice.value || '0');
});

const estEntryPriceDisplay = computed(() => {
  const ep = estEntryPrice.value;
  if (!ep || ep <= 0) return '\u2014';
  const prec = props.marketConfig?.quote_prec ?? 4;
  return `$${ep.toFixed(prec)}`;
});

const notionalValue = computed(() => {
  const size = parseFloat(orderSize.value);
  const price = estEntryPrice.value;
  if (!size || !price) return '\u2014';
  return `$${(size * price).toFixed(2)}`;
});

// Required margin -- net of any opposite open position (still nets out
// the contra-position that will be closed first).
const estMargin = computed(() => {
  const size = parseFloat(orderSize.value);
  const price = estEntryPrice.value;
  if (!size || !price) return '\u2014';

  let openingSize = size;
  const pos = currentSymbolPosition.value;
  if (pos) {
    const posSize = parseFloat(pos.Size);
    const isOpposite = (orderSide.value === 'buy' && pos.Side === 'short')
                    || (orderSide.value === 'sell' && pos.Side === 'long');
    if (isOpposite) {
      openingSize = Math.max(0, size - posSize);
    }
  }

  if (openingSize <= 0) return '$0.00';
  const openingNotional = openingSize * price;
  return `$${(openingNotional / leverage.value).toFixed(2)}`;
});

// Estimated fee -- defaults to 0.06% taker / 0.00% maker until the
// account fee tier is wired through (see strike-calculations spec).
const DEFAULT_TAKER_RATE = 0.0006;
const DEFAULT_MAKER_RATE = 0.0;
const feeDiscountRate = ref(0);

const estFeeRate = computed(() => {
  const isMarket = orderType.value === 'market';
  const baseRate = isMarket ? DEFAULT_TAKER_RATE : DEFAULT_MAKER_RATE;
  return baseRate * (1 - feeDiscountRate.value);
});

const estFee = computed(() => {
  const size = parseFloat(orderSize.value);
  const price = estEntryPrice.value;
  if (!size || !price) return '\u2014';
  const fee = size * price * estFeeRate.value;
  return `$${fee.toFixed(2)}`;
});

// Est. liquidation price (math layer; uses isolated formula with margin
// = notional / leverage as the dashboard form's "preview").
const estLiquidationPrice = computed(() => {
  const size = parseFloat(orderSize.value);
  const ep = estEntryPrice.value;
  if (!size || !ep) return '\u2014';

  const notional = size * ep;
  const tier = getMarginTier(marketTiers.value, notional);
  if (!tier) return '\u2014';

  const isoBalance = notional / leverage.value;
  const lp = calcLiquidationPriceIsolated(
    orderSide.value === 'buy' ? 'LONG' : 'SHORT',
    ep,
    isoBalance,
    size,
    tier,
  );
  if (lp <= 0) return '\u2014';

  const prec = props.marketConfig?.quote_prec ?? 5;
  return lp.toFixed(prec);
});

// Slippage warning for market orders (>50 bps vs. top-of-book reference).
const slippageWarning = computed(() => {
  const fill = marketFill.value;
  if (!fill) return '';
  if (fill.insufficientDepth) {
    return t('perpetuals.insufficientBookDepth');
  }
  if (fill.slippageBps > 50) {
    return t('perpetuals.highSlippageWarning', {
      pct: (fill.slippageBps / 100).toFixed(2),
    });
  }
  return '';
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MIN_ORDER_USD = computed(() => parseFloat(props.marketConfig?.order_min_notional ?? '10'));
const MAX_ORDER_USD = 100_000;

const orderValueUsd = computed(() => {
  const size = parseFloat(orderSize.value) || 0;
  if (size <= 0) return 0;
  if (sizeAsset.value === 'USD') return size;
  return size * props.livePrice;
});

const insufficientBalance = computed(() => {
  const size = parseFloat(orderSize.value);
  if (!size || size <= 0) return false;
  return size > availableBalanceInAsset.value;
});

const belowMinOrder = computed(() => {
  const size = parseFloat(orderSize.value);
  if (!size || size <= 0) return false;
  return orderValueUsd.value < MIN_ORDER_USD.value;
});

const aboveMaxOrder = computed(() => {
  const size = parseFloat(orderSize.value);
  if (!size || size <= 0) return false;
  return orderValueUsd.value > MAX_ORDER_USD;
});

const canPlaceOrder = computed(() => {
  const size = parseFloat(orderSize.value);
  if (!size || size <= 0) return false;
  if (insufficientBalance.value) return false;
  if (belowMinOrder.value) return false;
  if (aboveMaxOrder.value) return false;
  if (orderType.value === 'limit' || orderType.value === 'stop_limit') {
    const price = parseFloat(limitPrice.value);
    if (!price || price <= 0) return false;
  }
  if (orderType.value === 'stop_limit') {
    const sp = parseFloat(stopPrice.value);
    if (!sp || sp <= 0) return false;
  }
  return true;
});


// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function applyMarginMode() {
  try {
    await apiSetMarginMode(props.symbol, pendingMarginMode.value);
    marginMode.value = pendingMarginMode.value;
    showMarginDialog.value = false;
    snackbar.fireSuccess(`Margin mode set to ${pendingMarginMode.value}`);
    emit('margin-mode-changed', marginMode.value);
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
  }
}

async function applyLeverage() {
  try {
    await apiSetLeverage(props.symbol, leverage.value);
    snackbar.fireSuccess(`Leverage set to ${leverage.value}x`);
    emit('leverage-changed', leverage.value);
  } catch (e) {
    snackbar.setError(e instanceof Error ? e.message : String(e));
  }
}

async function placeOrderAction() {
  if (!canPlaceOrder.value) return;
  placingOrder.value = true;
  tradingError.value = null;
  try {
    const hasTPSL = !!takeProfitPrice.value || !!stopLossPrice.value;
    const cfg = props.marketConfig;
    const isMarket = orderType.value === 'market';
    const stepSize = isMarket ? (cfg?.order_market_step_size ?? '0.0001') : (cfg?.order_limit_step_size ?? '0.0001');
    const tickPrice = cfg?.order_tick_price ?? '0.01';

    const snappedSize = snapToStep(parseFloat(orderSize.value), stepSize);
    const params: CreateOrderRequest = {
      symbol: props.symbol,
      side: orderSide.value,
      type: orderType.value === 'stop_limit' ? 'stop' : orderType.value,
      size: snappedSize,
    };
    if (!isMarket && limitPrice.value) {
      params.price = snapToStep(parseFloat(limitPrice.value), tickPrice);
    }
    if (orderType.value === 'stop_limit' && stopPrice.value) {
      params.stop_price = snapToStep(parseFloat(stopPrice.value), tickPrice);
    }
    if (reduceOnly.value) {
      params.reduce_only = true;
    }

    let order: CreateOrderResponse;
    if (hasTPSL) {
      const strategyParams: CreateStrategyOrderRequest = {
        ...params,
        strategy_id: crypto.randomUUID(),
      };
      if (takeProfitPrice.value) {
        strategyParams.tp_order = {
          type: 'take_profit',
          size: snappedSize,
          stop_price: snapToStep(parseFloat(takeProfitPrice.value), tickPrice),
        };
      }
      if (stopLossPrice.value) {
        strategyParams.sl_order = {
          type: 'stop',
          size: snappedSize,
          stop_price: snapToStep(parseFloat(stopLossPrice.value), tickPrice),
        };
      }
      order = await strikeTradeApi.createStrategyOrder(strategyParams);
    } else {
      order = await strikeTradeApi.createOrder(params);
    }

    snackbar.fireSuccess(`Order placed: ${order.client_order_id}`);
    orderSize.value = '';
    limitPrice.value = '';
    stopPrice.value = '';
    takeProfitPrice.value = '';
    stopLossPrice.value = '';
    await Promise.all([loadOpenOrders(props.symbol), loadAccount()]);
    emit('order-placed');
  } catch (e) {
    tradingError.value = e instanceof Error ? e.message : String(e);
  } finally {
    placingOrder.value = false;
  }
}
</script>

<style scoped>
/* ── Right column layout ─────────────────────────────────────────────── */

.col-right {
  display: flex;
  flex-direction: column;
  max-width: 230px;
  overflow-y: auto;
}

.order-form-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
}

/* ── Margin row + top buttons ────────────────────────────────────────── */

.of-margin-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.of-top-btn {
  flex: 1;
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: none !important;
  border-color: #2b2f36 !important;
  color: #eaecef !important;
  letter-spacing: 0 !important;
}

/* ── Perps modal dialogs ─────────────────────────────────────────────── */

.perps-modal {
  background: #0b0e11 !important;
  border-radius: 12px !important;
  padding: 24px !important;
  border: 1px solid #2b2f36;
  overflow: hidden !important;
  max-width: 425px;
}

.perps-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.perps-modal__title {
  font-size: 18px;
  font-weight: 700;
  color: #eaecef;
}

.perps-modal__close {
  color: #848e9c !important;
  cursor: pointer;
}

.perps-modal__body {
  margin-bottom: 16px;
}

.perps-modal__option {
  display: flex;
  align-items: flex-start;
  padding: 14px;
  border: 1px solid #2b2f36;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 10px;
  transition: border-color 0.15s ease-out;
}

.perps-modal__option:hover {
  border-color: #3b3f46;
}

.perps-modal__option--active {
  border-color: #26FAB0;
}

.perps-modal__option-title {
  font-size: 14px;
  font-weight: 600;
  color: #eaecef;
  margin-bottom: 4px;
}

.perps-modal__option-desc {
  font-size: 12px;
  color: #848e9c;
  line-height: 1.5;
}

.perps-modal__confirm {
  color: #0b0e11 !important;
  font-weight: 700 !important;
  text-transform: none !important;
  border-radius: 8px !important;
  height: 44px !important;
}

/* ── Leverage dialog ─────────────────────────────────────────────────── */

.leverage-display {
  font-size: 36px;
  font-weight: 700;
  color: #26FAB0;
  margin-top: 8px;
}

.leverage-max {
  font-size: 12px;
  color: #848e9c;
  margin-top: 4px;
}

.leverage-warning {
  background: rgba(246, 190, 66, 0.08);
  border: 1px solid rgba(246, 190, 66, 0.25);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  color: #F6BE42;
  line-height: 1.5;
}

.leverage-max-size {
  font-size: 12px;
  color: #848e9c;
}

.slider-tick {
  font-size: 9px;
  color: #5e6673;
}

/* ── Order type tabs ─────────────────────────────────────────────────── */

.of-type-tabs {
  margin-bottom: 8px;
}

.of-type-tab {
  font-size: 11px !important;
  font-weight: 500 !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
  min-width: auto !important;
  padding: 0 12px !important;
}

/* ── Side toggle ─────────────────────────────────────────────────────── */

.of-side-toggle {
  width: 100%;
  margin-bottom: 10px;
  border-radius: 4px !important;
  overflow: hidden;
}

.of-side-btn {
  flex: 1 !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
  height: 32px !important;
  border: none !important;
  opacity: 1 !important;
}

.of-side-btn--buy {
  background: rgba(38, 250, 176, 0.15) !important;
  color: #26FAB0 !important;
}
.of-side-btn--buy.v-btn--active {
  background: #26FAB0 !important;
  color: #0b0e11 !important;
}

.of-side-btn--sell {
  background: rgba(246, 70, 93, 0.15) !important;
  color: #F6465D !important;
}
.of-side-btn--sell.v-btn--active {
  background: #F6465D !important;
  color: #ffffff !important;
}

/* ── Info rows ───────────────────────────────────────────────────────── */

.of-info-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.form-label {
  font-size: 11px;
  color: #848e9c;
}

.form-value {
  font-size: 11px;
  font-weight: 600;
  color: #eaecef;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

/* ── Inputs ──────────────────────────────────────────────────────────── */

.of-input {
  font-size: 12px !important;
}

.of-input >>> .v-input__slot {
  min-height: 32px !important;
  background: #1b1d23 !important;
  border-color: #2b2f36 !important;
}

.of-input >>> input {
  font-family: 'JetBrains Mono', 'Fira Code', monospace !important;
  font-size: 12px !important;
  color: #eaecef !important;
}

/* ── Custom field ────────────────────────────────────────────────────── */

.of-field {
  display: flex;
  align-items: center;
  border: 1px solid #2b2f36;
  border-radius: 4px;
  padding: 0 6px 0 10px;
  height: 36px;
  background: transparent;
  transition: border-color 0.15s ease-out;
}

.of-field:focus-within {
  border-color: #26FAB0;
}

.of-field__label {
  font-size: 11px;
  color: #848e9c;
  white-space: nowrap;
  margin-right: 8px;
}

.of-field__input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: #eaecef;
  min-width: 0;
  text-align: left;
}

/* Hide number input spinners */
.of-field__input::-webkit-outer-spin-button,
.of-field__input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.of-field__suffix {
  font-size: 12px;
  color: #848e9c;
  margin-left: 8px;
  white-space: nowrap;
}

.of-field__asset-trigger {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: #eaecef;
  cursor: pointer;
  padding: 2px 2px;
  border-radius: 3px;
  white-space: nowrap;
}

.of-field__asset-trigger:hover {
  background: rgba(255, 255, 255, 0.06);
}

.of-field__asset-trigger .v-icon {
  color: #848e9c !important;
}

.of-asset-menu {
  border: 1px solid #2b2f36;
  border-radius: 4px;
}

.of-asset-list {
  background: #1b1d23 !important;
  padding: 2px 0 !important;
}

.of-asset-list .v-list-item {
  min-height: 28px !important;
  padding: 0 12px !important;
}

.of-asset-list .v-list-item__title {
  font-size: 12px !important;
  font-weight: 500;
  color: #848e9c;
  text-align: right;
}

.of-asset-list .v-list-item:hover .v-list-item__title {
  color: #eaecef;
}

.of-asset-list__current-item {
  opacity: 1 !important;
}

.of-asset-list__current-item .v-list-item__title {
  color: #eaecef !important;
  font-weight: 600 !important;
}

/* ── Slider row ──────────────────────────────────────────────────────── */

.of-slider-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.of-slider { flex: 1; }

.of-slider-pct-box {
  font-size: 11px;
  color: #26FAB0;
  font-weight: 600;
  min-width: 46px;
  text-align: center;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  border: 1px solid #2b2f36;
  border-radius: 4px;
  padding: 3px 6px;
  background: transparent;
}

/* ── Checkboxes ──────────────────────────────────────────────────────── */

.of-checkboxes {
  display: flex;
  flex-flow: column;
}

.of-checkbox {
  margin: 0 !important;
  padding: 0 !important;
}
.of-checkbox >>> .v-label {
  font-size: 10px !important;
  color: #fff !important;
  font-weight: 700 !important;
}
.of-checkbox >>> .v-input--selection-controls__input {
  margin-right: 4px !important;
}

/* ── TP/SL ───────────────────────────────────────────────────────────── */

.of-tpsl {
  margin-top: 6px;
}

/* ── Place order button ──────────────────────────────────────────────── */

.of-place-btn {
  border-radius: 4px !important;
  text-transform: none !important;
  font-weight: 700 !important;
  font-size: 13px !important;
  height: 40px !important;
  letter-spacing: 0 !important;
}

/* ── Estimates ───────────────────────────────────────────────────────── */

.of-estimates {
  background: rgba(255,255,255,0.02);
  border-radius: 4px;
  padding: 6px 8px;
}

.of-est-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #5e6673;
  line-height: 20px;
}

.of-slippage-alert {
  font-size: 11px !important;
  padding: 6px 10px !important;
  margin-bottom: 0 !important;
  line-height: 1.4 !important;
}

.of-slippage-alert >>> .v-icon {
  font-size: 14px !important;
  margin-right: 4px !important;
}

/* ── Dashed label (tooltips) ─────────────────────────────────────────── */

.price-info-label--dashed {
  text-decoration: underline dotted #848e9c;
  text-underline-offset: 2px;
  cursor: pointer;
}

/* ── Color utilities ─────────────────────────────────────────────────── */

.clr-green { color: #26FAB0 !important; }
.clr-red { color: #F6465D !important; }
.clr-yellow { color: #F0B90B !important; }

.fw-600 { font-weight: 600; }

.font-mono { font-family: 'JetBrains Mono', 'Fira Code', monospace; }

/* ── Custom slider ───────────────────────────────────────────────────── */

.custom-slider >>> .v-slider__tick {
  background-color: rgb(255 255 255 / 20%)!important;
  border-radius: 50%;
}
.custom-slider >>> .v-slider__thumb {
  background-color: #000 !important;
  border: 1px solid #4efab0 !important;
  width: 14px!important;
  height: 14px!important;
}
.custom-slider >>> .v-slider--horizontal .v-slider__track-container {
  height: 6px !important;
}
</style>
