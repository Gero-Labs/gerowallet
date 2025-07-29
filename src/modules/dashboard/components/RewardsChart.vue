<template>
  <vue-highcharts v-if="chartOptions" :options="chartOptions" :highcharts="Highcharts"></vue-highcharts>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import VueHighcharts from '@/shared/components/VueHighcharts.vue'
import Highcharts from 'highcharts'

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

const chartOptions = computed(() => {
  return {
    accessibility: {
      enabled: false,
    },
    endOnTick: false,
    legend:{ enabled:false },
    title: {
      text: 'Rewards History',
      floating: true,
      align: 'center',
      verticalAlign: 'top',
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
      style: {
        fontFamily: 'Quicksand',
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
      positioner: function (labelWidth, labelHeight, point) {
        return {
          x: point.plotX + this.chart.plotLeft - labelWidth / 2,
          y: point.plotY + this.chart.plotTop - labelHeight - 10
        };
      },
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: '#00DFF3',
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
          fontFamily: 'Inter',
          color: '#fff'
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
    colors: ['#00DFF3', '#155B75', '#167dd6', '#900C3F', '#511849', '#3D3D6B', '#2A7B9B', '#00BAAD', '#57C785', '#ADD45C'],
    series: [
      {
        name: 'Rewards',
        data: Object.values(props.chartData),
        color: '#00DFF3',
        lineWidth: 2,
        marker: {
          radius: 2,
          fillColor: '#00DFF3',
          lineColor: '#00DFF3',
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
  stroke: #282828;
}
.highcharts-line-series .highcharts-point,
.highcharts-line-series .highcharts-graph {
  stroke-width: 2px;
}
</style>
