<!-- src/sidepanel/components/SupportAuthPrompt.vue -->
<!--
  The face of `useSupportAuthPrompt`: collects spending auth for the support
  chat's one-time identity handshake, and registers itself as the chat's
  `promptAuth` hook for as long as it is mounted.

  Auth collection is delegated to the house component, `TransactionAuthSection`
  — the same one every signing surface uses (SignTx, TopUpModal, the Bitcoin
  signers). It renders `PassKeyAuthButton` for PRF wallets (which owns the side
  panel's WebAuthn popup) and `PassKeyPasswordField` for password wallets, so
  this dialog inherits the wallet's standard auth behavior instead of forking it.

  Mounted by AgentDock (the only surface that can reach support chat), so there
  is one instance per UI context — the dashboard and the side panel are separate
  documents, each with its own module registry and its own hook — and the
  registration lifetime is exactly the dock's.
-->
<template>
  <v-dialog :value="prompt.isOpen.value" max-width="360" @input="onDialogInput">
    <div class="support-auth">
      <div class="support-auth__head">
        <span class="support-auth__title">{{ $t('support.auth.title') }}</span>
        <button
          class="support-auth__close"
          :aria-label="$t('common.cancel')"
          @click="prompt.cancel()"
        >
          <v-icon size="16" color="var(--g-text-2)">mdi-close</v-icon>
        </button>
      </div>

      <p class="support-auth__body">{{ $t('support.auth.body') }}</p>

      <TransactionAuthSection
        :wallet-type="walletType"
        :is-prf-wallet="prompt.isPrf.value"
        :is-signed="false"
        :loading="false"
        :password="password"
        :password-label="$t('wallet.spendingPassword')"
        :submit-text="$t('common.confirm')"
        button-style="width: 100%;"
        @update:password="password = $event"
        @passkey-success="onPassKeySuccess"
        @passkey-error="onPassKeyError"
        @submit="confirm()"
      />

      <p v-if="prompt.errorKey.value" class="support-auth__error" role="alert">
        {{ $t(prompt.errorKey.value) }}
      </p>

      <div class="support-auth__actions">
        <button class="support-auth__btn" @click="prompt.cancel()">{{ $t('common.cancel') }}</button>
        <!-- PRF wallets confirm by completing the PassKey ceremony above, so the
             only button they need is Cancel. -->
        <button
          v-if="!prompt.isPrf.value"
          class="support-auth__btn support-auth__btn--primary"
          :disabled="!password"
          @click="confirm()"
        >{{ $t('common.confirm') }}</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import { supportAuthPrompt } from '@/sidepanel/composables/useSupportAuthPrompt';
import { walletStore } from '@/stores/walletStore';

const prompt = supportAuthPrompt;
const password = ref('');

const walletType = computed(() => (walletStore.loggedWallet as { type?: string } | null)?.type);

// Never let a typed password outlive the prompt that asked for it — this covers
// every close path (confirm, cancel, Escape, unmount) with one rule.
watch(
  () => prompt.isOpen.value,
  (open) => {
    if (!open) password.value = '';
  },
);

function onDialogInput(open: boolean): void {
  // Escape / scrim click. Dismissing is a deliberate "not now", so it settles the
  // hook as a cancel: send() returns false, keeps the draft and shows no error.
  if (!open) prompt.cancel();
}

function confirm(): void {
  prompt.submitPassword(password.value);
}

function onPassKeySuccess(bytes: Uint8Array): void {
  prompt.submitPrivateKeyBytes(bytes);
}

function onPassKeyError(): void {
  prompt.reportAuthError();
}

onMounted(() => prompt.register());
onBeforeUnmount(() => prompt.unregister());
</script>

<style scoped lang="scss">
.support-auth {
  @include g-glass-panel(false);
  padding: 16px;
  border-radius: var(--g-r-sheet);
  border: 1px solid var(--g-hairline-2);
  box-shadow: var(--g-shadow-menu);
}

.support-auth__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.support-auth__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-1);
}

.support-auth__close {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--g-r-control);
  cursor: pointer;
}

.support-auth__close:hover :deep(.v-icon) {
  color: var(--g-text-1);
}

.support-auth__body {
  margin: 6px 0 14px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--g-text-2);
}

.support-auth__error {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.35;
  color: var(--g-error);
}

.support-auth__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.support-auth__btn {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--g-r-control);
  border: 1px solid var(--g-hairline-2);
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: var(--g-text-2);
  cursor: pointer;
  transition: color var(--g-dur-fast) ease, border-color var(--g-dur-fast) ease;
}

.support-auth__btn:hover:not(:disabled) {
  color: var(--g-text-1);
  border-color: var(--g-hairline-3);
}

.support-auth__btn--primary {
  border: none;
  background: var(--g-grad);
  color: var(--g-on-grad);
}

.support-auth__btn:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
