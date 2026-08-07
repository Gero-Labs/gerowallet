import { ref } from 'vue';

export interface DAppRequest {
  type: 'dapp-request';
  method: 'enable' | 'signTx' | 'signData' | 'midnight_connect' | 'midnight_signData' | 'midnight_makeTransfer' | 'btcSignPsbt' | 'btcSignMessage' | 'wcSessionProposal';
  requestId: string;
  payload: unknown;
}

// The response value handed back to the dApp: a signature string, a boolean
// (enable), a COSE object (signData), etc. — opaque to the hub itself.
type DAppResponseData = unknown;

// Methods this panel version can render. Anything else gets an immediate NACK
// so the dApp receives an error instead of hanging against a dropped message.
// WalletConnect session *requests* (signing) reuse signTx/signData/
// btcSignPsbt/btcSignMessage directly — same rendering, different origin
// metadata — so only the session *proposal* (pairing) needs its own method.
const VALID_METHODS = new Set([
  'enable', 'signTx', 'signData', 'midnight_connect', 'midnight_signData',
  'midnight_makeTransfer', 'btcSignPsbt', 'btcSignMessage', 'wcSessionProposal',
]);

const isVisible = ref(false);
const currentRequest = ref<DAppRequest | null>(null);
const requestQueue = ref<DAppRequest[]>([]);
const connectionLost = ref(false);
// True only while DAppOverlay is mounted (wallet unlocked + active). Gates
// whether a delivered request may be shown or must stay queued — see promoteNext.
let overlayReady = false;

let port: chrome.runtime.Port | null = null;
let retryCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let resolvedTabId = '';
// Responses produced while the port was down; flushed on reconnect. Safe
// because background now parks requests on disconnect instead of rejecting.
const pendingResponses: Array<{ requestId: string; data: DAppResponseData; error: string | null }> = [];
const seenRequestIds = new Set<string>();
// Duplicate enable() calls from the SAME origin coalesce onto one prompt.
// dApps (e.g. DexHunter) fire enable() several times on load; each gets a
// distinct requestId, so without this every call stacked its own Connection
// Request. Here: origin -> requestIds of the duplicates waiting on the primary
// prompt's answer. When the primary is approved/rejected they all get the same
// response — approving once connects, no prompt spam.
const coalescedEnables = new Map<string, string[]>();

function originOf(req: DAppRequest): string {
  const p = req.payload as { website?: string } | null;
  return p && typeof p.website === 'string' ? p.website : '';
}

// Deliver the primary enable's answer to every coalesced duplicate for its
// origin, mirroring respond()'s dedupe-set eviction rules.
function drainCoalescedEnables(origin: string, data: DAppResponseData, error: string | null) {
  if (!origin) return;
  const ids = coalescedEnables.get(origin);
  if (!ids) return;
  coalescedEnables.delete(origin);
  for (const id of ids) {
    const delivered = safePost({ type: 'dapp-response', requestId: id, data, error });
    if (!delivered) pendingResponses.push({ requestId: id, data, error });
    else seenRequestIds.delete(id);
  }
}

// An enable for this origin already prompting or queued? Then a new enable is a
// duplicate that should wait on that one, not open its own prompt.
function hasPendingEnable(origin: string): boolean {
  if (!origin) return false;
  if (currentRequest.value?.method === 'enable' && originOf(currentRequest.value) === origin) return true;
  if (coalescedEnables.has(origin)) return true;
  return requestQueue.value.some((r) => r.method === 'enable' && originOf(r) === origin);
}

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
    // Coalesce duplicate enable() from the same origin: it waits on the primary
    // prompt instead of stacking its own (see coalescedEnables).
    if (message.method === 'enable') {
      const origin = originOf(message);
      if (hasPendingEnable(origin)) {
        const ids = coalescedEnables.get(origin) ?? [];
        ids.push(message.requestId);
        coalescedEnables.set(origin, ids);
        return;
      }
    }
    // Always enqueue, then let promoteNext() decide whether it can be shown.
    // It only becomes the visible currentRequest when the overlay is actually
    // mounted (wallet unlocked) — a request delivered while locked stays queued
    // instead of occupying currentRequest invisibly and blocking everything
    // behind it (see setOverlayReady).
    requestQueue.value.push(message);
    promoteNext();
  });

  port.onDisconnect.addListener(() => {
    port = null;
    connectionLost.value = true;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (retryTimer) return;
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
  // Captured before currentRequest is cleared: if this is an enable, its
  // coalesced duplicates get the same answer.
  const finalized = currentRequest.value;
  const delivered = safePost({ type: 'dapp-response', requestId, data, error });
  if (!delivered) {
    pendingResponses.push({ requestId, data, error });
  }
  // Evict from the dedupe set ONLY when the response actually reached the
  // background. If it was queued instead, background still has the request
  // parked and will re-deliver it synchronously on the next port reconnect —
  // BEFORE our flushed response is processed — so the id must stay in
  // seenRequestIds or the user gets the approval dialog a second time for a
  // request they already answered. (Deleting on successful flush would NOT
  // work for the same ordering reason; ids of offline-answered requests are
  // one UUID string each and live only for this panel document's lifetime.)
  if (delivered) seenRequestIds.delete(requestId);
  currentRequest.value = null;
  isVisible.value = false;
  if (finalized?.requestId === requestId && finalized.method === 'enable') {
    drainCoalescedEnables(originOf(finalized), data, error);
  }
  promoteNext();
}

// Pull the next queued request into view — but only when the overlay is mounted
// (wallet unlocked) so it can actually be shown and acted on, and only when
// nothing is already displayed. No-op otherwise; the request stays queued.
function promoteNext() {
  if (!overlayReady || currentRequest.value) return;
  const next = requestQueue.value.shift();
  if (next) {
    currentRequest.value = next;
    isVisible.value = true;
  }
}

// Driven by DAppOverlay's mount lifecycle (it renders only when the wallet is
// unlocked + active). While the overlay is gone, a delivered request must not
// sit as an invisible currentRequest blocking the queue: park the current one
// back at the front so it re-shows when the overlay remounts on unlock.
function setOverlayReady(ready: boolean) {
  overlayReady = ready;
  if (ready) {
    promoteNext();
  } else if (currentRequest.value) {
    requestQueue.value.unshift(currentRequest.value);
    currentRequest.value = null;
    isVisible.value = false;
  }
}

function approve(data: DAppResponseData) {
  if (currentRequest.value) respond(currentRequest.value.requestId, data);
}

function reject(reason = 'user_rejected') {
  if (currentRequest.value) respond(currentRequest.value.requestId, null, reason);
}

/**
 * Reject one specific QUEUED item (not the currently displayed one) without
 * disturbing currentRequest — lets a user clear a single unwanted queued
 * request (or all of them, via rejectAll) instead of only ever being able to
 * act on whatever happens to be on top.
 */
function rejectQueued(requestId: string, reason = 'user_rejected') {
  const idx = requestQueue.value.findIndex((r) => r.requestId === requestId);
  if (idx === -1) return;
  const [removed] = requestQueue.value.splice(idx, 1);
  const delivered = safePost({ type: 'dapp-response', requestId, data: null, error: reason });
  if (!delivered) pendingResponses.push({ requestId, data: null, error: reason });
  // Same rule as respond(): only evict from the dedupe set on real delivery,
  // so a parked re-delivery of an already-rejected request is swallowed.
  if (delivered) seenRequestIds.delete(requestId);
  // Rejecting a queued primary enable also rejects its coalesced duplicates.
  if (removed?.method === 'enable') {
    drainCoalescedEnables(originOf(removed), null, reason);
  }
}

/** Reject everything: every queued item, then the currently displayed one. */
function rejectAll(reason = 'user_rejected') {
  for (const item of [...requestQueue.value]) {
    rejectQueued(item.requestId, reason);
  }
  reject(reason);
}

export const hub = {
  isVisible,
  currentRequest,
  requestQueue,
  connectionLost,
  approve,
  reject,
  rejectQueued,
  rejectAll,
  respond,
  setOverlayReady,
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
  connect();
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
}
