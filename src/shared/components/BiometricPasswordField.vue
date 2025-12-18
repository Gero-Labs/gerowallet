<template>
  <div class="biometric-password-field">
    <!-- Password Input with Biometric Icon -->
    <v-tooltip
      v-model="errorTooltipEnabled"
      top
      :color="errorTooltipColor"
    >
      <template v-slot:activator="{ }">
        <v-text-field
          ref="passwordInput"
          :value="value"
          @input="$emit('input', $event)"
          :label="label || $t('wallet.spendingPassword')"
          :placeholder="placeholder"
          :type="showPassword ? 'text' : 'password'"
          :rules="rules"
          :outlined="outlined"
          :dense="dense"
          :hide-details="hideDetails"
          :disabled="disabled"
          :required="required"
          @keydown.enter.stop="$emit('enter')"
          v-bind="$attrs"
          class="password-input"
        >
          <template v-slot:append>
            <v-icon @click="showPassword = !showPassword" tabindex="-1">
              {{ showPassword ? 'mdi-eye-off' : 'mdi-eye' }}
            </v-icon>
          </template>
          <template v-slot:append-outer v-if="biometricsAvailable">
            <v-btn
              small
              icon
              class="biometric-icon-wrapper"
              @click="handleBiometricClick"
              @touchstart="handleBiometricTouch"
            >
              <v-icon
                :disabled="biometricLoading || disabled"
                :color="biometricLoading ? 'grey' : 'primary'"
                class="biometric-icon"
                tabindex="-1"
              >
                {{ biometricLoading ? 'mdi-loading mdi-spin' : 'mdi-fingerprint' }}
              </v-icon>
            </v-btn>
          </template>
        </v-text-field>
      </template>
      <span>{{ errorTooltipText }}</span>
    </v-tooltip>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, getCurrentInstance } from 'vue';
import { walletStore } from '@/stores/walletStore';

// Props
interface Props {
  value: string;
  label?: string;
  placeholder?: string;
  rules?: any[];
  outlined?: boolean;
  dense?: boolean;
  hideDetails?: boolean;
  disabled?: boolean;
  required?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  outlined: false,
  dense: false,
  hideDetails: false,
  disabled: false,
  required: false,
});

// Emits
const emit = defineEmits<{
  (e: 'input', value: string): void;
  (e: 'enter'): void;
  (e: 'biometric-autofill-success'): void;
  (e: 'biometric-autofill-error', error: string): void;
}>();

// Access Vue instance for $t
const vmProxy = getCurrentInstance()!.proxy as any;

// Reactive state
const showPassword = ref(false);
const biometricsAvailable = ref(false);
const biometricLoading = ref(false);
const errorTooltipEnabled = ref(false);
const errorTooltipText = ref('');
const errorTooltipColor = ref('red');
const passwordInput = ref<any>(null);
const hasAutoTriggered = ref(false);

// Check biometrics availability on mount and auto-trigger
onMounted(async () => {
  biometricsAvailable.value = await checkBiometricsAvailable();
  console.log('checkBiometricsAvailable', biometricsAvailable.value)
  // Auto-trigger biometric authentication if available AND enabled in settings
  if (biometricsAvailable.value && !hasAutoTriggered.value) {
    // Check if auto-trigger is enabled
    const autoTriggerEnabled = await checkAutoTriggerEnabled();

    if (autoTriggerEnabled) {
      // Small delay to let the dialog render
      setTimeout(() => {
        console.log('🤖 Auto-triggering biometric authentication - place your finger on Touch ID');
        hasAutoTriggered.value = true;
        handleBiometricAutofill();
      }, 500);
    }
  }
});

/**
 * Check if biometric autofill is available for this wallet
 */
async function checkBiometricsAvailable(): Promise<boolean> {
  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) return false;

    // Check if WebAuthn is supported
    if (!window.PublicKeyCredential) return false;

    // Check if biometric autofill is enabled in DB
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    const biometricsAutofillConfig = await configTable.where({ key: 'biometricsForPasswordAutofill' }).first();
    const encryptedPasswordConfig = await configTable.where({ key: 'biometricEncryptedSpendingPassword' }).first();
    const credentialConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();

    return !!(
      biometricsAutofillConfig?.value &&
      encryptedPasswordConfig?.value &&
      credentialConfig?.value
    );
  } catch (error) {
    console.error('Error checking biometrics availability:', error);
    return false;
  }
}

/**
 * Check if auto-trigger is enabled for this wallet
 */
async function checkAutoTriggerEnabled(): Promise<boolean> {
  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) return false;

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    const autoTriggerConfig = await configTable.where({ key: 'biometricAutoTrigger' }).first();
    return autoTriggerConfig?.value || false;
  } catch (error) {
    console.error('Error checking auto-trigger setting:', error);
    return false;
  }
}

/**
 * Handle touch events for better mobile experience
 */
function handleBiometricTouch(event: TouchEvent) {
  console.log('👆 Touch detected on fingerprint icon');
  // Prevent default to avoid triggering click event twice
  event.preventDefault();
  event.stopPropagation();
  if (!biometricLoading.value && !props.disabled) {
    console.log('🚀 Triggering biometric authentication from touch');
    handleBiometricAutofill();
  } else {
    console.log('⏸️ Touch ignored - loading:', biometricLoading.value, 'disabled:', props.disabled);
  }
}

/**
 * Handle click events (desktop/mouse)
 */
function handleBiometricClick(event: MouseEvent) {
  // Only handle if not from a touch event (touch already handled)
  if (event.detail === 0) return; // Ignore programmatic clicks

  console.log('🖱️ Click detected on fingerprint icon');
  if (!biometricLoading.value && !props.disabled) {
    console.log('🚀 Triggering biometric authentication from click');
    handleBiometricAutofill();
  }
}

/**
 * Handle biometric authentication and password autofill
 */
async function handleBiometricAutofill() {
  biometricLoading.value = true;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    // Get database config
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    // Get WebAuthn credential ID
    const credentialConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();
    if (!credentialConfig || !credentialConfig.value) {
      throw new Error('Biometric credential not found');
    }

    // Get encrypted password
    const encryptedPasswordConfig = await configTable.where({ key: 'biometricEncryptedSpendingPassword' }).first();
    if (!encryptedPasswordConfig || !encryptedPasswordConfig.value) {
      throw new Error('Encrypted password not found');
    }

    console.log('🔐 Authenticating with biometrics...');

    // Authenticate with WebAuthn
    const { authenticateWebAuthn, decryptSpendingPasswordForBiometric } = await import('@/shared/utils/security');
    const authenticated = await authenticateWebAuthn(credentialConfig.value);

    if (!authenticated) {
      throw new Error('Biometric authentication failed');
    }

    console.log('✅ Biometric authentication successful');

    // Decrypt spending password
    const decryptedPassword = await decryptSpendingPasswordForBiometric(
      encryptedPasswordConfig.value,
      credentialConfig.value,
      wallet.id
    );

    console.log('🔓 Password decrypted successfully');

    // Auto-fill password
    emit('input', decryptedPassword);

    // Show success feedback
    showSuccessFeedback();

    // Emit success event - parent can trigger sign action
    emit('biometric-autofill-success');
  } catch (error: any) {
    console.error('❌ Biometric autofill failed:', error);

    // Show error tooltip
    errorTooltipText.value = error.message || vmProxy.$t('security.biometricAuthFailed');
    errorTooltipEnabled.value = true;
    setTimeout(() => {
      errorTooltipEnabled.value = false;
    }, 3000);

    // Emit error event
    emit('biometric-autofill-error', error.message);
  } finally {
    biometricLoading.value = false;
  }
}

/**
 * Show success feedback
 */
function showSuccessFeedback() {
  errorTooltipText.value = vmProxy.$t('security.biometricAuthSuccess');
  errorTooltipColor.value = 'success';
  errorTooltipEnabled.value = true;
  setTimeout(() => {
    errorTooltipEnabled.value = false;
    errorTooltipColor.value = 'red';
  }, 2000);
}

/**
 * Focus the password input
 */
function focus() {
  if (passwordInput.value) {
    passwordInput.value.focus();
  }
}

/**
 * Show error tooltip (for external errors like password verification)
 */
function showError(message: string, duration: number = 3000) {
  errorTooltipText.value = message;
  errorTooltipColor.value = 'red';
  errorTooltipEnabled.value = true;
  setTimeout(() => {
    errorTooltipEnabled.value = false;
  }, duration);
}

// Expose methods
defineExpose({
  focus,
  showError
});
</script>

<style scoped>
.biometric-password-field {
  width: 100%;
}

.biometric-icon-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  /* Ensure proper touch target size (min 44x44px for accessibility) */
  min-width: 40px;
  min-height: 40px;
  /* Prevent text selection on touch */
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  /* Remove tap highlight on mobile */
  -webkit-tap-highlight-color: transparent;
  /* Enable hardware acceleration for smoother touch */
  will-change: transform;
  transition: all 0.2s ease;
  border-radius: 50%;
  /* Make it more tappable */
  touch-action: manipulation;
}

.biometric-icon-wrapper:hover {
  transform: scale(1.1);
  background-color: rgba(255, 255, 255, 0.05);
}

/* Active/pressed state for touch feedback */
.biometric-icon-wrapper:active {
  transform: scale(0.95);
  background-color: rgba(255, 255, 255, 0.1);
}

.biometric-icon {
  pointer-events: none; /* Let wrapper handle all events */
}

.mdi-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
.biometric-password-field ::v-deep .v-input__append-outer {
  margin: 0 0 0 4px !important;
}
</style>
