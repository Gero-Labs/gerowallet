<template>
  <v-app>
    <v-main>
      <v-container class="pa-0" >
        <v-layout :align-start="true">
          <navigation-drawer ></navigation-drawer>
          <v-sheet style="height: 100vh; width: 100%; overflow-y: auto; background-color: transparent" >
            <v-layout column class="no-gutters px-4 transparent" :justify-start="true" style="min-height: calc(100vh - 90px); flex-direction: column;">
              <v-app-bar flat class="transparent" color="transparent" style="max-height: 64px;" >
                <PriceTicker></PriceTicker>
                <v-divider vertical class="mx-2" style="max-height: 30px; min-height: 30px;align-self: center;" v-if="networks.resolveNetwork(loggedWallet?.chain, loggedWallet?.network)?.blockchain === Blockchain.CARDANO"></v-divider>
                <v-progress-linear v-if="epochSlotPercentage"
                    striped
                    :value="epochSlotPercentage"
                    height="22"
                    rounded
                    style="width: 100px"
                    :buffer-value="100"
                >
                  <template v-slot:default="{ value }">
                    <v-list-item two-line>
                      <v-list-item-content class="py-0 text-center">
                        <v-list-item-title style="font-size: 10px" class="ma-0">{{'Epoch ' + latestTip?.epoch}}</v-list-item-title>
                        <v-list-item-subtitle style="font-size: 8px; color: white">{{ Math.ceil(value) }}%</v-list-item-subtitle>
                      </v-list-item-content>
                    </v-list-item>
                  </template>
                </v-progress-linear>
                <v-divider vertical class="mx-2" style="max-height: 30px;min-height: 30px;align-self: center;"></v-divider>
                <v-list-item v-if="latestTip" two-line class="px-0" style="min-height: auto; flex: unset">
                  <v-list-item-icon class="ma-0" style="align-self: center;">
                    <v-icon small class="mr-1" :color="socket.isConnected() ? '#47cd89' : '#ff6464'">
                      {{ socket.isConnected() ? 'mdi-lan-connect' : 'mdi-lan-disconnect'}}
                    </v-icon>
                  </v-list-item-icon>
                  <v-list-item-content class="my-0" style="padding:0 !important; width: 86px;">
                    <v-list-item-title style="font-size: 12px;" class="ma-0">
                      {{loggedWallet?.network}}
                    </v-list-item-title>
                    <v-list-item-subtitle style="font-size: 10px">
                      Synced {{ new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).format(new Date(latestTip?.time * 1000)) }}
                    </v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>
                <v-divider vertical class="mx-2" style="max-height: 30px;min-height: 30px;align-self: center;"></v-divider>
                <v-avatar tile size="16" class="mr-1">
                  <v-img :src="require('@/assets/svg/wallet.svg')" contain></v-img>
                </v-avatar>
                <a style="font-size: 12px; color: white" class="mr-1" @click="copyAddress">{{baseAddress | shortenStringWithEllipsis(14)}}</a>
                <CopyButton ref="copyAddress" x-small :value="baseAddress" v-if="baseAddress"></CopyButton>
                <v-spacer></v-spacer>
                <QuickActionsBox />
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
                <v-btn @click="currentDialog = dialogs.SETTINGS" icon class="">
                  <v-avatar size="20">
                    <img
                        :src="require('@/assets/svg/settings-02.svg')"
                        alt="Settings"
                    >
                  </v-avatar>
                </v-btn>
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
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';
import QuickActionsBox from '@/modules/navigation/components/QuickActionsBox.vue';

export default {
  name: 'ContentLayout',
  components: { QuickActionsBox, CopyButton, Player, PriceTicker, NavigationDrawer, SettingsDialog},
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
    ...mapState(useStore, ['loggedWallet', "latestTip", 'loadingTxs', 'baseAddress']),
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
  filters,
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
    copyAddress() {
      this.$refs.copyAddress.copy()
    },
    closeDialog() {
      this.currentDialog = null;
    },
  },
  async mounted() {
    if (this.loggedWallet?.id) {
      try {
        await this.login(this.loggedWallet.id)
      } catch (e) {
        console.error(e)
      }
    }
    this.loading.setLoading(false)
  }
};
</script>
<style scoped>
div.v-toolbar__content {
  padding-right: 8px!important;
  padding-left: 8px!important;
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
