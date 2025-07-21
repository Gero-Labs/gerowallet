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
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, toRefs } from "vue";
import Highstock from "highcharts/highstock";
import filters from "@/shared/utils/filters";
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { loadingState } from '@/stores/loading';

const { loggedWallet } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { loadingTxs } = toRefs(loadingState)

const props = defineProps({
  chartData: {
    type: Array,
    default: () => [],
  },
});

const tab = ref({ value: "ALL", label: "All", vsLabel: "vs all time" });
const lastPrice = ref(1);
const chartInstance = ref(null);

const tabs = {
  ALL: { value: "ALL", label: "All", vsLabel: "vs all time" },
  YEAR: { value: "YEAR", label: "12 Months", vsLabel: "vs last year" },
  QUARTER: { value: "QUARTER", label: "3 Months", vsLabel: "vs last quarter" },
  MONTH: { value: "MONTH", label: "30 Days", vsLabel: "vs last month" },
  WEEK: { value: "WEEK", label: "7 Days", vsLabel: "vs last week" },
  DAY: { value: "DAY", label: "24 Hours", vsLabel: "vs last day" },
};

const adaPrice = computed(() => {
  const priceValue = props.chartData[props.chartData.length - 1][1]
  if (lastPrice.value === -1) {
    return null
  }
  return (lastPrice.value * priceValue)
});
const loadChart = (newVal) => {
  if (!newVal.length) {
    return;
  }
  const currency = networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network)
  const data = {
    accessibility: {
      enabled: false,
    },
    title: {
      useHTML: true,
      floating: true,
      align: "left",
      text: generateTitleText(tabs.ALL),
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
  chartInstance.value = Highstock.stockChart("highstock-chart", data);
};

const arraysEqual = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; ++i) {
    if (Array.isArray(a[i]) && Array.isArray(b[i])) {
      return arraysEqual(a[i], b[i])
    } else if (a[i] !== b[i]) return false;
  }
  return true;
};

const isDisabled = (tabItem) => {
  if (!props.chartData || !props.chartData[props.chartData.length-1]) {
    return true
  }
  const lastTxTime = props.chartData[props.chartData.length-1][0]
  if (tabItem.value === 'DAY') {
    return (((new Date()).getTime() - lastTxTime) / 1000 / 24 / 60 / 60) > 1
  } else if (tabItem.value === 'WEEK') {
    return (((new Date()).getTime() - lastTxTime) / 1000 / 24 / 60 / 60) > 7
  } else if (tabItem.value === 'MONTH') {
    return (((new Date()).getTime() - lastTxTime) / 1000 / 24 / 60 / 60) > 30
  } else if (tabItem.value === 'QUARTER') {
    return (((new Date()).getTime() - lastTxTime) / 1000 / 24 / 60 / 60) > 90
  } else if (tabItem.value === 'YEAR') {
    return (((new Date()).getTime() - lastTxTime) / 1000 / 24 / 60 / 60) > 365
  }
  return false
};

const handleTabClick = (tabItem) => {
  tab.value = tabItem
  let start = new Date();
  const end = new Date();
  if (tabItem.value === tabs.YEAR.value) {
    start = new Date(start.setFullYear(end.getFullYear() - 1));
  } else if (tabItem.value === tabs.QUARTER.value) {
    start = new Date(start.setUTCMonth(end.getUTCMonth() - 3));
  } else if (tabItem.value === tabs.MONTH.value) {
    start = new Date(start.setUTCDate(end.getUTCDate() - 30));
  } else if (tabItem.value === tabs.WEEK.value) {
    start = new Date(start.setUTCDate(end.getUTCDate() - 7));
  } else if (tabItem.value === tabs.DAY.value) {
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
  if (chartInstance.value?.title && chartInstance.value?.xAxis) {
    chartInstance.value.xAxis[0].setExtremes(startUTC, endUTC);
    chartInstance.value.title.update({ text: generateTitleText() });
  }
};

const generateTitleText = () => {
  return ''
};
watch(price, (newVal) => {
  lastPrice.value = newVal.lastPrice
  if (chartInstance.value?.title) {
    chartInstance.value.title.update({ text: generateTitleText() });
  }
}, { deep: true });

watch(() => props.chartData, (newVal, oldVal) => {
  if (arraysEqual(newVal, oldVal)) {
    return;
  }
  loadChart(newVal)
}, { deep: true });

onBeforeUnmount(() => {
  if (chartInstance.value) {
    chartInstance.value.destroy();
  }
});

onMounted(() => {
  loadChart(props.chartData)
});
</script>
<style scoped>
#highstock-chart {
  min-height: 184px;
}
</style>
