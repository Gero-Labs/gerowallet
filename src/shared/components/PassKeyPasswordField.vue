<template>
  <div class="passkey-password-field">
    <!-- Password Input with PassKey Icon -->
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
          <template v-slot:append-outer v-if="passKeyAvailable">
            <v-btn
              small
              icon
              class="passkey-icon-wrapper"
              @click="handlePassKeyClick"
              :disabled="passKeyLoading || disabled"
              :loading="passKeyLoading"
            >
              <v-avatar>
                <v-img
                  :src="assets.passKeySvg"
                  contain
                  class="passkey-icon"
                  :style="{
                    width: '24px',
                    height: '24px',
                    filter: 'brightness(0) saturate(100%) invert(71%) sepia(43%) saturate(4033%) hue-rotate(146deg) brightness(95%) contrast(103%)',
                    opacity: passKeyLoading ? '0.5' : 1,
                  }"
                  tabindex="-1"
                />
              </v-avatar>
            </v-btn>
          </template>
        </v-text-field>
      </template>
      <span>{{ errorTooltipText }}</span>
    </v-tooltip>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, getCurrentInstance, nextTick } from 'vue';
import { walletStore } from '@/stores/walletStore';
import assets from '@/utils/assets';
import { debugLog } from '@/utils/debug';
import { getDb } from '@/db/wallet-db';

// Props
interface Props {
  value: string;
  label?: string;
  placeholder?: string;
  rules?: any[];
  outlined?: boolean;
  dense?: boolean;
  /** `'auto'` reserves space for a validation error only while one is shown. */
  hideDetails?: boolean | 'auto';
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
  (e: 'passkey-autofill-success'): void;
  (e: 'passkey-autofill-error', error: string): void;
}>();

// Access Vue instance for $t
const vmProxy = getCurrentInstance()!.proxy as any;

// Reactive state
const showPassword = ref(false);
const passKeyAvailable = ref(false);
const passKeyLoading = ref(false);
const errorTooltipEnabled = ref(false);
const errorTooltipText = ref('');
const errorTooltipColor = ref('red');
const passwordInput = ref<any>(null);
const hasAutoTriggered = ref(false);

// Check passkey availability on mount and auto-trigger
onMounted(async () => {
  debugLog('[PassKeyField] Component mounted in context:', window.location.href);
  debugLog('[PassKeyField] WebAuthn supported:', !!window.PublicKeyCredential);
  debugLog('[PassKeyField] Hostname:', window.location.hostname);

  passKeyAvailable.value = await checkPassKeyAvailable();
  debugLog('[PassKeyField] checkPassKeyAvailable result:', passKeyAvailable.value);

  // Auto-trigger passkey authentication if available AND enabled in settings
  if (passKeyAvailable.value && !hasAutoTriggered.value) {
    // Set flag IMMEDIATELY to prevent race conditions on rapid re-mounts
    hasAutoTriggered.value = true;

    // Check if auto-trigger is enabled
    const autoTriggerEnabled = await checkAutoTriggerEnabled();
    debugLog('[PassKeyField] Auto-trigger enabled:', autoTriggerEnabled);

    if (autoTriggerEnabled) {
      // Small delay to let the dialog render
      setTimeout(() => {
        debugLog('🤖 Auto-triggering passkey authentication');
        handlePassKeyAutofill();
      }, 500);
    }
  }
});

/**
 * Check if passkey autofill is available for this wallet
 */
async function checkPassKeyAvailable(): Promise<boolean> {
  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) return false;

    // Check if WebAuthn is supported
    if (!window.PublicKeyCredential) return false;

    // Check if passkey autofill is enabled in DB
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    const passKeyAutofillConfig = await configTable.where({ key: 'passKeyForPasswordAutofill' }).first();
    const encryptedPasswordConfig = await configTable.where({ key: 'passKeyEncryptedSpendingPassword' }).first();
    const credentialConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();

    return !!(
      passKeyAutofillConfig?.value &&
      encryptedPasswordConfig?.value &&
      credentialConfig?.value
    );
  } catch (error) {
    console.error('Error checking passkey availability:', error);
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

    const autoTriggerConfig = await configTable.where({ key: 'passKeyAutoTrigger' }).first();
    return autoTriggerConfig?.value || false;
  } catch (error) {
    console.error('Error checking auto-trigger setting:', error);
    return false;
  }
}

/**
 * Handle click events (desktop/mouse)
 */
function handlePassKeyClick(event: MouseEvent) {
  // Only handle if not from a touch event (touch already handled)
  if (event.detail === 0) return; // Ignore programmatic clicks
  if (!passKeyLoading.value && !props.disabled) {
    handlePassKeyAutofill();
  }
}

/**
 * Check if we're in a sidepanel context
 */
function isSidepanelContext(): boolean {
  // Check both regular search params and hash-based params (for hash router)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('tabId')) return true;

  // Parse hash for query params (e.g., #/sign-tx?tabId=123)
  const hash = window.location.hash;
  const queryStart = hash.indexOf('?');
  if (queryStart !== -1) {
    const hashParams = new URLSearchParams(hash.substring(queryStart));
    return hashParams.has('tabId');
  }

  return false;
}

/**
 * Handle passkey authentication and password autofill
 */
async function handlePassKeyAutofill() {
  passKeyLoading.value = true;

  const isSidepanel = isSidepanelContext();

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
      throw new Error('PassKey credential not found');
    }

    // Get encrypted password
    const encryptedPasswordConfig = await configTable.where({ key: 'passKeyEncryptedSpendingPassword' }).first();
    if (!encryptedPasswordConfig || !encryptedPasswordConfig.value) {
      throw new Error('Encrypted password not found');
    }

    debugLog('🔐 Authenticating with passkey...');

    // Check if we're in sidepanel - WebAuthn doesn't work in sidepanel context
    if (isSidepanel) {
      // Open popup window for authentication
      const popupUrl = chrome.runtime.getURL('index.html#/passkey-auth');
      const authWindow = window.open(
        popupUrl,
        'passkey-auth',
        'width=500,height=600,popup=yes'
      );

      if (!authWindow) {
        throw new Error('Failed to open authentication window. Please allow popups for this extension.');
      }

      // Wait for authentication result via message
      const result = await new Promise<{ success: boolean; password?: string; error?: string }>((resolve) => {
        const messageHandler = (event: MessageEvent) => {
          if (event.data?.type === 'PASSKEY_AUTH_RESULT') {
            window.removeEventListener('message', messageHandler);
            authWindow.close();
            resolve(event.data.payload);
          }
        };
        window.addEventListener('message', messageHandler);

        // Timeout after 60 seconds
        setTimeout(() => {
          window.removeEventListener('message', messageHandler);
          authWindow.close();
          resolve({ success: false, error: 'Authentication timeout' });
        }, 60000);
      });

      // In sidepanel mode, treat all popup errors as potential user cancellations
      // If there's a real error, the popup shows it for 3 seconds before closing
      // This prevents showing duplicate error messages in the parent window
      if (!result.success || !result.password) {
        debugLog('ℹ️ PassKey authentication did not complete (user may have cancelled)');
        // Don't throw error - just return silently
        return;
      }

      // Auto-fill password
      emit('input', result.password);

      // Wait for Vue to propagate the password value, then emit success
      await nextTick();
      showSuccessFeedback();
      // emit('passkey-autofill-success');
    } else {
      // Normal context - decrypt directly using PRF (authentication happens during PRF evaluation)
      const { decryptSpendingPasswordWithPrf } = await import('@/shared/utils/webauthn-prf');

      // Decrypt spending password using PRF (includes authentication)
      const decryptedPassword = await decryptSpendingPasswordWithPrf(
        encryptedPasswordConfig.value,
        credentialConfig.value,
        wallet.id
      );

      // Auto-fill password
      emit('input', decryptedPassword);

      // Wait for Vue to propagate the password value, then emit success
      await nextTick();
      showSuccessFeedback();
      // emit('passkey-autofill-success');
    }
  } catch (error: any) {
    console.error('❌ PassKey autofill failed:', error);

    // Check if this is a user cancellation (not an actual error)
    const isUserCancellation =
      error.name === 'NotAllowedError' ||
      error.name === 'AbortError' ||
      error.message?.toLowerCase().includes('cancel') ||
      error.message?.toLowerCase().includes('abort') ||
      error.message?.toLowerCase().includes('user');

    if (isUserCancellation) {
      // User cancelled - this is normal, don't show error
      debugLog('ℹ️ PassKey authentication cancelled by user');
      // Just reset the loading state, no error message
    } else {
      // Actual error - show error tooltip
      errorTooltipText.value = error.message || vmProxy.$t('security.passKeyAuthFailed');
      errorTooltipEnabled.value = true;
      setTimeout(() => {
        errorTooltipEnabled.value = false;
      }, 3000);

      // Emit error event
      emit('passkey-autofill-error', error.message);
    }
  } finally {
    passKeyLoading.value = false;
  }
}

/**
 * Show success feedback
 */
function showSuccessFeedback() {
  errorTooltipText.value = vmProxy.$t('security.passKeyAuthSuccess');
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
.passkey-password-field {
  width: 100%;
}

.passkey-icon-wrapper {
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

.passkey-icon-wrapper:hover {
  transform: scale(1.1);
  background-color: rgba(255, 255, 255, 0.05);
}

/* Active/pressed state for touch feedback */
.passkey-icon-wrapper:active {
  transform: scale(0.95);
  background-color: rgba(255, 255, 255, 0.1);
}

.passkey-icon {
  pointer-events: none; /* Let wrapper handle all events */
}

.mdi-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
.passkey-password-field ::v-deep .v-input__append-outer {
  margin: 0 0 0 4px !important;
}
</style>
