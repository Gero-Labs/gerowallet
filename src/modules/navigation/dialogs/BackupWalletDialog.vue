<template>
  <BaseDialog
    :title="t('settings.recoveryPhrase')"
    :subtitle="backup ? t('settings.seedPhraseMasterKey') : t('settings.walletBackupRequired')"
    style="opacity: 0.9"
    content-class="rounded-xxl dialogStyle darken"
    :is-open="props.isOpen"
    @close="approval.invalidate(); $emit('close')"
    scrollable
    max-width="850"
    :width="598"
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
          <v-stepper-item
            class="py-0"
            :complete="step > 1"
            :value="1"
          >
            Seed Phrase
          </v-stepper-item>
          <v-divider></v-divider>
          <v-stepper-item
            class="py-0"
            :complete="step > 2"
            :value="2"
          >
            Confirm Phrase
          </v-stepper-item>
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
          <v-stepper-item
            :complete="step > 1"
            :value="1"
          >
            {{ $t('navigation.walletCreation') }}
          </v-stepper-item>
          <v-divider></v-divider>
          <v-stepper-item
            :complete="step > 2"
            :value="2"
          >
            Seed Phrase
          </v-stepper-item>
          <v-divider></v-divider>
          <v-stepper-item
            :value="3"
          >
            Confirm Phrase
          </v-stepper-item>
        </v-stepper-header>
        <v-stepper-window :model-value="step" class="ma-0">
          <v-stepper-window-item :value="1" style="text-align: -webkit-center;" class="pa-0">
            <v-form ref="form2" v-model="valid">
              <v-card flat class="transparent" style="max-width: 556px; min-height: 500px;">
                <v-card-text class="pa-0 text-left">
                  <v-alert
                    color="error"
                    density="compact"
                    variant="outlined"
                    type="error"
                    prominent
                    border="start"
                  >
                    <ul>
                      <li>{{ $t('wallet.backupWriteDownOrder') }}</li>
                      <li>{{ $t('wallet.backupNeededToRestore') }}</li>
                      <li>{{ $t('wallet.saveSeedPhraseSafe') }}</li>
                    </ul>
                  </v-alert>
                  <!-- Reserve room for authentication after reset clears every seed word. -->
                  <v-hover v-slot="{ isHovering: hover, props: hoverProps }">
                    <v-card v-bind="hoverProps" flat variant="outlined" class="mb-4 position-relative"
                            :min-height="overlay ? 280 : undefined"
                            :style="overlay ? {backgroundColor: 'black'} : {backgroundColor: 'transparent'}">
                      <v-row no-gutters>
                        <v-col class="pa-2" cols="12" md="3" sm="4" v-for="(item,index) in seedPhrase" :key="index">
                          <v-chip color="#5553" size="large" style="width: 100%; height: 30px"><span
                            style="color: #2f9cac">{{ (index + 1) + '.' }}</span>&nbsp;&nbsp;{{ item }}
                          </v-chip>
                        </v-col>
                      </v-row>
                      <v-overlay
                        contained
                        persistent
                        class="align-center justify-center"
                        :opacity="hover ? 0.4 : 1"
                        :style=" hover && overlay ? { backdropFilter: 'blur(6px)' } : {}"
                        scrim="black"
                        :model-value="overlay"
                      >
                        <v-form ref="formUnlock" v-model="validUnlock" style="max-width: 340px">
                          <v-list-item class="px-0">
                            <div class="g-list-content">
                              <v-list-item-title>
                                {{ isPrfWallet ? $t('wallet.passkeyProtected') : $t('wallet.passwordProtected') }}
                              </v-list-item-title>
                              <v-list-item-subtitle>
                                {{ isPrfWallet ? $t('wallet.usePassKeyToUnlock') : $t('wallet.enterPasswordToUnlock') }}
                              </v-list-item-subtitle>
                            </div>
                          </v-list-item>

                          <!-- Password field for normal wallets -->
                          <template v-if="!isPrfWallet">
                            <PassKeyPasswordField
                              ref="passwordField"
                              :model-value="password"
                              @update:model-value="password = $event"
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
                                <v-img :src="assets.passKeySvg" ></v-img>
                              </v-avatar>
                              {{ t('security.usePassKey').toUpperCase() }}
                            </v-btn>
                          </template>
                        </v-form>
                      </v-overlay>
                    </v-card>
                  </v-hover>
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
          </v-stepper-window-item>

          <v-stepper-window-item :value="2" style="text-align: -webkit-center;" class="pa-0">
            <v-form ref="form" :model-value="valid2" style="padding-top: 12px; padding-bottom: 12px">
              <v-card flat class="transparent d-flex row fill-height" style="max-width: 556px; min-height: 500px;">
                <v-card-text class="px-0 d-flex row justify-space-around mt-2">
                  <v-card-text class="pa-0">
                    <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Please click on each word in the correct order.</h2>
                    <v-card flat class="mt-3" style="background-color: transparent!important;">
                      <v-row no-gutters>
                        <v-col class="pa-2" cols="12" md="3" sm="3" v-for="(item,index) in seedPhraseReplaced" :key="index">
                          <v-chip :color="item.state ? '#2f9cac' : '#5553'" class="justify-center" size="large" style="width: 100%; height: 30px" @click="fillNext(index)" :disabled="!item.state">
                            <span :style="!item.state ? {color: '#515151'} : {color: 'inherit'}">{{ item.word }}</span>
                          </v-chip>
                        </v-col>
                      </v-row>
                    </v-card>
                  </v-card-text>
                  <v-card flat variant="outlined" class="mb-4" style="background-color: transparent!important;">
                    <v-row no-gutters>
                      <v-col class="pa-2 px-1" cols="12" md="3" sm="4" v-for="(item,index) in seedPhraseToConfirm" :key="index">
                        <div style="display: flex; line-height: 2.14">
                          <span style="color: #2f9cac; min-width: 22px">
                            {{ (index + 1) }}&nbsp;
                          </span>
                          <v-chip v-if="typeof item === 'object'" color="#2f9cac" style="width: 100%; height: 30px" @click="removeWord(item, index)">
                            {{ item.word }}
                          </v-chip>
                          <v-chip  v-else :color="isNextToFill(index) ? '#898989' : '#5553'" size="large" :variant="item === '' ? 'outlined' : 'tonal'" style="width: 100%; height: 30px">
                            {{ item }}
                          </v-chip>
                        </div>
                      </v-col>
                    </v-row>
                  </v-card>
                  <div style="width: 100%" class="text-right">
                    <v-spacer></v-spacer>
                    <v-btn color="primary" variant="text" plain :disabled="!seedPhraseReplaced.some(item => !item.state)" @click="reset">
                      <v-icon size="small">
                        mdi-reload
                      </v-icon>
                      Reset
                    </v-btn>
                  </div>
                </v-card-text>
              </v-card>
            </v-form>
          </v-stepper-window-item>
        </v-stepper-window>
      </v-stepper>
    </v-card-text>
    <v-card-actions class="pa-0 align-self-end" style="width: 100%">
      <v-spacer></v-spacer>
      <v-btn
        v-if="step == 2"
        variant="text"
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
import { SecretPurpose, decrypt } from '@/shared/utils/crypto';
import snackbar from '@/plugins/snackbar';
import WalletStore, { walletStore } from '@/stores/walletStore';
import assets from '@/utils/assets';
import { useApprovalFreshness } from '@/shared/composables/useApprovalFreshness';

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
// A shuffled seed word in the confirm grid: `state` false once the user has placed it.
type SeedWord = { word: string; state: boolean };
// Confirm slots hold either an empty-string placeholder or a placed SeedWord.
const seedPhraseToConfirm = ref<Array<string | SeedWord>>([]);
const seedPhraseReplaced = ref<SeedWord[]>([]);
const overlay = ref<boolean>(true);
const recoverSeedChecked = ref<boolean>(false);
const password = ref<string>('');
const passwordField = ref<{ showError: (msg: string) => void } | null>(null);
const decryptingWithPassKey = ref<boolean>(false);
const backup = computed(() => config.value?.backup || false);
const approval = useApprovalFreshness(
  () => [loggedWallet.value?.id, loggedWallet.value?.chain, loggedWallet.value?.network, walletStore.isLocked],
  () => props.isOpen,
  () => resetDialog(),
);

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

const isNextToFill = (index: number): boolean => {
  return index === seedPhraseToConfirm.value.indexOf("")
}

const removeWord = async (item: SeedWord, index: number): Promise<void> => {
  seedPhraseToConfirm.value[index] = ''
  item.state = false
  const found = seedPhraseReplaced.value.find(value => value.word === item.word)
  if (found) found.state = true
}

const fillNext = async (index: number): Promise<void> => {
  seedPhraseToConfirm.value[seedPhraseToConfirm.value.indexOf("")] = seedPhraseReplaced.value[index]
  seedPhraseReplaced.value[index].state = false
  seedPhraseToConfirm.value = JSON.parse(JSON.stringify(seedPhraseToConfirm.value))
}

const reset = async (): Promise<void> => {
  seedPhraseToConfirm.value = seedPhraseToConfirm.value.map((value) => {
    if (typeof value === 'object') {
      const found = seedPhraseReplaced.value.find(val => val.word === value.word)
      if (found) found.state = true
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
    await backupWalletStep1()
  } else if (step.value === 2) {
    await backupWalletStep2()
  }
}

const vmProxy = getCurrentInstance()!.proxy as unknown as {
  $refs: Record<string, { validate: () => Promise<{ valid: boolean }>; resetValidation: () => void }>;
  $snackbar?: { setError: (msg: string) => void };
}

const backupWalletStep1 = (): Promise<void> => approval.run(async () => {
  const current = approval.capture();
  if ((await vmProxy.$refs['form2'].validate()).valid && current()) {
    step.value = 2
    seedPhrase.value = bip39.generateMnemonic(256).split(' ');
  }
});

const backupWalletStep2 = (): Promise<void> => approval.run(async () => {
  const current = approval.capture();
  if ((await vmProxy.$refs['form'].validate()).valid && current()) {
    // Set backup status using walletStore setBackup function
    WalletStore.setBackup(true);
    emit('close')
    resetDialog()
    nextTick(() => {
      snackbar.fireSuccess(t('wallet.walletBackedUp'))
    })
  }
});

const resetDialog = (): void => {
  recoverSeedChecked.value = false
  valid.value = false
  validUnlock.value = false
  loading.value = false
  overlay.value = true
  seedPhraseToConfirm.value = []
  seedPhraseReplaced.value = []
  seedPhrase.value = [];
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

const randomReplace = (array: string[], count: number): [Array<string | SeedWord>, SeedWord[]] => {
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

const decryptMnemonic = (): Promise<void> => approval.run(async () => {
  const current = approval.capture();
  const wallet = { ...loggedWallet.value };
  const enteredPassword = password.value;
  if ((await vmProxy.$refs['formUnlock'].validate()).valid && current() && enteredPassword === password.value) {
    try {
      const decryptedMnemonic = decrypt(wallet.encryptedMnemonic, enteredPassword, SecretPurpose.Mnemonic)
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
});

const decryptMnemonicWithPassKey = (): Promise<void> => approval.run(async () => {
  const current = approval.capture();
  const wallet = { ...loggedWallet.value };
  decryptingWithPassKey.value = true;
  try {
    console.log('🔐 Decrypting mnemonic with PassKey for PRF wallet');

    // Check if mnemonic is backed up
    if (!wallet.prfEncryptedMnemonic) {
      throw new Error(t('wallet.mnemonicNotBackedUp'));
    }

    // Import PRF decryption function
    const { decryptMnemonicWithPrf } = await import('@/shared/utils/webauthn-prf');
    if (!current()) return;

    // Decrypt mnemonic using PRF (triggers PassKey prompt)
    const decryptedMnemonic = await decryptMnemonicWithPrf(
      wallet.prfEncryptedMnemonic,
      wallet.webAuthnCredentialId,
      wallet.id.toString()
    );
    if (!current()) return;

    // Validate mnemonic
    if (!bip39.validateMnemonic(decryptedMnemonic)) {
      throw new Error('Invalid mnemonic');
    }

    // Set seed phrase and prepare confirmation
    seedPhrase.value = decryptedMnemonic.split(' ');
    [seedPhraseToConfirm.value, seedPhraseReplaced.value] = randomReplace(seedPhrase.value, 4);
    overlay.value = false;

    console.log('✅ Mnemonic decrypted successfully');
  } catch (e: unknown) {
    if (!current()) return;
    console.error('❌ PassKey mnemonic decryption failed:', e);

    // Show user-friendly error
    const message = e instanceof Error ? e.message : '';
    if (message.includes('User cancelled')) {
      console.log('User cancelled PassKey authentication');
    } else {
      vmProxy.$snackbar?.setError(message || t('common.decryptionFailed'));
    }
  } finally {
    decryptingWithPassKey.value = false;
  }
});

watch(() => props.isOpen, (val) => {
  if (!val) {
    resetDialog()
  } else {
    nextTick(() => {
      vmProxy.$refs['formUnlock']?.resetValidation()
      vmProxy.$refs['form']?.resetValidation()
      vmProxy.$refs['form2']?.resetValidation()
    })
  }
})

const back = (): void => {
  approval.invalidate();
  seedPhrase.value = bip39.generateMnemonic(256).split(' ');
  overlay.value = true
  valid.value = false
  recoverSeedChecked.value = false
  validUnlock.value = false
  password.value = ''
  step.value = 1
  nextTick(() => {
    vmProxy.$refs['formUnlock'].resetValidation()
    vmProxy.$refs['form2'].resetValidation()
  })
}

</script>
<style scoped>

</style>
