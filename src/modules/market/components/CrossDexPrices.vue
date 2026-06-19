<template>
  <div class="cross-dex-container">
    <span class="text-caption text--secondary mb-2 d-block">{{ $t('market.crossDex') }}</span>
    <div v-if="loading" class="d-flex justify-center py-4">
      <v-progress-circular indeterminate size="24" color="primary" />
    </div>
    <div v-else-if="errorMsg" class="text-center py-4 text-caption" style="color: #F97066">{{ errorMsg }}</div>
    <v-simple-table v-else-if="prices.length" dense class="transparent dex-table">
      <thead>
        <tr>
          <th style="font-size: 11px">DEX</th>
          <th class="text-right" style="font-size: 11px">{{ $t('market.price') }} ({{ currencyTicker }})</th>
          <th class="text-right" style="font-size: 11px">{{ $t('market.price') }} (USD)</th>
          <th class="text-right" style="font-size: 11px">TVL</th>
          <th class="text-right" style="font-size: 11px">{{ $t('market.volume24h') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, idx) in prices" :key="idx" :class="{ 'best-price': p.isBest }">
          <td style="font-size: 12px">
            {{ formatDexName(p.dex || 'Unknown') }}
            <v-chip v-if="p.isBest" x-small color="primary" class="ml-1">{{ $t('market.bestPrice') }}</v-chip>
          </td>
          <td class="text-right" style="font-size: 12px">{{ formatPrice(p.priceAda) }}</td>
          <td class="text-right" style="font-size: 12px">${{ formatPrice(p.priceUsd) }}</td>
          <td class="text-right" style="font-size: 12px">{{ formatCompact(p.liquidity || p.tvl || 0) }} {{ currencySymbol }}</td>
          <td class="text-right" style="font-size: 12px">${{ formatCompact(p.volume24h || 0) }}</td>
        </tr>
      </tbody>
    </v-simple-table>
    <div v-else class="text-center py-4 text--secondary text-caption">{{ $t('market.na') }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import marketApi, { type TokenPriceResponse } from '@/api/market-api';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';

const { t } = useTranslation();
const { currencySymbol, currencyTicker } = useNativeCurrency();

const props = defineProps<{ assetId: string }>();

interface DexPrice extends TokenPriceResponse { isBest: boolean; }
const prices = ref<DexPrice[]>([]);
const loading = ref(false);
const errorMsg = ref('');

async function loadPrices() {
  if (!props.assetId || props.assetId === 'lovelace') { prices.value = []; return; }
  loading.value = true;
  errorMsg.value = '';
  try {
    const raw = await marketApi.getTokenPricesAcrossDexes(props.assetId);
    if (!raw?.length) { prices.value = []; return; }

    const bestPrice = Math.max(...raw.map(p => p.priceUsd ?? 0));
    prices.value = raw
      .sort((a, b) => (b.liquidity ?? b.tvl ?? 0) - (a.liquidity ?? a.tvl ?? 0))
      .map(p => ({ ...p, isBest: p.priceUsd === bestPrice }));
  } catch (err: any) {
    console.warn('CrossDexPrices: failed to load', err);
    errorMsg.value = t('market.failedToLoadDexPrices');
    prices.value = [];
  } finally {
    loading.value = false;
  }
}

function formatDexName(dex: string): string {
  return dex.replace(/_/g, ' ').replace(/V(\d)/g, ' v$1').replace(/\b\w/g, l => l.toUpperCase());
}

import { formatPriceRaw, formatCompact } from '@/modules/market/utils/formatters';

function formatPrice(price: number | null | undefined): string {
  if (price == null) return '-';
  return formatPriceRaw(price);
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
