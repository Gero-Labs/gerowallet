<template>
  <div>
    <component :is="this.$route.meta.layout || 'div'">
      <router-view></router-view>
    </component>
    <v-overlay v-show="loading.loading" opacity="0.9" style="text-align: center;">
      <v-card flat style="background-color: transparent!important; text-align: -webkit-center;">
        <video :src="require('@/assets/output.webm')" playsinline autoplay muted loop style="width: 120px; object-fit: contain; object-position: center bottom; left: 0; top: 0;">
        </video>
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
import {mapActions} from "pinia";
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
  methods: {
    ...mapActions(useStore, ['loadWallets', 'loadAccountInfo', 'loadTransactions', "loadAssets", "loadPools"]),
  },
  mounted() {
    this.loadWallets()
    this.loadAccountInfo()
    this.loadTransactions()
    this.loadAssets()
    this.loadPools()
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
