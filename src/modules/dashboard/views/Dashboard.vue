<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" xl="9" lg="7" md="12" sm="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
          <v-card-title class="row no-gutters d-flex justify-space-between">
            Portfolio
            <div v-if="computeChartData && computeChartData.length > 0">
              <v-btn small
                     style="text-transform: capitalize; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black"
                     to="/assets">Portfolio Breakdown&nbsp;
                <v-icon small>
                  mdi-arrow-right
                </v-icon>
              </v-btn>
            </div>
          </v-card-title>
          <v-card-text>
            <PortfolioChart :chart-data="computeChartData" :loading="loadingChart"></PortfolioChart>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" xl="3" lg="5" md="12" sm="12" class="pa-2">
        <quick-actions :utxos="calculatedUtxos"></quick-actions>
      </v-col>
      <v-col cols="12" xl="8" lg="7" md="12" sm="12" class="pa-2">
        <StakingCard :account="getAccountInfo" :pools="getPools" v-if="getAccountInfo?.controlled_amount"></StakingCard>
        <NoTokensCard v-else></NoTokensCard>
      </v-col>
      <v-col cols="12" xl="4" lg="5" md="12" sm="12" class="pa-2">
        <v-card outlined class="fill-height">
          <v-card-title>Transactions</v-card-title>
          <v-card-text class="pa-0">
            <v-data-table :items="calculatedTransactions" :headers="activityHeaders" class="transparent"
                          :sort-by.sync="sortBy"
                          :sort-desc.sync="sortDesc"
                          dense
            >
              <template v-slot:[`item.time`]="{ item }">
                <v-list-item two-line class="px-0">
                  <v-list-item-content>
                    <v-list-item-title style="font-size: 12px">{{ item.status }}</v-list-item-title>
                    <v-list-item-subtitle style="font-size: 10px">{{
                        new Date(item.time * 1000).toLocaleDateString()
                      }}
                    </v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>
              </template>
              <template v-slot:[`item.assets`]="{ item }">
                <stacked-tokens :tokens="item.assets"
                                :style="item.status === 'Pending' ? { opacity: '0.5'} : { }"></stacked-tokens>
              </template>
              <template v-slot:[`item.amount`]="{ item }">
                <span :style="{color: getColor(item)}">{{ item.ada | toAda(true, 2) }}</span>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-layout>
</template>
<script>
import PortfolioChart from "@/modules/dashboard/components/PortfolioChart.vue";
import StackedTokens from "@/modules/dashboard/components/StackedTokens.vue";
import filters from "@/shared/utils/filters";
import QuickActions from "@/modules/dashboard/components/QuickActions.vue";
import StakingCard from "../components/StakingCard.vue";
import NoTokensCard from "../components/NoTokensCard.vue";
import {useStore} from "@/store";
import {useObservable} from "@vueuse/rxjs";
import {liveQuery} from "dexie";
import {mapActions, mapState} from "pinia";

export default {
  name: 'dashboard',
  components: {QuickActions, StackedTokens, PortfolioChart, StakingCard, NoTokensCard},
  computed: {
    ...mapState(useStore, ['calculatedTransactions', 'getPools', 'getAccountInfo', 'calculatedUtxos']),
    computeChartData() {
      const graphData = []
      let currentBalance = 0
      this.calculatedTransactions.forEach(tx => {
        currentBalance += tx.ada
        graphData.push([tx.tx_timestamp * 1000, currentBalance / 1000000])
      })
      return graphData
    },
  },
  methods: {
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
      } else if (item.status.includes('Received')) {
        return '#17B26A'
      } else if (item.status.includes('Sent')) {
        return '#F97066'
      }
      return ''
    }
  },
  filters,
  data: () => ({
    wallet: undefined,
    store: useStore,
    filters,
    activities: [],
    loadingChart: true,
    activityHeaders: [
      {text: 'Activity', align: 'start', sortable: true, value: 'time', width: 100},
      {text: '', align: 'start', sortable: false, value: 'assets'},
      {text: 'Amount', align: 'start', sortable: false, value: 'amount', width: 130},
    ],
    sortBy: 'time',
    sortDesc: true,
    blockchainDB: undefined
  }),
  mounted() {
    this.wallet = useStore().getWallet
    this.loadingChart = false
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
