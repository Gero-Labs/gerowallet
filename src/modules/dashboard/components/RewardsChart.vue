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

// Series color: Highcharts needs a concrete hex (canvas), so we can't use the
// --g-accent CSS var here. Rewards are a Cardano view: the Cardano cyan.
const chartAccent = '#00c7f3';

const chartOptions = computed((): Highcharts.Options => {
  return {
    accessibility: {
      enabled: false,
    },
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
      type: 'column',
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
      positioner: function (this: Highcharts.Tooltip, labelWidth: number, labelHeight: number, point: Highcharts.TooltipPositionerPointObject) {
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
      borderColor: chartAccent,
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
      title: { text: null },
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
      title: { text: null },
      labels: {
        style: {
          color: '#fff'
        }
      },
      min: 0,
      opposite: true,
    },
    colors: [chartAccent, '#155B75', '#167dd6', '#900C3F', '#511849', '#3D3D6B', '#2A7B9B', '#00BAAD', '#57C785', '#ADD45C'],
    // One column per epoch: a reward is a per-epoch amount, so bars read better than a
    // line that dips to zero between the epochs that paid.
    plotOptions: {
      column: {
        borderWidth: 0,
        borderRadius: 2,
        pointPadding: 0.1,
        groupPadding: 0.05,
      },
    },
    series: [
      {
        type: 'column',
        name: 'ADA',
        data: Object.values(props.chartData) as number[],
        color: chartAccent,
      },
    ],
    time: { useUTC: true },
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
