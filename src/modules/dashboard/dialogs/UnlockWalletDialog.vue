<template>
  <BaseDialog
    :is-open="value"
    :title="$t('security.walletLocked') as string"
    :subtitle="unlockDescription"
    :width="400"
    icon="mdi-lock"
    @close="handleClose"
    :min-height="280"
  >
    <v-card-text class="pt-6 unlock-dialog">
        <div class="text-center mb-10">
          <v-avatar size="64" color="black">
            <v-img :src="resolveIcon(walletIcon)" />
          </v-avatar>
          <div class="mt-2 title white--text font-weight-bold">{{ walletName }}</div>
        </div>

        <!-- Loading overlay during unlock -->
        <div v-if="unlocking" class="unlock-loading-overlay">
          <v-progress-circular
            indeterminate
            color="primary"
            size="48"
          ></v-progress-circular>
          <div class="mt-4 subtitle-1 white--text">{{ $t('security.unlocking') }}</div>
        </div>

        <!-- Unlock method content -->
        <div v-else class="unlock-method-wrapper">
          <!-- PIN Input -->
          <div v-if="unlockMethod === 'pin'" class="text-center unlock-method-content pin-input-wrapper">
              <numeric-otp-input
                ref="pinInputRef"
                v-model="pinCode"
                :length="pinLength"
                :error="pinError"
                @finish="handlePinFinish"
              />

              <!-- Biometric indicator/button (if biometrics is enabled) -->
              <div v-if="biometricsEnabled && webAuthnCredentialId" class="mt-4 text-center">
                <v-btn
                  small
                  text
                  color="primary"
                  @click="handleBiometricAuth"
                  :loading="biometricLoading"
                >
                  <v-icon small left>mdi-fingerprint</v-icon>
                  {{ $t('security.useFingerprint') }}
                </v-btn>
              </div>
            </div>

            <!-- Pattern Input -->
            <div v-else-if="unlockMethod === 'pattern'" class="unlock-method-container unlock-method-content">
              <pattern-lock
                v-model="pattern"
                @complete="handlePatternComplete"
              />
            </div>

            <!-- Fallback: Spending Password -->
            <!-- Note: Biometrics is not a standalone unlock method UI -->
            <!-- It's triggered via the fingerprint button in PIN section or auto-trigger -->
            <div v-else class="unlock-method-container unlock-method-content">
              <v-tooltip
                v-model="tooltip.enabled"
                top
                color="red"
              >
                <template v-slot:activator="{ }">
                  <v-text-field
                    ref="passwordInputRef"
                    v-model="password"
                    :label="$t('security.spendingPassword')"
                    :type="show ? 'text' : 'password'"
                    :rules="[rules.required()]"
                    outlined
                    dense
                    hide-details
                    :append-icon="show ? 'mdi-eye-off' : 'mdi-eye'"
                    @click:append="show = !show"
                    @keyup.enter="handleUnlock"
                  ></v-text-field>
                </template>
                <span>{{ tooltip.text }}</span>
              </v-tooltip>
            </div>

          <!-- 2FA Input (if enabled) -->
          <div v-if="twoFactorEnabled && show2FA" class="mt-4">
            <v-text-field
              v-model="totpCode"
              :label="$t('security.authenticatorCode')"
              outlined
              dense
              maxlength="6"
              @keyup.enter="handleUnlock"
            ></v-text-field>
          </div>
        </div>
      </v-card-text>

      <!-- Unlock button (only for password method, PIN/Pattern auto-submit on completion) -->
      <v-card-actions v-if="unlockMethod === 'password' || unlockMethod === null" class="px-6 pb-6">
        <v-btn
          block
          color="primary"
          large
          @click="handleUnlock"
          :loading="unlocking"
          :disabled="!canUnlock"
        >
          {{ $t('security.unlock') }}
        </v-btn>
      </v-card-actions>

    <v-card-actions class="px-6 pb-6 pt-0">
      <v-btn
        block
        text
        color="error"
        plain
        small
        @click="handleLogout"
      >
        {{ $t('security.logoutInstead') }}
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, getCurrentInstance } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { walletStore } from '@/stores/walletStore';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import PatternLock from '../components/PatternLock.vue';
import NumericOtpInput from '@/shared/components/NumericOtpInput.vue';
import { authenticateWebAuthn } from '@/shared/utils/security';
import { resolveIcon } from '@/shared/utils/resolver';
import rules from '@/utils/rules';

// Define props and emits
const props = defineProps<{
  value: boolean;
  // Optional: for pre-login unlock (when no wallet is logged in yet)
  preLoginWalletId?: number | null;
  preLoginWalletName?: string | null;
  preLoginWalletIcon?: string | null;
}>();

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'unlocked'): void;
  (e: 'logged-out'): void;
}>();

// Access Vue instance for $t
const vmProxy = getCurrentInstance()!.proxy as any;

// Reactive state
const show = ref(false);
const unlockMethod = ref<string | null>(null);
const twoFactorEnabled = ref(false);
const show2FA = ref(false);
const biometricsEnabled = ref(false);
const webAuthnCredentialId = ref<string | null>(null);
const biometricAutoTriggerUnlock = ref(false);

const pinCode = ref('');
const pinLength = ref(4);
const pinError = ref('');
const pattern = ref<number[]>([]);
const password = ref('');
const totpCode = ref('');

const unlocking = ref(false);
const biometricLoading = ref(false);
const errorMessage = ref('');
const tooltip = ref<any>({
  enabled: false,
  text: ''
});

const walletName = ref('');
const walletIcon = ref('mdi-wallet');

// Template refs for validation reset
const pinInputRef = ref<any>(null);
const passwordInputRef = ref<any>(null);

// Computed properties
const canUnlock = computed(() => {
  if (unlocking.value) return false;

  if (unlockMethod.value === 'pin') {
    return pinCode.value.length >= 4;
  } else if (unlockMethod.value === 'pattern') {
    return pattern.value.length >= 4;
  } else {
    // Fallback to password
    return password.value.length > 0;
  }
});

const unlockDescription = computed(() => {
  if (unlockMethod.value === 'pin') {
    return vmProxy.$t('security.enterPinToUnlock');
  } else if (unlockMethod.value === 'pattern') {
    return vmProxy.$t('security.drawPatternToUnlock');
  } else {
    return vmProxy.$t('security.useSpendingPasswordToUnlock');
  }
});

// Helper to show error tooltip
function showError(message: string) {
  tooltip.value.text = message;
  tooltip.value.enabled = true;
  setTimeout(() => {
    tooltip.value.enabled = false;
  }, 2000);
}

// Methods
async function loadWalletInfo() {
  // Use pre-login props if provided, otherwise use logged wallet
  if (props.preLoginWalletId) {
    walletName.value = props.preLoginWalletName || 'Wallet';
    walletIcon.value = props.preLoginWalletIcon || 'mdi-wallet';
  } else {
    const wallet = walletStore.loggedWallet;
    if (wallet) {
      console.log('Wallet info:', wallet);
      walletName.value = wallet.name || 'Wallet';
      walletIcon.value = wallet.icon || 'mdi-wallet';
    }
  }
}

async function loadSecurityConfig() {
  try {
    // Use pre-login walletId if provided, otherwise use logged wallet
    const walletId = props.preLoginWalletId || walletStore.loggedWallet?.id;
    if (!walletId) return;

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(walletId);
    const configTable = db.table('config');

    const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
    const twoFactorConfig = await configTable.where({ key: 'twoFactorEnabled' }).first();
    const biometricsUnlockConfig = await configTable.where({ key: 'biometricsForUnlock' }).first();
    const credentialIdConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();
    const pinLengthConfig = await configTable.where({ key: 'pinLength' }).first();
    const autoTriggerUnlockConfig = await configTable.where({ key: 'biometricAutoTriggerUnlock' }).first();

    unlockMethod.value = unlockMethodConfig?.value || null;
    twoFactorEnabled.value = twoFactorConfig?.value || false;
    biometricsEnabled.value = biometricsUnlockConfig?.value || false;
    webAuthnCredentialId.value = credentialIdConfig?.value || null;
    pinLength.value = pinLengthConfig?.value || 6;
    biometricAutoTriggerUnlock.value = autoTriggerUnlockConfig?.value || false;

    // Note: Biometrics is NOT a standalone unlock method - it's a convenience feature
    // that works alongside PIN, password, or pattern
  } catch (error) {
    console.error('Error loading security config:', error);
    unlockMethod.value = null;
    twoFactorEnabled.value = false;
    biometricsEnabled.value = false;
    webAuthnCredentialId.value = null;
    pinLength.value = 6;
  }
}

async function handlePinFinish(pin: string) {
  pinCode.value = pin;
  if (twoFactorEnabled.value) {
    show2FA.value = true;
  } else {
    await handleUnlock();
  }
}

async function handlePatternComplete(patternData: number[]) {
  pattern.value = patternData;
  if (twoFactorEnabled.value) {
    show2FA.value = true;
  } else {
    await handleUnlock();
  }
}

async function handleBiometricAuth() {
  biometricLoading.value = true;

  try {
    if (!webAuthnCredentialId.value) {
      throw new Error('No WebAuthn credential found');
    }

    // Use WebAuthn for biometric authentication
    console.log('🔐 Authenticating with WebAuthn credential');
    const authenticated = await authenticateWebAuthn(webAuthnCredentialId.value);

    if (authenticated) {
      console.log('✅ Biometric authentication successful - unlocking wallet');

      // Biometric authentication successful - proceed to unlock
      // (No auto-fill, just pure authentication signal like iPhone Face ID)
      // Note: No need to modify unlockMethod - we use unlockCredential to signal biometric auth
      if (twoFactorEnabled.value) {
        show2FA.value = true;
      } else {
        await handleUnlock(true); // Pass biometricAuthenticated flag
      }
    } else {
      showError(vmProxy.$t('security.biometricFailed'));
    }
  } catch (error: any) {
    console.error('Biometric authentication error:', error);
    showError(error.message || vmProxy.$t('security.biometricFailed'));
  } finally {
    biometricLoading.value = false;
  }
}

async function handleUnlock(biometricAuthenticated = false) {
  if (!canUnlock.value && !biometricAuthenticated) return;

  unlocking.value = true;
  errorMessage.value = '';

  try {
    let unlockCredential: string | number[] | null;

    if (biometricAuthenticated) {
      // Biometric authentication already happened in handleBiometricAuth()
      // Signal to backend that biometric auth was successful
      unlockCredential = 'biometric-authenticated';
    } else if (unlockMethod.value === 'pin') {
      unlockCredential = pinCode.value;
    } else if (unlockMethod.value === 'pattern') {
      unlockCredential = pattern.value;
    } else {
      // Fallback to password
      unlockCredential = password.value;
    }

    // Use different message type for pre-login vs post-login unlock
    const isPreLoginUnlock = !!props.preLoginWalletId;
    const messageType = isPreLoginUnlock ? MessageTypes.VERIFY_PRE_LOGIN_UNLOCK : MessageTypes.UNLOCK;

    const response: any = await Messaging.sendToBackgroundFromOptions({
      method: messageType,
      data: {
        walletId: props.preLoginWalletId, // Only used for pre-login unlock
        unlockCredential, // Biometric auth signaled via special value 'biometric-authenticated'
        unlockMethod: unlockMethod.value,
        totpCode: twoFactorEnabled.value ? totpCode.value : undefined,
        password: password.value || undefined
      }
    });
    console.log('Unlock response:', response);
    if (response.data.success) {
      emit('input', false);
      emit('unlocked');
    } else {
      // Show errors for each unlock method
      if (unlockMethod.value === 'pin') {
        pinError.value = vmProxy.$t('security.incorrectPin');
        pinCode.value = '';  // Clear PIN input
      } else if (unlockMethod.value === 'pattern') {
        showError(vmProxy.$t('security.incorrectPattern'));
        pattern.value = [];  // Clear pattern
      } else {
        // Password unlock
        showError(vmProxy.$t('wallet.wrongSpendingPassword'));
        password.value = '';  // Clear password input
      }
    }
  } catch (error: any) {
    console.error('Unlock error:', error);
    // Show tooltip for unlock errors
    if (unlockMethod.value === 'pin') {
      pinError.value = error.message || vmProxy.$t('security.unlockFailed');
    } else {
      showError(error.message || vmProxy.$t('security.unlockFailed'));
    }
  } finally {
    unlocking.value = false;
  }
}

async function handleLogout() {
  try {
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGOUT,
      data: {}
    });

    emit('input', false);
    emit('logged-out');
  } catch (error) {
    console.error('Logout error:', error);
  }
}

function handleClose() {
  emit('input', false);
}

function resetForm() {
  pinCode.value = '';
  pinError.value = '';
  pattern.value = [];
  password.value = '';
  totpCode.value = '';
  errorMessage.value = '';
  show2FA.value = false;
  tooltip.value.enabled = false;
  tooltip.value.text = '';

  // Reset validation on input fields
  if (pinInputRef.value) {
    pinInputRef.value.resetValidation();
  }
  if (passwordInputRef.value) {
    passwordInputRef.value.resetValidation();
  }
}

// Watch for dialog open/close
watch(() => props.value, async (newVal) => {
  if (newVal) {
    // Load config and wallet info
    await Promise.all([
      loadSecurityConfig(),
      loadWalletInfo()
    ]);

    // Wait for component to mount in DOM
    await nextTick();

    // Auto-focus on the appropriate unlock method input
    if (unlockMethod.value === 'pin' && pinInputRef.value) {
      console.log('🎯 Auto-focusing PIN input');
      pinInputRef.value.focus();
    } else if ((unlockMethod.value === 'password' || !unlockMethod.value) && passwordInputRef.value) {
      console.log('🎯 Auto-focusing password input');
      passwordInputRef.value.focus();
    }
    // Pattern and biometrics don't need focus - pattern is already interactive, biometrics auto-triggers

    // Auto-trigger biometric prompt if auto-trigger setting is enabled
    // (Biometrics is a convenience feature, not a standalone unlock method)
    const shouldAutoTrigger = (
      biometricAutoTriggerUnlock.value &&
      biometricsEnabled.value &&
      webAuthnCredentialId.value
    );

    if (shouldAutoTrigger) {
      console.log('🔐 Auto-triggering biometric prompt (auto-trigger unlock is enabled)');
      // Reduced delay for smoother experience (200ms instead of 500ms)
      setTimeout(() => {
        handleBiometricAuth();
      }, 200);
    }
  } else {
    resetForm();
  }
});
</script>

<style scoped>
.unlock-dialog {
  border-radius: 16px;
}

/* Loading overlay during unlock */
.unlock-loading-overlay {
  min-height: 116px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

/* Wrapper for all unlock methods - ensures consistent height */
.unlock-method-wrapper {
  min-height: 116px;
}

/* Individual unlock method content */
.unlock-method-content {
  min-height: 70px;
}

/* PIN input wrapper - needs extra height for v-otp-input */
.pin-input-wrapper {
  min-height: 100px !important;
}

.unlock-method-container {
  min-height: 116px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: end;
}
</style>
