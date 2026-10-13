<template>
  <v-card flat class="transparent pa-0">

    <!-- Loading -->
    <div v-if="loading && filteredCollections.length === 0" class="d-flex justify-center py-6">
      <v-progress-circular indeterminate size="28" color="primary" />
    </div>

    <!-- Empty state -->
    <div v-else-if="filteredCollections.length === 0" class="text-center py-6" style="opacity: 0.5">
      <v-icon size="large" class="mb-2">mdi-image-off-outline</v-icon>
      <div>{{ $t('portfolio.noNftData') }}</div>
    </div>

    <!-- Data table -->
    <v-data-table
      v-else
      density="compact"
      class="transparent nft-collection-table market-token-table"
      :headers="headers"
      :items="filteredCollections"
      item-value="policyId"
      :items-per-page="-1"
      hide-default-footer
      v-model:sort-by="sortBy"
      :header-props="{ 'sort-icon': 'mdi-menu-up' }"
      @click:row="handleRowClick"
    >
      <!-- Rank column -->
      <template v-slot:[`item.rank`]="{ index }">
        <span class="text--secondary" style="font-size: 12px">{{ index + 1 }}</span>
      </template>

      <!-- Collection name column (two-line: name + policyId) -->
      <template v-slot:[`item.policyId`]="{ item }">
        <v-list-item density="compact" class="px-0">
          <div class="my-0 g-list-action" style="margin-right: 12px !important">
            <v-avatar size="28" rounded>
              <v-img v-if="item.img" :src="item.img" :alt="item.name" />
              <v-icon v-else size="small">mdi-image-outline</v-icon>
            </v-avatar>
          </div>
          <div class="g-list-content">
            <v-list-item-title style="font-size: 13px">
              <span class="font-weight-bold">{{ item.name }}</span>
              <v-chip v-if="item.isScam" size="x-small" color="error" class="ml-1" style="height: 16px; font-size: 11px; padding: 0 4px;">
                {{ $t('portfolio.scam') }}
              </v-chip>
            </v-list-item-title>
            <v-list-item-subtitle class="d-flex align-center" style="font-size: 11px; opacity: 0.5">
              {{ filters.truncate(item.policyId) }}
              <CopyButton :value="item.policyId" x-small class="ml-1" />
            </v-list-item-subtitle>
          </div>
        </v-list-item>
      </template>

      <!-- Held column -->
      <template v-slot:[`item.quantity`]="{ item }">
        <span style="font-size: 12px">{{ item.quantity || 0 }}</span>
      </template>

      <!-- Floor Price column (two-line: ADA + floor value) -->
      <template v-slot:[`item.floorPriceLovelace`]="{ item }">
        <v-list-item v-if="item.floorPriceLovelace != null" lines="two" class="px-0" style="min-height: unset">
          <div class="pa-0 g-list-content">
            <v-list-item-title style="font-size: 13px; margin-bottom: 0; color: var(--g-accent);">
              {{ formatAda(item.floorPriceLovelace) }} &#8371;
            </v-list-item-title>
            <v-list-item-subtitle v-if="item.floorValueLovelace != null" style="font-size: 11px; opacity: 0.5">
              {{ formatCompact(item.floorValueLovelace / 1_000_000) }} &#8371; {{ $t('portfolio.total') }}
            </v-list-item-subtitle>
          </div>
        </v-list-item>
        <span v-else style="font-size: 12px; opacity: 0.4">—</span>
      </template>

      <!-- Last Sale column (two-line: price + vs floor) -->
      <template v-slot:[`item.lastSalePriceLovelace`]="{ item }">
        <v-list-item v-if="item.lastSalePriceLovelace != null" lines="two" class="px-0" style="min-height: unset">
          <div class="pa-0 g-list-content">
            <v-list-item-title style="font-size: 13px; margin-bottom: 0">
              {{ formatAda(item.lastSalePriceLovelace) }} &#8371;
            </v-list-item-title>
            <v-list-item-subtitle
              v-if="item.floorPriceLovelace != null && item.floorPriceLovelace > 0"
              style="font-size: 11px"
              :style="{ color: lastSaleVsFloorColor(item) }"
            >
              {{ lastSaleVsFloor(item) }}
            </v-list-item-subtitle>
          </div>
        </v-list-item>
        <span v-else style="font-size: 12px; opacity: 0.4">—</span>
      </template>

      <!-- Volume column -->
      <template v-slot:[`item.totalVolumeLovelace`]="{ item }">
        <v-tooltip location="top" v-if="item.totalVolumeLovelace != null"  :open-delay="300" content-class="custom-tooltip">
          <template v-slot:activator="{ props: activatorProps }">
            <span v-bind="activatorProps"  style="font-size: 12px">
              {{ formatCompact(item.totalVolumeLovelace / 1_000_000) }} &#8371;
            </span>
          </template>
          {{ (item.totalVolumeLovelace / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 0 }) }} &#8371;
        </v-tooltip>
        <span v-else style="font-size: 12px; opacity: 0.4">—</span>
      </template>

      <!-- Sales column -->
      <template v-slot:[`item.saleCount`]="{ item }">
        <span v-if="item.saleCount != null" style="font-size: 12px">
          {{ item.saleCount.toLocaleString() }}
        </span>
        <span v-else style="font-size: 12px; opacity: 0.4">—</span>
      </template>

      <!-- No data -->
      <template v-slot:no-data>
        <div class="text-center py-6" style="opacity: 0.5">
          <v-icon size="large" class="mb-2">mdi-image-off-outline</v-icon>
          <div>{{ $t('portfolio.noNftData') }}</div>
        </div>
      </template>
    </v-data-table>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { DataTableHeader, DataTableSortItem } from 'vuetify';
import { useNftMarketData, type NftCollectionDisplay } from '@/modules/market/composables/useNftMarketData';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatCompact } from '@/modules/market/utils/formatters';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';

const props = withDefaults(defineProps<{
  hideScam?: boolean;
}>(), {
  hideScam: false,
});

const emit = defineEmits<{
  (e: 'collection-click', policyId: string): void;
}>();

const { t } = useTranslation();
const { collections, loading, fetchUserNftCollections } = useNftMarketData();

const filteredCollections = computed(() => {
  if (!props.hideScam) return collections.value;
  return collections.value.filter(c => {
    // Explicitly flagged as scam
    if (c.isScam) return false;
    // Heuristic: no name (just truncated policyId), no image, and no market data → likely spam airdrop
    if (!c.img && c.floorPriceLovelace == null && c.saleCount == null && c.name === c.policyId.slice(0, 8) + '...') return false;
    return true;
  });
});

const sortBy = ref<DataTableSortItem[]>([{ key: 'floorValueLovelace', order: 'desc' }]);

const headers = computed<DataTableHeader[]>(() => [
  { title: '#', key: 'rank', sortable: false, width: '40px' },
  { title: t('portfolio.collection'), key: 'policyId', sortable: true },
  { title: t('portfolio.held'), key: 'quantity', sortable: true, width: '60px' },
  { title: t('portfolio.floorPrice'), key: 'floorPriceLovelace', sortable: true, width: '110px' },
  { title: t('portfolio.lastSale'), key: 'lastSalePriceLovelace', sortable: true, width: '110px' },
  { title: t('portfolio.volume'), key: 'totalVolumeLovelace', sortable: true, width: '90px', headerProps: { class: 'hidden-sm-and-down' }, cellProps: { class: 'hidden-sm-and-down' } },
  { title: t('portfolio.sales'), key: 'saleCount', sortable: true, width: '70px', headerProps: { class: 'hidden-md-and-down' }, cellProps: { class: 'hidden-md-and-down' } },
]);

onMounted(() => {
  fetchUserNftCollections();
});

function handleRowClick(_event: Event, { item }: { item: NftCollectionDisplay }) {
  emit('collection-click', item.policyId);
}

function formatAda(lovelace: number): string {
  const ada = lovelace / 1_000_000;
  if (ada < 1) return ada.toFixed(2);
  if (ada < 1000) return ada.toFixed(0);
  return formatCompact(ada);
}

/** Show last sale price relative to floor (e.g. "+25% above floor") */
function lastSaleVsFloor(item: NftCollectionDisplay): string {
  if (!item.lastSalePriceLovelace || !item.floorPriceLovelace || item.floorPriceLovelace === 0) return '';
  const diff = ((item.lastSalePriceLovelace - item.floorPriceLovelace) / item.floorPriceLovelace) * 100;
  if (Math.abs(diff) < 1) return '≈ floor';
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(0)}% vs floor`;
}

function lastSaleVsFloorColor(item: NftCollectionDisplay): string {
  if (!item.lastSalePriceLovelace || !item.floorPriceLovelace || item.floorPriceLovelace === 0) return '';
  const diff = item.lastSalePriceLovelace - item.floorPriceLovelace;
  if (Math.abs(diff / item.floorPriceLovelace) < 0.01) return 'var(--g-text-3)';
  return diff > 0 ? 'var(--g-success)' : 'var(--g-error)';
}
</script>

<style scoped>
.nft-collection-table >>> .v-table__wrapper {
  overflow-x: auto;
}

.nft-collection-table >>> tbody tr {
  cursor: pointer;
}

.nft-collection-table >>> tbody tr:hover {
  background: var(--g-hairline-1) !important;
}

.nft-collection-table >>> th {
  font-size: 11px !important;
  white-space: nowrap;
}

.nft-collection-table >>> td {
  padding-top: 4px !important;
  padding-bottom: 4px !important;
}

/* Hide columns responsively via class */
@media (max-width: 1264px) {
  .nft-collection-table >>> .hidden-md-and-down {
    display: none !important;
  }
}

@media (max-width: 960px) {
  .nft-collection-table >>> .hidden-sm-and-down {
    display: none !important;
  }
}
</style>
