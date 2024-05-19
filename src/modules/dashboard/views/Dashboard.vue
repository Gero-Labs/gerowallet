<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" xl="9" lg="7" md="12" sm="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
          <v-card-title class="row no-gutters d-flex justify-space-between">
            Portfolio
            <div v-if="chartData && chartData.length > 0">
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
        <quick-actions></quick-actions>
      </v-col>
      <v-col cols="12" xl="8" lg="7" md="12" sm="12" class="pa-2">
        <StakingCard :account="accountInfo" v-if="accountInfo?.controlled_amount"></StakingCard>
        <NoTokensCard v-else></NoTokensCard>
      </v-col>
      <v-col cols="12" xl="4" lg="5" md="12" sm="12" class="pa-2">
        <v-card outlined class="fill-height">
          <v-card-title>Recent Activity</v-card-title>
          <v-card-text class="px-0">
            <v-data-table :items="activities" :headers="activityHeaders" class="transparent">
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
                <span :style="{color: getColor(item)}">{{ item.ada | toAda(true) }}</span>
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
import NoTokensCard from "../components/NoTokensCard.vue";
import {useStore} from "@/store";
import {useObservable} from "@vueuse/rxjs";
import {liveQuery} from "dexie";
import {resolveRewardAddress} from "@/shared/utils/resolver";

export default {
  name: 'dashboard',
  components: {QuickActions, StackedTokens, PortfolioChart, StakingCard, NoTokensCard},
  computed: {
    computeChartData() {
      return this.chartData
    },
    activities() {
      if (this.transactions) {
        const vm = this
        const txs = this.transactions.map(el => el.transaction).map(tx => {
          let totalAmount;
          totalAmount = tx.inputs.reduce((acc, input) =>
            (input.stake_addr === vm.wallet.stakeAddress().to_address().to_bech32() ? acc - +input.value : acc), 0);
          totalAmount = tx.outputs.reduce(
            (acc, input) => (input.stake_addr === vm.wallet.stakeAddress().to_address().to_bech32() ? acc + +input.value : acc),
            totalAmount
          );
          const statuses = []
          if (tx.withdrawals && tx.withdrawals.length > 0) {
            tx.withdrawals.forEach(withdrawal => {
              totalAmount -= Number(withdrawal.amount)
            })
            statuses.push('Withdrawal')
          }
          if (totalAmount > 0) {
            statuses.push('Received')
          } else {
            statuses.push('Sent')
          }
          if (tx.tx_hash === '1694a7591a457ce0c90d5899830bbfb46856dcabf6d71f5d0398792a51c4e377') {
            console.log(filters.toAda(totalAmount, true))
          }
          return {...tx, time: tx.tx_timestamp, ada: totalAmount, status: statuses.join(', '), assets: ['ADA']}
        })
        txs.sort((a, b) => b.time - a.time)
        return txs
      }
      return []
    },
    balanceOverTime() {
      return ''
    }
  },
  methods: {
    subtract(output, input) {
      if (output && output.amount) {
        output.amount.forEach(outputAmount => {
          if (input && input.amount) {
            const foundAmount = input.amount.find(inputAmount => inputAmount.unit === outputAmount.unit)
            const foundAmountIndex = input.amount.indexOf(foundAmount)
            if (foundAmount) {
              outputAmount.quantity = (Number(outputAmount.quantity) - Number(foundAmount.quantity)).toString()
            }
            input.amount.splice(foundAmountIndex, 1)
          }
        })
      }
      return output
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
    loadingChart: true,
    chartData: undefined,
    accountInfo: undefined,
    transactions: undefined,
    txIos: undefined,
    activityHeaders: [
      {text: 'Activity', align: 'start', sortable: true, value: 'time'},
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
  }),
  async created() {
    this.wallet = useStore().getWallet
    const db = await this.wallet.getDb()
    this.accountInfo = useObservable(liveQuery(() => {
      return db.table('account').where({walletId: this.wallet.id}).first()
    }))
    this.transactions = useObservable(liveQuery(() => {
      return db.table('transactions').toArray()
    }))
    this.txIos = useObservable(liveQuery(() => {
      return db.table('tx_io').toArray()
    }))
  },
  async mounted() {
    this.wallet = useStore().getWallet
    this.chartData = await fetch(
      'https://demo-live-data.highcharts.com/aapl-c.json'
    ).then(response => response.json())
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
