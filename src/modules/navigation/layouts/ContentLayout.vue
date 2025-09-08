<template>
  <div>
    <v-app style="background: transparent !important">
      <v-main style="position: relative; z-index: 1; background: black !important">
        <v-container class="pa-0" style="position: relative">
          <!-- Background - Confined to dashboard working area -->
          <div
            :class="
              loggedWallet?.chain === Blockchain.APEX_PRIME || loggedWallet?.chain === Blockchain.APEX_VECTOR
                ? 'apex-background-dashboard'
                : 'cardano-background-dashboard'
            "
            :style="{
              backgroundImage: `url(${
                loggedWallet?.chain === Blockchain.APEX_PRIME || loggedWallet?.chain === Blockchain.APEX_VECTOR
                  ? assets.apexBg
                  : assets.cardanoBg
              })`,
            }"
          ></div>

          <v-layout :align-start="true">
            <NavigationDrawer v-model="drawer" />
            <v-sheet style="height: 100vh; width: 100%; overflow-y: scroll; background-color: transparent">
              <v-row no-gutters v-if="isBeta">
                <v-col cols="12">
                  <v-alert color="warning" style="color: black" class="pa-2 px-3 text-center">
                    This is a <b>Beta Version</b>. For the Official Release visit
                    <a
                      style="color: black; font-weight: 700"
                      href="https://chromewebstore.google.com/detail/gero-dashboard/bgpipimickeadkjlklgciifhnalhdjhe?hl=en-US&utm_source=ext_sidebar"
                      target="_blank"
                      >Gero Dashboard</a
                    >
                    in Chrome Store.
                  </v-alert>
                </v-col>
              </v-row>
              <v-layout column class="no-gutters px-4 transparent" :justify-start="true">
                <v-app-bar flat color="transparent" style="max-height: 55px">
                  <v-app-bar-nav-icon v-if="$vuetify.breakpoint.mobile" @click.stop="drawer = !drawer" />

                  <!-- GERO Ticker -->
                  <div
                    v-if="
                      loggedWallet?.chain !== Blockchain.APEX_PRIME && loggedWallet?.chain !== Blockchain.APEX_VECTOR
                    "
                    class="gero-ticker d-flex align-center"
                    style="min-width: 120px; cursor: pointer"
                    @click="openSwapDialog"
                  >
                    <div class="d-flex flex-column">
                      <span
                        class="gero-label"
                        style="font-size: 12px; font-weight: 600"
                        :style="{ color: primaryColor }"
                        >GERO</span
                      >
                      <span class="gero-price" style="font-size: 10px; color: #fff">{{ getCurrencySymbol() }}{{ geroPrice }}</span>
                    </div>
                  </div>

                  <v-spacer />

                  <QuickActionsBox />

                  <v-spacer />

                  <v-tooltip bottom :content-class="connected ? 'network-tooltip' : 'network-tooltip offline'">
                    <template v-slot:activator="{ on, attrs }">
                      <div
                        style="display: flex; align-items: center; gap: 4px; min-width: 60px"
                        v-bind="attrs"
                        v-on="on"
                      >
                        <v-icon
                          small
                          :color="connected ? primaryColor : '#ff6464'"
                          :class="{ 'sync-animation': isSyncing }"
                        >
                          {{ connected ? 'mdi-lan-connect' : 'mdi-lan-disconnect' }}
                        </v-icon>

                        <!-- Small epoch progress bar -->
                        <v-progress-linear
                          class="epoch-progress-liquid-glass"
                          height="8"
                          :buffer-value="epochSlotPercentage"
                          :value="epochSlotPercentage"
                          :color="connected ? primaryColor : '#ff6464'"
                          background-color="transparent"
                          style="width: 50px"
                          striped
                          :stream="connected"
                        ></v-progress-linear>
                      </div>
                    </template>

                    <div class="network-tooltip-content">
                      <div><strong>Network:</strong> {{ loggedWallet?.network }}</div>
                      <div><strong>Last Sync:</strong> {{ tip?.time ? time.format(new Date(tip.time)) : 'N/A' }}</div>
                      <div><strong>Epoch:</strong> {{ tip?.epoch || 'N/A' }}</div>
                      <div><strong>Progress:</strong> {{ epochSlotPercentage.toFixed(1) }}%</div>
                      <div>
                        <strong class="mr-1">Status:</strong>
                        <span :style="connected ? { color: 'inherit' } : { color: '#ff6464' }">{{
                          connected ? 'Online' : 'Offline'
                        }}</span>
                      </div>
                    </div>
                  </v-tooltip>

                  <!-- Notifications Menu (preserved from current version) -->
                  <v-menu offset-y :close-on-content-click="false" nudge-left="75" nudge-top="-10" eager transition="none">
                    <template v-slot:activator="{ on, attrs }">
                      <v-btn class="ml-4 toolbar-icon-btn" icon v-bind="attrs" v-on="on">
                        <v-icon size="20">mdi-bell-outline</v-icon>
                      </v-btn>
                    </template>
                    <v-card outlined class="notifications-card" min-width="200">
                      <v-card-title class="pa-2 text-h6"> Notifications </v-card-title>
                      <v-card-text class="pa-0">
                        <v-list class="transparent">
                          <v-list-item>
                            <v-list-item-content>
                              <v-list-item-title class="text-center" style="color: #ccc">
                                <v-avatar size="30" color="#333" class="mr-2">
                                  <v-icon small color="#CCC"> mdi-message-text-outline </v-icon>
                                </v-avatar>
                                Nothing New
                              </v-list-item-title>
                            </v-list-item-content>
                          </v-list-item>
                        </v-list>
                      </v-card-text>
                    </v-card>
                  </v-menu>

                  <v-btn @click="currentDialog = dialogs.SETTINGS" class="ml-3 toolbar-icon-btn" icon>
                    <v-badge bordered color="error" dot v-if="shouldBackup">
                      <v-avatar size="20">
                        <img :src="assets.settingsSvg" alt="Settings" />
                      </v-avatar>
                    </v-badge>
                    <v-avatar size="20" v-else>
                      <img :src="assets.settingsSvg" alt="Settings" />
                    </v-avatar>
                  </v-btn>
                </v-app-bar>
                <v-row no-gutters v-if="shouldBackup && !isWalletEmpty">
                  <v-col cols="12">
                    <v-alert
                      type="error"
                      prominent
                      dismissible
                      rounded
                      outlined
                      color="error"
                      class="py-2 px-4 ma-2"
                      style="overflow: hidden"
                    >
                      <v-list-item>
                        <v-list-item-content>
                          <v-list-item-title style="white-space: break-spaces">
                            Export your seed phrase
                          </v-list-item-title>
                          <v-list-item-subtitle style="white-space: break-spaces">
                            Safeguard your assets: store your recovery phrase securely.
                            <b>If you lose it, you’ll lose access to all your funds.</b>
                          </v-list-item-subtitle>
                        </v-list-item-content>
                        <v-list-item-action>
                          <v-btn depressed color="error" @click="backupWalletDialog = true"> Export </v-btn>
                        </v-list-item-action>
                      </v-list-item>
                    </v-alert>
                  </v-col>
                </v-row>
                <SettingsDialog :isOpen="currentDialog === dialogs.SETTINGS" @close="closeDialog" />
                <v-sheet class="transparent pt-2">
                  <keep-alive>
                    <router-view
                      @open-backup-dialog="handleOpenBackupDialog"
                      @open-buy-dialog="handleOpenBuyDialog"
                      @open-receive-dialog="handleOpenReceiveDialog"
                    />
                  </keep-alive>
                </v-sheet>
              </v-layout>
              <Player
                v-if="currentPage.name !== 'mediaPlayer' && musicPlaylist?.length > 0 && context.shown"
                style="position: sticky; bottom: 0"
              />
            </v-sheet>
          </v-layout>
        </v-container>
      </v-main>

      <WelcomeDialog :isOpen="!isWelcomeDone" @close="closeWelcomeDialog" />

      <ChangeLogDialog
        :isOpen="changeLog.enabled || vmProxy.$route.query.changeLog === 'true'"
        @close="closeChangeLogDialog"
        :persistent="false"
      />

      <BackupWalletDialog :isOpen="backupWalletDialog" @close="backupWalletDialog = false" />

      <SwapDialog :isOpen="isSwapDialogOpen" @close="closeSwapDialog" />

      <BuyDialog :isOpen="buyDialog" @close="buyDialog = false" />

      <ReceiveDialog :isOpen="receiveDialog" @close="receiveDialog = false" />
    </v-app>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, toRefs, watch, getCurrentInstance } from 'vue';
import NavigationDrawer from '../components/NavigationDrawer.vue';
import SettingsDialog from '@/modules/dashboard/dialogs/SettingsDialog.vue';
import Player from '@/modules/media-player/Player.vue';
import QuickActionsBox from '@/modules/navigation/components/QuickActionsBox.vue';
import WelcomeDialog from '@/shared/dialogs/WelcomeDialog.vue';
import ChangeLogDialog from '@/options/modules/navigation/dialogs/ChangeLogDialog.vue';
import BackupWalletDialog from '@/modules/navigation/dialogs/BackupWalletDialog.vue';
import SwapDialog from '@/modules/dashboard/dialogs/SwapDialog.vue';
import BuyDialog from '@/modules/dashboard/dialogs/BuyDialog.vue';
import ReceiveDialog from '@/modules/dashboard/dialogs/ReceiveDialog.vue';
import { Blockchain } from '@/models/types';
import assets from '@/utils/assets';
import { themes, iconFilters } from '@/config/themes';
import { updateVuetifyTheme } from '@/plugins/vuetify';
import { loadingState } from '@/stores/loading';
import changeLogPlugin from '@/plugins/changeLog';
import timePlugin from '@/plugins/time';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { setConfiguration } from '@/db/gero-db';
import { geroStore } from '@/stores/geroStore';
import { musicStore } from '@/stores/musicStore';
import { dexHunterStore } from '@/stores/dexHunterStore';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';

const isBeta = ref<boolean>(import.meta.env['VITE_IS_BETA'] === 'true');
const vmProxy = getCurrentInstance()!.proxy as any;
const currentPage = computed(() => vmProxy.$route);
const { isSyncing, connected } = toRefs(loadingState);
const { loggedWallet, account, config } = toRefs(walletStore);
const { config: geroConfig } = toRefs(geroStore);
const { dexHunterTokens } = toRefs(dexHunterStore);
const { tip } = toRefs(networkStore);
const { musicPlaylist, context } = toRefs(musicStore);

const { convertFiat, getCurrencySymbol } = useCurrencyConverter();

const drawer = ref<boolean>(false);
const currentDialog = ref<string | null>(null);
const dialogs = { SETTINGS: 'SETTINGS' };
const backupWalletDialog = ref(false);
const swapDialog = ref(false);
const buyDialog = ref(false);
const receiveDialog = ref(false);

// Background image loading state for performance optimization
const backgroundImageLoaded = ref(false);

// Computed for proper reactivity with Vue 2 components
const isSwapDialogOpen = computed(() => swapDialog.value);

const geroPrice = computed(() => {
  const geroToken = dexHunterTokens.value['10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b64745524f'];
  if (!geroToken) {
    return 'GERO';
  }
  if (geroToken?.price && geroToken.price > 0) {
    return convertFiat(geroToken.price).toFixed(6);
  }
  return 'GERO';
});

const primaryColor = computed(() => {
  const isApex =
    loggedWallet.value?.chain === Blockchain.APEX_PRIME || loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
  return isApex ? themes.apex.primary : themes.cardano.primary;
});

function openSwapDialog() {
  swapDialog.value = true;
}

function closeSwapDialog() {
  swapDialog.value = false;
}
const time = timePlugin;
const changeLog = changeLogPlugin;
const shouldBackup = computed(() => {
  // Use reactive config from store for proper sync between empty and populated states
  return config.value && 'backup' in config.value && !config.value.backup;
});

// Check if wallet is empty (no native tokens)
const isWalletEmpty = computed(() => {
  return !account.value || account.value.controlled_amount === 0;
});
const epochSlotPercentage = computed(() => {
  return tip.value ? (tip.value.epoch_slot / 432000) * 100 : 0;
});

const isWelcomeDone = computed({
  get() {
    return !!geroConfig.value?.welcomeDone;
  },
  set(val) {
    setConfiguration('welcomeDone', val);
  },
});

function closeWelcomeDialog() {
  isWelcomeDone.value = true;
}

function closeChangeLogDialog() {
  changeLog.enabled = false;
  if (Object.keys(vmProxy.$route.query)?.length > 0) {
    vmProxy.$router.replace({ query: null });
  }
}
function closeDialog() {
  currentDialog.value = null;
}

function handleOpenBackupDialog() {
  console.log('Received backup dialog event from dashboard');
  backupWalletDialog.value = true;
}

function handleOpenBuyDialog() {
  console.log('Received buy dialog event from dashboard');
  buyDialog.value = true;
}

function handleOpenReceiveDialog() {
  console.log('Received receive dialog event from dashboard');
  receiveDialog.value = true;
}

// Theme management - update colors when chain changes
const updateThemeColors = () => {
  const isApex =
    loggedWallet.value?.chain === Blockchain.APEX_PRIME || loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
  const currentTheme = isApex ? themes.apex : themes.cardano;
  const currentFilter = isApex ? iconFilters.apex : iconFilters.cardano;

  // Update Vuetify theme
  updateVuetifyTheme(isApex, true); // Always dark theme for now

  // Set CSS custom properties
  Object.entries(currentTheme).forEach(([key, value]) => {
    document.documentElement.style.setProperty(`--${key}-color`, value);
  });
  document.documentElement.style.setProperty('--icon-filter', currentFilter);
};

// Watch for wallet chain changes
watch(
  () => loggedWallet.value?.chain,
  newChain => {
    if (newChain) {
      updateThemeColors();
    }
  },
  { immediate: true }
);

// Preload background image for better LCP performance
const preloadBackgroundImage = () => {
  const currentChain = loggedWallet.value?.chain;
  const imageUrl =
    currentChain === Blockchain.APEX_PRIME || currentChain === Blockchain.APEX_VECTOR
      ? assets.apexBg
      : assets.cardanoBg;

  const img = new Image();
  img.onload = () => {
    backgroundImageLoaded.value = true;
  };
  img.onerror = () => {
    // Fallback: show background anyway after a timeout
    setTimeout(() => {
      backgroundImageLoaded.value = true;
    }, 100);
  };
  img.src = imageUrl;
};

// Lifecycle
onMounted(async () => {
  // Ensure colors are set on mount
  updateThemeColors();

  // Preload background image after critical content
  requestIdleCallback(
    () => {
      preloadBackgroundImage();
    },
    { timeout: 2000 }
  );
});
</script>

<style scoped lang="scss">
/* Cardano Background - Confined to dashboard working area */
.cardano-background-dashboard {
  position: absolute;
  top: calc(-50% + 10px);
  left: 50%;
  width: 100vw;
  height: 100vh;
  z-index: -1; /* Behind dashboard content */
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transform: translateX(-50%) scaleY(-0.7) scaleX(-1.2); /* Center horizontally, flip vertically and squeeze 20%, flip horizontally and stretch 20% */
  pointer-events: none; /* Allow clicks through */
  filter: brightness(0.7);
  opacity: 0;
  transition: opacity 0.3s ease-in-out;

  &[style*='url('] {
    opacity: 1;
  }
}

/* Apex background with same styling as Cardano */
.apex-background-dashboard {
  position: absolute;
  top: calc(-50% + 20px);
  left: 50%;
  width: 100vw;
  height: 100vh;
  z-index: -1; /* Behind dashboard content */
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transform: translateX(-50%) scaleY(-0.7) scaleX(-1.2); /* Same transforms as Cardano */
  pointer-events: none; /* Allow clicks through */
  filter: brightness(0.7);
  opacity: 0;
  transition: opacity 0.3s ease-in-out;

  &[style*='url('] {
    opacity: 1;
  }
}

/* Force progress bar colors to use CSS variables with higher specificity */
.v-progress-linear .v-progress-linear__determinate,
.v-progress-linear__determinate {
  background: linear-gradient(90deg, var(--primary-color, #00c7f3), var(--secondary-color, #00ffd1)) !important;
  border-color: var(--primary-color, #00c7f3) !important;
}

.epoch-progress-liquid-glass .v-progress-linear__determinate {
  background: var(--primary-color, #00c7f3) !important;
}

/* Ensure v-app has pure black background outside working area */
.v-application {
  background: #000000 !important;
  position: relative;
  z-index: 1;
}

/* Override any Vuetify theme variables */
body {
  background: #000000 !important;
}

html {
  background: #000000 !important;
}

/* Make content areas transparent to show background */
.v-container {
  background-color: transparent !important;
}

.v-sheet.transparent {
  background-color: transparent !important;
}

div.v-toolbar__content {
  padding-right: 8px !important;
  padding-left: 8px !important;
}

.sync-animation {
  animation: sync-pulse 2s ease-in-out infinite;
}

@keyframes sync-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(1.1);
  }
}

.epoch-progress-liquid-glass {
  border-radius: 8px;
  margin: 2px 0;
  background: rgba(255, 255, 255, 0.1) !important;
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  overflow: hidden;
}

.epoch-progress-liquid-glass .v-progress-linear__background {
  background: transparent !important;
}

.epoch-progress-liquid-glass .v-progress-linear__determinate {
  background: linear-gradient(
    90deg,
    rgba(0, 199, 243, 0.8) 0%,
    rgba(0, 199, 243, 1) 50%,
    rgba(0, 199, 243, 0.8) 100%
  ) !important;
  backdrop-filter: blur(10px);
  box-shadow: 0 0 20px rgba(0, 199, 243, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.network-tooltip {
  background-color: rgba(0, 0, 0, 0.4) !important;
  backdrop-filter: blur(20px) saturate(1.8) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.8) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  isolation: isolate !important;
  padding: 12px 16px !important;

  &.offline {
    border: 1px solid rgba(255, 100, 100, 0.3) !important;
    box-shadow: 0 8px 32px rgba(255, 100, 100, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  }
}

.network-tooltip-content {
  line-height: 1.3;
  color: #ffffff !important;
}

.network-tooltip-content div {
  margin-bottom: 2px;
}

.network-tooltip-content div:last-child {
  margin-bottom: 0;
}

.network-tooltip-content strong {
  color: #00c7f3 !important;
}

.v-dialog__content--active {
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}

.gero-ticker {
  transition: all 0.2s ease;
  border-radius: 6px;
  padding: 4px 8px;
}

.gero-ticker:hover {
  background-color: rgba(0, 199, 243, 0.1);
  transform: scale(1.05);
}

.gero-ticker:active {
  transform: scale(0.98);
}

.toolbar-icon-btn {
  width: 28px !important;
  height: 28px !important;
  border-radius: 6px !important;
}

.toolbar-icon-btn .v-icon {
  color: rgba(255, 255, 255, 0.85) !important;
}
.liquid-glass-card,
.v-card.liquid-glass-card {
  left: 0;
  margin-top: 10px;
  background-color: rgba(255, 255, 255, 0.18) !important;
  background-image: none !important;
  backdrop-filter: blur(10px) !important;
  -webkit-backdrop-filter: blur(10px) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 12px !important;
  transition: all 0.3s ease !important;
  cursor: pointer !important;
  overflow: hidden !important;
}

.liquid-glass-card:hover,
.v-card.liquid-glass-card:hover {
  background-color: rgba(255, 255, 255, 0.18) !important;
  backdrop-filter: blur(15px) !important;
  -webkit-backdrop-filter: blur(15px) !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  transform: translateY(-2px) !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
}
.notifications-card {
  background-color: rgba(0, 0, 0, 0.4) !important;
  backdrop-filter: blur(2px) !important;
  -webkit-backdrop-filter: blur(2px) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  isolation: isolate !important;
}
</style>
