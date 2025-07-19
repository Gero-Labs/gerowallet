<template>
  <div
      :class="classname"
      :style="styles"
  >
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue';
import Highcharts from 'highcharts';

interface Props {
  classname?: string;
  styles?: Record<string, any>;
  options?: any;
  highcharts?: any;
}

const props = withDefaults(defineProps<Props>(), {
  classname: 'vue-highcharts',
  styles: () => ({}),
});

const chart = ref<any>(null);
const loading = ref<boolean>(true);
const instance = getCurrentInstance();

const getChart = () => {
  return chart.value;
};

const addSeries = (options: any) => {
  delegateMethod('addSeries', options);
};

const removeSeries = () => {
  while (getChart().series.length !== 0) {
    getChart().series[0].remove();
  }
};

const mergeOption = (options: any) => {
  delegateMethod('update', options);
};

const showLoading = (txt: string) => {
  getChart().showLoading(txt);
};

const hideLoading = () => {
  getChart().hideLoading();
};

const delegateMethod = (name: string, ...args: any[]) => {
  if (!getChart()) {
    console.log(`Cannot call [${name}] before the chart is initialized. Set prop [options] first.`, instance);
    return;
  }
  return getChart()[name](...args);
};

const init = () => {
  if (!getChart() && props.options && instance?.proxy?.$el) {
    const highchartInstance = props.highcharts || Highcharts;
    if (highchartInstance.product === 'Highstock') {
      chart.value = new highchartInstance.stockChart(instance.proxy.$el, props.options);
      return;
    } else if (highchartInstance.product === 'Highmaps') {
      chart.value = new highchartInstance.mapChart(instance.proxy.$el, props.options);
      return;
    }
    chart.value = new highchartInstance.Chart(instance.proxy.$el, props.options);
  }
};

watch(
  () => props.options,
  (options) => {
    if (!getChart() && options) {
      init();
    } else if (getChart() && options) {
      getChart().update(props.options);
    }
  }
);

onMounted(() => {
  if (!getChart() && props.options) {
    init();
  }
});

onBeforeUnmount(() => {
  if (getChart()) {
    getChart().destroy();
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
