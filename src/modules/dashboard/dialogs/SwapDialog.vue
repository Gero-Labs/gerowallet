<template>
  <BaseDialog
    :isOpen="props.isOpen"
    @close="$emit('close')"
    :title="t('swap.title')"
    :subtitle="t('swap.effortlesslyExchange')"
    :min-height="300"
    :width="550"
    :persistent="false"
    :img="assets.swapSvg"
    imgStyle="filter: brightness(0) saturate(100%) invert(100%) sepia(49%) saturate(2%) hue-rotate(47deg) brightness(118%) contrast(101%);"
  >
    <v-card-text class="text-center justify-center pt-6" style="position: relative;">
      <SwapWidget @onSwap="$emit('close')" :buy-token-unit="props.buyTokenUnit"></SwapWidget>
    </v-card-text>
  </BaseDialog>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from "@/shared/dialogs/BaseDialog.vue";
import SwapWidget from '@/modules/swap/components/SwapWidget.vue';
import assets from '@/utils/assets';

interface Props {
  isOpen: boolean;
  buyTokenUnit?: string;
}
const props = defineProps<Props>();
defineEmits(['close']);

const { t } = useTranslation();
</script>
<style scoped>

</style>
