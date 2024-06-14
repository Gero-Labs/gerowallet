<template>
  <v-card outlined class="dapp-host pa-4 d-flex flex-column fill-height transparent">
    <div style="width: 52px; margin: auto">
      <v-img contain alt="Gero Logo" id="modal-logo-icon" width="52" :src="require('@/assets/svg/gero-logo.svg')" class="pb-4"></v-img>
      <v-img contain alt="Gero Logo" id="modal-logo-text" width="52" :src="require('@/assets/svg/gero-text.svg')"></v-img>
    </div>
    <v-card-text class="d-flex flex-column align-content-space-between pa-0 fill-height">
      <v-card-title class="justify-center pb-0" style="font-size: 20px; font-weight: bold; color: white">Connect with Gero Wallet</v-card-title>
      <v-card-title class="justify-center py-0" style="font-size: 16px;">
        <span style="color: #ccc">Website:&nbsp;</span>
        <v-avatar size="16">
          <v-img :src="favicon" contain></v-img>
        </v-avatar>&nbsp;
        <span style="color: white">{{ domain }}</span>
        <v-progress-circular size="16" class="ml-1" indeterminate v-if="loading" color="white" width="3"></v-progress-circular>
        <v-avatar v-else tile size="16" class="ml-1"><v-img :src="websiteRiskIcon" contain></v-img></v-avatar>
      </v-card-title>
      <v-card-title class="justify-center pt-0" style="color: white; font-size: 14px">
        Confirm URL before granting the access to DApps!
      </v-card-title>
      <Select
        :value="wallet"
        :items="[wallet]"
        :readonly="true"
      ></Select>
          <section style="font-weight: bold; color: white; font-size: 16px">
            Allow the site to:
          </section>
          <section style="font-size: 16px">
            <div id="dapp-consent-check">
              <v-checkbox
                class="check"
                color="#00DFF3"
                v-model="consent"
                hide-details
                label="View the address and balance of the selected wallet."
              ></v-checkbox>
              <!-- <v-checkbox dark color="primary" v-model="consent"></v-checkbox> -->
            </div>
            <div style="color: white">
              <br/>
              <p class="ml-9">For your security, any future transactions from this website will require you to enter your spending password
                before signing.</p>
            </div>
          </section>
    </v-card-text>
    <v-card-actions class="justify-center pa-2">
      <v-layout>
        <v-row>
          <v-col cols="6">
            <v-btn block outlined color="red" style="text-transform: capitalize;" @click="decline">
              Decline
            </v-btn>
          </v-col>
          <v-col cols="6">
            <v-btn block style="text-transform: capitalize; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black" :disabled="!consent" @click="confirm">
              Confirm
            </v-btn>
          </v-col>
        </v-row>
      </v-layout>
    </v-card-actions>
  </v-card>
</template>
<script>
import { useStore } from '@/store';
import {DappRisk} from "@/models/dapp-statuses";
import Select from '@/shared/components/Select.vue';
let psl = require('psl');

export default {
  name: 'dapp-connect',
  components: { Select },
  data() {
    return {
      loading: true,
      queryParams: {},
      consent: false,
      store: useStore,
      wallet: undefined,
    };
  },
  computed: {
    favicon() {
      return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${this.queryParams.website}&size=16`
    },
    domain() {
      return psl.get(this.extractHostname(this.queryParams.website))
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
    }
  },
  methods: {
    extractHostname(url) {
      let hostname;
      //find & remove protocol (http, ftp, etc.) and get hostname

      if (url.indexOf("//") > -1) {
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
        new URL("https://" + s);
        return true;
      } catch(e) {
        console.error(e);
        return false;
      }
    },
    decline() {
      window.close();
    },
    confirm() {
      this.wallet.addConnectedDapp(this.domain);
      window.close();
    },
  },
  async created() {
    this.queryParams = this.$route.query;
    this.wallet = useStore().getWallet;
    try {
      this.dappRisk = DappRisk[await this.wallet.scanUrl(this.queryParams.website)]
    } catch (e) {
      console.log(e)
    }
    this.loading = false
  },
};
</script>
