<template>
  <BaseDialog
    :isOpen="props.isOpen"
    @close="$emit('close')"
    title="Swap"
    subtitle="Effortlessly exchange tokens directly from your wallet."
    :min-height="300"
    :width="550"
    :persistent="false"
  >
    <v-card-text class="text-center justify-center pt-6" style="position: relative;">
      <SwapWidget @onSwap="$emit('close')"></SwapWidget>
    </v-card-text>
  </BaseDialog>
</template>
<script setup lang="ts">
import BaseDialog from "@/shared/dialogs/BaseDialog.vue";
import SwapWidget from '@/modules/swap/components/SwapWidget.vue';

interface Props {
  isOpen: boolean;
}
const props = defineProps<Props>();
const emit = defineEmits(['close']);
</script>
<style scoped>

</style>
