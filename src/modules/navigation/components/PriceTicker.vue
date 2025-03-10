<template>
  <div class="d-flex column">
    <v-list-item two-line class="px-0" style="max-width: 96px">
      <v-list-item-avatar size="32" class="mr-2">
        <v-img :src="currencyIcon" contain></v-img>
      </v-list-item-avatar>
      <v-list-item-content v-if="ticker.lastPrice">
        <v-list-item-title style="font-size: 14px; margin-bottom: 0" :style="{color: ticker.prevPrice === ticker.lastPrice ? '#fff' : (ticker.prevPrice > ticker.lastPrice ? '#ff6464' : '#47cd89')}">
          {{ '$'+ticker.lastPrice }}
        </v-list-item-title>
        <v-list-item-subtitle v-if="ticker.priceChangePercent" style="font-size: 12px" :style="{color: Number(ticker.priceChangePercent) === 0 ? '#fff' : (Number(ticker.priceChangePercent) < 0 ? '#ff6464' : '#47cd89')}">
          {{ `${ticker.priceChangePercent}%` }}
        </v-list-item-subtitle>
      </v-list-item-content>
    </v-list-item>
    <v-divider vertical class="mx-2" style="max-height: 30px;min-height: 30px;align-self: center;"></v-divider>
  </div>
</template>
<script>
import { appWallet, useStore } from '@/store';
import {mapState} from "pinia";
import networks from '@/shared/utils/networks';
import { Blockchain } from '@/models/types';

export default {
  name: 'PriceTicker',
  watch: {
    price: {
      handler(val) {
        if (val) {
          //TODO push to sparkline (this.chart) and shift
          this.ticker.prevPrice = this.ticker.lastPrice;
          this.ticker.lastPrice = Number(val.lastPrice).toFixed(4);
          this.ticker.priceChange = Number(val.priceChange).toFixed(3);
          this.ticker.priceChangePercent = Number(val.priceChangePercent).toFixed(2);
        }
      },
      deep: true,
    }
  },
  computed: {
    Blockchain() {
      return Blockchain
    },
    currencyIcon() {
      if (this.loggedWallet) {
        return networks.resolveCurrencyImage(this.loggedWallet?.chain, this.loggedWallet?.network);
      }
      return ''
    },
    ...mapState(useStore, ['price', 'loggedWallet']),
  },
  methods: {
    async fetch() {
      if (appWallet) {
        try {
          const data = await appWallet.api.fetchADAStatistics();
          this.ticker.prevPrice = this.ticker.lastPrice;
          this.ticker.lastPrice = Number(data.lastPrice).toFixed(4);
          this.ticker.priceChange = Number(data.priceChange).toFixed(3);
          this.ticker.priceChangePercent = Number(data.priceChangePercent).toFixed(2);
        } catch (error) {
          console.error(error)
        }
      }
    }
  },
  data: () => ({
    networks,
    ticker: {
      prevPrice: 0,
      lastPrice: 0,
      priceChange: 0,
      priceChangePercent: 0,
    },
    width: 2,
    radius: 0,
    padding: 0,
    lineCap: 'round',
    gradient: ['#fff'],
    type: 'trend',
    autoLineWidth: false,
  }),
  async mounted() {
    await this.fetch()
  },
}
</script>
