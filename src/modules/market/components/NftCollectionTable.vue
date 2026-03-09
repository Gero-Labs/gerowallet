<template>
  <v-card flat class="liquid-glass-compact pa-3">
    <!-- Header -->
    <div class="d-flex align-center justify-space-between mb-2">
      <span class="nft-title">{{ $t('portfolio.nfts') }}</span>
      <span v-if="hasNfts" class="nft-floor-value">
        {{ $t('portfolio.totalFloorValue') }}: {{ totalFloorValue.toFixed(2) }} &#8371;
      </span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="d-flex justify-center py-6">
      <v-progress-circular indeterminate size="28" color="primary" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!hasNfts" class="text-center py-6" style="opacity: 0.5">
      <v-icon large class="mb-2">mdi-image-off-outline</v-icon>
      <div>{{ $t('portfolio.noNftData') }}</div>
    </div>

    <!-- Data table -->
    <v-data-table
      v-else
      dense
      class="transparent nft-collection-table"
      :headers="headers"
      :items="collections"
      :items-per-page="-1"
      hide-default-footer
      :sort-by.sync="sortBy"
      :sort-desc.sync="sortDesc"
      :header-props="{ 'sort-icon': 'mdi-menu-up' }"
    >
      <!-- Collection column -->
      <template v-slot:[`item.policyId`]="{ item }">
        <span class="collection-name">{{ item.name || truncatePolicyId(item.policyId) }}</span>
      </template>

      <!-- Held column -->
      <template v-slot:[`item.quantity`]="{ item }">
        <span class="mono-num">{{ item.quantity || 0 }}</span>
      </template>

      <!-- Floor Price column -->
      <template v-slot:[`item.floorPriceLovelace`]="{ item }">
        <span class="mono-num floor-price">{{ formatAda(item.floorPriceLovelace) }} &#8371;</span>
      </template>

      <!-- Volume column -->
      <template v-slot:[`item.totalVolumeLovelace`]="{ item }">
        <span class="mono-num">{{ formatCompact(item.totalVolumeLovelace / 1_000_000) }} &#8371;</span>
      </template>

      <!-- Sales column -->
      <template v-slot:[`item.saleCount`]="{ item }">
        <span class="mono-num">{{ item.saleCount.toLocaleString() }}</span>
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
import { ref, onMounted } from 'vue';
import { useNftMarketData } from '@/modules/market/composables/useNftMarketData';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();
const { collections, loading, hasNfts, totalFloorValue, fetchUserNftCollections } = useNftMarketData();

const sortBy = ref('floorPriceLovelace');
const sortDesc = ref(true);

const headers = [
  { text: t('portfolio.collection'), value: 'policyId', sortable: true },
  { text: t('portfolio.held'), value: 'quantity', sortable: true, width: '60px' },
  { text: t('portfolio.floorPrice'), value: 'floorPriceLovelace', sortable: true, width: '100px' },
  { text: t('portfolio.volume'), value: 'totalVolumeLovelace', sortable: true, width: '100px' },
  { text: t('portfolio.sales'), value: 'saleCount', sortable: true, width: '70px' },
];

onMounted(() => {
  fetchUserNftCollections();
});

function truncatePolicyId(policyId: string): string {
  if (!policyId || policyId.length <= 16) return policyId;
  return policyId.slice(0, 8) + '...' + policyId.slice(-8);
}

function formatAda(lovelace: number): string {
  return (lovelace / 1_000_000).toFixed(2);
}

function formatCompact(value: number): string {
  if (value >= 1e9) return (value / 1e9).toFixed(1) + 'B';
  if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toFixed(value < 1 ? 2 : 0);
}
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

.nft-collection-table ::v-deep tbody tr:hover {
  background: rgba(0, 199, 243, 0.04) !important;
}

/* Right-align numeric columns */
.nft-collection-table ::v-deep th:nth-child(n+2),
.nft-collection-table ::v-deep td:nth-child(n+2) {
  text-align: right !important;
}
</style>
