<template>
  <BaseDialog :isOpen="!!transactionInfo" @close="$emit('close')" title="Transaction Details" :min-height="600" :height="600">
    <TransactionDetails :transaction-info="transactionInfo"></TransactionDetails>
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
<style scoped >

</style>
