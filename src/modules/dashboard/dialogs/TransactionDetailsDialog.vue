<template>
  <BaseDialog :width="850"
    :isOpen="!!transactionInfo"
    @close="$emit('close')"
    :title="$t('transactions.transactionDetails')"
    :min-height="600"
    :height="600"
    :persistent="false"
  >
    <TransactionDetails :transaction-info="transactionInfo"></TransactionDetails>
  </BaseDialog>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import TransactionDetails from '@/shared/components/TransactionDetails.vue';

const { t } = useTranslation();

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
