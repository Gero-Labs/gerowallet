<template>
  <v-dialog
    content-class="rounded-xxl dialogStyle darken"
    v-model="dialogLocal"
    scrollable
    max-width="850"
    min-height="742"
    :persistent="persistent"
  >
    <v-card class="py-0 rounded-xxl transparent fill-height">
      <v-stepper v-model="step" flat style="background-color: transparent; height: 100%" non-linear>
        <v-stepper-header style="box-shadow: none">
          <v-stepper-step :complete="step > 1" step="1"> Recovery Phrase </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step :complete="step > 2" step="2"> Wallet Setup </v-stepper-step>
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
                    Enter your wallet recovery phrase word for word.<br />Make sure you enter the words in the correct
                    order. Also ensure nobody is looking at your screen.
                  </v-alert>
                  <v-row no-gutters class="pb-2">
                    <strong style="align-content: center; color: white">Choose recovery phrase length</strong>
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
                    Continue
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
                <v-card-text class="px-0 d-flex row justify-space-around no-gutters">
                  <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Set up your wallet name</h2>
                  <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">
                    Choose a name to help you identify your wallet.
                  </h3>
                  <v-text-field
                    style="width: 100%"
                    v-model="newWallet.name"
                    dense
                    filled
                    label="Wallet Name"
                    placeholder="e.g. My New Wallet"
                    :rules="[rules.required(), rules.minCharacters(3), rules.maxCharacters(40)]"
                  ></v-text-field>
                  <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Wallet Icon</h2>
                  <v-radio-group v-model="newWallet.icon" row mandatory class="no-gutters mt-2 mb-2" hide-details>
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
                  <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">
                    Set up your spending password
                  </h2>
                  <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">
                    You'll use this to log into your wallet and make transactions.
                  </h3>
                  <v-text-field
                    style="width: 100%"
                    block
                    dense
                    v-model="newWallet.password"
                    filled
                    label="Spending Password"
                    :type="show1 ? 'text' : 'password'"
                    :rules="[
                      rules.required(),
                      rules.spaceNotAllowed,
                      rules.minCharacters(10),
                      rules.oneOrMoreNumbers,
                      rules.containCapital,
                      rules.containLowerCase,
                      rules.containSpecialCharacter,
                    ]"
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
                    label="Confirm Password"
                    :type="show2 ? 'text' : 'password'"
                    :rules="[
                      rules.required(),
                      newWallet.password === newWallet.confirmPassword || 'Passwords must match',
                    ]"
                  >
                    <template v-slot:append>
                      <v-icon @click="show2 = !show2" tabindex="-1">
                        {{ show2 ? 'mdi-eye' : 'mdi-eye-off' }}
                      </v-icon>
                    </template>
                  </v-text-field>
                  <v-checkbox
                    style="width: 100%"
                    class="mt-0 text-left"
                    hide-details
                    v-model="newWallet.recoverPasswordChecked"
                    label="I understand that GeroWallet cannot recover this password for me."
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
  </v-dialog>
</template>
<script setup lang="ts">
import { ref, computed, onUnmounted, getCurrentInstance } from 'vue';
import * as bip39 from 'bip39';
import rules from '@/utils/rules';
import { Theme, NetworkScheme } from '@/models/types';
import MnemonicAutocomplete from '@/modules/welcome/components/MnemonicAutocomplete.vue';
import assets from '@/utils/assets';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import GeroStore from '@/stores/geroStore';

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
const vmProxy = getCurrentInstance()!.proxy as any;
const router = vmProxy?.$router;

// Template refs
const form = ref<any>(null);
const form2 = ref<any>(null);

// Reactive data
const step = ref<number>(1);
const show1 = ref<boolean>(false);
const show2 = ref<boolean>(false);
const newWallet = ref({
  name: '',
  icon: '',
  password: '',
  confirmPassword: '',
  termsChecked: false,
  recoverPasswordChecked: false,
  recoverSeedChecked: false,
});
const valid2 = ref<boolean>(false);
const creatingWalletLoader = ref<boolean>(false);
const persistent = ref<boolean>(false);
const seedPhraseLength = ref<string>('24');
const emptySeedPhrase: string[] = Array(Number(seedPhraseLength.value)).fill('');
const recoverySeedPhrase = ref<string[]>(emptySeedPhrase);

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
    persistent.value = true;
  }
};

const walletCreationStep2 = async () => {
  if (form2.value?.validate()) {
    creatingWalletLoader.value = true;
    try {
      const wallet = await GeroStore.createNewWallet(
        newWallet.value.name,
        newWallet.value.icon,
        Theme.GERO,
        seedToStr.value,
        newWallet.value.password,
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
          router.push('/').catch(err => {
            // Suppress redirect errors (expected when already on target route)
            if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
              console.error('Navigation error:', err);
            }
          });
        });
      } else if (response?.error) {
        console.warn('Login response error:', response.error);
        // Still navigate even if there's a connection error, as the wallet might have been created
        vmProxy.$nextTick(() => {
          router.push('/').catch(() => {});
        });
      }
    } catch (error) {
      console.error('Error creating wallet:', error);
    } finally {
      creatingWalletLoader.value = false;
    }
  }
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
  };
  valid2.value = false;
  creatingWalletLoader.value = false;
  recoverySeedPhrase.value = emptySeedPhrase;
  persistent.value = false;
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
