<template>
  <vue-highcharts v-if="chartOptions" :options="chartOptions" :highcharts="Highcharts"></vue-highcharts>
</template>
<script>
import VueHighcharts from '@/shared/components/VueHighcharts.vue'
import Highcharts from 'highcharts'
import { mapState } from 'pinia';
import { useStore } from '@/store';

export default {
  components: {
    VueHighcharts,
  },
  props: {
    chartData: {
      type: Object,
      default: () => {},
    },
    project: {
      type: Object,
      default: () => {},
    },
  },
  mode: 'production',
  data() {
    return {
      Highcharts,
    }
  },
  computed: {
    ...mapState(useStore, ['loadingTxs']),
    chartOptions() {
      // if (Object.values(this.chartData).length === 0) {
      //   return null
      // }
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
          type: 'column',
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
          categories: Object.keys(this.chartData)
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
            data: Object.values(this.chartData),
          },
        ],
        useUTC: true,
      }
    },
  },
  watch: {},
  mounted() {},
}
</script>
<style>
.highcharts-yaxis-grid .highcharts-grid-line {
  stroke-width: 1px;
  stroke: #282828;
}
.highcharts-column-series path.highcharts-point {
  stroke: none;
}
</style>
