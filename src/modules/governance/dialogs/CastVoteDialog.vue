<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="t('governance.castVote')"
    icon="mdi-vote-outline"
    :loading="loading || building"
    :min-height="360"
    :width="560"
    :subtitle="t('governance.castVoteSubtitle')"
    :persistent="false"
  >
    <v-card-text class="px-4 pt-2 pb-3 cast-vote" style="z-index: 1">
      <!-- A vote for one of these actions is already in flight. Scan ALL
           pending txs (currentDrepTxIsPending pattern), never just the first. -->
      <div v-if="voteTxIsPending" class="cast-vote__banner cast-vote__banner--pending">
        <v-progress-circular indeterminate size="14" width="2" class="mr-2" />
        <span class="t-caption">{{ t('governance.votePending') }}</span>
      </div>

      <!-- Capability gate: when this wallet type cannot complete the flow, say
           why and disable confirm — never let the signing layer throw. -->
      <div v-if="!capability.canVote" class="cast-vote__banner cast-vote__banner--blocked">
        <v-icon small class="mr-2" color="var(--g-warning)">mdi-alert-circle-outline</v-icon>
        <span class="t-caption">{{ t(capability.reasonKey || 'governance.watchWalletReadOnly') }}</span>
      </div>

      <!-- Which selected actions the liveness pre-check dropped, and why. The
           user must see exactly what fell out of the batch before signing. -->
      <div v-for="(notice, i) in droppedNotices" :key="`dropped-${i}`" class="cast-vote__banner cast-vote__banner--blocked">
        <v-icon small class="mr-2" color="var(--g-warning)">mdi-minus-circle-outline</v-icon>
        <span class="t-caption">{{ notice }}</span>
      </div>

      <!-- Phase 1: pick a choice PER ACTION (one blanket choice for a batch is a footgun). -->
      <template v-if="phase === 'choose'">
        <p v-if="actions.length > 1" class="t-caption cast-vote__hint">{{ t('governance.chooseVoteForEachAction') }}</p>
        <div v-for="action in actions" :key="action.govActionId" class="cast-vote__action">
          <div class="cast-vote__action-info">
            <span class="t-label cast-vote__action-type">{{ typeLabel(action.type) }}</span>
            <span class="t-body-2 cast-vote__action-title">{{ actionTitle(action) }}</span>
            <span class="g-mono t-caption cast-vote__action-id">{{ truncate(displayId(action)) }}</span>
          </div>
          <div class="cast-vote__choices" role="group">
            <GButton
              v-for="choice in CHOICES"
              :key="choice"
              compact
              :class="{ 'cast-vote__choice--selected': choices[action.govActionId] === choice }"
              :aria-pressed="choices[action.govActionId] === choice ? 'true' : 'false'"
              @click="setChoice(action.govActionId, choice)"
            >
              {{ choiceLabel(choice) }}
            </GButton>
          </div>
        </div>

        <div class="cast-vote__meta">
          <span class="t-caption cast-vote__meta-label">{{ t('governance.votingPower') }}</span>
          <span class="t-body-2 g-num cast-vote__meta-value">{{ votingPowerDisplay }}</span>
        </div>

        <div v-if="buildError" class="cast-vote__banner cast-vote__banner--blocked">
          <v-icon small class="mr-2" color="var(--g-error)">mdi-alert-circle-outline</v-icon>
          <span class="t-caption">{{ buildError }}</span>
        </div>

        <div class="cast-vote__cta">
          <GButton
            tier="primary"
            :disabled="!allChosen || !capability.canVote || building"
            :loading="building"
            @click="proceed()"
          >
            {{ t('governance.reviewVote') }}
          </GButton>
        </div>
        <p v-if="building" class="t-caption cast-vote__hint cast-vote__hint--center">{{ t('governance.checkingActions') }}</p>
      </template>

      <!-- Phase 2: what you are about to sign, then the shared auth path. -->
      <template v-else>
        <div class="cast-vote__summary-head">
          <GButton tier="tertiary" compact @click="backToChoices()">
            <v-icon small class="mr-1">mdi-arrow-left</v-icon>
            {{ t('governance.back') }}
          </GButton>
          <span class="t-heading">{{ actions.length > 1 ? t('governance.yourVotes') : t('governance.yourVote') }}</span>
        </div>

        <div v-for="intent in intents" :key="intent.govActionId" class="cast-vote__summary-row">
          <span class="t-body-2 cast-vote__summary-title">{{ intentTitle(intent.govActionId) }}</span>
          <span class="t-body-2 cast-vote__summary-choice" :class="`cast-vote__summary-choice--${intent.choice.toLowerCase()}`">
            {{ choiceLabel(intent.choice) }}
          </span>
        </div>

        <div class="cast-vote__meta">
          <span class="t-caption cast-vote__meta-label">{{ t('governance.votingPower') }}</span>
          <span class="t-body-2 g-num cast-vote__meta-value">{{ votingPowerDisplay }}</span>
        </div>
        <div class="cast-vote__meta">
          <span class="t-caption cast-vote__meta-label">{{ t('governance.txFee') }}</span>
          <span class="t-body-2 g-num cast-vote__meta-value">{{ feeDisplay }}</span>
        </div>

        <v-form ref="form" v-model="valid" class="cast-vote__auth">
          <TransactionAuthSection
            :wallet-type="loggedWallet.type"
            :is-prf-wallet="isPrfWallet"
            :is-signed="isSubmit"
            :loading="loading"
            :password="spendingPassword"
            @update:password="spendingPassword = $event"
            :password-label="t('wallet.spendingPassword')"
            :password-rules="passwordRules"
            :submit-text="t('governance.submitTransaction')"
            submit-color="primary"
            :submit-elevation="0"
            :show-bt-toggle="loggedWallet.btSupported && !isSubmit"
            :is-b-t="isBT"
            @update:isBT="isBT = $event"
            :usb-text="t('governance.usb')"
            :bluetooth-text="t('governance.bluetooth')"
            @passkey-success="handlePassKeyAuthSuccess"
            @passkey-error="handlePassKeyAuthError"
            @autofill-success="handlePassKeySuccess"
            @autofill-error="handlePassKeyError"
            @submit="signAndSubmitVoteTx"
            @enter="signAndSubmitVoteTx"
            @password-field-ref="setPasswordFieldRef"
          />
          <!-- PRF wallets sign through the auth section above; everything else
               gets the explicit action button, mirroring DRepDelegateDialog. -->
          <v-btn
            v-if="!isPrfWallet"
            color="primary"
            elevation="0"
            @click="signAndSubmitVoteTx"
            height="40"
            :disabled="loading || !capability.canVote"
            :loading="loading"
            class="mx-2"
          >
            {{ isSubmit ? t('governance.submitTransaction') : t('governance.signAndVote') }}
          </v-btn>
        </v-form>
      </template>
    </v-card-text>
    <!-- No KeystoneSignDialog here on purpose: the capability matrix reports
         canVote: false for Keystone (the extra-signer scan misses
         dRepCredential), so the flow is blocked before signing is reachable. -->
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, watch } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import { useVoting } from '@/shared/composables/useVoting';
import { checkActionsStillOpen } from '@/modules/governance/dialogs/voteLiveness';
import type { VoteChoice, VoteIntent } from '@/shared/utils/voteBuilder';
import { toLovelace } from '@/shared/utils/lovelace';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import blockchainApi from '@/api/blockchain-api';
import { walletStore } from '@/stores/walletStore';
import { isCardanoTx } from '@/models/transaction.types';
import type { GovProposal } from '@/api/governance.types';
import { debugLog } from '@/utils/debug';

const { t } = useTranslation();
const { toCurrency, truncate } = filters;

const CHOICES: VoteChoice[] = ['Yes', 'No', 'Abstain'];

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  /** The actions being voted on — one entry for a single vote, several for a batch. */
  actions: {
    type: Array as () => GovProposal[],
    default: () => [],
  },
});

const emit = defineEmits(['close', 'submitted']);

const { loggedWallet, transactions: txs, keys } = toRefs(walletStore);

const { capability, castVotes } = useVoting();

// ---------------------------------------------------------------------------
// Per-action choices
// ---------------------------------------------------------------------------

const choices = ref<Record<string, VoteChoice | null>>({});
const phase = ref<'choose' | 'sign'>('choose');
const building = ref(false);
const buildError = ref('');
const builtTx = ref<Cardano.Tx | undefined>(undefined);
const intents = ref<VoteIntent[]>([]);
/** Translated liveness-check drop notices — who fell out of the batch, and why. */
const droppedNotices = ref<string[]>([]);

const allChosen = computed(
  () => props.actions.length > 0 && props.actions.every(action => !!choices.value[action.govActionId]),
);

function setChoice(govActionId: string, choice: VoteChoice): void {
  // Replace the object so Vue 2 reactivity always sees new keys.
  choices.value = { ...choices.value, [govActionId]: choice };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function typeLabel(type: string): string {
  const key = `governance.actionType.${String(type).toLowerCase()}`;
  const translated = String(t(key));
  return translated === key ? String(type) : translated;
}

function choiceLabel(choice: VoteChoice): string {
  const key = { Yes: 'common.yes', No: 'common.no', Abstain: 'governance.abstain' }[choice];
  return String(t(key));
}

function displayId(action: GovProposal): string {
  return `${action.txHash}#${action.index}`;
}

function actionTitle(action: GovProposal): string {
  return action.title || `${String(action.txHash).slice(0, 10)}…#${action.index}`;
}

function intentTitle(govActionId: string): string {
  const action = props.actions.find(item => displayId(item) === govActionId);
  return action ? actionTitle(action) : truncate(govActionId);
}

// ---------------------------------------------------------------------------
// Voting power (the wallet's own DRep record)
// ---------------------------------------------------------------------------

const votingPowerLovelace = ref<bigint | null>(null);

const currencySymbol = computed(() =>
  networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network),
);

const votingPowerDisplay = computed(() => {
  if (votingPowerLovelace.value === null) return String(t('common.notAvailable'));
  return toCurrency(votingPowerLovelace.value.toString(), false, 0, currencySymbol.value, '', true);
});

const feeDisplay = computed(() =>
  toCurrency(builtTx.value?.body?.fee?.toString() || '0', false, 0, currencySymbol.value),
);

async function loadVotingPower(): Promise<void> {
  votingPowerLovelace.value = null;
  const drepId = keys.value?.drep129?.[0]?.address;
  if (!drepId || !loggedWallet.value) return;
  try {
    const record = await blockchainApi.getDRepById(drepId, loggedWallet.value.chain, loggedWallet.value.network);
    if (record && record.amount !== undefined && record.amount !== null) {
      votingPowerLovelace.value = toLovelace(record.amount);
    }
  } catch (error) {
    // Voting power is informational — its outage must not block the vote.
    debugLog('CastVoteDialog: could not load DRep voting power', error);
  }
}

// ---------------------------------------------------------------------------
// Optimistic pending state — scan ALL pending txs for a vote on these actions
// (the all-pending-tx scan pattern shared with MyGovernance).
// ---------------------------------------------------------------------------

const actionKeySet = computed(() => new Set(props.actions.map(action => displayId(action))));

const voteTxIsPending = computed(() =>
  (txs.value ?? []).some(
    tx =>
      tx.pending &&
      isCardanoTx(tx) &&
      (tx.body?.votingProcedures ?? []).some(group =>
        (group.votes ?? []).some(vote =>
          actionKeySet.value.has(`${vote.actionId.id}#${vote.actionId.actionIndex}`),
        ),
      ),
  ),
);

// ---------------------------------------------------------------------------
// Build → sign → submit (signing stays on the shared path)
// ---------------------------------------------------------------------------

const txRef = computed(() => builtTx.value);

const {
  loading,
  spendingPassword,
  isSubmit,
  isBT,
  valid,
  passwordRules,
  isPrfWallet,
  handleSign,
  resetState,
  handlePassKeySuccess,
  handlePassKeyError,
  handlePassKeyAuthSuccess,
  handlePassKeyAuthError,
  setPasswordFieldRef,
} = useTransactionSigning({
  tx: txRef,
  successMessageKey: 'governance.voteTxSubmitted',
  onSuccess: (txId: string) => emit('submitted', txId),
  onClose: () => emit('close'),
});

const form = ref<{ validate: () => boolean; resetValidation: () => void } | null>(null);

function statusLabel(status: string | undefined): string {
  const key = `governance.status.${String(status ?? '').toLowerCase()}`;
  const translated = String(t(key));
  return translated === key ? String(status ?? '') : translated;
}

async function proceed(): Promise<void> {
  if (!allChosen.value || !capability.value.canVote || building.value) return;
  building.value = true;
  buildError.value = '';
  droppedNotices.value = [];
  try {
    // LIVENESS PRE-CHECK: a multi-vote tx is all-or-nothing, so re-fetch every
    // selected action IMMEDIATELY before building and drop any no longer open
    // — telling the user exactly which were dropped and why — rather than
    // letting one expired action take the whole batch down on chain.
    let open;
    try {
      const result = await checkActionsStillOpen(props.actions, String(loggedWallet.value?.network ?? ''));
      open = result.open;
      droppedNotices.value = result.dropped.map(item =>
        String(
          item.reasonKey === 'governance.actionDroppedNotOpen'
            ? t(item.reasonKey, { title: actionTitle(item.action), status: statusLabel(item.status) })
            : t(item.reasonKey, { title: actionTitle(item.action) }),
        ),
      );
    } catch (error) {
      debugLog('CastVoteDialog: liveness pre-check failed', error);
      buildError.value = String(t('governance.livenessCheckFailed'));
      return;
    }

    if (!open.length) {
      buildError.value = String(t('governance.allActionsDropped'));
      return;
    }

    const nextIntents = open.map(action => ({
      govActionId: displayId(action),
      choice: choices.value[action.govActionId] as VoteChoice,
    }));
    builtTx.value = await castVotes(nextIntents);
    intents.value = nextIntents;
    phase.value = 'sign';
  } catch (error) {
    debugLog('CastVoteDialog: vote build failed', error);
    buildError.value =
      error instanceof Error && error.message ? error.message : String(t('governance.errorBuildingTransaction'));
  } finally {
    building.value = false;
  }
}

function backToChoices(): void {
  phase.value = 'choose';
  builtTx.value = undefined;
  intents.value = [];
  resetState();
}

const signAndSubmitVoteTx = async (): Promise<void> => {
  // The capability gate disables every path to this handler for wallets that
  // cannot vote; this guard is the belt to that suspenders.
  if (!capability.value.canVote) return;
  await handleSign(form.value || undefined);
};

watch(
  () => props.isOpen,
  open => {
    if (open) {
      resetState();
      phase.value = 'choose';
      buildError.value = '';
      builtTx.value = undefined;
      intents.value = [];
      droppedNotices.value = [];
      choices.value = Object.fromEntries(props.actions.map(action => [action.govActionId, null]));
      void loadVotingPower();
      if (form.value) {
        form.value.resetValidation();
      }
    }
  },
);
</script>

<style scoped>
.cast-vote {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.cast-vote__banner {
  display: flex;
  align-items: center;
  padding: var(--g-s-2) var(--g-s-3);
  border-radius: var(--g-r-control);
  border: 1px solid var(--g-hairline-2);
  background: var(--g-raised);
  color: var(--g-text-2);
}
.cast-vote__banner--blocked {
  border-color: var(--g-warning-line);
  background: var(--g-warning-fill);
}
.cast-vote__hint {
  margin: 0;
  color: var(--g-text-3);
}
.cast-vote__hint--center {
  text-align: center;
}
.cast-vote__action {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-3);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
}
.cast-vote__action-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cast-vote__action-type {
  color: var(--g-text-3);
}
.cast-vote__action-title {
  color: var(--g-text-1);
  overflow-wrap: anywhere;
}
.cast-vote__action-id {
  color: var(--g-text-3);
}
.cast-vote__choices {
  display: flex;
  gap: var(--g-s-2);
  flex-wrap: wrap;
}
.cast-vote__choices .v-btn.g-btn.cast-vote__choice--selected {
  border-color: var(--g-accent);
  --g-btn-fg: var(--g-accent);
}
.cast-vote__meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.cast-vote__meta-label {
  color: var(--g-text-3);
}
.cast-vote__meta-value {
  color: var(--g-text-1);
}
.cast-vote__cta {
  display: flex;
  justify-content: center;
  padding-top: var(--g-s-2);
}
.cast-vote__summary-head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}
.cast-vote__summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) var(--g-s-3);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}
.cast-vote__summary-title {
  color: var(--g-text-2);
  min-width: 0;
  overflow-wrap: anywhere;
}
.cast-vote__summary-choice {
  flex-shrink: 0;
  color: var(--g-text-1);
}
.cast-vote__summary-choice--yes {
  color: var(--g-success);
}
.cast-vote__summary-choice--no {
  color: var(--g-error);
}
.cast-vote__summary-choice--abstain {
  color: var(--g-text-3);
}
.cast-vote__auth {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  padding-top: var(--g-s-2);
}
</style>
