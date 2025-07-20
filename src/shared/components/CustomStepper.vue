<template>
  <v-stepper v-model="activeStep" flat class="stepper-container" non-linear alt-labels>
    <v-stepper-items>
      <slot></slot>
    </v-stepper-items>
  </v-stepper>
</template>
<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps({
  steps: {
    type: Array,
    required: true,
  },
  currentStep: {
    type: Number,
    default: 1,
  },
});

const activeStep = computed(() => {
  return props.currentStep;
});
</script>
<style scoped>

</style>
