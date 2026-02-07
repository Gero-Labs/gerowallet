<template>
  <BaseDialog
    :title="t('welcome.createNewWallet')"
    :subtitle="props.network.title"
    style="opacity: 0.9"
    content-class="rounded-xxl dialogStyle darken"
    :is-open="isOpen"
    @close="dialogLocal = false"
    scrollable
    :min-height="0"
    :img="assets.walletSvg"
    :persistent="false"
  >
    <v-card-text class="px-0 py-2">
      <v-stepper v-model="step" flat class="transparent" non-linear>
        <!-- Stepper Header -->
        <v-stepper-header style="box-shadow: none">
          <v-stepper-step :complete="step > 1" step="1">
            {{ $t('welcome.securityMethod') }}
          </v-stepper-step>
          <v-divider></v-divider>

          <v-stepper-step
            v-if="selectedSecurityMethod === 'prf'"
            :complete="step > 2"
            step="2"
          >
            {{ $t('welcome.education') }}
          </v-stepper-step>
          <v-divider v-if="selectedSecurityMethod === 'prf'"></v-divider>

          <v-stepper-step
            :complete="step > (selectedSecurityMethod === 'prf' ? 3 : 2)"
            :step="selectedSecurityMethod === 'prf' ? 3 : 2"
          >
            {{ $t('welcome.walletSetup') }}
          </v-stepper-step>
          <v-divider></v-divider>

          <v-stepper-step :step="selectedSecurityMethod === 'prf' ? 4 : 3">
            {{ $t('welcome.confirm') }}
          </v-stepper-step>
        </v-stepper-header>

        <!-- Stepper Content -->
        <v-stepper-items>
          <!-- Step 1: Security Method Selection -->
          <v-stepper-content step="1">
            <v-card flat class="transparent d-flex justify-center">
              <div style="max-width: 800px; width: 100%;">
                <!-- PRF Not Supported Alert -->
                <v-alert
                  v-if="!prfSupported"
                  color="warning"
                  icon="mdi-alert-outline"
                  dense
                  outlined
                  border="left"
                  class="mb-4"
                >
                  {{ $t('welcome.prfNotSupported') }}
                </v-alert>

                <!-- Security Method Selection -->
                <v-row no-gutters justify="center" align="start">
                  <!-- PassKey Card -->
                  <v-col cols="12" sm="6" class="pa-2">
                    <SecurityMethodCard
                      :title="t('welcome.passKeyMethod')"
                      :description="t('welcome.passKeyMethodDesc')"
                      icon="mdi-shield-key"
                      :benefits="[
                        t('welcome.passKeyBenefit1'),
                        t('welcome.passKeyBenefit2'),
                        t('welcome.passKeyBenefit3')
                      ]"
                      :learn-more-content="t('welcome.passKeyLearnMoreContent')"
                      :selected="selectedSecurityMethod === 'prf'"
                      :recommended="prfSupported"
                      :disabled="!prfSupported"
                      :disabled-reason="t('welcome.prfNotSupported')"
                      @select="selectedSecurityMethod = 'prf'"
                    />
                  </v-col>

                  <!-- Password Card -->
                  <v-col cols="12" sm="6" class="pa-2">
                    <SecurityMethodCard
                      :title="t('welcome.passwordMethod')"
                      :description="t('welcome.passwordMethodDesc')"
                      icon="mdi-key-variant"
                      :benefits="[
                        t('welcome.passwordBenefit1'),
                        t('welcome.passwordBenefit2'),
                        t('welcome.passwordBenefit3')
                      ]"
                      :learn-more-content="t('welcome.passwordLearnMoreContent')"
                      :selected="selectedSecurityMethod === 'password'"
                      @select="selectedSecurityMethod = 'password'"
                    />
                  </v-col>
                </v-row>
              </div>
            </v-card>
          </v-stepper-content>

          <!-- Step 2: PRF Education (PassKey Only) -->
          <v-stepper-content v-if="selectedSecurityMethod === 'prf'" step="2"  class="align-content-center">
            <v-card flat class="transparent d-flex justify-center">
              <PrfEducationContent />
            </v-card>
          </v-stepper-content>

          <!-- Step 3: Wallet Setup (Name + Icon + Password for password mode) -->
          <v-stepper-content :step="selectedSecurityMethod === 'prf' ? 3 : 2"  class="align-content-center">
            <v-card flat class="transparent d-flex justify-center">
              <v-form ref="setupForm" v-model="setupValid" style="max-width: 540px; width: 100%;">
                <div class="d-flex align-center pb-3">
                  <h2 class="text-left px-0 pt-0 pb-0 white--text mb-0">{{ $t('welcome.setUpWalletName') }}</h2>
                  <v-tooltip content-class="custom-tooltip" bottom>
                    <template v-slot:activator="{ on }">
                      <v-icon small class="ml-2 mt-1" v-on="on" color="grey lighten-1">mdi-information-outline</v-icon>
                    </template>
                    <span>{{ $t('welcome.chooseNameToIdentify') }}</span>
                  </v-tooltip>
                </div>

                <v-text-field
                  v-model="newWallet.name"
                  dense
                  filled
                  :label="$t('welcome.walletName')"
                  :placeholder="$t('welcome.walletNamePlaceholder')"
                  :rules="[rules.required(), rules.minCharacters(3), rules.maxCharacters(40)]"
                ></v-text-field>

                <h2 class="text-left px-0 pt-0 pb-1 white--text">{{ $t('welcome.walletIcon') }}</h2>
                <v-radio-group v-model="newWallet.icon" row mandatory class="mt-2 mb-2" style="justify-content: space-around;">
                  <v-radio value="green">
                    <template v-slot:label>
                      <v-avatar size="32"><v-img :src="assets.greenSvg" cover></v-img></v-avatar>
                    </template>
                  </v-radio>
                  <v-radio value="purple">
                    <template v-slot:label>
                      <v-avatar size="32"><v-img :src="assets.purpleSvg" cover></v-img></v-avatar>
                    </template>
                  </v-radio>
                  <v-radio value="pink">
                    <template v-slot:label>
                      <v-avatar size="32"><v-img :src="assets.pinkSvg" cover></v-img></v-avatar>
                    </template>
                  </v-radio>
                  <v-radio value="orange">
                    <template v-slot:label>
                      <v-avatar size="32"><v-img :src="assets.orangeSvg" cover></v-img></v-avatar>
                    </template>
                  </v-radio>
                  <v-radio value="blue">
                    <template v-slot:label>
                      <v-avatar size="32"><v-img :src="assets.blueSvg" cover></v-img></v-avatar>
                    </template>
                  </v-radio>
                  <v-radio value="grey">
                    <template v-slot:label>
                      <v-avatar size="32"><v-img :src="assets.greySvg" cover></v-img></v-avatar>
                    </template>
                  </v-radio>
                </v-radio-group>

                <!-- Password fields (Password mode only) -->
                <template v-if="selectedSecurityMethod === 'password'">
                  <div class="d-flex align-center pb-3">
                    <h2 class="text-left px-0 pt-0 pb-0 white--text mb-0">{{ $t('welcome.setUpSpendingPassword') }}</h2>
                    <v-tooltip content-class="custom-tooltip" bottom>
                      <template v-slot:activator="{ on }">
                        <v-icon small class="ml-2 mt-1" v-on="on" color="grey lighten-1">mdi-information-outline</v-icon>
                      </template>
                      <span>{{ $t('welcome.youllUseThisToLogin') }}</span>
                    </v-tooltip>
                  </div>

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
                </template>
              </v-form>
            </v-card>
          </v-stepper-content>

          <!-- Step 4: Enhanced Acknowledgments -->
          <v-stepper-content :step="selectedSecurityMethod === 'prf' ? 4 : 3" class="align-content-center">
            <v-card flat class="transparent d-flex justify-center">
              <div style="max-width: 540px; width: 100%;">
                <!-- Welcome Message -->
                <div class="text-center mb-3">
                  <v-icon color="primary" size="28" class="mb-1">mdi-check-circle-outline</v-icon>
                  <h3 class="white--text mb-1 text-h6">{{ $t('welcome.almostDone') }}</h3>
                  <p class="grey--text text--lighten-1 mb-0">{{ $t('welcome.reviewYourChoices') }}</p>
                </div>

                <!-- Wallet Summary Card -->
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
                          <v-icon :color="selectedSecurityMethod === 'prf' ? 'primary' : 'grey'" size="20" class="mr-2">
                            {{ selectedSecurityMethod === 'prf' ? 'mdi-shield-key' : 'mdi-key-variant' }}
                          </v-icon>
                          <div>
                            <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('welcome.securityMethod') }}</div>
                            <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">
                              {{ selectedSecurityMethod === 'prf' ? $t('welcome.passKeyMethod') : $t('welcome.passwordMethod') }}
                            </div>
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

                <EnhancedAcknowledgments
                  ref="acknowledgmentsRef"
                  :is-prf-mode="selectedSecurityMethod === 'prf'"
                  @update:valid="acknowledgeValid = $event"
                />
              </div>
            </v-card>
          </v-stepper-content>
        </v-stepper-items>
      </v-stepper>
    </v-card-text>

    <!-- Consolidated Action Buttons (outside stepper) -->
    <v-card-actions class="justify-space-between px-6 pb-4">
      <!-- Step 1: Only Continue button -->
      <template v-if="step === 1">
        <v-spacer></v-spacer>
        <v-btn
          color="primary"
          class="geroButton"
          style="color: black!important;"
          @click="handleContinue"
        >
          {{ $t('common.continue') }}
        </v-btn>
      </template>

      <!-- Step 2: Back + I Understand -->
      <template v-else-if="step === 2 && selectedSecurityMethod === 'prf'">
        <v-btn text @click="handleBack">
          {{ $t('welcome.back') }}
        </v-btn>
        <v-btn
          color="primary"
          class="geroButton"
          style="color: black!important;"
          @click="handleContinue"
        >
          {{ $t('welcome.iUnderstand') }}
        </v-btn>
      </template>

      <!-- Step 3 (or 2 for password): Back + Continue -->
      <template v-else-if="(step === 3 && selectedSecurityMethod === 'prf') || (step === 2 && selectedSecurityMethod === 'password')">
        <v-btn text @click="handleBack">
          {{ $t('welcome.back') }}
        </v-btn>
        <v-btn
          color="primary"
          class="geroButton"
          style="color: black!important;"
          :disabled="!setupValid"
          @click="handleContinue"
        >
          {{ $t('common.continue') }}
        </v-btn>
      </template>

      <!-- Step 4 (or 3 for password): Back + Create -->
      <template v-else-if="(step === 4 && selectedSecurityMethod === 'prf') || (step === 3 && selectedSecurityMethod === 'password')">
        <v-btn text @click="handleBack">
          {{ $t('welcome.back') }}
        </v-btn>
        <v-btn
          color="primary"
          class="geroButton"
          style="color: black!important;"
          :disabled="!acknowledgeValid"
          :loading="creatingWalletLoader"
          @click="walletCreationStep"
        >
          {{ $t('common.create') }}
        </v-btn>
      </template>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, reactive, nextTick, getCurrentInstance, onMounted, watch } from 'vue';
import rules from "@/utils/rules";
import { Theme } from "@/models/types";
import assets from '@/utils/assets';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import SecurityMethodCard from '@/shared/components/SecurityMethodCard.vue';
import PrfEducationContent from '@/shared/components/PrfEducationContent.vue';
import EnhancedAcknowledgments from '@/shared/components/EnhancedAcknowledgments.vue';
import GeroStore from '@/stores/geroStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { useTranslation } from '@/shared/composables/useTranslation';
import { NetworkInfo } from '@/utils/networks';

const { t } = useTranslation();

interface Props {
  isOpen: boolean;
  network: NetworkInfo;
}

const props = withDefaults(defineProps<Props>(), {
  isOpen: false,
});

const emit = defineEmits(['close']);

const vmProxy = getCurrentInstance()!.proxy
const router = vmProxy?.$router;

// Stepper state
const step = ref(1);
const selectedSecurityMethod = ref<'prf' | 'password'>('prf');

// Form refs and validation
const setupForm = ref(null);
const acknowledgmentsRef = ref(null);
const setupValid = ref(false);
const acknowledgeValid = ref(false);

// Password visibility
const show1 = ref(false);
const show2 = ref(false);

// Wallet state
const creatingWalletLoader = ref(false);
const prfSupported = ref(false);
const webAuthnCredentialId = ref<string | null>(null);

const newWallet = reactive({
  name: '',
  icon: 'green',
  password: '',
  confirmPassword: '',
  termsChecked: false,
  recoverPasswordChecked: false,
  encryptionMethod: 'password' as 'password' | 'prf',
  backupMnemonic: true,
});

// Check PRF support on mount
onMounted(async () => {
  try {
    const { isPrfSupported } = await import('@/shared/utils/webauthn-prf');
    prfSupported.value = await isPrfSupported();

    // Default to PRF if supported
    if (prfSupported.value) {
      selectedSecurityMethod.value = 'prf';
      newWallet.encryptionMethod = 'prf';
      newWallet.backupMnemonic = true;
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

// Watch security method selection
watch(selectedSecurityMethod, (newMethod) => {
  newWallet.encryptionMethod = newMethod;
  if (newMethod === 'prf') {
    newWallet.backupMnemonic = true;
  }
});

const isPrfMode = computed(() => {
  return prfSupported.value && newWallet.encryptionMethod === 'prf';
});

const dialogLocal = computed({
  get() {
    return props.isOpen;
  },
  set(value: boolean) {
    if (!value) {
      emit('close');
      resetDialog();
    }
  },
});

// Step navigation
const handleBack = () => {
  if (step.value > 1) {
    // Skip PRF education step when going back in password mode
    if (selectedSecurityMethod.value === 'password' && step.value === 2) {
      step.value = 1;
    } else if (selectedSecurityMethod.value === 'prf' && step.value === 3) {
      step.value = 2;
    } else {
      step.value--;
    }
  }
};

const handleContinue = () => {
  // Skip PRF education step for password mode
  if (step.value === 1 && selectedSecurityMethod.value === 'password') {
    step.value = 2;
  } else if (step.value === 1 && selectedSecurityMethod.value === 'prf') {
    step.value = 2;
  } else {
    step.value++;
  }
};

// ========================================================================
// WALLET CREATION LOGIC - PRESERVED FROM ORIGINAL
// ========================================================================
const walletCreationStep = async () => {
  creatingWalletLoader.value = true;
  try {
    let wallet;

    if (isPrfMode.value) {
      // ========================================================================
      // PRF WALLET CREATION (PURE PRF MODE - NO PASSWORD)
      // ========================================================================

      // Step 1: Register WebAuthn credential with PRF
      const { registerWebAuthnCredential } = await import('@/shared/utils/security');

      try {
        // Step 1: Register WebAuthn credential with PRF
        const { credentialId, prfEnabled } = await registerWebAuthnCredential(
          'temp-wallet-id', // Temporary ID, actual wallet ID will be allocated below
          newWallet.name
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
          // Step 4: Create wallet with PRF options + PRF output (Pure PRF mode - no password unlock)
          const prfOptions = {
            usePrf: true,
            credentialId,
            passwordUnlockEnabled: false, // Pure PRF mode - no password
            backupMnemonic: true, // Always backup mnemonic for PRF wallets
            prfOutput, // Pass PRF output to avoid second prompt
          };

          wallet = await GeroStore.createNewWallet(
            newWallet.name,
            newWallet.icon,
            Theme.GERO,
            null, // No mnemonic (generate new)
            newWallet.password || 'temp-password', // Temp password for PRF wallets without password
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
        if (error['message']?.includes('cancelled') || error['message']?.includes('NotAllowedError')) {
          console.log('User cancelled WebAuthn registration');
          return; // Don't show error, user cancelled
        }
        throw error;
      }
    } else {
      // ========================================================================
      // PASSWORD WALLET CREATION (EXISTING)
      // ========================================================================

      wallet = await GeroStore.createNewWallet(
        newWallet.name,
        newWallet.icon,
        Theme.GERO,
        null, // No mnemonic (generate new)
        newWallet.password,
        props.network.blockchain,
        props.network.network
      );
    }

    console.log('walletCreationStep', wallet);
    dialogLocal.value = false;

    // Login to the newly created wallet
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
            console.error('Navigation error:', err);
          }
        });
      });
    } else if (hasError) {
      const errorResponse = response as { error: unknown };
      console.warn('Login response error:', errorResponse.error);
      vmProxy.$nextTick(() => {
        resetDialog();
        router.push('/').catch(() => {});
      });
    }
  } catch (error: unknown) {
    console.error('Error creating wallet:', error);
    const errorMessage = error instanceof Error
      ? error.message
      : vmProxy.$t('errors.unknownError') as string;
    vmProxy['$snackbar']?.setError(errorMessage);
  } finally {
    creatingWalletLoader.value = false;
  }
};

const resetDialog = () => {
  Object.assign(newWallet, {
    name: '',
    icon: 'green',
    password: '',
    confirmPassword: '',
    termsChecked: false,
    recoverPasswordChecked: false,
  });
  step.value = 1;
  setupValid.value = false;
  acknowledgeValid.value = false;
  creatingWalletLoader.value = false;
  console.log('resetDialog');
  nextTick(() => {
    if (setupForm.value) {
      setupForm.value.resetValidation();
    }
  });
};
</script>

<style scoped lang="scss">
.v-dialog__content--active {
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

// Stepper customization
::v-deep .v-stepper {
  box-shadow: none !important;
}

::v-deep .v-stepper__header {
  box-shadow: none !important;
}

::v-deep .v-stepper__content {
  min-height: 420px;
  transition: min-height 0.3s ease;
  padding: 0 16px;
}

::v-deep .v-stepper__wrapper {
  transition: height 0.3s ease;
}

// Action buttons at dialog level
::v-deep .v-card__actions {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  min-height: 68px;
}

@media (max-width: 600px) {
  ::v-deep .v-stepper__header {
    flex-direction: column;
  }

  ::v-deep .v-stepper__content {
    min-height: auto;
  }
}
</style>
