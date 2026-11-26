<template>
  <BaseDialog
    persistent
    size="md"
    :is-open="isOpen"
    :title="$t('gerovault.create.registration.title')"
    :subtitle="$t('gerovault.create.registration.info')"
    :loading="loading"
    @close="close()"
  >
    <p v-if="building" class="t-body-sm gvc-muted" role="status">{{ $t('gerovault.create.registration.building') }}</p>
    <GNote v-else-if="buildError" tone="error" icon="mdi-alert-circle-outline" role="alert">
      {{ $t('gerovault.create.registration.buildFailed', { reason: buildError }) }}
    </GNote>
    <v-form v-else-if="tx" ref="form" v-model="valid" class="registration__form" @submit.prevent="sign()">
      <dl class="gvc-facts t-body-sm">
        <dt>{{ $t('send.fee') }}</dt>
        <dd class="g-mono" data-test="create-registration-fee">{{ toCurrency(tx.body.fee.toString()) }}</dd>
      </dl>
      <div class="registration__auth">
        <TransactionAuthSection
          :wallet-type="loggedWallet?.type"
          :is-prf-wallet="isPrfWallet"
          :is-signed="isSubmit"
          :loading="loading"
          :password="spendingPassword"
          :password-label="$t('wallet.spendingPassword')"
          :password-rules="passwordRules"
          :submit-text="$t('common.submit')"
          submit-color="primary"
          :submit-elevation="0"
          :show-bt-toggle="false"
          :is-b-t="false"
          @update:password="spendingPassword = $event"
          @passkey-success="handlePassKeyAuthSuccess"
          @passkey-error="handlePassKeyAuthError"
          @autofill-success="handlePassKeySuccess"
          @autofill-error="handlePassKeyError"
          @submit="sign()"
          @enter="sign()"
          @password-field-ref="setPasswordFieldRef"
        />
        <!-- PassKey wallets submit from TransactionAuthSection; password and Google wallets use this button. -->
        <GButton v-if="!isPrfWallet" tier="primary" :disabled="loading || !valid" :loading="loading" data-test="create-registration-sign" @click="sign()">
          {{ isSubmit ? $t('common.submit') : $t('wallet.signAndConfirm') }}
        </GButton>
      </div>
    </v-form>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, toRefs, watch } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import filters from '@/shared/utils/filters';
import { networkStore } from '@/stores/networkStore';
import { walletStore } from '@/stores/walletStore';
import type { VaultScripts } from '@/shared/gerovault';
import { buildRegistrationTx } from './registrationTx';

/**
 * The optional CIP-0146 registration, signed with the wallet's normal keys through the wallet's
 * own signing path (`useTransactionSigning`, then `SIGN_TX` and `SUBMIT_TX`), like the collateral
 * and staking dialogs. The transaction pays only its fee: the rest goes back to this wallet.
 */
const props = defineProps<{ isOpen: boolean; scripts: Pick<VaultScripts, 'payment' | 'stake'> }>();
const emit = defineEmits<{ close: []; submitted: [txId: string] }>();

const { toCurrency } = filters;
const { loggedWallet } = toRefs(walletStore);

const tx = shallowRef<Cardano.Tx | undefined>();
const building = ref(false);
const buildError = ref('');
const valid = ref(false);
const form = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null);
const txRef = computed(() => tx.value);

const {
  loading,
  spendingPassword,
  isSubmit,
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
  active: () => props.isOpen,
  tx: txRef,
  successMessageKey: 'gerovault.create.registration.success',
  onSuccess: (txId: string) => emit('submitted', txId),
  onClose: () => emit('close'),
});

async function build(): Promise<void> {
  building.value = true;
  buildError.value = '';
  tx.value = undefined;
  try {
    const keys = walletStore.keys;
    const changeAddress = keys?.payment?.[0]?.address;
    if (!changeAddress || !networkStore.epochParams) throw new Error('The wallet is not synced yet');
    tx.value = await buildRegistrationTx(props.scripts, {
      utxos: walletStore.utxos as Cardano.Utxo[],
      epochParams: networkStore.epochParams,
      changeAddress,
      tip: networkStore.tip ?? {},
      walletContext: { keys },
    });
  } catch (error) {
    buildError.value = getErrorMessage(error, 'unknown');
  } finally {
    building.value = false;
  }
}

watch(() => props.isOpen, open => {
  if (!open) return;
  resetState();
  void build();
}, { immediate: true });

async function sign(): Promise<void> {
  await handleSign(form.value ?? undefined);
}

function close(): void {
  resetState();
  emit('close');
}
</script>

<style scoped>
.registration__form {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}
.registration__auth {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--g-s-3);
}
</style>
