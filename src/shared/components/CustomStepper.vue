<template>
  <v-stepper v-model="activeStep" flat class="stepper-container" non-linear alt-labels>
    <v-stepper-items>
      <slot></slot>
    </v-stepper-items>
  </v-stepper>
</template>

<script>
export default {
  props: {
    steps: {
      type: Array,
      required: true,
    },
    currentStep: {
      type: Number,
      default: 1,
    },
  },
  computed: {
    activeStep() {
      return this.currentStep;
    },
  },
  methods: {
  },
};
</script>
<style scoped>

</style>
