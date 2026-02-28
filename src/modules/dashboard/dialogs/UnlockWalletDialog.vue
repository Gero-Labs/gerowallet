<template>
  <BaseDialog
    :is-open="value"
    :title="$t('security.walletLocked')"
    :subtitle="unlockDescription"
    :width="400"
    icon="mdi-lock"
    @close="handleClose"
    :min-height="280"
  >
    <v-card-text class="pt-6 unlock-dialog">
      <div class="text-center mb-8">
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

            <!-- PassKey indicator/button (if PassKey is enabled) -->
            <div v-if="passKeyEnabled && webAuthnCredentialId" class="mt-4 text-center">
              <v-btn
                small
                text
                color="primary"
                @click="handlePassKeyAuth"
                :loading="passKeyLoading"
              >
                <v-avatar size="18" class="mr-2">
                  <v-img
                    :src="assets.passKeySvg"
                    contain
                    class="passkey-icon"
                    :style="{
                  width: '18px',
                  height: '18px',
                  filter: 'brightness(0) saturate(100%) invert(71%) sepia(43%) saturate(4033%) hue-rotate(146deg) brightness(95%) contrast(103%)',
                  opacity: passKeyLoading ? '0.5' : 1,
                }"
                    tabindex="-1"
                  />
                </v-avatar>
                {{ $t('security.usePassKey') }}
              </v-btn>
            </div>
          </div>

          <!-- Pattern Input -->
          <div v-else-if="unlockMethod === 'pattern'" class="text-center unlock-method-container unlock-method-content">
            <pattern-lock
              v-model="pattern"
              @complete="handlePatternComplete"
            />

            <!-- PassKey indicator/button (if PassKey is enabled) -->
            <div v-if="passKeyEnabled && webAuthnCredentialId" class="mt-4 text-center">
              <v-btn
                small
                text
                color="primary"
                @click="handlePassKeyAuth"
                :loading="passKeyLoading"
              >
                <v-avatar size="18" class="mr-2">
                  <v-img
                    :src="assets.passKeySvg"
                    contain
                    class="passkey-icon"
                    :style="{
                  width: '18px',
                  height: '18px',
                  filter: 'brightness(0) saturate(100%) invert(71%) sepia(43%) saturate(4033%) hue-rotate(146deg) brightness(95%) contrast(103%)',
                  opacity: passKeyLoading ? '0.5' : 1,
                }"
                    tabindex="-1"
                  />
                </v-avatar>
                {{ $t('security.usePassKey') }}
              </v-btn>
            </div>
          </div>

          <div v-else class="unlock-method-content">
            <v-tooltip
              v-model="tooltip.enabled"
              top
              color="red"
            >
              <template v-slot:activator="{ }">
                <v-text-field
                  ref="passwordInputRef"
                  v-model="password"
                  :label="configLoaded ? (isPrfWallet ? $t('security.lockPassword') : $t('security.spendingPassword')) : $t('wallet.password')"
                  :type="show ? 'text' : 'password'"
                  :rules="[rules.required()]"
                  outlined
                  dense
                  hide-details
                  :append-icon="show ? 'mdi-eye-off' : 'mdi-eye'"
                  @click:append="show = !show"
                  @keydown.enter.stop="handleUnlock"
                >
                  <template v-slot:append-outer>
                    <v-btn
                      block
                      outlined
                      small
                      color="primary"
                      class="ml-2 px-1"
                      style="height: 40px;"
                      @click="handleUnlock"
                      :loading="unlocking"
                      :disabled="!canUnlock"
                    >
                      <v-icon>
                        mdi-arrow-right
                      </v-icon>
                    </v-btn>
                  </template>
                </v-text-field>

              </template>
              <span>{{ tooltip.text }}</span>
            </v-tooltip>

            <!-- PassKey indicator/button (if PassKey is enabled) -->
            <div v-if="passKeyEnabled && webAuthnCredentialId" class="mt-4 text-center">
              <v-btn
                small
                text
                color="primary"
                @click="handlePassKeyAuth"
                :loading="passKeyLoading"
              >
                <v-avatar size="18" class="mr-2">
                  <v-img
                    :src="assets.passKeySvg"
                    contain
                    class="passkey-icon"
                    :style="{
                  width: '18px',
                  height: '18px',
                  filter: 'brightness(0) saturate(100%) invert(71%) sepia(43%) saturate(4033%) hue-rotate(146deg) brightness(95%) contrast(103%)',
                  opacity: passKeyLoading ? '0.5' : 1,
                }"
                    tabindex="-1"
                  />
                </v-avatar>
                {{ $t('security.usePassKey') }}
              </v-btn>
            </div>
          </div>
      </div>
    </v-card-text>
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
import assets from '@/utils/assets';

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
const passKeyEnabled = ref(false);
const webAuthnCredentialId = ref<string | null>(null);
const passKeyAutoTriggerUnlock = ref(false);
const preLoginEncryptionMethod = ref<string | null>(null);
const cachedLockPasswordHash = ref<string | null>(null);

const pinCode = ref('');
const pinLength = ref(4);
const pinError = ref('');
const pattern = ref<number[]>([]);
const password = ref('');
const totpCode = ref('');

const unlocking = ref(false);
const passKeyLoading = ref(false);
const configLoaded = ref(false);
const configLoadError = ref(false);
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
const isPrfWallet = computed(() => {
  if (walletStore.loggedWallet) {
    return walletStore.loggedWallet.encryptionMethod === 'prf';
  }
  // Pre-login: use encryption method resolved from wallet record
  return preLoginEncryptionMethod.value === 'prf';
});

const canUnlock = computed(() => {
  if (unlocking.value || !configLoaded.value) return false;

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
    if (!configLoaded.value) return '';
    return isPrfWallet.value
      ? vmProxy.$t('security.useLockPasswordToUnlock')
      : vmProxy.$t('security.useSpendingPasswordToUnlock');
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
    if (!walletId) {
      configLoaded.value = true; // Allow interaction (fallback to password)
      return;
    }

    // Resolve encryption method for pre-login PRF detection
    if (props.preLoginWalletId) {
      const { getAllWallets } = await import('@/db/gero-db');
      const walletsMap = await getAllWallets();
      const walletRecord = walletsMap[walletId];
      preLoginEncryptionMethod.value = walletRecord?.encryptionMethod || null;
    }

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(walletId);
    const configTable = db.table('config');

    const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
    const twoFactorConfig = await configTable.where({ key: 'twoFactorEnabled' }).first();
    const passKeyUnlockConfig = await configTable.where({ key: 'passKeyForUnlock' }).first();
    const credentialIdConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();
    const pinLengthConfig = await configTable.where({ key: 'pinLength' }).first();
    const autoTriggerUnlockConfig = await configTable.where({ key: 'passKeyAutoTriggerUnlock' }).first();

    unlockMethod.value = unlockMethodConfig?.value || null;
    twoFactorEnabled.value = twoFactorConfig?.value || false;
    passKeyEnabled.value = passKeyUnlockConfig?.value || false;
    pinLength.value = pinLengthConfig?.value || 6;
    passKeyAutoTriggerUnlock.value = autoTriggerUnlockConfig?.value || false;

    // Pre-cache lock password hash for PRF wallets (avoids duplicate DB read in handleUnlock)
    if (unlockMethodConfig?.value === 'password') {
      const lockPasswordHashConfig = await configTable.where({ key: 'lockPasswordHash' }).first();
      cachedLockPasswordHash.value = lockPasswordHashConfig?.value || null;
    }

    // Check for PRF wallets: credential ID stored in wallet record, not config
    const wallet = walletStore.loggedWallet;
    const walletIsPrf = wallet?.encryptionMethod === 'prf';

    if (walletIsPrf && wallet?.webAuthnCredentialId) {
      // PRF wallet: Use credential from wallet record
      webAuthnCredentialId.value = wallet.webAuthnCredentialId;
      // PRF wallets can always use PassKey for unlock
      passKeyEnabled.value = true;
    } else {
      // Normal wallet: Use credential from config table
      webAuthnCredentialId.value = credentialIdConfig?.value || null;
    }

    // Note: PassKey is NOT a standalone unlock method - it's a convenience feature
    // that works alongside PIN, password, or pattern

    configLoaded.value = true;
  } catch (error) {
    console.error('Error loading security config:', error);
    unlockMethod.value = null;
    twoFactorEnabled.value = false;
    passKeyEnabled.value = false;
    webAuthnCredentialId.value = null;
    pinLength.value = 6;
    configLoaded.value = true; // Allow interaction even on error (fallback to password)
    configLoadError.value = true;
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

async function handlePassKeyAuth() {
  passKeyLoading.value = true;

  try {
    if (!webAuthnCredentialId.value) {
      throw new Error('No WebAuthn credential found');
    }

    // Use WebAuthn for PassKey authentication
    console.log('🔐 Authenticating with WebAuthn credential');
    const authenticated = await authenticateWebAuthn(webAuthnCredentialId.value);

    if (authenticated) {
      console.log('✅ PassKey authentication successful - unlocking wallet');

      // PassKey authentication successful - proceed to unlock
      // (No auto-fill, just pure authentication signal like iPhone Face ID)
      // Note: No need to modify unlockMethod - we use unlockCredential to signal PassKey auth
      if (twoFactorEnabled.value) {
        show2FA.value = true;
      } else {
        await handleUnlock(true); // Pass passKeyAuthenticated flag
      }
    } else {
      showError(vmProxy.$t('security.passKeyFailed'));
    }
  } catch (error: any) {
    console.error('PassKey authentication error:', error);
    showError(error.message || vmProxy.$t('security.passKeyFailed'));
  } finally {
    passKeyLoading.value = false;
  }
}

async function handleUnlock(passKeyAuthenticated = false) {
  if (!canUnlock.value && !passKeyAuthenticated) return;

  errorMessage.value = '';

  try {
    let unlockCredential: string | number[] | null;

    if (passKeyAuthenticated) {
      // PassKey authentication already happened in handlePassKeyAuth()
      // Signal to backend that PassKey auth was successful
      unlockCredential = 'passkey-authenticated';
    } else if (unlockMethod.value === 'pin') {
      unlockCredential = pinCode.value;
    } else if (unlockMethod.value === 'pattern') {
      unlockCredential = pattern.value;
    } else if (unlockMethod.value === 'password' && isPrfWallet.value) {
      // PRF wallet lock password: verify locally in browser context
      // (avoids crypto polyfill differences between browser and service worker)
      // Uses hash cached during loadSecurityConfig() to avoid duplicate DB read
      if (!cachedLockPasswordHash.value) {
        showError(vmProxy.$t(configLoadError.value ? 'security.unlockFailed' : 'security.lockPasswordNotConfigured'));
        return;
      }
      const { verifyPin } = await import('@/shared/utils/security');
      const isValid = await verifyPin(password.value, cachedLockPasswordHash.value);
      if (!isValid) {
        showError(vmProxy.$t('security.wrongLockPassword'));
        password.value = '';
        return;
      }
      // Verification passed — signal background (same pattern as passkey-authenticated)
      unlockCredential = 'lockpassword-verified';
    } else {
      // Fallback to spending password (normal wallets)
      unlockCredential = password.value;
    }

    // Use different message type for pre-login vs post-login unlock
    const isPreLoginUnlock = !!props.preLoginWalletId;
    const messageType = isPreLoginUnlock ? MessageTypes.VERIFY_PRE_LOGIN_UNLOCK : MessageTypes.UNLOCK;

    const response: any = await Messaging.sendToBackgroundFromOptions({
      method: messageType,
      data: {
        walletId: props.preLoginWalletId, // Only used for pre-login unlock
        unlockCredential, // PassKey auth signaled via special value 'passkey-authenticated'
        unlockMethod: unlockMethod.value,
        totpCode: twoFactorEnabled.value ? totpCode.value : undefined,
        password: password.value || undefined
      }
    });
    console.log('Unlock response:', response);
    if (response.data.success) {
      unlocking.value = true;
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
        // Password unlock — for PRF wallets, lock password was already verified locally
        // so a background failure means something else went wrong (DB error, wallet load, etc.)
        showError(isPrfWallet.value ? vmProxy.$t('security.unlockFailed') : vmProxy.$t('wallet.wrongSpendingPassword'));
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
  configLoaded.value = false;
  configLoadError.value = false;
  cachedLockPasswordHash.value = null;
  preLoginEncryptionMethod.value = null;
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
    // Pattern and PassKey don't need focus - pattern is already interactive, PassKey auto-triggers

    // Auto-trigger PassKey prompt if auto-trigger setting is enabled
    // (PassKey is a convenience feature, not a standalone unlock method)
    const shouldAutoTrigger = (
      passKeyAutoTriggerUnlock.value &&
      passKeyEnabled.value &&
      webAuthnCredentialId.value
    );

    if (shouldAutoTrigger) {
      console.log('🔐 Auto-triggering PassKey prompt (auto-trigger unlock is enabled)');
      // Reduced delay for smoother experience (200ms instead of 500ms)
      setTimeout(() => {
        handlePassKeyAuth();
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
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

/* Remove margin from append-outer slot */
:deep(.v-input__append-outer) {
  margin: 0!important;
}
</style>
