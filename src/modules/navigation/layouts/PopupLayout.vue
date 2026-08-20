<template>
  <v-app :class="'dapp-host '+ $route.meta['style']" id="inspire" style="background-size: cover; background: linear-gradient(0deg, rgba(0, 0, 0, 0.90), rgba(0, 0, 0, 0.90)), url(@/assets/bg-dapp.png) center no-repeat;">
    <v-main class="d-flex flex-column align-content-space-between pa-0">
      <router-view></router-view>
    </v-main>
  </v-app>
</template>
<style>
.dapp-host {
  box-sizing: border-box;

  background-size: cover;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.90), rgba(0, 0, 0, 0.90)), url(@/assets/bg-dapp.png) center no-repeat!important;
}
.check .v-label {
  color: white!important;
}
</style>
