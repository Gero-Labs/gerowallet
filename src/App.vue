<template>
  <v-app id="inspire"
         :style="{ background: `linear-gradient(#0000009e, #0000009e), url(${require('@/assets/background3.png')}`, backgroundSize: 'cover'}">
    <v-app-bar
        class="py-0"
        color="transparent"
        flat
        height="80"
        style="flex: none"
    >
      <v-container class="py-0 fill-height" style="max-width: 1000px">
        <!--        <v-avatar-->
        <!--            tile-->
        <!--            class="mr-2"-->
        <!--            size="24"-->
        <!--        >-->
        <!--          <v-img-->
        <!--              :src="require('@/assets/logo.png')"-->
        <!--              class="my-3"-->
        <!--              contain-->
        <!--              style="margin: auto"-->
        <!--          />-->
        <!--        </v-avatar>-->



        <v-spacer></v-spacer>

        <v-btn
            plain
            large
            dense
            rounded
            width="100"
            style="text-transform: none"
            :ripple="false"
        >
          <v-icon>mdi-lifebuoy</v-icon>&nbsp;
          {{ $t('help') }}
        </v-btn>
        <language-selector></language-selector>

      </v-container>
      <v-img
          :src="require('@/assets/gero_logo.png')"
          contain
          style="width: 150px; position: absolute; top: 50px; right: calc(50% - 75px);"
          width="120"
      />
    </v-app-bar>

    <v-main class="d-flex align-center">
      <create-wallet :dialog="createWalletDialog" @dialogChange="createWalletDialogChange"></create-wallet>
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
              <v-col cols="12" md="4" lg="4" class="d-flex align-center">
                <parallax-card style="margin-left: auto; margin-right: auto;"
                               :data-image="require('@/assets/hardware_wallet.png')">
                  <h1 slot="header" style="line-height: 1">{{ $t('hardwareWallet') }}</h1>
                  <p slot="content">{{ $t('hardwareWalletSubtitle') }}</p>
                </parallax-card>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-container>
    </v-main>
    <v-footer
        class="py-0"
        height="80"
        color="transparent"
    >
      <v-container class="py-0 fill-height d-flex justify-end" style="max-width: 1000px">
        <privacy-policy-dialog :dialog="privacyPolicyDialog"
                               @dialogChange="privacyPolicyDialogChange"></privacy-policy-dialog>
        <div class="mx-1" style="height: 20px"><v-divider vertical></v-divider></div>
        <v-btn
            text
            plain
            :ripple="false"
            style="text-transform: none"
            href="https://gerowallet.io/assets/downloads/UserAgreement.pdf"
            target="_blank"
        >
          {{ $t('termsOfService') }}
        </v-btn>
      </v-container>
    </v-footer>
  </v-app>
</template>

<script>
import LanguageSelector from "@/components/LanguageSelector.vue";
import PrivacyPolicyDialog from "@/components/dialogs/PrivacyPolicyDialog.vue";
import ParallaxCard from "@/components/ParallaxCard.vue";
import rules from "@/plugins/rules";
import * as bip39 from "bip39";
import CreateWallet from "@/components/dialogs/CreateWallet.vue";

export default {
  computed: {

  },
  components: {CreateWallet, ParallaxCard, PrivacyPolicyDialog, LanguageSelector},
  methods: {
    privacyPolicyDialogChange(value) {
      this.privacyPolicyDialog = value
    },
    createWalletDialogChange(val) {
      this.createWalletDialog = val
    }
  },
  data: () => ({
    privacyPolicyDialog: false,
    createWalletDialog: false,
  }),
  mounted() {
  }
}
</script>