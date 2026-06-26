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
          <v-icon v-if="activeIndex > i" size="14" color="#26FAB0" class="step-icon">mdi-check-circle</v-icon>
          <v-progress-circular
            v-else-if="activeIndex === i"
            indeterminate
            size="14"
            width="2"
            color="#00c7f3"
            class="step-icon"
          />
          <v-icon v-else size="14" color="rgba(255,255,255,0.25)" class="step-icon">mdi-circle-outline</v-icon>
          <span class="step-label">{{ s.label }}</span>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="onboarding-error">
        <v-icon size="14" color="#F97066" class="mr-1">mdi-alert-circle-outline</v-icon>
        <span>{{ error }}</span>
      </div>

      <!-- Key display (after generation/unlock) -->
      <div v-if="publicKey" class="key-card">
        <div class="key-card-label">
          <v-icon size="12" color="#26FAB0" class="mr-1">mdi-check-circle</v-icon>
          {{ $t('perpetuals.keyGenerated') }}
        </div>
        <div class="key-row">
          <span class="key-value">{{ truncatedKey }}</span>
          <v-btn icon x-small class="copy-btn" @click="copyKey()">
            <v-icon size="14" :color="copied ? '#26FAB0' : 'rgba(255,255,255,0.45)'">
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
          <v-icon size="16" color="#26FAB0" class="mr-2">mdi-check-circle</v-icon>
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
  background:
    linear-gradient(180deg, rgba(19, 22, 27, 0.7) 0%, rgba(10, 12, 16, 0.8) 100%),
    radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--chain-primary) 8%, transparent) 0%, transparent 60%);
  backdrop-filter: blur(32px) saturate(1.6);
  -webkit-backdrop-filter: blur(32px) saturate(1.6);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 28px 20px 24px;
  box-shadow:
    0 8px 40px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
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
  background: color-mix(in srgb, var(--chain-primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--chain-primary) 25%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 24px color-mix(in srgb, var(--chain-primary) 15%, transparent);
}

.onboarding-icon {
  color: var(--chain-primary) !important;
}

.onboarding-title {
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
  text-align: center;
  letter-spacing: -0.01em;
}

.onboarding-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  line-height: 1.55;
}

.onboarding-steps {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(0, 199, 243, 0.04);
  border: 1px solid rgba(0, 199, 243, 0.18);
}

.step-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  transition: color 0.2s ease;
}

.step-row.step-active {
  color: #ffffff;
}

.step-row.step-done {
  color: rgba(255, 255, 255, 0.7);
}

.step-icon {
  flex-shrink: 0;
}

.step-label {
  letter-spacing: 0.01em;
}

.onboarding-error {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(249, 112, 102, 0.1);
  border: 1px solid rgba(249, 112, 102, 0.25);
  font-size: 11px;
  color: #F97066;
  width: 100%;
}

.key-card {
  width: 100%;
  background: rgba(38, 250, 176, 0.06);
  border: 1px solid rgba(38, 250, 176, 0.2);
  border-radius: 10px;
  padding: 10px 12px;
}

.key-card-label {
  display: flex;
  align-items: center;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #26FAB0;
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
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: rgba(255, 255, 255, 0.8);
  letter-spacing: 0.03em;
}

.copy-btn {
  flex-shrink: 0;
}

.connect-btn {
  width: 100% !important;
  height: 42px !important;
  border-radius: 10px !important;
  background: color-mix(in srgb, var(--chain-primary) 12%, transparent) !important;
  color: var(--chain-primary) !important;
  border: 1px solid color-mix(in srgb, var(--chain-primary) 30%, transparent) !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
  transition: background 0.18s ease !important;
}

.connect-btn:hover:not(.v-btn--disabled) {
  background: color-mix(in srgb, var(--chain-primary) 20%, transparent) !important;
}

.connected-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border-radius: 10px;
  background: rgba(38, 250, 176, 0.08);
  border: 1px solid rgba(38, 250, 176, 0.2);
  width: 100%;
}

.connected-label {
  font-size: 13px;
  font-weight: 700;
  color: #26FAB0;
}

.password-field {
  width: 100%;
}

.password-field >>> .v-input__slot {
  background: rgba(255, 255, 255, 0.04) !important;
  border-radius: 10px !important;
  min-height: 42px;
}

.password-field >>> fieldset {
  border-color: rgba(255, 255, 255, 0.12) !important;
}

.password-field >>> input {
  color: #ffffff !important;
  font-size: 13px !important;
}

.password-field >>> .v-label {
  font-size: 12px !important;
  color: rgba(255, 255, 255, 0.5) !important;
}

.disconnect-btn {
  width: 100% !important;
  height: 32px !important;
  font-size: 11px !important;
  color: rgba(255, 255, 255, 0.5) !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
  margin-top: 4px !important;
}

.disconnect-btn:hover {
  color: #F97066 !important;
}
</style>
