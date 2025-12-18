<template>
  <BaseDialog
    :isOpen="value"
    :icon="dialogIcon"
    :title="dialogTitle"
    :titleInfo="dialogTitleInfo"
    :subtitle="dialogSubtitle"
    :loading="loading"
    :width="600"
    :height="600"
    :minHeight="400"
    @close="handleCancel"
    scrollable
  >
    <v-card-text class="pt-6">
      <!-- Disable 2FA -->
      <div v-if="isEnabled && step === 'disable'" class="step-container">
        <div class="text-center mb-4">
          <v-icon size="64" color="warning">mdi-alert</v-icon>
          <div class="subtitle-1 mt-4">{{ $t('security.disable2FAConfirm') }}</div>
          <div class="caption">{{ $t('security.disable2FAWarning') }}</div>
        </div>
      </div>

      <!-- Step 1: Scan QR Code -->
      <div v-else-if="step === 'scan'" class="step-container">
        <div class="text-center mb-4">
          <div class="caption">{{ $t('security.useAuthenticatorApp') }}</div>
        </div>

        <div class="qr-code-container text-center">
          <div ref="qrCodeRef" style="display: inline-block;"></div>
        </div>

        <div class="text-center mt-4">
          <div class="caption">{{ $t('security.orEnterManually') }}</div>
          <v-text-field
            :value="totpSecret"
            readonly
            outlined
            dense
            class="mt-2"
            label="Authentication Key"
          >
            <template v-slot:append>
              <CopyButton small :value="totpSecret" class="mb-2" />
            </template>
          </v-text-field>

          <v-btn
            text
            small
            color="primary"
            @click="regenerateSecret"
          >
            <v-icon left small>mdi-refresh</v-icon>
            {{ $t('security.regenerateQRCode') }}
          </v-btn>
        </div>
      </div>

      <!-- Step 2: Verify Code -->
      <div v-else-if="step === 'verify'" class="step-container">
        <v-list-item>
          <v-list-item-content style="align-self: start;">
            <v-list-item-title class="text-center">{{ $t('security.verifyAuthenticatorCode') }}</v-list-item-title>
            <v-list-item-subtitle class="text-center">{{ $t('security.enterCodeFromApp') }}</v-list-item-subtitle>
          </v-list-item-content>
        </v-list-item>
        <v-tooltip v-model="showInvalidCodeTooltip" top color="error">
          <template v-slot:activator="{ }">
            <v-otp-input
              v-model="verificationCode"
              length="6"
              type="number"
              @finish="handleVerifyCode"
            ></v-otp-input>
          </template>
          <span>{{ $t('security.invalidTotpCode') }}</span>
        </v-tooltip>
      </div>

      <!-- Step 3: Backup Codes -->
      <div v-else-if="step === 'backup'" class="step-container">
        <v-list-item>
          <v-list-item-content style="align-self: start;" class="pt-0">
            <v-list-item-title class="text-center">{{ $t('security.saveBackupCodes') }}</v-list-item-title>
            <v-list-item-subtitle class="text-center">{{ $t('security.backupCodesWarning') }}</v-list-item-subtitle>
          </v-list-item-content>
        </v-list-item>

        <div class="backup-codes-grid">
          <div
            v-for="(code, index) in backupCodes"
            :key="index"
            class="backup-code-item"
          >
            {{ code }}
          </div>
        </div>

        <div class="text-center mt-4">
          <v-tooltip v-model="showCopiedTooltip" top color="success">
            <template v-slot:activator="{ }">
              <v-btn small outlined color="primary" @click="copyBackupCodes">
                <v-icon left>mdi-content-copy</v-icon>
                {{ $t('security.copyBackupCodes') }}
              </v-btn>
            </template>
            <span>{{ $t('security.backupCodesCopied') }}</span>
          </v-tooltip>
        </div>
      </div>

      <!-- Step 4: Spending Password -->
      <div v-else-if="step === 'password'" class="step-container password-step">
        <v-list-item>
          <v-list-item-content style="align-self: start;" class="pt-0">
            <v-list-item-title class="text-center">{{ $t('security.enterSpendingPassword') }}</v-list-item-title>
            <v-list-item-subtitle class="text-center">{{ $t('security.passwordRequiredToEncrypt') }}</v-list-item-subtitle>
          </v-list-item-content>
        </v-list-item>
        <div class="password-field-wrapper">
          <BiometricPasswordField
            :value="password"
            @input="password = $event"
            :label="$t('security.spendingPassword')"
            outlined
            dense
            @enter="handleSave"
          />
        </div>
      </div>

      <!-- Error Message -->
      <v-alert
        v-if="errorMessage"
        type="error"
        dense
        class="mt-4"
      >
        {{ errorMessage }}
      </v-alert>

      <!-- Success Message -->
      <v-alert
        v-if="successMessage"
        type="success"
        dense
        class="mt-4"
      >
        {{ successMessage }}
      </v-alert>
    </v-card-text>

    <v-card-actions class="px-6 pb-6">
      <v-btn
        v-if="step === 'verify' || step === 'backup' || step === 'password'"
        text
        @click="handleBack"
        :disabled="loading"
      >
        {{ $t('common.back') }}
      </v-btn>
      <v-spacer></v-spacer>
      <v-btn
        v-if="step === 'disable'"
        color="error"
        @click="handleDisable2FA"
        :loading="loading"
      >
        {{ $t('security.disable') }}
      </v-btn>
      <v-btn
        v-else-if="step === 'scan'"
        color="primary"
        @click="step = 'verify'"
      >
        {{ $t('common.next') }}
      </v-btn>
      <v-btn
        v-else-if="step === 'backup'"
        color="primary"
        @click="step = 'password'"
      >
        {{ $t('common.next') }}
      </v-btn>
      <v-btn
        v-else-if="step === 'password'"
        color="primary"
        @click="handleSave"
        :loading="loading"
        :disabled="!canSave"
      >
        {{ $t('common.save') }}
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, getCurrentInstance } from 'vue';
import { walletStore } from '@/stores/walletStore';
import {
  generateTotpSecret,
  generateTotpUrl,
  verifyTotpCode,
  generateBackupCodes,
  encryptSecurityData,
  APP_NAME
} from '@/shared/utils/security';
import QRCodeStyling from 'qr-code-styling';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import BiometricPasswordField from '@/shared/components/BiometricPasswordField.vue';

// Props
interface Props {
  value: boolean;
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'updated'): void;
}>();

// Access Vue instance for $t
const vmProxy = getCurrentInstance()!.proxy as any;

// Reactive state
type Step = 'disable' | 'scan' | 'verify' | 'backup' | 'password';
const step = ref<Step>('scan');
const totpSecret = ref('');
const verificationCode = ref('');
const backupCodes = ref<string[]>([]);
const password = ref('');
const loading = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const isEnabled = ref(false);
const qrCodeRef = ref<HTMLElement | null>(null);
const showCopiedTooltip = ref(false);
const showInvalidCodeTooltip = ref(false);

// Computed
const canSave = computed(() => password.value.length > 0 && !loading.value);

const dialogIcon = computed(() => {
  if (step.value === 'disable') return 'mdi-alert';
  return 'mdi-two-factor-authentication';
});

const dialogTitle = computed(() => {
  if (isEnabled.value && step.value === 'disable') {
    return vmProxy.$t('security.disable2FA');
  }
  return vmProxy.$t('security.setup2FA');
});

const dialogSubtitle = computed(() => {
  switch (step.value) {
    case 'scan':
      return vmProxy.$t('security.scanQRCode');
    case 'verify':
      return vmProxy.$t('security.verifyAuthenticatorCode');
    case 'backup':
      return vmProxy.$t('security.saveBackupCodes');
    case 'password':
      return vmProxy.$t('security.enterSpendingPassword');
    default:
      return '';
  }
});

const dialogTitleInfo = computed(() => {
  if (isEnabled.value && step.value === 'disable') {
    return vmProxy.$t('security.2FADisableInfo');
  }
  return vmProxy.$t('security.2FASetupInfo');
});

// Watch for dialog open/close
watch(() => props.value, (newVal) => {
  if (newVal) {
    loadCurrent2FAStatus();
  } else {
    resetForm();
  }
});

// Methods
async function loadCurrent2FAStatus() {
  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) return;

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    const twoFactorConfig = await configTable.where({ key: 'twoFactorEnabled' }).first();
    isEnabled.value = twoFactorConfig?.value || false;

    if (isEnabled.value) {
      step.value = 'disable';
    } else {
      step.value = 'scan';
      // Only generate a new secret if we don't have one already
      // This prevents regenerating the secret if the user cancelled and reopened the dialog
      if (!totpSecret.value) {
        await generateNewSecret();
      } else {
        // Re-render the existing QR code
        await nextTick();
        renderQRCode();
      }
    }
  } catch (error) {
    console.error('Error loading 2FA status:', error);
    isEnabled.value = false;
    step.value = 'scan';
    // Only generate if we don't have one
    if (!totpSecret.value) {
      await generateNewSecret();
    } else {
      await nextTick();
      renderQRCode();
    }
  }
}

async function generateNewSecret() {
  // Generate TOTP secret
  totpSecret.value = generateTotpSecret();

  // Generate backup codes
  backupCodes.value = generateBackupCodes();

  // Generate QR code
  await nextTick();
  renderQRCode();
}

function renderQRCode() {
  const wallet = walletStore.loggedWallet;
  if (!wallet) return;

  const totpUrl = generateTotpUrl(
    totpSecret.value,
    APP_NAME,
    wallet.name || 'Wallet'
  );

  const qrCode = new QRCodeStyling({
    width: 170,
    height: 170,
    type: 'svg',
    data: totpUrl,
    margin: 10,
    qrOptions: {
      typeNumber: 0,
      mode: 'Byte',
      errorCorrectionLevel: 'M',
    },
    backgroundOptions: {
      color: '#ffffff',
    },
    dotsOptions: {
      color: '#000000',
      type: 'rounded'
    },
    cornersSquareOptions: {
      type: 'extra-rounded',
    },
    cornersDotOptions: {
      type: 'dot',
    },
  });

  if (qrCodeRef.value) {
    qrCodeRef.value.innerHTML = '';
    qrCode.append(qrCodeRef.value);
  }
}

async function handleVerifyCode() {
  // Sanitize input: remove any non-digit characters
  // Even though NumericOtpInput filters client-side, backend validation should never trust client
  const sanitizedCode = verificationCode.value.replace(/\D/g, '');

  if (sanitizedCode.length !== 6) {
    // Show error tooltip
    showInvalidCodeTooltip.value = true;

    // Auto-hide tooltip after 3 seconds
    setTimeout(() => {
      showInvalidCodeTooltip.value = false;
    }, 3000);
    return;
  }

  const isValid = verifyTotpCode(sanitizedCode, totpSecret.value);

  if (isValid) {
    step.value = 'backup';
  } else {
    // Show error tooltip
    showInvalidCodeTooltip.value = true;
    verificationCode.value = '';

    // Auto-hide tooltip after 3 seconds
    setTimeout(() => {
      showInvalidCodeTooltip.value = false;
    }, 3000);
  }
}

async function handleSave() {
  if (!canSave.value) return;

  loading.value = true;
  errorMessage.value = '';

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    // Encrypt the TOTP secret and backup codes with spending password
    const encryptedTotpSecret = encryptSecurityData(totpSecret.value, password.value) as string;
    const encryptedBackupCodes = encryptSecurityData(backupCodes.value, password.value) as string[];

    // Save to database
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    await configTable.put({ key: 'twoFactorEnabled', value: true });
    await configTable.put({ key: 'encryptedTotpSecret', value: encryptedTotpSecret });
    await configTable.put({ key: 'encryptedBackupCodes', value: encryptedBackupCodes });

    successMessage.value = vmProxy.$t('security.2FASetupSuccess');

    // Clear the temporary setup data after successful save
    totpSecret.value = '';
    backupCodes.value = [];
    password.value = '';

    // Close dialog after short delay
    setTimeout(() => {
      emit('input', false);
      emit('updated');
    }, 1500);
  } catch (error: any) {
    console.error('Error saving 2FA settings:', error);
    errorMessage.value = error.message || vmProxy.$t('security.2FASetupFailed');
  } finally {
    loading.value = false;
  }
}

async function handleDisable2FA() {
  loading.value = true;
  errorMessage.value = '';

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    // Remove 2FA settings from database
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    await configTable.put({ key: 'twoFactorEnabled', value: false });
    await configTable.where({ key: 'encryptedTotpSecret' }).delete();
    await configTable.where({ key: 'encryptedBackupCodes' }).delete();

    successMessage.value = vmProxy.$t('security.2FADisabled');

    // Close dialog after short delay
    setTimeout(() => {
      emit('input', false);
      emit('updated');
    }, 1500);
  } catch (error: any) {
    console.error('Error disabling 2FA:', error);
    errorMessage.value = error.message || vmProxy.$t('security.2FADisableFailed');
  } finally {
    loading.value = false;
  }
}

function copyBackupCodes() {
  const codesText = backupCodes.value.join(' ');
  navigator.clipboard.writeText(codesText);

  // Show success tooltip
  showCopiedTooltip.value = true;

  // Auto-hide tooltip after 2 seconds
  setTimeout(() => {
    showCopiedTooltip.value = false;
  }, 2000);
}

async function regenerateSecret() {
  // Force regenerate the secret and QR code
  await generateNewSecret();
}

function handleBack() {
  // Clear error messages when going back
  errorMessage.value = '';

  // Navigate to previous step
  switch (step.value) {
    case 'verify':
      step.value = 'scan';
      break;
    case 'backup':
      step.value = 'verify';
      break;
    case 'password':
      step.value = 'backup';
      break;
  }
}

function handleCancel() {
  emit('input', false);
}

function resetForm() {
  step.value = 'scan';
  // DON'T clear totpSecret - keep it so user doesn't get a new secret if they reopen
  // totpSecret.value = '';
  verificationCode.value = '';
  // DON'T clear backupCodes - they're tied to the totpSecret
  // backupCodes.value = [];
  password.value = '';
  errorMessage.value = '';
  successMessage.value = '';
  isEnabled.value = false;
}
</script>

<style scoped>
.step-container {
  min-height: 300px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.qr-code-container {
  padding: 5px;
  background: white;
  border-radius: 8px;
  display: inline-block;
  margin: 0 auto;
  height: 180px;
  width: 180px;
}

.backup-codes-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding: 12px;
  background: rgba(245, 245, 245, 0.08);
  border-radius: 8px;
  max-width: 350px;
  margin: 0 auto;
}

.backup-code-item {
  background: rgba(0, 0, 0, 0.58);
  padding: 8px;
  border-radius: 4px;
  font-weight: bold;
  text-align: center;
  font-family: monospace;
  font-size: 12px;
  border: 1px solid rgba(224, 224, 224, 0.42);
}

.password-step {
  justify-content: flex-start;
}

.password-field-wrapper {
  max-width: 400px;
  margin: 0 auto;
  width: 100%;
  flex: 1;
  display: flex;
  align-items: start;
  justify-content: center;
}
</style>
