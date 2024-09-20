<template>
  <v-app id="inspire" class="transition" :style="{
    backgroundImage: `url(${background}`,
    backgroundSize: 'cover'
  }"
  >
    <v-app-bar
      class="py-0"
      flat
      height="80"
      style="flex: none; background-color: transparent!important;"
    >
      <v-container class="py-0 fill-height" style="max-width: 1000px">
        <v-spacer></v-spacer>

<!--        <language-selector></language-selector>-->
        <v-btn
          plain
          large
          dense
          rounded
          width="100"
          style="text-transform: none"
          :ripple="false"
          :href="'https://www.gerowallet.io/support'"
          target="_blank"
        >
          <v-icon class="mr-1">mdi-lifebuoy</v-icon>
          {{ $t('help') }}
        </v-btn>
      </v-container>
      <div
        class="transition"
        :style="{
            backgroundImage: `url(${logo}`,
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            width: '106px',
            height: '120px',
            position: 'absolute',
            top: '50px',
            right: 'calc(50% - 53px)',
        }"
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
        <v-btn
          text
          plain
          :ripple="false"
          style="text-transform: none"
          href="https://www.gerowallet.io/privacy"
          target="_blank"
        >
          Privacy Policy
        </v-btn>
<!--        <privacy-policy-dialog :dialog="privacyPolicyDialog"-->
<!--                               @dialogChange="privacyPolicyDialogChange"></privacy-policy-dialog>-->
        <div class="mx-1" style="height: 20px">
          <v-divider vertical></v-divider>
        </div>
        <v-btn
          text
          plain
          :ripple="false"
          style="text-transform: none"
          href="https://www.gerowallet.io/_files/ugd/79567a_718ec62866234a2689831a9e5c632725.pdf?index=true"
          target="_blank"
        >
          {{ $t('termsOfService') }}
        </v-btn>
      </v-container>
    </v-footer>
  </v-app>
</template>
<script>
// import LanguageSelector from '../components/LanguageSelector.vue';
// import PrivacyPolicyDialog from '../dialogs/PrivacyPolicyDialog.vue';
import { mapState } from 'pinia';
import { useStore } from '@/store';
import loading from '@/plugins/loading';

export default {
  name: 'BlankLayout',
  components: {
    // PrivacyPolicyDialog,
    // LanguageSelector
  },
  computed: {
    ...mapState(useStore, ['network']),
    background() {
      if (this.network?.blockchain?.includes('Apex')) {
        return this.apexBackground;
      }
      return this.bg;
    },
    logo() {
      if (this.network?.blockchain?.includes('Apex')) {
        return this.geroLogoApex;
      }
      return this.geroLogo;
    },
  },
  methods: {
    privacyPolicyDialogChange(value) {
      this.privacyPolicyDialog = value;
    },
  },
  data: () => ({
    apexBackground: require('@/assets/background2.png'),
    bg: require('@/assets/background3.png'),
    privacyPolicyDialog: false,
    geroLogoApex: require('@/modules/navigation/assets/gero_logo_apex.png'),
    geroLogo: require('@/modules/navigation/assets/gero_logo.png'),
  }),
  mounted() {
    loading.setLoading(false)
  }
};
</script>
<style>
.transition {
  transition: all 1s ease-in-out
}
</style>
