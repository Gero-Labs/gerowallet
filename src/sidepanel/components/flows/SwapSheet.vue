<template>
  <BottomSheet :value="value" @input="$emit('input', $event)" :title="$t('miniGero.swapTokens')" height="65%">
    <div class="swap-sheet">
      <div class="swap-placeholder">
        <v-icon size="64" color="#2a2a2a">mdi-swap-horizontal-circle-outline</v-icon>
        <div class="text-h6 white--text mt-4">{{ $t('miniGero.swapTokens') }}</div>
        <div class="text-body-2 grey--text mt-2 text-center">
          {{ $t('miniGero.swapComingSoon') }}
        </div>
      </div>

      <v-btn
        block
        outlined
        color="#00c7f3"
        class="mt-6"
        @click="openDashboardSwap"
      >
        <v-icon left small>mdi-open-in-new</v-icon>
        {{ $t('miniGero.openSwapDashboard') }}
      </v-btn>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import BottomSheet from '../BottomSheet.vue';

defineProps<{
  value: boolean;
}>();

defineEmits<{
  (e: 'input', value: boolean): void;
}>();

function openDashboardSwap() {
  const optionsUrl = chrome.runtime.getURL('index.html#/swap');
  window.open(optionsUrl, '_blank');
}
</script>

<style scoped>
.swap-sheet {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
}

.swap-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 16px;
}
</style>
