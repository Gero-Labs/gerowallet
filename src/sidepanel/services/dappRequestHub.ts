import { ref, computed, watch } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';

export interface DAppRequest {
  type: 'dapp-request';
  method: 'enable' | 'signTx' | 'signData' | 'midnight_connect' | 'midnight_signData';
  requestId: string;
  payload: unknown;
}

// The response value handed back to the dApp: a signature string, a boolean
// (enable), a COSE object (signData), etc. — opaque to the hub itself.
type DAppResponseData = unknown;

// Methods this panel version can render. Anything else gets an immediate NACK
// so the dApp receives an error instead of hanging against a dropped message.
const VALID_METHODS = new Set(['enable', 'signTx', 'signData', 'midnight_connect', 'midnight_signData']);

const isVisible = ref(false);
const currentRequest = ref<DAppRequest | null>(null);
const requestQueue = ref<DAppRequest[]>([]);
const connectionLost = ref(false);

// Apex wallets fall back to popup signing (product decision pending — see
// docs/design/2026-07-10-sidepanel-first-signing.md Phase 2). DAppOverlay.vue
// still hides its entire sheet with `v-if="!isApex"`, so this hub must NEVER
// hold a healthy port while an Apex wallet is active: if it did, background
// would see `miniGeroPorts.has(tabId) === true` and deliver requests via
// sendToMiniGero instead of falling back to the popup — but nothing renders
// them (isVisible flips true, no UI shows), stranding the request with no
// recourse. Reactive so a mid-session wallet switch (Cardano <-> Apex)
// connects/disconnects correctly instead of only checking once at mount.
const isApexActive = computed(() =>
  walletStore.loggedWallet?.chain === Blockchain.APEX_PRIME ||
  walletStore.loggedWallet?.chain === Blockchain.APEX_VECTOR
);

let port: chrome.runtime.Port | null = null;
let retryCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let resolvedTabId = '';
// Responses produced while the port was down; flushed on reconnect. Safe
// because background now parks requests on disconnect instead of rejecting.
const pendingResponses: Array<{ requestId: string; data: DAppResponseData; error: string | null }> = [];
const seenRequestIds = new Set<string>();

function resolveTabId(): Promise<string> {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(search);
  const fromUrl = params.get('tabId');
  if (fromUrl) return Promise.resolve(fromUrl);
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs && tabs[0]?.id !== undefined ? String(tabs[0].id) : '');
      });
    } catch {
      resolve('');
    }
  });
}

function connect() {
  if (isApexActive.value) return; // preserve today's Apex→popup fallback
  try {
    port = chrome.runtime.connect({ name: `mini-gero-dapp-channel:${resolvedTabId}` });
  } catch (e) {
    console.warn('[DAppHub] connect failed:', e);
    port = null;
    scheduleReconnect();
    return;
  }
  connectionLost.value = false;
  retryCount = 0;
  flushPendingResponses();

  port.onMessage.addListener((message: DAppRequest) => {
    if (message?.type !== 'dapp-request' || !message.requestId) return;
    if (!VALID_METHODS.has(message.method)) {
      safePost({ type: 'dapp-nack', requestId: message.requestId, error: 'unsupported_method' });
      return;
    }
    if (seenRequestIds.has(message.requestId)) return; // re-delivery dedupe
    seenRequestIds.add(message.requestId);
    if (currentRequest.value) {
      requestQueue.value.push(message);
    } else {
      currentRequest.value = message;
      isVisible.value = true;
    }
  });

  port.onDisconnect.addListener(() => {
    port = null;
    connectionLost.value = true;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (retryTimer) return;
  if (isApexActive.value) return; // don't fight an intentional Apex disconnect
  const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
  retryCount++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, delay);
}

function safePost(message: unknown): boolean {
  if (!port) return false;
  try {
    port.postMessage(message);
    return true;
  } catch {
    port = null;
    connectionLost.value = true;
    scheduleReconnect();
    return false;
  }
}

function flushPendingResponses() {
  while (pendingResponses.length > 0) {
    const r = pendingResponses[0];
    const ok = safePost({ type: 'dapp-response', requestId: r.requestId, data: r.data, error: r.error });
    if (!ok) return; // port died again; keep the rest queued
    pendingResponses.shift();
  }
}

function respond(requestId: string, data: DAppResponseData, error: string | null = null) {
  const delivered = safePost({ type: 'dapp-response', requestId, data, error });
  if (!delivered) {
    pendingResponses.push({ requestId, data, error });
  }
  seenRequestIds.delete(requestId);
  currentRequest.value = null;
  isVisible.value = false;
  if (requestQueue.value.length > 0) {
    const next = requestQueue.value.shift()!;
    currentRequest.value = next;
    isVisible.value = true;
  }
}

function approve(data: DAppResponseData) {
  if (currentRequest.value) respond(currentRequest.value.requestId, data);
}

function reject(reason = 'user_rejected') {
  if (currentRequest.value) respond(currentRequest.value.requestId, null, reason);
}

export const hub = {
  isVisible,
  currentRequest,
  requestQueue,
  connectionLost,
  approve,
  reject,
  respond,
  // test hook: force an immediate reconnect (bypasses the backoff timer)
  async _reconnectNow() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    connect();
  },
};

let initialized = false;

export async function initDappRequestHub() {
  if (initialized) return;
  initialized = true;
  resolvedTabId = await resolveTabId();
  connect(); // no-ops if isApexActive is already true at boot
  // A hidden panel can burn through retries; give it a fresh start when the
  // user looks at it again instead of staying a permanent zombie.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !port) {
        retryCount = 0;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        connect();
      }
    });
  }
  // Mid-session wallet switch: disconnect immediately on switching TO Apex
  // (so background's miniGeroPorts check goes false right away, instead of
  // waiting on the next request's timeout); reconnect on switching AWAY.
  watch(isApexActive, (nowApex) => {
    if (nowApex && port) {
      try { port.disconnect(); } catch { /* already gone */ }
      port = null;
    } else if (!nowApex && !port) {
      retryCount = 0;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      connect();
    }
  });
}
