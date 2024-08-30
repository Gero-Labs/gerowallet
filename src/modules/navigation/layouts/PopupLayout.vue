<template>
  <v-app class="dapp-host" id="inspire" style="background-size: cover; background: linear-gradient(0deg, rgba(0, 0, 0, 0.90), rgba(0, 0, 0, 0.90)), url(@/assets/bg-dapp.png) center no-repeat;">
    <v-main class="d-flex flex-column align-content-space-between pa-0">
      <router-view></router-view>
    </v-main>
  </v-app>
</template>
<script>
import { mapActions } from 'pinia';
import { useStore } from '@/store';
import loading from '@/plugins/loading';

export default {
  name: 'PopupLayout',
  methods: {
    ...mapActions(useStore, 'simpleLogin')
  },
  async mounted() {
    if (this.loggedWallet?.id) {
      await this.simpleLogin(this.loggedWallet.id)
    }
    loading.setLoading(false)
  }
}
</script>

<style>
.dapp-host {
  box-sizing: border-box;
  -webkit-box-shadow:inset 0 0 0 2px #00dff3;
  -moz-box-shadow:inset 0 0 0 2px #00dff3;
  box-shadow:inset 0 0 0 2px #00dff3;
  background-size: cover;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.90), rgba(0, 0, 0, 0.90)), url(@/assets/bg-dapp.png) center no-repeat!important;
}
.check .v-label {
  color: white!important;
}
</style>
