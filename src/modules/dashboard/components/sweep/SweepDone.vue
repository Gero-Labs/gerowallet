<template>
  <!-- What a sweep sent, once its payment is out: the dialog stays open on this instead
       of closing, since several transactions went out under the one approval. -->
  <div class="sweep-done">
    <section class="glass-tier sweep-done__card" role="status">
      <span class="sweep-done__badge" aria-hidden="true">
        <v-icon size="28" color="var(--g-success)">mdi-check</v-icon>
      </span>
      <!-- Takes focus on mount: the button the user pressed unmounted with the stepper.
           The dialog's title is not a heading, so this is the outline's first level. -->
      <h2 ref="title" class="t-heading sweep-done__title" tabindex="-1">{{ t('send.sweepDoneTitle') }}</h2>
      <span class="t-title g-num">{{ amount }}</span>
      <span class="g-mono sweep-done__to">{{ recipientLine }}</span>
      <div class="sweep-done__rule" aria-hidden="true"></div>
      <dl class="sweep-done__facts">
        <dt class="t-caption">{{ t('dashboard.transactions') }}</dt>
        <dd class="t-body-sm g-num sweep-done__value">{{ tc('send.sweepDoneTransactions', merges, { steps, merges }) }}</dd>
        <dt class="t-caption">{{ t('signTx.networkFee') }}</dt>
        <dd class="t-body-sm g-num sweep-done__value">{{ fee }}</dd>
        <dt class="t-caption">{{ t('dashboard.transactionId') }}</dt>
        <dd class="sweep-done__value sweep-done__id">
          <span class="g-mono">{{ truncate(txId) }}</span>
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
import { computed, onMounted, useTemplateRef } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useExplorer } from '@/shared/composables/useExplorer';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';

const props = defineProps<{
  /** The payment's transaction id. */
  txId: string;
  /** What the recipients received together, formatted with the currency symbol. */
  amount: string;
  /** The one recipient's address; ignored when the payment went to several. */
  address: string;
  /** Distinct addresses the payment paid. */
  recipients: number;
  /** Transactions the send went out as: the merges plus the payment. */
  steps: number;
  /** Every transaction's fee together, formatted with the currency symbol. */
  fee: string;
}>();

const emit = defineEmits<{ (event: 'done'): void }>();

const { t, tc } = useTranslation();
const { explorerUrl } = useExplorer();
const { truncate } = filters;

const title = useTemplateRef<HTMLHeadingElement>('title');
onMounted(() => title.value?.focus());

const merges = computed(() => Math.max(0, props.steps - 1));
const recipientLine = computed(() => (props.recipients > 1
  ? t('send.sweepDoneToMany', { count: props.recipients })
  : t('send.sweepDoneTo', { address: truncate(props.address) })));
/** The payment on the wallet's chosen explorer; empty when that explorer has no transaction page. */
const explorerHref = computed(() => explorerUrl('tx', props.txId));
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
  gap: var(--g-s-2);
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
  margin-bottom: var(--g-s-2);
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
  margin: var(--g-s-2) 0 var(--g-s-1);
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
