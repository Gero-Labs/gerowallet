<template>
  <v-stepper v-model="activeStep" flat class="stepper-container" non-linear alt-labels>
    <v-stepper-header>
      <template v-for="(item, index) in steps">
        <div
          class="custom-step"
          :key="item.name"
          :class="{ active: activeStep === index + 1, done: activeStep > index + 1, next: activeStep < index + 1 }"
        >
          <div class="icon-container">
            <v-icon
              class="step-icon"
              :color="activeStep < index + 1 ? '#00dff3' : '#0f0f0f'"
              size="20"
              >{{ activeStep > index + 1 ? "mdi-check" : "mdi-circle-medium" }}</v-icon
            >
          </div>
          <span class="step-label">{{ item.label }}</span>
        </div>
        <div class="divider" :class="{ 'active-divider': activeStep > index + 1 }" :key="index" v-if="index < steps.length - 1" ></div>
      </template>
    </v-stepper-header>

    <v-stepper-items>
      <v-stepper-content v-for="(step, index) in steps" :key="step.name" :step="index + 1">
        <component :is="step.component" @next="$emit('next')" @prev="$emit('prev')"></component>
      </v-stepper-content>
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
.stepper-container {
  background-color: transparent;

  & .v-stepper__header {
    box-shadow: none;
  }

  .custom-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    padding: 5px;
    width: 150px;

    &.active .icon-container {
      box-shadow: 0 0 0 5px #00dff327;
    }

    &.next .icon-container {
      background-color: #292929;
    }

    .icon-container {
      background-color: #00dff3;
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 24px;
      width: 24px;
      padding-left: 1px;
    }
  }

  .step-label {
    margin-top: 10px;
    font-size: 14px;
    line-height: 20px;
    text-align: center;
    font-weight: 600;
    color: #CECFD2;
  }

  .divider {
    flex: 1;
    height: 2px;
    width: 100%;
    margin-left: -75px;
    margin-right: -75px;
    margin-top: 16px;
    background-color: #292929;

    &.active-divider {
      background-color: #00dff3;
    }
  }
}
</style>
