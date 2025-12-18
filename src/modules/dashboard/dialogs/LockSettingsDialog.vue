<template>
  <BaseDialog
    :is-open="value"
    :title="$t('security.lockSettings')"
    :subtitle="dialogSubtitle"
    :width="600"
    icon="mdi-shield-lock-outline"
    @close="handleClose"
    :min-height="300"
  >
    <v-card-text class="px-3 py-0 lock-settings-dialog">
      <!-- Unlock Method Section -->
      <v-card class="transparent" flat>
        <v-card-title class="justify-center pt-0">
          <v-icon color="primary" class="mr-1" small>mdi-lock-outline</v-icon>
          <span class="subtitle-1 font-weight-bold">{{ $t('security.unlockMethod') }}</span>
        </v-card-title>
        <v-card-subtitle class="text-center">
          {{ $t('security.selectHowToUnlock') }}
        </v-card-subtitle>
        <v-card-text class="pa-0">
          <v-list dense class="pa-0 transparent" nav>
            <!-- None -->
            <v-list-item two-line @click="handleUnlockMethodSelect(null)" class="mb-0">
              <v-list-item-avatar class="my-0">
                <v-icon>mdi-lock-off-outline</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.none') }}</v-list-item-title>
                <v-list-item-subtitle>{{ $t('security.noUnlockMethodRequired') }}</v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-icon v-if="selectedUnlockMethod === null" style="align-self: center;">
                <v-icon color="primary">mdi-check-circle</v-icon>
              </v-list-item-icon>
            </v-list-item>

            <v-divider class="mx-1" />

            <!-- Spending Password (Normal wallets only) -->
            <v-list-item two-line v-if="isNormalWallet" @click="handleUnlockMethodSelect('password')" class="mb-0">
              <v-list-item-avatar class="my-0">
                <v-icon>mdi-form-textbox-password</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.spendingPassword') }}</v-list-item-title>
                <v-list-item-subtitle>{{ $t('security.useSpendingPasswordToUnlock') }}</v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-icon v-if="selectedUnlockMethod === 'password'" style="align-self: center;">
                <v-icon color="primary">mdi-check-circle</v-icon>
              </v-list-item-icon>
            </v-list-item>

            <v-divider v-if="isNormalWallet" class="mx-1" />

            <!-- PIN Code -->
            <v-list-item two-line @click="handleUnlockMethodSelect('pin')" class="mb-0">
              <v-list-item-avatar class="my-0">
                <v-icon>mdi-numeric</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.pin') }}</v-list-item-title>
                <v-list-item-subtitle>{{ $t('security.4To6DigitCode') }}</v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-icon v-if="selectedUnlockMethod === 'pin'" style="align-self: center;">
                <v-icon color="primary">mdi-check-circle</v-icon>
              </v-list-item-icon>
            </v-list-item>

            <v-divider class="mx-1" />

            <!-- Pattern -->
            <v-list-item two-line @click="handleUnlockMethodSelect('pattern')" class="mb-0">
              <v-list-item-avatar class="my-0">
                <v-icon>mdi-lock-pattern</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.pattern') }}</v-list-item-title>
                <v-list-item-subtitle>{{ $t('security.drawPatternToUnlock') }}</v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-icon v-if="selectedUnlockMethod === 'pattern'" style="align-self: center;">
                <v-icon color="primary">mdi-check-circle</v-icon>
              </v-list-item-icon>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>

      <v-divider class="my-5 mx-1" />

      <!-- Auto-Lock Timer Section -->
      <v-card class="transparent" flat :disabled="selectedUnlockMethod === null">
        <v-card-title class="justify-center pt-0">
          <v-icon color="primary" class="mr-1" small>mdi-timer-lock-outline</v-icon>
          <span class="subtitle-1 font-weight-bold">{{ $t('security.autoLockTimer') }}</span>
        </v-card-title>
        <v-card-subtitle class="text-center">
          {{ $t('security.walletLocksAfterInactivity') }}
        </v-card-subtitle>
        <v-card-text class="pa-0">
          <v-select
            v-model="selectedAutoLockMinutes"
            :items="autoLockOptions"
            :label="$t('security.autoLockTimer')"
            item-value="value"
            item-text="text"
            outlined
            dense
            attach
            hide-details
            @change="handleAutoLockSelect"
          >
            <template v-slot:selection="{ item }">
              <v-icon left small>{{ item.icon }}</v-icon>
              {{ item.text }}
            </template>
            <template v-slot:item="{ item }">
              <v-list-item-content>
                <v-list-item-title>
                  <v-icon left small>{{ item.icon }}</v-icon>
                  {{ item.text }}
                </v-list-item-title>
              </v-list-item-content>
            </template>
          </v-select>
        </v-card-text>
      </v-card>

      <v-divider class="my-5 mx-1" />

      <!-- Biometrics Section -->
      <v-card class="transparent" flat>
        <v-card-title class="justify-center pt-0">
          <v-icon color="primary" class="mr-1" small>mdi-fingerprint</v-icon>
          <span class="subtitle-1 font-weight-bold">{{ $t('security.biometricsSettings') }}</span>
        </v-card-title>
        <v-card-subtitle class="text-center">
          {{ $t('security.configureBiometricsIndependently') }}
        </v-card-subtitle>
        <v-card-text class="pa-0">
          <!-- Browser Support Notice -->
          <v-alert
            v-if="!isBiometricsSupported"
            type="warning"
            dense
            class="mb-4"
          >
            {{ $t('security.biometricsNotSupported') }}
          </v-alert>

          <v-list dense class="pa-0 transparent" nav>
            <!-- Use Biometrics for Password Autofill (Normal wallets only) -->
            <v-list-item v-if="isNormalWallet">
              <v-list-item-avatar class="my-0">
                <v-icon>mdi-form-textbox-password</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.useBiometricsForPasswordAutofill') }}</v-list-item-title>
                <v-list-item-subtitle>{{ $t('security.useBiometricsForPasswordAutofillDescription') }}</v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action>
                <v-switch
                  inset
                  dense
                  v-model="biometricsForPasswordAutofill"
                  color="primary"
                  :disabled="!isBiometricsSupported"
                  @change="handleBiometricsAutofillChange"
                ></v-switch>
              </v-list-item-action>
            </v-list-item>

            <!-- Auto-Trigger Biometric Authentication (Normal wallets only) -->
            <v-list-item v-if="isNormalWallet" :disabled="!biometricsForPasswordAutofill">
              <v-list-item-avatar class="my-0">
                <v-icon :disabled="!biometricsForPasswordAutofill">mdi-fingerprint</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.autoTriggerBiometricsPasswordAutofill') }}</v-list-item-title>
                <v-list-item-subtitle v-if="!biometricsForPasswordAutofill">
                  {{ $t('security.autoTriggerRequiresAutofill') }}
                </v-list-item-subtitle>
                <v-list-item-subtitle v-else>
                  {{ $t('security.autoTriggerBiometricsPasswordAutofillDescription') }}
                </v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action>
                <v-switch
                  inset
                  dense
                  v-model="biometricAutoTrigger"
                  color="primary"
                  :disabled="!isBiometricsSupported || !biometricsForPasswordAutofill"
                  @change="handleBiometricAutoTriggerChange"
                ></v-switch>
              </v-list-item-action>
            </v-list-item>

            <v-divider class="my-3 mx-1" v-if="isNormalWallet" />

            <!-- Use Biometrics for Unlocking -->
            <v-list-item :disabled="isBiometricsUnlockDisabled">
              <v-list-item-avatar class="my-0">
                <v-icon :disabled="isBiometricsUnlockDisabled">mdi-lock-open-outline</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.useBiometricsForUnlock') }}</v-list-item-title>
                <v-list-item-subtitle v-if="!selectedUnlockMethod">
                  {{ $t('security.biometricsRequiresUnlockMethod') }}
                </v-list-item-subtitle>
                <v-list-item-subtitle v-else>
                  {{ $t('security.useBiometricsForUnlockDescription') }}
                </v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action>
                <v-switch
                  inset
                  dense
                  v-model="biometricsForUnlock"
                  color="primary"
                  @change="handleBiometricsUnlockChange"
                  :disabled="isBiometricsUnlockDisabled"
                ></v-switch>
              </v-list-item-action>
            </v-list-item>

            <!-- Auto-Trigger Biometric Authentication for Unlock -->
            <v-list-item :disabled="!biometricsForUnlock">
              <v-list-item-avatar class="my-0">
                <v-icon :disabled="!biometricsForUnlock">mdi-fingerprint</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.autoTriggerBiometricsUnlock') }}</v-list-item-title>
                <v-list-item-subtitle v-if="!biometricsForUnlock">
                  {{ $t('security.autoTriggerRequiresBiometricUnlock') }}
                </v-list-item-subtitle>
                <v-list-item-subtitle v-else>
                  {{ $t('security.autoTriggerBiometricsUnlockDescription') }}
                </v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action>
                <v-switch
                  inset
                  dense
                  v-model="biometricAutoTriggerUnlock"
                  color="primary"
                  :disabled="!isBiometricsSupported || !biometricsForUnlock"
                  @change="handleBiometricAutoTriggerUnlockChange"
                ></v-switch>
              </v-list-item-action>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>
    </v-card-text>

    <!-- Password Input Dialog -->
    <v-dialog v-model="showPasswordDialog" max-width="400" persistent>
      <v-card>
        <v-card-title class="headline">
          {{ $t('security.enterSpendingPassword') }}
        </v-card-title>
        <v-card-text class="pt-8">
          <v-tooltip
            v-model="passwordErrorTooltipEnabled"
            top
            :color="passwordErrorTooltipColor"
          >
            <template v-slot:activator="{ }">
              <v-text-field
                v-model="passwordInput"
                :label="$t('wallet.spendingPassword')"
                :type="showPasswordInDialog ? 'text' : 'password'"
                :append-icon="showPasswordInDialog ? 'mdi-eye-off' : 'mdi-eye'"
                @click:append="showPasswordInDialog = !showPasswordInDialog"
                @keyup.enter="confirmPassword"
                autofocus
                outlined
                dense
                hide-details
              ></v-text-field>
            </template>
            <span>{{ passwordErrorTooltipText }}</span>
          </v-tooltip>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="cancelPassword">
            {{ $t('common.cancel') }}
          </v-btn>
          <v-btn color="primary" text @click="confirmPassword" :disabled="!passwordInput">
            {{ $t('common.confirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </BaseDialog>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';
import type { UnlockMethod } from '@/shared/utils/security';
import { registerWebAuthnCredential } from '@/shared/utils/security';
import snackbar from '@/plugins/snackbar';
import { markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';

const { t } = useTranslation();

// Response type from background messaging
interface BackgroundResponse<T = any> {
  data: T;
  target: string;
  sender: string;
}

interface VerifyPasswordResponse {
  success: boolean;
  error?: string;
}

// Props
interface Props {
  value: boolean;
  reloadTrigger?: number;
}

const props = withDefaults(defineProps<Props>(), {
  reloadTrigger: 0
});

// Emits
const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'setup-unlock-method', method: UnlockMethod): void;
  (e: 'updated'): void;
}>();

// Reactive state
const selectedUnlockMethod = ref<UnlockMethod>(null);
const selectedAutoLockMinutes = ref(0);
const customMinutes = ref<number | null>(null);
const showCustomInput = ref(false);
const biometricsForUnlock = ref(false);
const biometricsForPasswordAutofill = ref(false);
const biometricAutoTrigger = ref(false);
const biometricAutoTriggerUnlock = ref(false);
const isBiometricsSupported = ref(false);
const loading = ref(false);
const loadingBiometricsUnlock = ref(false);
const loadingBiometricsAutofill = ref(false);
const errorMessage = ref('');
const successMessage = ref('');

// Password dialog state
const showPasswordDialog = ref(false);
const passwordInput = ref('');
const showPasswordInDialog = ref(false);
const passwordErrorTooltipEnabled = ref(false);
const passwordErrorTooltipText = ref('');
const passwordErrorTooltipColor = ref('red');
let passwordResolve: ((value: string | null) => void) | null = null;

// Computed properties
const isNormalWallet = computed(() => {
  const wallet = walletStore.loggedWallet;
  return wallet?.type === WalletType.Normal;
});

const isBiometricsUnlockDisabled = computed(() => {
  // Disable if browser doesn't support biometrics, if loading biometrics unlock, or if no unlock method is set
  return !isBiometricsSupported.value || loadingBiometricsUnlock.value || !selectedUnlockMethod.value;
});

const dialogSubtitle = computed(() => {
  return t('security.lockSettingsDescription');
});

const autoLockOptions = computed(() => {
  return [
    { value: 1, text: t('security.1Minute'), icon: 'mdi-timer-outline' },
    { value: 5, text: t('security.xMinutes', { minutes: 5 }), icon: 'mdi-timer-outline' },
    { value: 15, text: t('security.xMinutes', { minutes: 15 }), icon: 'mdi-timer-outline' },
    { value: 30, text: t('security.xMinutes', { minutes: 30 }), icon: 'mdi-timer-outline' },
    { value: 60, text: t('security.1Hour'), icon: 'mdi-clock-outline' },
    { value: 120, text: t('security.xHours', { hours: 2 }), icon: 'mdi-clock-outline' }
  ];
});

// Watchers
watch(() => props.value, (newVal) => {
  if (newVal) {
    // Mark feature as seen when dialog opens
    markFeatureAsSeen('settings.security.lockSettings');
    loadCurrentSettings();
  } else {
    resetForm();
  }
});

watch(() => props.reloadTrigger, () => {
  // Reload settings when trigger changes
  if (props.value) {
    loadCurrentSettings();
  }
});

// Check biometrics support immediately on component creation
function checkBiometricsSupport() {
  // Check if WebAuthn is supported
  isBiometricsSupported.value = !!window.PublicKeyCredential;
}

// Initialize biometrics support check immediately
checkBiometricsSupport();

async function loadCurrentSettings() {
  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) return;

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    // Load unlock method
    const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
    selectedUnlockMethod.value = unlockMethodConfig?.value || null;

    // Load auto-lock timer
    const autoLockConfig = await configTable.where({ key: 'autoLockMinutes' }).first();
    let autoLockMinutes = autoLockConfig?.value || 0;

    // If unlock method is set but auto-lock is 0 (old "Never" value), default to 5 minutes
    if (selectedUnlockMethod.value && autoLockMinutes === 0) {
      autoLockMinutes = 5;
      // Save the new default value
      await configTable.put({ key: 'autoLockMinutes', value: 5 });
    }

    selectedAutoLockMinutes.value = autoLockMinutes;

    // Load biometric settings
    const biometricsUnlockConfig = await configTable.where({ key: 'biometricsForUnlock' }).first();
    const biometricsAutofillConfig = await configTable.where({ key: 'biometricsForPasswordAutofill' }).first();
    const biometricAutoTriggerConfig = await configTable.where({ key: 'biometricAutoTrigger' }).first();
    const biometricAutoTriggerUnlockConfig = await configTable.where({ key: 'biometricAutoTriggerUnlock' }).first();
    biometricsForUnlock.value = biometricsUnlockConfig?.value || false;
    biometricsForPasswordAutofill.value = biometricsAutofillConfig?.value || false;
    biometricAutoTrigger.value = biometricAutoTriggerConfig?.value || false;
    biometricAutoTriggerUnlock.value = biometricAutoTriggerUnlockConfig?.value || false;

    // Check biometrics support
    checkBiometricsSupport();
  } catch (error) {
    console.error('Error loading security settings:', error);
    selectedUnlockMethod.value = null;
    selectedAutoLockMinutes.value = 0;
    biometricsForUnlock.value = false;
    biometricsForPasswordAutofill.value = false;
    biometricAutoTrigger.value = false;
    biometricAutoTriggerUnlock.value = false;
  }
}

async function handleUnlockMethodSelect(method: UnlockMethod) {
  errorMessage.value = '';

  if (method === null || method === 'password') {
    // These methods don't require setup, save immediately
    await saveUnlockMethod(method);
  } else {
    // PIN and Pattern require setup
    emit('setup-unlock-method', method);
  }
}

async function saveUnlockMethod(method: UnlockMethod) {
  loading.value = true;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    if (method === null) {
      // Remove all unlock method data
      await configTable.put({ key: 'unlockMethod', value: null });
      await configTable.where({ key: 'pinHash' }).delete();
      await configTable.where({ key: 'encryptedPinHash' }).delete();
      await configTable.where({ key: 'encryptedPatternHash' }).delete();
      await configTable.where({ key: 'webAuthnCredentialId' }).delete();

      // Disable biometric unlock when unlock method is set to None
      await configTable.put({ key: 'biometricsForUnlock', value: false });
      await configTable.put({ key: 'biometricAutoTriggerUnlock', value: false });

      // Update reactive state to reflect changes in UI
      biometricsForUnlock.value = false;
      biometricAutoTriggerUnlock.value = false;
    } else {
      // Save unlock method
      await configTable.put({ key: 'unlockMethod', value: method });
    }

    selectedUnlockMethod.value = method;

    // Emit update event
    emit('updated');
  } catch (error: any) {
    console.error('Error saving unlock method:', error);
    errorMessage.value = error.message || t('security.unlockMethodUpdateFailed');
  } finally {
    loading.value = false;
  }
}

async function handleAutoLockSelect(minutes: number) {
  loading.value = true;
  errorMessage.value = '';

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    await configTable.put({ key: 'autoLockMinutes', value: minutes });

    selectedAutoLockMinutes.value = minutes;

    // Emit update event
    emit('updated');
  } catch (error: any) {
    console.error('Error saving auto-lock setting:', error);
    errorMessage.value = error.message || t('security.autoLockUpdateFailed');
  } finally {
    loading.value = false;
  }
}

async function handleBiometricsUnlockChange(enabled: boolean) {
  loadingBiometricsUnlock.value = true;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    if (enabled) {
      // Register WebAuthn credential (biometric authentication)
      console.log('🔐 Registering WebAuthn credential for biometric unlock');
      const credentialId = await registerWebAuthnCredential(wallet.id, wallet.name || 'Wallet');

      // Store credential ID in database
      await configTable.put({ key: 'webAuthnCredentialId', value: credentialId });
      console.log('✅ WebAuthn credential registered - biometric unlock enabled');
    } else {
      // Remove WebAuthn credential from database
      console.log('🗑️ Removing WebAuthn credential');
      await configTable.where({ key: 'webAuthnCredentialId' }).delete();
    }

    // Save biometric unlock setting
    await configTable.put({ key: 'biometricsForUnlock', value: enabled });

    // Show success snackbar
    snackbar.fireSuccess(t('security.biometricsSettingsUpdated'));

    // Emit update event
    emit('updated');
  } catch (error: any) {
    console.error('Error saving biometric unlock setting:', error);

    // Show error snackbar
    snackbar.setError(error.message || t('security.biometricsSettingsUpdateFailed'));

    // Revert the switch
    biometricsForUnlock.value = !enabled;
  } finally {
    loadingBiometricsUnlock.value = false;
  }
}

async function handleBiometricsAutofillChange(enabled: boolean) {
  loadingBiometricsAutofill.value = true;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    if (enabled) {
      // When enabling, prompt for spending password to encrypt and store
      // Password verification happens inside the dialog's confirmPassword() function
      const password = await promptForSpendingPassword();

      if (!password) {
        // User cancelled
        throw new Error('Password prompt cancelled');
      }

      // Password is already verified at this point
      // Get or register WebAuthn credential
      let credentialConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();
      let credentialId: string;

      if (!credentialConfig || !credentialConfig.value) {
        // No credential exists - register a new one for biometric autofill
        console.log('🔐 Registering WebAuthn credential for biometric password autofill');
        credentialId = await registerWebAuthnCredential(wallet.id, wallet.name || 'Wallet');

        // Store credential ID in database
        await configTable.put({ key: 'webAuthnCredentialId', value: credentialId });
        console.log('✅ WebAuthn credential registered');
      } else {
        // Use existing credential
        credentialId = credentialConfig.value;
        console.log('🔐 Using existing WebAuthn credential for biometric password autofill');
      }

      // Encrypt password for biometric storage
      const { encryptSpendingPasswordForBiometric } = await import('@/shared/utils/security');
      const encryptedPassword = await encryptSpendingPasswordForBiometric(password, credentialId, wallet.id);

      // Store encrypted password in database
      await configTable.put({
        key: 'biometricEncryptedSpendingPassword',
        value: encryptedPassword
      });

      console.log('✅ Spending password encrypted and stored for biometric autofill');
    } else {
      // When disabling, delete encrypted password from database
      console.log('🗑️ Removing encrypted spending password');
      await configTable.where({ key: 'biometricEncryptedSpendingPassword' }).delete();
    }

    // Save biometric autofill setting
    await configTable.put({ key: 'biometricsForPasswordAutofill', value: enabled });

    // Show success snackbar
    snackbar.fireSuccess(t('security.biometricsSettingsUpdated'));

    // Emit update event
    emit('updated');
  } catch (error: any) {
    console.error('Error saving biometric autofill setting:', error);

    // Show error snackbar
    snackbar.setError(error.message || t('security.biometricsSettingsUpdateFailed'));

    // Revert the switch
    biometricsForPasswordAutofill.value = !enabled;
  } finally {
    loadingBiometricsAutofill.value = false;
  }
}

/**
 * Handle biometric auto-trigger change for password autofill
 */
async function handleBiometricAutoTriggerChange() {
  const enabled = biometricAutoTrigger.value;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    // Get database
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    // Save auto-trigger setting for password autofill
    await configTable.put({ key: 'biometricAutoTrigger', value: enabled });

    // Show success snackbar
    snackbar.fireSuccess(t('security.biometricsSettingsUpdated'));

    console.log('✅ Biometric auto-trigger (password autofill) setting saved:', enabled);

    // Emit update event
    emit('updated');
  } catch (error: any) {
    console.error('Error saving biometric auto-trigger setting:', error);

    // Show error snackbar
    snackbar.setError(error.message || t('security.biometricsSettingsUpdateFailed'));

    // Revert the switch
    biometricAutoTrigger.value = !enabled;
  }
}

/**
 * Handle biometric auto-trigger change for wallet unlock
 */
async function handleBiometricAutoTriggerUnlockChange() {
  const enabled = biometricAutoTriggerUnlock.value;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    // Get database
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    // Save auto-trigger setting for wallet unlock
    await configTable.put({ key: 'biometricAutoTriggerUnlock', value: enabled });

    // Show success snackbar
    snackbar.fireSuccess(t('security.biometricsSettingsUpdated'));

    console.log('✅ Biometric auto-trigger (unlock) setting saved:', enabled);

    // Emit update event
    emit('updated');
  } catch (error: any) {
    console.error('Error saving biometric auto-trigger unlock setting:', error);

    // Show error snackbar
    snackbar.setError(error.message || t('security.biometricsSettingsUpdateFailed'));

    // Revert the switch
    biometricAutoTriggerUnlock.value = !enabled;
  }
}

/**
 * Prompt user for spending password with a dialog
 * @returns Promise<string | null> - Password or null if cancelled
 */
async function promptForSpendingPassword(): Promise<string | null> {
  return new Promise((resolve) => {
    // Store the resolve function to call when user confirms or cancels
    passwordResolve = resolve;

    // Reset password input and show dialog
    passwordInput.value = '';
    showPasswordInDialog.value = false;
    showPasswordDialog.value = true;
  });
}

/**
 * Handle password confirmation
 */
async function confirmPassword() {
  if (!passwordResolve || !passwordInput.value) return;

  try {
    // Verify password with background
    const { Messaging } = await import('@/chrome/messaging');
    const { MessageTypes } = await import('@/models/MessageTypes');

    console.log('🔐 Verifying spending password...');
    const verifyResponse = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: passwordInput.value }
    }) as BackgroundResponse<VerifyPasswordResponse>;

    if (!verifyResponse.data.success) {
      // Show error tooltip
      passwordErrorTooltipText.value = verifyResponse.data.error || t('wallet.wrongPassword');
      passwordErrorTooltipColor.value = 'red';
      passwordErrorTooltipEnabled.value = true;

      // Clear password input
      passwordInput.value = '';

      // Hide tooltip after 3 seconds
      setTimeout(() => {
        passwordErrorTooltipEnabled.value = false;
      }, 3000);

      // Don't close dialog or resolve promise - let user try again
      return;
    }

    // Password is correct - resolve promise and close dialog
    passwordResolve(passwordInput.value);
    passwordResolve = null;
    showPasswordDialog.value = false;
  } catch (error: any) {
    console.error('Error verifying password:', error);

    // Show error tooltip
    passwordErrorTooltipText.value = error.message || t('common.error');
    passwordErrorTooltipColor.value = 'red';
    passwordErrorTooltipEnabled.value = true;

    // Clear password input
    passwordInput.value = '';

    // Hide tooltip after 3 seconds
    setTimeout(() => {
      passwordErrorTooltipEnabled.value = false;
    }, 3000);
  }
}

/**
 * Handle password cancellation
 */
function cancelPassword() {
  if (passwordResolve) {
    passwordResolve(null);
    passwordResolve = null;
  }
  showPasswordDialog.value = false;
}

function resetForm() {
  customMinutes.value = null;
  showCustomInput.value = false;
  errorMessage.value = '';
  successMessage.value = '';
}

function handleClose() {
  emit('input', false);
}
</script>
<style scoped>
.lock-settings-dialog {
  border-radius: 16px;
}
</style>
