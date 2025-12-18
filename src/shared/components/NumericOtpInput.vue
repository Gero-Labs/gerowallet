<template>
  <v-tooltip
    v-model="showTooltip"
    top
    color="red"
  >
    <template v-slot:activator="{ }">
      <v-otp-input
        ref="otpInputRef"
        :value="value"
        :length="length"
        type="password"
        inputmode="numeric"
        :error="!!error"
        @input="handleInput"
        @keydown="handleKeyDown"
        @finish="handleFinish"
      ></v-otp-input>
    </template>
    <span>{{ error }}</span>
  </v-tooltip>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

interface Props {
  value: string;
  length?: number;
  error?: string;
}

const props = withDefaults(defineProps<Props>(), {
  length: 4,
  error: ''
});

const emit = defineEmits<{
  (e: 'input', value: string): void;
  (e: 'finish', value: string): void;
}>();

const otpInputRef = ref<any>(null);
const showTooltip = ref(false);
const previousValue = ref('');
let tooltipTimeout: any = null;

// Function to show error tooltip
function showErrorTooltip() {
  showTooltip.value = true;
  if (tooltipTimeout) clearTimeout(tooltipTimeout);
  tooltipTimeout = setTimeout(() => {
    showTooltip.value = false;
  }, 2000);
}

// Watch error prop to show/hide tooltip
watch(() => props.error, (newError) => {
  if (newError) {
    showErrorTooltip();
  } else {
    // Clear tooltip when error is cleared
    showTooltip.value = false;
    if (tooltipTimeout) clearTimeout(tooltipTimeout);
  }
});

// Watch value changes to detect when input is cleared with error present
// This handles the case where same error is set multiple times
watch(() => props.value, (newValue, oldValue) => {
  // If user starts typing, hide tooltip
  if (newValue && showTooltip.value) {
    showTooltip.value = false;
    if (tooltipTimeout) clearTimeout(tooltipTimeout);
  }

  // If value was cleared (becomes empty) and error exists, show error again
  // This handles repeated failures with same error message
  if (oldValue && !newValue && props.error) {
    showErrorTooltip();
  }

  previousValue.value = newValue;
});

// Prevent non-numeric keys from being entered
function handleKeyDown(event: KeyboardEvent) {
  // Allow special keys (they have length > 1) and numeric keys
  if (event.key.length === 1 && !/^\d$/.test(event.key)) {
    event.preventDefault();
  }
}

function handleInput(value: string) {
  const filtered = value.replace(/\D/g, '');
  emit('input', filtered);
}

function handleFinish(value: string) {
  const filtered = value.replace(/\D/g, '');
  emit('finish', filtered);
}

// Expose methods for parent components
defineExpose({
  focus: () => otpInputRef.value?.focus(),
  resetValidation: () => otpInputRef.value?.resetValidation()
});
</script>

<style>
/* Make PIN password dots bigger and textboxes square */
.v-otp-input {
  display: inline-flex !important;
  justify-content: center;
  width: auto !important;
  gap: 12px !important;
}

.v-otp-input input {
  font-size: 32px !important;
  font-weight: bold !important;
  width: 56px !important;
  height: 56px !important;
  min-width: 56px !important;
  max-width: 56px !important;
  flex: 0 0 56px !important;
  border-radius: 8px !important;
}

.v-otp-input .v-input {
  width: 56px !important;
  max-width: 56px !important;
  flex: 0 0 56px !important;
}

.v-otp-input .v-input__control {
  width: 56px !important;
  max-width: 56px !important;
}

.v-otp-input .v-input__slot {
  width: 56px !important;
  max-width: 56px !important;
}
</style>
