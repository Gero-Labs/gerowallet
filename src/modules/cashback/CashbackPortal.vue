<template>
  <div class="cashback-portal">
    <div v-if="errorState" class="portal-state">
      <v-icon size="40" color="#F97066" class="mb-2">mdi-alert-circle-outline</v-icon>
      <p class="grey--text mb-3">{{ $t('cashback.portalLoadError') }}</p>
      <v-btn class="geroButton" rounded depressed :loading="loading" @click="bootstrap()">{{ $t('cashback.retry') }}</v-btn>
    </div>
    <div v-else-if="loading && !portalUrl" class="portal-state">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <iframe
      v-show="portalUrl && !errorState"
      ref="frame"
      :src="portalUrl"
      class="portal-frame"
      title="Bring Cashback"
      @load="onFrameLoad"
    />
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import cashbackApi from '@/api/cashback-api';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { METHOD } from '@/chrome/config';
import { stringToHex } from '@/shared/utils/converter';
import {
  isTrustedPortalMessage,
  sessionUpdateMessage,
  signatureMessage,
  abortSignMessage,
} from './portalBridge';

const frame = ref<HTMLIFrameElement | null>(null);
const portalUrl = ref('');
const loading = ref(false);
const errorState = ref(false);

const theme = 'dark';

function baseAddress(): string | null {
  return walletStore.loggedWallet?.baseAddress ?? null;
}

function portalOrigin(): string {
  try { return new URL(portalUrl.value).origin; } catch { return ''; }
}

function post(message: object) {
  const origin = portalOrigin();
  if (origin) frame.value?.contentWindow?.postMessage(message, origin);
}

// Fetch a fresh portalUrl+token. First call sets iframe.src; later calls (wallet/theme
// change, or LOGIN) push SESSION_UPDATE so the loaded portal re-syncs without a reload.
async function bootstrap(reason: 'initial' | 'resync' = 'initial') {
  loading.value = true;
  errorState.value = false;
  // A fresh initial load (mount or Retry) re-mounts/reloads the iframe, so re-arm
  // the on-load refresh; otherwise a post-error Retry would silently skip it.
  if (reason === 'initial') didRefreshOnLoad = false;
  try {
    const res = await cashbackApi.portal(baseAddress(), theme);
    if (reason === 'initial' || !portalUrl.value) {
      portalUrl.value = res.portalUrl;
    } else {
      post(sessionUpdateMessage(res.token));
    }
  } catch {
    errorState.value = true;
  } finally {
    loading.value = false;
  }
}

async function signForPortal(messageToSign: string) {
  const addr = baseAddress();
  if (!addr) { post(abortSignMessage()); return; }
  try {
    const res = await Messaging.sendToBackground({
      method: METHOD.signData,
      data: { address: Cardano.Address.fromBech32(addr).toBytes(), payload: stringToHex(messageToSign) },
    }) as { data?: { signature?: string; key?: string } };
    const signature = res.data?.signature;
    const key = res.data?.key;
    if (signature && key) post(signatureMessage(signature, key, messageToSign));
    else post(abortSignMessage());
  } catch {
    post(abortSignMessage());
  }
}

// The portal's initial token (embedded in portalUrl) has a very short TTL and can
// expire before the iframe finishes cold-loading, making the portal's own
// /portal/verify 401. Once the frame has loaded, immediately push a fresh
// SESSION_UPDATE token so it re-verifies within a full lifetime.
let didRefreshOnLoad = false;
async function onFrameLoad() {
  if (didRefreshOnLoad || !portalUrl.value) return;
  didRefreshOnLoad = true;
  await bootstrap('resync');
}

async function onMessage(event: MessageEvent) {
  // Defence-in-depth: only accept messages from our own portal iframe window,
  // on top of the origin + `from:'bringweb3'` trust check.
  if (event.source !== frame.value?.contentWindow) return;
  if (!isTrustedPortalMessage(event, portalOrigin())) return;
  const action = (event.data as { action: string }).action;
  if (action === 'LOGIN') {
    await bootstrap('resync');
  } else if (action === 'SIGN_MESSAGE') {
    await signForPortal((event.data as { messageToSign: string }).messageToSign);
  }
  // POPUP_CLOSED: informational, ignore.
}

watch(() => walletStore.loggedWallet?.baseAddress, (addr, prev) => {
  if (addr !== prev && portalUrl.value) bootstrap('resync');
});

onMounted(() => {
  window.addEventListener('message', onMessage);
  bootstrap('initial');
});
onBeforeUnmount(() => window.removeEventListener('message', onMessage));
</script>
<style scoped>
.cashback-portal { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; }
.portal-frame { flex: 1; width: 100%; min-height: 0; border: 0; display: block; }
/* Normal flex-flow (not absolute) so the loading/error state stays inside the
   portal's own box and never overlaps sibling chrome (e.g. quick actions). */
.portal-state {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; padding: 24px;
}
</style>
