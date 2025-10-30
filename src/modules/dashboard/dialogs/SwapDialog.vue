<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="t('swap.title')"
    :subtitle="t('swap.effortlesslyExchange')"
    :min-height="300"
    :width="550"
    :persistent="false"
  >
    <v-card-text class="text-center justify-center pt-6">
      <SwapWidget @onSwap="$emit('close')"></SwapWidget>
    </v-card-text>
  </BaseDialog>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from "@/shared/dialogs/BaseDialog.vue";
import SwapWidget from '@/modules/swap/components/SwapWidget.vue';


const { t } = useTranslation();

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close']);
</script>

<style scoped></style>
