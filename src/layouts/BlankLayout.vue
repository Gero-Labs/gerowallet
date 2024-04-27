<template>
  <v-app id="inspire" :style="{ background: `linear-gradient(#0000009e, #0000009e), url(${require('@/assets/background3.png')}`, backgroundSize: 'cover'}">
    <v-app-bar
        class="py-0"
        flat
        height="80"
        style="flex: none; background-color: transparent!important;"
    >
      <v-container class="py-0 fill-height" style="max-width: 1000px">
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
      <router-view></router-view>
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

export default {
  name: 'BlankLayout',
  components: {PrivacyPolicyDialog, LanguageSelector},
  methods: {
    privacyPolicyDialogChange(value) {
      this.privacyPolicyDialog = value
    }
  },
  data: () => ({
    privacyPolicyDialog: false
  }),
}
</script>

<style>
</style>
