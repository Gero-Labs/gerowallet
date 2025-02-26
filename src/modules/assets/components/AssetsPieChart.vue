<template>
  <div class="fill-height">
    <vue-highcharts v-if="options"
                    :options="options"
                    :highcharts="Highcharts"
    ></vue-highcharts>
    <v-card v-else flat class="transparent fill-height">
      <v-card-title class="justify-center fill-height"><v-icon>
        mdi-alert
      </v-icon>&nbsp;No Data Available</v-card-title>
    </v-card>
  </div>
</template>
<script>
import VueHighcharts from '@/shared/components/VueHighcharts.vue'
import Highcharts from 'highcharts'
import Highcharts3D from 'highcharts/highcharts-3d'
import { mapState } from 'pinia';
import { useStore } from '@/store';

Highcharts3D(Highcharts)

export default {
  name: 'assetsPieChart',
  components: {
    VueHighcharts,
  },
  mode: 'production',
  data() {
    return {
      Highcharts,
    }
  },
  methods: {
    isAllZeroes() {
      return this.chartData.every(data => data[1] === 0)
    },
  },
  computed: {
    ...mapState(useStore, ['resolvedAssets', 'resolvedCollections']),
    collectiblesAmount() {
      let amount = 0;
      if (this.resolvedCollections) {
        this.resolvedCollections.forEach(collection => {
          if (collection.items) {
            amount += collection.items.length
          }
        })
      }
      return amount
    },
    chartData() {
      if (this.resolvedAssets && this.resolvedCollections) {
        const totalTokens = (this.resolvedAssets.length + this.collectiblesAmount) || 1; // Avoid division by zero
        return [
          ["Assets", (this.resolvedAssets.length / totalTokens) * 100],
          ["Collectibles", (this.collectiblesAmount / totalTokens) * 100],
        ];
      }
      return []
    },
    computedColors() {
      const colors = []
      this.chartData.forEach(data => {
        if (data[1] > 0) {
          if (data[0] === 'Assets') {
            colors.push('#00c7f3')
          } else if (data[0] === 'Collectibles') {
            colors.push('#155B75')
          }
        }
      })
      return colors
    },
    options() {
      if (this.isAllZeroes()) {
          return null
      }
      return {
        legend: {
          itemStyle: {
            color: this.$vuetify.theme.isDark ? '#fff' : '#000'
          },
          itemHoverStyle: {
            color: this.$vuetify.theme.isDark ? '#ccc' : '#ccc'
          },
          labelFormatter() {
            return `<b>${this.name}</b>`
          }
        },
        accessibility: {
          enabled: false,
        },
        chart: {
          backgroundColor: 'transparent',
          type: 'pie',
          options3d: {
            enabled: true,
            alpha: 45,
          },
          plotBackgroundColor: null,
          plotBorderWidth: null,
          plotShadow: false,
          height: 250,
          style: {
            fontFamily: 'Quicksand',
          },
        },
        credits: {
          enabled: false,
        },
        title: {
          text: '',
          style: {
            color: this.$vuetify.theme.isDark ? '#CCC' : '#000',
          },
        },
        tooltip: {
          backgroundColor: "rgb(12,14,18)",
          borderColor: "#1F242F",
          style: {
            fontFamily: "Inter",
            color: "#fff",
          },
          pointFormat: '<b>{point.percentage:.1f}%</b>'
        },
        exporting: {
          enabled: false,
          chartOptions: {
            plotOptions: {
              series: {
                dataLabels: {
                  enabled: true,
                },
              },
            },
          },
        },
        plotOptions: {
          pie: {
            innerSize: 65,
            depth: 45,
            allowPointSelect: true,
            cursor: 'pointer',
            dataLabels: {
              enabled: true,
              format: '<b>{point.name}</b>: {point.percentage:.1f} %',
            },
            showInLegend: true,
          },
        },
        colors: this.computedColors,
        series: [
          {
            // name: 'Percentage',
            colorByPoint: true,
            data: this.chartData.filter(function(d) {return d[1] > 0}),
            dataLabels: {
              color: this.$vuetify.theme.isDark ? '#FFF' : '#000',
              style: {
                strokeWidth: 0,
              },
            },
          },
        ],
        useUTC: true,
      }
    },
  },
}
</script>
