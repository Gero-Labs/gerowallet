<template>
  <!-- Display only: the approval's warnings, acknowledgements and Sign never read anything here. -->
  <section v-if="model" class="tx-approval-flow glass-tier" data-testid="tx-approval-flow">
    <button
      type="button"
      class="tx-approval-flow__toggle t-body-sm"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span>{{ title }}</span>
      <v-icon size="18">{{ open ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
    </button>
    <TxFlowDiagram
      v-if="open"
      :model="model"
      :token-info="tokenInfo"
      :currency-symbol="currencySymbol"
      :label="title"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import { useTranslation } from '@/shared/composables/useTranslation';
import TxFlowDiagram, { type FlowTokenInfo } from '@/shared/components/TxFlowDiagram.vue';
import { buildUnsignedTxFlow } from '@/shared/utils/txFlowUnsigned';
import type { ApprovalDeposits } from '@/shared/utils/txApprovalSummary';
import type { TxFlowModel } from '@/shared/utils/txFlow';

interface Props {
  /** The request's transaction, decoded from the CBOR the signer hashes; null when it did not parse */
  tx: Cardano.Tx | null | undefined;
  /** bech32 addresses of the wallet's payment and change keys */
  ownAddresses: ReadonlySet<string>;
  /** The same (proven) wallet UTxOs the approval summary is given */
  ownUtxos: readonly Cardano.Utxo[] | undefined;
  deposits?: ApprovalDeposits;
  tokenInfo: (unit: string) => FlowTokenInfo;
  currencySymbol: string;
}

const props = defineProps<Props>();
const { t } = useTranslation();

const open = ref(true);
const title = computed(() => t('transactions.flow.approvalAriaLabel'));

// Anything that does not build draws nothing: the summary and its warnings stand on their own.
const model = computed<TxFlowModel | null>(() => {
  try {
    return buildUnsignedTxFlow(props.tx, { ownAddresses: props.ownAddresses, ownUtxos: props.ownUtxos, deposits: props.deposits });
  } catch {
    return null;
  }
});
</script>

<style scoped lang="scss">
.tx-approval-flow {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
}

.tx-approval-flow__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: var(--g-text-2);
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
</style>
