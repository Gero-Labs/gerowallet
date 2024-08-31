<template>
  <v-app>
    <v-main>
      <v-container class="pa-0" style="background-color: #141414;" >
        <v-layout :align-start="true">
          <navigation-drawer ></navigation-drawer>
          <v-sheet style="height: 100vh; width: 100%; overflow-y: auto; background-color: #121212;">
            <v-layout column class="no-gutters px-4 transparent" :justify-start="true" style="min-height: calc(100vh - 90px); flex-direction: column;">
              <v-app-bar flat class="transparent" color="transparent" style="max-height: 64px">
                <PriceTicker></PriceTicker>
                <v-divider vertical class="mx-2" style="max-height: 30px;min-height: 30px;align-self: center;border-color: #00DFF3;" v-if="networks.resolveNetwork(loggedWallet?.chain, loggedWallet?.network)?.blockchain === Blockchain.CARDANO"></v-divider>
                <span style="font-size: 14px">{{'Epoch ' + latestTip?.epoch}}</span>
                <v-progress-linear v-if="epochSlotPercentage"
                    striped
                    :value="epochSlotPercentage"
                    height="20"
                    rounded
                    style="width: 100px"
                    class="ml-2"
                    :buffer-value="100"
                >
                  <template v-slot:default="{ value }">
                    <strong style="font-size: 10px">{{ Math.ceil(value) }}%</strong>
                  </template>
                </v-progress-linear>
                <v-divider vertical class="mx-2" style="max-height: 30px;min-height: 30px;align-self: center;border-color: #00DFF3;"></v-divider>
                <v-icon small :color="socket.isConnected() ? '#47cd89' : '#ff6464'">
                  {{ socket.isConnected() ? 'mdi-lan-connect' : 'mdi-lan-disconnect'}}
                </v-icon>&nbsp;
                <span style="font-size: 12px">{{loggedWallet?.network}} - Synced {{new Date(latestTip?.time * 1000).toLocaleString()}}</span>
                <v-spacer></v-spacer>
                <v-btn icon class="ml-2" :loading="loading.isSyncing" disabled>
                  <v-avatar size="20">
                    <v-icon>mdi-sync</v-icon>
                  </v-avatar>
                  <template v-slot:loader>
                    <span class="custom-loader">
                      <v-icon>mdi-sync</v-icon>
                    </span>
                  </template>
                </v-btn>
                <v-btn icon text :plain="!context.shown" v-if="musicPlaylist?.length > 0" @click="setMediaPlayerShown(!context.shown)">
                  <v-avatar size="20" >
                    <img
                        :src="require('@/assets/svg/play-square.svg')"
                        alt="Media Player"
                        style="filter: invert(98%) sepia(44%) saturate(0%) hue-rotate(18deg) brightness(103%) contrast(103%);"
                    >
                  </v-avatar>
                </v-btn>
<!--                <v-btn icon class="ml-2">-->
<!--                  <v-avatar size="20">-->
<!--                    <img-->
<!--                        :src="require('@/assets/svg/bell-03.svg')"-->
<!--                        alt="Notifications"-->
<!--                    >-->
<!--                  </v-avatar>-->
<!--                </v-btn>-->
<!--                <v-btn icon class="">-->
<!--                  <v-avatar size="20">-->
<!--                    <img-->
<!--                        :src="require('@/assets/svg/eye.svg')"-->
<!--                        alt="Notifications"-->
<!--                    >-->
<!--                  </v-avatar>-->
<!--                </v-btn>-->
<!--                <v-btn icon class="">-->
<!--                  <v-avatar size="20">-->
<!--                    <img-->
<!--                        :src="require('@/assets/svg/life-buoy-01.svg')"-->
<!--                        alt="Notifications"-->
<!--                    >-->
<!--                  </v-avatar>-->
<!--                </v-btn>-->
<!--                <v-btn @click="currentDialog = dialogs.SETTINGS" icon class="">-->
<!--                  <v-avatar size="20">-->
<!--                    <img-->
<!--                        :src="require('@/assets/svg/settings-02.svg')"-->
<!--                        alt="Notifications"-->
<!--                    >-->
<!--                  </v-avatar>-->
<!--                </v-btn>-->
              </v-app-bar>
              <SettingsDialog :isOpen="currentDialog === dialogs.SETTINGS" @close="closeDialog" />
              <v-sheet class="transparent">
                <keep-alive>
                  <router-view></router-view>
                </keep-alive>
              </v-sheet>
            </v-layout>

<!--            <v-app-bar >-->
<!--              <v-container class="pa-0">-->
<!--                <v-card height="64" style="background-color: black">-->
<!--                  Test Test Test Test Test Test Test Test Test Test Test Test-->
<!--                </v-card>-->
<!--              </v-container>-->
<!--            </v-app-bar>-->
            <Player v-if="currentPage.name !== 'mediaPlayer' && musicPlaylist?.length > 0 && context.shown" style="position: -webkit-sticky; position: sticky; bottom: 0;" />
          </v-sheet>
        </v-layout>
      </v-container>
    </v-main>
  </v-app>
</template>
<script>
import NavigationDrawer from "../components/NavigationDrawer.vue";
import {useStore} from "@/store";
import socket from "@/plugins/socket";
import PriceTicker from "@/modules/navigation/components/PriceTicker.vue";
import { mapActions, mapState } from 'pinia';
import SettingsDialog from "@/modules/dashboard/dialogs/SettingsDialog.vue";
import { Blockchain } from '@/models/types';
import networks from '@/shared/utils/networks';
import Player from '@/modules/media-player/Player.vue';
import loading from '@/plugins/loading';
import { musicStore } from '@/store/modules/music';

export default {
  name: 'ContentLayout',
  components: { Player, PriceTicker, NavigationDrawer, SettingsDialog},
  computed: {
    networks() {
      return networks
    },
    Blockchain() {
      return Blockchain
    },
    currentPage() {
      return this.$route
    },
    ...mapState(useStore, ['loggedWallet', "latestTip", 'loadingTxs']),
    ...mapState(musicStore, ['musicPlaylist', 'context']),
    epochSlotPercentage() {
      if (this.latestTip) {
        return this.latestTip.epoch_slot / 432000 * 100
      }
      return ''
    },
    loading() {
      return loading
    },
  },
  data: () => ({
    socket,
    currentDialog: null,
    dialogs: {
      SETTINGS: 'SETTINGS',
    },
  }),
  methods: {
    ...mapActions(musicStore, ['setMediaPlayerShown']),
    ...mapActions(useStore, ['login']),
    closeDialog() {
      this.currentDialog = null;
    },
  },
  async mounted() {
    if (this.loggedWallet?.id) {
      console.log('loginApp', this.loggedWallet)
      await this.login(this.loggedWallet.id)
    }
    this.loading.setLoading(false)
  }
};
</script>

<style scoped>
.theme--dark.v-input--switch.v-input--is-label-active .v-input--switch__track {
  color: #00c7f3 !important;
  opacity: 0.9;
}

.v-input--switch__thumb {
  color: #ffffff !important;
}

.custom-loader {
  animation: loader 1s infinite;
  display: flex;
}
@-moz-keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(-360deg);
  }
}
@-webkit-keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(-360deg);
  }
}
@-o-keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(-360deg);
  }
}
@keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(-360deg);
  }
}
</style>
