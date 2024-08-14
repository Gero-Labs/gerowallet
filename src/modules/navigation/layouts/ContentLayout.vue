<template>
  <v-app>
    <v-main>
      <v-container class="pa-0" style="background-color: #141414;" >
        <v-layout :align-start="true">
          <navigation-drawer ></navigation-drawer>
          <v-sheet style="height: 100vh; width: 100%; overflow-y: auto; background-color: #121212;">
            <v-layout column class="no-gutters px-4 transparent" :justify-start="true">
              <v-app-bar flat class="transparent" color="transparent">
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
            <Player style="position: -webkit-sticky; position: sticky; bottom: 0;" />
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
import {mapState} from "pinia";
import SettingsDialog from "@/modules/dashboard/dialogs/SettingsDialog.vue";
import { Blockchain } from '@/models/types';
import networks from '@/shared/utils/networks';
import Player from '@/modules/media-player/Player.vue';

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
    ...mapState(useStore, ['loggedWallet', "latestTip"]),
    epochSlotPercentage() {
      if (this.latestTip) {
        return this.latestTip.epoch_slot / 432000 * 100
      }
      return ''
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
    closeDialog() {
      this.currentDialog = null;
    },
  },
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
</style>
