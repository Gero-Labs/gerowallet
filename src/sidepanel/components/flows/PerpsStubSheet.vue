<template>
  <BottomSheet :value="value" @input="$emit('input', $event)" :title="$t('miniGero.perpsTitle')" height="55%">
    <div class="perps-sheet">
      <div class="perps-placeholder">
        <v-icon size="64" color="var(--g-text-3)">mdi-chart-line</v-icon>
        <div class="text-h6 mt-4" style="color: var(--g-text-1)">{{ $t('miniGero.perpsComingSoon') }}</div>
        <div class="text-body-2 mt-2 text-center" style="color: var(--g-text-3)">
          {{ $t('miniGero.perpsDesc') }}
        </div>
      </div>

      <v-btn
        block
        outlined
        :color="primaryColor"
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
import { computed } from 'vue';
import BottomSheet from '../BottomSheet.vue';
import { useChainContext } from '../../composables/useChainContext';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

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
