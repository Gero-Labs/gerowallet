<template>
  <BaseDialog
    title="Google Wallet Set Up"
    :subtitle="props.network?.title"
    :is-open="props.isOpen"
    @close="$emit('close')"
    content-class="rounded-xxl dialogStyle"
    scrollable
    max-width="850"
    :min-height="0"
    :persistent="props.persistent"
  >
    <v-card-text class="pa-0">
      <v-container class="pa-1 pb-2" style="max-width: 534px;">
        <v-form ref="form" v-model="valid">
          <v-list-item class="pa-0" style="justify-self: center;">
            <v-list-item-avatar>
              <v-img :src="props.googleAccount['picture']" alt="Google Account Profile Picture" />
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
          <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Set up your wallet name</h2>
          <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">Choose a name to help you identify your wallet.</h3>
          <v-text-field
            filled
            dense
            color="primary"
            v-model="newWallet.name"
            :rules="[rules.required(), rules.minCharacters(3), rules.maxCharacters(40)]"
            label="Wallet Name"
            placeholder="e.g. My New Wallet"
            required
          ></v-text-field>
          <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Set up your spending password</h2>
          <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">You'll use this to log into your wallet and make transactions.</h3>
          <v-text-field
            filled
            dense
            color="primary"
            v-model="newWallet.password"
            :rules="[rules.required(), rules.spaceNotAllowed, rules.minCharacters(10), rules.oneOrMoreNumbers, rules.containCapital, rules.containLowerCase,rules.containSpecialCharacter]"
            :type="show1 ? 'text' : 'password'"
            label="Password"
            required
            :append-inner-icon="show1 ? 'mdi-eye' : 'mdi-eye-off'"
            @click:append="show1 = !show1"
          ></v-text-field>

          <v-text-field
            filled
            dense
            color="primary"
            v-model="newWallet.confirmPassword"
            :rules="[rules.required(), (newWallet.password === newWallet.confirmPassword) || 'Passwords must match']"
            :type="show2 ? 'text' : 'password'"
            label="Confirm Password"
            required
            :append-inner-icon="show2 ? 'mdi-eye' : 'mdi-eye-off'"
            @click:append="show2 = !show2"
          ></v-text-field>

          <v-checkbox
            class="mt-0"
            dense
            color="primary"
            v-model="newWallet.termsChecked"
            :rules="[rules.required()]"
            label="I understand that Gero cannot recover this password for me."
            required
            hide-details
          ></v-checkbox>

          <v-checkbox
            class="mt-0"
            dense
            color="primary"
            v-model="newWallet.recoverPasswordChecked"
            :rules="[rules.required()]"
            label="I have read and agree to the Terms of Service."
            required
            hide-details
          ></v-checkbox>
        </v-form>
      </v-container>
    </v-card-text>
    <v-card-actions class="justify-center">
      <v-btn
        style="color: black!important;"
        class="geroButton"
        variant="flat"
        :loading="creatingWalletLoader"
        :disabled="!valid || creatingWalletLoader"
        @click="walletCreation"
      >
        CREATE WALLET
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


interface NewWallet {
  name: string;
  icon: string;
  theme: string;
  password: string;
  confirmPassword: string;
  termsChecked: boolean;
  recoverPasswordChecked: boolean;
  chain: string;
  network: any;
}

interface Props {
  isOpen: boolean;
  persistent: boolean;
  googleAccount: { };
  tokens: {
    idToken: string,
    accessToken: string,
  };
  network: any;
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

let newWallet = reactive<NewWallet>({
  name: '',
  icon: '',
  theme: Theme.GERO,
  password: '',
  confirmPassword: '',
  termsChecked: false,
  recoverPasswordChecked: false,
  chain: props.network?.chain,
  network: props.network?.network
});

watch(() => props.isOpen, (newValue, _oldValue) => {
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
  try {
    const wallet = await GeroStore.createNewGoogleWallet(
      newWallet.name,
      newWallet.icon,
      newWallet.theme,
      newWallet.password,
      newWallet.chain,
      newWallet.network,
      props.tokens.idToken
    );
    emit('close');
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });
    
    if (response && !response.error) {
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
      nextTick(() => {
        resetDialog();
        router.push('/').catch(() => {});
      });
    }
  } catch (error) {
    console.error('Error creating wallet:', error);
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
    chain: props.network?.chain,
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
<style>
</style>
