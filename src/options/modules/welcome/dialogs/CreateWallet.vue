<template>
  <BaseDialog
    :title="$t('welcome.createNewWallet')"
    :subtitle="props.network.title"
    style="opacity: 0.9"
    content-class="rounded-xxl dialogStyle darken"
    :is-open="isOpen"
    @close="dialogLocal = false"
    scrollable
    max-width="850"
    :min-height="0"
  >
    <v-card-text class="px-0 py-2" style="justify-items: center;">
      <v-form ref="form" v-model="valid">
        <v-card flat class="transparent d-flex row fill-height no-gutters" style="max-width: 540px;">
          <v-card-text class="pa-0 d-flex row no-gutters">
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
            <v-radio-group v-model="newWallet.icon" style="width: 100%; display: grid;" row mandatory class="no-gutters justify-space-around mt-2 mb-2" hide-details>
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
            <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">{{ $t('welcome.setUpSpendingPassword') }}</h2>
            <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">{{ $t('welcome.youllUseThisToLogin') }}</h3>
            <v-text-field
              style="width: 100%"
              block
              dense
              v-model="newWallet.password"
              filled
              :label="$t('welcome.spendingPassword')"
              :type="show1 ? 'text' : 'password'"
              :rules="[rules.required(), rules.spaceNotAllowed, rules.minCharacters(10), rules.oneOrMoreNumbers, rules.containCapital, rules.containLowerCase,rules.containSpecialCharacter]"
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
              :rules="[rules.required(), (newWallet.password === newWallet.confirmPassword) || $t('welcome.passwordsMustMatch')]"
            >
              <template v-slot:append>
                <v-icon @click="show2 = !show2" tabindex="-1">
                  {{show2 ? 'mdi-eye' : 'mdi-eye-off'}}
                </v-icon>
              </template>
            </v-text-field>
            <v-checkbox
              style="width: 100%"
              class="mt-0 text-left"
              hide-details
              v-model="newWallet.recoverPasswordChecked"
              :label="$t('welcome.understandPasswordRecovery')"
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
        {{ $t('welcome.createWallet') }}
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>
<script setup lang="ts">
import { computed, ref, reactive, nextTick, getCurrentInstance } from 'vue';
import rules from "@/utils/rules";
import { Theme } from "@/models/types";
import assets from '@/utils/assets';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GeroStore from '@/stores/geroStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

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

const newWallet = reactive({
  name: '',
  icon: 'green',
  password: '',
  confirmPassword: '',
  termsChecked: false,
  recoverPasswordChecked: false,
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
    const wallet = await GeroStore.createNewWallet(
      newWallet.name,
      newWallet.icon,
      Theme.GERO,
      null,
      newWallet.password,
      props.network.blockchain,
      props.network.network
    );
    dialogLocal.value = false;
    const response = await Messaging.sendToBackgroundFromOptions({
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
  } catch (error) {
    console.error('Error creating wallet:', error);
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
