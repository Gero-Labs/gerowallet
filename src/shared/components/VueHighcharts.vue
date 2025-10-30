<template>
  <div
      :class="classname"
      :style="styles"
  >
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, watch, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue';
import Highcharts from 'highcharts';
// Using any for Highcharts types to avoid complex type issues

interface Props {
  classname?: string;
  styles?: Record<string, string | number>;
  options?: any;
  highcharts?: typeof Highcharts;
}

const props = withDefaults(defineProps<Props>(), {
  classname: 'vue-highcharts',
  styles: () => ({}),
});

const chart = ref<any>(null);
const instance = getCurrentInstance();

const getChart = (): any => {
  return chart.value;
};

const addSeries = (options: any): void => {
  delegateMethod('addSeries', options);
};

const removeSeries = (): void => {
  const chartInstance = getChart();
  if (chartInstance) {
    while (chartInstance.series.length !== 0) {
      chartInstance.series[0].remove();
    }
  }
};

const mergeOption = (options: any): void => {
  delegateMethod('update', options);
};

const showLoading = (txt: string): void => {
  const chartInstance = getChart();
  if (chartInstance) {
    chartInstance.showLoading(txt);
  }
};

const hideLoading = (): void => {
  const chartInstance = getChart();
  if (chartInstance) {
    chartInstance.hideLoading();
  }
};

const delegateMethod = (name: string, ...args: unknown[]): unknown => {
  const chartInstance = getChart();
  if (!chartInstance) {
    console.log(`Cannot call [${name}] before the chart is initialized. Set prop [options] first.`, instance);
    return undefined;
  }
  return (chartInstance as any)[name](...args);
};

const init = (): void => {
  const chartInstance = getChart();
  if (!chartInstance && props.options && instance?.proxy?.$el) {
    const highchartInstance = props.highcharts || Highcharts;
    const element = instance.proxy.$el as HTMLElement;
    
    // Create standard Highcharts chart
    chart.value = new highchartInstance.Chart(element, props.options);
  }
};

watch(
  () => props.options,
  (options: any) => {
    const chartInstance = getChart();
    if (!chartInstance && options) {
      init();
    } else if (chartInstance && options) {
      chartInstance.update(options);
    }
  }
);

onMounted(() => {
  const chartInstance = getChart();
  if (!chartInstance && props.options) {
    init();
  }
});

onBeforeUnmount(() => {
  const chartInstance = getChart();
  if (chartInstance) {
    chartInstance.destroy();
  }
});

// Expose methods to parent component
defineExpose({
  getChart,
  addSeries,
  removeSeries,
  mergeOption,
  showLoading,
  hideLoading,
  delegateMethod,
  init
});
</script>
