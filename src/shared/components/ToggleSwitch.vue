<template>
  <div class="switch">
    <p class="left‐text my-auto "
       :style="{
      color: !props.modelValue ? '#ffffff' : '',
      fontSize: props.fontSize,
    }">
      {{ props.textLeft }}
      <v-icon :color="props.modelValue ? '#ffffff' : 'primary'" size="small" v-if="props.iconLeft">
        {{ props.iconLeft }}
      </v-icon>
    </p>
    <!-- Vuetify 4 renders a plain checkbox; restore the switch semantics Vuetify 2 exposed. -->
    <v-switch
      role="switch"
      inset
      size="small"
      density="compact"
      v-model="model"
      color="primary"
      hide-details
      style="margin-top: 0; align-items: center;"
      class="toggleSwitch"
      :disabled="props.disabled"
      :aria-label="props.label || undefined"
      :aria-describedby="props.describedby || undefined"
    ></v-switch>
    <p class="right‐text my-auto"
       :style="{
      color: props.modelValue ? '#ffffff' : '',
      fontSize: props.fontSize,
    }">
      <v-icon :color="props.modelValue ? 'primary' : '#ffffff'" size="small" v-if="props.iconRight">
        {{ props.iconRight }}
      </v-icon>
      {{ props.textRight }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  },
  /** The switch's accessible name, when no visible <label> is tied to it. */
  label: {
    type: String,
    default: ''
  },
  /** The id of the element that describes what the switch does. */
  describedby: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  textLeft: {
    type: String,
    default: 'Off'
  },
  textRight: {
    type: String,
    default: 'On'
  },
  iconLeft: {
    type: String,
    default: ''
  },
  iconRight: {
    type: String,
    default: ''
  },
  fontSize: {
    type: String,
    default: '14px'
  }
});
const emit = defineEmits(['update:modelValue'])

const toggleSwitch = (value: boolean) => {
  emit('update:modelValue', value);
}

const model = computed<boolean>({
  get() {
    return props.modelValue
  },
  set(newVal: boolean) {
    toggleSwitch(newVal)
  },
})
</script>

<style>
.switch {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  column-gap: var(--g-s-2);
}

.left‐text {
  justify-self: end; /* push left text up against the switch */
}

.toggleSwitch {
  justify-self: center; /* always center column */
  --v-input-control-height: 28px;
}

.right‐text {
  justify-self: start; /* push right text up against the switch */
}

.toggleSwitch .v-switch__track {
  background-color: #ffffff2b !important;
  opacity: 1;
  border: 1px solid #ffffff12;
}

.toggleSwitch .v-switch__thumb {
  background-color: var(--v-primary-base)!important;
}
</style>
