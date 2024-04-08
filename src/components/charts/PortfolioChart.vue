<template>
  <vue-highcharts v-if="chartOptions" :options="chartOptions" :highcharts="Highstock"></vue-highcharts>
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
        subtitle: {
          text: '▲ 14% vs last month',
          align: 'left',
          style: {
            color: "#FFF",
            fontWeight: 'bold',
            fontSize: '20px'
          }
        },
        chart: {
          backgroundColor: 'transparent',
          height: 300,
          style: {
            fontFamily: 'Quicksand',
          },
        },
        rangeSelector: {
          verticalAlign: 'bottom',
          buttonPosition: {
            align: 'left'
          },
          inputEnabled: false,
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
          // dateTimeLabelFormats: {
          //   day: '%A',
          //   month: '%B'
          // },
          // type: 'datetime',
          labels: {
            style: {
              fontFamily: 'Quicksand',
              color: '#fff'
            },
          },

        },
        yAxis: {
          allowDecimals: false,
          title: {
            text: 'Revenue [₳]',
            style: {
              fontSize: '12px',
              fontFamily: 'Quicksand',
              color: '#fff'
            },
          },
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
        // tooltip: {
        //   valueDecimals: 0,
        //   crosshairs: false,
        //   shared: true,
        //   borderColor: '#d3d3d3',
        // },
        // legend: {
        //   floating: true,
        //   enabled: true,
        //   backgroundColor: 'transparent',
        //   align: 'left',
        //   verticalAlign: 'top',
        //   layout: 'horizontal',
        //   x: 44,
        // },
        // exporting: {
        //   enabled: false,
        //   chartOptions: {
        //     plotOptions: {
        //       series: {
        //         dataLabels: {
        //           enabled: true,
        //         },
        //       },
        //     },
        //   },
        // },
        // plotOptions: {
          // column: {
            // stacking: 'normal'
          // },
        //   series: {
        //     states: {
        //       hover: {
        //         halo: {
        //           size: 2,
        //         },
        //       },
        //     },
        //     stacking: 'normal',
        //   },
        // },
        colors: ['#00c7f3', '#FF5733', '#167dd6', '#900C3F', '#511849', '#3D3D6B', '#2A7B9B', '#00BAAD', '#57C785', '#ADD45C'],
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
                [0, '#00c7f3'],
                [0.8, this.hexToRgba('#00c7f3', 0)]
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