<template>
  <div>
    <!-- Progress. Hidden while a signing prompt is up, so two dialogs never stack. -->
    <BaseDialog
      v-if="showProgress"
      :isOpen="showProgress"
      size="sm"
      :min-height="0"
      persistent
      :title="progressTitle"
    >
      <v-card-text class="pt-4 px-0">
        <v-progress-linear indeterminate rounded />
      </v-card-text>
    </BaseDialog>

    <!-- Failure: says which kind, and never implies funds moved when they did not. -->
    <BaseDialog
      v-if="stage === 'error'"
      :isOpen="stage === 'error'"
      size="sm"
      :min-height="0"
      :title="$t('realfi.order.errors.title')"
      @close="reset()"
    >
      <v-card-text class="pt-4 px-0">
        <p class="t-body realfi-flow__body">{{ errorBody }}</p>
        <!-- RealFi support finds a compliance decision by this id. -->
        <p v-if="error && error.correlationId" class="t-caption g-mono realfi-flow__ref">
          {{ $t('realfi.order.reference', { id: error.correlationId }) }}
        </p>
        <div class="realfi-flow__actions">
          <GButton v-if="offersSupport" tier="tertiary" @click="$emit('support')">
            {{ $t('realfi.failed.cta') }}
          </GButton>
          <GButton tier="primary" @click="reset()">{{ $t('common.close') }}</GButton>
        </div>
      </v-card-text>
    </BaseDialog>

    <!-- A Ledger that can do Bluetooth may still be plugged in: ask, never assume. -->
    <BaseDialog
      v-if="transportPromptVisible"
      :isOpen="transportPromptVisible"
      size="sm"
      :min-height="0"
      persistent
      :title="$t('realfi.order.ledgerTransport')"
      :subtitle="$t('miniGero.connectLedger')"
      @close="onTransportCancel"
    >
      <v-card-text class="pt-4 px-0">
        <div class="realfi-flow__actions">
          <GButton tier="secondary" @click="onTransportChosen(true)">
            {{ $t('governance.bluetooth') }}
          </GButton>
          <GButton tier="primary" @click="onTransportChosen(false)">
            {{ $t('governance.usb') }}
          </GButton>
        </div>
      </v-card-text>
    </BaseDialog>

    <!-- Signing prompts: the same components and wiring the swap embed uses. -->
    <KeystoneSignDialog
      v-if="keystone.keystoneShow.value"
      :isOpen="keystone.keystoneShow.value"
      :keystoneType="keystone.keystoneType.value"
      :keystoneCbor="keystone.keystoneCbor.value"
      @scan="keystone.onKeystoneScan"
      @error="keystone.failKeystone"
      @close="keystone.cancelKeystone"
    />

    <BaseDialog
      v-if="prfPromptVisible"
      :isOpen="prfPromptVisible"
      size="sm"
      :min-height="0"
      persistent
      :title="$t('security.authenticateWithPassKey')"
      :subtitle="$t('miniGero.prfAuthPrompt')"
      @close="onPassKeyCancel"
    >
      <v-card-text class="pt-4 px-0">
        <PassKeyAuthButton @success="onPassKeySuccess" @error="onPassKeyError" />
      </v-card-text>
    </BaseDialog>

    <BaseDialog
      v-if="pwPromptVisible"
      :isOpen="pwPromptVisible"
      size="sm"
      :min-height="0"
      persistent
      :title="$t('wallet.spendingPassword')"
      @close="onPasswordCancel"
    >
      <v-card-text class="pt-4 px-0">
        <v-text-field
          v-model="pwValue"
          type="password"
          outlined
          dense
          hide-details
          autofocus
          :placeholder="$t('wallet.enterPassword')"
          @keydown.enter="onPasswordConfirm"
        />
        <div class="realfi-flow__actions">
          <GButton tier="tertiary" @click="onPasswordCancel">{{ $t('common.cancel') }}</GButton>
          <GButton tier="primary" :disabled="!pwValue" @click="onPasswordConfirm">
            {{ $t('common.confirm') }}
          </GButton>
        </div>
      </v-card-text>
    </BaseDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useNativeSwapSigner } from '@/modules/swap/composables/useNativeSwapSigner';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import i18n from '@/plugins/i18n';
import { SigningCancelled, useRealFiOrder } from '../composables/useRealFiOrder';
import type { RealFiBuildRequest, RealFiOrderKind } from '../services/realfiOrders';

/**
 * Runs a RealFi order end to end and owns every dialog that takes: the signing prompt
 * for the wallet's type, progress, and a failure that says what actually happened.
 *
 * The page calls `run()` (exposed) and hears back through `placed` once the chain has
 * the transaction.
 */
const emit = defineEmits<{
  (e: 'placed', txId: string, kind: RealFiOrderKind): void;
  (e: 'support'): void;
}>();

const t = (key: string, values?: Record<string, unknown>) => i18n.t(key, values) as string;

/* ── Spending password ──────────────────────────────────────────────────────── */

const pwPromptVisible = ref(false);
const pwValue = ref('');
let pwResolve: ((v: string) => void) | null = null;
let pwReject: ((e: Error) => void) | null = null;

function getPassword(): Promise<string> {
  pwValue.value = '';
  pwPromptVisible.value = true;
  return new Promise<string>((resolve, reject) => {
    pwResolve = resolve;
    pwReject = reject;
  });
}

function onPasswordConfirm(): void {
  if (!pwValue.value) return;
  const value = pwValue.value;
  pwPromptVisible.value = false;
  pwValue.value = '';
  pwResolve?.(value);
  pwResolve = null;
  pwReject = null;
}

function onPasswordCancel(): void {
  pwPromptVisible.value = false;
  pwValue.value = '';
  pwReject?.(new SigningCancelled());
  pwResolve = null;
  pwReject = null;
}

/* ── PassKey (PRF wallets) ──────────────────────────────────────────────────── */

const prfPromptVisible = ref(false);
let prfResolve: ((bytes: Uint8Array) => void) | null = null;
let prfReject: ((e: Error) => void) | null = null;

function getPrfBytes(): Promise<Uint8Array> {
  prfPromptVisible.value = true;
  return new Promise<Uint8Array>((resolve, reject) => {
    prfResolve = resolve;
    prfReject = reject;
  });
}

function settlePrf(): void {
  prfPromptVisible.value = false;
  prfResolve = null;
  prfReject = null;
}

function onPassKeySuccess(privateKeyBytes: Uint8Array): void {
  const resolve = prfResolve;
  settlePrf();
  resolve?.(privateKeyBytes);
}

function onPassKeyError(error: Error): void {
  const reject = prfReject;
  settlePrf();
  reject?.(error);
}

function onPassKeyCancel(): void {
  const reject = prfReject;
  settlePrf();
  reject?.(new SigningCancelled());
}

/* ── The run ────────────────────────────────────────────────────────────────── */

/* ── Ledger transport ───────────────────────────────────────────────────────── */

/**
 * USB unless the user picks Bluetooth for this order. `btSupported` says the device
 * CAN do Bluetooth, not that it is connected that way, so it only decides whether
 * to ask — the same choice the Send and governance dialogs offer, defaulting to USB.
 */
const isBT = ref(false);
const transportPromptVisible = ref(false);
let transportResolve: (() => void) | null = null;
let transportReject: ((e: Error) => void) | null = null;

function chooseTransport(): Promise<void> {
  transportPromptVisible.value = true;
  return new Promise<void>((resolve, reject) => {
    transportResolve = resolve;
    transportReject = reject;
  });
}

function onTransportChosen(bluetooth: boolean): void {
  isBT.value = bluetooth;
  transportPromptVisible.value = false;
  transportResolve?.();
  transportResolve = null;
  transportReject = null;
}

function onTransportCancel(): void {
  transportPromptVisible.value = false;
  transportReject?.(new SigningCancelled());
  transportResolve = null;
  transportReject = null;
}

const { signer: sharedSigner, keystone } = useNativeSwapSigner({
  getPassword,
  getPrfBytes,
  getIsBT: () => isBT.value,
});

const signer = {
  async signTx(unsignedTxCbor: string): Promise<string> {
    const w = walletStore.loggedWallet;
    isBT.value = false;
    if (w?.type === WalletType.Ledger && w.btSupported) await chooseTransport();
    return sharedSigner.signTx(unsignedTxCbor);
  },
};

const { stage, kind, error, run: runOrder, reset } = useRealFiOrder(signer);

const promptVisible = computed(
  () =>
    pwPromptVisible.value ||
    prfPromptVisible.value ||
    transportPromptVisible.value ||
    keystone.keystoneShow.value,
);

const showProgress = computed(
  () =>
    stage.value === 'building' ||
    stage.value === 'submitting' ||
    (stage.value === 'signing' && !promptVisible.value),
);

const progressTitle = computed(() => {
  if (stage.value === 'building') return t('realfi.order.building');
  if (stage.value === 'signing') return t('realfi.order.signing');
  return t('perpetuals.deposit.statusSubmitting');
});

const ERROR_KEYS: Record<string, string> = {
  'not-authorized': 'realfi.order.errors.notAuthorized',
  'pending-review': 'realfi.order.errors.pendingReview',
  'screening-unavailable': 'realfi.order.errors.screeningUnavailable',
  'unsupported-wallet': 'realfi.order.errors.unsupportedWallet',
  'build-failed': 'realfi.order.errors.buildFailed',
  'wrong-password': 'errors.wrongPassword',
  'sign-failed': 'realfi.order.errors.signFailed',
  'submit-failed': 'realfi.order.errors.submitFailed',
};

const errorBody = computed(() =>
  t(ERROR_KEYS[error.value?.reason ?? 'build-failed'] ?? 'realfi.order.errors.buildFailed'),
);

/** A refusal is RealFi's decision, so RealFi is who can explain or revisit it. */
const offersSupport = computed(
  () => error.value?.reason === 'not-authorized' || error.value?.reason === 'unsupported-wallet',
);

const PLACED_KEYS: Record<RealFiOrderKind, string> = {
  stake: 'realfi.order.placed',
  unstake: 'realfi.order.placed',
  claim: 'realfi.order.claimed',
  cancel: 'realfi.order.cancelled',
};

async function run(req: RealFiBuildRequest): Promise<void> {
  const txId = await runOrder(req);
  if (!txId) return;
  const placedKind = kind.value ?? req.kind;
  snackbar.fireSuccess(t(PLACED_KEYS[placedKind]));
  reset();
  emit('placed', txId, placedKind);
}

defineExpose({ run });
</script>

<style lang="scss" scoped>
.realfi-flow__body {
  margin: 0 0 var(--g-s-3);
}

.realfi-flow__ref {
  margin: 0 0 var(--g-s-3);
  color: var(--g-text-3);
  word-break: break-all;
}

.realfi-flow__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--g-s-2);
  margin-top: var(--g-s-4);
}
</style>
