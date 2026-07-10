<template>
  <PopupHeader :title="t('walletConnect.sessionProposal')" ref="popupHeader">
    <v-card-text class="d-flex flex-column pa-0 fill-height">
      <!-- DApp info -->
      <div class="d-flex align-center justify-center flex-column py-3">
        <v-avatar size="48" v-if="peerIcon">
          <v-img :src="peerIcon" contain />
        </v-avatar>
        <v-icon v-else size="48" color="primary">mdi-link-variant</v-icon>
        <div class="text-h6 white--text mt-2">{{ peerName }}</div>
        <div class="caption grey--text">{{ peerUrl }}</div>
      </div>

      <v-divider class="mx-4" />

      <!-- Requested chains -->
      <div class="px-4 py-2">
        <div class="caption grey--text mb-1">{{ $t('walletConnect.requestedChains') }}</div>
        <v-chip
          v-for="chain in requestedChainNames"
          :key="chain"
          small
          outlined
          color="primary"
          class="mr-1 mb-1"
        >
          {{ chain }}
        </v-chip>
        <div v-if="hasUnsupportedChains" class="caption error--text mt-1">
          {{ $t('walletConnect.unsupportedChain') }}
        </div>
      </div>

      <!-- Consent -->
      <div class="px-4 py-2">
        <v-checkbox
          class="mt-0"
          color="#00DFF3"
          v-model="consent"
          hide-details
          :label="$t('navigation.viewAddressAndBalance')"
        />
      </div>
    </v-card-text>

    <v-card-actions class="justify-center py-2 px-4">
      <v-row>
        <v-col cols="6">
          <v-btn block outlined color="error" style="text-transform: capitalize;" @click="reject">
            {{ $t('walletConnect.reject') }}
          </v-btn>
        </v-col>
        <v-col cols="6">
          <v-btn block class="geroButton" style="color: black!important;" :disabled="!consent || hasUnsupportedChains" @click="approve" :loading="loading">
            {{ $t('walletConnect.approve') }}
          </v-btn>
        </v-col>
      </v-row>
    </v-card-actions>
  </PopupHeader>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, onMounted, ref, toRefs, getCurrentInstance } from 'vue';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { Messaging } from '@/chrome/messaging';
import { walletStore } from '@/stores/walletStore';
import { resolveGeroChain } from '@/services/walletConnect/chainUtils';

const { t } = useTranslation();
const vmProxy = getCurrentInstance()!.proxy as any;

const { config } = toRefs(walletStore);

const consent = ref(false);
const loading = ref(false);
const controller = ref<any>(null);
const proposalData = ref<any>(null);

const peerName = computed(() => proposalData.value?.proposer?.metadata?.name || 'Unknown dApp');
const peerUrl = computed(() => proposalData.value?.proposer?.metadata?.url || '');
const peerIcon = computed(() => proposalData.value?.proposer?.metadata?.icons?.[0] || '');

const requestedChains = computed(() => {
  if (!proposalData.value) return [];
  const chains: string[] = [];
  const ns = { ...proposalData.value.requiredNamespaces, ...proposalData.value.optionalNamespaces };
  for (const namespace of Object.values(ns) as any[]) {
    if (namespace.chains) chains.push(...namespace.chains);
  }
  return [...new Set(chains)];
});

const requestedChainNames = computed(() => {
  return requestedChains.value.map(c => {
    const info = resolveGeroChain(c);
    return info ? `${info.chain} ${info.network}` : c;
  });
});

const hasUnsupportedChains = computed(() => {
  return requestedChains.value.some(c => !resolveGeroChain(c));
});

const reject = async () => {
  try {
    await controller.value.returnData({ data: { approved: false } });
  } catch (e) {
    console.warn('[WCSessionProposal] returnData failed on reject:', e);
  }
  window.close();
};

const approve = async () => {
  loading.value = true;
  try {
    await controller.value.returnData({ data: { approved: true, proposalId: proposalData.value?.id } });
  } catch (e) {
    console.warn('[WCSessionProposal] returnData failed on approve:', e);
  }
  window.close();
};

onMounted(async () => {
  const useSidePanel = config.value?.useSidePanel || false;
  if (useSidePanel) {
    const params = new URLSearchParams(window.location.href);
    const tabId = Number(params.get('tabId'));
    controller.value = Messaging.createInternalSidePanelController(tabId);
  } else {
    controller.value = Messaging.createInternalController();
  }

  // Get proposal data from background
  try {
    const data = await controller.value.requestData();
    proposalData.value = data?.data || data;
  } catch (e) {
    console.error('[WCSessionProposal] Failed to get proposal data:', e);
  }
});
</script>
