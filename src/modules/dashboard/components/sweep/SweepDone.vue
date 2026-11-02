<template>
  <!-- What a sweep sent, once its payment is out: the dialog stays open on this instead
       of closing, since several transactions went out under the one approval. -->
  <div class="sweep-done">
    <section class="glass-tier sweep-done__card" role="status">
      <span class="sweep-done__badge" aria-hidden="true">
        <v-icon size="28" color="var(--g-success)">mdi-check</v-icon>
      </span>
      <h3 class="t-heading sweep-done__title">{{ t('send.sweepDoneTitle') }}</h3>
      <span class="t-title g-num">{{ amount }}</span>
      <span class="g-mono sweep-done__to">{{ t('send.sweepDoneTo', { address: middle(address) }) }}</span>
      <div class="sweep-done__rule" aria-hidden="true"></div>
      <dl class="sweep-done__facts">
        <dt class="t-caption">{{ t('dashboard.transactions') }}</dt>
        <dd class="t-body-sm g-num sweep-done__value">{{ t('send.sweepDoneTransactions', { steps, merges }) }}</dd>
        <dt class="t-caption">{{ t('signTx.networkFee') }}</dt>
        <dd class="t-body-sm g-num sweep-done__value">{{ fee }}</dd>
        <dt class="t-caption">{{ t('dashboard.transactionId') }}</dt>
        <dd class="sweep-done__value sweep-done__id">
          <span class="g-mono">{{ middle(txId) }}</span>
          <CopyButton x-small :value="txId" color="var(--g-accent)" />
        </dd>
      </dl>
    </section>

    <v-btn
      v-if="explorerHref"
      variant="text"
      color="var(--g-accent)"
      class="sweep-done__explorer"
      :href="explorerHref"
      target="_blank"
      rel="noopener noreferrer"
    >
      {{ t('send.sweepViewOnExplorer') }}
      <v-icon size="14" class="ml-1" aria-hidden="true">mdi-open-in-new</v-icon>
    </v-btn>

    <p class="t-caption sweep-done__note">{{ t('send.sweepDoneNote') }}</p>

    <v-btn class="geroButton sweep-done__button" @click="emit('done')">{{ t('common.done') }}</v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useExplorer } from '@/shared/composables/useExplorer';
import CopyButton from '@/shared/components/CopyButton.vue';

const props = defineProps<{
  /** The payment's transaction id. */
  txId: string;
  /** What the recipient receives, formatted with the currency symbol. */
  amount: string;
  /** The recipient's address. */
  address: string;
  /** Transactions the send went out as: the merges plus the payment. */
  steps: number;
  /** Every transaction's fee together, formatted with the currency symbol. */
  fee: string;
}>();

const emit = defineEmits<{ (event: 'done'): void }>();

const { t } = useTranslation();
const { explorerUrl } = useExplorer();

const merges = computed(() => Math.max(0, props.steps - 1));
/** The payment on the wallet's chosen explorer; empty when that explorer has no transaction page. */
const explorerHref = computed(() => explorerUrl('tx', props.txId));

/** `addr1qy3z…9xq2`: enough of both ends to recognise, in one line. */
function middle(value: string): string {
  if (!value || value.length <= 20) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
</script>

<style scoped>
.sweep-done {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--g-s-4);
  padding: var(--g-s-2) 0 var(--g-s-1);
}

.sweep-done__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: var(--g-s-5) var(--g-s-4) var(--g-s-4);
  text-align: center;
}

.sweep-done__badge {
  width: 56px;
  height: 56px;
  box-sizing: border-box;
  border-radius: var(--g-r-pill);
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
  display: grid;
  place-items: center;
  margin-bottom: 6px;
}

.sweep-done__title {
  margin: 0;
}

.sweep-done__to {
  word-break: break-all;
}

.sweep-done__rule {
  align-self: stretch;
  height: 1px;
  background: var(--g-hairline-1);
  margin: 10px 0 var(--g-s-1);
}

.sweep-done__facts {
  align-self: stretch;
  margin: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  row-gap: var(--g-s-2);
  column-gap: var(--g-s-3);
  text-align: left;
}

.sweep-done__value {
  margin: 0;
  color: var(--g-text-1);
  text-align: right;
}

.sweep-done__id {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--g-s-1);
}

.sweep-done__explorer {
  align-self: center;
}

.sweep-done__note {
  margin: 0;
  text-align: center;
  line-height: 1.5;
}

.sweep-done__button {
  align-self: center;
  min-width: 200px;
}
</style>
