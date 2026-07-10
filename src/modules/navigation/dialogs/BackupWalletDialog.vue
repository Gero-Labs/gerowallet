<template>
  <BaseDialog
    :title="t('settings.recoveryPhrase')"
    :subtitle="backup ? t('settings.seedPhraseMasterKey') : t('settings.walletBackupRequired')"
    style="opacity: 0.9"
    content-class="rounded-xxl dialogStyle darken"
    :is-open="props.isOpen"
    @close="$emit('close')"
    scrollable
    max-width="850"
    :min-height="0"
    :persistent="persistent"
    icon="mdi-key"
  >
    <v-card-title class="pa-0" style="font-size: 12px">
      <v-stepper
        v-model="step"
        flat
        style="background-color: transparent; width: 100%; height: 36px;"
        non-linear
      >
        <v-stepper-header style="box-shadow: none; height: 32px" >
          <v-stepper-step
            class="py-0"
            :complete="step > 1"
            step="1"
          >
            Seed Phrase
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step
            class="py-0"
            :complete="step > 2"
            step="2"
          >
            Confirm Phrase
          </v-stepper-step>
        </v-stepper-header>
      </v-stepper>
    </v-card-title>
    <v-card-text class="pa-0">
      <v-stepper
        v-model="step"
        flat
        style="background-color: transparent;"
        non-linear
      >
        <v-stepper-header style="display: none">
          <v-stepper-step
            :complete="step > 1"
            step="1"
          >
            {{ $t('navigation.walletCreation') }}
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step
            :complete="step > 2"
            step="2"
          >
            Seed Phrase
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step
            step="3"
          >
            Confirm Phrase
          </v-stepper-step>
        </v-stepper-header>
        <v-stepper-items>
          <v-stepper-content step="1" style="text-align: -webkit-center;" class="pa-0">
            <v-form ref="form2" v-model="valid">
              <v-card flat class="transparent" style="max-width: 534px; min-height: 500px;">
                <v-card-text class="pa-0">
                  <v-alert
                    color="primary"
                    dense
                    outlined
                    type="info"
                    prominent
                    border="left"
                  >
                    Write down or copy these words in the following order.<br>You will need
                    these to back up and restore your wallet.
                  </v-alert>
                  <v-hover v-slot="{ hover }">
                    <v-card flat outlined class="mb-4"
                            :style="overlay ? {backgroundColor: 'black'} : {backgroundColor: 'transparent'}">
                      <v-row no-gutters>
                        <v-col class="pa-2" cols="12" md="3" sm="4" v-for="(item,index) in seedPhrase" :key="index">
                          <v-chip color="#5553" large style="width: 100%; height: 30px"><span
                            style="color: #2f9cac">{{ (index + 1) + '.' }}</span>&nbsp;&nbsp;{{ item }}
                          </v-chip>
                        </v-col>
                      </v-row>
                      <v-overlay
                        :absolute="true"
                        :opacity="hover ? 0.4 : 1"
                        :style=" hover && overlay ? { backdropFilter: 'blur(6px)' } : {}"
                        color="black"
                        :value="overlay"
                      >
                        <v-form ref="formUnlock" v-model="validUnlock" style="max-width: 340px">
                          <v-list-item class="px-0">
                            <v-list-item-content>
                              <v-list-item-title>
                                {{ isPrfWallet ? $t('wallet.passkeyProtected') : $t('wallet.passwordProtected') }}
                              </v-list-item-title>
                              <v-list-item-subtitle>
                                {{ isPrfWallet ? $t('wallet.usePassKeyToUnlock') : $t('wallet.enterPasswordToUnlock') }}
                              </v-list-item-subtitle>
                            </v-list-item-content>
                          </v-list-item>

                          <!-- Password field for normal wallets -->
                          <template v-if="!isPrfWallet">
                            <PassKeyPasswordField
                              ref="passwordField"
                              :value="password"
                              @input="password = $event"
                              outlined
                              dense
                              :rules="[rules.required()]"
                              :label="t('wallet.password')"
                              @enter="validUnlock && decryptMnemonic()"
                            />
                            <v-btn
                              color="primary"
                              block
                              :disabled="!validUnlock"
                              @click="decryptMnemonic"
                            >
                              <v-icon class="mr-1">mdi-key</v-icon>
                              {{ t('wallet.unlock').toUpperCase() }}
                            </v-btn>
                          </template>

                          <!-- PassKey button for PRF wallets -->
                          <template v-else>
                            <v-btn
                              color="primary"
                              block
                              @click="decryptMnemonicWithPassKey"
                              :loading="decryptingWithPassKey"
                            >
                              <v-avatar size="18" class="mr-1">
                                <v-img :src="assets.passKeySvg" contain></v-img>
                              </v-avatar>
                              {{ t('security.usePassKey').toUpperCase() }}
                            </v-btn>
                          </template>
                        </v-form>
                      </v-overlay>
                    </v-card>
                  </v-hover>
                  <v-alert
                    dense
                    type="error"
                    prominent
                    border="left"
                    class="text-left"
                  >
                    {{ $t('wallet.saveSeedPhraseSafe') }}
                  </v-alert>
                  <v-checkbox
                    class="mt-0"
                    hide-details
                    v-model="recoverSeedChecked"
                    :label="$t('wallet.understandLosePhrase')"
                    :rules="[(recoverSeedChecked)]"
                  >
                  </v-checkbox>
                </v-card-text>
              </v-card>
            </v-form>
          </v-stepper-content>

          <v-stepper-content step="2" style="text-align: -webkit-center;" class="pa-0">
            <v-form ref="form" v-model="valid2" style="padding-top: 12px; padding-bottom: 12px">
              <v-card flat class="transparent d-flex row fill-height" style="max-width: 534px; min-height: 500px;">
                <v-card-text class="px-0 d-flex row justify-space-around mt-2">
                  <v-card-text class="pa-0">
                    <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Please click on each word in the correct order.</h2>
                    <v-card flat class="mt-3" style="background-color: transparent!important;">
                      <v-row no-gutters>
                        <v-col class="pa-2" cols="12" md="3" sm="3" v-for="(item,index) in seedPhraseReplaced" :key="index">
                          <v-chip :color="item.state ? '#2f9cac' : '#5553'" class="justify-center" large style="width: 100%; height: 30px" @click="fillNext(index)" :disabled="!item.state">
                            <span :style="!item.state ? {color: '#515151'} : {color: 'inherit'}">{{ item.word }}</span>
                          </v-chip>
                        </v-col>
                      </v-row>
                    </v-card>
                  </v-card-text>
                  <v-card flat outlined class="mb-4" style="background-color: transparent!important;">
                    <v-row no-gutters>
                      <v-col class="pa-2 px-1" cols="12" md="3" sm="4" v-for="(item,index) in seedPhraseToConfirm" :key="index">
                        <div style="display: flex; line-height: 2.14">
                          <span style="color: #2f9cac; min-width: 22px">
                            {{ (index + 1) }}&nbsp;
                          </span>
                          <v-chip v-if="typeof item === 'object'" color="#2f9cac" style="width: 100%; height: 30px" @click="removeWord(item, index)">
                            {{ item.word }}
                          </v-chip>
                          <v-chip  v-else :color="isNextToFill(index) ? '#898989' : '#5553'" large :outlined="item === ''" style="width: 100%; height: 30px">
                            {{ item }}
                          </v-chip>
                        </div>
                      </v-col>
                    </v-row>
                  </v-card>
                  <div style="width: 100%" class="text-right">
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text plain :disabled="!seedPhraseReplaced.some(item => !item.state)" @click="reset">
                      <v-icon small>
                        mdi-reload
                      </v-icon>
                      Reset
                    </v-btn>
                  </div>
                </v-card-text>
              </v-card>
            </v-form>
          </v-stepper-content>
        </v-stepper-items>
      </v-stepper>
    </v-card-text>
    <v-card-actions class="pa-0 align-self-end" style="width: 100%">
      <v-spacer></v-spacer>
      <v-btn
        v-if="step == 2"
        text
        color="primary"
        @click="back"
        elevation="0"
        :loading="loading"
      >
        Back
      </v-btn>
      <v-btn
        color="primary"
        @click="backupWallet"
        elevation="0"
        :disabled="isDisabled"
        :loading="loading"
      >
        Continue
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, getCurrentInstance, nextTick, ref, toRefs, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import * as bip39 from 'bip39';
import rules from '@/utils/rules';
import { decrypt } from '@/shared/utils/crypto';
import snackbar from '@/plugins/snackbar';
import WalletStore, { walletStore } from '@/stores/walletStore';
import assets from '@/utils/assets';

const { t } = useTranslation();

interface Props {
  isOpen: boolean;
}
const props = defineProps<Props>();

const emit = defineEmits(['close']);

const { loggedWallet, config } = toRefs(walletStore);

const persistent = ref<boolean>(false);
const step = ref<number>(1);
const valid = ref<boolean>(false);
const validUnlock = ref<boolean>(false);
const loading = ref<boolean>(false);
const seedPhrase = ref<string[]>(bip39.generateMnemonic(256).split(' '));
const seedPhraseToConfirm = ref<any[]>([]);
const seedPhraseReplaced = ref<any[]>([]);
const overlay = ref<boolean>(true);
const recoverSeedChecked = ref<boolean>(false);
const password = ref<string>('');
const passwordField = ref<any>(null);
const decryptingWithPassKey = ref<boolean>(false);
const backup = computed(() => config.value?.backup || false);

// Check if wallet uses PRF encryption
const isPrfWallet = computed(() => {
  const wallet = loggedWallet.value;

  // Check encryptionMethod field, OR fallback to checking for PRF-specific fields
  return wallet?.encryptionMethod === 'prf' ||
    (!!wallet?.prfEncryptedMnemonic && !!wallet?.webAuthnCredentialId);
});

const seedToStr = () => {
  let str = ''
  seedPhraseToConfirm.value.forEach(value => {
    if (typeof value === 'object') {
      str += value.word
    } else {
      str += value
    }
    str += ' '
  })
  return str.substring(0, str.length-1)
}

const valid2 = computed(() => {
  return seedPhraseToConfirm.value && seedPhraseToConfirm.value.indexOf("") === -1 && bip39.validateMnemonic(seedToStr())
})

const isNextToFill = (index): boolean => {
  return index === seedPhraseToConfirm.value.indexOf("")
}

const removeWord = async (item, index: number): Promise<void> => {
  seedPhraseToConfirm.value[index] = ''
  item.state = false
  const found = seedPhraseReplaced.value.find(value => value.word === item.word)
  found.state = true
}

const fillNext = async (index: number): Promise<void> => {
  seedPhraseToConfirm.value[seedPhraseToConfirm.value.indexOf("")] = seedPhraseReplaced.value[index]
  seedPhraseReplaced.value[index].state = false
  seedPhraseToConfirm.value = JSON.parse(JSON.stringify(seedPhraseToConfirm.value))
}

const reset = async (): Promise<void> => {
  seedPhraseToConfirm.value = seedPhraseToConfirm.value.map((value: any) => {
    if (typeof value === 'object') {
      const found = seedPhraseReplaced.value.find(val => val.word === value.word)
      found.state = true
      return ''
    }
    return value
  })
}

const isDisabled = computed(() => {
  if (step.value === 1) {
    return overlay.value || !valid.value
  } else if (step.value === 2) {
    return !valid2.value
  } else {
    return true
  }
})

const backupWallet = async (): Promise<void> => {
  if (step.value === 1) {
    backupWalletStep1()
  } else if (step.value === 2) {
    backupWalletStep2()
  }
}

const vmProxy = getCurrentInstance()!.proxy as any

const backupWalletStep1 = (): void => {
  if (vmProxy.$refs.form2.validate()) {
    step.value = 2
    seedPhrase.value = bip39.generateMnemonic(256).split(' ');
  }
}

const backupWalletStep2 = (): void => {
  if (vmProxy.$refs.form.validate()) {
    // Set backup status using walletStore setBackup function
    WalletStore.setBackup(true);
    emit('close')
    resetDialog()
    nextTick(() => {
      snackbar.fireSuccess(t('wallet.walletBackedUp'))
    })
  }
}

const resetDialog = (): void => {
  recoverSeedChecked.value = false
  valid.value = false
  validUnlock.value = false
  loading.value = false
  overlay.value = true
  seedPhraseToConfirm.value = []
  seedPhraseReplaced.value = []
  persistent.value = false
  password.value = ''
  step.value = 1
}

const shuffleArray = (array: { word: string, state: boolean }[]) => {
  let len = array.length, currentIndex: number;
  for (currentIndex = len - 1; currentIndex > 0; currentIndex--) {
    let randIndex = Math.floor(Math.random() * (currentIndex + 1) );
    const temp = array[currentIndex];
    array[currentIndex] = array[randIndex];
    array[randIndex] = temp;
  }
  return array
}

const randomReplace = (array: string[], count: number) => {
  const replaced: { word: string, state: boolean }[] = [];
  const indices = new Set();
  do {
    indices.add(Math.floor(Math.random() * array.length));
  } while (indices.size < count)
  const res = array.map((v, i) => {
    if (indices.has(i)) {
      replaced.push({ word: v, state: true })
      return ''
    }
    return v
  });
  return [res, shuffleArray(replaced)]
}

const decryptMnemonic = async (): Promise<void> => {
  if (vmProxy.$refs.formUnlock.validate()) {
    try {
      const decryptedMnemonic = decrypt(loggedWallet.value.encryptedMnemonic, password.value)
      if (!bip39.validateMnemonic(decryptedMnemonic)) {
        throw new Error('Invalid Password')
      }
      seedPhrase.value = decryptedMnemonic.split(' ');
      [seedPhraseToConfirm.value, seedPhraseReplaced.value] = randomReplace(seedPhrase.value, 4);
      overlay.value = false
    } catch (e) {
      passwordField.value?.showError(t('errors.wrongPassword'));
      console.log(e) //TODO
    }
  }
}

const decryptMnemonicWithPassKey = async (): Promise<void> => {
  decryptingWithPassKey.value = true;
  try {
    console.log('🔐 Decrypting mnemonic with PassKey for PRF wallet');

    // Check if mnemonic is backed up
    if (!loggedWallet.value.prfEncryptedMnemonic) {
      throw new Error(t('wallet.mnemonicNotBackedUp'));
    }

    // Import PRF decryption function
    const { decryptMnemonicWithPrf } = await import('@/shared/utils/webauthn-prf');

    // Decrypt mnemonic using PRF (triggers PassKey prompt)
    const decryptedMnemonic = await decryptMnemonicWithPrf(
      loggedWallet.value.prfEncryptedMnemonic,
      loggedWallet.value.webAuthnCredentialId,
      loggedWallet.value.id.toString()
    );

    // Validate mnemonic
    if (!bip39.validateMnemonic(decryptedMnemonic)) {
      throw new Error('Invalid mnemonic');
    }

    // Set seed phrase and prepare confirmation
    seedPhrase.value = decryptedMnemonic.split(' ');
    [seedPhraseToConfirm.value, seedPhraseReplaced.value] = randomReplace(seedPhrase.value, 4);
    overlay.value = false;

    console.log('✅ Mnemonic decrypted successfully');
  } catch (e: any) {
    console.error('❌ PassKey mnemonic decryption failed:', e);

    // Show user-friendly error
    if (e.message?.includes('User cancelled')) {
      console.log('User cancelled PassKey authentication');
    } else {
      vmProxy.$snackbar?.setError(e.message || t('common.decryptionFailed'));
    }
  } finally {
    decryptingWithPassKey.value = false;
  }
}

watch(() => props.isOpen, (val) => {
  if (!val) {
    resetDialog()
  } else {
    nextTick(() => {
      vmProxy.$refs.formUnlock.resetValidation()
      vmProxy.$refs.form.resetValidation()
      vmProxy.$refs.form2.resetValidation()
    })
  }
})

const back = (): void => {
  seedPhrase.value = bip39.generateMnemonic(256).split(' ');
  overlay.value = true
  valid.value = false
  recoverSeedChecked.value = false
  validUnlock.value = false
  password.value = ''
  step.value = 1
  nextTick(() => {
    vmProxy.$refs.formUnlock.resetValidation()
    vmProxy.$refs.form2.resetValidation()
  })
}

</script>
<style scoped>

</style>
