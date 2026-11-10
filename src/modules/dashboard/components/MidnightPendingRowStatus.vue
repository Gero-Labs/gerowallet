<template>
  <!-- A pending send that reads "Not confirmed" (midnightPendingSends.ts): kept
       through a reset, or past its time limit. Check again only when the row is
       keyed by its ledger hash (the only one the indexer can find); Dismiss
       always. While Midnight data is rebuilt the row is the last one the wallet
       knew, so the chip alone. Mount it for pending rows (and rows with a Check
       again outcome) only. -->
  <div v-if="unconfirmed || outcomeText" ref="root" class="pending-status" data-test="midnight-pending-status">
    <span v-if="unconfirmed" class="pending-status__chip t-caption" data-test="midnight-not-confirmed">{{ t('midnight.pending.notConfirmed') }}</span>
    <div v-if="unconfirmed && !compact && !refreshing" class="pending-status__actions">
      <!-- While checking it stays in place and keeps focus: held, busy, and saying so. -->
      <GButton
        v-if="lookupPossible"
        tier="tertiary"
        compact
        :aria-disabled="checking ? 'true' : undefined"
        :aria-busy="checking ? 'true' : undefined"
        :ripple="!checking"
        data-test="midnight-check-again"
        @click="onCheckAgain()"
      >{{ checking ? t('midnight.pending.checking') : t('midnight.pending.checkAgain') }}</GButton>
      <GButton tier="tertiary" compact data-test="midnight-dismiss-pending" @click="onDismiss()">{{ t('midnight.pending.dismiss') }}</GButton>
    </div>
    <!-- What Check again found, said once. -->
    <p class="pending-status__outcome t-caption" aria-live="polite" data-test="midnight-check-outcome">{{ outcomeText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMidnightPendingActions, usePendingClock } from '@/shared/composables/useMidnightPendingActions';
import { useMidnightRefresh } from '@/shared/composables/useMidnightRefresh';
import { canLookUpPending, isUnconfirmedPending } from '@/chains/midnight/midnightPendingSends';
import type { MidnightTransaction } from '@/chains/midnight/midnightTypes';

const props = withDefaults(defineProps<{
  tx: MidnightTransaction;
  /** The chip alone, where the row itself is a button (the full history list). */
  compact?: boolean;
}>(), { compact: false });

const { t } = useTranslation();
const now = usePendingClock();
const { stateOf, checkAgain, dismiss } = useMidnightPendingActions();
const { refreshing } = useMidnightRefresh();
const root = ref<HTMLElement | null>(null);

const unconfirmed = computed(() => isUnconfirmedPending(props.tx, now.value));
const lookupPossible = computed(() => canLookUpPending(props.tx));
const checking = computed(() => stateOf(props.tx).checking);
const outcomeText = computed(() => {
  if (refreshing.value) return '';
  switch (stateOf(props.tx).outcome) {
    // Not found, or found without its result yet: either way not confirmed.
    case 'notFound':
    case 'waiting': return t('midnight.pending.stillNotConfirmed');
    case 'confirmed': return t('midnight.pending.wentThrough');
    case 'failed': return t('midnight.pending.rejected');
    // The lookup itself failed: that says nothing about the send.
    case 'unknown': return t('midnight.pending.couldNotCheck');
    default: return '';
  }
});

function onCheckAgain(): void {
  if (checking.value) return;
  void checkAgain(props.tx);
}

/** Dismiss, then keep focus in the list: on its heading (the row is gone). */
async function onDismiss(): Promise<void> {
  const list = root.value?.closest<HTMLElement>('[data-pending-list]') ?? null;
  await dismiss(props.tx);
  await nextTick();
  const heading = list?.matches('[data-pending-list-heading]') ? list : list?.querySelector<HTMLElement>('[data-pending-list-heading]');
  heading?.focus();
}
</script>

<style scoped lang="scss">
.pending-status {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-top: var(--g-s-1);
}

/* A chip: the muted warning pair, the label in the warning colour, t-caption. */
.pending-status__chip {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-pill);
  font-weight: 550;
  white-space: nowrap;
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
}

.pending-status__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-1);
  margin: var(--g-s-1) 0 0 calc(-1 * var(--g-s-2));
}

/* The live region stays in the tree (so it is announced) and takes no room while empty. */
.pending-status__outcome {
  margin: 0;
  color: var(--g-text-2);
}

.pending-status__outcome:not(:empty) {
  margin-top: var(--g-s-1);
}
</style>
