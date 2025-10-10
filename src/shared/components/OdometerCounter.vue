<template>
  <div class="odometer-wrapper">
    <span ref="odometerEl" class="odometer"></span>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import Odometer from 'odometer';
import 'odometer/themes/odometer-theme-default.css';

interface Props {
  value: number;
  format?: 'int' | 'float';
  duration?: number;
}

const props = withDefaults(defineProps<Props>(), {
  format: 'int',
  duration: 1000,
});

const odometerEl = ref<HTMLElement | null>(null);
let odometerInstance: any = null;

onMounted(async () => {
  await nextTick();

  if (odometerEl.value) {
    // Initialize odometer with format string
    const formatString = props.format === 'int' ? '(,ddd)' : '(,ddd).dd';

    odometerInstance = new Odometer({
      el: odometerEl.value,
      value: 0,
      format: formatString,
      theme: 'default',
      duration: props.duration,
      auto: false, // Disable auto animation to control it manually
    });

    // Set initial value after initialization
    requestAnimationFrame(() => {
      if (odometerInstance && props.value) {
        // Start closer to the target value to reduce rolling
        const startValue = Math.max(0, props.value - 1000);
        odometerInstance.update(startValue);

        // Then animate to actual value
        setTimeout(() => {
          odometerInstance.update(props.value);
        }, 50);
      }
    });
  }
});

// Watch for value changes
watch(
  () => props.value,
  (newValue, oldValue) => {
    if (odometerInstance && newValue !== oldValue) {
      // Calculate a range to roll through (10% of the difference, minimum 100)
      const diff = Math.abs(newValue - oldValue);
      const rollRange = Math.max(100, Math.min(diff * 0.1, 2000));

      // Start from closer to target value
      const startValue = newValue > oldValue
        ? Math.max(0, newValue - rollRange)
        : newValue + rollRange;

      odometerInstance.update(startValue);

      // Then animate to actual value
      setTimeout(() => {
        odometerInstance.update(newValue);
      }, 10);
    }
  }
);

onBeforeUnmount(() => {
  odometerInstance = null;
});
</script>

<style scoped>
.odometer-wrapper {
  display: inline-flex;
  align-items: baseline;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}

.odometer {
  font-weight: 600;
  line-height: 1;
}
</style>

<style>
/* Odometer theme customization */
.odometer.odometer-auto-theme,
.odometer.odometer-theme-default {
  display: inline-block;
  vertical-align: baseline;
  position: relative;
  line-height: 1;
}

.odometer.odometer-auto-theme .odometer-digit,
.odometer.odometer-theme-default .odometer-digit {
  display: inline-block;
  vertical-align: baseline;
  position: relative;
}

.odometer.odometer-auto-theme .odometer-digit .odometer-digit-spacer,
.odometer.odometer-theme-default .odometer-digit .odometer-digit-spacer {
  display: inline-block;
  vertical-align: middle;
  visibility: hidden;
}

.odometer.odometer-auto-theme .odometer-digit .odometer-digit-inner,
.odometer.odometer-theme-default .odometer-digit .odometer-digit-inner {
  text-align: left;
  display: block;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
}

.odometer.odometer-auto-theme .odometer-digit .odometer-ribbon,
.odometer.odometer-theme-default .odometer-digit .odometer-ribbon {
  display: block;
}

.odometer.odometer-auto-theme .odometer-digit .odometer-ribbon-inner,
.odometer.odometer-theme-default .odometer-digit .odometer-ribbon-inner {
  display: block;
  -webkit-backface-visibility: hidden;
}

.odometer.odometer-auto-theme .odometer-digit .odometer-value,
.odometer.odometer-theme-default .odometer-digit .odometer-value {
  display: block;
  -webkit-transform: translateZ(0);
}

.odometer.odometer-auto-theme .odometer-digit .odometer-value.odometer-last-value,
.odometer.odometer-theme-default .odometer-digit .odometer-value.odometer-last-value {
  position: absolute;
}

.odometer.odometer-auto-theme.odometer-animating-up .odometer-ribbon-inner,
.odometer.odometer-theme-default.odometer-animating-up .odometer-ribbon-inner {
  -webkit-transition: -webkit-transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  -moz-transition: -moz-transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  -ms-transition: -ms-transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  -o-transition: -o-transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  transition: transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.odometer.odometer-auto-theme.odometer-animating-up.odometer-animating .odometer-ribbon-inner,
.odometer.odometer-theme-default.odometer-animating-up.odometer-animating .odometer-ribbon-inner {
  -webkit-transform: translateY(-100%);
  -moz-transform: translateY(-100%);
  -ms-transform: translateY(-100%);
  -o-transform: translateY(-100%);
  transform: translateY(-100%);
}

.odometer.odometer-auto-theme.odometer-animating-down .odometer-ribbon-inner,
.odometer.odometer-theme-default.odometer-animating-down .odometer-ribbon-inner {
  -webkit-transform: translateY(-100%);
  -moz-transform: translateY(-100%);
  -ms-transform: translateY(-100%);
  -o-transform: translateY(-100%);
  transform: translateY(-100%);
}

.odometer.odometer-auto-theme.odometer-animating-down.odometer-animating .odometer-ribbon-inner,
.odometer.odometer-theme-default.odometer-animating-down.odometer-animating .odometer-ribbon-inner {
  -webkit-transition: -webkit-transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  -moz-transition: -moz-transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  -ms-transition: -ms-transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  -o-transition: -o-transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  transition: transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  -webkit-transform: translateY(0);
  -moz-transform: translateY(0);
  -ms-transform: translateY(0);
  -o-transform: translateY(0);
  transform: translateY(0);
}

.odometer.odometer-auto-theme,
.odometer.odometer-theme-default {
  font-family: inherit;
  line-height: inherit;
}

.odometer.odometer-auto-theme .odometer-value,
.odometer.odometer-theme-default .odometer-value {
  text-align: center;
}
</style>
