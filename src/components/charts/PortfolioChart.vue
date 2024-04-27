<template>
  <div style="min-height: 250px">
    <vue-highcharts v-if="chartOptions" :options="chartOptions" :highcharts="Highstock"></vue-highcharts>
  </div>
</template>
<script>
import VueHighcharts from './VueHighcharts'
import Highstock from 'highcharts/highstock'

export default {
  components: {
    VueHighcharts,
  },
  props: {
    chartData: {
      type: Array,
      default: () => [],
    },
    project: {
      type: Object,
      default: () => {},
    },
  },
  mode: 'production',
  data() {
    return {
      Highstock,
    }
  },
  computed: {
    chartOptions() {
      if (this.chartData.length === 0) {
        return null
      }
      return {
        accessibility: {
          enabled: false,
        },
        title: {
          text: '$138,883.35',
          align: 'left',
          style: {
            color: "#FFF",
            fontWeight: 'bold',
            fontSize: '40px'
          }
        },
        // subtitle: {
        //   text: '▲ 14% vs last month',
        //   align: 'left',
        //   style: {
        //     color: "#FFF",
        //     fontWeight: 'bold',
        //     fontSize: '20px'
        //   }
        // },
        chart: {
          backgroundColor: 'transparent',
          height: 250,
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
        },
        yAxis: {
          allowDecimals: false,
          labels: {
            style: {
              color: '#fff'
            }
          },
          opposite: true,
          plotLines: [{
            value: 0,
            width: 1,
            color: '#3d3d3d',
          }],
        },
        colors: ['#00DFF3', '#155B75', '#167dd6', '#900C3F', '#511849', '#3D3D6B', '#2A7B9B', '#00BAAD', '#57C785', '#ADD45C'],
        series: [
          {
            type: 'area',
            name: 'Revenue',
            data: this.chartData,
            marker: {
              symbol: 'circle',
              enabled: null, // auto
              radius: 3,
              lineWidth: 1,
              lineColor: null,
            },
            fillColor: {
              linearGradient: {x1: 0, x2: 0, y1: 0, y2: 1},
              stops: [
                [0.1, this.hexToRgba('#00c7f3', 0.3)],
                [1, this.hexToRgba('#00c7f3', 0)]
              ]
            }
          },
        ],
        useUTC: true,
      }
    },
  },
  watch: {},
  mounted() {},
  methods: {
    setExtremes(range) {
      let start = new Date()
      let end = new Date()
      if (range === '12 Months') {
        start = new Date(start.setFullYear(end.getFullYear() - 1))
      } else if (range === '3 Months') {
        start = new Date(start.setUTCMonth(end.getUTCMonth() - 3))
      } else if (range === '30 Days') {
        start = new Date(start.setUTCDate(end.getUTCDate() - 30))
      } else if (range === '7 Days') {
        start = new Date(start.setUTCDate(end.getUTCDate() - 7))
      } else if (range === '24 Hours') {
        start = new Date(start.setUTCHours(end.getUTCHours() - 24))
      } else {
        start = new Date(Date.parse('27 Sep 2017 00:00:00 GMT'));
      }
      const startUTC = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds());
      const endUTC = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), end.getUTCHours(), end.getUTCMinutes(), end.getUTCSeconds());
      this.$children[0].getChart().xAxis[0].setExtremes(startUTC, endUTC)
    },
    hexToRgba(hex, alpha) {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? 'rgba(' + parseInt(result[1], 16) + ',' + parseInt(result[2], 16) + ',' + parseInt(result[3], 16) + ',' + (alpha || 0) + ')' : null;
    }
  },
}
</script>
<style>
.highcharts-yaxis-grid .highcharts-grid-line {
  stroke-width: 1px;
  stroke: #282828;
}
</style>