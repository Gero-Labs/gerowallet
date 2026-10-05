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
    <CashbackSignDialog
      :is-open="!!pendingSign"
      :request-id="pendingSign?.seq ?? 0"
      :message="pendingSign?.message ?? ''"
      :address="pendingSign?.address ?? ''"
      :origin="portalOrigin()"
      @signed="onSigned"
      @close="onDeclined"
    />
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import cashbackApi from '@/api/cashback-api';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import networks from '@/utils/networks';
import snackbar from '@/plugins/snackbar';
import { useTranslation } from '@/shared/composables/useTranslation';
import CashbackSignDialog, { type CashbackSignature } from './CashbackSignDialog.vue';
import {
  isTrustedPortalMessage,
  pinnedPortalUrl,
  signRequestMessage,
  sessionUpdateMessage,
  signatureMessage,
  abortSignMessage,
} from './portalBridge';

const { t } = useTranslation();

const frame = ref<HTMLIFrameElement | null>(null);
const portalUrl = ref('');
const loading = ref(false);
const errorState = ref(false);

const theme = 'dark';

/** How long a claim challenge may wait for approval before the portal is told to reset. */
const SIGN_TIMEOUT_MS = 5 * 60_000;

interface PendingSign {
  seq: number;
  message: string;
  walletId: number;
  address: string;
}
const pendingSign = ref<PendingSign | null>(null);
let signSeq = 0;
let signTimer: ReturnType<typeof setTimeout> | null = null;

function baseAddress(): string | null {
  return walletStore.loggedWallet?.baseAddress ?? null;
}

/** The wallet a claim may be signed for: Cardano, on a network Bring supports. */
function claimWallet(): { id: number; address: string } | null {
  const wallet = walletStore.loggedWallet;
  if (!wallet || wallet.chain !== Blockchain.CARDANO || !wallet.baseAddress) return null;
  if (!networks.resolveCashbackSupport(wallet.chain, wallet.network)) return null;
  return { id: wallet.id, address: wallet.baseAddress };
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
  // A reload also discards any claim the previous document was waiting on.
  if (reason === 'initial') {
    didRefreshOnLoad = false;
    clearPendingSign();
  }
  try {
    const res = await cashbackApi.portal(baseAddress(), theme);
    if (reason === 'initial' || !portalUrl.value) {
      // Only a pinned portal origin is ever loaded (and so ever trusted to
      // request signatures), whatever URL the bootstrap names.
      const url = pinnedPortalUrl(res.portalUrl);
      if (!url) throw new Error('Untrusted cashback portal origin');
      portalUrl.value = url;
    } else {
      post(sessionUpdateMessage(res.token));
    }
  } catch {
    errorState.value = true;
  } finally {
    loading.value = false;
  }
}

function clearPendingSign() {
  if (signTimer) clearTimeout(signTimer);
  signTimer = null;
  pendingSign.value = null;
}

/**
 * A claim challenge from the portal. One is live at a time: a newer request
 * replaces an older one outright, and the older one's answer, whenever it
 * arrives, is dropped by its sequence number. The signature is only ever
 * returned for the wallet the request was bound to.
 */
function requestSignature(message: string) {
  const wallet = claimWallet();
  if (!wallet) {
    snackbar.setError(t('cashback.signUnsupportedNetwork'));
    post(abortSignMessage());
    return;
  }
  clearPendingSign();
  const seq = ++signSeq;
  pendingSign.value = { seq, message, walletId: wallet.id, address: wallet.address };
  signTimer = setTimeout(() => finishSign(seq, null, t('cashback.signTimedOut')), SIGN_TIMEOUT_MS);
}

function finishSign(seq: number, result: CashbackSignature | null, error?: string) {
  const request = pendingSign.value;
  if (!request || request.seq !== seq) return;
  clearPendingSign();
  const wallet = claimWallet();
  const sameWallet = !!wallet && wallet.id === request.walletId && wallet.address === request.address;
  if (result && sameWallet) {
    post(signatureMessage(result.signature, result.key, request.message));
    return;
  }
  const reason = result ? t('cashback.signWalletChanged') : error;
  if (reason) snackbar.setError(reason);
  post(abortSignMessage());
}

/** Answered by the id the prompt echoes back, so a signature approved for an
 *  earlier request never reaches the portal as the newer one. */
function onSigned(result: CashbackSignature) {
  finishSign(result.requestId, result);
}

function onDeclined() {
  if (pendingSign.value) finishSign(pendingSign.value.seq, null);
}

// The portal's initial token (embedded in portalUrl) has a very short TTL and can
// expire before the iframe finishes cold-loading, making the portal's own
// /portal/verify 401. Once the frame has loaded, immediately push a fresh
// SESSION_UPDATE token so it re-verifies within a full lifetime.
let didRefreshOnLoad = false;
async function onFrameLoad() {
  // Whatever document just loaded is not the one that asked; a pending
  // approval must not be able to deliver a signature into it.
  clearPendingSign();
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
    const message = signRequestMessage(event.data);
    if (message === null) post(abortSignMessage());
    else requestSignature(message);
  }
  // POPUP_CLOSED: informational, ignore.
}

watch(() => walletStore.loggedWallet?.baseAddress, (addr, prev) => {
  if (addr === prev) return;
  // The claim was initiated for the previous wallet; never sign it with this one.
  if (pendingSign.value) finishSign(pendingSign.value.seq, null, t('cashback.signWalletChanged'));
  if (portalUrl.value) bootstrap('resync');
});

onMounted(() => {
  window.addEventListener('message', onMessage);
  bootstrap('initial');
});
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage);
  clearPendingSign();
});
</script>
<style scoped>
.cashback-portal { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; }
/* `:root { color-scheme: dark }` (tokens.css) propagates into the embedded
   document. When the portal's own used color-scheme resolves to light, Chrome
   refuses to keep the iframe canvas transparent and paints an opaque white
   backdrop. Resetting the scheme on the iframe element removes the mismatch so
   the portal's transparent canvas lets our surface show through. */
.portal-frame {
  flex: 1; width: 100%; min-height: 0; border: 0; display: block;
  color-scheme: normal;
  background: transparent;
}
/* Normal flex-flow (not absolute) so the loading/error state stays inside the
   portal's own box and never overlaps sibling chrome (e.g. quick actions). */
.portal-state {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; padding: 24px;
}
</style>
