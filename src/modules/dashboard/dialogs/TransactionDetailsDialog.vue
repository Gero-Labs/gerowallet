<template>
  <BaseDialog :isOpen="!!transactionInfo" @close="$emit('close')" title="Transaction Details" :min-height="600" :height="600">
    <TransactionDetails :transaction-info="transactionInfo"></TransactionDetails>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import TransactionDetails from '@/shared/components/TransactionDetails.vue';

export default {
  name: 'TransactionDetailsDialog',
  components: { TransactionDetails, BaseDialog },
  props: {
    transactionInfo: {
      type: Object,
      default: null,
    },
  },
};
</script>
<style scoped >

</style>
