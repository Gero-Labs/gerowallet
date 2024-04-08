<template>
  <v-app>
    <v-main >
      <v-container class="py-0" style="background-color: #141414">
      <v-layout :align-start="true">
      <navigation-drawer></navigation-drawer>
        <v-layout row class="no-gutters" :justify-start="true">
          <v-app-bar flat>
            Best Wallet 1
            <v-spacer></v-spacer>
            <p :class="pro ? 'mr-5 my-auto' : 'font-weight-bold mr-5 my-auto'">Lite</p>
            <v-switch
                inset
                dense
                v-model="pro"
                value="error"
                color="#2f9cac"
                hide-details
            ></v-switch>
            <p :class="pro? 'font-weight-bold my-auto' : 'my-auto'">Pro</p>
            <v-btn icon class="ml-2">
              <v-icon >
                mdi-bell-outline
              </v-icon>
            </v-btn>
            <v-btn icon class="">
              <v-icon >
                mdi-eye-outline
              </v-icon>
            </v-btn>
            <v-btn icon class="">
              <v-icon >
                mdi-lifebuoy
              </v-icon>
            </v-btn>
            <v-btn icon class="">
              <v-icon >
                mdi-cog-outline
              </v-icon>
            </v-btn>
          </v-app-bar>
          <v-sheet class="transparent">
            <router-view></router-view>
          </v-sheet>
        </v-layout>
      </v-layout>
      </v-container>
    </v-main>
  </v-app>
</template>

<script>
import NavigationDrawer from "@/components/NavigationDrawer.vue";

export default {
  name: 'ContentLayout',
  components: {NavigationDrawer},
  data: () => ({
    pro: false
  })
}
</script>

<style>
.theme--dark.v-input--switch.v-input--is-label-active .v-input--switch__track {
  color: #00c7f3!important;
  opacity: 0.9;
}
.v-input--switch__thumb {
  color: #ffffff!important;
}
</style>
