<template>
  <v-card outlined class="pa-4 d-flex flex-column justify-space-between fill-height transparent" :disabled="disabled">
    <div style="width: 52px; margin-left: auto; margin-right: auto">
      <img alt="Gero Logo" id="modal-logo-icon" width="52" :src="require('@/assets/svg/gero-logo.svg')"/>
      <img alt="Gero Logo" id="modal-logo-text" width="52" :src="require('@/assets/svg/gero-text.svg')"/>
    </div>
    <v-card-title class="justify-center py-0" style="font-size: 20px; font-weight: bold; color: white">{{ title }}</v-card-title>
    <v-card-title class="justify-center py-0" style="font-size: 16px;" v-if="showWebsite">
      <span style="color: #ccc">Website:&nbsp;</span>
      <div v-if="domain" style="display: contents;">
        <v-avatar size="16">
          <img :src="favicon" alt="Dapp Website favicon" />
        </v-avatar>&nbsp;
        <span style="color: white">{{ domain }}</span>
        <v-progress-circular size="16" class="ml-1" indeterminate v-if="loading" color="white"
                             width="3"></v-progress-circular>
        <v-avatar v-else tile size="16" class="ml-1">
          <img :src="websiteRiskIcon" alt="Website Risk Icon" />
        </v-avatar>
      </div>
      <div v-else>
        N/A
      </div>
    </v-card-title>
    <Select
      v-if="showWallet"
      :value="loggedWallet"
      :items="[loggedWallet]"
      :readonly="true"
      class="py-0"
    ></Select>
    <slot />
  </v-card>
</template>
<script>
import { DappRisk } from '@/models/tx-scan';
import Select from '@/shared/components/Select.vue';
import { useStore } from '@/store';
import { mapState } from 'pinia';
import cardanoShieldApi from '@/api/cardano-shield-api';

export default{
  name: 'PopupHeader',
  components: { Select },
  props: {
    title: {
      type: String,
      default: '',
    },
    showWebsite: {
      type: Boolean,
      default: true
    },
    showWallet: {
      type: Boolean,
      default: true
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    ...mapState(useStore, ['loggedWallet']),
    favicon() {
      if (this.queryParams?.website) {
        return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${this.queryParams.website}&size=16`;
      }
      return '';
    },
    domain() {
      if (this.queryParams?.website) {
        return this.extractHostname(this.queryParams.website);
      }
      return '';
    },
    websiteRiskIcon() {
      switch (this.dappRisk) {
        case DappRisk.whitelist:
          return require('@/assets/img/cardano-shield/dapp-safe.png');
        case DappRisk.blacklist:
          return require('@/assets/img/cardano-shield/dapp-phishing.png');
        case DappRisk.suspicious:
          return require('@/assets/img/cardano-shield/dapp-suspicious.png');
        case DappRisk.timeout:
          return require('@/assets/img/cardano-shield/dapp-timeout.png');
        case DappRisk.unknown:
        default:
          return require('@/assets/img/cardano-shield/dapp-unknown.png');
      }
    },
  },
  methods: {
    extractHostname(url) {
      let hostname;
      //find & remove protocol (http, ftp, etc.) and get hostname

      if (url.indexOf('//') > -1) {
        hostname = url.split('/')[2];
      } else {
        hostname = url.split('/')[0];
      }

      //find & remove port number
      hostname = hostname.split(':')[0];
      //find & remove "?"
      hostname = hostname.split('?')[0];

      this.validateDomain(hostname);
      return hostname;
    },
    validateDomain(s) {
      try {
        new URL('https://' + s);
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    },
  },
  data: () => ({
    loading: true,
    dappRisk: DappRisk.unknown,
  }),
  async created() {
    this.queryParams = this.$route.query;
    const api = cardanoShieldApi
    try {
      this.dappRisk = DappRisk[await api.scanUrl(this.queryParams['website'])];
    } catch (e) {
      console.log(e);
    }
    this.loading = false;
  }
}
</script>
<style scoped>

</style>
