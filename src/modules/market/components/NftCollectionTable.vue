<template>
  <v-card flat class="transparent pa-0">

    <!-- Loading -->
    <div v-if="loading && filteredCollections.length === 0" class="d-flex justify-center py-6">
      <v-progress-circular indeterminate size="28" color="primary" />
    </div>

    <!-- Empty state -->
    <div v-else-if="filteredCollections.length === 0" class="text-center py-6" style="opacity: 0.5">
      <v-icon large class="mb-2">mdi-image-off-outline</v-icon>
      <div>{{ $t('portfolio.noNftData') }}</div>
    </div>

    <!-- Data table -->
    <v-data-table
      v-else
      dense
      class="transparent nft-collection-table"
      :headers="headers"
      :items="filteredCollections"
      :items-per-page="-1"
      hide-default-footer
      :sort-by.sync="sortBy"
      :sort-desc.sync="sortDesc"
      :header-props="{ 'sort-icon': 'mdi-menu-up' }"
      @click:row="handleRowClick"
    >
      <!-- Rank column -->
      <template v-slot:[`item.rank`]="{ index }">
        <span class="mono-num" style="opacity: 0.4">{{ index + 1 }}</span>
      </template>

      <!-- Collection column (image + name) -->
      <template v-slot:[`item.policyId`]="{ item }">
        <div class="d-flex align-center">
          <v-avatar size="28" class="mr-2" tile rounded>
            <v-img v-if="item.img" :src="item.img" :alt="item.name" />
            <v-icon v-else small>mdi-image-outline</v-icon>
          </v-avatar>
          <span class="collection-name">{{ item.name }}</span>
          <v-chip v-if="item.isScam" x-small color="error" class="ml-1">SCAM</v-chip>
        </div>
      </template>

      <!-- Held column -->
      <template v-slot:[`item.quantity`]="{ item }">
        <span class="mono-num">{{ item.quantity || 0 }}</span>
      </template>

      <!-- Floor Price column -->
      <template v-slot:[`item.floorPriceLovelace`]="{ item }">
        <span v-if="item.floorPriceLovelace != null" class="mono-num floor-price">
          {{ formatAda(item.floorPriceLovelace) }} &#8371;
        </span>
        <span v-else class="mono-num" style="opacity: 0.4">—</span>
      </template>

      <!-- Volume column -->
      <template v-slot:[`item.totalVolumeLovelace`]="{ item }">
        <span v-if="item.totalVolumeLovelace != null" class="mono-num">
          {{ formatCompact(item.totalVolumeLovelace / 1_000_000) }} &#8371;
        </span>
        <span v-else class="mono-num" style="opacity: 0.4">—</span>
      </template>

      <!-- Sales column -->
      <template v-slot:[`item.saleCount`]="{ item }">
        <span v-if="item.saleCount != null" class="mono-num">
          {{ item.saleCount.toLocaleString() }}
        </span>
        <span v-else class="mono-num" style="opacity: 0.4">—</span>
      </template>

      <!-- No data -->
      <template v-slot:no-data>
        <div class="text-center py-6" style="opacity: 0.5">
          <v-icon large class="mb-2">mdi-image-off-outline</v-icon>
          <div>{{ $t('portfolio.noNftData') }}</div>
        </div>
      </template>
    </v-data-table>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useNftMarketData } from '@/modules/market/composables/useNftMarketData';
import { useTranslation } from '@/shared/composables/useTranslation';

const props = withDefaults(defineProps<{
  hideScam?: boolean;
}>(), {
  hideScam: false,
});

const emit = defineEmits<{
  (e: 'collection-click', policyId: string): void;
}>();

const { t } = useTranslation();
const { collections, loading, totalFloorValue, fetchUserNftCollections } = useNftMarketData();

const filteredCollections = computed(() => {
  if (!props.hideScam) return collections.value;
  return collections.value.filter(c => !c.isScam);
});

const sortBy = ref('quantity');
const sortDesc = ref(true);

const headers = [
  { text: '#', value: 'rank', sortable: false, width: '40px' },
  { text: t('portfolio.collection'), value: 'policyId', sortable: true },
  { text: t('portfolio.held'), value: 'quantity', sortable: true, width: '60px' },
  { text: t('portfolio.floorPrice'), value: 'floorPriceLovelace', sortable: true, width: '100px' },
  { text: t('portfolio.volume'), value: 'totalVolumeLovelace', sortable: true, width: '100px' },
  { text: t('portfolio.sales'), value: 'saleCount', sortable: true, width: '70px' },
];

onMounted(() => {
  fetchUserNftCollections();
});

function handleRowClick(item: any) {
  emit('collection-click', item.policyId);
}

function formatAda(lovelace: number): string {
  return (lovelace / 1_000_000).toFixed(2);
}

import { formatCompact } from '@/modules/market/utils/formatters';
</script>

<style scoped>
.nft-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.7);
}

.nft-floor-value {
  font-size: 12px;
  font-family: 'Roboto Mono', monospace;
  font-variant-numeric: tabular-nums;
  color: #00c7f3;
}

.collection-name {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
}

.mono-num {
  font-family: 'Roboto Mono', monospace;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.floor-price {
  color: #00c7f3;
}

/* Table overrides */
.nft-collection-table ::v-deep .v-data-table__wrapper {
  overflow-x: auto;
}

.nft-collection-table ::v-deep table {
  background: transparent !important;
}

.nft-collection-table ::v-deep th {
  font-size: 11px !important;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.5) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
  white-space: nowrap;
}

.nft-collection-table ::v-deep td {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
  padding-top: 6px !important;
  padding-bottom: 6px !important;
}

.nft-collection-table ::v-deep tbody tr {
  cursor: pointer;
}

.nft-collection-table ::v-deep tbody tr:hover {
  background: rgba(0, 199, 243, 0.04) !important;
}

/* Right-align numeric columns */
.nft-collection-table ::v-deep th:nth-child(n+2),
.nft-collection-table ::v-deep td:nth-child(n+2) {
  text-align: right !important;
}
</style>
