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
      <BitcoinTransactionDetails v-if="transactionInfo" :transaction-info="transactionInfo" />
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import BitcoinTransactionDetails from '@/modules/transactions/components/BitcoinTransactionDetails.vue';
import type { UnifiedTransaction } from '@/chains/bitcoin/bitcoinTransactionParser';

defineProps<{
  transactionInfo: UnifiedTransaction | null;
}>();

defineEmits(['close']);
</script>
