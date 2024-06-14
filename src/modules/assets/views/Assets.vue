<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" md="7" class="pa-2">
        <v-card outlined class="no-gutters fill-height">
          <v-card-title>
            Portfolio
          </v-card-title>
          <v-card-text>
            <PortfolioChart :chart-data="computeChartData"></PortfolioChart>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="5" class="pa-2">
        <v-card
          flat
          class="transparent row no-gutters fill-height d-flex justify-space-between align-content-space-between"
        >
          <v-card-text>
            <assets-pie-chart :chart-data="computePieChartData"></assets-pie-chart>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" class="pa-2">
        <TokenAllocationTable :assets="computedTokens" @click="handleOnRowClick"></TokenAllocationTable>
      </v-col>
    </v-row>
    <TokensDialog @close="closeDialog" :modalData="dialogData"></TokensDialog>
  </v-layout>
</template>
<script>
import PortfolioChart from "@/modules/assets/components/PortfolioChart.vue";
import AssetsPieChart from "@/modules/assets/components/AssetsPieChart.vue";
import TokenAllocationTable from "../components/TokenAllocationTable.vue";
import TokensDialog from "../dialogs/TokensDialog.vue";
import {mapState} from "pinia";
import {useStore} from "@/store";

export default {
  name: "assets",
  components: { AssetsPieChart, PortfolioChart, TokenAllocationTable, TokensDialog },
  computed: {
    ...mapState(useStore, ['calculatedUtxos']),
    computedTokens() {
      let adaBalance = 0
      const assets = {}
      if (this.calculatedUtxos) {
        this.calculatedUtxos.forEach(utxo => {
          adaBalance += Number(utxo.value)
          if (utxo.asset_list) {
            utxo.asset_list.forEach(asset => {
              if (assets[asset.policy_id+asset.asset_name]) {
                assets[asset.policy_id+asset.asset_name].quantity += Number(asset.quantity)
              } else {
                assets[asset.policy_id+asset.asset_name] = asset
              }
            })
          }
        })
      }
      if (adaBalance > 0) {
        assets['lovelace'] = {
          name: 'Cardano',
          policy_id: "",
          asset_name: "lovelace",
          decimals: 6,
          quantity: adaBalance,
          logo: require('@/assets/svg/cardano.svg')
        }
      }
      return Object.values(assets)
    },
    computedAssets() {
      return this.computedTokens
    },
    computedCollectibles() {
      return []
    },
    computeChartData() {
      return this.chartData;
    },
    computePieChartData() {
      return [
        ["Assets", this.computedAssets.length/this.computedTokens.length*100],
        ["Collectibles", this.computedCollectibles.length/this.computedTokens.length*100],
      ];
    },
  },
  data: () => ({
    chartData: [],
    dialogData: null,
  }),
  async mounted() {
    this.chartData = await fetch("https://demo-live-data.highcharts.com/aapl-c.json").then((response) =>
      response.json()
    );
  },
  methods: {
    closeDialog() {
      this.dialogData = null;
    },
    handleOnRowClick(row) {
      this.dialogData = row;
    },
  },
};
</script>
<style>
.theme--dark.highlight {
  background-color: #00dff3 !important;
  color: black !important;
}
</style>
