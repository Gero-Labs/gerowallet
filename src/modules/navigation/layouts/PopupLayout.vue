<template>
  <v-app :class="'dapp-host '+ $route.meta.style" id="inspire" style="background-size: cover; background: linear-gradient(0deg, rgba(0, 0, 0, 0.90), rgba(0, 0, 0, 0.90)), url(@/assets/bg-dapp.png) center no-repeat;">
    <v-main class="d-flex flex-column align-content-space-between pa-0">
      <router-view></router-view>
    </v-main>
  </v-app>
</template>
<script setup lang="ts">
import { onMounted, toRefs } from 'vue';
import LoadingState from '@/plugins/loading';
import { walletStore } from '@/plugins/walletStore';

const { loggedWallet } = toRefs(walletStore);

onMounted(async () => {
  if (loggedWallet.value?.id) {
    await store.simpleLogin(loggedWallet.value.id);
  }
  LoadingState.setLoading(false);
});
</script>

<style>
.dapp-host {
  box-sizing: border-box;

  background-size: cover;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.90), rgba(0, 0, 0, 0.90)), url(@/assets/bg-dapp.png) center no-repeat!important;
}
.info {
  -webkit-box-shadow:inset 0 0 0 2px #00dff3;
  -moz-box-shadow:inset 0 0 0 2px #00dff3;
  box-shadow:inset 0 0 0 2px #00dff3;
}

.warning {
  -webkit-box-shadow:inset 0 0 0 2px #ff8e8e;
  -moz-box-shadow:inset 0 0 0 2px #ff8e8e;
  box-shadow:inset 0 0 0 2px #ff8e8e;
}
.check .v-label {
  color: white!important;
}
</style>
