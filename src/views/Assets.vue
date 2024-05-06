<template>
    <v-layout>
      <v-row no-gutters>
        <v-col cols="12" md="7" class="pa-2">
          <v-card outlined class="no-gutters fill-height">
            <v-card-title>
              Portfolio
              <v-spacer></v-spacer>
              <span style="font-size: 14px">addr1q9hnmantdjruxqzc9</span>
              <v-btn outlined small class="ml-2">
                <v-icon small>
                  mdi-content-copy
                </v-icon>
                Copy
              </v-btn>
            </v-card-title>
            <v-card-text>
              <portfolio-chart :chart-data="computeChartData" y-axis-title=""></portfolio-chart>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="5" class="pa-2">
          <v-card flat class="transparent row no-gutters fill-height d-flex justify-space-between align-content-space-between">
            <v-card-text>
              <assets-pie-chart :chart-data="computePieChartData"></assets-pie-chart>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" class="pa-2">
          <v-card outlined class="no-gutters fill-height">
            <v-card-title>Token Allocation (3)
            <v-spacer></v-spacer>
              <v-btn-toggle mandatory active-class="highlight">
                <v-btn :value="1" rounded>
                  Assets
                </v-btn>
                <v-btn :value="2" rounded>
                  Collectibles
                </v-btn>
              </v-btn-toggle>
            </v-card-title>
            <v-card-text>
              <v-data-table :headers="headers">

              </v-data-table>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-layout>
</template>
<script>

import PortfolioChart from "@/components/charts/PortfolioChart.vue";
import AssetsPieChart from "@/components/charts/AssetsPieChart.vue";

export default {
  name: 'assets',
  components: {AssetsPieChart, PortfolioChart},
  methods: {

  },
  computed: {
    computeChartData() {
      return this.chartData
    },
    computePieChartData() {
      return [
          ['Assets',70.67],
          ['Collectibles', 29.33]
      ]
    }
  },
  data: () => ({
    chartData: [],
    headers: [
      { text: 'Asset', align: 'start', sortable: true, value: 'asset' },
      { text: 'Amount', align: 'start', sortable: true, value: 'amount' },
      { text: 'Price', align: 'start', sortable: true, value: 'price' },
      { text: 'Cost Basis', align: 'start', sortable: true, value: 'cost_basis' },
      { text: 'Value', align: 'start', sortable: true, value: 'value' },
      { text: 'AVG Price', align: 'start', sortable: true, value: 'avg_price' },
      { text: 'P&L', align: 'start', sortable: true, value: 'pnl' },
      { text: 'Allocation', align: 'start', sortable: true, value: 'allocation' },
      { text: 'Last 7 Days', align: 'start', sortable: true, value: 'last_7_days' },
    ]
  }),
  async mounted() {
    this.chartData = await fetch(
        'https://demo-live-data.highcharts.com/aapl-c.json'
    ).then(response => response.json())
  }
}
</script>
<style>
.theme--dark.highlight {
  background-color: #00DFF3!important;
  color: black!important;
}
</style>
