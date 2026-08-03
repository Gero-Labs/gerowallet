<template>
  <v-card flat outlined>
    <v-card-title class="d-flex align-center">
      <v-icon color="primary" class="mr-2">mdi-chart-line</v-icon>
      {{ $t('governance.overview') }}
    </v-card-title>
    <v-card-text>
      <v-row>
        <!-- Chart Section -->
        <v-col cols="12" md="8">
          <div class="chart-container" style="height: 300px">
            <VueHighcharts :options="chartOptions" :redraw="true" :oneToOne="true" class="chart" />
          </div>
        </v-col>

        <!-- Statistics Section -->
        <v-col cols="12" md="4">
          <v-card flat outlined class="d-flex flex-column justify-center align-center pa-4">
            <div class="statistics-container d-flex flex-column justify-center align-center">
              <div class="d-flex flex-column justify-center align-center mb-4">
                <div class="stat-number text-h4 font-weight-bold primary--text">1</div>
                <div class="stat-label text-subtitle-1">{{ $t('governance.admin') }}</div>
              </div>

              <div class="d-flex flex-column justify-center align-center mb-4">
                <div class="stat-number text-h4 font-weight-bold success--text">9</div>
                <div class="stat-label text-subtitle-1">{{ $t('governance.members') }}</div>
              </div>

              <div class="d-flex flex-column justify-center align-center">
                <div class="stat-number text-h4 font-weight-bold info--text">9</div>
                <div class="stat-label text-subtitle-1">{{ $t('governance.membersAllTime') }}</div>
              </div>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import VueHighcharts from '@/shared/components/VueHighcharts.vue';


const chartOptions = computed(() => ({
  chart: {
    type: 'area',
    backgroundColor: 'transparent',
    height: 300,
    style: {
      fontFamily: 'inherit',
    },
  },
  title: {
    text: null,
  },
  xAxis: {
    categories: [
      'October',
      'November',
      'December',
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'Aug',
    ],
    gridLineColor: 'transparent',
    gridLineWidth: 1,
    lineColor: 'transparent',
    tickColor: 'transparent',
    labels: {
      style: {
        color: '#666',
        fontSize: '12px',
      },
    },
  },
  yAxis: {
    title: {
      text: null,
    },
    gridLineColor: '#e0e0e0',
    gridLineWidth: 1,
    lineColor: '#e0e0e0',
    tickColor: '#e0e0e0',
    labels: {
      style: {
        color: '#666',
        fontSize: '12px',
      },
    },
    min: 0,
    max: 10,
    tickInterval: 5,
  },
  legend: {
    enabled: false,
  },
  plotOptions: {
    area: {
      fillColor: {
        linearGradient: {
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 1,
        },
        stops: [
          [0, 'rgba(0, 199, 243, 0.3)'],
          [1, 'rgba(0, 199, 243, 0.1)'],
        ],
      },
      lineColor: '#00c7f3',
      lineWidth: 3,
      marker: {
        enabled: false,
      },
      states: {
        hover: {
          lineWidth: 3,
        },
      },
    },
  },
  tooltip: {
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderColor: 'rgba(0, 0, 0, 0.8)',
    style: {
      color: 'white',
    },
    formatter: function (this: any) {
      return `<b>${this.x}</b><br/>Members: <b>${this.y}</b>`;
    },
  },
  series: [
    {
      name: 'Members',
      data: [1, 2, 5, 7, 8, 9, 9, 9, 9, 9, 9],
      pointStart: 0,
    },
  ],
  credits: {
    enabled: false,
  },
}));
</script>
