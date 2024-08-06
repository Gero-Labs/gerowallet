<template>
  <div class="d-flex column" v-if="networks.resolveNetwork(this.loggedWallet?.chain, this.loggedWallet?.network)?.blockchain === Blockchain.CARDANO">
    <v-img width="28" :src="require('@/assets/svg/cardano.svg')" class="mr-2" contain></v-img>
    <span v-if="ticker.lastPrice" style="align-content: center; width: 58px; font-size: 14px" v-bind:style="{color: ticker.prevPrice === ticker.lastPrice ? '#fff' : (ticker.prevPrice > ticker.lastPrice ? '#ff6464' : '#47cd89')}">{{ '$'+ticker.lastPrice }}</span>
    <sparkline :divider="true"></sparkline>
  </div>
</template>
<script>
import {useStore} from "@/store";
import {mapState} from "pinia";
import socket from "@/plugins/socket";
import Sparkline from '@/modules/navigation/components/Sparkline.vue';
import networks from '@/shared/utils/networks';
import { Blockchain } from '@/models/types';

export default {
  name: 'PriceTicker',
  components: { Sparkline },
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
  async mounted() {
    const provider = useStore().getWallet.api
    const data = await provider.fetchADAStatistics();
    this.ticker.prevPrice = this.ticker.lastPrice;
    this.ticker.lastPrice = Number(data.lastPrice).toFixed(4);
    this.ticker.priceChange = Number(data.priceChange).toFixed(3);
    this.ticker.priceChangePercent = Number(data.priceChangePercent).toFixed(2);
  },
  computed: {
    Blockchain() {
      return Blockchain
    },
    ...mapState(useStore, ['price', 'loggedWallet']),
  },
  data: () => ({
    networks,
    socket,
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
  })
}
</script>
