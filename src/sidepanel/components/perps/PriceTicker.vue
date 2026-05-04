<template>
  <div class="price-ticker">
    <!-- Mark Price -->
    <div class="price-ticker__group price-ticker__group--mark">
      <span class="price-ticker__value price-ticker__value--mark">{{ markPrice }}</span>
      <span
        class="price-ticker__badge"
        :class="changeClass"
      >{{ priceChange }}</span>
    </div>

    <div class="price-ticker__divider" />

    <!-- Funding Rate -->
    <div class="price-ticker__group">
      <span class="price-ticker__label text-caption">{{ $t('perpetuals.fundingRate') }}</span>
      <span
        class="price-ticker__value text-body-2 font-weight-medium"
        :class="fundingClass"
      >{{ fundingRate }}</span>
    </div>

    <div class="price-ticker__divider" />

    <!-- Next Funding -->
    <div class="price-ticker__group">
      <span class="price-ticker__label text-caption">{{ $t('perpetuals.nextFunding') }}</span>
      <span class="price-ticker__value text-body-2 font-weight-medium white--text">
        {{ fundingCountdown }}
      </span>
    </div>

    <div class="price-ticker__divider" />

    <!-- 24h Volume -->
    <div class="price-ticker__group">
      <span class="price-ticker__label text-caption">{{ $t('perpetuals.volume24h') }}</span>
      <span class="price-ticker__value text-body-2 font-weight-medium white--text">
        {{ volume24h }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useStrikeMarket } from '@/modules/market/composables/useStrikeMarket';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const props = defineProps<{
  symbol: string;
}>();

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

const { getTicker, getFunding } = useStrikeMarket();

// ---------------------------------------------------------------------------
// Countdown timer
// ---------------------------------------------------------------------------

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
});

// ---------------------------------------------------------------------------
// Computed — display values
// ---------------------------------------------------------------------------

const ticker = computed(() => getTicker(props.symbol));
const funding = computed(() => getFunding(props.symbol));

const markPrice = computed(() => {
  const raw = ticker.value?.lastPrice;
  if (!raw) return '—';
  const n = parseFloat(raw);
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

const priceChange = computed(() => {
  const raw = ticker.value?.priceChangePercent;
  if (!raw) return '—';
  const n = parseFloat(raw);
  if (isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
});

const changeClass = computed(() => {
  const raw = ticker.value?.priceChangePercent;
  if (!raw) return 'neutral--text';
  const n = parseFloat(raw);
  if (isNaN(n)) return 'neutral--text';
  return n >= 0 ? 'long--text' : 'short--text';
});

const fundingRate = computed(() => {
  const raw = funding.value?.lastFundingRate;
  if (!raw) return '—';
  const n = parseFloat(raw);
  if (isNaN(n)) return '—';
  // Express as percentage with 4 decimals
  return (n * 100).toFixed(4) + '%';
});

const fundingClass = computed(() => {
  const raw = funding.value?.lastFundingRate;
  if (!raw) return 'neutral--text';
  const n = parseFloat(raw);
  if (isNaN(n)) return 'neutral--text';
  return n >= 0 ? 'funding-positive--text' : 'short--text';
});

const fundingCountdown = computed(() => {
  const next = funding.value?.nextFundingTime;
  if (!next) return '—';
  const diffMs = next - now.value;
  if (diffMs <= 0) return '00:00:00';
  const totalSec = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
});

const volume24h = computed(() => {
  const raw = ticker.value?.quoteVolume ?? ticker.value?.volume;
  if (!raw) return '—';
  const n = parseFloat(raw);
  if (isNaN(n)) return '—';
  if (n >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(2) + 'K';
  return '$' + n.toFixed(2);
});
</script>

<style scoped>
/* ── Container ────────────────────────────────────────── */
.price-ticker {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.price-ticker::-webkit-scrollbar {
  display: none;
}

/* ── Divider ──────────────────────────────────────────── */
.price-ticker__divider {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
  margin: 0 10px;
}

/* ── Group ────────────────────────────────────────────── */
.price-ticker__group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  flex-shrink: 0;
}

.price-ticker__group--mark {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

/* ── Mark price ───────────────────────────────────────── */
.price-ticker__value--mark {
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.2px;
  white-space: nowrap;
}

/* ── Labels ───────────────────────────────────────────── */
.price-ticker__label {
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  line-height: 1.2;
}

/* ── Values ───────────────────────────────────────────── */
.price-ticker__value {
  white-space: nowrap;
  line-height: 1.3;
}

/* ── Change badge ─────────────────────────────────────── */
.price-ticker__badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 5px;
  border-radius: 4px;
  white-space: nowrap;
}

/* ── Color utilities ──────────────────────────────────── */
.long--text {
  color: #26FAB0 !important;
}

.short--text {
  color: #F97066 !important;
}

.funding-positive--text {
  color: #47CD89 !important;
}

.neutral--text {
  color: rgba(255, 255, 255, 0.45) !important;
}

/* Badge fills */
.long--text.price-ticker__badge {
  background: rgba(38, 250, 176, 0.15);
}

.short--text.price-ticker__badge {
  background: rgba(249, 112, 102, 0.15);
}

.neutral--text.price-ticker__badge {
  background: rgba(255, 255, 255, 0.08);
}
</style>
