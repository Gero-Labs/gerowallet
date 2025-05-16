<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Deal Details" subtitle="" :min-height="600" :height="620" :width="500">
    <v-card-title class="pa-0">
      <v-list-item v-if="retailer" class="px-0">
        <v-list-item-avatar :color="retailer.backgroundColor ? retailer.backgroundColor : '#fff'" size="60" v-if="retailer.img">
          <v-img :src="retailer.img" contain style="margin: auto;" eager></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title style="word-break: break-word; font-size: 24px">
            {{retailer.section ?  (retailer.name + " > " + retailer.section) : retailer.name}}
          </v-list-item-title>
          <v-list-item-subtitle class="pa-0" style="word-break: break-word; color: #00DFF3">
            Up to {{ retailer.maxCashback.toFixed(0) }}{{retailer.cashbackSymbol}} Cashback
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </v-card-title>
    <v-card-title class="px-1 pt-0 pb-2" style="font-size: 14px">
      Cashback Terms & Exclusions
    </v-card-title>
    <v-card-text class="px-4 pt-2 pb-0 cashbackTerms" style="z-index: 1; border-radius: 10px; background-color: #0f0f0f">
      <div v-if="loading" style="width: 100%; height: 100%; align-content: center" class="text-center" >
        <v-progress-circular color="primary" size="80" width="8" indeterminate ></v-progress-circular>
        <div class="pt-4">Loading ...</div>
      </div>
      <VueShowdown v-else :markdown="fileContent" flavor="vanilla" :options="{ emoji: true }"/>
    </v-card-text>
    <v-card-actions class="px-0 pt-4 justify-center text-center" style="flex-direction: column;">
      <v-btn
        :loading="loading || !retailerUrl"
        class="geroButton"
        :disabled="disabled || !retailerUrl"
        style="color: black!important;"
        @click="startShopping()"
      >Start Shopping</v-btn>
      <v-card-subtitle class="pa-0 pt-3">By clicking Start Shopping, I accept the terms above.</v-card-subtitle>
    </v-card-actions>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import axios from 'axios';
import { useStore } from '@/stores';
import { mapState } from 'pinia';
import networks from '@/utils/networks';
import cashbackApi from '@/api/cashback-api';

export default {
  name: 'RetailerDialog',
  components: {BaseDialog },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    retailer: {
      type: Object
    },
    retailerTermsBasePath: {
      type: String,
      default: 'https://media.bringweb3.io/cashback-terms'
    },
    searchTerm: {
      type: String,
    }
  },
  filters,
  computed: {
    ...mapState(useStore, ['baseAddress', 'loggedWallet']),
  },
  methods: {
    startShopping() {
      if (this.retailerUrl) {
        window.open(this.retailerUrl, '_blank');
        cashbackApi.analytics(this.retailer.id, this.retailer.name, this.baseAddress, networks.resolveCurrencySymbol(this.loggedWallet?.chain, this.loggedWallet?.network), this.searchTerm);
      }
    },
    async getContent() {
      this.fileContent = "";
      try {
        const response = await axios.get(this.retailerTermsBasePath+this.retailer?.termsPath)
        this.fileContent = response.data;
        this.disabled = false
      } catch (e) {
        this.fileContent = e;
      }
    },
    async activate() {
      try {
        let search = ''
        if (this.searchTerm) {
          search = this.searchTerm
        }
        const response = await cashbackApi.activate(this.retailer.id, this.baseAddress, networks.resolveCurrencyTicker(this.loggedWallet.chain, this.loggedWallet.network), search)
        if (response.status) {
          this.retailerUrl = response.url
        } else {
          this.retailerUrl = ""
        }
      } catch (e) {
        console.log(e)
      }
    },
  },
  data: () => ({
    retailerUrl: null,
    fileContent: null,
    loading: true,
    disabled: true,
  }),
  mounted() {

  },
  watch: {
    isOpen(val) {
      if (val) {
        this.retailerUrl = null
        this.loading = true
        this.default = true
        const promises = []
        promises.push(this.getContent());
        promises.push(this.activate());
        Promise.all(promises)
        this.loading = false
      }
    }
  },
};
</script>
<style scoped>

.card-text {
  width: 100%;
  padding: 24px;
  background: linear-gradient(90deg, rgb(0, 14, 17), rgb(0, 19, 16));
  border-radius: 12px;
  border: 1px solid #00DFF3;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

::-webkit-scrollbar {
  width: 14px;
}

::-webkit-scrollbar-thumb {
  border: 4px solid rgba(0, 0, 0, 0);
  background-clip: padding-box;
}

/* Handle on hover */
::-webkit-scrollbar-thumb:hover {
  border: 4px solid rgba(0, 0, 0, 0);
  background-clip: padding-box;
}

</style>
<style>
.cashbackTerms strong {
  color: white!important;
}
</style>
