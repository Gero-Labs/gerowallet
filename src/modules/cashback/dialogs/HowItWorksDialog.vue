<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="$t('cashback.howItWorks')"
    subtitle=""
    :min-height="560"
    :height="560"
    :width="604"
    :persistent="false"
  >
    <v-card-text class="px-0 pt-2 pb-0" style="z-index: 3; color: white">
      {{ $t('cashback.howItWorksStep1') }}<br>
      <br>
      {{ $t('cashback.howItWorksStep2') }}<br>
      <br>
      {{ $t('cashback.howItWorksStep3') }}<br>
      <br>
      {{ $t('cashback.howItWorksStep4') }}<br>
      <br>
      {{ $t('cashback.howItWorksStep5') }}<br>
      <br>
      {{ $t('cashback.howItWorksNote') }}
    </v-card-text>
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  }
});

const emit = defineEmits(['close']);

const loading = ref(true);
const disabled = ref(true);

watch(() => props.isOpen, (val) => {
  if (val) {
    loading.value = true;
  }
});
</script>
<style scoped>

.card-text {
  width: 100%;
  padding: 24px;
  background: linear-gradient(90deg, rgb(0, 14, 17), rgb(0, 19, 16));
  border-radius: 12px;
  border: 1px solid #00DFF3;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

::-webkit-scrollbar {
  width: 14px;
}

::-webkit-scrollbar-thumb {
  border: 4px solid rgba(0, 0, 0, 0);
  background-clip: padding-box;
}

/* Handle on hover */
::-webkit-scrollbar-thumb:hover {
  border: 4px solid rgba(0, 0, 0, 0);
  background-clip: padding-box;
}
</style>
