<template>
  <BaseDialog
    :title="$t('welcome.googleWalletSetup')"
    :subtitle="props.network?.title"
    :is-open="props.isOpen"
    @close="$emit('close')"
    content-class="rounded-xxl dialogStyle"
    scrollable
    max-width="850"
    :min-height="0"
    :persistent="props.persistent"
  >
    <v-card-text class="pa-0" style="position: relative;">
      <v-container class="pa-1 pb-2" style="max-width: 534px;">
        <v-form ref="form" v-model="valid">
          <v-list-item class="pa-0" style="justify-self: center;">
            <v-list-item-avatar>
              <v-img :src="props.googleAccount['picture']" :alt="$t('wallet.googleAccountProfilePicture')" />
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>
                {{ props.googleAccount['name']}}
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ props.googleAccount['email']}}
              </v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-avatar>
              <v-icon size="x-large" color="primary">mdi-check-circle</v-icon>
            </v-list-item-avatar>
          </v-list-item>
          <v-divider class="mb-2"></v-divider>
          <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">{{ $t('welcome.setUpWalletName') }}</h2>
          <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">{{ $t('welcome.chooseNameToIdentify') }}</h3>
          <v-text-field
            filled
            dense
            color="primary"
            v-model="newWallet.name"
            :rules="[rules.required(), rules.minCharacters(3), rules.maxCharacters(40)]"
            :label="$t('welcome.walletName')"
            :placeholder="$t('welcome.walletNamePlaceholder')"
            required
            :disabled="activationInProgress"
          ></v-text-field>
          <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">{{ $t('welcome.setUpSpendingPassword') }}</h2>
          <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">{{ $t('welcome.youllUseThisToLogin') }}</h3>
          <v-text-field
            filled
            dense
            color="primary"
            v-model="newWallet.password"
            :rules="[rules.required(), rules.spaceNotAllowed, rules.minCharacters(10), rules.oneOrMoreNumbers, rules.containCapital, rules.containLowerCase,rules.containSpecialCharacter]"
            :type="show1 ? 'text' : 'password'"
            :label="$t('welcome.password')"
            required
            @click:append="show1 = !show1"
            :disabled="activationInProgress"
          >
            <template v-slot:append>
              <v-icon @click="show1 = !show1" tabindex="-1">
                {{show1 ? 'mdi-eye' : 'mdi-eye-off'}}
              </v-icon>
            </template>
          </v-text-field>

          <v-text-field
            filled
            dense
            color="primary"
            v-model="newWallet.confirmPassword"
            :rules="[rules.required(), (newWallet.password === newWallet.confirmPassword) || $t('welcome.passwordsMustMatch')]"
            :type="show2 ? 'text' : 'password'"
            :label="$t('welcome.confirmPassword')"
            required
            @click:append="show2 = !show2"
            :disabled="activationInProgress"
          >
            <template v-slot:append>
              <v-icon @click="show2 = !show2" tabindex="-1">
                {{show2 ? 'mdi-eye' : 'mdi-eye-off'}}
              </v-icon>
            </template>
          </v-text-field>

          <v-checkbox
            class="mt-0"
            dense
            color="primary"
            v-model="newWallet.termsChecked"
            :rules="[rules.required()]"
            :label="$t('welcome.understandPasswordRecovery')"
            required
            hide-details
            :disabled="activationInProgress"
          ></v-checkbox>

          <v-checkbox
            class="mt-0"
            dense
            color="primary"
            v-model="newWallet.recoverPasswordChecked"
            :rules="[rules.required()]"
            :label="`${$t('welcome.iHaveReadTerms')} ${$t('navigation.termsOfService')}.`"
            required
            hide-details
            :disabled="activationInProgress"
          ></v-checkbox>
        </v-form>
      </v-container>

      <!-- Activation Progress Overlay -->
      <div v-if="activationInProgress" class="activation-overlay">
        <v-card class="activation-card elevation-12">
          <v-card-text class="pa-6">
            <v-container>
              <v-row class="justify-center">
                <v-col cols="12" class="text-center">
                  <v-progress-circular
                    :size="70"
                    :width="7"
                    color="primary"
                    indeterminate
                  ></v-progress-circular>
                </v-col>
              </v-row>
              <v-row class="justify-center mt-4">
                <v-col cols="12" class="text-center">
                  <h2 class="white--text mb-2">{{ activationStatus }}</h2>
                  <p class="text--secondary" v-if="activationStep === 'proof'">
                    {{ $t('welcome.generatingProof') }}<br>{{ $t('welcome.proofMayTakeTime') }}
                    <br />
                    <small v-if="pollingAttempts > 0">{{ $tc('welcome.checkedTimes', pollingAttempts, { count: pollingAttempts }) }}</small>
                  </p>
                  <p class="text--secondary" v-if="activationStep === 'blockchain'">
                    {{ $t('welcome.submittingActivation') }}
                  </p>
                  <p class="text--secondary" v-if="activationStep === 'complete'">
                    {{ $t('welcome.walletReadyToUse') }}
                  </p>
                </v-col>
              </v-row>
              <v-row class="justify-center mt-2" v-if="activationError">
                <v-col cols="12" class="text-center">
                  <v-alert type="error" text>
                    {{ activationError }}
                  </v-alert>
                </v-col>
              </v-row>
            </v-container>
          </v-card-text>
        </v-card>
      </div>
    </v-card-text>
    <v-card-actions class="justify-center">
      <v-btn
        style="color: black!important;"
        class="geroButton"
        variant="flat"
        :loading="creatingWalletLoader"
        :disabled="!valid || creatingWalletLoader || activationInProgress"
        @click="walletCreation"
      >
        {{ $t('welcome.createWallet') }}
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, onMounted, watch, getCurrentInstance, reactive, nextTick } from 'vue';
import { Theme } from '@/models/types';
import rules from '@/utils/rules';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GeroStore from '@/stores/geroStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { NetworkInfo } from '@/utils/networks';

interface NewWallet {
  name: string;
  icon: string;
  theme: string;
  password: string;
  confirmPassword: string;
  termsChecked: boolean;
  recoverPasswordChecked: boolean;
  chain: string;
  network: string;
}

interface Props {
  isOpen: boolean;
  persistent: boolean;
  googleAccount: { };
  tokens: {
    idToken: string,
    accessToken: string,
  };
  network: NetworkInfo;
}

const props = defineProps<Props>();

const emit = defineEmits(['close']);

const vmProxy = getCurrentInstance()!.proxy as any
const router = vmProxy.$router;

const form = ref();
const show1 = ref(false);
const show2 = ref(false);
const valid = ref<boolean>(false);
const creatingWalletLoader = ref(false);
const persistent = ref(false);

// Activation state
const activationInProgress = ref(false);
const activationStep = ref<'proof' | 'blockchain' | 'complete'>('proof');
const activationStatus = ref('');
const activationError = ref('');
const pollingAttempts = ref(0);

let newWallet = reactive<NewWallet>({
  name: '',
  icon: '',
  theme: Theme.GERO,
  password: '',
  confirmPassword: '',
  termsChecked: false,
  recoverPasswordChecked: false,
  chain: props.network?.blockchain,
  network: props.network?.network
});

watch(() => props.isOpen, async (newValue, _oldValue) => {
  if (!newValue) {
    resetDialog();
  }
})

watch(() => props.googleAccount, (newValue, _oldValue) => {
  newWallet.name = newValue['email']?.split('@')[0];
  newWallet.icon = newValue['picture'];
})

onMounted(() => {
  if (props.googleAccount) {
    newWallet.name = props.googleAccount['email']?.split('@')[0];
    newWallet.icon = props.googleAccount['picture'];
  }
})

const walletCreation = async (): Promise<void> => {
  creatingWalletLoader.value = true;
  activationError.value = '';

  try {
    // Extract user email from Google account
    const userEmail = props.googleAccount['email'];
    console.log('🔍 Checking for existing wallet for:', userEmail);

    // Step 1: Check if wallet already exists (in case user clicked create button again)
    const { getGoogleWalletWithEmail } = await import('@/db/gero-db');
    const existingWallet = await getGoogleWalletWithEmail(userEmail);

    if (existingWallet) {
      console.log('✅ Wallet already exists, logging in...');
      // Wallet already exists - just login
      const response: any = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.LOGIN,
        data: { wallet: existingWallet },
      });

      if (response && !response.error) {
        emit('close');
        nextTick(() => {
          resetDialog();
          router.push('/').catch(err => {
            if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
              console.error('Navigation error:', err);
            }
          });
        });
      }
      return;
    }

    // Step 2: Wallet doesn't exist - create it (activation happens in background)
    console.log('🔐 Creating Google wallet...', newWallet);
    console.log('props', props)
    activationInProgress.value = true;
    activationStep.value = 'proof';
    activationStatus.value = 'Creating wallet...';

    const creationResponse: any = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.ACTIVATE_GOOGLE_WALLET,
      data: {
        walletData: {
          name: newWallet.name,
          icon: newWallet.icon,
          theme: newWallet.theme,
          password: newWallet.password,
          chain: props.network.blockchain,
          network: props.network.network,
          jwt: props.tokens.idToken,
        },
      },
    });

    if (!creationResponse || !creationResponse.data || !creationResponse.data.success) {
      throw new Error(creationResponse?.error || 'Wallet creation failed');
    }

    console.log('✅ Wallet created:', creationResponse.data);

    const walletId = creationResponse.data.walletId;
    const activating = creationResponse.data.activating;

    if (activating) {
      console.log('ℹ️ Wallet activation is happening in the background');
    }

    // Refresh wallets list from DB
    await GeroStore.refreshWallets();

    // Step 3: Login to the wallet immediately
    const walletToLogin = GeroStore.state.wallets[walletId];

    if (!walletToLogin) {
      throw new Error('Wallet not found after creation');
    }

    console.log('🔐 Logging into wallet...');
    const response: any = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet: walletToLogin },
    });

    if (response && !response.error) {
      console.log('✅ Login successful');
      emit('close');
      nextTick(() => {
        resetDialog();
        router.push('/').catch(err => {
          if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
            console.error('Navigation error:', err);
          }
        });
      });
    } else if (response?.error) {
      console.warn('Login response error:', response.error);
      emit('close');
      nextTick(() => {
        resetDialog();
        router.push('/').catch(() => {});
      });
    }
  } catch (error: any) {
    console.error('❌ Error creating wallet:', error);
    activationError.value = error.message || 'An error occurred during wallet creation';
    activationInProgress.value = false;
  } finally {
    creatingWalletLoader.value = false;
  }
};

const resetDialog = (): void => {
  newWallet = {
    name: '',
    icon: '',
    theme: Theme.GERO,
    password: '',
    confirmPassword: '',
    termsChecked: false,
    recoverPasswordChecked: false,
    chain: props.network?.blockchain,
    network: props.network?.network
  };
  valid.value = false;
  creatingWalletLoader.value = false;
  persistent.value = false;
  nextTick(() => {
    vmProxy.$refs.form.resetValidation();
  })
};
</script>
<style scoped>
.activation-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
  padding: 20px;
}

.activation-card {
  max-width: 500px;
  width: 100%;
  background-color: rgba(0, 0, 0, 0.8) !important;
  border-radius: 16px !important;
}
</style>
