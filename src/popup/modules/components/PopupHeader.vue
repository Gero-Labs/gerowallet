<template>
  <v-card variant="outlined" class="pa-4 d-flex flex-column justify-space-between fill-height transparent" :disabled="disabled">
    <v-card-title class="justify-center text-center py-0" style="font-size: 20px; font-weight: bold; color: white; word-break: break-word">{{ title }}</v-card-title>
    <v-card-title class="justify-center py-0" style="font-size: 16px;" v-if="showWebsite">
      <span style="color: #ccc">{{ $t('navigation.websiteLabel') }}:&nbsp;</span>
      <div v-if="domain" style="display: contents;">
        <v-avatar size="16">
          <img :src="favicon" :alt="t('common.dappWebsiteFavicon')" @error="faviconFailed = true" />
        </v-avatar>&nbsp;
        <span style="color: white">{{ domain }}</span>
        <v-progress-circular size="16" class="ml-1" indeterminate v-if="loading" color="white" width="3" />
        <v-avatar v-else rounded="0" size="16" class="ml-1 text-center">
          <v-img  :src="websiteRiskIcon" :alt="$t('common.websiteRiskIcon')" />
        </v-avatar>
      </div>
      <div v-else>
        {{ $t('navigation.notAvailable') }}
      </div>
    </v-card-title>
    <!-- WalletConnect approvals: the website above is the peer's own claim. -->
    <WcVerifyNotice v-if="showWebsite" :verification="wcVerification" class="mx-auto mt-1" />
    <Select
      v-if="showWallet && loggedWallet"
      :model-value="loggedWallet"
      :items="[loggedWallet]"
      :readonly="true"
      class="py-0"
    ></Select>
    <slot />
  </v-card>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, toRefs, computed, onMounted } from 'vue';
import { DappRisk } from '@/models/cardano-shield-types';
import Select from '@/shared/components/Select.vue';
import cardanoShieldApi from '@/api/cardano-shield-api';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import filters from '@/shared/utils/filters';
import { useRoute } from 'vue-router';
import WcVerifyNotice from '@/shared/components/WcVerifyNotice.vue';
import { readWcVerification, wcRiskUrl } from '@/services/walletConnect/verifyContext';

const { t } = useTranslation();

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

const route = useRoute();

const faviconFailed = ref<boolean>(false);

const favicon = computed(() => {
  // Prefer the real favicon Chrome already loaded for the dApp tab.
  if (queryParams.value?.favIconUrl && !faviconFailed.value) {
    return queryParams.value.favIconUrl;
  }
  // Fallback: Google favicon service by domain.
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

// Set by the background on WalletConnect approvals (`wc`, `wcOrigin` query params).
const wcVerification = computed(() => {
  const state = route.query['wc'];
  const origin = route.query['wcOrigin'];
  return readWcVerification({ state, origin: typeof origin === 'string' ? origin : undefined });
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

  queryParams.value = { website: typeof route.query['website'] === 'string' ? route.query['website'] : '', favIconUrl: typeof route.query['favIconUrl'] === 'string' ? route.query['favIconUrl'] : '' };
  try {
    // A WalletConnect peer's attested origin, not just the domain it claims.
    const riskString = await cardanoShieldApi.scanUrl(wcRiskUrl(queryParams.value['website'], wcVerification.value));
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
