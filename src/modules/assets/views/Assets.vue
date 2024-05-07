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
              <v-icon small> mdi-content-copy </v-icon>
              Copy
            </v-btn>
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
        <TokenAllocationTable @click="handleOnRowClick"></TokenAllocationTable>
      </v-col>
    </v-row>
    <TokensDialog @close="closeDialog" :modalData="dialogData"></TokensDialog>
  </v-layout>
</template>
<script>
import PortfolioChart from "@/shared/components/PortfolioChart.vue";
import AssetsPieChart from "@/modules/assets/components/AssetsPieChart.vue";
import TokenAllocationTable from "../components/TokenAllocationTable.vue";
import TokensDialog from "../dialogs/TokensDialog.vue";

export default {
  name: "assets",
  components: { AssetsPieChart, PortfolioChart, TokenAllocationTable, TokensDialog },
  computed: {
    computeChartData() {
      return this.chartData;
    },
    computePieChartData() {
      return [
        ["Assets", 70.67],
        ["Collectibles", 29.33],
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
