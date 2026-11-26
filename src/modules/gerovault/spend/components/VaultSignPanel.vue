<template>
  <!-- Signing this wallet's part. Software wallets type the spending password; every other kind
       of wallet is told plainly that it cannot sign for a vault here yet. -->
  <section class="vault-sign" data-test="sign-panel">
    <p v-if="signed" class="t-body vault-sign__done" role="status" data-test="sign-done">
      <v-icon size="16" aria-hidden="true">mdi-check-circle</v-icon>{{ $t('gerovault.spend.sign.signed') }}
    </p>

    <GNote v-else-if="support === 'hardware'" icon="mdi-usb-flash-drive-outline" role="status" data-test="sign-not-yet">
      {{ $t('gerovault.spend.sign.hardwareNotYet') }}
    </GNote>
    <GNote v-else-if="support === 'passkey'" icon="mdi-fingerprint" role="status" data-test="sign-not-yet">
      {{ $t('gerovault.spend.sign.passkeyNotYet') }}
    </GNote>
    <GNote v-else-if="support === 'none'" icon="mdi-lock-outline" role="status" data-test="sign-not-yet">
      {{ $t('gerovault.spend.sign.unsupported') }}
    </GNote>

    <form v-else class="vault-sign__form" @submit.prevent="submit">
      <PassKeyPasswordField
        v-model="password"
        outlined
        dense
        hide-details="auto"
        autocomplete="current-password"
        :disabled="disabled || busy"
        @enter="submit"
      />
      <GButton tier="primary" type="submit" :loading="busy" :disabled="disabled || !password" data-test="sign-button">
        {{ $t('gerovault.spend.sign.button') }}
      </GButton>
    </form>

    <GNote v-if="error" tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="sign-error">{{ error }}</GNote>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import type { VaultSignerSupport } from '../signer';

const props = withDefaults(defineProps<{
  support: VaultSignerSupport;
  /** This wallet's signature is already collected. */
  signed?: boolean;
  /** The sheet refuses, or another step is running. */
  disabled?: boolean;
  busy?: boolean;
  /** The last attempt's error, as text. */
  error?: string | null;
}>(), { signed: false, disabled: false, busy: false, error: null });

const emit = defineEmits<{ (e: 'sign', password: string): void }>();

const password = ref('');

function submit(): void {
  if (props.disabled || props.busy || !password.value) return;
  // The password leaves the field before it is handed on, and is not kept here.
  const typed = password.value;
  password.value = '';
  emit('sign', typed);
}
</script>

<style scoped>
.vault-sign {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.vault-sign__form {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.vault-sign__done {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: 0;
  color: var(--g-success);
}
</style>
