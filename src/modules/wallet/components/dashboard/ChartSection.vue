<template>
  <v-card class="chart-card" outlined>
    <div class="chart-header">
      <div class="chart-title-section">
        <h3 class="chart-title">{{ $t('card.balanceOverTime') }}</h3>
        <div class="chart-value-section">
          <span class="chart-value">€{{ currentBalance }}</span>
          <div class="change-badge positive">
            <img src="@/assets/svg/trend-up-01.svg" :alt="$t('common.trend')" class="change-icon" />
            <span class="change-text">+{{ balanceChangePercentage }}%</span>
          </div>
        </div>
      </div>
      <div class="chart-controls">
        <v-menu offset-y :close-on-content-click="false">
          <template v-slot:activator="{ on, attrs }">
            <v-btn class="filter-btn" variant="outlined" size="small" v-bind="attrs" v-on="on">
              <img src="@/modules/wallet/icons/filter.svg" :alt="$t('common.filter')" class="btn-icon" />
              {{ $t('common.date') }}
            </v-btn>
          </template>
          <v-card outlined class="liquid-glass">
            <div class="time-tabs">
              <v-btn
                class="tab-btn"
                :class="{ active: activeTab === '12months' }"
                variant="text"
                size="small"
                @click="setActiveTab('12months')"
              >
                12M
              </v-btn>
              <v-btn
                class="tab-btn"
                :class="{ active: activeTab === '30days' }"
                variant="text"
                size="small"
                @click="setActiveTab('30days')"
              >
                30D
              </v-btn>
              <v-btn
                class="tab-btn"
                :class="{ active: activeTab === '7days' }"
                variant="text"
                size="small"
                @click="setActiveTab('7days')"
              >
                7D
              </v-btn>
            </div>
          </v-card>
        </v-menu>
      </div>
    </div>

    <div class="chart-container">
      <div ref="chartContainer" class="highcharts-container"></div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, onMounted, watch, computed } from 'vue';
import Highcharts from 'highcharts';
import cardStore from '@/stores/modules/card';


const { t } = useTranslation();

const activeTab = ref('12months');
const chartContainer = ref<HTMLElement>();
let chart: Highcharts.Chart | null = null;

// Base historical data (starting point before top-ups)
const baseBalance = 550;

// Current balance from card store
const currentBalance = computed(() => {
  // If no card data (pending state), show 0
  if (!cardStore.state.cardData) {
    return '0';
  }
  if (cardStore.state.cardBalance?.currentBalance) {
    return cardStore.state.cardBalance.currentBalance.amount.toFixed(0);
  }
  return baseBalance.toString();
});

// Calculate balance change percentage
const balanceChangePercentage = computed(() => {
  const current = parseFloat(currentBalance.value);
  const change = ((current - baseBalance) / baseBalance) * 100;
  return change.toFixed(1);
});

// Dynamic chart data that updates with current balance
const chartData = computed(() => {
  const current = parseFloat(currentBalance.value);
  
  // If in pending state (no card data), show all zeros
  if (!cardStore.state.cardData) {
    return {
      '12months': Array.from({ length: 12 }, (_, i) => ({ 
        name: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i], 
        y: 0 
      })),
      '30days': Array.from({ length: 7 }, (_, i) => ({ 
        name: `Day ${(i + 1) * 5}`, 
        y: 0 
      })),
      '7days': Array.from({ length: 7 }, (_, i) => ({ 
        name: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i], 
        y: 0 
      })),
    };
  }
  
  return {
    '12months': [
      { name: 'Jan', y: 120 },
      { name: 'Feb', y: 135 },
      { name: 'Mar', y: 110 },
      { name: 'Apr', y: 145 },
      { name: 'May', y: 160 },
      { name: 'Jun', y: 140 },
      { name: 'Jul', y: 155 },
      { name: 'Aug', y: 170 },
      { name: 'Sep', y: 165 },
      { name: 'Oct', y: 180 },
      { name: 'Nov', y: 175 },
      { name: 'Now', y: current },
    ],
    '30days': [
      { name: 'Day 1', y: 150 },
      { name: 'Day 5', y: 155 },
      { name: 'Day 10', y: 160 },
      { name: 'Day 15', y: 165 },
      { name: 'Day 20', y: 170 },
      { name: 'Day 25', y: 175 },
      { name: 'Now', y: current },
    ],
    '7days': [
      { name: 'Mon', y: 170 },
      { name: 'Tue', y: 172 },
      { name: 'Wed', y: 175 },
      { name: 'Thu', y: 173 },
      { name: 'Fri', y: 176 },
      { name: 'Sat', y: 178 },
      { name: 'Now', y: current },
    ],
  };
});

const setActiveTab = (tab: string) => {
  activeTab.value = tab;
  updateChart();
};

const updateChart = () => {
  if (!chart) return;

  const data = chartData.value[activeTab.value as keyof typeof chartData.value];
  const categories = data.map(item => item.name);
  
  // Update both data and categories
  chart.xAxis[0].setCategories(categories);
  chart.series[0].setData(data);
};

const initChart = () => {
  if (!chartContainer.value) return;

  const options: Highcharts.Options = {
    chart: {
      type: 'line',
      backgroundColor: 'transparent',
      height: 190,
      spacing: [0, 0, 0, 0],
      style: {
        fontFamily: 'Inter, sans-serif',
      },
    },
    title: {
      text: '',
    },
    xAxis: {
      categories: chartData.value[activeTab.value as keyof typeof chartData.value].map(item => item.name),
      lineColor: '#22262F',
      tickColor: '#22262F',
      labels: {
        style: {
          color: '#94979C',
          fontSize: '12px',
          fontWeight: '400',
        },
      },
    },
    yAxis: {
      title: {
        text: '',
      },
      gridLineColor: '#22262F',
      labels: {
        enabled: false,
      },
    },
    legend: {
      enabled: false,
    },
    plotOptions: {
      line: {
        color: '#2DF0F7',
        lineWidth: 2,
        marker: {
          enabled: false,
        },
      },
      area: {
        fillColor: {
          linearGradient: {
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 1,
          },
          stops: [
            [0, 'rgba(45, 240, 247, 0.1)'],
            [1, 'rgba(45, 240, 247, 0)'],
          ],
        },
      },
    },
    series: [
      {
        name: 'Balance',
        data: chartData.value[activeTab.value as keyof typeof chartData.value],
        type: 'line',
      },
    ],
    credits: {
      enabled: false,
    },
    tooltip: {
      enabled: true,
      backgroundColor: '#1A1D24',
      borderColor: '#22262F',
      borderRadius: 8,
      borderWidth: 1,
      style: {
        color: '#FFFFFF',
        fontSize: '12px',
        fontFamily: 'Inter, sans-serif',
      },
      formatter: function() {
        return `<b>${this.x}</b><br/>Balance: €${this.y}`;
      },
    },
  };

  chart = Highcharts.chart(chartContainer.value, options);
};

onMounted(() => {
  initChart();
});

watch(activeTab, () => {
  updateChart();
});

// Watch for balance changes and update chart
watch(() => cardStore.state.cardBalance?.currentBalance?.amount, () => {
  console.log('📊 Chart: Balance changed, updating chart with new balance:', currentBalance.value);
  updateChart();
});
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.chart-card {
  background: $background-card;
  border: 1px solid $border-secondary;
  border-radius: $border-radius-md;
  padding: $spacing-lg;
  .chart-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: $spacing-lg;
    margin-bottom: $spacing-2xl;
  }

  .chart-title-section {
    display: flex;
    flex-direction: column;
    gap: $spacing-sm;
  }

  .chart-title {
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: $font-size-sm;
    line-height: 1.43;
    color: $text-muted;
    margin: 0;
  }

  .chart-value-section {
    display: flex;
    align-items: center;
    gap: $spacing-md;
  }

  .chart-value {
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: 30px;
    line-height: 1.27;
    color: $text-primary;
  }

  .change-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px 2px 6px;
    border-radius: $border-radius-sm;
    background: $background-card;
    border: 1px solid $border-primary;

    &.positive {
      .change-icon {
        width: 12px;
        height: 12px;
      }
      .change-text {
        color: $text-secondary;
      }
    }

    .change-icon {
      width: 12px;
      height: 12px;
    }

    .change-text {
      font-family: $font-family-primary;
      font-weight: $font-weight-medium;
      font-size: $font-size-sm;
      line-height: 1.43;
    }
  }

  .chart-controls {
    gap: 0;
    align-items: center;
  }

  .filter-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    background: $background-card;
    border: 1px solid $border-primary;
    border-radius: $border-radius-md;
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: $font-size-sm;
    line-height: 1.43;
    color: $text-secondary;
    text-transform: none;
    box-shadow: $shadow-md;

    .btn-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      margin-right: 6px;
    }
  }

  .chart-container {
    height: 190px;
    position: relative;
  }

  .highcharts-container {
    width: 100%;
    height: 100%;
  }
}

.liquid-glass {
  border-radius: 16px;
  width: 100%;
  padding: 16px;
  .time-tabs {
    display: flex;
    gap: 2px;
    background: $background-dark;
    border: 1px solid $background-secondary;
    border-radius: $border-radius-md;
    padding: 2px;

    .tab-btn {
      padding: 8px 12px;
      font-family: $font-family-primary;
      font-weight: $font-weight-semibold;
      font-size: $font-size-sm;
      line-height: 1.43;
      color: $text-muted;
      text-transform: none;
      border-radius: $border-radius-md;
      min-width: auto;
      height: 36px;
      background: transparent;
      border: none;

      &.active {
        background: $background-card;
        border: 1px solid $border-primary;
        color: $text-secondary;
        box-shadow: $shadow-sm;
      }

      &:not(.active):hover {
        background: lighten($background-dark, 2%);
      }
    }
  }
}
</style>
