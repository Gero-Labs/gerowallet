<template>
  <!-- PassKey wallets confirm in the PassKey window when the action starts: no field here. -->
  <div v-if="!isPrfWallet" class="swap-field">
    <label class="t-caption" :for="id">{{ t('miniGero.spendingPassword') }}</label>
    <v-text-field
      :id="id"
      :model-value="modelValue"
      :type="show ? 'text' : 'password'"
      variant="outlined"
      density="compact"
      hide-details="auto"
      autocomplete="current-password"
      :placeholder="t('miniGero.enterPassword')"
      :append-inner-icon="show ? 'mdi-eye' : 'mdi-eye-off'"
      :disabled="disabled"
      data-test="swap-password"
      @update:model-value="value => emit('update:modelValue', value ?? '')"
      @click:append-inner="show = !show"
      @keydown.enter="emit('submit')"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, useId } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';

defineProps<{ modelValue: string; isPrfWallet: boolean; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void; (e: 'submit'): void }>();
const { t } = useTranslation();
const show = ref(false);
const id = useId();
</script>

<style scoped lang="scss">
.swap-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
