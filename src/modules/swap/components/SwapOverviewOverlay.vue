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
              {{ estimation['net_price'] | toCurrency(false, 2, '', ' '+tokenB['ticker'], false, 0) }}
            </v-card-subtitle>
          </v-col>
          <v-col cols="12" xl="4" lg="4" md="4">
            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left pa-0 pb-2" >
              Min. Receive
            </v-card-title>
            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">
              {{ estimation['total_output'] | toCurrency(false, 2, '', ' '+tokenB['ticker'], false, 0) }}
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
        <v-divider class="mt-1"></v-divider>
      </v-card-title>
      <v-card-text class="d-flex justify-space-around justify-center flex-column py-1" style="overflow-y: auto; height: calc(100% - 125px)">
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
                  {{ dex.amount | toCurrency(false, 2, '', ` ${tokenA['ticker']}`, true, 0)}}
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
<script lang="ts">
import { defineComponent } from 'vue';
import filters from '@/shared/utils/filters';
import rules from '@/shared/utils/rules';
import { mapState } from 'pinia';
import { useStore} from '@/store';
import { walletConfigStore } from '@/store/modules/walletConfig';

export default defineComponent({
  name: 'SwapOverviewOverlay',
  props: {
    value: {
      type: Boolean,
    },
    tokenA: {
      type: Object,
    },
    tokenB: {
      type: Object,
    },
    slippage: {
      type: String,
    },
    estimation: {
      type: Object
    }
  },
  computed: {
    ...mapState(useStore, ['loggedWallet', 'baseAddress']),
    ...mapState(walletConfigStore, ['utxos']),
    dexes() {
      if (this.estimation && this.estimation['splits']) {
        const template = JSON.parse(JSON.stringify(this.dexesTemplate))
        let totalAmount = 0
        this.estimation['splits'].forEach(split => {
          totalAmount += split.amount_in
        })
        this.estimation['splits'].forEach(split => {
          const dex = template.find(dex => dex.name === split.dex)
          if (dex) {
            dex.amount += split.amount_in
            dex.priceImpact = split.price_impact
            dex.percentage = dex.amount / totalAmount * 100
          }
        })
        return template
      } else {
        return this.dexesTemplate
      }
    }
  },
  filters,
  methods: {
    toggleExclude(dexName) {
      if (!this.excluded.includes(dexName)) {
        if (this.excluded.length != this.dexes.length - 1) {
          this.excluded.push(dexName)
        }
      } else {
        const index = this.excluded.indexOf(dexName)
        if (index > -1) {
          this.excluded.splice(index, 1)
        }
      }
      this.$emit('excludedChange', this.excluded)
    },
    closeOverlay() {
      this.$emit('input', false);
    },
  },
  data: () => ({
    dexesTemplate: [
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
    ],
    excluded: [],
    swapData: {
      bonusOutput: 'Direct Swap',
      netPriceReverse: 0
    }
  }),
});
</script>
<style scoped>
.v-list-item__content {
  padding: 4px 0;
}
</style>
