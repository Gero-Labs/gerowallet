<template>
  <div class="cross-dex-container">
    <span class="text-caption text--secondary mb-2 d-block">{{ $t('market.crossDex') }}</span>
    <div v-if="loading" class="d-flex justify-center py-4">
      <v-progress-circular indeterminate size="24" color="primary" />
    </div>
    <v-simple-table v-else-if="prices.length" dense class="transparent dex-table">
      <thead>
        <tr>
          <th style="font-size: 11px">DEX</th>
          <th class="text-right" style="font-size: 11px">{{ $t('market.price') }} (ADA)</th>
          <th class="text-right" style="font-size: 11px">{{ $t('market.price') }} (USD)</th>
          <th class="text-right" style="font-size: 11px">{{ $t('market.volume24h') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in prices" :key="p.dex" :class="{ 'best-price': p.isBest }">
          <td style="font-size: 12px">
            {{ formatDexName(p.dex) }}
            <v-chip v-if="p.isBest" x-small color="primary" class="ml-1">{{ $t('market.bestPrice') }}</v-chip>
          </td>
          <td class="text-right" style="font-size: 12px">{{ p.priceAda.toFixed(p.priceAda < 1 ? 6 : 2) }}</td>
          <td class="text-right" style="font-size: 12px">${{ p.priceUsd.toFixed(p.priceUsd < 1 ? 6 : 4) }}</td>
          <td class="text-right" style="font-size: 12px">${{ formatCompact(p.volume24h) }}</td>
        </tr>
      </tbody>
    </v-simple-table>
    <div v-else class="text-center py-4 text--secondary text-caption">{{ $t('market.na') }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import marketApi, { type TokenPriceResponse } from '@/api/market-api';

const props = defineProps<{ assetId: string }>();

interface DexPrice extends TokenPriceResponse { isBest: boolean; }
const prices = ref<DexPrice[]>([]);
const loading = ref(false);

async function loadPrices() {
  if (!props.assetId || props.assetId === 'lovelace') { prices.value = []; return; }
  loading.value = true;
  try {
    const raw = await marketApi.getTokenPricesAcrossDexes(props.assetId);
    const bestPrice = Math.max(...raw.map(p => p.priceUsd));
    prices.value = raw
      .sort((a, b) => b.priceUsd - a.priceUsd)
      .map(p => ({ ...p, isBest: p.priceUsd === bestPrice }));
  } catch {
    prices.value = [];
  } finally {
    loading.value = false;
  }
}

function formatDexName(dex: string): string {
  return dex.replace(/_/g, ' ').replace(/V(\d)/g, ' v$1').replace(/\b\w/g, l => l.toUpperCase());
}

function formatCompact(value: number): string {
  if (value >= 1e9) return (value / 1e9).toFixed(1) + 'B';
  if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toFixed(0);
}

watch(() => props.assetId, () => loadPrices());
onMounted(() => loadPrices());
</script>

<style scoped>
.cross-dex-container {
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 12px;
}
.dex-table >>> td, .dex-table >>> th {
  border-bottom: 1px solid rgba(255,255,255,0.04) !important;
  padding: 6px 8px !important;
}
.dex-table >>> tr:last-child td { border-bottom: none !important; }
.best-price { background: rgba(38,250,176,0.04); }
</style>
