<template>
  <div class="onboarding-wrap">
    <div class="onboarding-card">
      <!-- Icon -->
      <div class="onboarding-icon-wrap">
        <div class="onboarding-icon-ring">
          <v-icon size="36" class="onboarding-icon">mdi-lightning-bolt</v-icon>
        </div>
      </div>

      <!-- Title -->
      <div class="onboarding-title">{{ $t('perpetuals.connectToStrike') }}</div>

      <!-- Description -->
      <div class="onboarding-desc">
        {{ needsUnlock ? $t('perpetuals.unlockStrikeDescription') : $t('perps.connect.description') }}
      </div>

      <!-- In-progress step indicator -->
      <div v-if="isLoading && connectStep !== 'idle'" class="onboarding-steps" aria-live="polite">
        <div
          v-for="(s, i) in stepLabels"
          :key="s.id"
          class="step-row"
          :class="{ 'step-active': activeIndex === i, 'step-done': activeIndex > i }"
        >
          <v-icon v-if="activeIndex > i" size="14" color="success" class="step-icon">mdi-check-circle</v-icon>
          <v-progress-circular
            v-else-if="activeIndex === i"
            indeterminate
            size="14"
            width="2"
            color="var(--g-accent)"
            class="step-icon"
          />
          <v-icon v-else size="14" color="var(--g-text-3)" class="step-icon">mdi-circle-outline</v-icon>
          <span class="step-label">{{ s.label }}</span>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="onboarding-error">
        <v-icon size="14" color="error" class="mr-1">mdi-alert-circle-outline</v-icon>
        <span>{{ error }}</span>
      </div>

      <!-- Key display (after generation/unlock) -->
      <div v-if="publicKey" class="key-card">
        <div class="key-card-label">
          <v-icon size="12" color="success" class="mr-1">mdi-check-circle</v-icon>
          {{ $t('perpetuals.keyGenerated') }}
        </div>
        <div class="key-row">
          <span class="key-value">{{ truncatedKey }}</span>
          <v-btn icon x-small class="copy-btn" @click="copyKey()">
            <v-icon size="14" :color="copied ? 'success' : 'var(--g-text-3)'">
              {{ copied ? 'mdi-check' : 'mdi-content-copy' }}
            </v-icon>
          </v-btn>
        </div>
      </div>

      <!-- PRF (passkey) wallet: authenticate with PassKey instead of password -->
      <template v-if="!isConnected && isPrfWallet">
        <PassKeyAuthButton
          :disabled="isLoading"
          :text="needsUnlock ? $t('perpetuals.unlockStrike') : $t('perps.connect.cta')"
          @success="onPassKeySuccess"
          @error="onPassKeyError"
        />
      </template>

      <!-- Password wallet: spending password field + action button -->
      <template v-else-if="!isConnected">
        <!-- Spending password (required to encrypt/decrypt the Strike key) -->
        <v-text-field
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          :label="$t('perpetuals.spendingPassword')"
          :append-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
          outlined
          dense
          hide-details
          autocomplete="current-password"
          class="password-field"
          :disabled="isLoading"
          @click:append="showPassword = !showPassword"
          @keyup.enter="onSubmit()"
        />

        <!-- Action button: Unlock if encrypted blob exists, otherwise Connect -->
        <v-btn
          block
          depressed
          :loading="isLoading"
          :disabled="!password"
          class="connect-btn"
          @click="onSubmit()"
        >
          <v-icon size="16" class="mr-2">{{ needsUnlock ? 'mdi-lock-open-variant' : 'mdi-link-variant' }}</v-icon>
          {{ needsUnlock ? $t('perpetuals.unlockStrike') : $t('perps.connect.cta') }}
        </v-btn>
      </template>

      <template v-else>
        <div class="connected-state">
          <v-icon size="16" color="success" class="mr-2">mdi-check-circle</v-icon>
          <span class="connected-label">{{ $t('perpetuals.connected') }}</span>
        </div>
        <v-btn
          block
          text
          :loading="isLoading"
          class="disconnect-btn"
          @click="onDisconnect()"
        >
          <v-icon size="14" class="mr-1">mdi-link-off</v-icon>
          {{ $t('perpetuals.disconnectStrike') }}
        </v-btn>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useStrikeOnboarding } from '@/modules/market/composables/useStrikeOnboarding';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import snackbar from '@/plugins/snackbar';
import i18n from '@/plugins/i18n';

const emit = defineEmits<{
  (e: 'connected'): void;
}>();

const t = (key: string): string => i18n.t(key) as string;

const {
  isConnected,
  needsUnlock,
  isPrfWallet,
  isLoading,
  publicKey,
  error,
  connectStep,
  checkConnection,
  unlock,
  connectWithWallet,
  disconnect,
} = useStrikeOnboarding();

const password = ref('');
const showPassword = ref(false);
const copied = ref(false);

const truncatedKey = computed(() => {
  if (!publicKey.value) return '';
  const key = publicKey.value;
  if (key.length <= 20) return key;
  return `${key.slice(0, 10)}...${key.slice(-8)}`;
});

// Step indicator — three logical phases visible to the user. The composable's
// internal 'finalizing' phase is folded into 'verifying' for UX simplicity.
const stepLabels = computed(() => [
  { id: 'requesting', label: t('perps.connect.stepRequesting') },
  { id: 'awaitingSignature', label: t('perps.connect.stepSigning') },
  { id: 'verifying', label: t('perps.connect.stepVerifying') },
]);

const activeIndex = computed(() => {
  switch (connectStep.value) {
    case 'requesting': return 0;
    case 'awaitingSignature': return 1;
    case 'verifying':
    case 'finalizing': return 2;
    default: return -1;
  }
});

async function onSubmit() {
  if (!password.value) return;
  const ok = needsUnlock.value
    ? await unlock(password.value)
    : await connectWithWallet(password.value);
  if (ok) password.value = '';
}

/**
 * PRF (passkey) wallets: PassKeyAuthButton has decrypted the wallet's root
 * private key and handed us the bytes. For connect we pass these to
 * connectWithWallet so the builder message is signed via SIGN_DATA's
 * privateKeyBytes path. For unlock we don't need the root key — unlock()
 * decrypts the stored Strike blob via its own passkey prompt — so we call it
 * with an empty password.
 */
async function onPassKeySuccess(pkBytes: Uint8Array) {
  if (needsUnlock.value) {
    await unlock('');
  } else {
    await connectWithWallet('', pkBytes);
  }
}

function onPassKeyError(err: Error) {
  snackbar.setError(err?.message || t('security.passKeyAuthFailed'));
}

async function onDisconnect() {
  await disconnect();
  password.value = '';
  showPassword.value = false;
}

async function copyKey() {
  if (!publicKey.value) return;
  try {
    await navigator.clipboard.writeText(publicKey.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // ignore
  }
}

onMounted(() => { checkConnection(); });

watch(isConnected, (val) => {
  if (val) emit('connected');
});
</script>

<style scoped>
.onboarding-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 24px 16px;
}

.onboarding-card {
  width: 100%;
  max-width: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  background: var(--g-surface);
  border-radius: var(--g-r-sheet);
  border: 1px solid var(--g-hairline-2);
  padding: 28px 20px 24px;
}

.onboarding-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.onboarding-icon-ring {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--g-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 25%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
}

.onboarding-icon {
  color: var(--g-accent) !important;
}

.onboarding-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--g-text-1);
  text-align: center;
  letter-spacing: -0.01em;
}

.onboarding-desc {
  font-size: 12px;
  color: var(--g-text-3);
  text-align: center;
  line-height: 1.55;
}

.onboarding-steps {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--g-r-control);
  background: color-mix(in srgb, var(--g-accent) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 18%, transparent);
}

.step-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--g-text-3);
  transition: color 0.2s ease;
}

.step-row.step-active {
  color: var(--g-text-1);
}

.step-row.step-done {
  color: var(--g-text-2);
}

.step-icon {
  flex-shrink: 0;
}

.onboarding-error {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: var(--g-r-control);
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  font-size: 11px;
  color: var(--g-error);
  width: 100%;
}

.key-card {
  width: 100%;
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
  border-radius: var(--g-r-control);
  padding: 10px 12px;
}

.key-card-label {
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--g-success);
  margin-bottom: 6px;
}

.key-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.key-value {
  font-size: 12px;
  font-family: var(--g-font-mono);
  color: var(--g-text-2);
}

.copy-btn {
  flex-shrink: 0;
}

.connect-btn {
  width: 100% !important;
  height: 42px !important;
  border-radius: var(--g-r-control) !important;
  background: color-mix(in srgb, var(--g-accent) 12%, transparent) !important;
  color: var(--g-accent) !important;
  border: 1px solid color-mix(in srgb, var(--g-accent) 30%, transparent) !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
  transition: background 0.18s ease !important;
}

.connect-btn:hover:not(.v-btn--disabled) {
  background: color-mix(in srgb, var(--g-accent) 20%, transparent) !important;
}

.connected-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border-radius: var(--g-r-control);
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
  width: 100%;
}

.connected-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--g-success);
}

.password-field {
  width: 100%;
}

.password-field >>> .v-input__slot {
  background: var(--g-raised) !important;
  border-radius: var(--g-r-control) !important;
  min-height: 42px;
}

.password-field >>> fieldset {
  border-color: var(--g-hairline-2) !important;
}

.password-field >>> input {
  color: var(--g-text-1) !important;
  font-size: 13px !important;
}

.password-field >>> .v-label {
  font-size: 12px !important;
  color: var(--g-text-3) !important;
}

.disconnect-btn {
  width: 100% !important;
  height: 32px !important;
  font-size: 11px !important;
  color: var(--g-text-3) !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
  margin-top: 4px !important;
}

.disconnect-btn:hover {
  color: var(--g-error) !important;
}
</style>
