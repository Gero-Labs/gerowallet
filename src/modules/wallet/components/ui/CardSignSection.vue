<template>
  <!-- One signing path for every card payment (top-up, delivery fee): password, PassKey,
       Ledger/Trezor and Keystone all go through useTransactionSigning. Every attempt (button,
       Enter, PassKey password autofill) goes through confirm(), which prepares the transaction
       again first; the composable's own autofill handler would sign without preparing. -->
  <div class="card-sign">
    <TransactionAuthSection
      :wallet-type="loggedWallet?.type"
      :is-prf-wallet="isPrfWallet"
      :is-signed="isSubmit"
      :loading="busy"
      :password="spendingPassword"
      :password-label="t('wallet.spendingPassword')"
      :password-rules="passwordRules"
      :submit-text="t('card.submitTransaction')"
      :show-bt-toggle="isBTSupported"
      :is-b-t="isBT"
      :usb-text="t('wallet.usb')"
      :bluetooth-text="t('wallet.bluetooth')"
      button-class=""
      button-style="width: 100%"
      @update:password="spendingPassword = $event"
      @update:isBT="isBT = $event"
      @passkey-success="onPassKeySuccess"
      @passkey-error="handlePassKeyAuthError"
      @autofill-success="confirm()"
      @autofill-error="handlePassKeyError"
      @submit="confirm()"
      @password-field-ref="setPasswordFieldRef"
    />
    <p v-if="isSubmit && !isPrfWallet" class="t-caption card-sign__note">{{ t('card.transactionSigned') }}</p>
    <p v-else-if="awaitingLedger" class="t-caption card-sign__note">{{ t('card.pleaseReviewLedger') }}</p>
    <GButton v-if="!isPrfWallet" tier="primary" block :loading="busy" :disabled="!canConfirm" @click="confirm()">
      {{ isSubmit ? t('card.submitTransaction') : label }}
    </GButton>
    <KeystoneSignDialog
      :isOpen="overlay && loggedWallet?.type === WalletType.Keystone"
      :keystoneType="keystoneType"
      :keystoneCbor="keystoneCbor"
      @close="resetState()"
      @scan="onKeystoneScan"
      @error="onKeystoneError"
      @progress="onKeystoneProgress"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRefs, watch } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import GButton from '@/shared/components/GButton/GButton.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';

const props = withDefaults(defineProps<{
  /** Primary button label before signing, e.g. "Sign & Top Up". */
  label: string;
  /**
   * Builds the transaction to sign. Runs again on every attempt until one is signed, so it
   * must be safe to repeat. Throw an Error with a user-facing message to stop.
   */
  prepare: () => Promise<Cardano.Tx>;
  disabled?: boolean;
}>(), { disabled: false });

const emit = defineEmits<{
  (e: 'submitted', txId: string): void;
  (e: 'busy', value: boolean): void;
}>();

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const tx = ref<Cardano.Tx | undefined>(undefined);
const txRef = computed(() => tx.value);
const preparing = ref(false);

const {
  loading,
  spendingPassword,
  isSubmit,
  isBT,
  isPrfWallet,
  isBTSupported,
  passwordRules,
  privateKeyBytes,
  overlay,
  keystoneType,
  keystoneCbor,
  handleSign,
  captureAuthorization,
  resetState,
  handlePassKeyError,
  handlePassKeyAuthError,
  setPasswordFieldRef,
  onKeystoneScan,
  onKeystoneError,
  onKeystoneProgress,
} = useTransactionSigning({
  active: () => !props.disabled,
  tx: txRef,
  successMessageKey: 'notifications.transactionSubmitted',
  onSuccess: (txId: string) => emit('submitted', txId),
});

const busy = computed(() => loading.value || preparing.value);
const isPasswordWallet = computed(() => loggedWallet.value?.type === WalletType.Normal && !isPrfWallet.value);
const awaitingLedger = computed(() => loggedWallet.value?.type === WalletType.Ledger && loading.value);
const canConfirm = computed(() =>
  !props.disabled && !busy.value && (isSubmit.value || !isPasswordWallet.value || spendingPassword.value !== ''),
);

/** The last busy state the parent was told about. */
let reportedBusy = false;
watch(busy, value => {
  reportedBusy = value;
  emit('busy', value);
});

// A successful submit usually swaps this section for a done view in the same tick that
// `loading` turns false. The parent re-renders first and removes this section, so the watcher
// above never reports false, and a parent that blocks closing while busy keeps its Done and
// close buttons dead. Report it on the way out instead.
onBeforeUnmount(() => {
  if (reportedBusy) emit('busy', false);
});

async function build(): Promise<boolean> {
  const current = captureAuthorization();
  preparing.value = true;
  try {
    const prepared = await props.prepare();
    if (!current()) return false;
    tx.value = prepared;
    return true;
  } catch (error: unknown) {
    if (!current()) return false;
    snackbar.setError(error instanceof Error && error.message ? error.message : t('errors.buildTransactionFailed'));
    return false;
  } finally {
    preparing.value = false;
  }
}

async function confirm(): Promise<void> {
  if (!canConfirm.value) return;
  const approvedPassword = spendingPassword.value;
  if (!isSubmit.value && !(await build())) return;
  spendingPassword.value = approvedPassword;
  await handleSign();
}

async function onPassKeySuccess(pk: Uint8Array): Promise<void> {
  if (busy.value || props.disabled) { pk.fill(0); return; }
  if (!isSubmit.value && !(await build())) { pk.fill(0); return; }
  privateKeyBytes.value = pk;
  await handleSign();
}

/** Forget the signed state, password and built transaction (call when the dialog closes). */
function reset(): void {
  resetState();
  tx.value = undefined;
}

defineExpose({ reset });
</script>

<style lang="scss" scoped>
.card-sign {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  width: 100%;
}

.card-sign__note {
  margin: 0;
  text-align: center;
}
</style>
