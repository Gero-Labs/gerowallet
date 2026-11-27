<template>
  <div class="tx-flow-window">
    <header class="tx-flow-window__head">
      <h1 class="t-title">{{ $t('transactions.flow.ariaLabel') }}</h1>
      <div v-if="txId" class="tx-flow-window__id">
        <span class="g-mono t-caption">{{ filters.truncate(txId) }}</span>
        <CopyButton x-small :value="txId" />
      </div>
    </header>

    <TxFlowDiagram
      v-if="flowModel"
      :model="flowModel"
      :token-info="tokenInfo"
      :currency-symbol="currencySymbol"
    />
    <p v-else class="tx-flow-window__empty t-body">{{ $t('mempool.txNotFound') }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * Popup window with the transaction flow diagram, opened from the side panel's
 * transaction sheet (`#/tx-flow/<id>`), where the panel is too narrow for it.
 * Reads the logged wallet's own stored record; a transaction it does not hold
 * (another wallet now logged in) shows "not found".
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import CopyButton from '@/shared/components/CopyButton.vue';
import TxFlowDiagram from '@/shared/components/TxFlowDiagram.vue';
import { useTxFlow } from '@/shared/composables/useTxFlow';
import { walletStore } from '@/stores/walletStore';
import filters from '@/shared/utils/filters';

const route = useRoute();
const txId = computed(() => String(route.params['id'] ?? ''));
// OX Agent: [javascript-authorization-security] The id from the URL is looked up only in the logged wallet's own records
const tx = computed(() => (walletStore.transactions ?? []).find((stored) => stored.id === txId.value) ?? null);
const { flowModel, tokenInfo, currencySymbol } = useTxFlow(tx);
</script>

<style scoped lang="scss">
.tx-flow-window {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  align-self: flex-start;
  width: 100%;
  min-height: 100vh;
  padding: var(--g-s-5);
  box-sizing: border-box;
  background: var(--g-canvas);
}

.tx-flow-window__head {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.tx-flow-window__head h1 {
  margin: 0;
  color: var(--g-text-1);
}

.tx-flow-window__id {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  color: var(--g-text-3);
}

.tx-flow-window__empty {
  margin: 0;
  color: var(--g-text-3);
}
</style>
