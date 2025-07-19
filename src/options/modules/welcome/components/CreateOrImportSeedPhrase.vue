<template>
  <v-card class="transparent-override" flat style="width: 100%; margin: auto; max-width: 520px; justify-items: center;">
    <v-list class="transparent" dense nav style="width: inherit;">
      <v-list-item class="mb-6 py-2" @click="createWalletDialog = true" >
        <v-list-item-avatar size="50" class="my-0" rounded style="border: 1px solid #373A41; border-radius: 14px; background-color: #13161B">
          <v-img :src="walletSvg" style="width: 22px;" max-width="22" contain></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title class="pb-1" style="font-size: 20px; font-weight: 600; word-wrap: break-word;">
            Create Wallet
          </v-list-item-title>
          <v-list-item-subtitle style="font-size: 16px;  display: flex; word-break: break-word;align-items: anchor-center;">
            Set up a new wallet to manage your digital assets.
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
      <v-list-item class="mb-6 py-2" @click="restoreWalletDialog = true;">
        <v-list-item-avatar size="50" class="my-0" rounded style="border: 1px solid #373A41; border-radius: 14px; background-color: #13161B">
          <v-img :src="keySvg" style="width: 22px;" max-width="22" contain></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title class="pb-1" style="font-size: 20px; font-weight: 600; word-wrap: break-word;">
            Restore Wallet
          </v-list-item-title>
          <v-list-item-subtitle style="font-size: 16px;  display: flex; word-break: break-word;align-items: anchor-center;">
            Restore a wallet using your recovery phrase.
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
      <v-list-item class="py-2" @click="pairHardwareWalletDialog = true;">
        <v-list-item-avatar size="50" class="my-0" rounded style="border: 1px solid #373A41; border-radius: 14px; background-color: #13161B">
          <v-img :src="pairSvg" style="width: 22px;" max-width="22" contain></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title class="pb-1" style="font-size: 20px; font-weight: 600; word-wrap: break-word;">
            Pair Hardware Wallet
          </v-list-item-title>
          <v-list-item-subtitle style="font-size: 16px;  display: flex; word-break: break-word;align-items: anchor-center;">
            Connect your hardware wallet.
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </v-list>
    <v-divider class="my-4" style="width: 100%"></v-divider>
    <v-btn text @click="back">
      <v-icon>
        mdi-arrow-left
      </v-icon>
      Back
    </v-btn>
    <CreateWallet :is-open="createWalletDialog" @close="createWalletDialog = false" :persistent="false" :network="props.network"></CreateWallet>
    <RestoreWallet :dialog="restoreWalletDialog" @dialogChange="restoreWalletDialogChange"></RestoreWallet>
    <PairHardwareWallet :dialog="pairHardwareWalletDialog" @dialogChange="pairHardwareWalletDialogChange"></PairHardwareWallet>
  </v-card>
</template>
<script setup lang="ts">
import assets from '@/utils/assets';
import CreateWallet from '@/options/modules/welcome/dialogs/CreateWallet.vue';
import PairHardwareWallet from '@/options/modules/welcome/dialogs/PairHardwareWallet.vue';
import RestoreWallet from '@/options/modules/welcome/dialogs/RestoreWallet.vue';
import { computed, ref } from 'vue';
import { Network } from '@/models/types';

interface Props {
  network: Network;
}

const props = defineProps<Props>();
const emit = defineEmits(['back']);

const createWalletDialog = ref<boolean>(false);
const restoreWalletDialog = ref<boolean>(false);
const pairHardwareWalletDialog = ref<boolean>(false);

const back = () => {
  emit('back');
}

const restoreWalletDialogChange = (val: boolean): void => {
  restoreWalletDialog.value = val;
};

const pairHardwareWalletDialogChange = (val: boolean): void => {
  pairHardwareWalletDialog.value = val;
};
const hue = ref(0);
const walletSvg = computed(() => {
  if (props.network?.blockchain?.includes('Apex')) {
    return assets.walletGeroApexSvg
  }
  return assets.walletGeroSvg
})
const keySvg = computed(() => {
  if (props.network?.blockchain?.includes('Apex')) {
    return assets.keyApexSvg
  }
  return assets.keySvg
})

const pairSvg = computed(() => {
  if (props.network?.blockchain?.includes('Apex')) {
    return assets.pairApexSvg
  }
  return assets.pairSvg
})

computed(() => {
  if (props.network?.blockchain?.includes('Apex')) {
    hue.value = 200;
  }
  hue.value = 0;
})
</script>
<style scoped>

</style>
