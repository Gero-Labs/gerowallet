<template>
  <v-app class="dapp-host" id="inspire" style="background-size: cover; background: linear-gradient(0deg, rgba(0, 0, 0, 0.90), rgba(0, 0, 0, 0.90)), url(@/assets/bg-dapp.png) center no-repeat;">
    <v-main class="d-flex flex-column align-content-space-between pa-0">
      <router-view></router-view>
    </v-main>
  </v-app>
</template>

<script>
import LanguageSelector from "../components/LanguageSelector.vue";
import PrivacyPolicyDialog from "../dialogs/PrivacyPolicyDialog.vue";
import NetworkSelector from "../components/NetworkSelector.vue";
import Select from "@/shared/components/Select.vue";

export default {
  name: 'PopupLayout',
  methods: {
    privacyPolicyDialogChange(value) {
      this.privacyPolicyDialog = value
    }
  },
  data: () => ({
    privacyPolicyDialog: false
  }),
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
