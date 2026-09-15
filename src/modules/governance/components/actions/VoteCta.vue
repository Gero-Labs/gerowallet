<template>
  <!-- Nothing renders unless the voting sub-flag is on AND the action is still
       open — a vote affordance on a closed action would be a lie. -->
  <div v-if="visible" class="vote-cta">
    <GButton tier="primary" :disabled="!canVoteNow" @click="$emit('vote')">
      {{ $t('governance.vote') }}
    </GButton>
    <span v-if="reason" class="t-caption vote-cta__reason">{{ reason }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import { useVoting } from '@/shared/composables/useVoting';
import { isOpen } from '@/shared/utils/govLifecycle';
import { isCardanoTx } from '@/models/transaction.types';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { GovProposal } from '@/api/governance.types';

const { t } = useTranslation();

const props = defineProps({
  action: {
    type: Object as () => GovProposal | null,
    default: null,
  },
});

defineEmits(['vote']);

const { keys, transactions: txs } = toRefs(walletStore);
const { capability } = useVoting();

// drep129 is an array like every other key list; a watch wallet has an empty
// one — guard it, never index blindly (same guard the DRep views use).
const drepId = computed(() => keys.value?.drep129?.[0]?.address ?? '');

const visible = computed(
  () =>
    featureFlagsStore.isGovernanceVotingEnabled() &&
    !!props.action &&
    isOpen(props.action.status),
);

// Scan ALL pending txs for a vote on THIS action (the currentDrepTxIsPending
// pattern) — a pending send sorting ahead of the vote must not hide it.
const voteTxIsPending = computed(() => {
  const action = props.action;
  if (!action) return false;
  return (txs.value ?? []).some(
    tx =>
      tx.pending &&
      isCardanoTx(tx) &&
      (tx.body?.votingProcedures ?? []).some(group =>
        (group.votes ?? []).some(
          vote => String(vote.actionId.id) === action.txHash && vote.actionId.actionIndex === action.index,
        ),
      ),
  );
});

const canVoteNow = computed(
  () => !!drepId.value && capability.value.canVote && !voteTxIsPending.value,
);

/** Why the button is disabled, translated — empty when it is enabled. */
const reason = computed(() => {
  if (canVoteNow.value) return '';
  if (voteTxIsPending.value) return String(t('governance.votePending'));
  if (!drepId.value) return String(t('governance.drepRequiredToVote'));
  return String(t(capability.value.reasonKey || 'governance.watchWalletReadOnly'));
});
</script>

<style scoped>
.vote-cta {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}
.vote-cta__reason {
  color: var(--g-text-3);
}
</style>
