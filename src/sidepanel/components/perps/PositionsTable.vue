<template>
  <div class="positions-table">
    <!-- Loading skeleton -->
    <div v-if="loading" class="pt-skeleton">
      <div v-for="i in 2" :key="i" class="pt-skeleton-card" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!positions.length" class="pt-empty">
      <v-icon size="32" class="pt-empty-icon">mdi-chart-line-variant</v-icon>
      <span class="pt-empty-text">{{ $t('perpetuals.noOpenPositions') }}</span>
    </div>

    <!-- Position cards -->
    <div v-else class="pt-list">
      <div
        v-for="row in rows"
        :key="row.pos.PositionID"
        class="pt-card"
        :class="{ 'pt-card--expanded': expandedId === row.pos.PositionID }"
      >
        <!-- Row 1: Symbol + badges -->
        <div
          class="pt-card-header"
          role="button"
          tabindex="0"
          @click="toggleExpand(row.pos.PositionID)"
          @keydown.enter.prevent="toggleExpand(row.pos.PositionID)"
        >
          <span class="pt-symbol">{{ row.pos.symbol }}</span>
          <div class="pt-badges">
            <span class="pt-badge" :class="row.pos.Side === 'long' ? 'badge--long' : 'badge--short'">
              {{ row.pos.Side === 'long' ? $t('perpetuals.long') : $t('perpetuals.short') }}
            </span>
            <span class="pt-badge badge--leverage">{{ row.pos.Leverage }}x</span>
            <span class="pt-badge badge--margin-mode">
              {{ row.pos.MarginMode === 'cross' ? $t('perpetuals.cross') : $t('perpetuals.isolated') }}
            </span>
          </div>
          <v-icon size="14" class="pt-expand-icon" :class="{ 'pt-expand-icon--open': expandedId === row.pos.PositionID }">
            mdi-chevron-down
          </v-icon>
        </div>

        <!-- Row 2: Entry + uPnL stacked / Mark + distance-to-liq stacked -->
        <div class="pt-prices-row">
          <div class="pt-price-col">
            <div class="pt-price-line">
              <span class="pt-price-label">{{ $t('perps.position.entry') }}</span>
              <span class="pt-price-value">${{ formatPrice(row.pos.EntryPrice) }}</span>
            </div>
            <div class="pt-price-line pt-price-line--accent">
              <span class="pt-price-label">{{ $t('perps.position.upnl') }}</span>
              <span class="pt-price-value" :class="pnlClass(row.summary.unrealizedPnl)">
                {{ formatSignedUsd(row.summary.unrealizedPnl) }}
                <span class="pt-pct" v-if="row.summary.currentMargin > 0">
                  ({{ formatSignedPct(row.summary.pnlPercentage) }})
                </span>
              </span>
            </div>
          </div>
          <div class="pt-price-divider" />
          <div class="pt-price-col pt-price-col--right">
            <div class="pt-price-line">
              <span class="pt-price-label">{{ $t('perps.position.mark') }}</span>
              <span class="pt-price-value">${{ formatPrice(row.markPrice) }}</span>
            </div>
            <div class="pt-price-line">
              <v-tooltip top max-width="240">
                <template #activator="{ on, attrs }">
                  <span class="pt-price-label pt-price-label--hint" v-bind="attrs" v-on="on">
                    {{ $t('perps.position.liqPrice') }}
                  </span>
                </template>
                <span>{{ row.pos.MarginMode === 'cross' ? $t('perps.position.crossTooltip') : $t('perps.position.isolatedTooltip') }}</span>
              </v-tooltip>
              <span class="pt-price-value" :class="liqClass(row)">
                ${{ formatPrice(row.liqPrice) }}
                <span class="pt-pct pt-pct--muted" v-if="row.distanceToLiq != null">
                  ({{ formatSignedPct(row.distanceToLiq) }})
                </span>
              </span>
            </div>
          </div>
        </div>

        <!-- Expanded summary (notional / margin / maintenance) -->
        <transition name="pt-expand">
          <div v-if="expandedId === row.pos.PositionID" class="pt-summary">
            <div class="pt-summary-title">{{ $t('perps.position.summary') }}</div>
            <div class="pt-summary-grid">
              <div class="pt-summary-item">
                <span class="pt-summary-label">{{ $t('perps.position.size') }}</span>
                <span class="pt-summary-value">{{ formatSize(row.pos.Size) }}</span>
              </div>
              <div class="pt-summary-item">
                <span class="pt-summary-label">{{ $t('perps.position.notional') }}</span>
                <span class="pt-summary-value">${{ formatPrice(row.summary.notional) }}</span>
              </div>
              <div class="pt-summary-item">
                <span class="pt-summary-label">{{ $t('perps.position.margin') }}</span>
                <span class="pt-summary-value">${{ formatPrice(row.summary.currentMargin) }}</span>
              </div>
              <div class="pt-summary-item">
                <span class="pt-summary-label">{{ $t('perps.position.maintenanceMargin') }}</span>
                <span class="pt-summary-value">${{ formatPrice(row.summary.maintenanceMargin) }}</span>
              </div>
            </div>
          </div>
        </transition>

        <!-- Footer: Close button -->
        <div class="pt-footer-row">
          <v-btn
            depressed
            x-small
            class="pt-close-btn"
            @click.stop="$emit('close-position', row.pos)"
          >
            {{ $t('perpetuals.close') }}
          </v-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Position, MarginTier, AccountResponse, StrikeMarketConfig } from '@/api/strike-v2.types';
import {
  calcPositionSummary,
  normalizeMarginTiers,
  type CrossPositionInput,
  type IsolatedPositionInput,
  type PositionSide as MathPositionSide,
  type PositionSummary,
} from '@/modules/market/math';
import { useStrikeMarketWs } from '@/modules/market/composables/useStrikeMarketWs';
import { strikeMarketApi } from '@/api/strike-v2.market';

const props = withDefaults(defineProps<{
  positions: Position[];
  loading?: boolean;
  /** Optional: account info for cross-margin liquidation calc (wallet balance). */
  account?: AccountResponse | null;
  /** Optional: market config keyed by symbol. If absent, this component fetches once. */
  marketsConfig?: Record<string, StrikeMarketConfig> | null;
}>(), {
  loading: false,
  account: null,
  marketsConfig: null,
});

defineEmits<{
  (e: 'close-position', position: Position): void;
}>();

// ── Live mark prices (per symbol) ──────────────────────────────────────────

const marketWs = useStrikeMarketWs();
const markPrices = ref<Record<string, string>>({});
const subs = new Map<string, () => void>();

function ensureMarkPriceSub(symbol: string) {
  if (subs.has(symbol)) return;
  const unsub = marketWs.subscribeMarkPrice(symbol, (data: unknown) => {
    const d = data as { p?: string };
    if (d?.p) markPrices.value = { ...markPrices.value, [symbol]: d.p };
  });
  subs.set(symbol, unsub);
}

function pruneSubs(activeSymbols: Set<string>) {
  for (const [symbol, unsub] of subs.entries()) {
    if (!activeSymbols.has(symbol)) {
      unsub();
      subs.delete(symbol);
    }
  }
}

watch(() => props.positions, (positions) => {
  const active = new Set<string>();
  for (const p of positions ?? []) {
    if (p?.symbol) {
      active.add(p.symbol);
      ensureMarkPriceSub(p.symbol);
    }
  }
  pruneSubs(active);
}, { immediate: true, deep: true });

onBeforeUnmount(() => {
  for (const unsub of subs.values()) unsub();
  subs.clear();
});

// ── Margin tiers per symbol (lazy-fetch + memoise) ─────────────────────────

const localMarketsConfig = ref<Record<string, StrikeMarketConfig>>({});
const tiersBySymbol = ref<Record<string, ReturnType<typeof normalizeMarginTiers>>>({});

function tiersFor(symbol: string): ReturnType<typeof normalizeMarginTiers> {
  if (tiersBySymbol.value[symbol]) return tiersBySymbol.value[symbol];

  const cfg = props.marketsConfig?.[symbol] ?? localMarketsConfig.value[symbol];
  const raw: MarginTier[] | undefined = cfg?.margin_tiers;
  if (!raw || raw.length === 0) return [];

  const numeric = normalizeMarginTiers(raw);
  tiersBySymbol.value = { ...tiersBySymbol.value, [symbol]: numeric };
  return numeric;
}

// If no marketsConfig is provided, fetch once when there are positions.
let fetchedMarkets = false;
watch(() => props.positions, async (positions) => {
  if (props.marketsConfig) return;
  if (fetchedMarkets) return;
  if (!positions || positions.length === 0) return;
  fetchedMarkets = true;
  try {
    const res = await strikeMarketApi.getMarkets();
    localMarketsConfig.value = res.markets ?? {};
    // invalidate tier cache so tiersFor() re-derives from fresh config
    tiersBySymbol.value = {};
  } catch {
    fetchedMarkets = false; // allow retry on next position change
  }
}, { immediate: true });

// ── Computed rows with summary + liq distance ──────────────────────────────

interface Row {
  pos: Position;
  markPrice: number;
  summary: PositionSummary;
  liqPrice: number;
  /** Distance to liq as % of current mark price (signed: negative ⇒ closer below). */
  distanceToLiq: number | null;
}

function toMathSide(s: Position['Side']): MathPositionSide {
  return s === 'long' ? 'LONG' : 'SHORT';
}

function liveMarkFor(pos: Position): number {
  const ws = markPrices.value[pos.symbol];
  const wsNum = ws ? parseFloat(ws) : NaN;
  if (isFinite(wsNum) && wsNum > 0) return wsNum;
  // Fallback: entry price (so derived numbers stay sane until WS arrives)
  const entry = parseFloat(pos.EntryPrice ?? '0');
  return isFinite(entry) ? entry : 0;
}

const rows = computed<Row[]>(() => {
  const list = props.positions ?? [];
  if (list.length === 0) return [];

  const walletBalance = parseFloat(props.account?.wallet_balance ?? '0') || 0;

  // Build cross / isolated context arrays once.
  const crossInputs: CrossPositionInput[] = [];
  const isoInputs: IsolatedPositionInput[] = [];

  for (const p of list) {
    const tiers = tiersFor(p.symbol);
    if (tiers.length === 0) continue;
    const size = Math.abs(parseFloat(p.Size ?? '0'));
    const entry = parseFloat(p.EntryPrice ?? '0');
    const mark = liveMarkFor(p);
    const notional = mark * size;
    // First tier whose max_notional ≥ notional (or last as fallback)
    let tier = tiers[tiers.length - 1];
    for (const t of tiers) {
      if (notional <= t.max_notional) { tier = t; break; }
    }
    if (p.MarginMode === 'cross') {
      crossInputs.push({
        symbol: p.symbol,
        side: toMathSide(p.Side),
        size,
        entryPrice: entry,
        markPrice: mark,
        notional,
        tier,
      });
    } else {
      isoInputs.push({ isoBalance: parseFloat(p.IsolatedMargin ?? '0') || 0 });
    }
  }

  return list.map((p) => {
    const tiers = tiersFor(p.symbol);
    const mark = liveMarkFor(p);
    const entry = parseFloat(p.EntryPrice ?? '0') || 0;
    const size = Math.abs(parseFloat(p.Size ?? '0')) || 0;
    const isoBalance = parseFloat(p.IsolatedMargin ?? '0') || 0;
    const side = toMathSide(p.Side);

    const summary = calcPositionSummary({
      side,
      marginType: p.MarginMode === 'cross' ? 'cross' : 'isolated',
      entryPrice: entry,
      markPrice: mark,
      size,
      leverage: p.Leverage,
      isoBalance,
      tiers,
      walletBalance,
      otherCrossPositions: p.MarginMode === 'cross'
        ? crossInputs.filter((c) => c.symbol !== p.symbol)
        : crossInputs,
      isolatedPositions: isoInputs,
    });

    // Prefer API-provided liquidation_price if it parses; otherwise computed.
    const apiLiq = parseFloat(p.liquidation_price ?? '');
    const liqPrice = isFinite(apiLiq) && apiLiq > 0 ? apiLiq : summary.liquidationPrice;

    let distanceToLiq: number | null = null;
    if (mark > 0 && liqPrice > 0) {
      distanceToLiq = ((liqPrice - mark) / mark) * 100;
    }

    return { pos: p, markPrice: mark, summary, liqPrice, distanceToLiq };
  });
});

// ── Expand / collapse ──────────────────────────────────────────────────────

const expandedId = ref<string | null>(null);
function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}

// ── Formatters ─────────────────────────────────────────────────────────────

function formatPrice(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '—';
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSize(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '—';
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (!isFinite(n)) return '—';
  return Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function formatSignedUsd(n: number): string {
  if (!isFinite(n)) return '—';
  const prefix = n >= 0 ? '+$' : '-$';
  return prefix + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSignedPct(n: number): string {
  if (!isFinite(n)) return '—';
  const prefix = n >= 0 ? '+' : '';
  return `${prefix}${n.toFixed(2)}%`;
}

function pnlClass(n: number): string {
  if (!isFinite(n) || n === 0) return '';
  return n > 0 ? 'pnl--positive' : 'pnl--negative';
}

function liqClass(row: Row): string {
  if (row.distanceToLiq == null) return '';
  // Warn within 10% of mark.
  return Math.abs(row.distanceToLiq) < 10 ? 'liq--warn' : '';
}
</script>

<style scoped>
.positions-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Skeleton ── */
.pt-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pt-skeleton-card {
  height: 120px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.9; }
}

/* ── Empty state ── */
.pt-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  gap: 8px;
}

.pt-empty-icon {
  color: rgba(255, 255, 255, 0.15) !important;
}

.pt-empty-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
  text-align: center;
}

/* ── List ── */
.pt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Card ── */
.pt-card {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.15s ease;
}

.pt-card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}

.pt-card--expanded {
  border-color: rgba(255, 255, 255, 0.18);
}

/* ── Header row ── */
.pt-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  outline: none;
}

.pt-card-header:focus-visible {
  outline: 1px solid rgba(0, 199, 243, 0.5);
  outline-offset: 2px;
  border-radius: 4px;
}

.pt-symbol {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.02em;
  flex: 1;
}

.pt-badges {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pt-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.badge--long {
  background: rgba(38, 250, 176, 0.15);
  color: #26FAB0;
}

.badge--short {
  background: rgba(249, 112, 102, 0.15);
  color: #F97066;
}

.badge--leverage {
  background: rgba(0, 199, 243, 0.15);
  color: #00c7f3;
}

.badge--margin-mode {
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.5);
}

.pt-expand-icon {
  color: rgba(255, 255, 255, 0.4) !important;
  transition: transform 0.18s ease;
}

.pt-expand-icon--open {
  transform: rotate(180deg);
}

/* ── Prices row ── */
.pt-prices-row {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

.pt-price-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.pt-price-col--right {
  align-items: flex-end;
}

.pt-price-divider {
  width: 1px;
  background: rgba(255, 255, 255, 0.07);
  align-self: stretch;
}

.pt-price-line {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.pt-price-col--right .pt-price-line {
  align-items: flex-end;
}

.pt-price-line--accent .pt-price-value {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.pt-price-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: rgba(255, 255, 255, 0.28);
}

.pt-price-label--hint {
  text-decoration: underline dotted rgba(255, 255, 255, 0.25);
  text-underline-offset: 2px;
  cursor: help;
}

.pt-price-value {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.78);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pt-pct {
  font-size: 10px;
  font-weight: 600;
  margin-left: 2px;
  opacity: 0.85;
}

.pt-pct--muted {
  color: rgba(255, 255, 255, 0.45);
  font-weight: 500;
}

.pnl--positive {
  color: #26FAB0;
}

.pnl--negative {
  color: #F97066;
}

.liq--warn {
  color: #FFA726 !important;
}

/* ── Summary expansion ── */
.pt-summary {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pt-summary-title {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.32);
}

.pt-summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
}

.pt-summary-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pt-summary-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.32);
}

.pt-summary-value {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.78);
  font-variant-numeric: tabular-nums;
}

.pt-expand-enter-active,
.pt-expand-leave-active {
  transition: opacity 0.18s ease, max-height 0.22s ease;
  overflow: hidden;
  max-height: 200px;
}

.pt-expand-enter,
.pt-expand-leave-to {
  opacity: 0;
  max-height: 0;
}

/* ── Footer row ── */
.pt-footer-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.pt-close-btn {
  font-size: 10px !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em !important;
  text-transform: uppercase !important;
  height: 26px !important;
  padding: 0 12px !important;
  border-radius: 6px !important;
  background: rgba(249, 112, 102, 0.14) !important;
  color: #F97066 !important;
  border: 1px solid rgba(249, 112, 102, 0.25) !important;
  transition: background 0.15s ease !important;
}

.pt-close-btn:hover {
  background: rgba(249, 112, 102, 0.24) !important;
}

/* ── Responsive — narrow widths ── */
@media (max-width: 360px) {
  .pt-summary-grid {
    grid-template-columns: 1fr;
  }
  .pt-prices-row {
    gap: 6px;
  }
  .pt-pct {
    font-size: 9px;
  }
}
</style>
