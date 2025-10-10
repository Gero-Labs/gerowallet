<template>
  <div style="width: 120px; min-width: 50px; display: inline-flex" v-if="chart.length > 0">
    <v-sparkline :value="chart"
                 :gradient="priceChange > 0 ? ['#47cd89'] : ['#f97066']"
                 :smooth="radius || false"
                 :padding="padding"
                 :line-width="width"
                 :stroke-linecap="lineCap"
                 :type="type"
                 :auto-line-width="autoLineWidth"
                 height="30"
                 style="max-width: 120px">
    </v-sparkline>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onUnmounted, toRefs, computed } from 'vue';
import cryptoApi from '@/api/crypto-api';
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';

const width = ref<number>(2);
const radius = ref<number>(0);
const padding = ref<number>(0);
const lineCap = ref<string>('round');
const gradient = ref<string[]>(['#fff']);
const type = ref<string>('trend');
const autoLineWidth = ref<boolean>(false);
const chart = ref<number[]>([]);
const intervalId = ref<number>(null);

const { price } = toRefs(networkStore)

const priceChange = computed(() => {
  // Use Kraken WebSocket price change, fallback to network store
  const krakenChange = priceStore.adaUsd?.priceChange;
  const networkChange = price.value?.priceChange;
  
  if (krakenChange !== undefined && krakenChange !== null) {
    return Number(krakenChange);
  }
  if (networkChange) {
    return Number(networkChange);
  }
  return 0;
})

const fetch = async () => {
  try {
    chart.value = await cryptoApi.fetchHistory()
  } catch (error) {
    console.error(error)
  }
}

onMounted(async () => {
  // OPTIMIZATION: Defer chart data loading to improve initial page load
  // Load after 500ms to not block wallet initialization
  setTimeout(async () => {
    await fetch()
    intervalId.value = setInterval(async () => {
      await fetch()
    }, 60000);
  }, 500);
})

onUnmounted(() => {
  clearInterval(intervalId.value);
})
</script>

<style scoped>
</style>
