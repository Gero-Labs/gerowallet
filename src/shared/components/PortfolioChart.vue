<template>
  <div style="min-height: 250px; align-content: center" class="text-center justify-center">
    <div id="highstock-chart"></div>
    <v-card-text v-if="!chartData.length" style="font-size: 20px">
      <v-avatar size="24">
        <v-img
          :src="require('@/assets/svg/wallet.svg')"
          alt="Wallet"
          style="filter: invert(100%) sepia(100%) saturate(0%) hue-rotate(66deg) brightness(105%) contrast(104%)"
        ></v-img>
      </v-avatar>
      There seems to be no data in this wallet
    </v-card-text>
    <v-tabs
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
        >{{ tab.label }}
      </v-tab>
    </v-tabs>
  </div>
</template>
<script>
import Highstock from "highcharts/highstock";

export default {
  props: {
    chartData: {
      type: Array,
      default: () => [],
    },
  },
  data() {
    return {
      chartInstance: null,
      tabs: {
        ALL: { value: "ALL", label: "All", vsLabel: "vs all time" },
        YEAR: { value: "YEAR", label: "12 Months", vsLabel: "vs last year" },
        QUARTER: { value: "QUARTER", label: "3 Months", vsLabel: "vs last quarter" },
        MONTH: { value: "MONTH", label: "30 Days", vsLabel: "vs last month" },
        WEEK: { value: "WEEK", label: "7 Days", vsLabel: "vs last week" },
        DAY: { value: "DAY", label: "24 Hours", vsLabel: "vs last day" },
      },
    };
  },
  watch: {
    chartData: {
      handler() {
        if (!this.chartData.length) {
          return;
        }
        const data = {
          accessibility: {
            enabled: false,
          },
          title: {
            useHTML: true,
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
            height: 250,
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
              type: "area",
              name: "Assets",
              data: this.chartData,
              showInLegend: true,
              marker: {
                symbol: "circle",
                enabled: null,
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
            {
              type: "area",
              name: "Collectibles",
              data: this.chartData,
              showInLegend: true,
              marker: {
                symbol: "circle",
                enabled: null,
                radius: 3,
                lineWidth: 1,
                lineColor: null,
              },
              fillColor: {
                linearGradient: { x1: 0, x2: 0, y1: 0, y2: 1 },
                stops: [
                  [0.1, "#155b7533"],
                  [1, "#00c7f300"],
                ],
              },
            },
          ],
          useUTC: true,
        };
        this.chartInstance = Highstock.stockChart("highstock-chart", data);
      },
      deep: true,
    },
  },
  methods: {
    handleTabClick(tab) {
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
      this.chartInstance.xAxis[0].setExtremes(startUTC, endUTC);
      this.chartInstance.title.update({ text: this.generateTitleText(tab) });
    },
    generateTitleText(tab) {
      return (
        `<span style="color: #FFF; font-weight: bold; font-size: 40px;">$138,883.35</span>` +
        `<span style="margin-left:12px; position: absolute"><span style="color: #47cd89;">▲ 14%</span> <span style="color: #94969c;">${tab.vsLabel}</span></span>`
      );
    },
  },
  beforeDestroy() {
    if (this.chartInstance) {
      this.chartInstance.destroy();
    }
  },
};
</script>
<style>
#highstock-chart {
  min-height: 250px;
}
</style>
