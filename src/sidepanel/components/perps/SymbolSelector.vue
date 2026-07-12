<template>
  <v-menu
    v-model="open"
    :close-on-content-click="false"
    offset-y
    nudge-bottom="4"
    content-class="symbol-selector-menu"
    min-width="260"
    max-height="360"
  >
    <template #activator="{ on, attrs }">
      <button
        class="symbol-selector-btn"
        v-bind="attrs"
        v-on="on"
        :aria-label="$t('perpetuals.selectMarket')"
      >
        <span class="symbol-selector-btn__name">{{ value }}</span>
        <span
          class="symbol-selector-btn__badge"
          :class="currentChangeClass"
        >{{ currentChangeDisplay }}</span>
        <v-icon size="14" class="symbol-selector-btn__caret" :class="{ 'rotated': open }">
          mdi-chevron-down
        </v-icon>
      </button>
    </template>

    <div class="symbol-selector-dropdown">
      <div class="symbol-selector-dropdown__header">
        <span class="text-caption text--secondary">{{ $t('perpetuals.selectMarket') }}</span>
      </div>
      <v-text-field
        v-model="search"
        dense
        hide-details
        solo
        flat
        clearable
        prepend-inner-icon="mdi-magnify"
        class="symbol-selector-search mx-2 mb-1"
        :placeholder="$t('perpetuals.selectMarket')"
        autofocus
      />
      <v-divider />
      <v-list dense class="symbol-selector-list pa-0">
        <v-list-item
          v-for="sym in filteredSymbols"
          :key="sym.symbol"
          :class="{ 'symbol-selector-list__item--active': sym.symbol === value }"
          class="symbol-selector-list__item"
          @click="select(sym.symbol)"
        >
          <v-list-item-content>
            <div class="d-flex align-center justify-space-between">
              <span class="symbol-selector-list__symbol text-body-2 font-weight-medium">
                {{ sym.symbol }}
              </span>
              <div class="d-flex flex-column align-end">
                <span class="text-caption font-weight-medium white--text">
                  {{ formatPrice(getTickerFor(sym.symbol)?.lastPrice) }}
                </span>
                <span
                  class="text-caption font-weight-medium"
                  :class="changeClass(getTickerFor(sym.symbol)?.priceChangePercent)"
                >
                  {{ formatChange(getTickerFor(sym.symbol)?.priceChangePercent) }}
                </span>
              </div>
            </div>
          </v-list-item-content>
        </v-list-item>
        <v-list-item v-if="filteredSymbols.length === 0" disabled>
          <v-list-item-content>
            <span class="text-caption text--secondary">—</span>
          </v-list-item-content>
        </v-list-item>
      </v-list>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useStrikeMarket } from '@/modules/market/composables/useStrikeMarket';

// ---------------------------------------------------------------------------
// Props / emits
// ---------------------------------------------------------------------------

const props = defineProps<{
  value: string;
}>();

const emit = defineEmits<{
  (e: 'input', value: string): void;
}>();

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

const { symbols, getTicker } = useStrikeMarket();

// ---------------------------------------------------------------------------
// Local state
// ---------------------------------------------------------------------------

const open = ref(false);
const search = ref('');

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const filteredSymbols = computed(() => {
  const q = search.value?.trim().toLowerCase() ?? '';
  if (!q) return symbols.value;
  return symbols.value.filter((s) => s.symbol.toLowerCase().includes(q));
});

const currentTicker = computed(() => getTicker(props.value));

const currentChangeDisplay = computed(() => {
  return formatChange(currentTicker.value?.priceChangePercent);
});

const currentChangeClass = computed(() => {
  return changeClass(currentTicker.value?.priceChangePercent);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTickerFor(symbol: string) {
  return getTicker(symbol);
}

function formatPrice(raw: string | undefined): string {
  if (!raw) return '—';
  const n = parseFloat(raw);
  if (isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatChange(raw: string | undefined): string {
  if (!raw) return '—';
  const n = parseFloat(raw);
  if (isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function changeClass(raw: string | undefined): string {
  if (!raw) return 'neutral--text';
  const n = parseFloat(raw);
  if (isNaN(n)) return 'neutral--text';
  return n >= 0 ? 'long--text' : 'short--text';
}

function select(symbol: string) {
  emit('input', symbol);
  open.value = false;
  search.value = '';
}
</script>

<style scoped>
/* ── Activator Button ─────────────────────────────────── */
.symbol-selector-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  max-width: 200px;
  border-radius: var(--g-r-control);
  border: 1px solid var(--g-hairline-2);
  background: var(--g-raised);
  cursor: pointer;
  outline: none;
  transition: background 0.15s ease, border-color 0.15s ease;
  color: var(--g-text-1);
}

.symbol-selector-btn:hover {
  background: var(--g-overlay);
  border-color: color-mix(in srgb, var(--g-accent) 35%, transparent);
}

.symbol-selector-btn__name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.symbol-selector-btn__badge {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.symbol-selector-btn__caret {
  flex-shrink: 0;
  transition: transform 0.2s ease;
  color: var(--g-text-3) !important;
}

.symbol-selector-btn__caret.rotated {
  transform: rotate(180deg);
}

/* ── Dropdown panel ───────────────────────────────────── */
.symbol-selector-menu {
  border-radius: var(--g-r-card) !important;
  overflow: hidden;
  box-shadow: var(--g-shadow-menu) !important;
}

.symbol-selector-dropdown {
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
}

.symbol-selector-dropdown__header {
  padding: 10px 14px 4px;
}

.symbol-selector-search {
  border-radius: var(--g-r-control) !important;
}

/* ── List ─────────────────────────────────────────────── */
.symbol-selector-list {
  overflow-y: auto;
  max-height: 260px;
  background: transparent !important;
}

.symbol-selector-list__item {
  transition: background 0.1s ease;
  min-height: 38px !important;
  padding: 0 14px !important;
}

.symbol-selector-list__item:hover {
  background: var(--g-overlay) !important;
}

.symbol-selector-list__item--active {
  background: color-mix(in srgb, var(--g-accent) 10%, transparent) !important;
}

.symbol-selector-list__symbol {
  color: var(--g-text-1);
}

/* ── Color aliases ────────────────────────────────────── */
.long--text {
  color: var(--g-success) !important;
}

.short--text {
  color: var(--g-error) !important;
}

.neutral--text {
  color: var(--g-text-3) !important;
}

/* Badge backgrounds */
.long--text.symbol-selector-btn__badge {
  background: var(--g-success-fill);
}

.short--text.symbol-selector-btn__badge {
  background: var(--g-error-fill);
}

.neutral--text.symbol-selector-btn__badge {
  background: var(--g-hairline-1);
}
</style>
