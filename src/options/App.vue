<template>
  <div>
    <component :is="layout">
      <router-view></router-view>
    </component>
    <v-overlay v-show="loading || isRestoring || loadingTxs" opacity="0.9" style="text-align: center;">
      <v-card flat style="background-color: transparent!important; text-align: -webkit-center;">
        <video :src="assetsUtil.loadingAnimation" playsinline autoplay muted loop style="width: 120px; object-fit: contain; object-position: center bottom; left: 0; top: 0;">
        </video>
        <v-card-text style="color: white" v-if="text">{{ text }}</v-card-text>
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
        v-model="snackbarPlugin.active"
        :timeout="snackbarPlugin.timeout"
        :color="snackbarPlugin.color"
        top
        style="font-family: 'Inter', 'Quicksand','Geologica','Noto Sans Hebrew', 'Open Sans', sans-serif;"
        transition="scroll-y-transition"
    >
      {{ snackbarPlugin.text }}
    </v-snackbar>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref, computed, toRefs } from 'vue'
import { useStore } from "@/stores";
import snackbar from "@/plugins/snackbar";
import assts from '@/utils/assets';
import networks from '@/utils/networks';
import { loadingState } from '@/plugins/loading';

const { loading, isRestoring, text } = toRefs(loadingState);

const vmProxy = getCurrentInstance()!.proxy as any
const route = vmProxy.$route;
const layout = computed(() => route.meta.layout || 'div');

const snackbarPlugin = ref(snackbar);
const assetsUtil = ref(assts);

const store = useStore();

const loadingTxs = computed(() => store.loadingTxs);
const network = computed(() => store.network);
const setNetwork = store.setNetwork;

onMounted(() => {
  if (!network) {
    setNetwork(networks.networks[0])
  }
})
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
.v-dialog__content--active {
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(4px);
}
.v-carousel__controls {
  background-color: transparent!important;
}
.dialogStyle {
  -webkit-backdrop-filter: blur(12px) brightness(0.2);
  backdrop-filter: blur(12px);
  background: #000000ab;
  border: solid 2px #ffffff44;
}

.dialogStyle.darken {
  background: #000000e0;
}

.v-dialog:not(.v-dialog--fullscreen) {
  max-height: 100%;
}

.smallToolTip {
  padding: 1px 2px;
  background-color: rgba(30, 30, 30, 0.88);
  border: 1px solid #404040;
  font-size: 10px !important;
  opacity: 0.9 !important;
}
.v-text-field--outlined.no-margin-append-outer .v-input__append-outer {
  margin: 0 0 0 4px !important;
}

.v-text-field--outlined.no-margin-append-outer .v-input__append-inner {
  margin: 0 !important;
}
</style>
