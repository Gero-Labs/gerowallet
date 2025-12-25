<template>
  <v-tab-item eager>
    <v-list nav class="transparent px-0">
      <v-list-item class="px-2 py-1">
        <v-list-item-avatar class="my-0" style="align-self: self-start;">
          <v-icon
            left
            dark
            class="mr-1"
          >
            mdi-key-chain
          </v-icon>
        </v-list-item-avatar>
        <v-list-item-content class="py-0" style="align-self: self-start;">
          <v-list-item-title class="text-left">
            <h3 style="color: white; font-size: 16px;">{{ $t('settings.extendedPublicKey') }}</h3>
          </v-list-item-title>
          <v-list-item-subtitle class="text-left">
            {{ $t('settings.ed25519ExtendedKey') }}
          </v-list-item-subtitle>
          <v-list-item-subtitle class="text-left">
            <CopyButton v-if="loggedWallet" :title="filters.truncate(loggedWallet?.publicKey) " :value="loggedWallet?.publicKey" x-small />
          </v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-avatar size="120" rounded>
          <div ref="qrCodeRef" style="width: 120px; height: 120px;"></div>
        </v-list-item-avatar>
      </v-list-item>
      <v-list-item class="px-2 py-1" v-if="canBackup" @click="backupWalletDialog = true">
        <v-list-item-avatar class="my-0">
          <v-badge
            v-if="!backup"
            bordered
            dot
            color="error"
            overlap
          >
            <v-icon
              dark
              class="mr-1"
            >
              mdi-key
            </v-icon>
          </v-badge>
          <v-icon
            v-else
            left
            dark
            class="mr-1"
          >
            mdi-key
          </v-icon>
        </v-list-item-avatar>
        <v-list-item-content class="py-0">
          <v-list-item-title class="text-left">
            <h3 style="color: white; font-size: 16px;">{{ $t('settings.recoveryPhrase') }}
              <v-tooltip top v-if="backup" content-class="custom-tooltip">
                <template v-slot:activator="{ on, attrs }">
                  <v-icon
                    color="primary"
                    small
                    v-bind="attrs"
                    v-on="on"
                  >
                    mdi-shield-check-outline
                  </v-icon>
                </template>
                <span>{{ $t('settings.yourWalletWasBackedUp') }}</span>
              </v-tooltip>
            </h3>
          </v-list-item-title>
          <v-list-item-subtitle class="text-left">
            {{ backup ? $t('settings.seedPhraseMasterKey') : $t('settings.walletBackupRequired') }}
          </v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-icon class="my-0" style="align-self: center">
          <v-icon large>
            mdi-chevron-right
          </v-icon>
        </v-list-item-icon>
      </v-list-item>
      <v-list-item class="px-2 py-1" v-if="loggedWallet?.type === WalletType.Normal" @click="changePasswordDialog = true">
        <v-list-item-avatar class="my-0">
          <v-icon>
            mdi-shield-key-outline
          </v-icon>
        </v-list-item-avatar>
        <v-list-item-content class="py-0">
          <v-list-item-title class="text-left">
            <h3 style="color: white; font-size: 16px;">{{ $t('settings.spendingPasswordSettings') }}</h3>
          </v-list-item-title>
          <v-list-item-subtitle class="text-left">
            {{ $t('settings.modifySpendingPassword') }}
          </v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-icon class="my-0" style="align-self: center">
          <v-icon large>
            mdi-chevron-right
          </v-icon>
        </v-list-item-icon>
      </v-list-item>

      <!-- Lock Settings (Unlock Method + Auto-Lock) -->
      <v-list-item class="px-2 py-1" @click="handleLockSettingsClick">
        <v-list-item-avatar class="my-0">
          <!-- New Feature Notification Dot -->
          <NotificationDot
            :show="isFeatureNew('settings.security.lockSettings')"
            color="error"
            overlap
            bordered
          >
            <v-icon>
              mdi-shield-lock-outline
            </v-icon>
          </NotificationDot>
        </v-list-item-avatar>
        <v-list-item-content class="py-0">
          <v-list-item-title class="text-left">
            <h3 style="color: white; font-size: 16px;">
              {{ $t('security.lockSettings') }}
            </h3>
          </v-list-item-title>
          <v-list-item-subtitle class="text-left">
            {{ $t('security.unlockMethod') }}: {{ unlockMethodText }} • {{ $t('security.autoLock') }}: {{ autoLockText }} • PassKey: {{ passKeyText }}
          </v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-icon class="my-0" style="align-self: center">
          <v-icon large>
            mdi-chevron-right
          </v-icon>
        </v-list-item-icon>
      </v-list-item>

      <!-- Two-Factor Authentication - DISABLED FOR NOW (see 2FA_IMPLEMENTATION_PLAN.md) -->
      <template v-if="false">
        <v-list-item class="px-2 py-1" @click="twoFactorDialog = true">
          <v-list-item-avatar class="my-0">
            <v-icon>
              mdi-two-factor-authentication
            </v-icon>
          </v-list-item-avatar>
          <v-list-item-content class="py-0">
            <v-list-item-title class="text-left">
              <h3 style="color: white; font-size: 16px;">{{ $t('security.twoFactorAuth') }}</h3>
            </v-list-item-title>
            <v-list-item-subtitle class="text-left">
              {{ twoFactorEnabled ? $t('security.2FAEnabled') : $t('security.2FADisabled') }}
            </v-list-item-subtitle>
          </v-list-item-content>
          <v-list-item-icon class="my-0" style="align-self: center">
            <v-icon large>
              mdi-chevron-right
            </v-icon>
          </v-list-item-icon>
        </v-list-item>

        <v-divider />
      </template>
      <v-list-item>
        <v-list-item-avatar size="30" class="my-0 ml-1 mr-5" tile>
          <v-img :src="assets.cardanoShieldLogo" :alt="$t('common.cardanoShieldLogo')" contain />
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title class="text-left"><h2>Cardano Shield<v-icon>mdi-external-link</v-icon></h2></v-list-item-title>
        </v-list-item-content>
      </v-list-item>
      <v-list-item class="px-2 py-1">
        <v-list-item-avatar class="my-0">
          <v-icon>
            mdi-security
          </v-icon>
        </v-list-item-avatar>
        <v-list-item-content class="py-0">
          <v-list-item-title class="text-left">
            <h3 style="color: white; font-size: 16px;">{{ $t('settings.websiteProtection') }}</h3>
          </v-list-item-title>
          <v-list-item-subtitle class="text-left">
            {{ $t('settings.protectAgainstMalicious') }}
          </v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-action class="my-0">
          <ToggleSwitch text-left="OFF" text-right="ON" font-size="10px" v-model="websiteProtection" />
        </v-list-item-action>
      </v-list-item>
    </v-list>

    <!-- Verification Overlay -->
    <v-overlay
      :value="showVerificationOverlay"
      opacity="0.95"
      z-index="9999"
    >
      <v-card class="verification-card px-3 pa-2 liquid-glass" elevation="8" max-width="400" rounded="lg">
        <v-card-title class="justify-center">
          <v-icon left color="primary" large>mdi-lock-check</v-icon>
          {{ $t('security.verify') + ' ' + getUnlockMethodTitle(unlockMethod) }}
        </v-card-title>

        <v-card-text class="pt-4">
          <!-- PIN Verification -->
          <div v-if="unlockMethod === 'pin'" class="text-center">
            <v-card class="transparent" flat>
              <v-card-text class="text-center px-0">
                <v-tooltip
                  v-model="tooltip.enabled"
                  top
                  color="red"
                >
                  <template v-slot:activator="{ }">
                    <v-otp-input
                      ref="verificationPinInput"
                      v-model="verificationInput"
                      :length="pinLength"
                      type="password"
                      @finish="handleVerificationPinFinish"
                    ></v-otp-input>
                  </template>
                  <span>{{ tooltip.text }}</span>
                </v-tooltip>
              </v-card-text>
            </v-card>
          </div>

          <!-- Pattern Verification -->
          <div v-else-if="unlockMethod === 'pattern'" class="text-center">
            <div class="caption mb-4">{{ $t('security.drawCurrentPattern') }}</div>
            <pattern-lock
              v-model="verificationPattern"
              @complete="handleVerificationPatternComplete"
            />
          </div>

          <!-- Password Verification -->
          <div v-else-if="unlockMethod === 'password'">
            <v-tooltip
              v-model="tooltip.enabled"
              top
              color="red"
            >
              <template v-slot:activator="{ }">
                <v-text-field
                  ref="verificationPasswordInput"
                  v-model="verificationInput"
                  :label="$t('security.spendingPassword')"
                  :type="showPassword ? 'text' : 'password'"
                  :rules="[rules.required()]"
                  outlined
                  dense
                  hide-details
                  :disabled="verifying"
                  @keydown.enter.stop="handleVerificationPasswordSubmit"
                >
                  <template v-slot:append>
                    <v-icon @click="showPassword = !showPassword" tabindex="-1">
                      {{ showPassword ? 'mdi-eye' : 'mdi-eye-off' }}
                    </v-icon>
                  </template>
                  <template v-slot:append-outer>
                    <v-btn
                      block
                      outlined
                      small
                      color="primary"
                      class="ml-2 px-1"
                      style="height: 40px;"
                      @click="handleVerificationPasswordSubmit"
                      :loading="verifying"
                      :disabled="verifying"
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
          </div>

          <!-- PassKey Option (if enabled) -->
          <div v-if="passKeyForUnlock && webAuthnCredentialId" class="text-center mt-4">
            <v-btn
              small
              text
              color="primary"
              @click="handleVerificationPassKeyAuth"
              :loading="passKeyVerifying"
              :disabled="verifying"
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
                    opacity: passKeyVerifying ? '0.5' : 1,
                  }"
                  tabindex="-1"
                />
              </v-avatar>
              {{ $t('security.usePassKey') }}
            </v-btn>
          </div>
        </v-card-text>

        <v-card-actions class="px-4 pb-4 pt-0">
          <v-btn
            block
            text
            plain
            small
            @click="cancelVerification"
            :disabled="verifying"
            color="error"
          >
            {{ $t('common.cancel') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-overlay>

    <BackupWalletDialog :is-open="backupWalletDialog" @close="backupWalletDialog = false" />
    <ChangePasswordDialog :is-open="changePasswordDialog" @close="changePasswordDialog = false" />

    <!-- Lock Settings Dialog (Unlock Method + Auto-Lock) -->
    <LockSettingsDialog
      v-model="securitySettingsDialog"
      :reload-trigger="lockSettingsReloadTrigger"
      @setup-unlock-method="handleUnlockMethodSelect"
      @updated="loadSecurityConfig"
    />
    <PinSetupDialog v-model="pinSetupDialog" @updated="handleSecuritySetupComplete" />
    <PatternSetupDialog v-model="patternSetupDialog" @updated="handleSecuritySetupComplete" />

    <!-- 2FA Dialog -->
    <TwoFactorSetupDialog v-model="twoFactorDialog" @updated="loadSecurityConfig" />
  </v-tab-item>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, onMounted, nextTick, toRefs, watch } from 'vue';
import BackupWalletDialog from '@/modules/navigation/dialogs/BackupWalletDialog.vue';
import ChangePasswordDialog from '@/modules/dashboard/dialogs/ChangePasswordDialog.vue';
import LockSettingsDialog from '@/modules/dashboard/dialogs/LockSettingsDialog.vue';
import PinSetupDialog from '@/modules/dashboard/dialogs/PinSetupDialog.vue';
import PatternSetupDialog from '@/modules/dashboard/dialogs/PatternSetupDialog.vue';
import TwoFactorSetupDialog from '@/modules/dashboard/dialogs/TwoFactorSetupDialog.vue';
import PatternLock from '@/modules/dashboard/components/PatternLock.vue';
import { Blockchain, WalletType } from '@/models/types';
import QRCodeStyling from 'qr-code-styling';
import assets from '@/utils/assets';
import { Options } from 'qr-code-styling';
import CopyButton from '@/shared/components/CopyButton.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import filters from '@/shared/utils/filters';
import WalletStore, { walletStore } from '@/stores/walletStore';
import { BackgroundResponse, Messaging, VerifyPasswordResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import rules from '@/utils/rules';
import NotificationDot from '@/shared/components/NotificationDot.vue';
import { isFeatureNew } from '@/shared/composables/useFeatureNotifications';

const { t } = useTranslation();
const backupWalletDialog = ref<boolean>(false);
const changePasswordDialog = ref<boolean>(false);
const securitySettingsDialog = ref<boolean>(false);
const pinSetupDialog = ref<boolean>(false);
const patternSetupDialog = ref<boolean>(false);
const twoFactorDialog = ref<boolean>(false);

// Reload trigger for LockSettingsDialog
const lockSettingsReloadTrigger = ref<number>(0);

const { loggedWallet, config } = toRefs(walletStore);

// Security config from wallet database
const unlockMethod = ref<string | null>(null);
const twoFactorEnabled = ref<boolean>(false);
const autoLockMinutes = ref<number>(0);
const passKeyForUnlock = ref<boolean>(false);
const passKeyForPasswordAutofill = ref<boolean>(false);

// Verification overlay state
const showVerificationOverlay = ref<boolean>(false);
const verificationInput = ref<string>('');
const verificationPattern = ref<number[]>([]);
const verifying = ref<boolean>(false);
const passKeyVerifying = ref<boolean>(false);
const showPassword = ref<boolean>(false);
const pinLength = ref<number>(6);
const webAuthnCredentialId = ref<string | null>(null);

// Template refs for verification inputs
const verificationPinInput = ref<any>(null);
const verificationPasswordInput = ref<any>(null);

const backup = computed(() => config.value?.backup || false);
const websiteProtection = computed({
  get() {
    return config.value?.websiteProtection !== undefined ? config.value.websiteProtection : true;
  },
  set(value) {
    WalletStore.setWebsiteProtection(value);
  }
});

const getUnlockMethodTitle = (method: string | null) => {
  switch (method) {
    case 'password':
      return t('security.spendingPassword');
    case 'pin':
      return t('security.pin');
    case 'pattern':
      return t('security.pattern');
    default:
      return ''
  }
};

const canBackup = computed(() => {
  return loggedWallet.value?.type === WalletType.Normal && WalletStore.hasBackup();
});

// Computed properties for security settings display
const unlockMethodText = computed(() => {
  if (!unlockMethod.value) {
    return t('security.none');
  }

  switch (unlockMethod.value) {
    case 'password':
      return t('security.spendingPassword');
    case 'pin':
      return t('security.pin');
    case 'pattern':
      return t('security.pattern');
    default:
      return t('security.none');
  }
});

const autoLockText = computed(() => {
  if (autoLockMinutes.value === 0) {
    return t('security.never');
  }

  if (autoLockMinutes.value === 1) {
    return t('security.1Minute');
  }

  if (autoLockMinutes.value < 60) {
    return t('security.xMinutes', { minutes: autoLockMinutes.value });
  }

  const hours = Math.floor(autoLockMinutes.value / 60);
  if (hours === 1) {
    return t('security.1Hour');
  }

  return t('security.xHours', { hours });
});

const passKeyText = computed(() => {
  const features: string[] = [];

  if (passKeyForUnlock.value) {
    features.push(t('security.unlock'));
  }

  if (passKeyForPasswordAutofill.value && loggedWallet.value?.type === WalletType.Normal) {
    features.push(t('security.passwordAutofill'));
  }

  if (features.length === 0) {
    return t('security.notConfigured');
  }

  return features.join(', ');
});

// Load security config from wallet database
async function loadSecurityConfig() {
  try {
    if (!loggedWallet.value) return;

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(loggedWallet.value.id);
    const configTable = db.table('config');

    const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
    const twoFactorConfig = await configTable.where({ key: 'twoFactorEnabled' }).first();
    const autoLockConfig = await configTable.where({ key: 'autoLockMinutes' }).first();
    const passKeyUnlockConfig = await configTable.where({ key: 'passKeyForUnlock' }).first();
    const passKeyAutofillConfig = await configTable.where({ key: 'passKeyForPasswordAutofill' }).first();
    const webAuthnCredentialConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();

    unlockMethod.value = unlockMethodConfig?.value || null;
    twoFactorEnabled.value = twoFactorConfig?.value || false;
    autoLockMinutes.value = autoLockConfig?.value || 0;
    passKeyForUnlock.value = passKeyUnlockConfig?.value || false;
    passKeyForPasswordAutofill.value = passKeyAutofillConfig?.value || false;
    webAuthnCredentialId.value = webAuthnCredentialConfig?.value || null;

    // Dispatch custom event to notify NavigationDrawer of security settings change
    window.dispatchEvent(new CustomEvent('security-settings-updated', {
      detail: { unlockMethod: unlockMethod.value }
    }));
  } catch (error) {
    console.error('Error loading security config:', error);
    unlockMethod.value = null;
    twoFactorEnabled.value = false;
    autoLockMinutes.value = 0;
    passKeyForUnlock.value = false;
    passKeyForPasswordAutofill.value = false;
    webAuthnCredentialId.value = null;
  }
}

// Handle unlock method selection
function handleUnlockMethodSelect(method: string) {
  if (method === 'pin') {
    pinSetupDialog.value = true;
  } else if (method === 'pattern') {
    patternSetupDialog.value = true;
  }
}

// Reload LockSettingsDialog when PIN/Pattern setup completes
function handleSecuritySetupComplete() {
  loadSecurityConfig();
  lockSettingsReloadTrigger.value++;
}

// Handle Lock Settings button click
async function handleLockSettingsClick() {
  // If no unlock method is set (none), open dialog directly
  if (!unlockMethod.value) {
    securitySettingsDialog.value = true;
    return;
  }

  // Load PIN length for verification
  try {
    const wallet = loggedWallet.value;
    if (!wallet) return;

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');
    const pinLengthConfig = await configTable.where({ key: 'pinLength' }).first();
    pinLength.value = pinLengthConfig?.value || 6;
  } catch (error) {
    console.error('Error loading PIN length:', error);
    pinLength.value = 6;
  }

  // Show verification overlay
  showVerificationOverlay.value = true;
  verificationInput.value = '';
  verificationPattern.value = [];
}

// Verification handlers
async function handleVerificationPinFinish(pin: string) {
  verificationInput.value = pin;
  await verifyCurrentMethod();
}

async function handleVerificationPatternComplete(patternData: number[]) {
  verificationPattern.value = patternData;
  await verifyCurrentMethod();
}

async function handleVerificationPasswordSubmit() {
  await verifyCurrentMethod();
}

async function verifyCurrentMethod() {
  verifying.value = true;
  try {
    const wallet = loggedWallet.value;
    if (!wallet) throw new Error('No wallet logged in');

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    let isValid = false;

    if (unlockMethod.value === 'pin') {
      const { verifyPin } = await import('@/shared/utils/security');
      const pinHashConfig = await configTable.where({ key: 'pinHash' }).first();
      const storedHash = pinHashConfig?.value;
      if (storedHash) {
        isValid = await verifyPin(verificationInput.value, storedHash);
      }
      if (!isValid) {
        tooltip.value.text = t('security.incorrectPin');
        enableToolTip();
      }
    } else if (unlockMethod.value === 'pattern') {
      const { verifyPattern } = await import('@/shared/utils/security');
      const encryptedPatternHashConfig = await configTable.where({ key: 'encryptedPatternHash' }).first();
      const storedHash = encryptedPatternHashConfig?.value;
      if (storedHash) {
        isValid = await verifyPattern(verificationPattern.value, storedHash);
      }
      if (!isValid) {
        tooltip.value.text = t('security.incorrectPattern');
        enableToolTip();
      }
    } else if (unlockMethod.value === 'password') {
      try {
        const passwordVerification = await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.VERIFY_SPENDING_PASSWORD,
          data: { password: verificationInput.value }
        }) as BackgroundResponse<VerifyPasswordResponse>;
        isValid = passwordVerification.data.success;
        if (!isValid) {
          tooltip.value.text = t('wallet.wrongSpendingPassword');
          enableToolTip();
        }
      } catch (error) {
        isValid = false;
      }
    }
    if (isValid) {
      // Verification successful, open lock settings dialog
      showVerificationOverlay.value = false;
      verificationInput.value = '';
      verificationPattern.value = [];
      securitySettingsDialog.value = true;
    } else {
      verificationInput.value = '';
      verificationPattern.value = [];
    }
  } catch (error: any) {
    console.error('Verification error:', error);
  } finally {
    verifying.value = false;
  }
}

const tooltip = ref({
  enabled: false,
  text: t('wallet.wrongSpendingPassword'),
});

const enableToolTip = () => {
  tooltip.value.enabled = true;
  setTimeout(() => {
    tooltip.value.enabled = false;
  }, 3000);
}

// Handle PassKey verification
async function handleVerificationPassKeyAuth() {
  passKeyVerifying.value = true;
  try {
    console.log('🔐 Starting PassKey authentication for verification overlay');

    if (!webAuthnCredentialId.value) {
      console.error('No WebAuthn credential ID found');
      return;
    }

    const { authenticateWebAuthn } = await import('@/shared/utils/security');
    const authenticated = await authenticateWebAuthn(webAuthnCredentialId.value);

    if (authenticated) {
      console.log('✅ PassKey verification successful - opening lock settings');
      // Verification successful, open lock settings dialog
      showVerificationOverlay.value = false;
      verificationInput.value = '';
      verificationPattern.value = [];
      securitySettingsDialog.value = true;
    } else {
      console.error('❌ PassKey verification failed');
      tooltip.value.text = t('security.passKeyAuthFailed');
      enableToolTip();
    }
  } catch (error: any) {
    console.error('❌ PassKey verification error:', error);
    tooltip.value.text = error.message || t('security.passKeyAuthFailed');
    enableToolTip();
  } finally {
    passKeyVerifying.value = false;
  }
}

function cancelVerification() {
  showVerificationOverlay.value = false;
  verificationInput.value = '';
  verificationPattern.value = [];
}

const qrCodeRef = ref<HTMLElement|null>(null)

const isApex = computed(() => {
  return loggedWallet.value?.chain === Blockchain.APEX_PRIME ||
    loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
})

const options = computed((): Partial<Options> => ({
  width: 170,
  height: 170,
  type: 'svg',
  data: loggedWallet.value?.publicKey.toString(),
  image: isApex.value ? assets.geroLogoApex : assets.geroLogo,
  margin: 2,
  qrOptions: {
    typeNumber: 0,
    mode: 'Byte',
    errorCorrectionLevel: 'Q',
  },
  imageOptions: {
    hideBackgroundDots: true,
    imageSize: 0.5,
    margin: 10,
    crossOrigin: 'anonymous',
  },
  backgroundOptions: {
    color: '#ffffff',
  },
  cornersSquareOptions: {
    type: 'extra-rounded',
  },
  cornersDotOptions: {
    type: 'dot',
  },
}));
let qrCode: QRCodeStyling;

onMounted(async () => {
  qrCode = new QRCodeStyling(options.value);
  await nextTick()
  if (qrCodeRef.value) {
    qrCode.append(qrCodeRef.value)
  }

  // Load security config
  await loadSecurityConfig();
})

// Watch for overlay visibility and auto-focus the appropriate input
watch(showVerificationOverlay, async (newValue) => {
  if (newValue) {
    // Wait for the overlay and inputs to render
    await nextTick();

    // Focus the appropriate input based on unlock method
    if (unlockMethod.value === 'pin' && verificationPinInput.value) {
      // For v-otp-input, focus the first input field
      verificationPinInput.value.focus();
    } else if (unlockMethod.value === 'password' && verificationPasswordInput.value) {
      // For v-text-field, use the focus method
      verificationPasswordInput.value.focus();
    }
    // Pattern lock doesn't need focus as it's already interactive
  }
});
</script>
<style scoped>
/* Make PIN password dots bigger and textboxes square */
.verification-card ::v-deep .v-otp-input {
  display: inline-flex !important;
  justify-content: center;
  width: auto !important;
  gap: 12px !important;
}

.verification-card ::v-deep .v-otp-input input {
  font-size: 32px !important;
  font-weight: bold !important;
  width: 56px !important;
  height: 56px !important;
  min-width: 56px !important;
  max-width: 56px !important;
  flex: 0 0 56px !important;
  border-radius: 8px !important;
}

.verification-card ::v-deep .v-otp-input .v-input {
  width: 56px !important;
  max-width: 56px !important;
  flex: 0 0 56px !important;
}

.verification-card ::v-deep .v-otp-input .v-input__control {
  width: 56px !important;
  max-width: 56px !important;
}

.verification-card ::v-deep .v-otp-input .v-input__slot {
  width: 56px !important;
  max-width: 56px !important;
}

/* Remove margin from append-outer slot */
:deep(.v-input__append-outer) {
  margin: 0!important;
}
</style>
