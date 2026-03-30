<template>
  <div class="balance-section">
    <div class="balance-label text-caption grey--text">
      {{ $t('miniGero.portfolioValue') }}
    </div>
    <div class="balance-row">
      <span class="balance-amount text-h5 white--text font-weight-bold">
        {{ formattedBalance }}
      </span>
    </div>
    <div class="balance-sub text-caption" :class="changeColor">
      <span v-if="adaBalance !== null">
        {{ formattedAdaBalance }} ADA
      </span>
      <span v-if="priceChange !== null" class="ml-2">
        <v-icon x-small :color="priceChange >= 0 ? '#47CD89' : '#F97066'">
          {{ priceChange >= 0 ? 'mdi-arrow-up' : 'mdi-arrow-down' }}
        </v-icon>
        {{ Math.abs(priceChange).toFixed(2) }}%
      </span>
    </div>
    <v-btn
      rounded
      small
      color="#00c7f3"
      class="buy-sell-btn mt-3 geroButton"
      @click="$emit('buy-sell')"
    >
      <v-icon small left>mdi-swap-horizontal</v-icon>
      {{ $t('miniGero.buySellAda') }}
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { getBalance } from '@/chrome/serialization';
import { useMarketData } from '@/modules/market/composables/useMarketData';

defineEmits<{
  (e: 'buy-sell'): void;
}>();

const { utxos, collateral } = toRefs(walletStore);
const { allTokens: marketTokens, adaData } = useMarketData();

const adaBalance = computed<number | null>(() => {
  if (!utxos.value || utxos.value.length === 0) return 0;
  try {
    const balance = getBalance(utxos.value, collateral.value);
    return Number(balance.coin().toString()) / 1_000_000;
  } catch {
    return 0;
  }
});

const adaPrice = computed(() => {
  return adaData.value?.priceUsd || priceStore.adaUsd?.lastPrice || 0;
});

const priceChange = computed<number | null>(() => {
  return adaData.value?.priceChange24h ?? priceStore.adaUsd?.priceChangePercentage ?? null;
});

// Compute portfolio value reactively from wallet balances × live market prices
// Same logic as PortfolioPage.myHoldings — reacts to UTXOs changes, price updates, and sync
const totalPortfolioUsd = computed(() => {
  const ada = adaBalance.value || 0;
  let total = ada * adaPrice.value;

  const tokens = walletStore.tokens;
  if (tokens) {
    for (const token of Object.values(tokens) as any[]) {
      if (token.policy_id === '') continue;
      const marketToken = marketTokens.value.find(t => t.unit === token.unit);
      if (marketToken?.price) {
        const decimals = token.metadata?.decimals ?? 0;
        let amount = Number(token.quantity || 0);
        if (decimals > 0) amount = amount / Math.pow(10, decimals);
        total += amount * marketToken.price;
      }
    }
  }
  return total;
});

const totalPortfolioAda = computed(() => {
  if (adaPrice.value === 0) return adaBalance.value || 0;
  return totalPortfolioUsd.value / adaPrice.value;
});

const formattedBalance = computed(() => {
  const val = totalPortfolioUsd.value;
  if (val === 0) return '$0.00';
  if (val < 0.01) return '<$0.01';
  return '$' + val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
});

const formattedAdaBalance = computed(() => {
  const val = totalPortfolioAda.value;
  if (val === 0) return '0';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: val < 1 ? 6 : 2,
  });
});

const changeColor = computed(() => {
  if (priceChange.value === null || priceChange.value === 0) return 'grey--text';
  return priceChange.value > 0 ? 'green-change' : 'red-change';
});
</script>

<style scoped>
.balance-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 16px 12px;
}

.balance-label {
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-size: 11px !important;
}

.balance-row {
  margin-top: 4px;
}

.balance-amount {
  letter-spacing: -0.5px;
}

.balance-sub {
  display: flex;
  align-items: center;
  margin-top: 2px;
  font-size: 12px !important;
}

.green-change {
  color: #47CD89 !important;
}

.red-change {
  color: #F97066 !important;
}

.buy-sell-btn {
  text-transform: none;
  font-weight: 600;
  letter-spacing: 0;
  font-size: 13px;
  padding: 0 20px !important;
}
</style>
