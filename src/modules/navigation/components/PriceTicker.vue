<template>
  <div class="d-flex column">
    <v-img width="28" :src="require('@/assets/svg/cardano.svg')" class="mr-2" contain></v-img>
    <span style="align-content: center; width: 58px; font-size: 14px" v-bind:style="{color: ticker.prevPrice === ticker.lastPrice ? '#fff' : (ticker.prevPrice > ticker.lastPrice ? '#ff6464' : '#47cd89')}">{{ '$'+ticker.lastPrice }}</span>
    <v-divider vertical class="mx-2" style="max-height: 30px;min-height: 30px;align-self: center;border-color: #00DFF3;"></v-divider>
    <div style="width: 120px">
      <v-sparkline :value="value"
                   :gradient="gradient"
                   :smooth="radius || false"
                   :padding="padding"
                   :line-width="width"
                   :stroke-linecap="lineCap"
                   :type="type"
                   :auto-line-width="autoLineWidth"
                   height="30"
                   style="max-width: 120px; height: 50px">
      </v-sparkline>
    </div>
  </div>
</template>
<script>
import {useStore} from "@/store";
import socket from "@/plugins/socket";

export default {
  name: 'PriceTicker',
  async mounted() {
    const provider = await useStore().getWallet.provider
    this.value = await provider.fetchHistory()
    console.log(this.value)
    this.usdToILS = await provider.fetchExchangeRate();
    const data = await provider.fetchADAStatistics();
    this.ticker.prevPrice = this.ticker.lastPrice;
    this.ticker.lastPrice = Number(data.lastPrice).toFixed(4);
    this.ticker.priceChange = Number(data.priceChange).toFixed(3);
    this.ticker.priceChangePercent = Number(data.priceChangePercent).toFixed(2);
    setInterval(async () => {
      this.usdToILS = await provider.fetchExchangeRate();
    },86400000);
    // setInterval(async () => {
    //   const data = await provider.fetchADAStatistics();
    //   this.ticker.prevPrice = this.ticker.lastPrice;
    //   this.ticker.lastPrice = Number(data.lastPrice).toFixed(4);
    //   this.ticker.priceChange = Number(data.priceChange).toFixed(3);
    //   this.ticker.priceChangePercent = Number(data.priceChangePercent).toFixed(2);
    // },3000);
  },
  watch: {
    'socket.message': {
      handler(val) {
        console.log(val)
        if (val.message_type === 'PRICE') {
          this.ticker.prevPrice = this.ticker.lastPrice;
          this.ticker.lastPrice = Number(val.object.lastPrice).toFixed(4);
          this.ticker.priceChange = Number(val.object.priceChange).toFixed(3);
          this.ticker.priceChangePercent = Number(val.object.priceChangePercent).toFixed(2);
        }
      },
      deep: true
    }
  },
  computed: {},
  data: () => ({
    socket,
    ticker: {
      prevPrice: 0,
      lastPrice: 0,
      priceChange: 0,
      priceChangePercent: 0,
    },
    usdToILS: 3.2,
    width: 2,
    radius: 0,
    padding: 0,
    lineCap: 'round',
    gradient: ['#fff'],
    type: 'trend',
    autoLineWidth: false,
    value: [],
  })
}
</script>