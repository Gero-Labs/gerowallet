<template>
  <BaseDialog
    :isOpen="isOpen"
    :title="t('midnight.shieldConvert.nativeNightPublic')"
    @close="emit('close')"
  >
    <p class="t-body">{{ t('midnight.shieldConvert.nativeConversionUnsupported') }}</p>
  </BaseDialog>
</template>

<script setup lang="ts">
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { useTranslation } from '@/shared/composables/useTranslation';

defineProps<{ isOpen: boolean }>();
const emit = defineEmits(['close']);
const { t } = useTranslation();
</script>
