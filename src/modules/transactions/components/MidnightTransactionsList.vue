<template>
  <!-- History tab's Midnight leaf — same role as TransactionsCard.vue for
       Cardano: a searchable/sortable/filterable list living at width:39% next
       to a detail pane (MidnightTransactionDetails.vue) inside Transactions.vue's
       shared #tsac tab scaffold. A row selects into the detail pane instead of
       expanding inline (that used to be MidnightTxUtxos.vue, rendered here per
       row; it now lives inside the detail pane instead). -->
  <v-card flat class="glass-panel mn-tx-list">
    <div class="mn-tx-list__head">
      <span class="mn-tx-list__title">
        {{ $t('transactions.history') }} ({{ sorted.length }})
      </span>

      <div class="mn-tx-list__toolbar">
        <v-text-field
          v-model="searchInput"
          dense
          flat
          solo
          hide-details
          clearable
          :placeholder="$t('common.search')"
          prepend-inner-icon="mdi-magnify"
          class="mn-tx-list__search"
        />

        <v-btn
          icon
          small
          :aria-label="$t('common.sortBy')"
          @click="sortDesc = !sortDesc"
        >
          <v-icon small>{{ sortDesc ? 'mdi-sort-descending' : 'mdi-sort-ascending' }}</v-icon>
        </v-btn>

        <v-select
          v-model="sortBy"
          :items="sortOptions"
          dense
          hide-details
          attach
          class="mn-tx-list__sort-select"
        />

        <v-menu
          v-model="filterMenuOpen"
          :close-on-content-click="false"
          offset-y
          nudge-bottom="4"
          min-width="260"
          max-width="320"
          transition="none"
        >
          <template v-slot:activator="{ on, attrs }">
            <v-btn icon small v-bind="attrs" v-on="on" :aria-label="$t('common.filter')">
              <v-badge color="transparent" avatar :value="activeFilterCount > 0" :content="activeFilterCount" overlap>
                <template v-slot:badge>
                  <v-avatar size="14" height="14" color="primary">
                    <span style="font-size: 11px; color: var(--g-on-grad)">{{ activeFilterCount }}</span>
                  </v-avatar>
                </template>
                <v-icon small>mdi-tune-variant</v-icon>
              </v-badge>
            </v-btn>
          </template>
          <v-card class="liquid-glass-compact" dark>
            <v-card-text class="pa-3">
              <div class="t-label mb-1">{{ $t('transactions.dateRange') }}</div>
              <div class="d-flex align-center" style="gap: 6px">
                <v-menu
                  v-model="dateFromMenu"
                  :close-on-content-click="false"
                  offset-y
                  min-width="auto"
                >
                  <template v-slot:activator="{ on, attrs }">
                    <v-text-field
                      :value="filterDateFrom || ''"
                      :placeholder="$t('transactions.from')"
                      dense
                      outlined
                      hide-details
                      readonly
                      clearable
                      v-bind="attrs"
                      v-on="on"
                      @click:clear="filterDateFrom = null"
                    />
                  </template>
                  <v-date-picker
                    :value="filterDateFrom"
                    @input="filterDateFrom = $event; dateFromMenu = false"
                    :min="earliestTxDate"
                    :max="filterDateTo || latestTxDate"
                    :events="transactionDates"
                    event-color="var(--g-accent)"
                    no-title
                    dark
                    color="var(--g-accent)"
                  />
                </v-menu>
                <v-menu
                  v-model="dateToMenu"
                  :close-on-content-click="false"
                  offset-y
                  min-width="auto"
                >
                  <template v-slot:activator="{ on, attrs }">
                    <v-text-field
                      :value="filterDateTo || ''"
                      :placeholder="$t('transactions.to')"
                      dense
                      outlined
                      hide-details
                      readonly
                      clearable
                      v-bind="attrs"
                      v-on="on"
                      @click:clear="filterDateTo = null"
                    />
                  </template>
                  <v-date-picker
                    :value="filterDateTo"
                    @input="filterDateTo = $event; dateToMenu = false"
                    :min="filterDateFrom || earliestTxDate"
                    :max="latestTxDate"
                    :events="transactionDates"
                    event-color="var(--g-accent)"
                    no-title
                    dark
                    color="var(--g-accent)"
                  />
                </v-menu>
              </div>

              <v-divider class="my-2" style="opacity: 0.1" />

              <div class="t-label mb-1">{{ $t('transactions.type') }}</div>
              <v-chip-group v-model="filterTypes" multiple column>
                <v-chip v-for="opt in typeFilterOptions" :key="opt.value" :value="opt.value" small outlined filter>
                  {{ opt.text }}
                </v-chip>
              </v-chip-group>

              <v-divider class="my-2" style="opacity: 0.1" />

              <div class="t-label mb-1">{{ $t('transactions.tokens') }}</div>
              <v-chip-group v-model="filterTokens" multiple column>
                <v-chip v-for="opt in tokenFilterOptions" :key="opt.value" :value="opt.value" small outlined filter>
                  {{ opt.text }}
                </v-chip>
              </v-chip-group>

              <v-divider class="my-2" style="opacity: 0.1" />

              <v-btn
                :disabled="activeFilterCount === 0"
                text
                block
                small
                class="justify-start"
                color="error"
                @click="clearAllFilters()"
              >
                <v-icon small class="mr-2">mdi-close-circle-outline</v-icon>
                {{ $t('common.clearFilters') }}
              </v-btn>
            </v-card-text>
          </v-card>
        </v-menu>
      </div>
    </div>

    <!-- Filters/search narrowed the list to nothing, but real transactions
         exist -- never let this read as "empty wallet" (see e0af42bc). -->
    <div v-if="transactions.length > 0 && sorted.length === 0" class="mn-tx-list__empty">
      <div>{{ $t('common.noResults') }}</div>
      <v-btn text small color="primary" class="mt-1" @click="clearAll">
        <v-icon small class="mr-1">mdi-close-circle-outline</v-icon>
        {{ $t('common.clearFilters') }}
      </v-btn>
    </div>

    <div v-else-if="sorted.length === 0" class="mn-tx-list__empty">
      {{ $t('transactions.noTransactionsFound') }}
    </div>

    <template v-else>
      <!-- Filter menu (not search) hid some rows -- always show the count
           and a one-click way back, same escape hatch as e0af42bc. -->
      <div v-if="hiddenByFilterCount > 0" class="mn-tx-list__hidden-notice">
        <span class="t-caption">{{ $t('market.hiddenByFilters', { count: hiddenByFilterCount }) }}</span>
        <v-btn text x-small color="primary" @click="clearAllFilters">{{ $t('common.clearFilters') }}</v-btn>
      </div>

      <div class="mn-tx-list__rows">
        <div v-for="tx in sorted" :key="`${tx.hash}-${tx.token}`" class="mn-tx-row-wrap">
          <button
            type="button"
            class="mn-tx-row"
            :class="{ 'mn-tx-row--selected': isSelected(tx) }"
            @click="selectRow(tx)"
          >
            <div class="mn-tx-row__main">
              <div class="mn-tx-row__type">{{ typeLabel(tx.type) }}</div>
              <div class="mn-tx-row__meta">
                <span v-if="tx.counterparty" class="mn-tx-row__counterparty">
                  {{ shortAddress(tx.counterparty) }} ·
                </span>
                <span>{{ formatTime(tx.timestamp) }}</span>
                <span v-if="tx.blockHeight"> · #{{ tx.blockHeight }}</span>
              </div>
            </div>
            <div class="mn-tx-row__hash-text">{{ shortHash(tx.hash) }}</div>
            <div class="mn-tx-row__amount" :style="{ color: amountColor(tx.type) }">
              <span>{{ formatAmountSigned(tx) }}</span>
              <v-tooltip v-if="isUnscaled(tx.token)" top content-class="custom-tooltip">
                <template v-slot:activator="{ on, attrs }">
                  <v-icon x-small color="warning" v-bind="attrs" v-on="on">mdi-help-circle-outline</v-icon>
                </template>
                {{ $t('midnight.rawBalanceNotice') }}
              </v-tooltip>
            </div>
          </button>
          <v-btn icon x-small class="ml-1" @click="copyHash(tx.hash)">
            <v-icon x-small>mdi-content-copy</v-icon>
          </v-btn>
        </div>
      </div>
    </template>
  </v-card>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, toRefs, watch } from 'vue';
import debounce from 'lodash/debounce';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import type { MidnightTransaction, MidnightTransactionType } from '@/chains/midnight/midnightTypes';
import { midnightTokenMeta } from '@/chains/midnight/midnightTokenRegistry';
import { useTranslation } from '@/shared/composables/useTranslation';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();
const { transactions } = toRefs(midnightStore);
const { loggedWallet } = toRefs(walletStore);

const emit = defineEmits(['row-click']);
const props = defineProps<{ selectedTransaction?: MidnightTransaction | null }>();

const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);
const DUST_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

// ---------------------------------------------------------------------------
// Search — debounced 300ms, same interval as Cardano's TransactionsCard.
// ---------------------------------------------------------------------------
const searchInput = ref('');
const debouncedSearch = ref('');
const debouncedUpdateSearch = debounce((value: string) => {
  debouncedSearch.value = value;
}, 300);
watch(searchInput, (value) => debouncedUpdateSearch(value));
// Cancel pending debounce on unmount to prevent state mutation after teardown.
onUnmounted(() => debouncedUpdateSearch.cancel());

// ---------------------------------------------------------------------------
// Sort — mirrors Cardano's sortBy/sortDesc refs. Default is time-desc, the
// pre-existing behaviour, so a user who never touches the controls sees no
// change at all.
// ---------------------------------------------------------------------------
type SortField = 'timestamp' | 'amount' | 'blockHeight';
const sortBy = ref<SortField>('timestamp');
const sortDesc = ref(true);

const sortOptions = computed(() => [
  { text: t('common.time'), value: 'timestamp' },
  { text: t('common.amount'), value: 'amount' },
  { text: t('transactions.blockHeight'), value: 'blockHeight' },
]);

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
const filterMenuOpen = ref(false);
const dateFromMenu = ref(false);
const dateToMenu = ref(false);
const filterDateFrom = ref<string | null>(null);
const filterDateTo = ref<string | null>(null);
const filterTypes = ref<MidnightTransactionType[]>([]);
const filterTokens = ref<string[]>([]);

const toDateString = (ts: number) => new Date(ts).toISOString().slice(0, 10);

const earliestTxDate = computed(() => {
  const all = transactions.value;
  if (!all.length) return undefined;
  const earliest = all.reduce((min, tx) => (tx.timestamp < min ? tx.timestamp : min), all[0].timestamp);
  return toDateString(earliest);
});

const latestTxDate = computed(() => toDateString(Date.now()));

// Dates that have transactions — shown as dots on the date picker.
const transactionDates = computed(() => {
  const dates = new Set<string>();
  for (const tx of transactions.value) dates.add(toDateString(tx.timestamp));
  return Array.from(dates);
});

// Type/token filter options are built from what's actually in the history,
// not a fixed list — Midnight's transaction set is small and chain-specific,
// so offering types/tokens the wallet has never seen would just be noise.
const typeFilterOptions = computed(() => {
  const seen = new Set<MidnightTransactionType>();
  const options: { value: MidnightTransactionType; text: string }[] = [];
  for (const tx of transactions.value) {
    if (seen.has(tx.type)) continue;
    seen.add(tx.type);
    options.push({ value: tx.type, text: typeLabel(tx.type) });
  }
  return options;
});

const tokenFilterOptions = computed(() => {
  const seen = new Set<string>();
  const options: { value: string; text: string }[] = [];
  for (const tx of transactions.value) {
    if (seen.has(tx.token)) continue;
    seen.add(tx.token);
    options.push({ value: tx.token, text: currencySymbol(tx.token) });
  }
  return options;
});

const activeFilterCount = computed(() => {
  let count = 0;
  if (filterDateFrom.value || filterDateTo.value) count++;
  count += filterTypes.value.length;
  count += filterTokens.value.length;
  return count;
});

function clearAllFilters(): void {
  filterDateFrom.value = null;
  filterDateTo.value = null;
  filterTypes.value = [];
  filterTokens.value = [];
}

// Used by the zero-results empty state, where either the filter menu or the
// search box (or both) could be why nothing matches — reset both at once.
function clearAll(): void {
  clearAllFilters();
  searchInput.value = '';
  debouncedSearch.value = '';
}

// ---------------------------------------------------------------------------
// Pipeline: search -> filters -> sort, split into separate computeds so
// hiddenByFilterCount (below) can isolate rows the FILTER MENU hid from rows
// the search box hid — the escape hatch only needs to undo the former (see
// e0af42bc: filtering must never look like an empty wallet).
// ---------------------------------------------------------------------------
function matchesSearch(tx: MidnightTransaction, needle: string): boolean {
  return (
    tx.hash.toLowerCase().includes(needle) ||
    (tx.counterparty ?? '').toLowerCase().includes(needle) ||
    tx.token.toLowerCase().includes(needle) ||
    currencySymbol(tx.token).toLowerCase().includes(needle)
  );
}

const searched = computed<MidnightTransaction[]>(() => {
  const needle = debouncedSearch.value.trim().toLowerCase();
  if (!needle) return transactions.value;
  return transactions.value.filter(tx => matchesSearch(tx, needle));
});

const filtered = computed<MidnightTransaction[]>(() => {
  let result = searched.value;

  if (filterDateFrom.value) {
    const from = new Date(filterDateFrom.value).getTime();
    result = result.filter(tx => tx.timestamp >= from);
  }
  if (filterDateTo.value) {
    const to = new Date(filterDateTo.value).getTime() + 86_400_000; // end of day
    result = result.filter(tx => tx.timestamp < to);
  }
  if (filterTypes.value.length > 0) {
    result = result.filter(tx => filterTypes.value.includes(tx.type));
  }
  if (filterTokens.value.length > 0) {
    result = result.filter(tx => filterTokens.value.includes(tx.token));
  }
  return result;
});

// Rows the filter menu hid — surfaced so filtering never looks like an
// empty wallet (see e0af42bc). Search-caused misses aren't counted here:
// the user typed that themselves, so it can't read as lost funds.
const hiddenByFilterCount = computed(() => searched.value.length - filtered.value.length);

/**
 * Amount sort orders rows by the number AS DISPLAYED on each row (the scaled
 * decimal value, or raw base units when a token's decimals are unknown) —
 * NOT a cross-token value ranking. "10 USDM" sorting above "0.5 NIGHT"
 * doesn't mean the USDM row is worth more; different tokens' raw amounts
 * aren't comparable. This only gives a stable order matching what's printed
 * next to each row, per the displayed number.
 */
function displayedNumericValue(tx: MidnightTransaction): number {
  const divisor = tokenDivisor(tx.token);
  if (divisor === null) return Number(tx.amount);
  return Number(tx.amount) / Number(divisor);
}

const sorted = computed<MidnightTransaction[]>(() => {
  const list = [...filtered.value];
  const dir = sortDesc.value ? -1 : 1;
  list.sort((a, b) => {
    let diff: number;
    if (sortBy.value === 'blockHeight') diff = (a.blockHeight ?? -1) - (b.blockHeight ?? -1);
    else if (sortBy.value === 'amount') diff = displayedNumericValue(a) - displayedNumericValue(b);
    else diff = (a.timestamp ?? 0) - (b.timestamp ?? 0);
    return diff * dir;
  });
  return list;
});

// Row selection — mirrors TransactionsCard.vue's row-click contract: clicking
// a row emits it to the parent (Transactions.vue), which renders it in the
// detail pane alongside this list. Compared on hash+token (not hash alone),
// matching the v-for key, so a multi-token tx's rows highlight independently.
function isSelected(tx: MidnightTransaction): boolean {
  return !!props.selectedTransaction
    && props.selectedTransaction.hash === tx.hash
    && props.selectedTransaction.token === tx.token;
}

function selectRow(tx: MidnightTransaction): void {
  emit('row-click', tx);
}

function currencySymbol(token: string): string {
  if (token === 'NIGHT' || token === 'DUST') {
    return isMainnet.value ? token : `t${token}`;
  }
  // A real token color (not NIGHT/DUST). Fall back to a head+tail truncation
  // — not a prefix, so a malicious issuer can't grind a colliding prefix and
  // impersonate a listed token (same reasoning as MidnightHoldingsTable.vue).
  return midnightTokenMeta(token)?.symbol ?? `${token.slice(0, 8)}…${token.slice(-6)}`;
}

/** Base-unit divisor for a token, or null when its decimals aren't known. */
function tokenDivisor(token: string): bigint | null {
  if (token === 'NIGHT') return NIGHT_DIVISOR;
  if (token === 'DUST') return DUST_DIVISOR;
  const meta = midnightTokenMeta(token);
  return meta ? 10n ** BigInt(meta.decimals) : null;
}

/**
 * True when the token's decimals are unknown, so the amount shown is the raw
 * base-unit integer rather than a scaled value. Never guess an exponent —
 * a wrong balance is worse than an obviously-unscaled one (see e0af42bc).
 */
function isUnscaled(token: string): boolean {
  return tokenDivisor(token) === null;
}

function formatBigDecimal(value: bigint, divisor: bigint, fractionDigits: number): string {
  if (value < 0n) value = 0n;
  const whole = value / divisor;
  const remainder = value % divisor;
  if (fractionDigits === 0) return whole.toLocaleString('en-US');
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

function typeLabel(type: MidnightTransactionType): string {
  switch (type) {
    case 'send': return t('transactions.sent');
    case 'receive': return t('transactions.received');
    case 'register_dust': return t('midnight.txRegisterDust');
    case 'deregister_dust': return t('midnight.txDeregisterDust');
    case 'shield': return t('midnight.txShield');
    case 'unshield': return t('midnight.txUnshield');
    case 'contract_call': return t('midnight.txContractCall');
    default: return t('transactions.transaction');
  }
}

function amountColor(type: MidnightTransactionType): string {
  if (type === 'receive') return '#47CD89';
  if (type === 'send') return '#F97066';
  return '#c4c4c4';
}

function formatAmountSigned(tx: MidnightTransaction): string {
  const sign = tx.type === 'receive' ? '+' : tx.type === 'send' ? '−' : '';
  const divisor = tokenDivisor(tx.token);
  if (divisor === null) {
    // Unknown color: raw base units, no guessed exponent (see e0af42bc).
    return `${sign}${tx.amount.toString()} ${currencySymbol(tx.token)}`;
  }
  const fractionDigits = tx.token === 'DUST' ? 4 : 2;
  return `${sign}${formatBigDecimal(tx.amount, divisor, fractionDigits)} ${currencySymbol(tx.token)}`;
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
}

function shortAddress(addr: string): string {
  if (!addr) return '';
  const sepIdx = addr.indexOf('1');
  const prefix = sepIdx > 0 ? addr.slice(0, sepIdx) : addr.slice(0, 7);
  return `${prefix}…${addr.slice(-4)}`;
}

function shortHash(hash: string): string {
  if (!hash) return '';
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

async function copyHash(hash: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(hash);
    snackbar.fireSuccess(t('common.copied'));
  } catch {
    snackbar.setError(t('common.somethingWentWrong'));
  }
}
</script>

<style scoped>
.mn-tx-list {
  padding: 14px 16px;
  border-radius: 14px;
}

.mn-tx-list__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.mn-tx-list__title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.mn-tx-list__toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.mn-tx-list__search {
  max-width: 160px;
}

.mn-tx-list__sort-select {
  max-width: 150px;
}

.mn-tx-list__empty {
  padding: 32px 0;
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
}

.mn-tx-list__hidden-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 4px;
  margin-bottom: 4px;
}

.mn-tx-row-wrap {
  display: flex;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.mn-tx-row-wrap:last-child {
  border-bottom: none;
}

.mn-tx-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 4px;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mn-tx-row:hover {
  background: var(--g-hairline-1);
}

.mn-tx-row--selected {
  background: var(--g-hairline-2);
}

.mn-tx-row__main {
  flex: 1;
  min-width: 0;
}

.mn-tx-row__type {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
}

.mn-tx-row__meta {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mn-tx-row__counterparty {
  font-family: 'Roboto Mono', monospace;
}

.mn-tx-row__hash-text {
  flex-shrink: 0;
  font-family: 'Roboto Mono', monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.mn-tx-row__amount {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex-shrink: 0;
  font-family: 'Roboto Mono', monospace;
  font-size: 13px;
  font-weight: 600;
  min-width: 140px;
  text-align: right;
}
</style>
