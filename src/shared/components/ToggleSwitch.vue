<template>
  <div class="switch">
    <p class="left‐text my-auto "
       :style="{
      color: !props.value ? '#ffffff' : '',
      fontSize: props.fontSize,
    }">
      {{ props.textLeft }}
      <v-icon :color="props.value ? '#ffffff' : 'primary'" small v-if="props.iconLeft">
        {{ props.iconLeft }}
      </v-icon>
    </p>
    <v-switch
      inset
      dense
      v-model="model"
      @change="toggleSwitch"
      color="inherit"
      hide-details
      style="margin-top: 0; align-items: center;"
      class="toggleSwitch"
      :disabled="props.disabled"
    ></v-switch>
    <p class="right‐text my-auto"
       :style="{
      color: props.value ? '#ffffff' : '',
      fontSize: props.fontSize,
    }">
      <v-icon :color="props.value ? 'primary' : '#ffffff'" small v-if="props.iconRight">
        {{ props.iconRight }}
      </v-icon>
      {{ props.textRight }}
    </p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  value: {
    type: Boolean,
    required: true
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
const emit = defineEmits(['input', 'update:modelValue'])

const toggleSwitch = (value: boolean) => {
  // Emit both events for Vue 2.7 compatibility
  emit('input', value);
  emit('update:modelValue', value);
}

const model = computed<boolean>({
  get() {
    return props.value
  },
  set(newVal: boolean) {
    toggleSwitch(newVal)
  },
})
</script>

<style>
.toggleSwitch .v-input--selection-controls__input {
  margin-left: 16px!important;
}
.switch {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}

.left‐text {
  justify-self: end; /* push left text up against the switch */
}

.toggleSwitch {
  justify-self: center; /* always center column */
}

.right‐text {
  justify-self: start; /* push right text up against the switch */
}

.toggleSwitch .v-input--switch__track {
  color: #ffffff2b !important;
  opacity: 1;
  border: 1px solid #ffffff12;
}

.toggleSwitch .v-input--switch__thumb {
  color: #2f9cac!important;
}
</style>
