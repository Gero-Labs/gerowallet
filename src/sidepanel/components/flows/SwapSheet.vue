<template>
  <BottomSheet :value="value" @input="onSheetInput" :title="$t('miniGero.swapTitle')" height="68%" persistent>
    <div class="swap-sheet">
      <!-- ═══════ MAINTENANCE OVERLAY (isSwapEnabled gate, preserved from the old flow) ═══════ -->
      <div v-if="!isSwapEnabled" class="maintenance-overlay">
        <v-icon size="56" color="warning">mdi-alert-circle-outline</v-icon>
        <div class="text-h6 white--text mt-3">{{ $t('miniGero.swapMaintenance') }}</div>
      </div>

      <GeroSwapEmbed v-else context="sidepanel" />
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BottomSheet from '../BottomSheet.vue';
import GeroSwapEmbed from '@/modules/swap/components/GeroSwapEmbed.vue';
import featureFlagsStore from '@/stores/featureFlagsStore';

defineProps<{ value: boolean }>();
const emit = defineEmits<{ (e: 'input', value: boolean): void }>();

const isSwapEnabled = computed(() => featureFlagsStore.isSwapEnabled());

function onSheetInput(val: boolean) {
  emit('input', val);
}
</script>

<style scoped>
.swap-sheet {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.maintenance-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  text-align: center;
}
</style>
