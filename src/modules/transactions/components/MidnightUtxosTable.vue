<template>
  <!-- History tab's UTxO-tab counterpart to UtxosTable.vue — same searchable/
       sortable list idea, but built from plain rows (not v-data-table) so it
       never has to fight Vuetify's injected table CSS for specificity (the
       design audit's forced-override budget has zero headroom). Mirrors
       MidnightTransactionsList.vue's toolbar for the same reason. -->
  <v-card flat class="glass-panel mn-utxos-table">
    <div class="mn-utxos-table__head">
      <span class="mn-utxos-table__title">
        {{ $t('transactions.utxos') }} ({{ sorted.length }})
      </span>

      <div class="mn-utxos-table__toolbar">
        <v-text-field
          v-model="search"
          dense
          flat
          solo
          hide-details
          clearable
          :placeholder="$t('common.search')"
          prepend-inner-icon="mdi-magnify"
          class="mn-utxos-table__search"
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
          class="mn-utxos-table__sort-select"
        />
      </div>
    </div>

    <div v-if="sorted.length === 0" class="mn-utxos-table__empty">
      {{ $t('transactions.noUtxos') }}
    </div>

    <div v-else class="mn-utxos-table__rows">
      <div v-for="row in sorted" :key="row.id" class="mn-utxo-row-wrap">
        <button
          type="button"
          class="mn-utxo-row"
          :class="{ 'mn-utxo-row--selected': isSelected(row) }"
          @click="select(row)"
        >
          <div class="mn-utxo-row__main">
            <div class="mn-utxo-row__ref">{{ truncateHash(row.intentHash) }}:{{ row.outputIndex }}</div>
            <div class="mn-utxo-row__owner">
              {{ truncateAddress(row.owner) }}
              <span v-if="row.registeredForDustGeneration" class="mn-utxo-row__badge">
                {{ $t('midnight.registered') }}
              </span>
            </div>
          </div>
          <div class="mn-utxo-row__amount">
            <span>{{ row.amountFormatted }}</span>
            <v-tooltip v-if="row.isUnscaledAmount" top content-class="custom-tooltip">
              <template v-slot:activator="{ on, attrs }">
                <v-icon x-small color="warning" v-bind="attrs" v-on="on">mdi-help-circle-outline</v-icon>
              </template>
              {{ $t('midnight.rawBalanceNotice') }}
            </v-tooltip>
          </div>
        </button>
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue';
import debounce from 'lodash/debounce';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import type { MidnightUnshieldedUtxo } from '@/chains/midnight/midnightTypes';
import { midnightTokenMeta } from '@/chains/midnight/midnightTokenRegistry';
import { isNativeNight } from '@/chains/midnight/midnightTokenBalances';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();
const emit = defineEmits(['row-click']);
const props = defineProps<{ selectedUtxo?: MidnightUtxoRow | null }>();

const { loggedWallet } = toRefs(walletStore);
const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);

// Debounced 300ms, matching MidnightTransactionsList and Cardano's
// TransactionsCard. This file's header claims to mirror that pattern; without
// this it filtered on every keystroke instead.
const search = ref('');
const debouncedSearch = ref('');
const debouncedUpdateSearch = debounce((value: string) => {
  debouncedSearch.value = value;
}, 300);
watch(search, value => debouncedUpdateSearch(value));
type SortField = 'amount' | 'ref';
const sortBy = ref<SortField>('amount');
const sortDesc = ref(true);

const sortOptions = computed(() => [
  { text: t('transactions.amount'), value: 'amount' },
  { text: t('transactions.utxoRef'), value: 'ref' },
]);

/** Base-unit divisor for a token color, or null when its decimals aren't known. */
function tokenDivisor(tokenType: string): bigint | null {
  if (isNativeNight(tokenType)) return NIGHT_DIVISOR;
  const meta = midnightTokenMeta(tokenType);
  return meta ? 10n ** BigInt(meta.decimals) : null;
}

function tokenSymbol(tokenType: string): string {
  if (isNativeNight(tokenType)) return isMainnet.value ? 'NIGHT' : 'tNIGHT';
  // Head+tail truncation, not a prefix — see midnightTokenRegistry.ts.
  return midnightTokenMeta(tokenType)?.symbol ?? `${tokenType.slice(0, 8)}…${tokenType.slice(-6)}`;
}

function formatBigDecimal(value: bigint, divisor: bigint, fractionDigits: number): string {
  if (value < 0n) value = 0n;
  const whole = value / divisor;
  const remainder = value % divisor;
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

export interface MidnightUtxoRow {
  id: string;
  owner: string;
  tokenType: string;
  value: bigint;
  intentHash: string;
  outputIndex: number;
  ctime?: number;
  registeredForDustGeneration: boolean;
  symbol: string;
  amountNumeric: number;
  amountFormatted: string;
  isUnscaledAmount: boolean;
}

function toRow(u: MidnightUnshieldedUtxo): MidnightUtxoRow {
  const divisor = tokenDivisor(u.tokenType);
  const symbol = tokenSymbol(u.tokenType);
  return {
    id: `${u.intentHash}:${u.outputIndex}`,
    owner: u.owner,
    tokenType: u.tokenType,
    value: u.value,
    intentHash: u.intentHash,
    outputIndex: u.outputIndex,
    ctime: u.ctime,
    registeredForDustGeneration: u.registeredForDustGeneration,
    symbol,
    // Never guess an exponent for an unlisted color (see e0af42bc) — sort by
    // the raw integer instead of a scaled value when decimals are unknown.
    amountNumeric: divisor === null ? Number(u.value) : Number(u.value) / Number(divisor),
    amountFormatted: divisor === null
      ? `${u.value.toString()} ${symbol}`
      : `${formatBigDecimal(u.value, divisor, 2)} ${symbol}`,
    isUnscaledAmount: divisor === null,
  };
}

const rows = computed<MidnightUtxoRow[]>(() => midnightStore.utxos.map(toRow));

const searched = computed<MidnightUtxoRow[]>(() => {
  const needle = debouncedSearch.value?.trim().toLowerCase();
  if (!needle) return rows.value;
  return rows.value.filter(r =>
    r.intentHash.toLowerCase().includes(needle) ||
    r.owner.toLowerCase().includes(needle) ||
    r.symbol.toLowerCase().includes(needle) ||
    r.id.toLowerCase().includes(needle)
  );
});

const sorted = computed<MidnightUtxoRow[]>(() => {
  const list = [...searched.value];
  const dir = sortDesc.value ? -1 : 1;
  list.sort((a, b) => {
    const diff = sortBy.value === 'ref'
      ? (a.intentHash.localeCompare(b.intentHash) || a.outputIndex - b.outputIndex)
      : a.amountNumeric - b.amountNumeric;
    return diff * dir;
  });
  return list;
});

function isSelected(row: MidnightUtxoRow): boolean {
  return props.selectedUtxo?.id === row.id;
}

function select(row: MidnightUtxoRow): void {
  emit('row-click', row);
}

function truncateHash(hash: string): string {
  if (!hash || hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 20) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
}
</script>

<style scoped>
.mn-utxos-table {
  padding: 14px 16px;
  border-radius: 14px;
}

.mn-utxos-table__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.mn-utxos-table__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
}

.mn-utxos-table__toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.mn-utxos-table__search {
  max-width: 160px;
}

.mn-utxos-table__sort-select {
  max-width: 150px;
}

.mn-utxos-table__empty {
  padding: 32px 0;
  text-align: center;
  font-size: 13px;
  color: var(--g-text-3);
}

.mn-utxos-table__rows {
  overflow-y: auto;
  max-height: calc(100vh - 227px);
}

.mn-utxo-row-wrap {
  border-bottom: 1px solid var(--g-hairline-1);
}

.mn-utxo-row-wrap:last-child {
  border-bottom: none;
}

.mn-utxo-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.mn-utxo-row:hover {
  background: var(--g-hairline-1);
}

.mn-utxo-row--selected {
  background: var(--g-hairline-2);
}

.mn-utxo-row__main {
  flex: 1;
  min-width: 0;
}

.mn-utxo-row__ref {
  font-family: var(--g-font-mono);
  font-size: 12px;
  color: var(--g-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mn-utxo-row__owner {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--g-text-3);
}

.mn-utxo-row__badge {
  font-size: 10px;
  padding: 1px var(--g-s-2);
  border-radius: var(--g-r-pill);
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
  color: var(--g-success);
}

.mn-utxo-row__amount {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex-shrink: 0;
  font-family: var(--g-font-mono);
  font-size: 13px;
  font-weight: 600;
  min-width: 120px;
  color: var(--g-text-1);
  text-align: right;
}
</style>
