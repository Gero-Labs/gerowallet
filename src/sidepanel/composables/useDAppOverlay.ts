import { ref, onMounted, onUnmounted } from 'vue';

export interface DAppRequest {
  type: 'dapp-request';
  method: 'enable' | 'signTx' | 'signData';
  requestId: string;
  payload: any;
}

export function useDAppOverlay() {
  const isVisible = ref(false);
  const currentRequest = ref<DAppRequest | null>(null);
  const requestQueue = ref<DAppRequest[]>([]);
  let port: chrome.runtime.Port | null = null;

  function connect() {
    port = chrome.runtime.connect({ name: 'mini-gero-dapp-channel' });

    port.onMessage.addListener((message: DAppRequest) => {
      if (message.type === 'dapp-request') {
        if (currentRequest.value) {
          requestQueue.value.push(message);
        } else {
          currentRequest.value = message;
          isVisible.value = true;
        }
      }
    });

    port.onDisconnect.addListener(() => {
      // Reconnect if background disconnects (service worker restart)
      setTimeout(() => connect(), 1000);
    });
  }

  function respond(requestId: string, data: any, error: string | null = null) {
    if (port) {
      port.postMessage({
        type: 'dapp-response',
        requestId,
        data,
        error,
      });
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
