<template>
  <BottomSheet :value="value" @input="$emit('input', $event)" :title="$t('miniGero.perpsTitle')" height="55%">
    <div class="perps-sheet">
      <div class="perps-placeholder">
        <v-icon size="64" color="#2a2a2a">mdi-chart-line</v-icon>
        <div class="text-h6 white--text mt-4">{{ $t('miniGero.perpsComingSoon') }}</div>
        <div class="text-body-2 grey--text mt-2 text-center">
          {{ $t('miniGero.perpsDesc') }}
        </div>
      </div>

      <v-btn
        block
        outlined
        color="#00c7f3"
        class="mt-6"
        @click="openDashboard"
      >
        <v-icon left small>mdi-open-in-new</v-icon>
        {{ $t('miniGero.openInDashboard') }}
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

function openDashboard() {
  const optionsUrl = chrome.runtime.getURL('index.html#/dashboard');
  window.open(optionsUrl, '_blank');
}
</script>

<style scoped>
.perps-sheet {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
}

.perps-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 16px;
}
</style>
