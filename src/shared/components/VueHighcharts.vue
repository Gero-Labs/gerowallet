<template>
  <div
      :class="classname"
      :style="styles"
  >
  </div>
</template>

<script setup lang="ts">
import { shallowRef, watch, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue';
import Highcharts from 'highcharts';

interface Props {
  classname?: string;
  styles?: Record<string, string | number>;
  options?: Highcharts.Options;
  highcharts?: typeof Highcharts;
}

const props = withDefaults(defineProps<Props>(), {
  classname: 'vue-highcharts',
  styles: () => ({}),
});

const chart = shallowRef<Highcharts.Chart | null>(null);
const instance = getCurrentInstance();

const getChart = (): Highcharts.Chart | null => {
  return chart.value;
};

const warnNotReady = (name: string): void => {
  console.log(`Cannot call [${name}] before the chart is initialized. Set prop [options] first.`, instance);
};

const addSeries = (options: Highcharts.SeriesOptionsType): void => {
  const chartInstance = getChart();
  if (!chartInstance) return warnNotReady('addSeries');
  chartInstance.addSeries(options);
};

const removeSeries = (): void => {
  const chartInstance = getChart();
  if (chartInstance) {
    while (chartInstance.series.length !== 0) {
      chartInstance.series[0].remove();
    }
  }
};

const mergeOption = (options: Highcharts.Options): void => {
  const chartInstance = getChart();
  if (!chartInstance) return warnNotReady('update');
  chartInstance.update(options);
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
  (options) => {
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
  init
});
</script>
