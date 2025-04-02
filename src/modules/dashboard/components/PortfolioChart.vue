<template>
  <div style="align-content: center; height: 212px" class="text-center justify-center">
    <div id="highstock-chart" v-show="chartData && chartData.length > 0"></div>
    <v-card-text v-if="!chartData || chartData.length === 0" style="font-size: 20px;align-content: center;">
      <v-avatar size="24" v-if="!loadingTxs">
        <v-img
          :src="assets.walletSvg"
          alt="Wallet"
          style="filter: invert(100%) sepia(100%) saturate(0%) hue-rotate(66deg) brightness(105%) contrast(104%)"
        ></v-img>
      </v-avatar>
      <v-progress-circular v-if="loadingTxs" :indeterminate="true"></v-progress-circular>
      <span v-else>There seems to be no data in this wallet</span>
    </v-card-text>
    <v-tabs
      v-if="chartData && chartData.length > 0"
      background-color="transparent"
      style="width: fit-content"
      height="28"
      active-class="white--text"
      slider-color="white"
    >
      <v-tab
        v-for="tab in Object.values(tabs)"
        :key="tab.value"
        style="font-size: 10px; letter-spacing: normal; min-width: 50px"
        @click="handleTabClick(tab)"
        :disabled="isDisabled(tab)"
        >{{ tab.label }}
      </v-tab>
    </v-tabs>
  </div>
</template>
<script>
import Highstock from "highcharts/highstock";
import filters from "@/shared/utils/filters";
import {mapState} from "pinia";
import {useStore} from "@/store";
import networks from '@/shared/utils/networks';
import assets from '@/utils/assets';

export default {
  props: {
    chartData: {
      type: Array,
      default: () => [],
    },
  },
  filters,
  computed: {
    ...mapState(useStore, ['loggedWallet', 'price', 'loadingTxs']),
    adaPrice() {
      const price = this.chartData[this.chartData.length - 1][1]
      if (this.lastPrice === -1) {
        return null
      }
      return (this.lastPrice * price)
    },
  },
  methods: {
    loadChart(newVal) {
      if (!newVal.length) {
        return;
      }
      const currency = networks.resolveCurrencySymbol(this.loggedWallet?.chain, this.loggedWallet?.network)
      const data = {
        accessibility: {
          enabled: false,
        },
        title: {
          useHTML: true,
          floating: true,
          align: "left",
          text: this.generateTitleText(this.tabs.ALL),
          style: {
            fontSize: "14px",
          },
        },
        chart: {
          spacingLeft: 0,
          spacingRight: 0,
          backgroundColor: "transparent",
          height: 184,
          style: {
            fontFamily: "Quicksand",
          },
        },
        rangeSelector: {
          enabled: false,
          inputEnabled: false,
        },
        scrollbar: {
          enabled: false,
        },
        navigator: {
          enabled: false,
        },
        credits: {
          enabled: false,
        },
        tooltip: {
          backgroundColor: "rgb(12,14,18)",
          borderColor: "#1F242F",
          style: {
            fontFamily: "Inter",
            color: "#fff",
          },
          formatter: function () {
            return `${new Date(this.key).toLocaleString()}<br> <b>${filters.toCurrency(this.y, false, 2, currency, '', true, 0)}</b>`;
          }
        },
        xAxis: {
          crosshair: true,
          allowDecimals: false,
          title: {
            enabled: false,
            text: "Time",
          },
          labels: {
            style: {
              fontFamily: "Inter",
              color: "#fff",
            },
          },
        },
        yAxis: {
          allowDecimals: false,
          labels: {
            style: {
              color: "#fff",
            },
          },
          opposite: true,
          plotLines: [
            {
              value: 0,
              width: 1,
              color: "#3d3d3d",
            },
          ],
        },
        colors: [
          "#00DFF3",
          "#155B75",
          "#167dd6",
          "#900C3F",
          "#511849",
          "#3D3D6B",
          "#2A7B9B",
          "#00BAAD",
          "#57C785",
          "#ADD45C",
        ],
        legend: {
          align: "right",
          verticalAlign: "middle",
          layout: "vertical",
        },
        series: [
          {
            type: "areaspline",
            name: "Balance",
            data: newVal,
            showInLegend: true,
            marker: {
              symbol: "circle",
              enabled: false,
              radius: 3,
              lineWidth: 1,
              lineColor: null,
            },
            fillColor: {
              linearGradient: { x1: 0, x2: 0, y1: 0, y2: 1 },
              stops: [
                [0.1, "#00c7f333"],
                [1, "#00c7f300"],
              ],
            },
          },
        ],
        useUTC: true,
      };
      this.chartInstance = Highstock.stockChart("highstock-chart", data);
    },
    arraysEqual(a, b) {
      if (a === b) return true;
      if (a == null || b == null) return false;
      if (a.length !== b.length) return false;

      // If you don't care about the order of the elements inside
      // the array, you should sort both arrays here.
      // Please note that calling sort on an array will modify that array.
      // you might want to clone your array first.

      for (let i = 0; i < a.length; ++i) {
        if (Array.isArray(a[i]) && Array.isArray(b[i])) {
          return this.arraysEqual(a[i], b[i])
        } else if (a[i] !== b[i]) return false;
      }
      return true;
    },
    isDisabled(tab) {
      if (!this.chartData || !this.chartData[this.chartData.length-1]) {
        return true
      }
      const lastTxTime = this.chartData[this.chartData.length-1][0]
      if (tab.value === 'DAY') {
        return (((new Date()).getTime() - lastTxTime) / 1000 / 24 / 60 / 60) > 1
      } else if (tab.value === 'WEEK') {
        return (((new Date()).getTime() - lastTxTime) / 1000 / 24 / 60 / 60) > 7
      } else if (tab.value === 'MONTH') {
        return (((new Date()).getTime() - lastTxTime) / 1000 / 24 / 60 / 60) > 30
      } else if (tab.value === 'QUARTER') {
        return (((new Date()).getTime() - lastTxTime) / 1000 / 24 / 60 / 60) > 90
      } else if (tab.value === 'YEAR') {
        return (((new Date()).getTime() - lastTxTime) / 1000 / 24 / 60 / 60) > 365
      }
      return false
    },
    handleTabClick(tab) {
      this.tab = tab
      let start = new Date();
      const end = new Date();
      if (tab.value === this.tabs.YEAR.value) {
        start = new Date(start.setFullYear(end.getFullYear() - 1));
      } else if (tab.value === this.tabs.QUARTER.value) {
        start = new Date(start.setUTCMonth(end.getUTCMonth() - 3));
      } else if (tab.value === this.tabs.MONTH.value) {
        start = new Date(start.setUTCDate(end.getUTCDate() - 30));
      } else if (tab.value === this.tabs.WEEK.value) {
        start = new Date(start.setUTCDate(end.getUTCDate() - 7));
      } else if (tab.value === this.tabs.DAY.value) {
        start = new Date(start.setUTCHours(end.getUTCHours() - 24));
      } else {
        start = new Date(Date.parse("27 Sep 2017 00:00:00 GMT"));
      }
      const startUTC = Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        start.getUTCDate(),
        start.getUTCHours(),
        start.getUTCMinutes(),
        start.getUTCSeconds()
      );
      const endUTC = Date.UTC(
        end.getUTCFullYear(),
        end.getUTCMonth(),
        end.getUTCDate(),
        end.getUTCHours(),
        end.getUTCMinutes(),
        end.getUTCSeconds()
      );
      if (this.chartInstance?.title && this.chartInstance?.xAxis) {
        this.chartInstance.xAxis[0].setExtremes(startUTC, endUTC);
        this.chartInstance.title.update({ text: this.generateTitleText() });
      }
    },
    generateTitleText() {
      return ''
    },
  },
  data() {
    return {
      tab: { value: "ALL", label: "All", vsLabel: "vs all time" },
      lastPrice: 1,
      chartInstance: null,
      tabs: {
        ALL: { value: "ALL", label: "All", vsLabel: "vs all time" },
        YEAR: { value: "YEAR", label: "12 Months", vsLabel: "vs last year" },
        QUARTER: { value: "QUARTER", label: "3 Months", vsLabel: "vs last quarter" },
        MONTH: { value: "MONTH", label: "30 Days", vsLabel: "vs last month" },
        WEEK: { value: "WEEK", label: "7 Days", vsLabel: "vs last week" },
        DAY: { value: "DAY", label: "24 Hours", vsLabel: "vs last day" },
      },
      assets,
    };
  },
  watch: {
    price: {
      handler(newVal) {
        this.lastPrice = newVal.lastPrice
        if (this.chartInstance?.title) {
          this.chartInstance.title.update({ text: this.generateTitleText() });
        }
      },
      deep: true,
    },
    chartData: {
      handler(newVal,oldVal) {
        if (this.arraysEqual(newVal,oldVal)) {
          return;
        }

        this.loadChart(newVal)
      },
      deep: true,
    },
  },
  beforeDestroy() {
    if (this.chartInstance) {
      this.chartInstance.destroy();
    }
  },
  mounted() {
    this.loadChart(this.chartData)
  }
};
</script>
<style scoped>
#highstock-chart {
  min-height: 184px;
}
</style>
