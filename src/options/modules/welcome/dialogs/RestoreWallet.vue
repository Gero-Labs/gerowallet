<template>
  <BaseDialog
    :title="t('welcome.restoreWallet')"
    :subtitle="props.network.title"
    style="opacity: 0.9"
    content-class="rounded-xxl dialogStyle darken"
    :is-open="dialog"
    @close="emit('dialogChange', false)"
    scrollable
    :min-height="0"
    :img="assets.keySvg"
    :persistent="false"
  >
    <v-card-text class="px-0 py-2">
      <v-stepper v-model="step" flat class="transparent">
        <v-stepper-items>
          <v-stepper-content step="1">
            <v-form ref="form" v-model="valid">
              <v-card
                flat
                class="transparent d-flex row fill-height no-gutters"
                style="min-height: 380px"
              >
                <v-card-text class="px-0 pb-0 justify-space-around no-gutters">
                  <v-row no-gutters class="pb-2">
                    <strong style="align-content: center; color: white">{{ $t('welcome.chooseRecoveryPhraseLength') }}</strong>
                    <v-spacer></v-spacer>
                    <v-btn-toggle color="primary" v-model="seedPhraseLength" mandatory>
                      <v-btn small value="12">
                        <v-icon style="right: -5px">mdi-numeric-1</v-icon>
                        <v-icon style="left: -5px">mdi-numeric-2</v-icon>
                      </v-btn>
                      <v-btn small value="15">
                        <v-icon style="right: -5px">mdi-numeric-1</v-icon>
                        <v-icon style="left: -5px">mdi-numeric-5</v-icon>
                      </v-btn>
                      <v-btn small value="24">
                        <v-icon style="right: -5px">mdi-numeric-2</v-icon>
                        <v-icon style="left: -5px">mdi-numeric-4</v-icon>
                      </v-btn>
                    </v-btn-toggle>
                  </v-row>
                  <v-card flat outlined class="mb-4 pa-1" style="background-color: black">
                    <v-row no-gutters>
                      <v-col class="pa-1" cols="12" :md="3" v-for="index in recoverySeedPhraseLength" :key="index">
                        <mnemonic-autocomplete
                          v-model="recoverySeedPhrase[index - 1]"
                          :index="index"
                          @next="focusNextCell"
                        ></mnemonic-autocomplete>
                      </v-col>
                    </v-row>
                  </v-card>
                </v-card-text>
              </v-card>
            </v-form>
          </v-stepper-content>

          <!-- Step 2: Name + Icon + Security Method Selection -->
          <v-stepper-content step="2">
            <v-card flat class="transparent d-flex justify-center" style="min-height: 380px">
              <v-form ref="nameForm" v-model="nameValid" style="max-width: 540px; width: 100%;">
                <!-- Wallet Name -->
                <h2 class="text-left white--text mb-3">{{ $t('welcome.setUpWalletName') }}</h2>

                <v-text-field
                  v-model="newWallet.name"
                  dense
                  filled
                  autofocus
                  :label="$t('welcome.walletName')"
                  :placeholder="$t('welcome.walletNamePlaceholder')"
                  :rules="[rules.required(), rules.minCharacters(3), rules.maxCharacters(40)]"
                  hide-details
                />

                <!-- Security Method Selection -->
                <template v-if="prfSupported">
                  <v-divider class="my-5" style="border-color: rgba(255, 255, 255, 0.12);" />
                  <!-- PassKey Card (Full) -->
                  <SecurityMethodCard
                    :title="t('welcome.passKeyMethod')"
                    icon="mdi-shield-key"
                    icon-color="primary"
                    :benefits="[
                      t('welcome.passKeyBenefit1'),
                      t('welcome.passKeyBenefit2'),
                      t('welcome.passKeyBenefitKeysSecure')
                    ]"
                    :learn-more-content="t('welcome.passKeyLearnMoreFull')"
                    :selected="selectedSecurityMethod === 'prf'"
                    :recommended="true"
                    @select="selectedSecurityMethod = 'prf'"
                    class="mb-3"
                    style="width: 100%"
                  />
                  <!-- Password Card (Minimal) -->
                  <v-card
                    flat
                    class="method-card mb-3"
                    :class="{ 'method-card--selected': selectedSecurityMethod === 'password' }"
                    :style="{ backgroundColor: '#00000080' }"
                    @click="selectedSecurityMethod = 'password'"
                    style="width: 100%"
                  >
                    <v-list-item class="px-4 py-3" style="background: transparent;">
                      <v-avatar color="grey darken-1" size="24" class="mr-3 my-0 align-self-center">
                        <v-icon dark small>mdi-key-variant</v-icon>
                      </v-avatar>
                      <v-list-item-content class="py-0">
                        <v-list-item-title class="text-subtitle-1 white--text font-weight-medium">
                          {{ $t('welcome.passwordMethod') }}
                        </v-list-item-title>
                        <v-list-item-subtitle class="text-body-2">
                          {{ $t('welcome.passwordMethodDesc') }}
                        </v-list-item-subtitle>
                      </v-list-item-content>
                      <v-icon v-if="selectedSecurityMethod === 'password'" color="primary" class="ml-2">mdi-check-circle</v-icon>
                    </v-list-item>
                  </v-card>
                </template>

                <!-- PRF Not Supported Alert -->
                <v-alert
                  v-else
                  color="warning"
                  icon="mdi-alert-outline"
                  dense
                  outlined
                  border="left"
                  class="mt-4"
                >
                  {{ $t('welcome.prfNotSupported') }}
                </v-alert>
              </v-form>
            </v-card>
          </v-stepper-content>

          <!-- Step 3: Confirmation (PRF or Password) -->
          <v-stepper-content step="3" class="align-content-center">
            <v-card
              flat
              class="transparent d-flex justify-center"
              style="min-height: 380px"
              :disabled="creatingWalletLoader"
            >
              <div style="max-width: 540px; width: 100%;">
                <!-- PRF Confirmation Path -->
                <template v-if="selectedSecurityMethod === 'prf'">
                  <!-- Summary header -->
                  <div class="text-center mb-3">
                    <v-icon color="primary" size="28" class="mb-1">mdi-check-circle-outline</v-icon>
                    <h3 class="white--text mb-1 text-h6">{{ $t('welcome.almostDone') }}</h3>
                    <p class="grey--text text--lighten-1 mb-0">{{ $t('welcome.reviewYourChoices') }}</p>
                  </div>

                  <!-- Wallet summary card -->
                  <v-card class="mb-3" outlined style="background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.12);">
                    <v-card-text class="pa-3">
                      <div class="d-flex align-center mb-2">
                        <v-avatar size="32" class="mr-2">
                          <v-img :src="assets[`${newWallet.icon}Svg`]" cover></v-img>
                        </v-avatar>
                        <div>
                          <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('welcome.walletName') }}</div>
                          <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ newWallet.name }}</div>
                        </div>
                      </div>
                      <v-divider class="my-2" style="border-color: rgba(255, 255, 255, 0.12);"></v-divider>
                      <v-row no-gutters>
                        <v-col cols="6" class="pr-3">
                          <div class="d-flex align-center">
                            <v-icon color="primary" size="20" class="mr-2">mdi-shield-key</v-icon>
                            <div>
                              <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('welcome.securityMethod') }}</div>
                              <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ $t('welcome.passKeyMethod') }}</div>
                            </div>
                          </div>
                        </v-col>
                        <v-divider vertical style="border-color: rgba(255, 255, 255, 0.12);"></v-divider>
                        <v-col cols="6" class="pl-3">
                          <div class="d-flex align-center">
                            <v-avatar size="20" class="mr-2">
                              <v-img :src="props.network.icon" contain></v-img>
                            </v-avatar>
                            <div>
                              <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('common.network') }}</div>
                              <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ props.network.title }}</div>
                            </div>
                          </div>
                        </v-col>
                      </v-row>
                    </v-card-text>
                  </v-card>

                  <!-- PRF acknowledgments -->
                  <v-form ref="prfForm" v-model="prfFormValid">
                    <v-checkbox
                      v-model="acknowledgments.recoveryPhrase"
                      :rules="[rules.required()]"
                      hide-details
                      class="mb-1 mt-0"
                    >
                      <template v-slot:label>
                        <span class="text-body-2">{{ $t('welcome.saveRecoveryBackup') }}</span>
                      </template>
                    </v-checkbox>

                    <v-checkbox
                      v-model="acknowledgments.termsAccepted"
                      :rules="[rules.required()]"
                      hide-details
                      class="mb-1 mt-0"
                    >
                      <template v-slot:label>
                        <span class="text-body-2">
                          {{ $t('welcome.iHaveReadTerms') }}
                          <a class="terms-link" @click.stop="openTerms">{{ $t('welcome.termsOfService') }}</a>.
                        </span>
                      </template>
                    </v-checkbox>
                  </v-form>
                </template>

                <!-- Password Confirmation Path -->
                <template v-else>
                  <h2 class="text-left white--text mb-3">{{ $t('welcome.setUpSpendingPassword') }}</h2>

                  <v-form ref="passwordForm" v-model="passwordFormValid">
                    <v-text-field
                      v-model="newWallet.password"
                      dense
                      filled
                      :label="$t('welcome.password')"
                      :placeholder="$t('welcome.password')"
                      :type="show1 ? 'text' : 'password'"
                      :append-icon="show1 ? 'mdi-eye' : 'mdi-eye-off'"
                      @click:append="show1 = !show1"
                      :rules="[
                        rules.required(),
                        rules.minCharacters(10),
                        rules.oneOrMoreNumbers,
                        rules.containCapital,
                        rules.containLowerCase,
                        rules.containSpecialCharacter,
                        rules.spaceNotAllowed
                      ]"
                    ></v-text-field>

                    <v-text-field
                      v-model="newWallet.confirmPassword"
                      dense
                      filled
                      :label="$t('welcome.confirmPassword')"
                      :placeholder="$t('welcome.confirmPassword')"
                      :type="show2 ? 'text' : 'password'"
                      :append-icon="show2 ? 'mdi-eye' : 'mdi-eye-off'"
                      @click:append="show2 = !show2"
                      :rules="[
                        rules.required(),
                        (v) => v === newWallet.password || $t('welcome.passwordsMustMatch')
                      ]"
                    ></v-text-field>

                    <!-- No-recovery warning -->
                    <v-alert
                      color="warning"
                      icon="mdi-alert-outline"
                      outlined
                      dense
                      border="left"
                      class="mb-3"
                    >
                      <span class="text-body-2">{{ $t('welcome.passwordNoRecoveryWarning') }}</span>
                    </v-alert>

                    <!-- Password acknowledgments -->
                    <v-checkbox
                      v-model="acknowledgments.passwordRecovery"
                      :rules="[rules.required()]"
                      hide-details
                      class="mb-1 mt-0"
                    >
                      <template v-slot:label>
                        <span class="text-body-2">{{ $t('welcome.understandPasswordRecovery') }}</span>
                      </template>
                    </v-checkbox>

                    <v-checkbox
                      v-model="acknowledgments.termsAccepted"
                      :rules="[rules.required()]"
                      hide-details
                      class="mb-1 mt-0"
                    >
                      <template v-slot:label>
                        <span class="text-body-2">
                          {{ $t('welcome.iHaveReadTerms') }}
                          <a class="terms-link" @click.stop="openTerms">{{ $t('welcome.termsOfService') }}</a>.
                        </span>
                      </template>
                    </v-checkbox>
                  </v-form>
                </template>
              </div>
            </v-card>
          </v-stepper-content>
        </v-stepper-items>
      </v-stepper>
    </v-card-text>

    <!-- Action Buttons -->
    <v-card-actions class="justify-space-between px-6 pb-4">
      <!-- Step 1: Continue -->
      <template v-if="step === 1">
        <v-spacer></v-spacer>
        <v-btn
          color="primary"
          :class="isApex ? 'apexButton' : 'geroButton'"
          style="color: black!important;"
          :disabled="!valid"
          @click="walletCreationStep1"
        >
          {{ $t('wallet.continue') }}
        </v-btn>
      </template>

      <!-- Step 2: Back + Continue -->
      <template v-if="step === 2">
        <v-btn text @click="step = 1">
          {{ $t('common.back') }}
        </v-btn>
        <v-btn
          color="primary"
          :class="isApex ? 'apexButton' : 'geroButton'"
          style="color: black!important;"
          :disabled="!nameValid"
          @click="handleContinue"
        >
          {{ $t('common.continue') }}
        </v-btn>
      </template>

      <!-- Step 3: Back + Create Wallet -->
      <template v-if="step === 3">
        <v-btn text @click="step = 2" :disabled="creatingWalletLoader">
          {{ $t('common.back') }}
        </v-btn>
        <v-btn
          color="primary"
          :class="isApex ? 'apexButton' : 'geroButton'"
          style="color: black!important;"
          :disabled="!canCreate"
          :loading="creatingWalletLoader"
          @click="walletCreationStep3"
        >
          {{ $t('wallet.createWallet') }}
        </v-btn>
      </template>
    </v-card-actions>

    <!-- Existing Wallet Confirmation Dialog -->
    <v-dialog v-model="showConfirmDialog" max-width="500" persistent>
      <v-card class="rounded-xl">
        <v-card-title class="text-h6">
          {{ $t('welcome.walletAlreadyExists') }}
        </v-card-title>
        <v-card-text v-if="existingWalletInfo">
          <p class="mb-2">
            {{ $t('welcome.walletExistsMessage', { name: existingWalletInfo.name }) }}
          </p>
          <p class="text--secondary">
            {{ $t('welcome.wouldYouLikeToLogin') }}
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="handleCancelLogin">
            {{ $t('common.cancel') }}
          </v-btn>
          <v-btn color="primary" @click="handleConfirmLogin" :loading="creatingWalletLoader">
            {{ $t('wallet.login') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onMounted, getCurrentInstance, reactive, nextTick } from 'vue';
import * as bip39 from 'bip39';
import rules from '@/utils/rules';
import { Theme } from '@/models/types';
import { NetworkInfo } from '@/utils/networks';
import MnemonicAutocomplete from '@/modules/welcome/components/MnemonicAutocomplete.vue';
import SecurityMethodCard from '@/shared/components/SecurityMethodCard.vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import assets from '@/utils/assets';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import GeroStore from '@/stores/geroStore';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

// Props
interface Props {
  dialog: boolean;
  network: NetworkInfo;
}

const props = withDefaults(defineProps<Props>(), {
  dialog: false,
});

// Emits
const emit = defineEmits(['dialogChange']);

// Vue instance
const vmProxy = getCurrentInstance()!.proxy;
const router = vmProxy?.$router;

// Template refs
const form = ref(null);
const nameForm = ref(null);
const nameValid = ref(false);
const passwordForm = ref(null);
const passwordFormValid = ref(false);
const prfForm = ref(null);
const prfFormValid = ref(false);

// Reactive data
const step = ref(1);
const show1 = ref<boolean>(false);
const show2 = ref<boolean>(false);
const prfSupported = ref<boolean>(false);

const newWallet = reactive({
  name: '',
  icon: props.network?.blockchain?.includes('Apex') ? 'orange' : 'green',
  password: '',
  confirmPassword: '',
  encryptionMethod: 'password' as 'password' | 'prf',
  backupMnemonic: true,
});

const acknowledgments = reactive({
  recoveryPhrase: false,
  passwordRecovery: false,
  termsAccepted: false,
});

const selectedSecurityMethod = ref<'prf' | 'password'>('prf');
const creatingWalletLoader = ref<boolean>(false);
const seedPhraseLength = ref<string>('24');
const emptySeedPhrase: string[] = Array(Number(seedPhraseLength.value)).fill('');
const recoverySeedPhrase = ref<string[]>(emptySeedPhrase);
const showConfirmDialog = ref<boolean>(false);
const existingWalletInfo = ref(null);

// Computed properties
const seedToStr = computed(() => {
  return computedRecoverySeedPhrase.value.join(' ');
});

// Check if selected network is Apex
const isApex = computed(() => {
  return props.network?.blockchain?.includes('Apex');
});

const computedRecoverySeedPhrase = computed(() => {
  if (recoverySeedPhrase.value) {
    return recoverySeedPhrase.value.filter((item, index) => item && index < recoverySeedPhraseLength.value);
  }
  return undefined;
});

const recoverySeedPhraseLength = computed(() => {
  return Number(seedPhraseLength.value);
});

const valid = computed({
  get() {
    if (computedRecoverySeedPhrase.value) {
      try {
        return (
          computedRecoverySeedPhrase.value.length === Number(seedPhraseLength.value) &&
          bip39.validateMnemonic(computedRecoverySeedPhrase.value.join(' '))
        );
      } catch {
        return false;
      }
    }
    return false;
  },
  set(_value: boolean) {},
});

// Watch security method selection
watch(selectedSecurityMethod, (newMethod) => {
  newWallet.encryptionMethod = newMethod;
  if (newMethod === 'prf') {
    newWallet.backupMnemonic = true;
  }
  // Reset acknowledgments when switching methods
  acknowledgments.recoveryPhrase = false;
  acknowledgments.passwordRecovery = false;
  acknowledgments.termsAccepted = false;
});

const canCreate = computed(() => {
  if (selectedSecurityMethod.value === 'prf') {
    return prfFormValid.value;
  }
  return passwordFormValid.value;
});

// Watch dialog prop for keyboard listener setup
watch(() => props.dialog, (newValue) => {
  if (newValue) {
    document.addEventListener('keydown', onKeydown);
  } else {
    document.removeEventListener('keydown', onKeydown);
  }
});

// Lifecycle hooks
onMounted(async () => {
  try {
    const { isPrfSupported } = await import('@/shared/utils/webauthn-prf');
    prfSupported.value = await isPrfSupported();

    // Default to PRF if supported
    if (prfSupported.value) {
      selectedSecurityMethod.value = 'prf';
      newWallet.encryptionMethod = 'prf';
    } else {
      selectedSecurityMethod.value = 'password';
      newWallet.encryptionMethod = 'password';
    }
  } catch (error) {
    console.error('Error checking PRF support:', error);
    prfSupported.value = false;
    selectedSecurityMethod.value = 'password';
    newWallet.encryptionMethod = 'password';
  }
});

// Methods
const onKeydown = (event: KeyboardEvent) => {
  if ((event.code === 'KeyV' && event.ctrlKey) || (event.code === 'KeyV' && event.metaKey)) {
    pasteFromClipboard();
  }
};

const focusNextCell = (el: HTMLElement) => {
  const currentCell = el.closest('.v-input');
  const nextCell = currentCell?.nextElementSibling;
  if (nextCell) {
    const nextAutocomplete = nextCell.querySelector('.v-autocomplete input') as HTMLInputElement;
    if (nextAutocomplete) {
      nextAutocomplete.focus();
    }
  }
};

const pasteFromClipboard = async () => {
  if (step.value === 1) {
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) return;
      recoverySeedPhrase.value = text.split(' ');
      if ([12, 15, 24].includes(recoverySeedPhrase.value.length)) {
        seedPhraseLength.value = recoverySeedPhrase.value.length.toString();
      }
    } catch {
      // Clipboard access denied or unavailable
    }
  }
};

const walletCreationStep1 = () => {
  if (form.value?.validate()) {
    step.value = 2;
  }
};

const handleContinue = () => {
  // Reset acknowledgments and validation before showing step 2
  acknowledgments.recoveryPhrase = false;
  acknowledgments.passwordRecovery = false;
  acknowledgments.termsAccepted = false;
  nextTick(() => {
    if (prfForm.value) prfForm.value.resetValidation();
    if (passwordForm.value) passwordForm.value.resetValidation();
    step.value = 3;
  });
};

const walletCreationStep3 = async () => {
  creatingWalletLoader.value = true;
  try {
    // Check if wallet with same mnemonic already exists
    const { derivePublicKeyFromMnemonic, getWalletByPublicKey } = await import('@/db/gero-db');
    const publicKey = await derivePublicKeyFromMnemonic(seedToStr.value);
    const existingWallet = await getWalletByPublicKey(publicKey);

    if (existingWallet) {
      existingWalletInfo.value = existingWallet;
      showConfirmDialog.value = true;
      creatingWalletLoader.value = false;
      return;
    }

    let wallet;

    if (selectedSecurityMethod.value === 'prf') {
      // ========================================================================
      // PRF WALLET RESTORATION (PURE PRF MODE - NO PASSWORD)
      // ========================================================================

      try {
        // Step 1: Get next wallet ID from single source of truth
        const { getNextWalletId } = await import('@/db/gero-db');
        const newWalletId = await getNextWalletId();

        // Step 2: Register credential AND evaluate PRF in one prompt
        const { registerWebAuthnCredentialWithPrf } = await import('@/shared/utils/webauthn-prf');
        const { credentialId, prfEnabled, prfOutput } = await registerWebAuthnCredentialWithPrf(
          newWalletId.toString(),
          newWallet.name
        );

        if (!prfEnabled) {
          throw new Error(vmProxy.$t('security.passKeyPrfNotSupported') as string);
        }

        try {
          const prfOptions = {
            usePrf: true,
            credentialId,
            passwordUnlockEnabled: false,
            backupMnemonic: true,
            prfOutput,
            walletId: newWalletId, // CRITICAL: Must match ID used for PRF salt
          };

          wallet = await GeroStore.createNewWallet(
            newWallet.name,
            newWallet.icon,
            Theme.GERO,
            seedToStr.value,
            newWallet.password || 'temp-password',
            props.network.blockchain,
            props.network.network,
            prfOptions
          );
        } finally {
          if (prfOutput) {
            new Uint8Array(prfOutput).fill(0);
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isDOMException = error instanceof DOMException && error.name === 'NotAllowedError';
        if (message.includes('cancelled') || isDOMException) {
          creatingWalletLoader.value = false;
          return;
        }
        throw error;
      }
    } else {
      // ========================================================================
      // PASSWORD WALLET RESTORATION
      // ========================================================================
      wallet = await GeroStore.createNewWallet(
        newWallet.name,
        newWallet.icon,
        Theme.GERO,
        seedToStr.value,
        newWallet.password,
        props.network.blockchain,
        props.network.network
      );
    }

    await performLogin(wallet);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Wallet restoration failed:', msg);
    vmProxy['$snackbar']?.setError(vmProxy.$t('errors.unknownError') as string);
    creatingWalletLoader.value = false;
  }
};

const performLogin = async (wallet) => {
  try {
    emit('dialogChange', false);
    showConfirmDialog.value = false;

    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });

    const hasError = response && typeof response === 'object' && 'error' in response;
    if (response && !hasError) {
      vmProxy.$nextTick(() => {
        resetDialog();
        router.push('/').catch(err => {
          if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
            console.warn('Navigation error:', err);
          }
        });
      });
    } else if (hasError) {
      console.warn('Login response contained error, proceeding anyway');
      vmProxy.$nextTick(() => {
        resetDialog();
        router.push('/').catch(() => {});
      });
    }
  } catch (error) {
    console.error('Error during login:', error);
  } finally {
    creatingWalletLoader.value = false;
  }
};

const handleConfirmLogin = async () => {
  if (existingWalletInfo.value) {
    creatingWalletLoader.value = true;
    await performLogin(existingWalletInfo.value);
  }
};

const handleCancelLogin = () => {
  showConfirmDialog.value = false;
  existingWalletInfo.value = null;
};

const openTerms = () => {
  window.open('https://www.gerowallet.io/_files/ugd/79567a_718ec62866234a2689831a9e5c632725.pdf?index=true', '_blank');
};

const resetDialog = () => {
  Object.assign(newWallet, {
    name: '',
    icon: 'green',
    password: '',
    confirmPassword: '',
    encryptionMethod: 'password',
    backupMnemonic: true,
  });
  Object.assign(acknowledgments, {
    recoveryPhrase: false,
    passwordRecovery: false,
    termsAccepted: false,
  });
  step.value = 1;
  creatingWalletLoader.value = false;
  recoverySeedPhrase.value = Array(Number(seedPhraseLength.value)).fill('');
  nextTick(() => {
    if (form.value) form.value.resetValidation();
    if (nameForm.value) nameForm.value.resetValidation();
    if (passwordForm.value) passwordForm.value.resetValidation();
    if (prfForm.value) prfForm.value.resetValidation();
  });
};

// Lifecycle
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  resetDialog();
});
</script>
<style scoped lang="scss">
.v-dialog__content--active {
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

// Stepper — no header, content only
::v-deep .v-stepper {
  box-shadow: none !important;
}

::v-deep .v-stepper__content {
  min-height: 380px;
  transition: min-height 0.3s ease;
  padding: 0 16px;
}

::v-deep .v-stepper__wrapper {
  transition: height 0.3s ease;
}

// Action buttons
::v-deep .v-card__actions {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  min-height: 68px;
}

// Minimal password card
.method-card {
  border: 2px solid transparent;
  border-radius: 12px !important;
  cursor: pointer;
  transition: border-color 0.2s ease, transform 0.2s ease;

  &:hover {
    transform: translateY(-2px);
  }

  &--selected {
    border-color: var(--v-primary-base);
  }
}

// Remove checkbox hover highlight
::v-deep .v-input--checkbox {
  .v-input--selection-controls__ripple {
    display: none;
  }
}

// Terms link
.terms-link {
  color: var(--v-primary-base);
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
}

@media (max-width: 600px) {
  ::v-deep .v-stepper__content {
    min-height: auto;
  }
}
</style>
