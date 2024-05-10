<template>
  <v-app>
    <v-main>
      <v-container class="pa-0" style="background-color: #141414">
        <v-layout :align-start="true">
          <navigation-drawer></navigation-drawer>
          <v-sheet style="height: 100vh; overflow-y: auto; background-color: #121212;">
            <v-layout row class="no-gutters px-4 transparent" :justify-start="true">
              <v-app-bar flat class="transparent" color="transparent">
                <price-ticker></price-ticker>
                <v-divider vertical class="mx-2" style="max-height: 30px;min-height: 30px;align-self: center;border-color: #00DFF3;"></v-divider>
                <span style="font-size: 14px">{{'Epoch ' + tip.epoch}}</span>
                <v-progress-linear
                    striped
                    :value="epochSlotPercentage"
                    height="20"
                    rounded
                    style="width: 100px"
                    class="ml-2"

                >
                  <template v-slot:default="{ value }">
                    <strong style="font-size: 10px">{{ Math.ceil(value) }}%</strong>
                  </template>
                </v-progress-linear>
                <v-spacer></v-spacer>
                <v-btn icon class="ml-2">
                  <v-avatar size="20">
                    <img
                        :src="require('@/assets/svg/bell-03.svg')"
                        alt="Notifications"
                    >
                  </v-avatar>
                </v-btn>
                <v-btn icon class="">
                  <v-avatar size="20">
                    <img
                        :src="require('@/assets/svg/eye.svg')"
                        alt="Notifications"
                    >
                  </v-avatar>
                </v-btn>
                <v-btn icon class="">
                  <v-avatar size="20">
                    <img
                        :src="require('@/assets/svg/life-buoy-01.svg')"
                        alt="Notifications"
                    >
                  </v-avatar>
                </v-btn>
                <v-btn icon class="">
                  <v-avatar size="20">
                    <img
                        :src="require('@/assets/svg/settings-02.svg')"
                        alt="Notifications"
                    >
                  </v-avatar>
                </v-btn>
              </v-app-bar>
              <v-sheet class="transparent">
                <keep-alive>
                  <router-view></router-view>
                </keep-alive>
              </v-sheet>
            </v-layout>
          </v-sheet>
        </v-layout>
      </v-container>
    </v-main>
  </v-app>
</template>

<script>
import NavigationDrawer from "../components/NavigationDrawer.vue";
import {mapState} from "pinia";
import {useStore} from "@/store";
import socket from "@/plugins/socket";
import {Blockchain, Network} from "@/models/types";
import PriceTicker from "@/modules/navigation/components/PriceTicker.vue";

export default {
  name: 'ContentLayout',
  components: {PriceTicker, NavigationDrawer},
  computed: {
    ...mapState(useStore, ['loggedWallet', 'tip']),
    epochSlotPercentage() {
      return this.tip.epoch_slot / 432000 * 100
    },
    account() {
      return this.store.getWallet.wallet
    },
  },
  data: () => ({
    store: useStore(),
  }),
  async mounted() {
    const tip = await useStore().getWallet.provider.getTip()
    useStore().setTip(tip)
    console.log(tip)
    console.log('mount')
    const wallet = useStore().getWallet.wallet
    const accountInfo = await useStore().getWallet.provider.getAccountInfo(wallet.chain,wallet.network, wallet.stakeAddress().to_address().to_bech32())
    console.log(accountInfo)
    socket.setAddress(wallet.stakeAddress().to_address().to_bech32())
    socket.stompConnect(
        Object.keys(Blockchain).find(key => Blockchain[key] === useStore().getWallet.wallet.chain),
        Object.keys(Network).find(key => Network[key] === useStore().getWallet.wallet.network),
    )
  }
}
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
