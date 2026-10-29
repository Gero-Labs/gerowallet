<template>
  <BottomSheet
    :model-value="modelValue"
    :title="t('programmableTokens.send.title', { token: tokenLabel })"
    height="85%"
    :persistent="busy"
    :close-disabled="busy"
    @update:model-value="onUpdate"
  >
    <div class="programmable-send-sheet">
      <!-- Keyed on the token so reopening for another token starts from a clean form. -->
      <ProgrammableSendFlow
        v-if="modelValue"
        :key="unit"
        :unit="unit"
        :ticker="ticker"
        :name="name"
        :decimals="decimals"
        @busy="busy = $event"
        @close="onUpdate(false)"
        @done="onUpdate(false)"
      />
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import BottomSheet from '../BottomSheet.vue';
import ProgrammableSendFlow from '@/shared/components/ProgrammableSendFlow.vue';
import { useTranslation } from '@/shared/composables/useTranslation';

/** Side panel host for Gero's own Send of a CIP-113 token (the HomePage token sheet). */
const props = defineProps<{
  modelValue: boolean;
  unit: string;
  ticker?: string;
  name?: string;
  decimals?: number;
}>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const { t } = useTranslation();
const busy = ref(false);
const tokenLabel = computed(() => props.ticker || props.name || '');

function onUpdate(value: boolean): void {
  if (!value && busy.value) return;
  emit('update:modelValue', value);
}
</script>

<style scoped lang="scss">
.programmable-send-sheet {
  padding: 0 var(--g-s-4) var(--g-s-4);
}
</style>
