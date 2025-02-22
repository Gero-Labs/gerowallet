<template>
  <div style="width: 120px; display: inline-flex" v-if="chart.length > 0">
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
<script>
import { appWallet, useStore } from '@/store';
import { mapState } from 'pinia';

export default {
  name: 'Sparkline',
  props: {
    width: {
      type: Number,
      default: 2
    }
  },
  computed: {
    ...mapState(useStore, ['price']),
    priceChange() {
      if (this.price?.priceChange) {
        return Number(this.price.priceChange)
      }
      return 0
    }
  },
  methods: {
    async fetch() {
      if (appWallet) {
        try {
          this.chart = await appWallet.api.fetchHistory()
        } catch (error) {
          console.error(error)
        }
      }
    }
  },
  data: () => ({
    radius: 0,
    padding: 0,
    lineCap: 'round',
    gradient: ['#fff'],
    type: 'trend',
    autoLineWidth: false,
    chart: [],
  }),
  async mounted() {
    await this.fetch()
    setInterval(async () => {
      await this.fetch()
    },60000);
  }
}
</script>

<style scoped>
</style>
