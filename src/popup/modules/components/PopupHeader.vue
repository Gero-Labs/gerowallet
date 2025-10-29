<template>
  <v-card outlined class="pa-4 d-flex flex-column justify-space-between fill-height transparent" :disabled="disabled">
    <div style="width: 52px; margin-left: auto; margin-right: auto">
      <img :alt="$t('common.geroLogo')" id="modal-logo-icon" width="52" :src="assets.geroLogo"/>
      <img :alt="$t('common.geroText')" id="modal-logo-text" width="52" :src="assets.geroText"/>
    </div>
    <v-card-title class="justify-center py-0" style="font-size: 20px; font-weight: bold; color: white">{{ title }}</v-card-title>
    <v-card-title class="justify-center py-0" style="font-size: 16px;" v-if="showWebsite">
      <span style="color: #ccc">{{ $t('navigation.websiteLabel') }}:&nbsp;</span>
      <div v-if="domain" style="display: contents;">
        <v-avatar size="16">
          <img :src="favicon" :alt="$t('common.dappWebsiteFavicon')" />
        </v-avatar>&nbsp;
        <span style="color: white">{{ domain }}</span>
        <v-progress-circular size="16" class="ml-1" indeterminate v-if="loading" color="white"
                             width="3"></v-progress-circular>
        <v-avatar v-else tile size="16" class="ml-1 text-center">
          <v-img contain :src="websiteRiskIcon" :alt="$t('common.websiteRiskIcon')" />
        </v-avatar>
      </div>
      <div v-else>
        {{ $t('navigation.notAvailable') }}
      </div>
    </v-card-title>
    <Select
      v-if="showWallet && loggedWallet"
      :value="loggedWallet"
      :items="[loggedWallet]"
      :readonly="true"
      class="py-0"
    ></Select>
    <slot />
  </v-card>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { getCurrentInstance, ref, toRefs, computed, onMounted } from 'vue';
import { DappRisk } from '@/models/cardano-shield-types';
import Select from '@/shared/components/Select.vue';
import cardanoShieldApi from '@/api/cardano-shield-api';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import filters from '@/shared/utils/filters';

defineProps({
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
  if (queryParams.value?.website) {
    return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${queryParams.value.website}&size=16`;
  }
  return '';
});

const domain = computed(() => {
  if (queryParams.value?.website) {
    const hostname = filters.extractHostname(queryParams.value?.website);
    validateDomain(hostname);
    return hostname;
  }
  return '';
});

const websiteRiskIcon = computed(() => {
  return assets.resolveDappRisk(dappRisk.value)
});

function validateDomain(s: string) {
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
    const riskString = await cardanoShieldApi.scanUrl(queryParams.value['website']);
    dappRisk.value = DappRisk[riskString as keyof typeof DappRisk] ?? DappRisk.unknown;
  } catch (e) {
    console.log(e);
  }
  loading.value = false;
})

// Expose domain property for parent components to access via refs
defineExpose({
  domain
})
</script>
<style scoped>

</style>
