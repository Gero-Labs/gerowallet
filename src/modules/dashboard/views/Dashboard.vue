<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" xl="9" lg="9" md="12" sm="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
          <v-card-title class="row no-gutters d-flex justify-space-between">
            Portfolio
          </v-card-title>
          <v-card-text>
            <PortfolioChart :chart-data="computeChartData" :loading="loadingChart"></PortfolioChart>
          </v-card-text>
        </v-card>
      </v-col>
<!--      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2" v-if="false">-->
<!--        <AssetsPieChart></AssetsPieChart>-->
<!--      </v-col>-->
      <v-col cols="12" xl="3" lg="3" md="12" sm="12" class="pa-2">
        <QuickActions></QuickActions>
      </v-col>
      <v-col cols="12" xl="12" lg="12" md="12" sm="12" class="pa-2">
        <TokenAllocationTable></TokenAllocationTable>
      </v-col>
      <v-col cols="12" xl="8" lg="7" md="12" sm="12" class="pa-2">
        <StakingCard2 v-if="account?.controlled_amount && account?.pool_id"></StakingCard2>
        <NoTokensCard v-else></NoTokensCard>
      </v-col>
      <v-col cols="12" xl="4" lg="5" md="12" sm="12" class="pa-2">
        <TransactionsCard></TransactionsCard>
      </v-col>
    </v-row>
  </v-layout>
</template>
<script>
import PortfolioChart from '../components/PortfolioChart.vue';
import filters from '@/shared/utils/filters';
import QuickActions from '@/modules/dashboard/components/QuickActions.vue';
import NoTokensCard from '../components/NoTokensCard.vue';
import { useStore } from '@/store';
import {Network} from "@/models/types";
import {mapState} from "pinia";
// import AssetsPieChart from '@/modules/assets/components/AssetsPieChart.vue';
import TokenAllocationTable from '@/modules/assets/components/TokenAllocationTable.vue';
import StakingCard2 from '@/modules/dashboard/components/StakingCard2.vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import { walletConfigStore } from '@/store/modules/walletConfig';

export default {
  name: 'dashboard',
  components: {
    TransactionsCard, StakingCard2, TokenAllocationTable,
    // AssetsPieChart,
    QuickActions, PortfolioChart, NoTokensCard },
  computed: {
    Network() {
      return Network
    },
    ...mapState(useStore, ['calculatedTransactions', 'getPools', 'loggedWallet', 'loadingTxs']),
    ...mapState(walletConfigStore, ['account']),
    computeChartData() {
      let graphData = undefined
      let currentBalance = 0
      if (this.calculatedTransactions) {
        graphData = []
        this.calculatedTransactions.forEach(tx => {
          currentBalance += tx.ada
          graphData.push([tx.tx_timestamp * 1000, currentBalance / 1000000])
        })
      }
      return graphData
    },
  },
  filters,
  data: () => ({
    wallet: undefined,
    store: useStore,
    filters,
    activities: [],
    loadingChart: true,
    transactions: undefined,
    txIos: undefined,
    blockchainDB: undefined
  })
}
</script>
<style>
.transactions-table {
  tbody {
    cursor: pointer;
  }
}

.v-progress-linear__determinate {
  background: linear-gradient(90deg, #00c7f3, #00ffd1);
}

.v-data-table-header {
  background-color: rgb(22, 27, 38);
}
</style>
