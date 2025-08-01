<template>
  <v-form ref="form" v-model="valid">
    <v-text-field
      :dense="dense"
      solo
      flat
      hide-details
      v-model="formattedValue"
      maxlength="16"
      @input="handleInput"
      :class="[
        'currency-text-field',
        'transparent',
        { 'text-right': textRight },
        { 'dense': dense }
      ]"
      :rules="rules"
      :readonly="readOnly"
      :style="{
        fontSize: fontSize+'px'
      }"
      @keydown.native="onKeydown"
      placeholder="0"
      hint="0"
    ></v-text-field>
  </v-form>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps({
  value: {
    type: String,
    default: '0'
  },
  maximum: {
    type: Number,
    default: Infinity
  },
  minimum: {
    type: Number,
    default: 0,
  },
  decimals: {
    type: Number,
    default: 2
  },
  readOnly: {
    type: Boolean,
    default: false
  },
  rules: {
    type: Array,
    default: () => []
  },
  textRight: {
    type: Boolean,
    default: false
  },
  fontSize: {
    type: Number,
    default: 22
  },
  isQuantity: {
    type: Boolean,
    default: false
  },
  dense: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits<{
  (e: 'input', payload: string): void
  (e: 'change', payload: string): void
}>()

const valid = ref<boolean>(false)

const cleanValue = (value: string): string => {
  return String(value).replace(/[^0-9.]/g, '').substring(0, 16);
}

const handleInput = (value: string): void => {
  formattedValue.value = value
  const cleanedValue = cleanValue(value);
  rawValue.value = cleanedValue.length > 0 ? cleanedValue : '0';
  emit('change', value.replaceAll(',', ''))
}

const formatNumber = (value: string) => {
  if (!value) return '0';
  const number = parseFloat(value);
  return isNaN(number) ? '0' : number.toLocaleString('en-US', { maximumFractionDigits: props.decimals });
}

const onKeydown = (e: KeyboardEvent): void => {
  const allowedControlKeys = [
    'Backspace',
    'Delete',
    'ArrowLeft',
    'ArrowRight',
    'Tab',
    'Home',
    'End'
  ]

  // If it’s one of the control/navigation keys, always allow
  if (allowedControlKeys.includes(e.key)) {
    return
  }
  // If it’s a decimal point, ensure there isn’t already one in rawValue
  if (e.key === '.') {
    if (formattedValue.value.includes('.')) {
      e.preventDefault()
    }
    return;
  }

  // If it’s a digit 0–9, allow
  if (/^[0-9]$/.test(e.key)) {
    return;
  }

  e.preventDefault()
}

const vmProxy = getCurrentInstance()!.proxy as any

const validate = () => {
  return vmProxy.$refs.form.validate();
}

defineExpose({validate})

let rawValue = computed({
  get() {
    return cleanValue(props.value);
  },
  set(newValue) {
    emit('input', newValue || '0');
  }
})

let formattedValue = computed({
  get() {
    return formatNumber(rawValue.value);
  },
  set(value) {
    rawValue.value = cleanValue(value || '0');
  }
})
</script>
<style>
.currency-text-field.v-text-field.v-text-field--solo.text-right .v-input__control {
  direction: rtl;
}

.currency-text-field.text-right .v-input__control input {
  direction: ltr;
  text-align: right;
}

.currency-text-field.text-right .v-input__control .v-input__slot {
  padding: 0 !important;
}

.currency-text-field.transparent .v-input__control .v-input__slot {
  background-color: transparent!important;
}

.currency-text-field .v-input__control .v-input__slot {
  padding: 0 !important;
}

.currency-text-field.dense .v-input__control .v-input__slot {
  min-height: 30px!important;
  height: 30px!important;
}

.currency-text-field.dense .v-input__control {
  min-height: 30px!important;
  height: 30px!important;
}

.currency-text-field.dense {
  min-height: 30px!important;
  height: 30px!important;
}
</style>
