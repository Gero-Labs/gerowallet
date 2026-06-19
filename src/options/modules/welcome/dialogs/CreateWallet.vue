<template>
  <BaseDialog
    :title="t('welcome.createNewWallet')"
    :subtitle="localNetwork ? localNetwork.title : ''"
    style="opacity: 0.9"
    content-class="rounded-xxl dialogStyle darken"
    :is-open="isOpen"
    @close="dialogLocal = false"
    scrollable
    :min-height="0"
    :width="600"
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
              <v-form ref="nameForm" v-model="nameValid" style="width: 100%;">

                <!-- Network — Mainnets -->
                <div class="step-section-label mb-2">{{ $t('common.selectNetwork') }}</div>
                <div class="network-grid mb-3">
                  <div
                    v-for="net in mainnetNetworks"
                    :key="net.blockchain + net.network"
                    class="network-tile"
                    :class="{ 'network-tile--active': isNetworkSelected(net) }"
                    @click="selectNetwork(net)"
                  >
                    <v-avatar size="22" class="network-tile__icon">
                      <v-img :src="net.icon" contain></v-img>
                    </v-avatar>
                    <span class="network-tile__label">{{ net.title }}</span>
                  </div>
                </div>

                <!-- Testnets — collapsed by default -->
                <div class="testnet-toggle mb-4" @click="showTestnets = !showTestnets">
                  <v-icon size="12" class="mr-1" style="color: inherit;">{{ showTestnets ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
                  <span>{{ $t('welcome.developerNetworks') }}</span>
                </div>
                <div v-if="showTestnets" class="network-grid mb-4">
                  <div
                    v-for="net in testnetNetworks"
                    :key="net.blockchain + net.network"
                    class="network-tile network-tile--testnet"
                    :class="{ 'network-tile--active': isNetworkSelected(net) }"
                    @click="selectNetwork(net)"
                  >
                    <v-avatar size="16" class="network-tile__icon">
                      <v-img :src="net.icon" contain></v-img>
                    </v-avatar>
                    <span class="network-tile__label">{{ net.title }}</span>
                  </div>
                </div>

                <!-- Security Method — side-by-side compact tiles -->
                <template v-if="prfSupported">
                  <v-divider class="my-4" style="border-color: rgba(255, 255, 255, 0.08);" />
                  <div class="step-section-label mb-2">{{ $t('welcome.securityMethod') }}</div>
                  <div class="security-row">

                    <!-- PassKey tile -->
                    <div
                      class="security-tile"
                      :class="{ 'security-tile--active': selectedSecurityMethod === 'prf' }"
                      @click="selectedSecurityMethod = 'prf'"
                    >
                      <div class="security-tile__head">
                        <v-icon size="15" color="primary">mdi-shield-key</v-icon>
                        <span class="security-tile__name">{{ $t('welcome.passKeyMethod') }}</span>
                        <v-tooltip bottom max-width="260" content-class="custom-tooltip">
                          <template v-slot:activator="{ on }">
                            <v-icon x-small class="ml-auto" color="grey lighten-1" v-on="on" @click.stop>mdi-information-outline</v-icon>
                          </template>
                          <span class="text-body-2">{{ $t('welcome.passKeyLearnMoreFull') }}</span>
                        </v-tooltip>
                      </div>
                      <div class="d-flex align-center mt-1">
                        <v-chip color="primary" x-small class="mr-1">{{ $t('welcome.recommended') }}</v-chip>
                      </div>
                      <span class="security-tile__sub mt-1">{{ $t('welcome.passKeyBenefit2') }}</span>
                    </div>

                    <!-- Password tile -->
                    <div
                      class="security-tile"
                      :class="{ 'security-tile--active': selectedSecurityMethod === 'password' }"
                      @click="selectedSecurityMethod = 'password'"
                    >
                      <div class="security-tile__head">
                        <v-icon size="15" color="grey lighten-1">mdi-key-variant</v-icon>
                        <span class="security-tile__name">{{ $t('welcome.passwordMethod') }}</span>
                      </div>
                      <span class="security-tile__sub mt-2">{{ $t('welcome.passwordMethodDesc') }}</span>
                    </div>

                  </div>
                </template>

                <!-- PRF not supported — compact inline notice -->
                <div v-else class="prf-notice mt-3">
                  <v-icon x-small color="warning" class="mr-1 flex-shrink-0">mdi-alert-outline</v-icon>
                  <span>{{ $t('welcome.prfNotSupported') }}</span>
                </div>

              </v-form>
            </v-card>
          </v-stepper-content>

          <!-- ============================================ -->
          <!-- SCREEN 2: Adaptive — PRF confirm / Password  -->
          <!-- ============================================ -->
          <v-stepper-content step="2">
            <v-card flat class="transparent d-flex justify-center">
              <div style="width: 100%;">

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
                              <v-img :src="localNetwork ? localNetwork.icon : ''" contain></v-img>
                            </v-avatar>
                            <div>
                              <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('common.network') }}</div>
                              <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ localNetwork ? localNetwork.title : '' }}</div>
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
                          <a class="terms-link" @click.stop="openTerms">{{ $t('navigation.termsOfService') }}</a>.
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
                          <a class="terms-link" @click.stop="openTerms">{{ $t('navigation.termsOfService') }}</a>.
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
import GeroStore from '@/stores/geroStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { useTranslation } from '@/shared/composables/useTranslation';
import networks, { NetworkInfo } from '@/utils/networks';
import { generateWalletName } from '@/shared/utils/walletNameGenerator';
import { updateVuetifyTheme } from '@/plugins/vuetify';

const { t } = useTranslation();

interface Props {
  isOpen: boolean;
  network?: NetworkInfo;
}

const props = withDefaults(defineProps<Props>(), {
  isOpen: false,
});

const emit = defineEmits(['close']);

const vmProxy = getCurrentInstance()!.proxy
const router = vmProxy?.$router;

// Network selection
const allNetworks = networks.networks;
const localNetwork = ref<NetworkInfo>(props.network || networks.networks[0]);

const mainnetNetworks = computed(() => allNetworks.filter(n => n.network === 'Mainnet'));
const testnetNetworks = computed(() => allNetworks.filter(n => n.network !== 'Mainnet'));
const showTestnets = ref(props.network?.network !== 'Mainnet' && props.network != null);

const isNetworkSelected = (net: NetworkInfo) =>
  localNetwork.value?.blockchain === net.blockchain && localNetwork.value?.network === net.network;

const selectNetwork = (net: NetworkInfo) => {
  localNetwork.value = net;
  onNetworkChange(net);
};

const onNetworkChange = (net: NetworkInfo) => {
  newWallet.icon = networks.resolveIconColor(net.blockchain, net.network);
  updateVuetifyTheme(net.blockchain, true);
};

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
  name: generateWalletName(),
  icon: networks.resolveIconColor(props.network?.blockchain || networks.networks[0].blockchain, props.network?.network || networks.networks[0].network),
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
            localNetwork.value.blockchain,
            localNetwork.value.network,
            undefined,  // addressType - use default based on chain
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
        localNetwork.value.blockchain,
        localNetwork.value.network,
        undefined  // addressType - use default based on chain
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
    name: generateWalletName(),
    icon: networks.resolveIconColor(localNetwork.value?.blockchain || '', localNetwork.value?.network || ''),
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
  height: 350px;
  overflow-y: auto;
  padding: 0 16px;
}

::v-deep .v-stepper__wrapper {
  height: 350px !important;
  overflow-y: auto;
}

// Action buttons
::v-deep .v-card__actions {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  min-height: 68px;
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
    height: auto;
    min-height: 350px;
  }
  ::v-deep .v-stepper__wrapper {
    height: auto !important;
  }
}

// ─── Section labels ───────────────────────────────────────────────────────────
.step-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: white
}

// ─── Testnet toggle ───────────────────────────────────────────────────────────
.testnet-toggle {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: white;
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease;

  &:hover {
    color: rgba(255, 255, 255, 0.5);
  }
}

// ─── Network grid ─────────────────────────────────────────────────────────────
.network-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.network-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px 8px 8px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
  min-height: 62px;
  gap: 5px;
  user-select: none;

  &:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
  }

  &--active {
    border-color: rgba(45, 240, 247, 0.55);
    background: rgba(45, 240, 247, 0.06);
    box-shadow: 0 0 14px rgba(45, 240, 247, 0.07);
  }

  // Testnet variant
  &--testnet {
    min-height: 46px;
    padding: 7px 8px 6px;
  }

  &__label {
    font-size: 10.5px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    text-align: center;
    line-height: 1.3;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &--active &__label {
    color: rgba(255, 255, 255, 0.9);
  }
}

// ─── Security method row ──────────────────────────────────────────────────────
.security-row {
  display: flex;
  gap: 8px;
}

.security-tile {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;

  &:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
  }

  &--active {
    border-color: rgba(45, 240, 247, 0.55);
    background: rgba(45, 240, 247, 0.06);
    box-shadow: 0 0 14px rgba(45, 240, 247, 0.07);
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  &__name {
    font-size: 11.5px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.75);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__sub {
    display: block;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.3);
    line-height: 1.35;
  }

  &--active &__name {
    color: rgba(255, 255, 255, 0.95);
  }

  &--active &__sub {
    color: rgba(255, 255, 255, 0.5);
  }
}

// ─── PRF notice (compact inline) ──────────────────────────────────────────────
.prf-notice {
  display: flex;
  align-items: flex-start;
  font-size: 11px;
  color: rgba(255, 196, 0, 0.65);
  line-height: 1.4;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 196, 0, 0.18);
  background: rgba(255, 196, 0, 0.04);
}
</style>
