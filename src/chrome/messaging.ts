import { APIError, METHOD, SENDER, TARGET } from './config';
import { Cardano } from '@cardano-sdk/core';

interface Message {
  method?: string;
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
 * Generic wrapper for responses from background script
 * @template T - The response data type
 */
export interface BackgroundResponse<T = any> {
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
      return new Promise((resolve, reject) => {
        chrome.tabs.getCurrent((tab) => {
          if (!tab) {
            reject('Tab not found');
            return;
          }

          const tabId = tab.id;
          const self = this;

          function messageHandler(response: any) {
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

  returnData = async ({ data, error }: { data: any; error: any }) => {
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

  public async requestData(): Promise<{ data: any; error?: any }> {
    return new Promise((resolve, _reject) => {
      const self = this;

      function messageHandler(response: any) {
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

  public async returnData({ data, error }: { data: any; error: any }) {
    this.port.postMessage({
      method: METHOD.returnData,
      tabId: this.tabId,
      data,
      error,
    });
  }
}

class BackgroundController {
  private methodList: { [key: string]: (request: any, sendResponse: any) => void } = {};
  private optionsMethodList: { [key: string]: (request: any, sendResponse: any) => void } = {};

  add = (method: string, func: (request: any, sendResponse: any) => void) => {
    this.methodList[method] = func;
  };

  addToOptions = (method: string, func: (request: any, sendResponse: any) => void) => {
    this.optionsMethodList[method] = func;
  };

  // listens to events from webpage / options / side panel to background
  listen = () => {
    if (chrome?.runtime) {
      chrome.runtime.onMessage.addListener((request, sender: chrome.runtime.MessageSender, sendResponse) => {
        request.send = sender
        if (request.sender === SENDER.webpage) {
          this.methodList[request.method](request, sendResponse);
        } else if (request.sender === SENDER.options) {
          this.optionsMethodList[request.method](request, sendResponse);
        }
        return true;
      });
    }
  };
}

export const Messaging = {
  sendToBackgroundFromOptions: async function (request: Message) {
    return new Promise((resolve, reject) => {
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
    return new Promise((resolve, reject) => {
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
  sendToContent: function ({ method, data }: { method: string; data: any }) {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substr(2, 9);
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
        function messageHandler(response: any) {
          if (response.tabId !== tabIdd) return;
          if (response.method === METHOD.requestData) {
            // Create a deep copy of the request to prevent mutations from affecting the original
            // This is critical for transaction signing to ensure each signing attempt gets fresh data
            const requestCopy = JSON.parse(JSON.stringify(request));
            port.postMessage(requestCopy);
          }
          if (response.method === METHOD.returnData) {
            resolve(response);
          }
          chrome.tabs.onRemoved.addListener(function tabsHandler(tabId) {
            if (tabIdd !== tabId) return;
            resolve({
              target: TARGET,
              sender: SENDER.extension,
              error: APIError.Refused,
            });
            if (chrome?.runtime) {
              chrome.runtime.onConnect.removeListener(connectionHandler);
            }
            port.onMessage.removeListener(messageHandler);
            chrome.tabs.onRemoved.removeListener(tabsHandler);
          });
        }
        port.onMessage.addListener(messageHandler);
      });
    });
  },
  sendToSidePanelInternal: function (tabIdd: number, request: Message) {
    return new Promise((resolve, _reject) => {
      // Remove any existing listeners for this tab before adding new one
      // This prevents old listeners from responding with stale request data
      if ((this as any)._sidePanelListeners?.[tabIdd]) {
        const oldListener = (this as any)._sidePanelListeners[tabIdd];
        chrome.runtime.onConnect.removeListener(oldListener);
      }

      function connectionHandler(port: chrome.runtime.Port) {
        function messageHandler(response: any) {
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
          // Resolve with user declined error when side panel closes without response
          resolve({
            target: TARGET,
            sender: SENDER.extension,
            error: APIError.Refused,
            data: undefined
          });
        }

        function cleanup() {
          port.onMessage.removeListener(messageHandler);
          port.onDisconnect.removeListener(disconnectHandler);
          chrome.runtime.onConnect.removeListener(connectionHandler);
          // Clean up listener tracking
          if ((Messaging as any)._sidePanelListeners?.[tabIdd] === connectionHandler) {
            delete (Messaging as any)._sidePanelListeners[tabIdd];
          }
        }

        port.onMessage.addListener(messageHandler);
        port.onDisconnect.addListener(disconnectHandler);
      }

      // Track the listener so we can remove it later
      if (!(this as any)._sidePanelListeners) {
        (this as any)._sidePanelListeners = {};
      }
      (this as any)._sidePanelListeners[tabIdd] = connectionHandler;

      chrome.runtime.onConnect.addListener(connectionHandler);
    });
  },
  createInternalController: () => new InternalController(),
  createInternalSidePanelController: (tabid) => new InternalSidePanelController(tabid),
  createProxyController: () => {
    // listen to events from background
    if (chrome?.runtime) {
      chrome.runtime.onMessage.addListener(async (response) => {
        console.log('response', response);
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
        if (!whitelisted || (whitelisted as any).error) return;
        const event = new CustomEvent(`${TARGET}${response.event}`, {
          detail: response.data,
        });

        window.dispatchEvent(event);
      });
    }
    // listen to function calls from webpage
    window.addEventListener('message', async function (e) {
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
      if (
        request.method === METHOD.enable ||
        request.method === METHOD.isEnabled
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
      if (!whitelisted || (whitelisted as any).error) {
        window.postMessage({ ...whitelisted as object, id: request.id });
        return;
      }
      await Messaging.sendToBackground(request).then((response) => {
        window.postMessage(response);
      });
    });
  },
  createBackgroundController: () => new BackgroundController(),
};
