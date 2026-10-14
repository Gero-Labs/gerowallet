<template>
  <v-tooltip location="top"
    v-model="showTooltip"
    :open-on-hover="false"
    :open-on-focus="false"

    color="red"
  >
    <template v-slot:activator="{ props: activatorProps }">
      <div v-bind="activatorProps">
      <v-otp-input
        ref="otpInputRef"
        :model-value="modelValue"
        :length="length"
        type="password"
        inputmode="numeric"
        :error="!!error"
        @update:model-value="handleInput"
        @keydown="handleKeyDown"
        @finish="handleFinish"
      ></v-otp-input>
      </div>
    </template>
    <span>{{ error }}</span>
  </v-tooltip>
</template>

<script setup lang="ts">
import { ref, watch, onScopeDispose } from 'vue';
import type { VOtpInput } from 'vuetify/components';

interface Props {
  modelValue: string;
  length?: number;
  error?: string;
}

const props = withDefaults(defineProps<Props>(), {
  length: 4,
  error: ''
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'finish', value: string): void;
}>();

const otpInputRef = ref<InstanceType<typeof VOtpInput> | null>(null);
const showTooltip = ref(false);
const previousValue = ref('');
let tooltipTimeout: ReturnType<typeof setTimeout> | null = null;
onScopeDispose(() => { if (tooltipTimeout) clearTimeout(tooltipTimeout); });

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
watch(() => props.modelValue, (newValue, oldValue) => {
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
  emit('update:modelValue', filtered);
}

function handleFinish(value: string) {
  const filtered = value.replace(/\D/g, '');
  emit('finish', filtered);
}

// Expose methods for parent components
defineExpose({
  focus: () => otpInputRef.value?.focus(),
  resetValidation: () => { showTooltip.value = false; if (tooltipTimeout) clearTimeout(tooltipTimeout); }
});
</script>

<style>
/* Make PIN password dots bigger and textboxes square */
.v-otp-input {
  display: inline-flex !important;
  justify-content: center;
  width: auto !important;
}

.v-otp-input .v-otp-input__content {
  gap: 12px;
  padding: 0;
  width: auto;
  max-width: none;
  height: 56px !important;
}

.v-otp-input .v-field {
  width: 56px !important;
  min-width: 56px;
  max-width: 56px !important;
  flex: 0 0 56px !important;
  border-radius: 8px !important;
}

/* Vuetify 4 paints each digit in a field and uses a separate hidden input.
   Size the visible glyph, leaving its native keyboard/autofill input intact. */
.v-otp-input .v-otp-input__field {
  font-size: 32px !important;
  font-weight: bold !important;
}
</style>
