<template>
    <v-layout>
      <v-row>
        <v-col cols="12">
          <v-card outlined>
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
              <div class="text-right justify-end">
                <v-btn>Portfolio Breakdown</v-btn>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="8">
          <v-card outlined class="pa-4">
            <v-card-title>Staking</v-card-title>
            <v-card-text class="py-4" style="background-color: #171F21">
              <v-layout>
                <v-row no-gutters>
                  <v-col cols="6">
                    <h2 class="pb-4">Stake to Pool:</h2>
                    <h1 style="color: white">[GERO] Gero Pool</h1>
                  </v-col>
                  <v-col cols="3">
                    <h2 class="pb-4">Total ADA:</h2>
                    <h1 style="color: white">₳42.0k</h1>
                  </v-col>
                  <v-col cols="3">
                    <h2 class="pb-4">Rewards</h2>
                    <h1 style="color: white">₳1,068</h1>
                  </v-col>
                </v-row>
              </v-layout>
            </v-card-text>
            <v-card-text>
              <v-layout>

              </v-layout>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="4">
          <v-card outlined>
            <v-card-title>Recent Activity</v-card-title>
            <v-card-text class="px-0">
              <v-data-table :items="recentActivity" :headers="activityHeaders" class="transparent">
                <template v-slot:[`item.time`]="{ item }">
                  <v-list-item two-line>
                    <v-list-item-icon class="ma-0 mr-3" style="align-self: center">
                      <v-icon :color="getColor(item)">{{ getIcon(item) }}</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                      <v-list-item-title>{{item.status}}</v-list-item-title>
                      <v-list-item-subtitle>{{item.time}}</v-list-item-subtitle>
                    </v-list-item-content>
                  </v-list-item>
                </template>
                <template v-slot:[`item.amount`]="{ item }">
                  <span :style="{color: getColor(item)}">{{ item.ada }}</span>
                </template>
              </v-data-table>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-layout>
</template>
<script>

import PortfolioChart from "@/components/charts/PortfolioChart.vue";

export default {
  name: 'dashboard',
  components: {PortfolioChart},
  computed: {
    computeChartData() {
      return this.chartData
    }
  },
  methods: {
    getIcon(item) {
      if (item.status === 'Pending') {
        return 'mdi-chevron-double-up'
      } else if (item.status === 'Received') {
        return 'mdi-chevron-double-up'
      } else if (item.status === 'Sent') {
        return 'mdi-chevron-double-down'
      }
      return ''
    },
    getColor(item) {
      if (item.status === 'Pending') {
        return '#FEC84B'
      } else if (item.status === 'Received') {
        return '#17B26A'
      } else if (item.status === 'Sent') {
        return '#F97066'
      }
      return ''
    }
  },
  data: () => ({
    chartData: [],
    activityHeaders: [
      { text: 'Tx Status', align: 'start', sortable: true, value: 'time' },
      { text: '', align: 'start', sortable: false, value: 'assets' },
      { text: 'Amount', align: 'start', sortable: false, value: 'amount' },
    ],
    recentActivity: [
      { status: 'Pending', time: '21/12/2023', assets: [], ada: '+ ₳1.27'},
      { status: 'Received', time: '21/12/2023', assets: [], ada: '+ ₳88.00'},
      { status: 'Sent', time: '21/12/2023', assets: [], ada: '- ₳8.30'},
    ]
  }),
  async mounted() {
    this.chartData = await fetch(
        'https://demo-live-data.highcharts.com/aapl-c.json'
    ).then(response => response.json())
  }
}
</script>
