<template>
  <BottomSheet
    :model-value="modelValue"
    :title="t('solana.sendTitle')"
    height="92%"
    :persistent="busy"
    :close-disabled="busy"
    @update:model-value="onUpdate"
  >
    <div class="solana-send-sheet">
      <SolanaSendForm :open="modelValue" in-panel @close="onUpdate(false)" @busy="busy = $event" />
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import BottomSheet from '../BottomSheet.vue';
import SolanaSendForm from '@/modules/transactions/components/SolanaSendForm.vue';
import { useTranslation } from '@/shared/composables/useTranslation';

/** Side panel host for Gero's own SOL send: the dashboard dialog's form in a sheet. */
defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const { t } = useTranslation();
const busy = ref(false);

function onUpdate(value: boolean): void {
  // Held while a PassKey ceremony or the send is in flight.
  if (!value && busy.value) return;
  emit('update:modelValue', value);
}
</script>

<style scoped lang="scss">
.solana-send-sheet {
  padding: 0 var(--g-s-4) var(--g-s-4);
}
</style>
