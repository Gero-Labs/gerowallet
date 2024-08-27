<template>
  <div>
    <component :is="this.$route.meta.layout || 'div'">
      <router-view></router-view>
    </component>
    <v-overlay v-show="loading.loading || loading.isRestoring || loadingTxs" opacity="0.9" style="text-align: center;">
      <v-card flat style="background-color: transparent!important; text-align: -webkit-center;">
        <video :src="require('@/assets/output.webm')" playsinline autoplay muted loop style="width: 120px; object-fit: contain; object-position: center bottom; left: 0; top: 0;">
        </video>
        <v-card-text style="color: white" v-if="loading.text">{{ loading.text }}</v-card-text>
        <v-progress-linear
            buffer-value="0"
            color="primary"
            reverse
            stream
            value="0"
            style="color: cyan; width: 100px; text-align: center"
        ></v-progress-linear>
      </v-card>
    </v-overlay>
    <v-snackbar
        v-model="snackbar.active"
        :timeout="snackbar.timeout"
        :color="snackbar.color"
        top
        style="font-family: 'Inter', 'Quicksand','Geologica','Noto Sans Hebrew', 'Open Sans', sans-serif;"
    >
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script>
import BlankLayout from "@/modules/navigation/layouts/BlankLayout.vue";
import ContentLayout from "@/modules/navigation/layouts/ContentLayout.vue";
import {mapActions, mapState} from "pinia";
import {useStore} from "@/store";
import loading from "@/plugins/loading";
import snackbar from "@/plugins/snackbar";

export default {
  components: {BlankLayout, ContentLayout},
  data: () => ({
    loading,
    snackbar,
    store: useStore()
  }),
  computed: {
    ...mapState(useStore, ['loggedWallet', 'transactions', 'assets', 'resolvedAssets', 'resolvedCollections', 'loadingTxs']),
  },
  methods: {
    ...mapActions(useStore, ['login', 'setLoadingTxs']),
  },
  async mounted() {
    if (this.loggedWallet?.id) {
      console.log('loginApp', this.loggedWallet)
      await this.login(this.loggedWallet.id)
    }
    this.loading.setLoading(false)
  }
}
</script>
<style lang="scss">
.v-application {
  background-color: var(--v-background-base) !important;
}
.v-navigation-drawer {
  background-color: var(--v-navigationDrawerBackground-base) !important;
}
.v-app-bar.v-toolbar.v-sheet {
  background-color: transparent !important;
}
.v-card {
  background-color: var(--v-cardBackground-base) !important;
}
</style>
