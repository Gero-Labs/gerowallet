<template>
  <v-card class="liquid-glass fill-height d-flex flex-column" outlined>
    <v-card-title class="pb-2 flex-grow-0">
      <span>{{ $t('transactions.utxos') }}</span>
      <v-spacer />
      <v-text-field
        v-model="search"
        dense
        flat
        solo
        hide-details
        :placeholder="$t('common.search')"
        prepend-inner-icon="mdi-magnify"
        clearable
        style="max-width: 200px"
        class="top-level-search tx-search-field"
      ></v-text-field>
    </v-card-title>
    <v-card-text class="pa-0 text-center flex-grow-1 d-flex flex-column">
      <div class="table-container flex-grow-1">
        <v-data-table
          :header-props="{ 'sort-icon': 'mdi-menu-up' }"
          :items="filteredUtxos"
          :headers="headers"
          class="transparent utxos-table"
          :sort-by.sync="sortBy"
          :sort-desc.sync="sortDesc"
          :items-per-page="-1"
          hide-default-footer
          dense
          @click:row="handleRowClick"
          :item-class="getRowClass"
        >
          <!-- UTxO Reference + Address -->
          <template v-slot:[`item.ref`]="{ item }">
            <v-list-item two-line class="px-0 py-1" style="height: 55px">
              <v-list-item-content class="px-0 py-1">
                <v-list-item-title class="activity-title">
                  <span class="activity-text">{{ truncateHash(item.txHash) }}#{{ item.outputIndex }}</span>
                </v-list-item-title>
                <v-list-item-subtitle class="activity-date">
                  {{ truncateAddress(item.address) }}
                  <v-chip
                    v-if="item.isCollateral"
                    x-small
                    outlined
                    class="px-1 ml-1"
                    color="orange"
                  >{{ $t('transactions.collateral') }}</v-chip>
                </v-list-item-subtitle>
              </v-list-item-content>
            </v-list-item>
          </template>

          <!-- ADA Amount -->
          <template v-slot:[`item.ada`]="{ item }">
            <div class="text-right">
              <div style="font-size: 13px; white-space: nowrap;">
                {{ formatAda(item.lovelace) }} <span style="opacity: 0.6; font-size: 11px">ADA</span>
              </div>
              <div v-if="item.tokenCount > 0" style="font-size: 11px; color: #c4c4c4; white-space: nowrap">
                +{{ item.tokenCount }} {{ $t('transactions.tokens').toLowerCase() }}
              </div>
            </div>
          </template>

          <!-- No data -->
          <template v-slot:no-data>
            <div class="pa-4" style="opacity: 0.5">{{ $t('transactions.noUtxos') }}</div>
          </template>
        </v-data-table>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, ref, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Cardano } from '@cardano-sdk/core';

const vm = getCurrentInstance()!.proxy;
const t = (key: string) => vm.$t(key) as string;
const emit = defineEmits(['row-click']);
const props = defineProps<{ selectedUtxo?: any }>();

const { utxos, collateral } = toRefs(walletStore);
const search = ref('');
const sortBy = ref<string>('ada');
const sortDesc = ref<boolean>(true);

interface UtxoRow {
  id: string;
  txHash: string;
  outputIndex: number;
  address: string;
  lovelace: bigint;
  ada: number;
  tokenCount: number;
  assets: Map<string, bigint> | undefined;
  datumHash: string | null;
  datum: any;
  scriptReference: any;
  isCollateral: boolean;
  raw: Cardano.Utxo;
}

const headers = computed(() => [
  { text: t('transactions.utxoRef'), align: 'start', sortable: true, value: 'ref' },
  { text: t('transactions.amount'), align: 'end', sortable: true, value: 'ada' },
]);

const utxoItems = computed<UtxoRow[]>(() => {
  const items = utxos.value as Cardano.Utxo[];
  if (!items || items.length === 0) return [];

  // Check if these are Cardano UTxOs (tuple format)
  if (!Array.isArray(items[0]) || items[0].length !== 2) return [];

  const collateralId = collateral.value
    ? `${(collateral.value as Cardano.Utxo)[0].txId}#${(collateral.value as Cardano.Utxo)[0].index}`
    : null;

  return items.map((utxo: Cardano.Utxo) => {
    const [txIn, txOut] = utxo;
    const lovelace = txOut.value.coins;
    const id = `${txIn.txId}#${txIn.index}`;
    return {
      id,
      txHash: txIn.txId as string,
      outputIndex: txIn.index,
      address: txOut.address as string,
      lovelace,
      ada: Number(lovelace) / 1_000_000,
      tokenCount: txOut.value.assets?.size || 0,
      assets: txOut.value.assets,
      datumHash: txOut.datumHash ? String(txOut.datumHash) : null,
      datum: txOut.datum || null,
      scriptReference: txOut.scriptReference || null,
      isCollateral: id === collateralId,
      raw: utxo,
    };
  });
});

const filteredUtxos = computed(() => {
  if (!search.value) return utxoItems.value;
  const q = search.value.toLowerCase();
  return utxoItems.value.filter(u =>
    u.txHash.toLowerCase().includes(q) ||
    u.address.toLowerCase().includes(q) ||
    u.id.toLowerCase().includes(q)
  );
});

function truncateHash(hash: string): string {
  if (!hash || hash.length <= 16) return hash;
  return hash.slice(0, 8) + '...' + hash.slice(-6);
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 24) return addr;
  return addr.slice(0, 12) + '...' + addr.slice(-8);
}

function formatAda(lovelace: bigint): string {
  const ada = Number(lovelace) / 1_000_000;
  return ada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function getRowClass(item: UtxoRow): string {
  return props.selectedUtxo?.id === item.id ? 'selected-utxo' : '';
}

function handleRowClick(item: UtxoRow) {
  emit('row-click', item);
}
</script>

<style scoped>
.utxos-table >>> .v-data-table__wrapper {
  overflow-y: auto;
}
.utxos-table >>> tr {
  cursor: pointer;
}
.utxos-table >>> tr:hover {
  background: rgba(255, 255, 255, 0.05) !important;
}
.utxos-table >>> tr.selected-utxo {
  background: rgba(255, 255, 255, 0.08) !important;
}
.table-container {
  overflow-y: auto;
  max-height: calc(100vh - 227px);
}

.activity-title {
  font-size: 12px !important;
  line-height: 1.2 !important;
  min-height: 14px !important;
}

.activity-text {
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  display: inline-block !important;
}

.activity-date {
  font-size: 10px !important;
  line-height: 1.1 !important;
  min-height: 11px !important;
}

.top-level-search.v-text-field {
  background: transparent !important;
}

.top-level-search >>> .v-input__slot {
  background: transparent !important;
  box-shadow: none !important;
}

.top-level-search >>> .v-input__control {
  background: transparent !important;
}

.top-level-search >>> .v-text-field__slot {
  background: transparent !important;
}

.top-level-search >>> .v-input__slot:before {
  border: none !important;
}

.top-level-search >>> .v-input__slot:after {
  border: none !important;
}

.top-level-search.v-text-field--solo > .v-input__control > .v-input__slot {
  background: transparent !important;
}
</style>
