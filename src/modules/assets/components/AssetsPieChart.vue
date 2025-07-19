<template>
  <div class="fill-height">
    <vue-highcharts v-if="options"
                    :options="options()"
                    :highcharts="Highcharts"
    ></vue-highcharts>
    <v-card v-else flat class="transparent fill-height">
      <v-card-title class="justify-center fill-height"><v-icon>
        mdi-alert
      </v-icon>&nbsp;No Data Available</v-card-title>
    </v-card>
  </div>
</template>
<script setup lang="ts">
import { toRefs, computed } from 'vue'
import VueHighcharts from '@/shared/components/VueHighcharts.vue'
import Highcharts from 'highcharts'
import Highcharts3D from 'highcharts/highcharts-3d'
import { walletStore } from '@/plugins/walletStore';

Highcharts3D(Highcharts)

const { tokens, collections } = toRefs(walletStore)

const collectiblesAmount = computed(() => {
  let amount = 0;
  if (collections.value) {
    Object.values(collections.value).forEach(collection => {
      if (collection.items) {
        amount += collection.items.length
      }
    })
  }
  return amount
})

const computedColors = computed(() => {
  const colors = []
  chartData.value.forEach(data => {
    if (data[1] > 0) {
      if (data[0] === 'Assets') {
        colors.push('#00c7f3')
      } else if (data[0] === 'Collectibles') {
        colors.push('#155B75')
      }
    }
  })
  return colors
})

const chartData = computed(() => {
  console.log('chartData')
  if (tokens.value && collections.value) {
    const totalTokens = (Object.values(tokens.value).length + collectiblesAmount.value) || 1; // Avoid division by zero
    return [
      ["Assets", (Object.values(tokens.value).length / totalTokens) * 100],
      ["Collectibles", (collectiblesAmount.value / totalTokens) * 100],
    ];
  }
  return []
});

const isAllZeroes = () => {
  return chartData.value.every(data => data[1] === 0)
}

const vmProxy = getCurrentInstance()!.proxy as any

const options = () => {
  if (isAllZeroes()) {
    return null
  }
  return {
    legend: {
      itemStyle: {
        color: vmProxy.$vuetify.theme.isDark ? '#fff' : '#000'
      },
      itemHoverStyle: {
        color: vmProxy.$vuetify.theme.isDark ? '#ccc' : '#ccc'
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
        color: vmProxy.$vuetify.theme.isDark ? '#CCC' : '#000',
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
    colors: computedColors.value,
    series: [
      {
        // name: 'Percentage',
        colorByPoint: true,
        data: chartData.value.filter(function(d) {return d[1] > 0}),
        dataLabels: {
          color: vmProxy.$vuetify.theme.isDark ? '#FFF' : '#000',
          style: {
            strokeWidth: 0,
          },
        },
      },
    ],
    useUTC: true,
  }
}
</script>
