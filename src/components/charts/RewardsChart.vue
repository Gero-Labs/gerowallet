<template>
  <div style="min-height: 155px">
    <vue-highcharts v-if="chartOptions" :options="chartOptions" :highcharts="Highcharts"></vue-highcharts>
  </div>
</template>
<script>
import VueHighcharts from './VueHighcharts'
import Highcharts from 'highcharts'

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
    chartOptions() {
      if (Object.values(this.chartData).length === 0) {
        return null
      }
      const yMax = Object.values(this.chartData).reduce(function(a, b) {
        return Math.max(a, b);
      });
      console.log(yMax)
      return {
        accessibility: {
          enabled: false,
        },
        endOnTick: false,
        legend:{ enabled:false },
        title: {
          text: 'Rewards History',
          align: 'center',
          verticalAlign: 'bottom',
          y: 10,
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
          tickInterval: 3,
          min: 0,
          max: yMax,
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