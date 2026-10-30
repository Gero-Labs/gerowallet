<template>
  <!-- The UTxOs tab's list on a Bitcoin wallet, in the History list's design
       (TransactionsCard.vue) so the two tabs read as one page. Sync stores the
       wallet's unspent outputs in walletStore.utxos as IUnifiedUtxo records. -->
  <v-card class="btc-utxos glass-panel fill-height d-flex flex-column" variant="outlined">
    <div class="btc-utxos__head">
      <div class="btc-utxos__title-row">
        <h2 class="btc-utxos__title t-heading">{{ $t('transactions.utxos') }}</h2>
        <span class="btc-utxos__count g-num">{{ rows.length }}</span>
        <v-spacer />
        <button
          type="button"
          class="btc-icon-btn"
          :aria-label="sortLabel"
          :title="sortLabel"
          @click="sortDesc = !sortDesc"
        >
          <v-icon size="small">{{ sortDesc ? 'mdi-sort-numeric-descending' : 'mdi-sort-numeric-ascending' }}</v-icon>
        </button>
      </div>

      <!-- The input is the pill, so the baseline focus ring draws around it. -->
      <div class="btc-search">
        <v-icon size="small" class="btc-search__icon">mdi-magnify</v-icon>
        <input
          v-model="search"
          type="search"
          class="btc-search__input"
          :placeholder="$t('common.search')"
          :aria-label="$t('common.search')"
          @keydown.esc="search = ''"
        />
      </div>
    </div>

    <div class="btc-utxos__scroll">
      <div v-if="shown.length === 0" class="btc-utxos__empty">
        <TxGlyph icon="mdi-cube-outline" large />
        <span class="btc-utxos__empty-title">{{ $t('transactions.noUtxos') }}</span>
      </div>

      <template v-else>
        <div
          v-for="row in shown"
          :key="row.id"
          :class="['btc-utxo', { 'btc-utxo--selected': isSelected(row) }]"
        >
          <button
            type="button"
            class="btc-utxo__main"
            :aria-current="isSelected(row) ? 'true' : undefined"
            @click="emit('row-click', row)"
          >
            <TxGlyph icon="mdi-cube-outline" :tone="row.confirmed ? 'neutral' : 'warning'" />
            <span class="btc-utxo__text">
              <span class="btc-utxo__ref g-mono">{{ shortOutpoint(row) }}</span>
              <span class="btc-utxo__meta">
                <span class="g-mono" :title="row.address">{{ shortAddress(row.address) }}</span>
                <TxTag v-if="row.kind === 'change'" :tag="changeTag" />
                <TxTag v-if="!row.confirmed" :tag="unconfirmedTag" />
              </span>
            </span>
            <span class="btc-utxo__value">
              <span :class="['btc-utxo__amount', 'g-num', { 'btc-utxo__amount--pending': !row.confirmed }]">
                {{ formatBtc(row.sats) }} {{ ticker }}
              </span>
              <span class="btc-utxo__sats g-num">{{ $t('bitcoin.satsValue', { value: formatSats(row.sats) }) }}</span>
            </span>
          </button>
        </div>
      </template>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref, toRefs } from 'vue';
import TxGlyph from '@/modules/transactions/components/TxGlyph.vue';
import TxTag from '@/modules/transactions/components/TxTag.vue';
import networks from '@/utils/networks';
import { walletStore } from '@/stores/walletStore';
import { formatBtc, formatSats } from '@/shared/utils/format';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { TxTag as TxTagModel } from '@/modules/dashboard/utils/transactionClassifier';
import { bitcoinUtxoRows, shortOutpoint, type BitcoinUtxoRow } from './bitcoinUtxoRows';

const props = defineProps<{ selectedUtxo?: BitcoinUtxoRow | null }>();
const emit = defineEmits<{ 'row-click': [row: BitcoinUtxoRow] }>();

const { t } = useTranslation();
const { loggedWallet, utxos } = toRefs(walletStore);

const ticker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)
);

const rows = computed(() => bitcoinUtxoRows(utxos.value));

const search = ref('');
const sortDesc = ref(true);
const sortLabel = computed(() => (sortDesc.value ? t('transactions.sortLargestFirst') : t('transactions.sortSmallestFirst')));

const shown = computed(() => {
  const needle = search.value.trim().toLowerCase();
  const matched = needle
    ? rows.value.filter((row) => row.id.toLowerCase().includes(needle) || row.address.toLowerCase().includes(needle))
    : rows.value;
  const dir = sortDesc.value ? -1 : 1;
  return [...matched].sort((a, b) => {
    if (a.sats === b.sats) return a.id.localeCompare(b.id);
    return (a.sats < b.sats ? -1 : 1) * dir;
  });
});

const changeTag = computed<TxTagModel>(() => ({ key: 'change', label: t('receive.changeChip') }));
const unconfirmedTag = computed<TxTagModel>(() => ({ key: 'unconfirmed', label: t('mempool.unconfirmed'), icon: 'mdi-clock-outline' }));

function isSelected(row: BitcoinUtxoRow): boolean {
  return props.selectedUtxo?.id === row.id;
}

function shortAddress(address: string): string {
  if (!address || address.length <= 20) return address;
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}
</script>

<style scoped>
.btc-utxos {
  overflow: hidden;
}

/* ─── Header ─────────────────────────────────────────────────── */
.btc-utxos__head {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4) var(--g-s-4) var(--g-s-3);
}

.btc-utxos__title-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.btc-utxos__title {
  margin: 0;
  color: var(--g-text-1);
}

.btc-utxos__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-2);
  color: var(--g-text-2);
  font-size: 12px;
  font-weight: 600;
}

.btc-icon-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--g-r-control);
  background: transparent;
  color: var(--g-text-2);
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), color var(--g-dur-fast) var(--g-ease);
}

.btc-icon-btn:hover {
  background: var(--g-hairline-1);
  color: var(--g-text-1);
}

.btc-icon-btn .v-icon {
  color: inherit;
}

.btc-search {
  position: relative;
}

.btc-search .btc-search__icon {
  position: absolute;
  top: 50%;
  left: var(--g-s-3);
  transform: translateY(-50%);
  color: var(--g-text-3);
  pointer-events: none;
}

.btc-search__input {
  width: 100%;
  height: 36px;
  padding: 0 var(--g-s-3) 0 36px;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
  color: var(--g-text-1);
  font: inherit;
  font-size: 13px;
}

.btc-search__input::placeholder {
  color: var(--g-text-3);
}

.btc-search__input::-webkit-search-cancel-button {
  cursor: pointer;
}

/* ─── List ───────────────────────────────────────────────────── */
.btc-utxos__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 var(--g-s-2) var(--g-s-2);
  scrollbar-width: thin;
  scrollbar-color: var(--g-hairline-3) transparent;
}

.btc-utxos__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-3);
  padding: var(--g-s-6) var(--g-s-4);
  text-align: center;
}

.btc-utxos__empty-title {
  color: var(--g-text-1);
  font-size: 14px;
  font-weight: 600;
}

.btc-utxo {
  border-radius: var(--g-r-control);
  transition: background-color var(--g-dur-fast) var(--g-ease), box-shadow var(--g-dur-fast) var(--g-ease);
}

.btc-utxo:hover {
  background: var(--g-hairline-1);
}

.btc-utxo--selected {
  background: color-mix(in srgb, var(--g-accent) 8%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--g-accent) 30%, transparent);
}

.btc-utxo__main {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  width: 100%;
  min-height: 60px;
  padding: 10px var(--g-s-3);
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.btc-utxo__text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.btc-utxo__ref {
  overflow: hidden;
  color: var(--g-text-1);
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btc-utxo__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  color: var(--g-text-3);
  font-size: 12px;
  line-height: 1.3;
  white-space: nowrap;
}

.btc-utxo__value {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--g-s-1);
}

.btc-utxo__amount {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.btc-utxo__amount--pending {
  color: var(--g-warning);
}

.btc-utxo__sats {
  color: var(--g-text-3);
  font-size: 12px;
  white-space: nowrap;
}
</style>
