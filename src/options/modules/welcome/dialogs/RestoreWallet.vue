<template>
  <v-dialog
    content-class="rounded-xxl dialogStyle darken"
    v-model="dialogLocal"
    scrollable
    max-width="850"
    min-height="742"
  >
    <v-card class="py-0 rounded-xxl transparent fill-height">
      <v-stepper v-model="step" flat style="background-color: transparent; height: 100%" non-linear>
        <v-stepper-header style="box-shadow: none">
          <v-stepper-step :complete="step > 1" step="1"> {{ $t('welcome.seedPhrase') }} </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step :complete="step > 2" step="2"> {{ $t('welcome.walletSetup') }} </v-stepper-step>
        </v-stepper-header>

        <v-stepper-items>
          <v-stepper-content step="1" style="text-align: -webkit-center" class="pt-0">
            <v-form ref="form" v-model="valid">
              <v-card
                flat
                class="transparent d-flex row fill-height no-gutters"
                style="max-width: 534px; min-height: 591px"
              >
                <v-card-text class="px-0 pb-0 justify-space-around no-gutters">
                  <v-alert color="primary" dense outlined type="info" prominent border="left" class="mb-2">
                    {{ $t('welcome.recoveryPhraseAlert') }}
                  </v-alert>
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
                      <v-col class="pa-1" cols="12" :md="4" v-for="index in recoverySeedPhraseLength" :key="index">
                        <mnemonic-autocomplete
                          v-model="recoverySeedPhrase[index - 1]"
                          :index="index"
                          @next="focusNextCell"
                        ></mnemonic-autocomplete>
                      </v-col>
                    </v-row>
                  </v-card>
                </v-card-text>
                <v-card-actions class="pa-0 align-self-end" style="width: 100%">
                  <!--                  <v-btn-->
                  <!--                    text-->
                  <!--                    color="primary"-->
                  <!--                    @click="pasteFromClipboard"-->
                  <!--                    elevation="0"-->
                  <!--                  >-->
                  <!--                    Paste from Clipboard-->
                  <!--                  </v-btn>-->
                  <v-spacer></v-spacer>
                  <v-btn color="primary" @click="walletCreationStep1" elevation="0" :disabled="!valid">
                    {{ $t('wallet.continue') }}
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-form>
          </v-stepper-content>

          <v-stepper-content step="2" style="text-align: -webkit-center" class="pt-0">
            <v-form ref="form2" v-model="valid2">
              <v-card
                flat
                class="transparent d-flex row fill-height no-gutters"
                style="max-width: 534px; min-height: 591px"
                :disabled="creatingWalletLoader"
              >
                <v-card-text class="px-0 d-flex row no-gutters">
                  <!-- PRF Mode Indicator (if PRF supported - Pure PRF mode only) -->
                  <template v-if="prfSupported">
                    <v-alert color="primary" icon="mdi-shield-key" prominent dense outlined border="left" class="mb-4" style="width: 100%;">
                      <div class="d-flex align-center">
                        <div class="font-weight-bold text-left flex-grow-1">{{ $t('welcome.prfEncryption') }}</div>
                        <v-tooltip bottom max-width="400" content-class="custom-tooltip">
                          <template v-slot:activator="{ on, attrs }">
                            <v-icon small color="primary" v-bind="attrs" v-on="on" class="ml-2">
                              mdi-information-outline
                            </v-icon>
                          </template>
                          <div class="text-body-2">
                            <div class="font-weight-bold mb-2">{{ $t('welcome.prfTooltipTitle') }}</div>
                            <div class="mb-2">{{ $t('welcome.prfTooltipDesc1') }}</div>
                            <div class="mb-2">{{ $t('welcome.prfTooltipDesc2') }}</div>
                            <div>{{ $t('welcome.prfTooltipDesc3') }}</div>
                          </div>
                        </v-tooltip>
                      </div>
                      <div class="text-caption text-left">{{ $t('welcome.prfEncryptionDesc') }}</div>
                    </v-alert>
                  </template>

                  <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">{{ $t('welcome.setUpWalletName') }}</h2>
                  <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">
                    {{ $t('welcome.chooseNameToIdentify') }}
                  </h3>
                  <v-text-field
                    style="width: 100%"
                    v-model="newWallet.name"
                    dense
                    filled
                    :label="$t('welcome.walletName')"
                    :placeholder="$t('welcome.walletNamePlaceholder')"
                    :rules="[rules.required(), rules.minCharacters(3), rules.maxCharacters(40)]"
                  ></v-text-field>
                  <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">{{ $t('welcome.walletIcon') }}</h2>
                  <v-radio-group v-model="newWallet.icon" row mandatory class="no-gutters mt-2 mb-2">
                    <v-radio value="green">
                      <template v-slot:label>
                        <v-avatar size="32">
                          <v-img :src="assets.greenSvg" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="purple">
                      <template v-slot:label>
                        <v-avatar size="32">
                          <v-img :src="assets.purpleSvg" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="pink">
                      <template v-slot:label>
                        <v-avatar size="32">
                          <v-img :src="assets.pinkSvg" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="orange">
                      <template v-slot:label>
                        <v-avatar size="32">
                          <v-img :src="assets.orangeSvg" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="blue">
                      <template v-slot:label>
                        <v-avatar size="32">
                          <v-img :src="assets.blueSvg" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="grey">
                      <template v-slot:label>
                        <v-avatar size="32">
                          <v-img :src="assets.greySvg" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                  </v-radio-group>

                  <!-- Spending Password Section (Password mode only - hidden for PRF) -->
                  <template v-if="!isPrfMode">
                    <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">{{ $t('welcome.setUpSpendingPassword') }}</h2>
                    <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">{{ $t('welcome.youllUseThisToLogin') }}</h3>

                    <!-- Password Fields (Password mode only) -->
                    <v-text-field
                    style="width: 100%"
                    block
                    dense
                    v-model="newWallet.password"
                    filled
                    :label="$t('wallet.spendingPassword')"
                    :type="show1 ? 'text' : 'password'"
                    :rules="passwordRequired ? [
                      rules.required(),
                      rules.spaceNotAllowed,
                      rules.minCharacters(10),
                      rules.oneOrMoreNumbers,
                      rules.containCapital,
                      rules.containLowerCase,
                      rules.containSpecialCharacter,
                    ] : []"
                  >
                    <template v-slot:append>
                      <v-icon @click="show1 = !show1" tabindex="-1">
                        {{ show1 ? 'mdi-eye' : 'mdi-eye-off' }}
                      </v-icon>
                    </template>
                  </v-text-field>
                  <v-text-field
                    style="width: 100%"
                    dense
                    v-model="newWallet.confirmPassword"
                    filled
                    :label="$t('welcome.confirmPassword')"
                    :type="show2 ? 'text' : 'password'"
                    :rules="passwordRequired ? [
                      rules.required(),
                      newWallet.password === newWallet.confirmPassword || $t('welcome.passwordsMustMatch'),
                    ] : []"
                  >
                    <template v-slot:append>
                      <v-icon @click="show2 = !show2" tabindex="-1">
                        {{ show2 ? 'mdi-eye' : 'mdi-eye-off' }}
                      </v-icon>
                    </template>
                  </v-text-field>
                  </template>

                  <v-checkbox
                    style="width: 100%"
                    class="mt-0 text-left"
                    hide-details
                    v-model="newWallet.recoverPasswordChecked"
                    :label="isPrfMode ? $t('welcome.understandPrfRecovery') : $t('welcome.understandPasswordRecovery')"
                    :rules="[newWallet.recoverPasswordChecked]"
                  ></v-checkbox>
                  <v-checkbox
                    style="width: 100%"
                    class="mt-0 mb-2"
                    hide-details
                    v-model="newWallet.termsChecked"
                    :rules="[newWallet.termsChecked]"
                  >
                    <template v-slot:label>
                      <div>
                        I have read and agree to the
                        <a
                          @click.stop
                          href="https://www.gerowallet.io/_files/ugd/79567a_718ec62866234a2689831a9e5c632725.pdf?index=true"
                          target="_blank"
                          >Terms of Service</a
                        >.
                      </div>
                    </template>
                  </v-checkbox>
                </v-card-text>
                <v-card-actions class="px-0 align-self-end" style="width: 100%">
                  <v-spacer></v-spacer>
                  <v-btn text @click="step = 1" elevation="0" :disabled="creatingWalletLoader"> Back </v-btn>
                  <v-btn
                    color="primary"
                    @click="walletCreationStep2"
                    elevation="0"
                    :disabled="!valid2"
                    :loading="creatingWalletLoader"
                  >
                    Continue
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-form>
          </v-stepper-content>
        </v-stepper-items>
      </v-stepper>
    </v-card>

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
  </v-dialog>
</template>
<script setup lang="ts">
import { ref, computed, onUnmounted, onMounted, getCurrentInstance } from 'vue';
import * as bip39 from 'bip39';
import rules from '@/utils/rules';
import { Theme, NetworkScheme } from '@/models/types';
import MnemonicAutocomplete from '@/modules/welcome/components/MnemonicAutocomplete.vue';
import assets from '@/utils/assets';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import GeroStore from '@/stores/geroStore';
import { debugLog } from '@/utils/debug';

// Props
interface Props {
  dialog: boolean;
  network: NetworkScheme;
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
const form2 = ref(null);

// Reactive data
const step = ref<number>(1);
const show1 = ref<boolean>(false);
const show2 = ref<boolean>(false);
const prfSupported = ref<boolean>(false);
const webAuthnCredentialId = ref<string | null>(null);
const newWallet = ref({
  name: '',
  icon: '',
  password: '',
  confirmPassword: '',
  termsChecked: false,
  recoverPasswordChecked: false,
  recoverSeedChecked: false,
  encryptionMethod: 'password' as 'password' | 'prf',
  backupMnemonic: true, // Default: backup mnemonic (PRF mode only)
});
const valid2 = ref<boolean>(false);
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

const computedRecoverySeedPhrase = computed(() => {
  if (recoverySeedPhrase.value) {
    return recoverySeedPhrase.value.filter((item, index) => item && index < recoverySeedPhraseLength.value);
  }
  return undefined;
});

const recoverySeedPhraseLength = computed(() => {
  return Number(seedPhraseLength.value);
});

const dialogLocal = computed({
  get() {
    if (props.dialog) {
      document.addEventListener('keydown', onKeydown);
    } else {
      document.removeEventListener('keydown', onKeydown);
    }
    return props.dialog;
  },
  set(value: boolean) {
    emit('dialogChange', value);
  },
});

const valid = computed({
  get() {
    if (computedRecoverySeedPhrase.value) {
      return (
        computedRecoverySeedPhrase.value.length === Number(seedPhraseLength.value) &&
        bip39.validateMnemonic(computedRecoverySeedPhrase.value.join(' '))
      );
    }
    return false;
  },
  set(_value: boolean) {},
});

const isPrfMode = computed(() => {
  return prfSupported.value && newWallet.value.encryptionMethod === 'prf';
});

const passwordRequired = computed(() => {
  // Password only required for password mode (never for PRF mode - pure PRF only)
  return !isPrfMode.value;
});

// Lifecycle hooks
onMounted(async () => {
  try {
    const { isPrfSupported } = await import('@/shared/utils/webauthn-prf');
    prfSupported.value = await isPrfSupported();

    // Default to PRF if supported
    if (prfSupported.value) {
      newWallet.value.encryptionMethod = 'prf';
    }
  } catch (error) {
    console.error('Error checking PRF support:', error);
    prfSupported.value = false;
  }
});

// Methods
const onKeydown = (event: KeyboardEvent) => {
  if ((event.code === 'KeyV' && event.ctrlKey) || (event.code === 'KeyV' && event.metaKey)) {
    pasteFromClipboard();
  }
};

const focusNextCell = (el: HTMLElement) => {
  console.log('nextCell');
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
    const text = await navigator.clipboard.readText();
    recoverySeedPhrase.value = text.split(' ');
    if ([12, 15, 24].includes(recoverySeedPhrase.value.length)) {
      seedPhraseLength.value = recoverySeedPhrase.value.length.toString();
    }
  }
};

const walletCreationStep1 = () => {
  if (form.value?.validate()) {
    step.value = 2;
  }
};

const walletCreationStep2 = async () => {
  if (form2.value?.validate()) {
    creatingWalletLoader.value = true;
    try {
      // Check if wallet with same mnemonic already exists
      const { derivePublicKeyFromMnemonic, getWalletByPublicKey } = await import('@/db/gero-db');
      const publicKey = await derivePublicKeyFromMnemonic(seedToStr.value);
      const existingWallet = await getWalletByPublicKey(publicKey);

      if (existingWallet) {
        // Wallet already exists - show confirmation dialog
        debugLog(`🔐 Wallet with same mnemonic already exists (ID: ${existingWallet.id}, Name: "${existingWallet.name}"). Showing confirmation dialog.`);
        existingWalletInfo.value = existingWallet;
        showConfirmDialog.value = true;
        creatingWalletLoader.value = false;
        return;
      }

      // Wallet doesn't exist - create new one
      let wallet;

      if (isPrfMode.value) {
        // ========================================================================
        // PRF WALLET RESTORATION (PURE PRF MODE - NO PASSWORD)
        // ========================================================================
        console.log('🔐 PRF Mode Detected (Restore - Pure PRF):', {
          isPrfMode: isPrfMode.value,
          prfSupported: prfSupported.value,
          encryptionMethod: newWallet.value.encryptionMethod,
          backupMnemonic: newWallet.value.backupMnemonic
        });

        // Step 1: Register WebAuthn credential with PRF
        const { registerWebAuthnCredential } = await import('@/shared/utils/security');

        try {
          // Step 1: Register WebAuthn credential with PRF
          const { credentialId, prfEnabled } = await registerWebAuthnCredential(
            'temp-wallet-id', // Temporary ID, actual wallet ID will be allocated below
            newWallet.value.name
          );

          if (!prfEnabled) {
            throw new Error(vmProxy.$t('security.passKeyPrfNotSupported') as string);
          }

          webAuthnCredentialId.value = credentialId;

          // Step 2: Pre-allocate wallet ID (same logic as in gero-db.ts)
          const { getDb } = await import('@/db/gero-db');
          const db = await getDb();
          const maxWallet = await db['wallets'].orderBy('id').last();
          const newWalletId = (maxWallet?.id || 0) + 1;

          // Step 3: Evaluate PRF immediately after registration (while user just authenticated)
          const { evaluatePrfForWallet } = await import('@/shared/utils/webauthn-prf');
          const prfOutput = await evaluatePrfForWallet(credentialId, newWalletId.toString());

          try {
            // Step 4: Create wallet with PRF options + PRF output and provided mnemonic (Pure PRF mode - no password unlock)
            const prfOptions = {
              usePrf: true,
              credentialId,
              passwordUnlockEnabled: false, // Pure PRF mode - no password
              backupMnemonic: newWallet.value.backupMnemonic,
              prfOutput, // Pass PRF output to avoid second prompt
            };

            wallet = await GeroStore.createNewWallet(
              newWallet.value.name,
              newWallet.value.icon,
              Theme.GERO,
              seedToStr.value, // Use provided mnemonic for restoration
              newWallet.value.password || 'temp-password', // Temp password for PRF wallets without password
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
          // User cancelled or PRF not supported
          const errorMessage = error instanceof Error ? error.message : '';
          if (errorMessage.includes('cancelled') || errorMessage.includes('NotAllowedError')) {
            console.log('User cancelled WebAuthn registration');
            creatingWalletLoader.value = false;
            return; // Don't show error, user cancelled
          }
          throw error;
        }
      } else {
        // ========================================================================
        // PASSWORD WALLET RESTORATION (EXISTING)
        // ========================================================================

        wallet = await GeroStore.createNewWallet(
          newWallet.value.name,
          newWallet.value.icon,
          Theme.GERO,
          seedToStr.value, // Use provided mnemonic for restoration
          newWallet.value.password,
          props.network.blockchain,
          props.network.network
        );
      }

      await performLogin(wallet);
    } catch (error: unknown) {
      console.error('Error restoring wallet:', error);
      // Show user-friendly error message
      const errorMessage = error instanceof Error
        ? error.message
        : vmProxy.$t('errors.unknownError') as string;
      vmProxy['$snackbar']?.setError(errorMessage);
      creatingWalletLoader.value = false;
    }
  }
};

const performLogin = async (wallet) => {
  try {
    dialogLocal.value = false;
    showConfirmDialog.value = false;

    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });

    const hasError = response && typeof response === 'object' && 'error' in response;
    if (response && !hasError) {
      vmProxy.$nextTick(() => {
        router.push('/').catch(err => {
          // Suppress redirect errors (expected when already on target route)
          if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
            console.error('Navigation error:', err);
          }
        });
      });
    } else if (hasError) {
      const errorResponse = response as { error: unknown };
      console.warn('Login response error:', errorResponse.error);
      // Still navigate even if there's a connection error, as the wallet might have been created
      vmProxy.$nextTick(() => {
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

const resetDialog = () => {
  newWallet.value = {
    name: '',
    icon: '',
    password: '',
    confirmPassword: '',
    termsChecked: false,
    recoverPasswordChecked: false,
    recoverSeedChecked: false,
    backupMnemonic: false,
    encryptionMethod: undefined,
  };
  valid2.value = false;
  creatingWalletLoader.value = false;
  recoverySeedPhrase.value = emptySeedPhrase;
};

// Lifecycle
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  resetDialog();
});
</script>
<style scoped>
.v-dialog__content--active {
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
</style>
