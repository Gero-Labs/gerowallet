<template>
  <div class="d-flex column">
    <v-list-item two-line class="px-0" style="max-width: 96px">
      <v-list-item-avatar size="32" class="mr-2">
        <v-img :src="currencyLogo" contain></v-img>
      </v-list-item-avatar>
      <v-list-item-content v-if="price">
        <v-list-item-title style="font-size: 14px; margin-bottom: 0" :style="{color: ticker.prevPrice === ticker.lastPrice ? '#fff' : (ticker.prevPrice > ticker.lastPrice ? '#ff6464' : '#47cd89')}">
          {{ filters.toCurrency(ticker.lastPrice, false, 4, '$', '', false, 0) }}
        </v-list-item-title>
        <v-list-item-subtitle v-if="ticker.priceChangePercent" style="font-size: 12px" :style="{color: Number(ticker.priceChangePercent) === 0 ? '#fff' : (Number(ticker.priceChangePercent) < 0 ? '#ff6464' : '#47cd89')}">
          {{ `${ticker.priceChangePercent}%` }}
        </v-list-item-subtitle>
      </v-list-item-content>
    </v-list-item>
    <v-divider vertical class="mx-1" style="max-height: 30px;min-height: 30px;align-self: center;"></v-divider>
  </div>
</template>
<script setup lang="ts">
import { computed, toRefs, watch, ref, onMounted } from 'vue';
import networks from '@/utils/networks';
import { networkStore } from '@/stores/networkStore';
import { walletStore } from '@/stores/walletStore';
import filters from '@/shared/utils/filters';

const { price } = toRefs(networkStore);
const { loggedWallet } = toRefs(walletStore);
const ticker = ref<Object>({
  prevPrice: 0,
  lastPrice: 0,
  priceChange: 0,
  priceChangePercent: 0,
})

watch(price, (val) => {
  ticker.value.prevPrice = ticker.value.lastPrice;
  ticker.value.lastPrice = val.lastPrice;
  ticker.value.priceChange = Number(val.priceChange).toFixed(3);
  ticker.value.priceChangePercent = Number(val.priceChangePercent).toFixed(2);
}, { deep: true })

const currencyLogo = computed(() => {
  return networks.resolveCurrencyImage(loggedWallet.value?.chain, loggedWallet.value?.network)
})

onMounted(() => {
  ticker.value.prevPrice = ticker.value.lastPrice;
  ticker.value.lastPrice = price.value.lastPrice;
  ticker.value.priceChange = Number(price.value.priceChange).toFixed(3);
  ticker.value.priceChangePercent = Number(price.value.priceChangePercent).toFixed(2);
})
</script>
