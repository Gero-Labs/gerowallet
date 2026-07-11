<template>
  <vue-highcharts v-if="chartOptions" :options="chartOptions" :highcharts="Highcharts"></vue-highcharts>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, toRefs } from 'vue';
import VueHighcharts from '@/shared/components/VueHighcharts.vue'
import Highcharts from 'highcharts'
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import { Blockchain } from '@/models/types';


const { t } = useTranslation();

const { loggedWallet } = toRefs(walletStore);

const props = defineProps({
  chartData: {
    type: Object,
    default: () => {},
  },
  project: {
    type: Object,
    default: () => {},
  },
});

const isApex = computed(() => {
  return loggedWallet.value?.chain === Blockchain.APEX_PRIME ||
    loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
});

const chartOptions = computed(() => {
  return {
    accessibility: {
      enabled: false,
    },
    endOnTick: false,
    legend:{ enabled:false },
    title: {
      text: t('staking.rewardsHistory'),
      floating: true,
      align: 'center',
      verticalAlign: 'top',
      y: 0,
      style: {
        color: "#FFF",
        fontWeight: 'bold',
        fontSize: '14px'
      }
    },
    chart: {
      type: 'line',
      backgroundColor: 'transparent',
      height: 155,
      spacingTop: 15,
      spacingBottom: 5,
      style: {
        fontFamily: 'Inter Variable, Inter, sans-serif',
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
      positioner: function (this: any, labelWidth: number, labelHeight: number, point: any) {
        let x = point.plotX + this.chart.plotLeft - labelWidth / 2;
        let y = point.plotY + this.chart.plotTop - labelHeight - 10;

        // Prevent tooltip from overflowing left/right
        if (x < 0) x = 5;
        if (x + labelWidth > this.chart.chartWidth) x = this.chart.chartWidth - labelWidth - 5;

        // Prevent tooltip from overflowing top
        if (y < 0) y = point.plotY + this.chart.plotTop + 10;

        return { x, y };
      },
      headerFormat: `<b>${t('staking.epoch')} {point.key}</b><br/>`,
      pointFormat: `{point.y} ${networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network)}`,
      outside: false,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: isApex.value ? '#dc753e' : '#00c7f3',
      borderRadius: 8,
      borderWidth: 1,
      style: {
        color: '#fff',
        fontSize: '12px'
      }
    },
    xAxis: {
      crosshair: true,
      allowDecimals: false,
      title: {
        enabled: false,
        text: 'Time',
      },
      labels: {
        style: {
          fontFamily: 'Inter Variable, Inter, sans-serif',
          color: '#fff',
          fontSize: '10px'
        },
      },
      categories: Object.keys(props.chartData)
    },
    yAxis: {
      title: {
        enabled: false,
      },
      labels: {
        style: {
          color: '#fff'
        }
      },
      min: 0,
      opposite: true,
    },
    colors: [isApex.value ? '#dc753e' : '#00c7f3', '#155B75', '#167dd6', '#900C3F', '#511849', '#3D3D6B', '#2A7B9B', '#00BAAD', '#57C785', '#ADD45C'],
    series: [
      {
        name: 'ADA',
        data: Object.values(props.chartData),
        color: isApex.value ? '#dc753e' : '#00c7f3',
        lineWidth: 2,
        marker: {
          radius: 2,
          fillColor: isApex.value ? '#dc753e' : '#00c7f3',
          lineColor: isApex.value ? '#dc753e' : '#00c7f3',
          lineWidth: 1
        }
      },
    ],
    useUTC: true,
  }
});
</script>
<style>
.highcharts-yaxis-grid .highcharts-grid-line {
  stroke-width: 1px;
  stroke: var(--g-hairline-3);
}
.highcharts-line-series .highcharts-point,
.highcharts-line-series .highcharts-graph {
  stroke-width: 2px;
}
</style>
