<template>
  <v-overlay
    absolute
    :value="value"
    opacity="0.94"
    class="settingsOverlay"
    color="black"
  >
    <v-card class="fill-height transparent">
      <v-card-title class="pb-0">
        <v-btn small icon @click="closeOverlay">
          <v-icon>mdi-swap-vertical-bold</v-icon>
        </v-btn>
        <v-spacer></v-spacer>
        Swap Overview
        <v-spacer></v-spacer>
        <v-btn small icon @click="closeOverlay">
          <v-icon>mdi-window-close</v-icon>
        </v-btn>
        <v-row no-gutters>
          <v-col cols="12" xl="4" lg="4" md="4">
            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left pa-0 pb-2" >
              Routes
            </v-card-title>
            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">
              {{ estimation['splits']?.length > 1 ? estimation['splits'].length : 'Direct'  }}
            </v-card-subtitle>
          </v-col>
          <v-col cols="12" xl="4" lg="4" md="4">
            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left pa-0 pb-2" >
              Net Price
            </v-card-title>
            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">
              {{ filters.toCurrency(estimation['net_price'] || 0, false, 2, '', ' '+tokenB['ticker'], false, 0) }}
            </v-card-subtitle>
          </v-col>
          <v-col cols="12" xl="4" lg="4" md="4">
            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left pa-0 pb-2" >
              Min. Receive
            </v-card-title>
            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">
              {{ filters.toCurrency(estimation['total_output'] || 0, false, 2, '', ' '+tokenB['ticker'], false, 0) }}
            </v-card-subtitle>
          </v-col>
<!--          <v-col cols="12" xl="4" lg="4" md="4">-->
<!--            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left pa-0 pb-2" >-->
<!--              Order Deposits-->
<!--            </v-card-title>-->
<!--            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">-->
<!--              {{ estimation['deposits'] | toCurrency(false, 0, '', ' ADA', false, 0) }}-->
<!--            </v-card-subtitle>-->
<!--          </v-col>-->
<!--          <v-col cols="12" xl="4" lg="4" md="4">-->
<!--            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left pa-0 pb-2" >-->
<!--              Batchers Fees-->
<!--            </v-card-title>-->
<!--            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">-->
<!--              {{ estimation['batcher_fee'] | toCurrency(false, 0, '', ' ADA', false, 0) }}-->
<!--            </v-card-subtitle>-->
<!--          </v-col>-->
<!--          <v-col cols="12" xl="4" lg="4" md="4">-->
<!--            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left pa-0 pb-2" >-->
<!--              Frontend Fee-->
<!--            </v-card-title>-->
<!--            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">-->
<!--              {{ estimation['partner_fee'] | toCurrency(false, 0, '', ' ADA', false, 0) }}-->
<!--            </v-card-subtitle>-->
<!--          </v-col>-->
        </v-row>
      </v-card-title>
      <v-card-text class="d-flex justify-space-around justify-center flex-column py-1" style="overflow-y: auto; height: calc(100% - 200px)">
        <v-row no-gutters>
          <v-col cols="6" v-for="(dex,index) in dexes" :key="index" style="height: 38px">
            <v-list-item class="px-2" dense>
              <v-list-item-action class="mr-2 my-0">
                <v-hover
                  v-slot="{ hover }"
                >
                  <v-btn icon small @click="toggleExclude(dex.name)">
                    <v-avatar size="24">
                      <v-img :src="dex.img" contain :style="dex.amount === 0 ? { filter: 'grayscale(1)' } : {}"></v-img>
                      <v-icon v-show="hover || excluded.includes(dex.name)" style="position: absolute; border: 2px solid red; border-radius: 50%"  color="red">
                        mdi-close
                      </v-icon>
                    </v-avatar>
                  </v-btn>
                </v-hover>
              </v-list-item-action>
              <v-list-item-content>
                <v-list-item-title class="text-left" style="font-size: 10px;" :style="dex.amount === 0 ? { color: 'grey'} : dex['priceImpact'] > 3 ? { color: '#FEC84B' } : {}">
                  {{ filters.toCurrency(dex.amount, false, 2, '', ` ${tokenA['ticker']}`, true, 0)}}
                </v-list-item-title>
                <v-list-item-subtitle>
                  <v-progress-linear height="8" color="#88919e" :value="dex.percentage"></v-progress-linear>
                </v-list-item-subtitle>
              </v-list-item-content>
            </v-list-item>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </v-overlay>
</template>
<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
import filters from '@/shared/utils/filters';
import { walletStore } from '@/stores/walletStore';

interface Props {
  value?: boolean;
  tokenA?: any;
  tokenB?: any;
  slippage?: string;
  estimation?: any;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  input: [value: boolean];
  excludedChange: [excluded: string[]];
}>();

const dexesTemplate = ref([
  { name: 'SPLASH', img: 'https://storage.googleapis.com/dexhunter-images/public/splashlogo.jpeg', amount: 0, priceImpact: 0, percentage: 0 },
  { name: 'MINSWAPV2', img: 'https://minswap.org/_next/static/media/minswap-v2-logo.25f219f1.svg', amount: 0, priceImpact: 0, percentage: 0 },
  { name: 'SUNDAESWAPV3', img: 'https://storage.googleapis.com/dexhunter-images/public/sundaev3.webp', amount: 0, priceImpact: 0, percentage: 0 },
  { name: 'AXO', img: 'https://storage.googleapis.com/dexhunter-images/public/axo.jpeg', amount: 0, priceImpact: 0, percentage: 0 },
  { name: 'VYFI', img: 'https://storage.googleapis.com/dexhunter-images/public/vyfi.png', amount: 0, priceImpact: 0, percentage: 0 },
  { name: 'WINGRIDER', img: 'https://storage.googleapis.com/dexhunter-images/public/wingriders.png', amount: 0, priceImpact: 0, percentage: 0 },
  { name: 'SPECTRUM', img: 'https://storage.googleapis.com/dexhunter-images/public/spectrum.png', amount: 0, priceImpact: 0, percentage: 0 },
  { name: 'MINSWAP', img: 'https://storage.googleapis.com/dexhunter-images/public/minswap.png', amount: 0, priceImpact: 0, percentage: 0 },
  { name: 'SUNDAESWAP', img: 'https://storage.googleapis.com/dexhunter-images/public/sundae.png', amount: 0, priceImpact: 0, percentage: 0 },
  { name: 'CERRASWAP', img: 'https://storage.googleapis.com/dexhunter-images/public/cerralogodh.png', amount: 0, priceImpact: 0, percentage: 0 },
  { name: 'SATURN', img: 'https://storage.googleapis.com/dexhunter-images/public/saturn.jpg', amount: 0, priceImpact: 0, percentage: 0 },
  { name: 'GENIUS', img: 'https://storage.googleapis.com/dexhunter-images/public/geniusyield.jpeg', amount: 0, priceImpact: 0, percentage: 0 },
  { name: 'MUESLISWAP', img: 'https://storage.googleapis.com/dexhunter-images/public/mueslilogodh.png', amount: 0, priceImpact: 0, percentage: 0 },
]);

const excluded = ref<string[]>([]);

const swapData = ref({
  bonusOutput: 'Direct Swap',
  netPriceReverse: 0
});

const dexes = computed(() => {
  if (props.estimation && props.estimation['splits']) {
    const template = JSON.parse(JSON.stringify(dexesTemplate.value));
    let totalAmount = 0;
    props.estimation['splits'].forEach((split: any) => {
      totalAmount += split.amount_in;
    });
    props.estimation['splits'].forEach((split: any) => {
      const dex = template.find((dex: any) => dex.name === split.dex);
      if (dex) {
        dex.amount += split.amount_in;
        dex.priceImpact = split.price_impact;
        dex.percentage = dex.amount / totalAmount * 100;
      }
    });
    return template;
  } else {
    return dexesTemplate.value;
  }
});

const toggleExclude = (dexName: string) => {
  if (!excluded.value.includes(dexName)) {
    if (excluded.value.length != dexes.value.length - 1) {
      excluded.value.push(dexName);
    }
  } else {
    const index = excluded.value.indexOf(dexName);
    if (index > -1) {
      excluded.value.splice(index, 1);
    }
  }
  emit('excludedChange', excluded.value);
};

const closeOverlay = () => {
  emit('input', false);
};
</script>
<style scoped>
.v-list-item__content {
  padding: 4px 0;
}
</style>
