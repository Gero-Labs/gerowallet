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
import { ref, onMounted, onUnmounted, computed } from 'vue';
import cryptoApi from '@/api/crypto-api';
import { priceStore } from '@/stores/priceStore';



const width = ref<number>(2);
const radius = ref<number>(0);
const padding = ref<number>(0);
const lineCap = ref<string>('round');
const _gradient = ref<string[]>(['#fff']);
const type = ref<string>('trend');
const autoLineWidth = ref<boolean>(false);
const chart = ref<number[]>([]);
const intervalId = ref<number>(null);


const priceChange = computed(() => {
  // Live Kraken ticker 24h change
  const krakenChange = priceStore.adaUsd?.priceChange;
  
  if (krakenChange !== undefined && krakenChange !== null) {
    return Number(krakenChange);
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
