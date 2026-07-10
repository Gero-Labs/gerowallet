<template>
  <PopupHeader :title="t('navigation.connectWithGeroDashboard')" ref="popupHeader">
    <v-card-text class="d-flex flex-column align-content-space-between pa-0 fill-height">
      <v-card-title class="justify-center text-center pt-0" style="color: white; font-size: 14px; word-break: break-word">
        {{ $t('navigation.confirmUrlBeforeGranting') }}
      </v-card-title>
          <section style="font-weight: bold; color: white; font-size: 16px">
            {{ $t('navigation.allowTheSiteTo') }}
          </section>
          <section style="font-size: 16px">
            <div id="dapp-consent-check">
              <v-checkbox
                class="check"
                color="#00DFF3"
                v-model="consent"
                hide-details
                :label="$t('navigation.viewAddressAndBalance')"
              ></v-checkbox>
            </div>
            <div style="color: white">
              <br/>
              <p class="ml-9">{{ $t('miniGero.futureTransactionsNote') }}</p>
            </div>
          </section>
    </v-card-text>
    <v-card-actions class="justify-center py-2 px-0">
      <v-layout>
        <v-row>
          <v-col cols="6">
            <v-btn block outlined color="error" style="text-transform: capitalize;" @click="decline">
              {{ $t('navigation.decline') }}
            </v-btn>
          </v-col>
          <v-col cols="6">
            <v-btn block class="geroButton" style="color: black!important;" :disabled="!consent" @click="confirm">
              {{ $t('navigation.confirm') }}
            </v-btn>
          </v-col>
        </v-row>
      </v-layout>
    </v-card-actions>
  </PopupHeader>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, onMounted, ref, toRefs, getCurrentInstance } from 'vue';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { Messaging } from '@/chrome/messaging';
import { APIError } from '@/chrome/config';
import WalletStore, { walletStore } from '@/stores/walletStore';
import filters from '@/shared/utils/filters';

const { t } = useTranslation();

const vmProxy = getCurrentInstance()!.proxy as any

// Get store values
const { loggedWallet, config } = toRefs(walletStore);

// Reactive data
const consent = ref<boolean>(false);
const controller = ref<any>(null);
const popupHeader = ref<any>(null);
const tabId = ref<number | null>(null);

// Computed properties
const useSidePanel = computed(() => {
  return config.value?.useSidePanel || false;
});

// Methods
const decline = async () => {
  try {
    await controller.value.returnData({ data: {}, error: APIError.Refused });
  } catch (e) {
    console.warn('[DappConnect] returnData failed on decline:', e);
  }
  window.close();
};

const confirm = async () => {
  await WalletStore.addConnectedDapp(loggedWallet.value.id, vmProxy.$refs.popupHeader.domain);
  try {
    await controller.value.returnData({ data: true, error: {} });
  } catch (e) {
    console.warn('[DappConnect] returnData failed:', e);
  }
  window.close();
};

// Lifecycle
onMounted(() => {
  if (useSidePanel.value) {
    const params = new URLSearchParams(window.location.href);
    tabId.value = Number(params.get("tabId"));
    controller.value = Messaging.createInternalSidePanelController(tabId.value);
  } else {
    controller.value = Messaging.createInternalController();
  }

  // Set document title with domain
  const route = vmProxy.$route;
  const website = route.query?.website;
  if (website) {
    const domain = filters.extractHostname(website);
    document.title = `Gero Dashboard | ${t('common.connectTo')} ${domain}`;
  } else {
    document.title = `Gero Dashboard | ${t('common.connect')}`;
  }
});
</script>
