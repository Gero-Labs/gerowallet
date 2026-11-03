<template>
  <!-- Merges the wallet into its own address before a swap its small UTxOs cannot carry. The
       merge is built when the dialog opens, so its transactions and fee are on screen before
       the user approves it; it is signed once and sent like a Quick Send sweep. -->
  <BaseDialog
    :isOpen="open"
    :title="t('swap.mergeTitle')"
    :subtitle="t('swap.mergeSubtitle')"
    size="sm"
    :min-height="0"
    :persistent="busy"
    @close="close"
  >
    <div class="swap-merge">
      <template v-if="!sent">
        <section class="glass-tier swap-merge__plan" :aria-busy="planned ? 'false' : 'true'">
          <p class="t-body-sm swap-merge__explain">{{ t('swap.mergeExplain', { count: utxoCount }) }}</p>
          <dl class="swap-merge__figures">
            <dt class="t-caption">{{ t('swap.mergeTransactions') }}</dt>
            <dd class="t-body-sm g-num">
              <span v-if="plan">{{ plan.steps }}</span>
              <span v-else class="g-skeleton swap-merge__skeleton" aria-hidden="true"></span>
            </dd>
            <dt class="t-caption">{{ t('signTx.networkFee') }}</dt>
            <dd class="t-body-sm g-num">
              <span v-if="plan">{{ plan.fee }}</span>
              <span v-else class="g-skeleton swap-merge__skeleton" aria-hidden="true"></span>
            </dd>
          </dl>
          <template v-if="preparing">
            <div
              class="swap-merge__track"
              role="progressbar"
              :aria-label="preparingCount"
              aria-valuemin="0"
              :aria-valuemax="preparing.total"
              :aria-valuenow="preparing.built"
            >
              <div class="swap-merge__fill" :style="{ width: fillWidth }"></div>
            </div>
            <p class="t-caption g-num swap-merge__note">{{ preparingCount }}</p>
          </template>
        </section>

        <p v-if="planError" class="t-caption swap-merge__error" role="alert">{{ planError }}</p>
        <p v-if="progressText" class="t-caption swap-merge__note" aria-live="polite">{{ progressText }}</p>
        <p v-if="stopText" class="t-caption swap-merge__error" role="alert">{{ stopText }}</p>

        <CardSignSection
          ref="signSection"
          :label="t('swap.mergeApprove')"
          :prepare="prepare"
          :disabled="!planned || !!planError"
          :prerequisites="prerequisites"
          @busy="busy = $event"
          @progress="onProgress"
          @interrupted="stop = $event"
          @submitted="onSubmitted"
        />
      </template>

      <template v-else>
        <p class="t-body-sm swap-merge__explain" role="status">{{ t('swap.mergeSent') }}</p>
        <GButton tier="primary" block @click="close">{{ t('common.done') }}</GButton>
      </template>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import { useTranslation } from '@/shared/composables/useTranslation';
import { usePaymentSweep } from '@/shared/composables/usePaymentSweep';
import type { SweepProgress, SweepStop } from '@/shared/composables/useTransactionSigning';
import { paymentUtxos } from '@/shared/utils/pendingSpends';
import { formatAda } from '@/shared/utils/format';
import { friendlyTxError } from '@/shared/utils/txErrors';
import { walletStore } from '@/stores/walletStore';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import CardSignSection from '@/modules/wallet/components/ui/CardSignSection.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  /** The merge went out: its last transaction, which the wallet holds once it lands. */
  (e: 'merged', txId: string): void;
}>();

const { t, tc } = useTranslation();

const paymentSweep = usePaymentSweep();
const { preparing, prerequisites } = paymentSweep;
const signSection = ref<{ reset: () => void; canSweep: boolean } | null>(null);
const busy = ref(false);
const utxoCount = ref(0);
/** The merge's last transaction, built when the dialog opened. */
const planned = shallowRef<Cardano.Tx | null>(null);
const planError = ref<string | null>(null);
const progress = ref<SweepProgress | null>(null);
const stop = ref<SweepStop | null>(null);
const sent = ref(false);
/** Bumped when the dialog closes: a plan still being built for it no longer counts. */
let planEpoch = 0;

function spendable(): Cardano.Utxo[] {
  return paymentUtxos((walletStore.utxos ?? []) as Cardano.Utxo[], walletStore.collateral as Cardano.Utxo | null | undefined, walletStore.transactions);
}

/** What the user approves: how many transactions, and their fees together. */
const plan = computed(() => {
  const tx = planned.value;
  if (!tx) return null;
  const built = paymentSweep.sweep.value;
  const fee = (built?.mergeFee ?? 0n) + BigInt(tx.body.fee);
  return { steps: (built?.merges.length ?? 0) + 1, fee: formatAda(fee) };
});

const preparingCount = computed(() => {
  const state = preparing.value;
  return state ? tc('send.sweepPreparingCount', state.total, { built: state.built, total: state.total }) : '';
});
const fillWidth = computed(() => {
  const state = preparing.value;
  return state && state.total > 0 ? `${Math.round((state.built / state.total) * 100)}%` : '0%';
});

const progressText = computed(() => {
  const state = progress.value;
  if (!state) return '';
  if (state.phase === 'signing') return t('send.sweepSigning', { step: state.step, total: state.total });
  if (state.phase === 'sending') return t('send.sweepSending', { step: state.step, total: state.total });
  return t('send.sweepWaiting');
});
const stopText = computed(() => (stop.value
  ? `${t('send.sweepStoppedTitle', { step: stop.value.step, total: stop.value.total })} ${stop.value.reason}`
  : ''));

async function buildPlan(): Promise<void> {
  const epoch = planEpoch;
  const utxos = spendable();
  utxoCount.value = utxos.length;
  try {
    const tx = await paymentSweep.consolidate(utxos);
    if (epoch !== planEpoch) return;
    planned.value = tx;
    // Only software signers give the one approval a sweep needs.
    if (paymentSweep.sweep.value && signSection.value?.canSweep === false) planError.value = t('send.sweepSoftwareOnly');
  } catch (error) {
    if (epoch === planEpoch) planError.value = friendlyTxError(error);
  }
}

/** The transaction to sign: the planned one (a sweep keeps it, so a retry skips the merges already sent). */
function prepare(): Promise<Cardano.Tx> {
  return paymentSweep.consolidate(spendable());
}

function onProgress(state: SweepProgress | null): void {
  progress.value = state;
  if (state) stop.value = null;
}

function onSubmitted(txId: string): void {
  sent.value = true;
  emit('merged', txId);
}

function reset(): void {
  planEpoch++;
  paymentSweep.reset();
  signSection.value?.reset();
  planned.value = null;
  planError.value = null;
  progress.value = null;
  stop.value = null;
  sent.value = false;
}

function close(): void {
  if (busy.value) return;
  reset();
  emit('close');
}

watch(() => props.open, (open) => {
  if (open) void buildPlan();
}, { immediate: true });
</script>

<style scoped>
.swap-merge {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.swap-merge__plan {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-3) var(--g-s-4);
}

.swap-merge__explain {
  margin: 0;
  line-height: 1.5;
  color: var(--g-text-1);
}

.swap-merge__figures {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  row-gap: var(--g-s-1);
  column-gap: var(--g-s-3);
  margin: 0;
}

.swap-merge__figures dd {
  margin: 0;
  text-align: right;
  color: var(--g-text-1);
}

/* Shimmer stand-ins sized like the figures they replace. */
.swap-merge__skeleton {
  display: inline-block;
  width: 72px;
  height: 12px;
}

/* The track is a control (a bar), so a solid surface is right here. */
.swap-merge__track {
  height: 8px;
  background: var(--g-raised);
  border-radius: var(--g-r-pill);
  overflow: hidden;
}

.swap-merge__fill {
  height: 100%;
  background: var(--g-accent);
  border-radius: var(--g-r-pill);
  transition: width var(--g-dur-base) var(--g-ease);
}

.swap-merge__note {
  margin: 0;
  color: var(--g-text-2);
}

.swap-merge__error {
  margin: 0;
  color: var(--g-error);
}
</style>
