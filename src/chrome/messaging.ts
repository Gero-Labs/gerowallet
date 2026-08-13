import { APIError, BITCOIN_METHOD, MIDNIGHT_METHOD, MidnightErrorCode, METHOD, SENDER, TARGET } from './config';
import { Cardano } from '@cardano-sdk/core';
import { EXTENSION_PAGE_ONLY_METHODS, isOwnExtensionPageSender } from './senderTrust';

interface Message {
  method?: string;
  // Per-method payload; varies widely across handlers. A proper discriminated
  // union would require refactoring every handler in background.ts, so we keep
  // this loose for now.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  error?: string;
  sender?: string;
  target?: string;
  id?: string;
  origin?: string;
  event?: string;
  isUserGesture?: boolean;
}

/**
 * Shape of messages flowing over the internal popup/side-panel ports.
 * Only the fields we read/write are typed; extra fields are preserved at runtime.
 */
interface PortMessage {
  method?: string;
  tabId?: number;
  data?: unknown;
  error?: unknown;
}


/**
 * Per-tab registry of side-panel onConnect listeners, so we can clean up
 * stale listeners when the same tab re-requests a side-panel interaction.
 */
type PortConnectListener = (port: chrome.runtime.Port) => void;
const sidePanelListeners: Map<number, PortConnectListener> = new Map();

/**
 * Narrow an unknown background response to detect an `error` field without
 * resorting to `as any`.
 */
function responseHasError(response: unknown): boolean {
  return (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    Boolean((response as { error?: unknown }).error)
  );
}

const MIDNIGHT_METHOD_VALUES: Set<string> = new Set(Object.values(MIDNIGHT_METHOD));

/**
 * The popup/side-panel "port disconnected without returning data" fallback
 * (user closed the window instead of clicking Decline) needs a DIFFERENT
 * error shape depending on which connector originated the request:
 * CIP-30/Bitcoin/WalletConnect callers expect `APIError.Refused`
 * (`{code:-3, info:...}`); Midnight connector callers expect the
 * `@midnight-ntwrk/dapp-connector-api` shape
 * (`{type:'DAppConnectorAPIError', code:'Rejected', reason, message}`) —
 * without this, a dapp doing spec-correct `error.code === 'Rejected'`
 * checking would fail to recognize a plain window-close as a normal decline.
 */
function popupDisconnectedError(request: Message): unknown {
  if (request.method && MIDNIGHT_METHOD_VALUES.has(request.method)) {
    return {
      type: 'DAppConnectorAPIError',
      code: MidnightErrorCode.Rejected,
      reason: 'User closed the approval window',
      message: 'User closed the approval window',
    };
  }
  return APIError.Refused;
}

/**
 * Generic wrapper for responses from background script
 * @template T - The response data type
 */
export interface BackgroundResponse<T = unknown> {
  data: T;
  target: string;
  sender: string;
}

/**
 * Response type for spending password verification
 */
export interface VerifyPasswordResponse {
  success: boolean;
  error?: string;
}

/**
 * Response type for Sign Tx
 */
export interface SignTxResponse {
  success: boolean;
  signatures: Cardano.Signatures;
  error?: string;
}

/**
 * Response type for Sign Data
 */
export interface SignDataResponse {
  success: boolean;
  signatureData: {
    signatureHex: string;
    signingPublicKeyHex: string;
    addressFieldHex: string;
  };
  error?: string;
}

class InternalController {
  port: chrome.runtime.Port;
  tabId: Promise<number>;

  constructor() {
    if (chrome?.runtime) {
      try {
        this.port = chrome.runtime.connect({
          name: 'internal-background-popup-communication',
        });

        // Handle port disconnection
        this.port.onDisconnect.addListener(() => {
          if (chrome.runtime.lastError) {
            console.warn('Port disconnected with error:', chrome.runtime.lastError.message);
          }
        });
      } catch (error) {
        console.warn('Error creating runtime port:', error);
      }

      this.tabId = new Promise((resolve, reject) => {
        try {
          chrome.tabs.getCurrent((tab) => {
            if (chrome.runtime.lastError) {
              console.warn('Error getting current tab:', chrome.runtime.lastError.message);
              reject(chrome.runtime.lastError);
              return;
            }
            if (!tab) {
              console.warn('No current tab found');
              reject(new Error('No current tab'));
              return;
            }
            resolve(tab.id!);
          });
        } catch (error) {
          console.warn('Error in getCurrent:', error);
          reject(error);
        }
      });
    }
  }

  requestData = () => {
    if (chrome?.tabs) {
      return new Promise<PortMessage>((resolve, reject) => {
        chrome.tabs.getCurrent((tab) => {
          if (!tab) {
            reject('Tab not found');
            return;
          }

          const tabId = tab.id;
          const self = this;

          function messageHandler(response: PortMessage) {
            self.port.onMessage.removeListener(messageHandler);
            resolve(response);
          }

          self.port.onMessage.addListener(messageHandler);

          self.port.postMessage({
            tabId: tabId,
            method: METHOD.requestData,
          });
        });
      });
    }
    return null
  };

  returnData = async ({ data, error }: { data: unknown; error: unknown }) => {
    if (this.port) {
      this.port.postMessage({
        data,
        error,
        method: METHOD.returnData,
        tabId: await this.tabId,
      });
    }
  };
}

class InternalSidePanelController {
  port: chrome.runtime.Port;
  tabId: number;

  constructor(tabId: number) {
    this.tabId = tabId;
    if (chrome?.runtime) {
      try {
        this.port = chrome.runtime.connect({
          name: 'internal-background-sidepanel-communication',
        });

        // Handle port disconnection
        this.port.onDisconnect.addListener(() => {
          if (chrome.runtime.lastError) {
            console.warn('SidePanel port disconnected with error:', chrome.runtime.lastError.message);
          }
        });

        if (!Number.isInteger(this.tabId)) {
          console.error("SidePanelController: invalid or missing tabId in URL!");
        }
      } catch (error) {
        console.warn('Error creating sidepanel runtime port:', error);
      }
    }
  }

  public async requestData(): Promise<PortMessage> {
    return new Promise((resolve) => {
      const self = this;

      function messageHandler(response: PortMessage) {
        self.port.onMessage.removeListener(messageHandler);
        resolve(response);
      }

      self.port.onMessage.addListener(messageHandler);

      self.port.postMessage({
        tabId: this.tabId,
        method: METHOD.requestData,
      });
    });
  }

  public async returnData({ data, error }: { data: unknown; error: unknown }) {
    this.port.postMessage({
      method: METHOD.returnData,
      tabId: this.tabId,
      data,
      error,
    });
  }
}

type MessageSendResponse = (response?: unknown) => void;
type BackgroundRequest = Message & { send?: chrome.runtime.MessageSender };
type BackgroundHandler = (request: BackgroundRequest, sendResponse: MessageSendResponse) => void;

class BackgroundController {
  private methodList: Record<string, BackgroundHandler> = {};
  private optionsMethodList: Record<string, BackgroundHandler> = {};

  add = (method: string, func: BackgroundHandler) => {
    this.methodList[method] = func;
  };

  addToOptions = (method: string, func: BackgroundHandler) => {
    this.optionsMethodList[method] = func;
  };

  // listens to events from webpage / options / side panel to background
  listen = () => {
    if (chrome?.runtime) {
      chrome.runtime.onMessage.addListener((msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: MessageSendResponse) => {
        const request = msg as BackgroundRequest;
        request.send = sender;
        try {
          if (request.sender === SENDER.webpage && request.method && this.methodList[request.method]) {
            this.methodList[request.method](request, sendResponse);
            return true;
          } else if (request.sender === SENDER.options && request.method && this.optionsMethodList[request.method]) {
            // Trust boundary: sensitive cross-device handlers must come from an
            // own extension page, not a content script forging sender:'options'.
            if (EXTENSION_PAGE_ONLY_METHODS.has(request.method) && !isOwnExtensionPageSender(sender, chrome.runtime?.id)) {
              console.warn('Rejected sensitive options-context message from untrusted sender:', request.method);
              // Match the envelope callers unwrap (res.data.success) so a rejection
              // is a clean failure, not a TypeError on undefined data.
              sendResponse({ id: request.id, data: { success: false, error: 'Unauthorized sender' }, target: TARGET, sender: SENDER.extension });
              return true;
            }
            this.optionsMethodList[request.method](request, sendResponse);
            return true;
          }
        } catch (error) {
          console.error('Error dispatching message handler:', error);
          sendResponse({ error: 'Internal error' });
        }
        // Message not handled by this listener - don't keep the channel open
        return false;
      });
    }
  };
}

export const Messaging = {
  sendToBackgroundFromOptions: async function (request: Message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { ...request, target: TARGET, sender: SENDER.options },
          (response) => {
            if (chrome.runtime.lastError) {
              console.warn('Chrome runtime error in sendToBackgroundFromOptions:', chrome.runtime.lastError.message);
              // Resolve with error object instead of rejecting to prevent unhandled promise rejections
              resolve({ error: chrome.runtime.lastError.message });
              return;
            }
            resolve(response);
          }
        );
      } catch (error) {
        console.warn('Error sending message to background from options:', error);
        resolve({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });
  },
  sendToBackground: async function (request: Message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { ...request, target: TARGET, sender: SENDER.webpage },
          (response) => {
            if (chrome.runtime.lastError) {
              console.warn('Chrome runtime error in sendToBackground:', chrome.runtime.lastError.message);
              // Resolve with error object instead of rejecting to prevent unhandled promise rejections
              resolve({ error: chrome.runtime.lastError.message });
              return;
            }
            resolve(response);
          }
        );
      } catch (error) {
        console.warn('Error sending message to background:', error);
        resolve({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });
  },
  sendToContent: function ({ method, data }: { method: string; data: unknown }) {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).slice(2, 11);
      function responseHandler(e: MessageEvent) {
        const response = e.data;
        if (
          typeof response !== 'object' ||
          response === null ||
          !response.target ||
          response.target !== TARGET ||
          !response.id ||
          response.id !== requestId ||
          !response.sender ||
          response.sender !== SENDER.extension
        )
          return;
        window.removeEventListener('message', responseHandler);
        if (response.error) reject(response.error);
        else resolve(response);
      }
      window.addEventListener('message', responseHandler);
      window.postMessage(
        {
          method,
          data,
          target: TARGET,
          sender: SENDER.webpage,
          id: requestId,
        },
        window.origin
      );
    });
  },
  sendToPopupInternal: function (tabIdd: number, request: Message) {
    return new Promise((resolve, _reject) => {
      chrome.runtime.onConnect.addListener(function connectionHandler(port) {
        // Only handle connections from popup (not side panel)
        if (port.name !== 'internal-background-popup-communication') return;

        let resolved = false;
        function cleanup() {
          if (!resolved) {
            resolved = true;
            chrome.runtime.onConnect.removeListener(connectionHandler);
            port.onMessage.removeListener(messageHandler);
          }
        }

        function messageHandler(response: PortMessage) {
          if (response.tabId !== tabIdd) return;
          if (response.method === METHOD.requestData) {
            // Create a deep copy of the request to prevent mutations from affecting the original
            // This is critical for transaction signing to ensure each signing attempt gets fresh data
            const requestCopy = JSON.parse(JSON.stringify(request));
            port.postMessage(requestCopy);
          }
          if (response.method === METHOD.returnData) {
            cleanup();
            resolve(response);
          }
          chrome.tabs.onRemoved.addListener(function tabsHandler(tabId) {
            if (tabIdd !== tabId) return;
            cleanup();
            resolve({
              target: TARGET,
              sender: SENDER.extension,
              error: popupDisconnectedError(request),
            });
            chrome.tabs.onRemoved.removeListener(tabsHandler);
          });
        }

        // Resolve with a refused/declined error if the popup port disconnects
        // without returning data (user closed the window).
        port.onDisconnect.addListener(() => {
          cleanup();
          resolve({
            target: TARGET,
            sender: SENDER.extension,
            error: popupDisconnectedError(request),
          });
        });

        port.onMessage.addListener(messageHandler);
      });
    });
  },
  sendToSidePanelInternal: function (tabIdd: number, request: Message) {
    return new Promise((resolve) => {
      // Remove any existing listener for this tab before adding a new one
      // This prevents old listeners from responding with stale request data
      const staleListener = sidePanelListeners.get(tabIdd);
      if (staleListener) {
        chrome.runtime.onConnect.removeListener(staleListener);
      }

      function connectionHandler(port: chrome.runtime.Port) {
        function messageHandler(response: PortMessage) {
          if (response.tabId !== tabIdd) return;
          if (response.method === METHOD.requestData) {
            // Create a deep copy of the request to prevent mutations
            const requestCopy = JSON.parse(JSON.stringify(request));
            port.postMessage(requestCopy);
          }
          if (response.method === METHOD.returnData) {
            cleanup();
            resolve(response);
          }
        }

        function disconnectHandler() {
          cleanup();
          // Resolve with a refused/declined error when the side panel closes
          // without a response.
          resolve({
            target: TARGET,
            sender: SENDER.extension,
            error: popupDisconnectedError(request),
            data: undefined
          });
        }

        function cleanup() {
          port.onMessage.removeListener(messageHandler);
          port.onDisconnect.removeListener(disconnectHandler);
          chrome.runtime.onConnect.removeListener(connectionHandler);
          // Clean up listener tracking
          if (sidePanelListeners.get(tabIdd) === connectionHandler) {
            sidePanelListeners.delete(tabIdd);
          }
        }

        port.onMessage.addListener(messageHandler);
        port.onDisconnect.addListener(disconnectHandler);
      }

      // Track the listener so we can remove it later
      sidePanelListeners.set(tabIdd, connectionHandler);

      chrome.runtime.onConnect.addListener(connectionHandler);
    });
  },
  createInternalController: () => new InternalController(),
  createInternalSidePanelController: (tabid: number) => new InternalSidePanelController(tabid),
  createProxyController: () => {
    // listen to events from background
    if (chrome?.runtime) {
      chrome.runtime.onMessage.addListener(async (response) => {
        // Bring SDK messages (`from: 'bringweb3'`) are handled by the Bring
        // SDK's own listeners, not by our dApp proxy — skip them cleanly so
        // they don't trigger a whitelist round-trip or log noise.
        if ((response as { from?: unknown })?.from === 'bringweb3') return;
        if (
          typeof response !== 'object' ||
          response === null ||
          !response.target ||
          response.target !== TARGET ||
          !response.sender ||
          response.sender !== SENDER.extension ||
          !response.event
        )
          return;

        const whitelisted = await Messaging.sendToBackground({
          method: METHOD.isWhitelisted,
          origin: window.origin,
        });

        // protect background by not allowing not whitelisted
        if (!whitelisted || responseHasError(whitelisted)) return;
        const event = new CustomEvent(`${TARGET}${response.event}`, {
          detail: response.data,
        });

        window.dispatchEvent(event);
      });
    }
    // listen to function calls from webpage
    window.addEventListener('message', async function (e) {
      // Only accept messages this frame posted to itself (the inject script posts
      // to its own window). Reject anything from a child iframe posting to
      // window.top — otherwise a cross-origin frame could have its CIP-30 request
      // relayed under the top frame's (whitelisted) origin.
      if (e.source !== window) return;
      const request = e.data;
      if (
        typeof request !== 'object' ||
        request === null ||
        !request.target ||
        request.target !== TARGET ||
        !request.sender ||
        request.sender !== SENDER.webpage
      )
        return;
      request.origin = window.origin;
      // only allow enable function, before checking for whitelisted
      // (Midnight's `connect` is the CIP-30 `enable` analog —
      // MIDNIGHT_METHOD.connect's own handler in background.ts IS the approval
      // gate, so it must reach background before any origin is whitelisted.)
      //
      // Sign requests are fast-pathed too, for a different reason:
      // chrome.sidePanel.open() requires a user gesture, and gestures don't
      // survive the extra async round-trip the isWhitelisted pre-check below
      // does. Sending these straight through keeps the gesture alive long
      // enough to reach sidePanel.open(); background enforces the whitelist
      // itself for these methods (see the signTx/signData/MIDNIGHT_METHOD.
      // signData/BITCOIN_METHOD.signPsbt(s)/signMessage handlers in
      // background.ts).
      if (
        request.method === METHOD.enable ||
        request.method === METHOD.isEnabled ||
        request.method === BITCOIN_METHOD.enable ||
        request.method === BITCOIN_METHOD.isEnabled ||
        request.method === MIDNIGHT_METHOD.connect ||
        request.method === METHOD.signTx ||
        request.method === METHOD.signData ||
        request.method === MIDNIGHT_METHOD.signData ||
        request.method === MIDNIGHT_METHOD.makeTransfer ||
        request.method === BITCOIN_METHOD.signPsbt ||
        request.method === BITCOIN_METHOD.signPsbts ||
        request.method === BITCOIN_METHOD.signMessage
      ) {
        Messaging.sendToBackground({
          ...request,
        }).then((response) => window.postMessage(response));
        return;
      }

      const whitelisted = await Messaging.sendToBackground({
        method: METHOD.isWhitelisted,
        origin: window.origin,
      });

      // protect background by not allowing not whitelisted
      if (!whitelisted || responseHasError(whitelisted)) {
        window.postMessage({ ...(whitelisted as object), id: request.id });
        return;
      }
      await Messaging.sendToBackground(request).then((response) => {
        window.postMessage(response);
      });
    });
  },
  createBackgroundController: () => new BackgroundController(),
};
