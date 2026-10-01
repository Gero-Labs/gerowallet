<template>
  <PopupHeader :title="t('navigation.connectWithGeroDashboard')" ref="popupHeader">
    <v-card-text class="d-flex flex-column align-content-space-between pa-0 fill-height">
      <v-card-title class="justify-center text-center pt-0" style="color: white; font-size: 14px; word-break: break-word">
        {{ $t('navigation.confirmUrlBeforeGranting') }}
      </v-card-title>
      <EmbeddedSiteWarning class="mb-2" :embedded-in="embeddedIn" />
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
import { onMounted, ref, toRefs, getCurrentInstance } from 'vue';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import EmbeddedSiteWarning from '@/shared/components/EmbeddedSiteWarning.vue';
import { Messaging } from '@/chrome/messaging';
import { APIError } from '@/chrome/config';
import WalletStore, { walletStore } from '@/stores/walletStore';
import filters from '@/shared/utils/filters';

const { t } = useTranslation();

const vmProxy = getCurrentInstance()!.proxy as unknown as {
  $refs: { popupHeader: { domain: string } };
  $route: { query?: Record<string, string | undefined> };
};

// Get store values
const { loggedWallet } = toRefs(walletStore);

// Reactive data
const consent = ref<boolean>(false);
const controller = ref<ReturnType<typeof Messaging.createInternalController> | null>(null);
const popupHeader = ref<unknown>(null);
// Browser-derived embedding site, set by the background on the request.
const embeddedIn = ref<unknown>(null);

// Methods
const decline = async () => {
  try {
    await controller.value?.returnData({ data: {}, error: APIError.Refused });
  } catch (e) {
    console.warn('[DappConnect] returnData failed on decline:', e);
  }
  window.close();
};

const confirm = async () => {
  // Store the full origin (scheme + host + port), never the bare hostname: a
  // hostname entry would also authorise http:// and other ports of that name.
  let origin = '';
  try {
    origin = new URL(String(vmProxy.$route.query?.website ?? '')).origin;
  } catch {
    origin = '';
  }
  if (!origin || origin === 'null') {
    await decline();
    return;
  }
  await WalletStore.addConnectedDapp(loggedWallet.value.id, origin);
  try {
    await controller.value?.returnData({ data: true, error: {} });
  } catch (e) {
    console.warn('[DappConnect] returnData failed:', e);
  }
  window.close();
};

// Lifecycle
onMounted(() => {
  // This view is only ever opened inside a standalone popup window (see the
  // Cardano/Bitcoin enable() popup fallbacks in background.ts, which always
  // target index.html) — never inside the side panel, which renders
  // DAppOverlay.vue instead. It must always speak the popup port protocol.
  // It used to branch on the now-retired Prompt Display Mode setting
  // instead, which connected the wrong port name and hung forever whenever
  // this fallback view was reached (same bug fixed in 371b9ce for the other
  // five popup dApp views).
  controller.value = Messaging.createInternalController();
  controller.value.requestData()
    .then((req) => { embeddedIn.value = (req as { embeddedIn?: unknown } | undefined)?.embeddedIn ?? null; })
    .catch(() => { /* no request: nothing to warn about */ });

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
