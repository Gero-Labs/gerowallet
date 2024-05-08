<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" xl="9" lg="7" md="12" sm="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
          <v-card-title>
            Portfolio
          </v-card-title>
          <v-card-text>
            <PortfolioChart :chart-data="computeChartData"></PortfolioChart>
            <v-row no-gutters v-if="chartData && chartData.length > 0">
              <div class="text-right justify-end">
                <v-btn small
                       style="text-transform: capitalize; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black"
                       to="/assets">Portfolio Breakdown&nbsp;
                  <v-icon small>
                    mdi-arrow-right
                  </v-icon>
                </v-btn>
              </div>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" xl="3" lg="5" md="12" sm="12" class="pa-2">
        <quick-actions></quick-actions>
      </v-col>
      <v-col cols="12" xl="8" lg="7" md="12" sm="12" class="pa-2">
        <StakingCard></StakingCard>
      </v-col>
      <v-col cols="12" xl="4" lg="5" md="12" sm="12" class="pa-2">
        <v-card outlined class="fill-height">
          <v-card-title>Recent Activity</v-card-title>
          <v-card-text class="px-0">
            <v-data-table :items="recentActivity" :headers="activityHeaders" class="transparent">
              <template v-slot:[`item.time`]="{ item }">
                <v-list-item two-line class="px-0">
                  <v-list-item-avatar tile :size="getIconSize(item)">
                    <v-img :src="getIcon(item)" :alt="item.status"></v-img>
                  </v-list-item-avatar>
                  <v-list-item-content>
                    <v-list-item-title>{{ item.status }}</v-list-item-title>
                    <v-list-item-subtitle>{{ item.time }}</v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>
              </template>
              <template v-slot:[`item.assets`]="{ item }">
                <stacked-tokens :tokens="item.assets"
                                :style="item.status === 'Pending' ? { opacity: '0.5'} : { }"></stacked-tokens>
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
import PortfolioChart from "@/shared/components/PortfolioChart.vue";
import StackedTokens from "@/modules/dashboard/components/StackedTokens.vue";
import filters from "@/shared/utils/filters";
import QuickActions from "@/modules/dashboard/components/QuickActions.vue";
import StakingCard from "../components/StakingCard.vue";
import {useStore} from "@/store";

export default {
  name: 'dashboard',
  components: {QuickActions, StackedTokens, PortfolioChart, StakingCard},
  computed: {
    computeChartData() {
      return this.chartData
    },
    computedRewards() {
      return this.rewardsData
    }
  },
  methods: {
    resolvePoolIcon(pool_id) {
      if (pool_id === 'asdsa')
        return require('@/assets/GeroPool.png');
      return ''
    },
    isNumeric(str) {
      if (typeof str != "string") return false // we only process strings!
      return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
          !isNaN(parseFloat(str)) // ...and ensure strings of whitespace fail
    },
    getIconSize(item) {
      if (item.status === 'Pending') {
        return 22
      } else if (item.status === 'Received') {
        return 18
      } else if (item.status === 'Sent') {
        return 18
      }
      return 22
    },
    getIcon(item) {
      if (item.status === 'Pending') {
        return require('@/assets/svg/arrows-right.svg')
      } else if (item.status === 'Received') {
        return require('@/assets/svg/arrows-up.svg')
      } else if (item.status === 'Sent') {
        return require('@/assets/svg/arrows-down.svg')
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
  filters,
  data: () => ({
    store: useStore,
    filters,
    chartData: [],
    rewardsData: {},
    activityHeaders: [
      {text: 'Tx Status', align: 'start', sortable: true, value: 'time'},
      {text: '', align: 'start', sortable: false, value: 'assets', width: 132},
      {text: 'Amount', align: 'start', sortable: false, value: 'amount'},
    ],
    recentActivity: [
      {status: 'Pending', time: '21/12/2023', assets: ['ADA', 'GERO'], ada: '+ ₳1.27'},
      {
        status: 'Received',
        time: '21/12/2023',
        assets: ['ADA', 'GERO', 'MUSICBOX', 'NIDO', 'GERO', 'TEST', 'TEST'],
        ada: '+ ₳88.00'
      },
      {status: 'Sent', time: '21/12/2023', assets: ['ADA'], ada: '- ₳8.30'},
    ],
    tabs: ['All', '12 Months', '3 Months', '30 Days', '7 Days', '24 Hours'],
    rewards: [
      { poolName: '[GERO] Gero Pool', epoch: '474', saturation: 0.2, pledge: 47000000000, ros: 0.05, fixed_fee: 340, margin_fee: 0 },
      { poolName: '[GERO] Gero Pool', epoch: '475', saturation: 0.2, pledge: 47000000000, ros: 0.05, fixed_fee: 340, margin_fee: 0 },
      { poolName: '[GERO] Gero Pool', epoch: '476', saturation: 0.2, pledge: 47000000000, ros: 0.05, fixed_fee: 340, margin_fee: 0 },
    ],
    stakingHeaders: [
      {text: 'Pool Name', align: 'start', sortable: true, value: 'pool_name'},
      {text: 'Epoch', align: 'start', sortable: true, value: 'epoch', width: 88},
      {text: 'Reward', align: 'start', sortable: true, value: 'reward', width: 100},
      {text: 'Change', align: 'start', sortable: true, value: 'change', width: 100},
      {text: 'Date', align: 'start', sortable: true, value: 'date', width: 30},
    ],
    rewardsHistory: [
      {pool_id: 'asdsa', pool_name: '[GERO] Gero Pool', epoch: '476', reward: '8000540', change: -0.2, date: '05/04/2024', time: '11:44 PM'},
      {pool_id: 'asdsa', pool_name: '[GERO] Gero Pool', epoch: '476', reward: 'Delegated', change: 0, date: '10/04/2024', time: '12:44 AM'}
    ]
  }),
  async mounted() {
    this.chartData = await fetch(
        'https://demo-live-data.highcharts.com/aapl-c.json'
    ).then(response => response.json())
    this.rewardsData = {
      '463': 7,
      '464': 10.2,
      '465': 3.9,
      '466': 8,
      '467': 3.5,
      '468': 9.4,
      '469': 7,
      '470': 10,
      '471': 7,
      '472': 9,
      '473': 10.5,
      '474': 6
    }
  }
}
</script>
<style>
.v-progress-linear__determinate {
  background: linear-gradient(90deg, #00c7f3, #00ffd1);
}
.v-data-table-header {
  background-color: rgb(22, 27, 38);
}
</style>