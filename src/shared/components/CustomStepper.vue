<template>
  <v-stepper :model-value="currentStep" flat class="stepper-container" non-linear alt-labels>
    <v-stepper-window :model-value="currentStep" class="ma-0">
      <slot></slot>
    </v-stepper-window>
  </v-stepper>
</template>
<script setup lang="ts">
defineProps({
  steps: {
    type: Array,
    required: true,
  },
  currentStep: {
    type: Number,
    default: 1,
  },
});

</script>
<style scoped>
/* The wrapped v-stepper otherwise renders Vuetify's default grey surface
   (a child component, so the parent dialog's transparent override can't reach
   it). Keep it transparent so the dialog surface shows through. */
.stepper-container {
  background-color: transparent !important;
}

/* V2 step content supplied this inset. Keep it below component-specific
   overrides and spacing utilities so compact send/registration flows opt out. */
@layer vuetify-overrides {
  .stepper-container :deep(.v-stepper-window-item) {
    padding: 24px 24px 16px;
  }
}
</style>
