<template>
  <v-tab-item eager>
    <v-list nav class="transparent px-0">
      <v-list-item class="px-2 py-1">
        <v-list-item-avatar class="my-0" style="align-self: self-start;">
          <v-icon
            left
            dark
            class="mr-1"
          >
            mdi-key-chain
          </v-icon>
        </v-list-item-avatar>
        <v-list-item-content class="py-0" style="align-self: self-start;">
          <v-list-item-title class="text-left">
            <h3 style="color: white; font-size: 16px;">Extended Public Key</h3>
          </v-list-item-title>
          <v-list-item-subtitle class="text-left">
            Ed25519-Bip32 Extended Public Key
          </v-list-item-subtitle>
          <v-list-item-subtitle class="text-left">
            <CopyButton :title="filters.truncate(loggedWallet?.publicKey) " :value="loggedWallet?.publicKey" x-small />
          </v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-avatar size="160" rounded>
          <div ref="qrCodeRef" style="width: 160px; height: 160px;"></div>
        </v-list-item-avatar>
      </v-list-item>
      <v-list-item class="px-2 py-1" v-if="canBackup" @click="backupWalletDialog = true">
        <v-list-item-avatar class="my-0">
          <v-badge
            v-if="!backup"
            bordered
            dot
            color="error"
            overlap
          >
            <v-icon
              dark
              class="mr-1"
            >
              mdi-key
            </v-icon>
          </v-badge>
          <v-icon
            v-else
            left
            dark
            class="mr-1"
          >
            mdi-key
          </v-icon>
        </v-list-item-avatar>
        <v-list-item-content class="py-0">
          <v-list-item-title class="text-left">
            <h3 style="color: white; font-size: 16px;">Recovery Phrase
              <v-tooltip top v-if="backup">
                <template v-slot:activator="{ on, attrs }">
                  <v-icon
                    color="primary"
                    small
                    v-bind="attrs"
                    v-on="on"
                  >
                    mdi-shield-check-outline
                  </v-icon>
                </template>
                <span>Your wallet was backed up</span>
              </v-tooltip>
            </h3>
          </v-list-item-title>
          <v-list-item-subtitle class="text-left">
            {{ backup ? "Your seed phrase master key - keep it offline and private" : "Wallet Backup is Required"}}
          </v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-icon class="my-0" style="align-self: center">
          <v-icon large>
            mdi-chevron-right
          </v-icon>
        </v-list-item-icon>
      </v-list-item>
      <v-list-item class="px-2 py-1" v-if="loggedWallet?.type === WalletType.Normal" @click="changePasswordDialog = true">
        <v-list-item-avatar class="my-0">
          <v-icon>
            mdi-shield-key-outline
          </v-icon>
        </v-list-item-avatar>
        <v-list-item-content class="py-0">
          <v-list-item-title class="text-left">
            <h3 style="color: white; font-size: 16px;">Spending Security Settings</h3>
          </v-list-item-title>
          <v-list-item-subtitle class="text-left">
            Modify your Spending Security Settings
          </v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-icon class="my-0" style="align-self: center">
          <v-icon large>
            mdi-chevron-right
          </v-icon>
        </v-list-item-icon>
      </v-list-item>
<!--      <v-divider />-->
<!--      <v-list-item>-->
<!--        <v-list-item-avatar size="30" class="my-0 ml-1 mr-5" tile>-->
<!--          <v-img :src="assets.cardanoShieldLogo" alt="Cardano Shield Logo" contain />-->
<!--        </v-list-item-avatar>-->
<!--        <v-list-item-content>-->
<!--          <v-list-item-title class="text-left"><h2>Cardano Shield<v-icon>mdi-external-link</v-icon></h2></v-list-item-title>-->
<!--        </v-list-item-content>-->
<!--      </v-list-item>-->
<!--      <v-list-item class="px-2 py-1">-->

<!--      </v-list-item>-->
    </v-list>
    <BackupWalletDialog :is-open="backupWalletDialog" @close="backupWalletDialog = false" />
    <ChangePasswordDialog :is-open="changePasswordDialog" @close="changePasswordDialog = false" />
  </v-tab-item>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, nextTick, toRefs } from 'vue';
import BackupWalletDialog from '@/modules/navigation/dialogs/BackupWalletDialog.vue';
import ChangePasswordDialog from '@/modules/dashboard/dialogs/ChangePasswordDialog.vue';
import { Blockchain, WalletType } from '@/models/types';
import QRCodeStyling from 'qr-code-styling';
import assets from '@/utils/assets';
import { Options } from 'qr-code-styling';
import CopyButton from '@/shared/components/CopyButton.vue';
import filters from '@/shared/utils/filters';
import WalletStore, { walletStore } from '@/stores/walletStore';

const backupWalletDialog = ref<boolean>(false);
const changePasswordDialog = ref<boolean>(false);

const { loggedWallet, config } = toRefs(walletStore);

const backup = computed(() => config.value?.backup || false);

const canBackup = computed(() => {
  return loggedWallet.value?.type === WalletType.Normal && WalletStore.hasBackup();
});

const qrCodeRef = ref<HTMLElement|null>(null)

const isApex = computed(() => {
  return loggedWallet.value?.chain === Blockchain.APEX_PRIME ||
    loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
})

const options = computed((): Partial<Options> => ({
  width: 170,
  height: 170,
  type: 'svg',
  data: loggedWallet.value?.publicKey.toString(),
  image: isApex.value ? assets.geroLogoApex : assets.geroLogo,
  margin: 2,
  qrOptions: {
    typeNumber: 0,
    mode: 'Byte',
    errorCorrectionLevel: 'Q',
  },
  imageOptions: {
    hideBackgroundDots: true,
    imageSize: 0.5,
    margin: 10,
    crossOrigin: 'anonymous',
  },
  backgroundOptions: {
    color: '#ffffff',
  },
  cornersSquareOptions: {
    type: 'extra-rounded',
  },
  cornersDotOptions: {
    type: 'dot',
  },
}));
let qrCode: QRCodeStyling;

onMounted(async () => {
  qrCode = new QRCodeStyling(options.value);
  await nextTick()
  if (qrCodeRef.value) {
    qrCode.append(qrCodeRef.value)
  }
})
</script>
<style scoped>

</style>
