import { ref, onMounted, onUnmounted } from 'vue';

export interface DAppRequest {
  type: 'dapp-request';
  method: 'enable' | 'signTx' | 'signData';
  requestId: string;
  payload: any;
}

const VALID_METHODS = new Set(['enable', 'signTx', 'signData']);
const MAX_RETRIES = 10;

export function useDAppOverlay() {
  const isVisible = ref(false);
  const currentRequest = ref<DAppRequest | null>(null);
  const requestQueue = ref<DAppRequest[]>([]);
  let port: chrome.runtime.Port | null = null;
  let retryCount = 0;

  function connect() {
    try {
      // Read tabId from URL query param (set by openSidebar in background)
      const params = new URLSearchParams(window.location.search);
      const tabId = params.get('tabId') || '';
      port = chrome.runtime.connect({ name: `mini-gero-dapp-channel:${tabId}` });
    } catch (e) {
      console.warn('[DApp] Failed to connect:', e);
      scheduleReconnect();
      return;
    }

    port.onMessage.addListener((message: DAppRequest) => {
      if (message.type === 'dapp-request' && VALID_METHODS.has(message.method)) {
        retryCount = 0; // Reset on successful message
        if (currentRequest.value) {
          requestQueue.value.push(message);
        } else {
          currentRequest.value = message;
          isVisible.value = true;
        }
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (retryCount < MAX_RETRIES) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
      retryCount++;
      setTimeout(() => connect(), delay);
    } else {
      console.warn('[DApp] Max reconnection attempts reached');
    }
  }

  function respond(requestId: string, data: any, error: string | null = null) {
    try {
      if (port) {
        port.postMessage({
          type: 'dapp-response',
          requestId,
          data,
          error,
        });
      } else {
        console.warn('[DApp] Port not connected, response dropped for request:', requestId);
      }
    } catch (e) {
      // Port may have disconnected between the null check and postMessage
      console.warn('[DApp] Failed to send response, port likely disconnected:', e);
      port = null;
    }

    currentRequest.value = null;
    isVisible.value = false;

    // Process next queued request
    if (requestQueue.value.length > 0) {
      const next = requestQueue.value.shift()!;
      currentRequest.value = next;
      isVisible.value = true;
    }
  }

  function approve(data: any) {
    if (currentRequest.value) {
      respond(currentRequest.value.requestId, data);
    }
  }

  function reject(reason = 'user_rejected') {
    if (currentRequest.value) {
      respond(currentRequest.value.requestId, null, reason);
    }
  }

  onMounted(() => connect());
  onUnmounted(() => port?.disconnect());

  return { isVisible, currentRequest, requestQueue, approve, reject };
}
