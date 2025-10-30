<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    title="Swap"
    subtitle="Effortlessly exchange tokens directly from your wallet."
    :min-height="300"
    :width="550"
    :persistent="false"
  >
    <v-card-text class="text-center justify-center pt-6" style="position: relative;">
      <SwapWidget @onSwap="$emit('close')"></SwapWidget>

      <!-- Overlay when swap is disabled by feature flag -->
      <v-overlay
        v-if="!isSwapEnabled"
        absolute
        :value="true"
        opacity="0.8"
        color="#000000"
        z-index="999"
      >
        <div class="overlay-content">
          <v-icon size="64" color="warning">mdi-alert-circle-outline</v-icon>
          <h2 class="mt-4 white--text">Swap Under Maintenance</h2>
        </div>
      </v-overlay>
    </v-card-text>
  </BaseDialog>
</template>
<script setup lang="ts">
import BaseDialog from "@/shared/dialogs/BaseDialog.vue";
import SwapWidget from '@/modules/swap/components/SwapWidget.vue';

defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  isSwapEnabled: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['close']);
</script>

<style scoped>
.overlay-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
}

.overlay-content h2 {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
}
</style>
