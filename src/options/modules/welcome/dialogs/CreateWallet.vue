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
      <v-stepper v-model="step" flat class="transparent">
        <v-stepper-items>
          <!-- ============================================ -->
          <!-- SCREEN 1: Name + Security Method             -->
          <!-- ============================================ -->
          <v-stepper-content step="1">
            <v-card flat class="transparent d-flex justify-center">
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
                />

                <!-- Security Method (only when PRF is available) -->
                <template v-if="prfSupported">
                  <v-divider class="my-5" style="border-color: rgba(255, 255, 255, 0.12);" />

                  <!-- PassKey card -->
                  <SecurityMethodCard
                    :title="t('welcome.passKeyMethod')"
                    icon="mdi-shield-key"
                    :benefits="[
                      t('welcome.passKeyBenefit1'),
                      t('welcome.passKeyBenefit2'),
                      t('welcome.passKeyBenefitKeysSecure')
                    ]"
                    :learn-more-content="t('welcome.passKeyLearnMoreFull')"
                    :selected="selectedSecurityMethod === 'prf'"
                    :recommended="true"
                    @select="selectedSecurityMethod = 'prf'"
                  />

                  <!-- Password card (minimal) -->
                  <v-card
                    flat
                    :class="[
                      'method-card mt-3',
                      { 'method-card--selected': selectedSecurityMethod === 'password' }
                    ]"
                    style="background-color: #00000080;"
                    @click="selectedSecurityMethod = 'password'"
                  >
                    <v-list-item class="px-4 py-2" style="background: transparent;">
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
                      <v-icon v-if="selectedSecurityMethod === 'password'" color="primary" class="ml-2 align-self-center">mdi-check-circle</v-icon>
                    </v-list-item>
                  </v-card>
                </template>

                <!-- PRF not supported alert -->
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

          <!-- ============================================ -->
          <!-- SCREEN 2: Adaptive — PRF confirm / Password  -->
          <!-- ============================================ -->
          <v-stepper-content step="2" class="align-content-center">
            <v-card flat class="transparent d-flex justify-center">
              <div style="max-width: 540px; width: 100%;">

                <!-- ===== PRF PATH ===== -->
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

                <!-- ===== PASSWORD PATH ===== -->
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
      <!-- Screen 1: Continue -->
      <template v-if="step === 1">
        <v-spacer></v-spacer>
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

      <!-- Screen 2: Back + Create -->
      <template v-else>
        <v-btn text @click="handleBack">
          {{ $t('welcome.back') }}
        </v-btn>
        <v-btn
          color="primary"
          :class="isApex ? 'apexButton' : 'geroButton'"
          style="color: black!important;"
          :disabled="!canCreate"
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

// Step state (2 screens only)
const step = ref(1);
const selectedSecurityMethod = ref<'prf' | 'password'>('prf');

// Form refs and validation
const nameForm = ref(null);
const nameValid = ref(false);
const passwordForm = ref(null);
const passwordFormValid = ref(false);
const prfForm = ref(null);
const prfFormValid = ref(false);

// Password visibility
const show1 = ref(false);
const show2 = ref(false);

// Wallet state
const creatingWalletLoader = ref(false);
const prfSupported = ref(false);

const newWallet = reactive({
  name: '',
  icon: 'green',
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

// Check PRF support on mount
onMounted(async () => {
  try {
    const { isPrfSupported } = await import('@/shared/utils/webauthn-prf');
    prfSupported.value = await isPrfSupported();

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

const isApex = computed(() => {
  return props.network?.blockchain?.includes('Apex');
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

// Navigation (simplified — only 2 screens)
const handleContinue = () => {
  // Reset acknowledgments and validation before showing step 2
  acknowledgments.recoveryPhrase = false;
  acknowledgments.passwordRecovery = false;
  acknowledgments.termsAccepted = false;
  nextTick(() => {
    if (prfForm.value) prfForm.value.resetValidation();
    if (passwordForm.value) passwordForm.value.resetValidation();
    step.value = 2;
  });
};

const handleBack = () => {
  step.value = 1;
};

const openTerms = () => {
  window.open('https://gerowallet.io/legal/terms/', '_blank');
};

// ========================================================================
// WALLET CREATION LOGIC — PRESERVED FROM ORIGINAL
// ========================================================================
const walletCreationStep = async () => {
  creatingWalletLoader.value = true;
  try {
    let wallet;

    if (selectedSecurityMethod.value === 'prf') {
      // ========================================================================
      // PRF WALLET CREATION (PURE PRF MODE - NO PASSWORD)
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
            null,
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
          return;
        }
        throw error;
      }
    } else {
      // ========================================================================
      // PASSWORD WALLET CREATION
      // ========================================================================
      wallet = await GeroStore.createNewWallet(
        newWallet.name,
        newWallet.icon,
        Theme.GERO,
        null,
        newWallet.password,
        props.network.blockchain,
        props.network.network
      );
    }

    dialogLocal.value = false;

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
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Wallet creation failed:', msg);
    vmProxy['$snackbar']?.setError(vmProxy.$t('errors.unknownError') as string);
  } finally {
    creatingWalletLoader.value = false;
  }
};

const resetDialog = () => {
  Object.assign(newWallet, {
    name: '',
    icon: props.network?.blockchain?.includes('Apex') ? 'orange' : 'green',
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
  nextTick(() => {
    if (nameForm.value) {
      nameForm.value.resetValidation();
    }
    if (passwordForm.value) {
      passwordForm.value.resetValidation();
    }
    if (prfForm.value) {
      prfForm.value.resetValidation();
    }
  });
};
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
