<template>
  <div>
    <v-app style="background: transparent !important;">
      <v-main style="position: relative; z-index: 1; background: transparent !important;">
      <v-container class="pa-0" style="position: relative;">
        <!-- Cardano Background - Confined to dashboard working area -->
        <div class="cardano-background-dashboard" :style="{ backgroundImage: `url(${assets.cardanoBg})` }"></div>
        
        <v-layout :align-start="true">
          <NavigationDrawer v-model="drawer" />
          <v-sheet
            style="height: 100vh; width: 100%; overflow-y: scroll; background-color: transparent"
          >
            <v-row no-gutters v-if="isBeta">
              <v-col cols="12">
                <v-alert color="warning" style="color: black;" class="pa-2 px-3 text-center">
                  This is a <b>Beta Version</b>. For the Official Release visit <a style="color: black; font-weight: 700" href="https://chromewebstore.google.com/detail/gero-dashboard/bgpipimickeadkjlklgciifhnalhdjhe?hl=en-US&utm_source=ext_sidebar" target="_blank">Gero Dashboard</a> in Chrome Store.
                </v-alert>
              </v-col>
            </v-row>
            <v-layout
              column
              class="no-gutters px-4 transparent"
              :justify-start="true"
              style="min-height: calc(100vh - 90px); flex-direction: column; background-color: transparent;"
            >
              <v-app-bar 
                flat 
                color="transparent" 
                style="max-height: 55px;"
              >
                <v-app-bar-nav-icon
                  v-if="$vuetify.breakpoint.mobile"
                  @click.stop="drawer = !drawer"
                />

                <!-- GERO Ticker -->
                <div class="gero-ticker d-flex align-center" style="min-width: 120px; cursor: pointer;" @click="openSwapDialog">
                  <div class="d-flex flex-column">
                    <span class="gero-label" style="font-size: 12px; font-weight: 600; color: #00c7f3;">GERO</span>
                    <span class="gero-price" style="font-size: 10px; color: #fff;">${{ geroPrice }}</span>
                  </div>
                </div>

                <v-spacer />
                
                <QuickActionsBox />
                
                <v-spacer />


                <v-tooltip bottom content-class="network-tooltip">
                  <template v-slot:activator="{ on, attrs }">
                    <div
                      style="display: flex; align-items: center; gap: 4px; min-width: 60px;"
                      v-bind="attrs"
                      v-on="on"
                    >
                      <v-icon
                        small
                        :color="connected ? '#00c7f3' : '#ff6464'"
                        :class="{ 'sync-animation': isSyncing }"
                      >
                        {{ connected ? 'mdi-lan-connect' : 'mdi-lan-disconnect' }}
                      </v-icon>

                      <!-- Small epoch progress bar -->
                      <v-progress-linear
                        class="epoch-progress-liquid-glass"
                        height="8"
                        :value="epochSlotPercentage"
                        color="#00c7f3"
                        background-color="transparent"
                        style="width: 50px;"
                      ></v-progress-linear>

                    </div>
                  </template>
                  
                  <div class="network-tooltip-content">
                    <div><strong>Network:</strong> {{ loggedWallet?.network }}</div>
                    <div><strong>Last Sync:</strong> {{ latestTip?.time ? time.format(new Date(latestTip.time * 1000)) : 'N/A' }}</div>
                    <div><strong>Epoch:</strong> {{ latestTip?.epoch || 'N/A' }}</div>
                    <div><strong>Progress:</strong> {{ epochSlotPercentage.toFixed(1) }}%</div>
                  </div>
                </v-tooltip>

                <v-btn @click="currentDialog = dialogs.SETTINGS" icon style="margin-left: 4px;">
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

              <v-row no-gutters v-if="shouldBackup">
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
                        <v-list-item-title style="white-space: break-spaces;">
                          Export your seed phrase
                        </v-list-item-title>
                        <v-list-item-subtitle style="white-space: break-spaces;">
                          Safeguard your assets: store your recovery phrase securely. <b>If you lose it, you’ll lose access to all your funds.</b>
                        </v-list-item-subtitle>
                      </v-list-item-content>

                      <v-list-item-action>
                        <v-btn depressed color="error" @click="backupWalletDialog = true">
                          Export
                        </v-btn>
                      </v-list-item-action>
                    </v-list-item>
                  </v-alert>
                </v-col>
              </v-row>

              <SettingsDialog
                :isOpen="currentDialog === dialogs.SETTINGS"
                @close="closeDialog"
              />

              <v-sheet class="transparent">
                <keep-alive>
                  <router-view />
                </keep-alive>
              </v-sheet>
            </v-layout>

            <Player
              v-if="currentPage.name !== 'mediaPlayer' && musicPlaylist?.length > 0 && context.shown"
              style="position: sticky; bottom: 0;"
            />
          </v-sheet>
        </v-layout>
      </v-container>
    </v-main>

    <WelcomeDialog
      :isOpen="!getWelcomeDone"
      @close="closeWelcomeDialog"
    />

    <ChangeLogDialog
      :isOpen="changeLog.enabled || vmProxy.$route.query.changeLog === 'true'"
      @close="closeChangeLogDialog"
      :persistent="false"
    />

    <BackupWalletDialog
      :isOpen="backupWalletDialog"
      @close="backupWalletDialog = false"
    />

    <SwapDialog
      :isOpen="isSwapDialogOpen"
      @close="closeSwapDialog"
    />
    </v-app>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, toRefs, watchEffect, getCurrentInstance } from 'vue';
import NavigationDrawer from '../components/NavigationDrawer.vue'
import SettingsDialog from '@/modules/dashboard/dialogs/SettingsDialog.vue'
import Player from '@/modules/media-player/Player.vue'
import QuickActionsBox from '@/modules/navigation/components/QuickActionsBox.vue'
import CopyButton from '@/shared/components/CopyButton.vue'
import WelcomeDialog from '@/shared/dialogs/WelcomeDialog.vue'
import ChangeLogDialog from '@/options/modules/navigation/dialogs/ChangeLogDialog.vue'
import BackupWalletDialog from '@/modules/navigation/dialogs/BackupWalletDialog.vue'
import SwapDialog from '@/modules/dashboard/dialogs/SwapDialog.vue'
import { Blockchain } from '@/models/types';
import filters from '@/shared/utils/filters'
import assets from '@/utils/assets'
import { loadingState } from '@/plugins/loading'
import Loading from '@/plugins/loading';
import changeLogPlugin from '@/plugins/changeLog'
import timePlugin from '@/plugins/time'

import { useStore } from '@/stores'
import { musicStore } from '@/stores/modules/music'
import { walletConfigStore } from '@/stores/modules/walletConfig'


const isBeta = ref<boolean>(import.meta.env['VITE_IS_BETA'] === 'true');

const vmProxy = getCurrentInstance()!.proxy as any

const currentPage = computed(() => vmProxy.$route)

const { isSyncing } = toRefs(loadingState);

// Pinia stores
const store = useStore()
const music = musicStore()
const walletConfig = walletConfigStore()

// Reactive UI state
const drawer = ref<boolean>(false)
const currentDialog     = ref<string|null>(null)
const dialogs           = { SETTINGS: 'SETTINGS' }
const backupWalletDialog = ref(false)
const swapDialog = ref(false)

// Computed for proper reactivity with Vue 2 components
const isSwapDialogOpen = computed(() => swapDialog.value)

// Aliases for imported utilities
const time       = timePlugin
const changeLog  = changeLogPlugin

// Derived reactive state
const loggedWallet     = computed(() => store.loggedWallet)
const latestTip        = computed(() => store.latestTip)
const connected        = computed(() => store.connected)
const baseAddress      = computed(() => store.baseAddress)
const getWelcomeDone   = computed(() => store.getWelcomeDone)

const musicPlaylist    = computed(() => music.musicPlaylist)
const context          = computed(() => music.context)

const getBackup = computed(() => walletConfig.getBackup)
const hasBackup = computed(() => walletConfig.hasBackup)
const shouldBackup = computed(() => hasBackup.value && !getBackup.value)
const epochSlotPercentage = computed(() => {
  return latestTip.value?.epoch_slot
    ? (latestTip.value.epoch_slot / 432000) * 100
    : 0
})

// GERO ticker data
const geroToken = computed(() => {
  return store.resolvedAssets?.find(asset => 
    asset.name?.toLowerCase().includes('gero') || 
    asset.metadata?.ticker?.toLowerCase() === 'gero'
  )
})

const geroPrice = computed(() => {
  if (geroToken.value?.last_price) {
    return geroToken.value.last_price.toFixed(6)
  }
  return 'GERO'
})

const geroChange = computed(() => {
  return geroToken.value?.change || 0
})

const geroChangeText = computed(() => {
  if (geroToken.value?.change !== undefined) {
    const change = Math.abs(geroToken.value.change)
    const sign = geroToken.value.change >= 0 ? '+' : '-'
    return `${sign}${change.toFixed(2)}%`
  }
  return '--'
})


// Actions from stores
const { login, setWelcomeDone } = store
const { setMediaPlayerShown } = music

// UI handlers (removed hover functionality)

function closeWelcomeDialog() {
  setWelcomeDone(true)
}

function openSwapDialog() {
  swapDialog.value = true
}

function closeSwapDialog() {
  swapDialog.value = false
}

function closeChangeLogDialog() {
  changeLog.enabled = false
  if (Object.keys(vmProxy.$route.query)?.length > 0) {
    vmProxy.$router.replace({ query: null })
  }
}
function closeDialog() {
  currentDialog.value = null
}


// Lifecycle
onMounted(async () => {
  if (store.loggedWallet?.id) {
    try {
      await login(store.loggedWallet.id)
    } catch (err) {
      console.error(err)
    }
  }
  Loading.setLoading(false)
})
</script>

<style>
/* Cardano Background - Confined to dashboard working area */
.cardano-background-dashboard {
  position: absolute;
  top: -50%;
  left: 50%;
  width: 100vw;
  height: 100vh;
  z-index: -1; /* Behind dashboard content */
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transform: translateX(-50%) scaleY(-0.7) scaleX(-1.2); /* Center horizontally, flip vertically and squeeze 20%, flip horizontally and stretch 20% */
  pointer-events: none; /* Allow clicks through */
  filter: brightness(0.4);
}

/* Ensure v-app has pure black background outside working area */
.v-application {
  background: #000000 !important;
  background-color: #000000 !important;
  position: relative;
  z-index: 1;
}

/* Override any Vuetify theme variables */
body {
  background-color: #000000 !important;
  background: #000000 !important;
}

html {
  background-color: #000000 !important;
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
  0%, 100% {
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
  box-shadow: 
    0 8px 32px rgba(0, 199, 243, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    inset 0 -1px 0 rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.epoch-progress-liquid-glass .v-progress-linear__background {
  background: transparent !important;
}

.epoch-progress-liquid-glass .v-progress-linear__determinate {
  background: linear-gradient(90deg, 
    rgba(0, 199, 243, 0.8) 0%, 
    rgba(0, 199, 243, 1) 50%, 
    rgba(0, 199, 243, 0.8) 100%) !important;
  backdrop-filter: blur(10px);
  box-shadow: 
    0 0 20px rgba(0, 199, 243, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.network-tooltip {
  padding: 8px 12px !important;
  border-radius: 8px !important;
  background-color: rgba(20, 20, 20, 0.95) !important;
  border: 1px solid rgba(0, 199, 243, 0.3) !important;
  backdrop-filter: blur(8px) !important;
}

.network-tooltip-content {
  line-height: 1.3;
}

.network-tooltip-content div {
  margin-bottom: 2px;
}

.network-tooltip-content div:last-child {
  margin-bottom: 0;
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

</style>
