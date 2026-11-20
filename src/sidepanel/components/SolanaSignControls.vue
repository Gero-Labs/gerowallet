<template>
  <!-- The signing controls of a Solana dApp prompt (sign message, sign in, sign transaction):
       a spending password, a PassKey, or, for any other wallet type, Reject only. The parent
       owns the request and the signing; this only collects the password and says which way. -->
  <template v-if="walletType === WalletType.Normal && !isPrfWallet">
    <v-text-field
      :model-value="password"
      :type="showPassword ? 'text' : 'password'"
      :label="$t('miniGero.spendingPassword')"
      :append-inner-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
      :error-messages="signError"
      variant="outlined" density="compact" theme="dark"
      class="password-input"
      @update:model-value="emit('update:password', $event ?? '')"
      @click:append-inner="showPassword = !showPassword"
      @keyup.enter="canSign && password && emit('sign-password')"
    />
    <div class="action-buttons">
      <v-btn variant="outlined" rounded theme="dark" @click="emit('reject')">{{ $t('miniGero.reject') }}</v-btn>
      <v-btn class="geroButton" rounded variant="flat" :loading="signing" :disabled="!password || !canSign" @click="emit('sign-password')">
        {{ signLabel }}
      </v-btn>
    </div>
  </template>

  <template v-else-if="isPrfWallet">
    <p class="grey--text text-body-2 text-center mb-2 mt-3">{{ $t('miniGero.passKeyRequired') }}</p>
    <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
    <div class="action-buttons">
      <v-btn variant="outlined" rounded theme="dark" @click="emit('reject')">{{ $t('miniGero.reject') }}</v-btn>
      <v-btn class="geroButton" rounded variant="flat" :loading="signing" :disabled="!canSign" @click="emit('sign-prf')">
        {{ signLabel }}
      </v-btn>
    </div>
  </template>

  <template v-else>
    <p class="grey--text text-body-2 text-center mb-2 mt-3">{{ unsupportedText }}</p>
    <div class="action-buttons">
      <v-btn variant="outlined" rounded theme="dark" block @click="emit('reject')">{{ $t('miniGero.reject') }}</v-btn>
    </div>
  </template>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { WalletType } from '@/models/types';

const props = defineProps<{
  walletType?: string;
  isPrfWallet: boolean;
  password: string;
  signing: boolean;
  signError: string;
  /** False while the request cannot be signed (unreadable, or an unacknowledged critical warning). */
  canSign: boolean;
  signLabel: string;
  unsupportedText: string;
}>();

const emit = defineEmits<{
  'update:password': [value: string];
  'sign-password': [];
  'sign-prf': [];
  reject: [];
}>();

const showPassword = ref(false);
// A cleared password (a new request) hides it again.
watch(() => props.password, (value) => { if (!value) showPassword.value = false; });
</script>

<style scoped>
/* The same row as DAppOverlay's other prompts (its scoped rules do not reach in here): Reject is
   the narrower column, and a single action spans the row. */
.password-input {
  width: 100%;
  margin-top: 8px;
}

.action-buttons {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 10px;
  width: 100%;
  margin-top: var(--g-s-4);
}

.action-buttons > *:only-child {
  grid-column: 1 / -1;
}

.action-buttons .v-btn.v-btn {
  width: 100%;
  min-width: 0;
  height: auto;
  min-height: 36px;
  white-space: normal;
}

.action-buttons :deep(.v-btn__content) {
  min-width: 0;
  white-space: normal;
  line-height: 1.25;
  text-align: center;
}
</style>
