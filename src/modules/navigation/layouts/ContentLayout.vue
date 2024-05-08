<template>
  <v-app>
    <v-main>
      <v-container class="pa-0" style="background-color: #141414">
        <v-layout :align-start="true">
          <navigation-drawer></navigation-drawer>
          <v-sheet style="height: 100vh; overflow-y: auto; background-color: #121212;">
            <v-layout row class="no-gutters px-4 transparent" :justify-start="true">
              <v-app-bar flat class="transparent" color="transparent">
                <span v-if="account">{{ account.name }}</span>
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

export default {
  name: 'ContentLayout',
  components: {NavigationDrawer},
  computed: {
    ...mapState(useStore, ['wallets', 'loggedWalletId']),
    account() {
      return this.wallets.find(wallet => wallet.walletId === this.loggedWalletId)
    },
  },
  data: () => ({
    pro: false
  })
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
