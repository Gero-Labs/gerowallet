import { APIError, APPROVAL_BUSY_MESSAGE, APPROVAL_LOCKED_MESSAGE, BITCOIN_METHOD, MIDNIGHT_METHOD, MidnightErrorCode, METHOD, SENDER, TARGET } from './config';
import { Cardano } from '@cardano-sdk/core';
import { isOptionsSenderAllowed, isOwnExtensionPageSender, ownExtension } from './senderTrust';
import { claimedOriginMatchesSender } from './originBinding';
import { BITCOIN_DAPP_ENABLED, isDappMethodAvailable } from './bitcoinDappGate';
import { toMidnightConnectorError } from './midnightConnectorError';

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
  /**
   * Set by the background on requests it hands to a popup approval: the
   * browser-derived top-level site when the request came from a cross-origin
   * frame (see originBinding.embeddingSite), else null. Always overwritten by
   * the background, never taken from the page.
   */
  embeddedIn?: string | null;
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
 * `@midnightntwrk/dapp-connector-api` shape
 * (`{type:'DAppConnectorAPIError', code:'Rejected', reason, message}`) —
 * without this, a dapp doing spec-correct `error.code === 'Rejected'`
 * checking would fail to recognize a plain window-close as a normal decline.
 * It stays a plain object here because chrome messaging cannot carry an
 * Error; the page's `sendToContent` turns it into one (`toPageError`).
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
 * The refusal for a request made while the approval popup still waits on another one.
 * Same shapes as popupDisconnectedError, with the busy text instead of "disconnects".
 */
export function popupBusyError(request: Message): unknown {
  if (request.method && MIDNIGHT_METHOD_VALUES.has(request.method)) {
    return {
      type: 'DAppConnectorAPIError',
      code: MidnightErrorCode.Rejected,
      reason: APPROVAL_BUSY_MESSAGE,
      message: APPROVAL_BUSY_MESSAGE,
    };
  }
  return { code: APIError.Refused.code, info: APPROVAL_BUSY_MESSAGE };
}

/**
 * The rejection `sendToContent` hands the page for an error reply. Midnight
 * connector methods get a spec `APIError` (an Error carrying type, code and
 * reason; see midnightConnectorError.ts), since the reply crossed
 * `window.postMessage` as a plain object. CIP-30, Bitcoin and WalletConnect
 * callers keep the `{code, info}` object they expect.
 */
export function toPageError(method: string, error: unknown): unknown {
  return MIDNIGHT_METHOD_VALUES.has(method) ? toMidnightConnectorError(error) : error;
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
            // The origin in the body is written inside the page's renderer; it
            // must match the browser-reported origin of the sending frame.
            // A gated-off dApp API stays off even when a page posts the request
            // itself instead of going through a provider it can't see.
            if (!claimedOriginMatchesSender(request.origin, sender) || !isDappMethodAvailable(request.method)) {
              sendResponse({ id: request.id, error: APIError.Refused, target: TARGET, sender: SENDER.extension });
              return true;
            }
            this.methodList[request.method](request, sendResponse);
            return true;
          } else if (request.sender === SENDER.options && request.method && this.optionsMethodList[request.method]) {
            // Trust boundary: the options channel is default-deny. Only our own
            // extension pages may use it (plus the content-script allowlist in
            // senderTrust.ts); a content script forging sender:'options' is refused.
            if (!isOptionsSenderAllowed(request.method, sender, ownExtension())) {
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

/**
 * The page only accepts a reply carrying its request id, our target and the
 * extension sender. A background reply already has them; a transport failure
 * (service worker gone, `chrome.runtime.lastError`) resolves to a bare
 * `{ error }`, which the page used to ignore, leaving the dApp's call hanging
 * forever. Give every reply the envelope the page matches on.
 */
export function toPageReply(response: unknown, requestId: unknown): Record<string, unknown> {
  const r = (response && typeof response === 'object') ? response as Record<string, unknown> : {};
  if (r['id'] === requestId && r['target'] === TARGET && r['sender'] === SENDER.extension) return r;
  return {
    ...r,
    error: r['error'] ?? (r['data'] === undefined ? APIError.InternalError : undefined),
    id: requestId,
    target: TARGET,
    sender: SENDER.extension,
  };
}

/** Popup tabs waiting on a request: the method, and how many share it. */
const popupWaiters = new Map<number, { method: string | undefined; count: number }>();
/** Every request still waiting in a popup, with what declines it because the wallet locked. */
const popupLockDecliners = new Set<() => void>();

/**
 * The refusal for a request still waiting in a popup when the wallet locks: Refused (-3)
 * for CIP-30 and Bitcoin, Rejected for Midnight, saying the wallet was locked.
 */
export function popupLockedError(request: Message): unknown {
  if (request.method && MIDNIGHT_METHOD_VALUES.has(request.method)) {
    return {
      type: 'DAppConnectorAPIError',
      code: MidnightErrorCode.Rejected,
      reason: APPROVAL_LOCKED_MESSAGE,
      message: APPROVAL_LOCKED_MESSAGE,
    };
  }
  return { code: APIError.Refused.code, info: APPROVAL_LOCKED_MESSAGE };
}
/** Connect prompts a dApp may fire several times; duplicates share one popup answer. */
const POPUP_SHARED_METHODS = new Set<string | undefined>([METHOD.enable, MIDNIGHT_METHOD.connect, BITCOIN_METHOD.enable]);

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
        if (response.error) reject(toPageError(method, response.error));
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
  /**
   * Shows `request` in the approval popup open in tab `popupTabId` and answers
   * exactly once: with the popup's returnData, or with the declined error when
   * that popup closes (its tab is removed, or a port it used disconnects). The
   * tab listener is registered up front, so a popup closed before its page
   * connects still answers. A port belongs to this popup by its sender tab (or,
   * without one, by the tab it speaks for): closing another request's popup
   * never answers this one.
   *
   * One popup tab waits on one request. focusOrCreatePopup reuses an open popup
   * with the same URL, so a second request for a tab already waiting would get
   * the first one's answer (a signature made for another transaction); it is
   * declined at once instead. Duplicate connect requests of the same method
   * (dApps call enable() several times) may share the prompt and its answer.
   */
  sendToPopupInternal: function (popupTabId: number, request: Message) {
    return new Promise((resolve) => {
      const waiting = popupWaiters.get(popupTabId);
      if (waiting && !(waiting.method === request.method && POPUP_SHARED_METHODS.has(request.method))) {
        resolve({ target: TARGET, sender: SENDER.extension, error: popupBusyError(request) });
        return;
      }
      popupWaiters.set(popupTabId, { method: request.method, count: (waiting?.count ?? 0) + 1 });
      let answered = false;
      const bound = new Map<chrome.runtime.Port, { message: (response: PortMessage) => void; disconnect: () => void }>();
      const unbind = (port: chrome.runtime.Port) => {
        const handlers = bound.get(port);
        if (!handlers) return;
        port.onMessage.removeListener(handlers.message);
        port.onDisconnect.removeListener(handlers.disconnect);
        bound.delete(port);
      };
      // A lock answers the dApp at once and closes the popup, which would otherwise
      // sit on the wallet list with the dApp waiting until the user closed it.
      const declineOnLock = () => {
        answer({ target: TARGET, sender: SENDER.extension, error: popupLockedError(request) });
        void Promise.resolve(chrome.tabs.remove(popupTabId)).catch(() => undefined);
      };
      popupLockDecliners.add(declineOnLock);
      const answer = (response: unknown) => {
        if (answered) return;
        answered = true;
        popupLockDecliners.delete(declineOnLock);
        const entry = popupWaiters.get(popupTabId);
        if (entry && --entry.count <= 0) popupWaiters.delete(popupTabId);
        chrome.runtime.onConnect.removeListener(connectionHandler);
        chrome.tabs.onRemoved.removeListener(tabsHandler);
        for (const port of [...bound.keys()]) unbind(port);
        resolve(response);
      };
      const declined = () => ({ target: TARGET, sender: SENDER.extension, error: popupDisconnectedError(request) });

      function tabsHandler(tabId: number) {
        if (tabId === popupTabId) answer(declined());
      }

      function connectionHandler(port: chrome.runtime.Port) {
        // Only handle connections from popup (not side panel)
        if (port.name !== 'internal-background-popup-communication') return;
        // Only our own extension pages may answer an approval: a content script
        // shares our sender.id, so the port name alone is not proof.
        if (!isOwnExtensionPageSender(port.sender, ownExtension())) return;
        // A popup page's port names its tab: another popup's port is never ours.
        const senderTab = port.sender?.tab?.id;
        if (senderTab !== undefined && senderTab !== popupTabId) return;

        let spokeForPopup = senderTab === popupTabId;
        const message = (response: PortMessage) => {
          if (response.tabId !== popupTabId) return;
          spokeForPopup = true;
          if (response.method === METHOD.requestData) {
            // Deep copy so a signing attempt never sees a mutated request.
            port.postMessage(JSON.parse(JSON.stringify(request)));
          }
          if (response.method === METHOD.returnData) answer(response);
        };
        // The user closed this popup (or its page died) without answering.
        const disconnect = () => {
          if (spokeForPopup) answer(declined());
          else unbind(port);
        };
        bound.set(port, { message, disconnect });
        port.onMessage.addListener(message);
        port.onDisconnect.addListener(disconnect);
      }

      chrome.runtime.onConnect.addListener(connectionHandler);
      chrome.tabs.onRemoved.addListener(tabsHandler);
    });
  },
  /**
   * The wallet locked: answer every request still waiting in an approval popup with
   * the locked refusal and close its popup. Nothing was signed for them, and nothing
   * can be until the user unlocks and the dApp asks again.
   */
  declinePopupApprovalsOnLock: function (): void {
    for (const decline of [...popupLockDecliners]) decline();
  },
  createInternalController: () => new InternalController(),
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
      const bitcoinFastPath = BITCOIN_DAPP_ENABLED && (
        request.method === BITCOIN_METHOD.enable ||
        request.method === BITCOIN_METHOD.isEnabled ||
        request.method === BITCOIN_METHOD.signPsbt ||
        request.method === BITCOIN_METHOD.signPsbts ||
        request.method === BITCOIN_METHOD.signMessage
      );
      if (
        request.method === METHOD.enable ||
        request.method === METHOD.isEnabled ||
        request.method === MIDNIGHT_METHOD.connect ||
        request.method === METHOD.signTx ||
        request.method === METHOD.signData ||
        request.method === MIDNIGHT_METHOD.signData ||
        request.method === MIDNIGHT_METHOD.makeTransfer ||
        request.method === MIDNIGHT_METHOD.balanceUnsealedTransaction ||
        request.method === MIDNIGHT_METHOD.makeIntent ||
        bitcoinFastPath
      ) {
        Messaging.sendToBackground({
          ...request,
        }).then((response) => window.postMessage(toPageReply(response, request.id)));
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
        window.postMessage(toPageReply(response, request.id));
      });
    });
  },
  createBackgroundController: () => new BackgroundController(),
};
