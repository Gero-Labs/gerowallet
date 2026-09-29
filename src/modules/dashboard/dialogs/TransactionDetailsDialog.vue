<template>
  <BaseDialog
    size="lg"
    :isOpen="!!transactionInfo"
    @close="$emit('close')"
    :title="$t('transactions.transactionDetails')"
    :min-height="0"
    :height="860"
  >
    <!-- v-card-text is the scroll region of a scrollable BaseDialog -->
    <v-card-text class="pa-0 pt-4">
      <TransactionDetails v-if="transactionInfo" :transaction-info="transactionInfo" />
    </v-card-text>
  </BaseDialog>
</template>
<script setup lang="ts">
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import TransactionDetails from '@/shared/components/TransactionDetails.vue';

defineProps({
  transactionInfo: {
    type: Object,
    default: null,
  },
});

defineEmits(['close']);
</script>
