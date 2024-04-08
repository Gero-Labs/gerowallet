<template>
  <v-container class="py-0" :style="{direction: $t('rtl') === 'true' ? 'rtl' : 'ltr', maxWidth: '1000px'}">
    <v-card flat class="transparent pa-0">
      <v-card-title class="justify-center" style="color: white; font-size: 32px;">{{
          $t('welcome')
        }}
      </v-card-title>
      <v-card-subtitle class="text-center pt-1" style="font-size: 20px">{{ $t('chooseAnOption') }}</v-card-subtitle>
      <v-card-text class="pb-12 px-12">
        <v-row class="fill-height">
          <v-col cols="12" md="4" lg="4" class="d-flex align-center" @click="createWalletDialog = true">
            <parallax-card style="margin-left: auto; margin-right: auto;"
                           :data-image="require('@/assets/wallet_new.png')">
              <h1 slot="header" style="line-height: 1;">{{ $t('createWallet') }}</h1>
              <p slot="content">{{ $t('createWalletSubtitle') }}</p>
            </parallax-card>
          </v-col>
          <v-col cols="12" md="4" lg="4" class="d-flex align-center">
            <parallax-card style="margin-left: auto; margin-right: auto;"
                           :data-image="require('@/assets/wallet_restore.png')">
              <h1 slot="header" style="line-height: 1">{{ $t('restoreWallet') }}</h1>
              <p slot="content">{{ $t('restoreWalletSubtitle') }}</p>
            </parallax-card>
          </v-col>
          <v-col cols="12" md="4" lg="4" class="d-flex align-center" @click="pairHardwareWalletDialog = true">
            <parallax-card style="margin-left: auto; margin-right: auto;"
                           :data-image="require('@/assets/hardware_wallet.png')">
              <h1 slot="header" style="line-height: 1">{{ $t('hardwareWallet') }}</h1>
              <p slot="content">{{ $t('hardwareWalletSubtitle') }}</p>
            </parallax-card>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
    <create-wallet :dialog="createWalletDialog" @dialogChange="createWalletDialogChange"></create-wallet>
    <pair-hardware-wallet :dialog="pairHardwareWalletDialog" @dialogChange="pairHardwareWalletDialogChange"></pair-hardware-wallet>
  </v-container>
</template>
<script>
import PrivacyPolicyDialog from "@/components/dialogs/PrivacyPolicyDialog.vue";
import CreateWallet from "@/components/dialogs/CreateWallet.vue";
import ParallaxCard from "@/components/ParallaxCard.vue";
import LanguageSelector from "@/components/LanguageSelector.vue";
import PairHardwareWallet from "@/components/dialogs/PairHardwareWallet.vue";

export default {
  name: 'welcome',
  components: {PairHardwareWallet, ParallaxCard, CreateWallet},
  methods: {
    createWalletDialogChange(val) {
      this.createWalletDialog = val
    },
    pairHardwareWalletDialogChange(val) {
      this.pairHardwareWalletDialog = val
    }
  },
  data: () => ({
    createWalletDialog: false,
    pairHardwareWalletDialog: false,
  }),
}
</script>
