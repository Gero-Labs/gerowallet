<template>
  <v-app>
    <v-main>
      <v-container class="pa-0">
        <v-layout :align-start="true">
          <NavigationDrawer v-model="drawer" />
          <v-sheet
            style="height: 100vh; width: 100%; overflow-y: auto; background-color: transparent"
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
              style="min-height: calc(100vh - 90px); flex-direction: column;"
            >
              <v-app-bar flat class="transparent" color="transparent" style="max-height: 64px;">
                <v-app-bar-nav-icon
                  v-if="$vuetify.breakpoint.mobile"
                  @click.stop="drawer = !drawer"
                />

                <PriceTicker />

                <Sparkline v-if="loggedWallet?.chain === Blockchain.CARDANO" />
                <v-divider
                  vertical
                  class="mx-1"
                  style="max-height: 30px; min-height: 30px; align-self: center;"
                  v-if="loggedWallet?.chain === Blockchain.CARDANO"
                />

                <v-progress-linear
                  v-if="epochSlotPercentage"
                  striped
                  :value="epochSlotPercentage"
                  height="22"
                  rounded
                  style="width: 100px; min-width: 50px;"
                  :buffer-value="100"
                >
                  <template v-slot:default="{ value }">
                    <v-list-item two-line>
                      <v-list-item-content class="py-0 text-center">
                        <v-list-item-title class="ma-0" style="font-size: 10px">
                          {{ 'Epoch ' + tip.epoch }}
                        </v-list-item-title>
                        <v-list-item-subtitle class="ma-0" style="font-size: 8px; color: white">
                          {{ Math.ceil(value) }}%
                        </v-list-item-subtitle>
                      </v-list-item-content>
                    </v-list-item>
                  </template>
                </v-progress-linear>

                <v-divider
                  vertical
                  class="mx-1"
                  style="max-height: 30px; min-height: 30px; align-self: center;"
                />

                <v-list-item
                  v-if="tip"
                  two-line
                  class="px-0"
                  style="min-height: auto; flex: unset"
                >
                  <v-list-item-icon class="ma-0" style="align-self: center;">
                    <v-icon
                      small
                      :color="connected ? '#47cd89' : '#ff6464'"
                    >
                      {{ connected ? 'mdi-lan-connect' : 'mdi-lan-disconnect' }}
                    </v-icon>
                  </v-list-item-icon>

                  <v-list-item-content class="my-0" style="padding:0 !important; display: flow;">
                    <v-list-item-title class="ma-0" style="font-size: 12px;">
                      {{ loggedWallet?.network }}
                      <v-btn x-small icon class="mx-0" :loading="isSyncing && connected" disabled>
                        <v-avatar size="20">
                          <v-icon x-small>mdi-sync</v-icon>
                        </v-avatar>

                        <template v-slot:loader>
                          <span class="custom-loader">
                            <v-icon x-small>mdi-sync</v-icon>
                          </span>
                        </template>
                      </v-btn>
                    </v-list-item-title>

                    <v-list-item-subtitle style="font-size: 10px">
                      <v-tooltip bottom content-class="smallToolTip">
                        <template v-slot:activator="{ on, attrs }">
                          <span v-bind="attrs" v-on="on">
                            {{ time.format(new Date(tip.time)) }}
                          </span>
                        </template>

                        <span>
                          {{ new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(tip.time)) }}
                        </span>
                      </v-tooltip>
                    </v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>

                <v-divider
                  vertical
                  class="mx-1"
                  style="max-height: 30px; min-height: 30px; align-self: center;"
                />

                <CopyButton
                  ref="copyAddress"
                  x-small
                  :avatar="assets.googleSvg"
                  :title="loggedWallet?.userId"
                  :value="loggedWallet?.userId"
                  v-if="loggedWallet?.userId"
                />

                <CopyButton
                  ref="copyAddress"
                  x-small
                  :avatar="assets.walletSvg"
                  :title="filters.shortenStringWithEllipsis(loggedWallet?.baseAddress, 14)"
                  :value="loggedWallet?.baseAddress"
                  v-else-if="loggedWallet?.baseAddress"
                />

                <v-spacer />

                <QuickActionsBox />

                <v-btn
                  class="ml-2"
                  small
                  icon
                  text
                  :plain="!context.shown"
                  v-if="musicPlaylist?.length > 0"
                  @click="handleMusicPlayerToggle"
                >
                  <v-icon>
                    mdi-play-box-outline
                  </v-icon>
                </v-btn>
                <v-menu offset-y :close-on-content-click="false">
                  <template v-slot:activator="{ on, attrs }">
                    <v-btn class="ml-2" small icon v-bind="attrs" v-on="on">
                      <v-icon>mdi-bell-outline</v-icon>
                    </v-btn>
                  </template>
                  <v-card outlined rounded min-width="250">
                    <v-card-title class="pa-2">
                      Notifications
                      <v-spacer></v-spacer>
                      <v-btn small icon>
                        <v-icon>
                          mdi-dots-horizontal
                        </v-icon>
                      </v-btn>
                    </v-card-title>
                    <v-card-text class="pa-0">
                      <v-list class="transparent">
                        <v-list-item>
                          <v-list-item-content>
                            <v-list-item-title class="text-center" style="color: #CCC;">
                              <v-avatar size="30" color="#333" class="mr-2">
                                <v-icon small color="#CCC">
                                  mdi-message-text-outline
                                </v-icon>
                              </v-avatar>
                              Nothing New
                            </v-list-item-title>
                          </v-list-item-content>
                        </v-list-item>
                      </v-list>
                    </v-card-text>
                  </v-card>
                </v-menu>
                <v-btn small class="ml-2" @click="currentDialog = dialogs.SETTINGS" icon>
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
      :isOpen="!isWelcomeDone"
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
  </v-app>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, getCurrentInstance } from 'vue';
import NavigationDrawer from '../components/NavigationDrawer.vue'
import PriceTicker from '@/modules/navigation/components/PriceTicker.vue'
import SettingsDialog from '@/modules/dashboard/dialogs/SettingsDialog.vue'
import Player from '@/modules/media-player/Player.vue'
import QuickActionsBox from '@/modules/navigation/components/QuickActionsBox.vue'
import CopyButton from '@/shared/components/CopyButton.vue'
import WelcomeDialog from '@/shared/dialogs/WelcomeDialog.vue'
import Sparkline from '@/modules/navigation/components/Sparkline.vue'
import ChangeLogDialog from '@/options/modules/navigation/dialogs/ChangeLogDialog.vue'
import BackupWalletDialog from '@/modules/navigation/dialogs/BackupWalletDialog.vue'
import { Blockchain } from '@/models/types';
import filters from '@/shared/utils/filters'
import assets from '@/utils/assets'
import { loadingState } from '@/stores/loading'
import changeLogPlugin from '@/plugins/changeLog'
import timePlugin from '@/plugins/time'
import WalletStore, { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { setConfiguration } from '@/db/gero-db';
import { geroStore } from '@/stores/geroStore';
import MusicStore, { musicStore } from '@/stores/musicStore';

const isBeta = ref<boolean>(import.meta.env['VITE_IS_BETA'] === 'true');
const vmProxy = getCurrentInstance()!.proxy as any
const currentPage = computed(() => vmProxy.$route)
const { isSyncing, connected } = toRefs(loadingState);
const { loggedWallet, config } = toRefs(walletStore);
const { config: geroConfig } = toRefs(geroStore);
const { tip } = toRefs(networkStore);
const { musicPlaylist, context } = toRefs(musicStore)

const drawer = ref<boolean>(false)
const currentDialog  = ref<string|null>(null)
const dialogs = { SETTINGS: 'SETTINGS' }
const backupWalletDialog = ref(false)

const handleMusicPlayerToggle = () => {
  // Check if we're currently on the music/media player page
  if (currentPage.value?.name === 'MediaPlayer' || currentPage.value?.path === '/media-player') {
    // Do nothing if already on music page
    return;
  }
  
  // Otherwise toggle the media player visibility
  MusicStore.setMediaPlayerShown(!context.value.shown);
}
const time = timePlugin
const changeLog  = changeLogPlugin
const shouldBackup = computed(() => WalletStore.hasBackup() && !WalletStore.getBackup())
const epochSlotPercentage = computed(() => {
  return tip.value ? (tip.value.epoch_slot / 432000) * 100 : 0
})

const isWelcomeDone = computed({
  get() {
    return !!geroConfig.value?.welcomeDone
  },
  set(val) {
    setConfiguration('welcomeDone', val)
  }
})

function closeWelcomeDialog() {
  isWelcomeDone.value = true
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
</script>

<style scoped>
div.v-toolbar__content {
  padding-right: 8px !important;
  padding-left: 8px !important;
}

.custom-loader {
  animation: loader 1s infinite;
  display: flex;
}

@keyframes loader {
  from { transform: rotate(0); }
  to   { transform: rotate(-360deg); }
}

.v-dialog__content--active {
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}
</style>
