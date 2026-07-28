<template>
  <v-dialog v-model="dialog" max-width="550px" persistent>
    <v-card>
      <v-card-title>
        {{ isUpdate ? $t('poolOperator.updatePool') : $t('poolOperator.registerPool') }}
        <v-spacer />
        <v-btn icon @click="close" :disabled="signing.loading.value">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text>
        <!-- Transaction Summary -->
        <v-card outlined class="mb-4 pa-3">
          <div class="text-caption grey--text mb-2">{{ $t('poolOperator.poolId') }}</div>
          <div class="monospace-text text-body-2 mb-3">{{ poolOperatorStore.poolId }}</div>

          <div v-if="tx" class="d-flex justify-space-between text-body-2 mb-1">
            <span class="grey--text">{{ $t('common.fee') }}</span>
            <span>{{ formatFee }} ADA</span>
          </div>
          <div v-if="!isUpdate" class="d-flex justify-space-between text-body-2">
            <span class="grey--text">{{ $t('poolOperator.deposit') }}</span>
            <span>500 ADA</span>
          </div>
        </v-card>

        <!-- Signing Section -->
        <div v-if="!signing.isSubmit.value">
          <!-- Password / PRF flow for software wallets -->
          <div v-if="!isLedger">
            <v-text-field
              v-if="!signing.isPrfWallet.value"
              v-model="signing.spendingPassword.value"
              :label="$t('wallet.spendingPassword')"
              type="password"
              outlined
              dense
              hide-details
              class="mb-4"
              @keydown.enter="handleSign"
            />

            <v-btn
              color="primary"
              block
              :disabled="!signing.isPrfWallet.value && !signing.spendingPassword.value"
              :loading="signing.loading.value"
              @click="handleSign"
            >
              {{ $t('common.confirm') }}
            </v-btn>
          </div>

          <!-- Ledger flow: no password prompt — a stepped, device-driven orchestration -->
          <div v-else class="ledger-flow">
            <p v-if="signing.phase.value === 'idle'" class="ledger-flow-intro">
              {{ $t('poolOperator.ledgerSignUpdate') }}
            </p>

            <div v-if="signing.phase.value !== 'idle'" class="ledger-steps">
              <div
                v-for="step in ledgerSteps"
                :key="step.key"
                class="ledger-step"
                :class="`is-${step.status}`"
              >
                <v-progress-circular
                  v-if="step.status === 'active'"
                  indeterminate
                  size="16"
                  width="2"
                  color="warning"
                />
                <v-icon v-else size="18" :color="step.status === 'done' ? 'success' : undefined">
                  {{ step.status === 'done' ? 'mdi-check-circle' : 'mdi-circle-outline' }}
                </v-icon>
                <span class="ledger-step-label">{{ $t(step.labelKey) }}</span>
              </div>
            </div>

            <!-- Device-prompt hints at the two Ledger tap points -->
            <div v-if="signing.phase.value === 'funding'" class="ledger-hint">
              <v-icon size="18" color="warning">mdi-usb-flash-drive-outline</v-icon>
              <span>{{ $t('poolOperator.ledgerConfirmFund') }}</span>
            </div>
            <div v-if="signing.phase.value === 'signingOwner'" class="ledger-hint">
              <v-icon size="18" color="warning">mdi-shield-key-outline</v-icon>
              <span>{{ $t('poolOperator.ledgerSignUpdate') }}</span>
            </div>

            <!-- Review the assembled tx before the explicit submit -->
            <div v-if="signing.phase.value === 'readyToSubmit'" class="ledger-review">
              <div class="ledger-review-label">{{ $t('poolOperator.ledgerReviewTx') }}</div>
              <div class="monospace-text text-caption ledger-review-tx">{{ signing.assembledTx.value }}</div>
            </div>

            <!-- Password-encrypted cold keys still need the password to produce
                 the operator witness; PRF cold keys unlock via PassKey and skip
                 this. Gated on the cold key's own encryption, not the wallet. -->
            <v-text-field
              v-if="signing.phase.value === 'idle' && coldKeyNeedsPassword"
              v-model="signing.spendingPassword.value"
              :label="$t('poolOperator.coldKeyPassword')"
              type="password"
              outlined
              dense
              hide-details
              class="mb-4"
            />
            <v-btn
              v-if="signing.phase.value === 'idle'"
              color="primary"
              block
              :disabled="coldKeyNeedsPassword && !signing.spendingPassword.value"
              :loading="signing.loading.value"
              @click="handleSign"
            >
              {{ $t('common.confirm') }}
            </v-btn>
            <v-btn
              v-else-if="signing.phase.value === 'readyToSubmit'"
              color="primary"
              block
              :loading="signing.loading.value"
              @click="submitLedgerTx"
            >
              {{ $t('poolOperator.ledgerSubmit') }}
            </v-btn>
          </div>
        </div>

        <!-- Success -->
        <div v-else class="text-center py-4">
          <v-icon size="48" color="success">mdi-check-circle</v-icon>
          <h4 class="mt-3">{{ $t('common.success') }}</h4>
          <v-btn color="primary" text class="mt-3" @click="close">
            {{ $t('common.close') }}
          </v-btn>
        </div>

        <!-- Stranded hot-key funds: can surface after a failed sweep, whether or not
             the pool update itself succeeded — so this sits outside the isSubmit split
             and gates both close paths above via `close()`. -->
        <div v-if="signing.strandedFunds.value" class="ledger-stranded mt-4">
          <v-icon size="20" color="error">mdi-alert-circle-outline</v-icon>
          <div class="ledger-stranded-body">
            <div class="ledger-stranded-title">{{ $t('poolOperator.ledgerStrandedTitle') }}</div>
            <div class="ledger-stranded-text">{{ $t('poolOperator.ledgerStrandedBody') }}</div>
            <div class="ledger-stranded-actions">
              <v-btn text small color="error" :loading="signing.loading.value" @click="retrySweep">
                {{ $t('poolOperator.ledgerRetrySweep') }}
              </v-btn>
              <template v-if="confirmForceClose">
                <v-btn text small @click="confirmForceClose = false">
                  {{ $t('common.cancel') }}
                </v-btn>
                <v-btn text small color="error" @click="close">
                  {{ $t('poolOperator.ledgerCloseAnyway') }}
                </v-btn>
              </template>
            </div>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRef } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';
import { usePoolSigning, type PoolSigningPhase } from '@/shared/composables/usePoolSigning';

const props = defineProps<{
  value: boolean;
  tx: Cardano.Tx | null;
  isUpdate: boolean;
}>();

const emit = defineEmits(['input', 'signed', 'close']);

const dialog = ref(props.value);
watch(() => props.value, (v) => { dialog.value = v; });
watch(dialog, (v) => { emit('input', v); });

const txRef = toRef(props, 'tx');

const signing = usePoolSigning({
  tx: txRef,
  successMessageKey: props.isUpdate ? 'poolOperator.updatePool' : 'poolOperator.registerPool',
  onSuccess: () => {
    emit('signed');
  },
});

const isLedger = computed(() => walletStore.loggedWallet?.type === WalletType.Ledger);

// The Ledger flow must collect a spending password when the imported cold key
// is password-encrypted. `background.ts` decrypts by password whenever the
// stored method isn't 'prf' (and 'password' is its default when unset), so
// mirror that here: only PRF cold keys skip the prompt.
const coldKeyNeedsPassword = computed(() => isLedger.value && poolOperatorStore.coldKeyEncryption !== 'prf');

// Ordered so a step's status can be derived from where the current phase
// falls relative to it: earlier group -> done, own group -> active, later -> pending.
const phaseOrder: PoolSigningPhase[] = [
  'idle', 'funding', 'awaitingFund', 'signingOwner', 'signingCold',
  'assembling', 'readyToSubmit', 'submitting', 'sweeping', 'done',
];

function stepStatus(phases: PoolSigningPhase[]): 'pending' | 'active' | 'done' {
  const current = signing.phase.value;
  if (phases.includes(current)) return 'active';
  const currentIdx = phaseOrder.indexOf(current);
  const lastIdx = Math.max(...phases.map((p) => phaseOrder.indexOf(p)));
  return currentIdx > lastIdx ? 'done' : 'pending';
}

const ledgerSteps = computed(() => [
  { key: 'fund', labelKey: 'poolOperator.ledgerFundStep', status: stepStatus(['funding', 'awaitingFund']) },
  { key: 'sign', labelKey: 'poolOperator.ledgerSignUpdate', status: stepStatus(['signingOwner', 'signingCold', 'assembling']) },
  { key: 'review', labelKey: 'poolOperator.ledgerReviewTx', status: stepStatus(['readyToSubmit']) },
  { key: 'submit', labelKey: 'poolOperator.ledgerSubmit', status: stepStatus(['submitting']) },
  { key: 'sweep', labelKey: 'poolOperator.ledgerSweep', status: stepStatus(['sweeping', 'done']) },
]);

const formatFee = computed(() => {
  if (!props.tx?.body?.fee) return '0';
  return (Number(props.tx.body.fee) / 1_000_000).toFixed(6);
});

// Set when the user has already tried to close once while funds were stranded
// on the ephemeral hot key — asks for an explicit second confirmation rather
// than closing (and losing the in-memory key) silently.
const confirmForceClose = ref(false);
watch(() => signing.strandedFunds.value, (v) => {
  if (!v) confirmForceClose.value = false;
});

async function handleSign() {
  await signing.handleSign();
}

async function submitLedgerTx() {
  await signing.submitLedgerTx();
}

async function retrySweep() {
  await signing.retrySweep();
}

async function close() {
  if (signing.strandedFunds.value && !confirmForceClose.value) {
    confirmForceClose.value = true;
    return;
  }
  await signing.resetState();
  confirmForceClose.value = false;
  dialog.value = false;
  emit('close');
}
</script>

<style scoped>
.ledger-flow-intro {
  font-size: 13px;
  color: var(--g-text-2);
  margin-bottom: var(--g-s-4);
}

.ledger-steps {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin-bottom: var(--g-s-4);
}

.ledger-step {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  font-size: 13px;
  color: var(--g-text-3);
}

.ledger-step.is-active {
  color: var(--g-text-1);
}

.ledger-step.is-done {
  color: var(--g-text-2);
}

.ledger-step-label {
  line-height: 1.3;
}

.ledger-hint {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-3);
  margin-bottom: var(--g-s-4);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-control);
  font-size: 12px;
  color: var(--g-text-2);
}

.ledger-review-label {
  font-size: 12px;
  color: var(--g-text-2);
  margin-bottom: var(--g-s-2);
}

.ledger-review-tx {
  display: block;
  max-height: 120px;
  overflow-y: auto;
  overflow-wrap: anywhere;
  padding: var(--g-s-3);
  margin-bottom: var(--g-s-4);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

.ledger-stranded {
  display: flex;
  gap: var(--g-s-3);
  padding: var(--g-s-3);
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  border-radius: var(--g-r-control);
}

.ledger-stranded-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
  margin-bottom: var(--g-s-1);
}

.ledger-stranded-text {
  font-size: 12px;
  color: var(--g-text-2);
  line-height: 1.5;
}

.ledger-stranded-actions {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin-top: var(--g-s-2);
  flex-wrap: wrap;
}
</style>
