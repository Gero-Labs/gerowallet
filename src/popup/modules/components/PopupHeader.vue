<template>
  <v-card outlined class="pa-4 d-flex flex-column justify-space-between fill-height transparent" :disabled="disabled">
    <div style="width: 52px; margin-left: auto; margin-right: auto">
      <img alt="Gero Logo" id="modal-logo-icon" width="52" :src="assets.geroLogo"/>
      <img alt="Gero Text" id="modal-logo-text" width="52" :src="assets.geroText"/>
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
<script setup lang="ts">
import { getCurrentInstance, ref, toRefs, computed, onMounted } from 'vue';
import { DappRisk } from '@/models/cardano-shield-types';
import Select from '@/shared/components/Select.vue';
import cardanoShieldApi from '@/api/cardano-shield-api';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';

const props = defineProps({
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
});

const { loggedWallet } = toRefs(walletStore);
const loading = ref<boolean>(true);
const dappRisk = ref<DappRisk>(DappRisk.unknown);
const queryParams = ref(null);

const vmProxy = getCurrentInstance()!.proxy as any

const favicon = computed(() => {
  if (queryParams?.website) {
    return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${queryParams.website}&size=16`;
  }
  return '';
});

const domain = computed(() => {
  if (queryParams.value?.website) {
    return extractHostname(queryParams.value?.website);
  }
  return '';
});

const websiteRiskIcon = computed(() => {
  return assets.resolveDappRisk(dappRisk.value)
});

function extractHostname(url) {
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
}

function validateDomain(s) {
  try {
    new URL('https://' + s);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

onMounted(async () => {
  const route = vmProxy.$route;
  queryParams.value = route.query;
  try {
    dappRisk.value = DappRisk[await cardanoShieldApi.scanUrl(queryParams.value['website'])];
  } catch (e) {
    console.log(e);
  }
  loading.value = false;
})
</script>
<style scoped>

</style>
