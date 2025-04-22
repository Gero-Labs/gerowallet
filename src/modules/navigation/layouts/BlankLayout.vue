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
            width: '114px',
            height: '122px',
            position: 'absolute',
            top: '20px',
            right: 'calc(50% - 57px)'
        }"
      />
    </v-app-bar>

    <v-main class="d-flex align-center" :style="$vuetify.breakpoint.mobile ? { paddingTop: '50px' } : {}">
      <router-view></router-view>
    </v-main>

    <v-footer
      class="py-0"
      height="80"
      color="transparent"
    >
      <v-container class="py-0 fill-height d-flex justify-end" style="max-width: 1000px">
<!--        <v-btn-->
<!--          text-->
<!--          plain-->
<!--          :ripple="false"-->
<!--          style="text-transform: none"-->
<!--          href="https://www.gerowallet.io/privacy"-->
<!--          target="_blank"-->
<!--        >-->
<!--          Privacy Policy-->
<!--        </v-btn>-->
        <privacy-policy-dialog :dialog="privacyPolicyDialog"
                               @dialogChange="privacyPolicyDialogChange"></privacy-policy-dialog>
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
        <div class="mx-1" style="height: 20px">
          <v-divider vertical></v-divider>
        </div>
        <v-btn
          text
          plain
          :ripple="false"
          style="text-transform: none"
          @click="changeLog.setEnabled(true)"
        >
          Change Log ({{ `v${version}` }})
        </v-btn>
      </v-container>
    </v-footer>
    {{this.$route.query['changeLog']}}
    <ChangeLogDialog :isOpen="changeLog.enabled || this.$route.query['changeLog'] === 'true'" @close="closeChangeLogDialog()" :persistent="false" />
  </v-app>
</template>
<script>
// import LanguageSelector from '../components/LanguageSelector.vue';
import PrivacyPolicyDialog from '../dialogs/PrivacyPolicyDialog.vue';
import { mapState } from 'pinia';
import { useStore } from '@/store';
import loading from '@/plugins/loading';
import changeLog from '@/plugins/changeLog'
import assets from '@/utils/assets';
import ChangeLogDialog from '@/modules/navigation/dialogs/ChangeLogDialog.vue';

export default {
  name: 'BlankLayout',
  components: {
    ChangeLogDialog,
    PrivacyPolicyDialog,
    // LanguageSelector
  },
  computed: {
    ...mapState(useStore, ['network']),
    background() {
      if (this.network?.blockchain?.includes('Apex')) {
        return this.apexBackground;
      }
      return this.cardanoBackground;
    },
    logo() {
      if (this.network?.blockchain?.includes('Apex')) {
        return this.geroLogoApex;
      }
      return this.geroDashboardLogo;
    },
  },
  methods: {
    privacyPolicyDialogChange(value) {
      this.privacyPolicyDialog = value;
    },
    closeChangeLogDialog() {
      changeLog.setEnabled(false)
      if (Object.keys(this.$route.query).length > 0) {
        this.$router.replace({ query: null });
      }
    }
  },
  data: () => ({
    apexBackground: assets.apexBackground,
    cardanoBackground: assets.cardanoBackground,
    privacyPolicyDialog: false,
    geroLogoApex: assets.geroLogoApex,
    geroDashboardLogo: assets.geroDashboard,
    version: '',
    changeLog,
  }),
  mounted() {
    this.version = APP_VERSION
    loading.setLoading(false)

  }
};
</script>
<style>
.transition {
  transition: all 1s ease-in-out
}
</style>
