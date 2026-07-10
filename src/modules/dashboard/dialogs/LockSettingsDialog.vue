<template>
  <BaseDialog
    :is-open="value"
    :title="isPrfWallet ? t('security.lockSettingsOnly') : t('security.lockSettings')"
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

            <!-- Password Unlock -->
            <v-list-item two-line @click="handleUnlockMethodSelect('password')" class="mb-0">
              <v-list-item-avatar class="my-0">
                <v-icon>mdi-form-textbox-password</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <!-- PRF wallets: Separate password for UI locking only -->
                <template v-if="isPrfWallet">
                  <v-list-item-title>{{ $t('security.lockPassword') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ $t('security.useLockPasswordToUnlock') }}</v-list-item-subtitle>
                </template>
                <!-- Normal wallets: Use spending password for unlock -->
                <template v-else>
                  <v-list-item-title>{{ $t('security.spendingPassword') }}</v-list-item-title>
                  <v-list-item-subtitle>{{ $t('security.useSpendingPasswordToUnlock') }}</v-list-item-subtitle>
                </template>
              </v-list-item-content>
              <v-list-item-icon v-if="selectedUnlockMethod === 'password'" style="align-self: center;">
                <v-icon color="primary">mdi-check-circle</v-icon>
              </v-list-item-icon>
            </v-list-item>

            <v-divider class="mx-1" />

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

      <v-divider class="my-5 mx-1" v-if="!isPrfWallet" />

      <!-- PassKey Section (hidden for PRF wallets — PassKey is their core encryption) -->
      <v-card class="transparent" flat v-if="!isPrfWallet">
        <v-card-title class="justify-center pt-0">
          <v-avatar size="18" class="mr-1">
            <v-img :src="assets.passKeySvg" contain style="filter: brightness(0) saturate(100%) invert(71%) sepia(43%) saturate(4033%) hue-rotate(146deg) brightness(95%) contrast(103%);"></v-img>
          </v-avatar>
          <span class="subtitle-1 font-weight-bold">{{ $t('security.passKeySettings') }}</span>
          <v-tooltip bottom content-class="custom-tooltip">
            <template v-slot:activator="{ on, attrs }">
              <v-icon
                class="ml-1"
                x-small
                v-bind="attrs"
                v-on="on"
              >
                mdi-information-outline
              </v-icon>
            </template>
            <span>{{ $t('security.passKeyInfo') }}</span>
          </v-tooltip>
        </v-card-title>
        <v-card-subtitle class="text-center">
          {{ $t('security.configurePassKeyIndependently') }}
        </v-card-subtitle>
        <v-card-text class="pa-0">
          <!-- Browser Support Notice -->
          <v-alert
            v-if="!isPassKeySupported"
            type="warning"
            dense
            class="mb-4"
          >
            {{ $t('security.passKeyNotSupported') }}
          </v-alert>

          <!-- PassKey Registration Status -->
          <v-list dense class="pa-0 transparent" nav>
            <v-list-item>
              <v-list-item-content>
                <v-list-item-title>
                  {{ isPassKeyRegistered ? $t('security.passKeyRegistered') : $t('security.passKeyNotRegistered') }}
                </v-list-item-title>
                <v-list-item-subtitle>
                  <!-- PRF wallets: PassKey is core encryption, cannot be deregistered -->
                  <template v-if="isPrfWallet && isPassKeyRegistered">
                    {{ $t('security.passKeyPrfWalletDescription') }}
                  </template>
                  <!-- Normal wallets: Regular descriptions -->
                  <template v-else>
                    {{ isPassKeyRegistered ? $t('security.passKeyRegisteredDescription') : $t('security.passKeyNotRegisteredDescription') }}
                  </template>
                </v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action v-if="!isPrfWallet">
                <v-btn
                  small
                  text
                  :color="isPassKeyRegistered ? 'error' : 'primary'"
                  :loading="loadingPassKeyRegistration"
                  :disabled="!isPassKeySupported"
                  @click="isPassKeyRegistered ? handlePassKeyDeregister() : handlePassKeyRegister()"
                >
                  {{ isPassKeyRegistered ? $t('security.deregister') : $t('security.register') }}
                </v-btn>
              </v-list-item-action>
              <!-- PRF wallets: Show lock icon instead of button -->
              <v-list-item-action v-else-if="isPrfWallet && isPassKeyRegistered">
                <v-tooltip bottom content-class="custom-tooltip">
                  <template v-slot:activator="{ on, attrs }">
                    <v-icon
                      color="primary"
                      v-bind="attrs"
                      v-on="on"
                    >
                      mdi-lock
                    </v-icon>
                  </template>
                  <span>{{ $t('security.passKeyRequiredForPrfWallet') }}</span>
                </v-tooltip>
              </v-list-item-action>
            </v-list-item>
          </v-list>

          <!-- Divider before password autofill section (Normal non-PRF wallets only) -->
          <v-divider class="my-3 mx-1" v-if="isNormalWallet && !isPrfWallet" />

          <v-list dense class="pa-0 transparent" nav>
            <!-- Use PassKey for Password Autofill (Normal non-PRF wallets only) -->
            <v-list-item v-if="isNormalWallet && !isPrfWallet" :disabled="isPassKeyAutofillDisabled">
              <v-list-item-avatar class="my-0">
                <v-icon :disabled="isPassKeyAutofillDisabled">mdi-form-textbox-password</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.usePassKeyForPasswordAutofill') }}</v-list-item-title>
                <v-list-item-subtitle v-if="!selectedUnlockMethod">
                  {{ $t('security.passKeyRequiresUnlockMethod') }}
                </v-list-item-subtitle>
                <v-list-item-subtitle v-else>
                  {{ $t('security.usePassKeyForPasswordAutofillDescription') }}
                </v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action>
                <v-switch
                  inset
                  dense
                  v-model="passKeyForPasswordAutofill"
                  color="primary"
                  :disabled="isPassKeyAutofillDisabled"
                  @change="handlePassKeyAutofillChange"
                ></v-switch>
              </v-list-item-action>
            </v-list-item>

            <!-- Auto-Trigger PassKey Authentication (Normal non-PRF wallets only) -->
            <v-list-item v-if="isNormalWallet && !isPrfWallet" :disabled="!passKeyForPasswordAutofill">
              <v-list-item-avatar class="my-0">
                <v-img :src="assets.autoTriggerSvg" contain :style="{
                  width: '24px',
                  height: '24px',
                  opacity: !passKeyForPasswordAutofill ? '0.5' : 1,
                }" />
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.autoTriggerPassKeyPasswordAutofill') }}</v-list-item-title>
                <v-list-item-subtitle v-if="!passKeyForPasswordAutofill">
                  {{ $t('security.autoTriggerRequiresAutofill') }}
                </v-list-item-subtitle>
                <v-list-item-subtitle v-else>
                  {{ $t('security.autoTriggerPassKeyPasswordAutofillDescription') }}
                </v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action>
                <v-switch
                  inset
                  dense
                  v-model="passKeyAutoTrigger"
                  color="primary"
                  :disabled="!isPassKeySupported || !passKeyForPasswordAutofill"
                  @change="handlePassKeyAutoTriggerChange"
                ></v-switch>
              </v-list-item-action>
            </v-list-item>

            <!-- Divider after password autofill section (Normal non-PRF wallets only) -->
            <v-divider class="my-3 mx-1" v-if="isNormalWallet && !isPrfWallet" />

            <!-- Use PassKey for Unlocking -->
            <v-list-item :disabled="isPassKeyUnlockDisabled">
              <v-list-item-avatar class="my-0">
                <v-icon :disabled="isPassKeyUnlockDisabled">mdi-lock-open-outline</v-icon>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.usePassKeyForUnlock') }}</v-list-item-title>
                <v-list-item-subtitle v-if="!selectedUnlockMethod">
                  {{ $t('security.passKeyRequiresUnlockMethod') }}
                </v-list-item-subtitle>
                <v-list-item-subtitle v-else>
                  {{ $t('security.usePassKeyForUnlockDescription') }}
                </v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action>
                <v-switch
                  inset
                  dense
                  v-model="passKeyForUnlock"
                  color="primary"
                  @change="handlePassKeyUnlockChange"
                  :disabled="isPassKeyUnlockDisabled"
                ></v-switch>
              </v-list-item-action>
            </v-list-item>

            <!-- Auto-Trigger PassKey Authentication for Unlock -->
            <v-list-item :disabled="!passKeyForUnlock">
              <v-list-item-avatar class="my-0">
                <v-img :src="assets.autoTriggerSvg" contain :style="{
                  width: '24px',
                  height: '24px',
                  opacity: !passKeyForUnlock ? '0.5' : 1,
                }" />
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ $t('security.autoTriggerPassKeyUnlock') }}</v-list-item-title>
                <v-list-item-subtitle v-if="!passKeyForUnlock">
                  {{ $t('security.autoTriggerRequiresPassKeyUnlock') }}
                </v-list-item-subtitle>
                <v-list-item-subtitle v-else>
                  {{ $t('security.autoTriggerPassKeyUnlockDescription') }}
                </v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action>
                <v-switch
                  inset
                  dense
                  v-model="passKeyAutoTriggerUnlock"
                  color="primary"
                  :disabled="!isPassKeySupported || !passKeyForUnlock"
                  @change="handlePassKeyAutoTriggerUnlockChange"
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
import assets from '@/utils/assets';
import { debugLog } from '@/utils/debug';
import { BackgroundResponse, VerifyPasswordResponse } from '@/chrome/messaging';

const { t } = useTranslation();

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
const passKeyForUnlock = ref(false);
const passKeyForPasswordAutofill = ref(false);
const passKeyAutoTrigger = ref(false);
const passKeyAutoTriggerUnlock = ref(false);
const isPassKeySupported = ref(false);
const isPassKeyRegistered = ref(false);
const loadingPassKeyRegistration = ref(false);
const loading = ref(false);
const loadingPassKeyUnlock = ref(false);
const loadingPassKeyAutofill = ref(false);
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

const isPrfWallet = computed(() => {
  const wallet = walletStore.loggedWallet;
  return wallet?.encryptionMethod === 'prf';
});

const isPassKeyAutofillDisabled = computed(() => {
  // Disable if browser doesn't support PassKey, if PassKey not registered, if loading, or if no unlock method is set
  return !isPassKeySupported.value || !isPassKeyRegistered.value || loadingPassKeyAutofill.value || !selectedUnlockMethod.value;
});

const isPassKeyUnlockDisabled = computed(() => {
  // Disable if browser doesn't support PassKey, if PassKey not registered, if loading, or if no unlock method is set
  return !isPassKeySupported.value || !isPassKeyRegistered.value || loadingPassKeyUnlock.value || !selectedUnlockMethod.value;
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

// Check PassKey support immediately on component creation
function checkPassKeySupport() {
  // Check if WebAuthn is supported
  isPassKeySupported.value = !!window.PublicKeyCredential;
}

// Initialize the PassKey support check immediately
checkPassKeySupport();

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

    // Load PassKey settings
    const credentialConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();
    const passKeyUnlockConfig = await configTable.where({ key: 'passKeyForUnlock' }).first();
    const passKeyAutofillConfig = await configTable.where({ key: 'passKeyForPasswordAutofill' }).first();
    const passKeyAutoTriggerConfig = await configTable.where({ key: 'passKeyAutoTrigger' }).first();
    const passKeyAutoTriggerUnlockConfig = await configTable.where({ key: 'passKeyAutoTriggerUnlock' }).first();

    // Check if PassKey is registered
    // For PRF wallets, credential is in wallet record; for normal wallets, it's in config table
    const isPrfWallet = walletStore.loggedWallet?.encryptionMethod === 'prf' ||
                        !!walletStore.loggedWallet?.webAuthnCredentialId;
    isPassKeyRegistered.value = isPrfWallet
      ? !!walletStore.loggedWallet?.webAuthnCredentialId
      : !!(credentialConfig?.value);

    passKeyForUnlock.value = passKeyUnlockConfig?.value || false;
    passKeyForPasswordAutofill.value = passKeyAutofillConfig?.value || false;
    passKeyAutoTrigger.value = passKeyAutoTriggerConfig?.value || false;
    passKeyAutoTriggerUnlock.value = passKeyAutoTriggerUnlockConfig?.value || false;

    // Check PassKey support
    checkPassKeySupport();
  } catch (error) {
    console.error('Error loading security settings:', error);
    selectedUnlockMethod.value = null;
    selectedAutoLockMinutes.value = 0;
    passKeyForUnlock.value = false;
    passKeyForPasswordAutofill.value = false;
    passKeyAutoTrigger.value = false;
    passKeyAutoTriggerUnlock.value = false;
  }
}

async function handleUnlockMethodSelect(method: UnlockMethod) {
  errorMessage.value = '';

  if (method === null) {
    // None - save immediately
    await saveUnlockMethod(method);
  } else if (method === 'password') {
    // Password unlock:
    // - Normal wallets: Use existing spending password (save immediately)
    // - PRF wallets: Need to set up lock password (require setup)
    if (isPrfWallet.value) {
      emit('setup-unlock-method', method); // PRF wallets need lock password setup
    } else {
      await saveUnlockMethod(method); // Normal wallets use spending password
    }
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
      // Remove unlock method data (but keep PassKey registration and encrypted password)
      await configTable.put({ key: 'unlockMethod', value: null });
      await configTable.where({ key: 'pinHash' }).delete();
      await configTable.where({ key: 'encryptedPinHash' }).delete();
      await configTable.where({ key: 'encryptedPatternHash' }).delete();
      // Note: webAuthnCredentialId and passKeyEncryptedSpendingPassword are NOT deleted
      // PassKey registration persists - user can re-enable PassKey features after setting a new unlock method

      // Disable PassKey features when the unlock method is set to None
      await configTable.put({ key: 'passKeyForUnlock', value: false });
      await configTable.put({ key: 'passKeyAutoTriggerUnlock', value: false });
      await configTable.put({ key: 'passKeyForPasswordAutofill', value: false });
      await configTable.put({ key: 'passKeyAutoTrigger', value: false });

      // Update the reactive state to reflect changes in UI
      passKeyForUnlock.value = false;
      passKeyAutoTriggerUnlock.value = false;
      passKeyForPasswordAutofill.value = false;
      passKeyAutoTrigger.value = false;
    } else {
      // Save unlock method
      await configTable.put({ key: 'unlockMethod', value: method });
    }

    selectedUnlockMethod.value = method;

    // Emit update event
    emit('updated');
  } catch (error: unknown) {
    console.error('Error saving unlock method:', error);
    errorMessage.value = error['message'] || t('security.unlockMethodUpdateFailed');
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
  } catch (error: unknown) {
    console.error('Error saving auto-lock setting:', error);
    errorMessage.value = error['message'] || t('security.autoLockUpdateFailed');
  } finally {
    loading.value = false;
  }
}

async function handlePassKeyUnlockChange(enabled: boolean) {
  loadingPassKeyUnlock.value = true;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    // PassKey must already be registered - just toggle the setting
    // Save PassKey unlock setting
    await configTable.put({ key: 'passKeyForUnlock', value: enabled });

    // If disabling, also disable auto-trigger
    if (!enabled) {
      await configTable.put({ key: 'passKeyAutoTriggerUnlock', value: false });
      passKeyAutoTriggerUnlock.value = false;
    }

    debugLog(`✅ PassKey unlock ${enabled ? 'enabled' : 'disabled'}`);

    // Show success snackbar
    snackbar.fireSuccess(t('security.passKeySettingsUpdated'));

    // Emit update event
    emit('updated');
  } catch (error: unknown) {
    console.error('Error saving PassKey unlock setting:', error);

    // Show error snackbar
    snackbar.setError(error['message'] || t('security.passKeySettingsUpdateFailed'));

    // Revert the switch
    passKeyForUnlock.value = !enabled;
  } finally {
    loadingPassKeyUnlock.value = false;
  }
}

async function handlePassKeyAutofillChange(enabled: boolean) {
  loadingPassKeyAutofill.value = true;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    if (enabled) {
      // Check if encrypted password already exists (from previous setup)
      const existingEncryptedPassword = await configTable.where({ key: 'passKeyEncryptedSpendingPassword' }).first();
      const credentialConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();

      if (existingEncryptedPassword?.value && credentialConfig?.value) {
        // Encrypted password exists - verify it's still valid by attempting PRF decryption
        // This requires WebAuthn authentication, ensuring the user has device access
        const { decryptSpendingPasswordWithPrf } = await import('@/shared/utils/webauthn-prf');

        debugLog('🔐 Verifying existing PassKey encrypted password with PRF...');

        // Try to decrypt to verify the encrypted password is still valid
        // PRF decryption includes authentication automatically
        try {
          await decryptSpendingPasswordWithPrf(
            existingEncryptedPassword.value,
            credentialConfig.value,
            wallet.id
          );
          debugLog('✅ Existing encrypted password verified successfully');
        } catch (decryptError) {
          // Encrypted password is corrupted or invalid - need to re-setup
          console.error('Existing encrypted password invalid, requiring re-setup:', decryptError);
          throw new Error(t('security.passKeyCredentialChanged'));
        }
      } else {
        // No encrypted password exists - prompt for spending password to encrypt and store
        // Password verification happens inside the dialog's confirmPassword() function
        const password = await promptForSpendingPassword();

        if (!password) {
          // User cancelled
          throw new Error('Password prompt cancelled');
        }

        // Password is already verified at this point
        // Get or register WebAuthn credential
        let credentialId: string;
        let prfEnabled = false;

        if (!credentialConfig || !credentialConfig.value) {
          // No credential exists - register a new one for PassKey autofill with PRF
          debugLog('🔐 Registering WebAuthn credential with PRF for PassKey password autofill');
          const { credentialId: newCredentialId, prfEnabled: isPrfEnabled } = await registerWebAuthnCredential(
            wallet.id,
            wallet.name || 'Wallet'
          );
          credentialId = newCredentialId;
          prfEnabled = isPrfEnabled;

          // Check if PRF is enabled
          if (!prfEnabled) {
            throw new Error(t('security.passKeyPrfNotSupported'));
          }

          // Store credential ID in database
          await configTable.put({ key: 'webAuthnCredentialId', value: credentialId });
          debugLog('✅ WebAuthn credential registered with PRF enabled');
        } else {
          // Use existing credential
          credentialId = credentialConfig.value;
          debugLog('🔐 Using existing WebAuthn credential for PRF encryption');
        }

        // Encrypt password for PassKey storage using PRF
        // This will authenticate the user and verify PRF support in one step
        const { encryptSpendingPasswordWithPrf } = await import('@/shared/utils/webauthn-prf');
        try {
          const encryptedPassword = await encryptSpendingPasswordWithPrf(password, credentialId, wallet.id);

          // Store encrypted password in database
          await configTable.put({
            key: 'passKeyEncryptedSpendingPassword',
            value: encryptedPassword
          });

          debugLog('✅ Spending password encrypted and stored for PassKey autofill');
        } catch (prfError: unknown) {
          // If PRF fails, show user-friendly error
          if (prfError['message']?.includes('PRF evaluation failed')) {
            throw new Error(t('security.passKeyLegacyDetected'));
          }
          throw prfError;
        }
      }
    } else {
      // When disabling, keep the encrypted password for potential re-enabling
      // Only disable auto-trigger
      await configTable.put({ key: 'passKeyAutoTrigger', value: false });
      passKeyAutoTrigger.value = false;
      debugLog('🔒 PassKey autofill disabled (encrypted password retained)');
    }

    // Save PassKey autofill setting
    await configTable.put({ key: 'passKeyForPasswordAutofill', value: enabled });

    // Show success snackbar
    snackbar.fireSuccess(t('security.passKeySettingsUpdated'));

    // Emit update event
    emit('updated');
  } catch (error: unknown) {
    console.error('Error saving PassKey autofill setting:', error);

    // Show error snackbar
    snackbar.setError(error['message'] || t('security.passKeySettingsUpdateFailed'));

    // Revert the switch
    passKeyForPasswordAutofill.value = !enabled;
  } finally {
    loadingPassKeyAutofill.value = false;
  }
}

/**
 * Handle PassKey auto-trigger change for password autofill
 */
async function handlePassKeyAutoTriggerChange() {
  const enabled = passKeyAutoTrigger.value;

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
    await configTable.put({ key: 'passKeyAutoTrigger', value: enabled });

    // Show success snackbar
    snackbar.fireSuccess(t('security.passKeySettingsUpdated'));

    debugLog('✅ PassKey auto-trigger (password autofill) setting saved:', enabled);

    // Emit update event
    emit('updated');
  } catch (error: unknown) {
    console.error('Error saving PassKey auto-trigger setting:', error);

    // Show error snackbar
    snackbar.setError(error['message'] || t('security.passKeySettingsUpdateFailed'));

    // Revert the switch
    passKeyAutoTrigger.value = !enabled;
  }
}

/**
 * Handle PassKey registration
 */
async function handlePassKeyRegister() {
  loadingPassKeyRegistration.value = true;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    // Register WebAuthn credential with PRF
    debugLog('🔐 Registering WebAuthn credential with PRF support...');
    const { credentialId, prfEnabled } = await registerWebAuthnCredential(wallet.id, wallet.name || 'Wallet');

    // Check if PRF is enabled
    if (!prfEnabled) {
      throw new Error(t('security.passKeyPrfNotSupported'));
    }

    // Store credential ID in database
    await configTable.put({ key: 'webAuthnCredentialId', value: credentialId });

    // Update registration status
    isPassKeyRegistered.value = true;

    debugLog('✅ WebAuthn credential registered successfully');
    snackbar.fireSuccess(t('security.passKeyRegisteredSuccess'));

    // Emit update event
    emit('updated');
  } catch (error: unknown) {
    console.error('Error registering PassKey:', error);
    snackbar.setError(error['message'] || t('security.passKeyRegistrationFailed'));
  } finally {
    loadingPassKeyRegistration.value = false;
  }
}

/**
 * Handle PassKey deregistration
 */
async function handlePassKeyDeregister() {
  loadingPassKeyRegistration.value = true;

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) {
      throw new Error('No wallet logged in');
    }

    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    // Remove WebAuthn credential and all related settings
    debugLog('🗑️ Deregistering PassKey...');
    await configTable.where({ key: 'webAuthnCredentialId' }).delete();
    await configTable.where({ key: 'passKeyEncryptedSpendingPassword' }).delete();
    await configTable.put({ key: 'passKeyForUnlock', value: false });
    await configTable.put({ key: 'passKeyForPasswordAutofill', value: false });
    await configTable.put({ key: 'passKeyAutoTrigger', value: false });
    await configTable.put({ key: 'passKeyAutoTriggerUnlock', value: false });

    // Update UI state
    isPassKeyRegistered.value = false;
    passKeyForUnlock.value = false;
    passKeyForPasswordAutofill.value = false;
    passKeyAutoTrigger.value = false;
    passKeyAutoTriggerUnlock.value = false;

    debugLog('✅ PassKey deregistered successfully');
    snackbar.fireSuccess(t('security.passKeyDeregisteredSuccess'));

    // Emit update event
    emit('updated');
  } catch (error: unknown) {
    console.error('Error deregistering PassKey:', error);
    snackbar.setError(error['message'] || t('security.passKeyDeregistrationFailed'));
  } finally {
    loadingPassKeyRegistration.value = false;
  }
}

/**
 * Handle PassKey auto-trigger change for wallet unlock
 */
async function handlePassKeyAutoTriggerUnlockChange() {
  const enabled = passKeyAutoTriggerUnlock.value;

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
    await configTable.put({ key: 'passKeyAutoTriggerUnlock', value: enabled });

    // Show success snackbar
    snackbar.fireSuccess(t('security.passKeySettingsUpdated'));

    debugLog('✅ PassKey auto-trigger (unlock) setting saved:', enabled);

    // Emit update event
    emit('updated');
  } catch (error: unknown) {
    console.error('Error saving PassKey auto-trigger unlock setting:', error);

    // Show error snackbar
    snackbar.setError(error['message'] || t('security.passKeySettingsUpdateFailed'));

    // Revert the switch
    passKeyAutoTriggerUnlock.value = !enabled;
  }
}

/**
 * Prompt user for spending password with a dialog
 * @returns Promise<string | null> - Password or null if canceled
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

    debugLog('🔐 Verifying spending password...');
    const verifyResponse = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: passwordInput.value }
    }) as BackgroundResponse<VerifyPasswordResponse>;

    if (!verifyResponse.data.success) {
      // Show error tooltip
      passwordErrorTooltipText.value = verifyResponse.data.error || t('errors.wrongPassword');
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
  } catch (error: unknown) {
    console.error('Error verifying password:', error);

    // Show error tooltip
    passwordErrorTooltipText.value = error['message'] || t('common.error');
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
