<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" md="7" class="pa-2">
        <v-card outlined class="no-gutters fill-height">
          <v-card-title>Portfolio</v-card-title>
          <v-card-text>
            <PortfolioChart :chart-data="chartData"></PortfolioChart>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="5" class="pa-2">
        <v-card flat class="transparent row no-gutters fill-height d-flex justify-space-between align-content-space-between">
          <v-card-text>
            <AssetsPieChart :chart-data="computePieChartData"></AssetsPieChart>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" class="pa-2">
        <TokenAllocationTable :assets="resolvedAssets" :collectibles="resolvedCollections" :collectibles-length="collectiblesAmount" @click="handleOnRowClick"></TokenAllocationTable>
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
import { mapState } from "pinia";
import { useStore } from "@/store";

export default {
  name: "Assets",
  components: { AssetsPieChart, PortfolioChart, TokenAllocationTable, TokensDialog },
  data() {
    return {
      chartData: [],
      dialogData: null,
    };
  },
  computed: {
    ...mapState(useStore, ['resolvedAssets', 'resolvedCollections']),
    collectiblesAmount() {
      let amount = 0;
      if (this.resolvedCollections) {
          this.resolvedCollections.forEach(collection => {
            if (collection.items) {
              amount += collection.items.length
            }
          })
      }
      return amount
    },
    computePieChartData() {
      if (this.resolvedAssets && this.resolvedCollections) {
        const totalTokens = (this.resolvedAssets.length + this.collectiblesAmount) || 1; // Avoid division by zero
        return [
          ["Assets", (this.resolvedAssets.length / totalTokens) * 100],
          ["Collectibles", (this.collectiblesAmount / totalTokens) * 100],
        ];
      }
      return []
    },
  },
  async mounted() {
    this.chartData = await fetch("https://demo-live-data.highcharts.com/aapl-c.json")
      .then(response => response.json());
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
