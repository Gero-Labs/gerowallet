<template>
  <BaseDialog
    :title="t('welcome.createNewWallet')"
    :subtitle="props.network.title"
    style="opacity: 0.9"
    content-class="rounded-xxl dialogStyle darken"
    :is-open="isOpen"
    @close="dialogLocal = false"
    scrollable
    max-width="850"
    :min-height="0"
    :img="assets.walletSvg"
    :persistent="false"
  >
    <v-card-text class="px-0 py-2" style="justify-items: center;">
      <v-form ref="form" v-model="valid">
        <v-card flat class="transparent d-flex row fill-height no-gutters" style="max-width: 540px;">
          <v-card-text class="pa-0 d-flex row no-gutters">
            <!-- PRF Mode Indicator (if PRF supported - Pure PRF mode only) -->
            <template v-if="prfSupported">
              <v-alert color="primary" icon="mdi-shield-key" prominent dense outlined border="left" class="mb-4" style="width: 100%;">
                <div class="d-flex align-center">
                  <div class="font-weight-bold flex-grow-1">{{ $t('welcome.prfEncryption') }}</div>
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
                <div class="text-caption">{{ $t('welcome.prfEncryptionDesc') }}</div>
              </v-alert>
            </template>

            <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">{{ $t('welcome.setUpWalletName') }}</h2>
            <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">{{ $t('welcome.chooseNameToIdentify') }}</h3>
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
            <v-radio-group v-model="newWallet.icon" style="width: 100%; display: grid;" row mandatory class="no-gutters justify-space-around mt-2 mb-2">
              <v-radio value="green">
                <template v-slot:label>
                  <v-avatar size="32"  >
                    <v-img :src="assets.greenSvg" cover></v-img>
                  </v-avatar>
                </template>
              </v-radio>
              <v-radio value="purple">
                <template v-slot:label>
                  <v-avatar size="32" >
                    <v-img :src="assets.purpleSvg" cover></v-img>
                  </v-avatar>
                </template>
              </v-radio>
              <v-radio value="pink">
                <template v-slot:label>
                  <v-avatar size="32" >
                    <v-img :src="assets.pinkSvg" cover></v-img>
                  </v-avatar>
                </template>
              </v-radio>
              <v-radio value="orange">
                <template v-slot:label>
                  <v-avatar size="32" >
                    <v-img :src="assets.orangeSvg" cover></v-img>
                  </v-avatar>
                </template>
              </v-radio>
              <v-radio value="blue">
                <template v-slot:label>
                  <v-avatar size="32" >
                    <v-img :src="assets.blueSvg" cover></v-img>
                  </v-avatar>
                </template>
              </v-radio>
              <v-radio value="grey">
                <template v-slot:label>
                  <v-avatar size="32" >
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
                :label="$t('welcome.spendingPassword')"
                :type="show1 ? 'text' : 'password'"
                :rules="passwordRequired ? [rules.required(), rules.spaceNotAllowed, rules.minCharacters(10), rules.oneOrMoreNumbers, rules.containCapital, rules.containLowerCase,rules.containSpecialCharacter] : []"
              >
                <template v-slot:append>
                  <v-icon @click="show1 = !show1" tabindex="-1">
                    {{show1 ? 'mdi-eye' : 'mdi-eye-off'}}
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
                :rules="passwordRequired ? [rules.required(), (newWallet.password === newWallet.confirmPassword) || $t('welcome.passwordsMustMatch')] : []"
              >
                <template v-slot:append>
                  <v-icon @click="show2 = !show2" tabindex="-1">
                    {{show2 ? 'mdi-eye' : 'mdi-eye-off'}}
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
              :rules="[(newWallet.recoverPasswordChecked)]"
            ></v-checkbox>
            <v-checkbox
              style="width: 100%"
              class="mt-0 mb-2"
              hide-details
              v-model="newWallet.termsChecked"
              :rules="[(newWallet.termsChecked)]"
            >
              <template v-slot:label>
                <div>
                  {{ $t('welcome.iHaveReadTerms') }}
                  <a @click.stop href="https://www.gerowallet.io/_files/ugd/79567a_718ec62866234a2689831a9e5c632725.pdf?index=true" target="_blank">{{ $t('welcome.termsOfService') }}</a>.
                </div>
              </template>
            </v-checkbox>
          </v-card-text>
        </v-card>
      </v-form>
    </v-card-text>
    <v-card-actions class="pa-0 align-self-center" style="width: 100%; justify-content: center;">
      <v-btn
        style="color: black!important;"
        class="geroButton"
        color="primary"
        @click="walletCreationStep"
        elevation="0"
        :disabled="isDisabled"
        :loading="creatingWalletLoader"
      >
        {{ $t('common.create') }}
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>
<script setup lang="ts">
import { computed, ref, reactive, nextTick, getCurrentInstance, onMounted } from 'vue';
import rules from "@/utils/rules";
import { Theme } from "@/models/types";
import assets from '@/utils/assets';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GeroStore from '@/stores/geroStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

interface Props {
  isOpen: boolean;
  network: any;
}

const props = withDefaults(defineProps<Props>(), {
  isOpen: false,
});

const emit = defineEmits(['close']);

const vmProxy = getCurrentInstance()!.proxy as any
const router = vmProxy?.$router;

const form = ref<any>(null);
const show1 = ref(false);
const show2 = ref(false);
const valid = ref(false);
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
  backupMnemonic: true, // Default: backup mnemonic (PRF mode only)
});

// Check PRF support on mount
onMounted(async () => {
  try {
    const { isPrfSupported } = await import('@/shared/utils/webauthn-prf');
    prfSupported.value = await isPrfSupported();

    // Default to PRF if supported
    if (prfSupported.value) {
      newWallet.encryptionMethod = 'prf';
      newWallet.backupMnemonic = true; // Always backup mnemonic for PRF wallets
    }
  } catch (error) {
    console.error('Error checking PRF support:', error);
    prfSupported.value = false;
  }
});

const isPrfMode = computed(() => {
  return prfSupported.value && newWallet.encryptionMethod === 'prf';
});

const passwordRequired = computed(() => {
  // Password only required for password mode (never for PRF mode - pure PRF only)
  return !isPrfMode.value;
});

const isDisabled = computed(() => {
  return !valid.value || creatingWalletLoader.value;
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

const walletCreationStep = async () => {
  creatingWalletLoader.value = true;
  try {
    let wallet;

    if (isPrfMode.value) {
      // ========================================================================
      // PRF WALLET CREATION (PURE PRF MODE - NO PASSWORD)
      // ========================================================================
      console.log('🔐 PRF Mode Detected (Pure PRF):', {
        isPrfMode: isPrfMode.value,
        prfSupported: prfSupported.value,
        encryptionMethod: newWallet.encryptionMethod,
        backupMnemonic: newWallet.backupMnemonic
      });

      // Step 1: Register WebAuthn credential with PRF
      const { registerWebAuthnCredential } = await import('@/shared/utils/security');

      try {
        // Step 1: Register WebAuthn credential with PRF
        const { credentialId, prfEnabled } = await registerWebAuthnCredential(
          'temp-wallet-id', // Temporary ID, actual wallet ID will be allocated below
          newWallet.name
        );

        console.log('🔑 WebAuthn Registration Result:', {
          credentialId,
          prfEnabled
        });

        if (!prfEnabled) {
          throw new Error(vmProxy.$t('security.passKeyPrfNotSupported'));
        }

        webAuthnCredentialId.value = credentialId;

        // Step 2: Pre-allocate wallet ID (same logic as in gero-db.ts)
        const { getDb, getLatestWalletByOrder } = await import('@/db/gero-db');
        const db = await getDb();
        const maxWallet = await db['wallets'].orderBy('id').last();
        const newWalletId = (maxWallet?.id || 0) + 1;

        console.log('🆔 Pre-allocated wallet ID:', newWalletId);

        // Step 3: Evaluate PRF immediately after registration (while user just authenticated)
        const { evaluatePrfForWallet } = await import('@/shared/utils/webauthn-prf');
        const prfOutput = await evaluatePrfForWallet(credentialId, newWalletId.toString());

        console.log('✅ PRF evaluated successfully (avoids second prompt in gero-db)');

        // Step 4: Create wallet with PRF options + PRF output (Pure PRF mode - no password unlock)
        const prfOptions = {
          usePrf: true,
          credentialId,
          passwordUnlockEnabled: false, // Pure PRF mode - no password
          backupMnemonic: true, // Always backup mnemonic for PRF wallets
          prfOutput, // Pass PRF output to avoid second prompt
        };

        console.log('📦 Calling GeroStore.createNewWallet with PRF options (including prfOutput)');

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

        console.log('✅ Wallet created:', wallet);
      } catch (error: any) {
        // User cancelled or PRF not supported
        if (error.message?.includes('cancelled') || error.message?.includes('NotAllowedError')) {
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
    const response: any = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });

    if (response && !response.error) {
      vmProxy.$nextTick(() => {
        resetDialog();
        router.push('/').catch(err => {
          if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
            console.error('Navigation error:', err);
          }
        });
      });
    } else if (response?.error) {
      console.warn('Login response error:', response.error);
      vmProxy.$nextTick(() => {
        resetDialog();
        router.push('/').catch(() => {});
      });
    }
  } catch (error: any) {
    console.error('Error creating wallet:', error);
    // Show user-friendly error message
    vmProxy.$snackbar?.setError(error.message || vmProxy.$t('errors.unknownError'));
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
  valid.value = false;
  creatingWalletLoader.value = false;
  console.log('resetDialog');
  nextTick(() => {
    if (form.value) {
      form.value.resetValidation();
    }
  });
};
</script>
<style scoped>
.v-dialog__content--active {
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
</style>
