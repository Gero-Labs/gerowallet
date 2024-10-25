import { APIError, METHOD, SENDER, TARGET } from './config';

interface Message {
  method?: string;
  data?: any;
  error?: string;
  sender?: string;
  target?: string;
  id?: string;
  origin?: string;
  event?: string;
}

class InternalController {
  port: chrome.runtime.Port;
  tabId: Promise<number>;

  constructor() {
    if (chrome?.runtime) {
      this.port = chrome.runtime.connect({
        name: 'internal-background-popup-communication',
      });
      this.tabId = new Promise((resolve, reject) =>
        chrome.tabs.getCurrent((tab) => {
          if (chrome.runtime.lastError || !tab) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(tab.id!);
          }
        })
      );
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

class BackgroundController {
  private _methodList: { [key: string]: (request: any, sendResponse: any) => void } = {};

  add = (method: string, func: (request: any, sendResponse: any) => void) => {
    this._methodList[method] = func;
  };

  listen = () => {
    if (chrome?.runtime) {
      chrome.runtime.onMessage.addListener((request, _, sendResponse) => {
        console.log(request)
        if (request.sender === SENDER.webpage) {
          this._methodList[request.method](request, sendResponse);
        }
        return true;
      });
    }
  };
}

export const Messaging = {
  sendToBackground: async function (request: Message) {
    return new Promise((resolve, reject) =>
      chrome.runtime.sendMessage(
        { ...request, target: TARGET, sender: SENDER.webpage },
        (response) => resolve(response)
      )
    );
  },
  sendToContent: function ({ method, data }: { method: string; data: any }) {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substr(2, 9);
      function responseHandler(e: MessageEvent) {
        console.log('message', e)
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
  sendToPopupInternal: function (tab: chrome.tabs.Tab, request: Message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.onConnect.addListener(function connetionHandler(port) {
        function messageHandler(response: any) {
          if (response.tabId !== tab.id) return;
          if (response.method === METHOD.requestData) {
            console.log('sending Request', request)
            port.postMessage(request);
          }
          if (response.method === METHOD.returnData) {
            resolve(response);
          }
          chrome.tabs.onRemoved.addListener(function tabsHandler(tabId) {
            if (tab.id !== tabId) return;
            resolve({
              target: TARGET,
              sender: SENDER.extension,
              error: APIError.Refused,
            });
            if (chrome?.runtime) {
              chrome.runtime.onConnect.removeListener(connetionHandler);
            }
            port.onMessage.removeListener(messageHandler);
            chrome.tabs.onRemoved.removeListener(tabsHandler);
          });
        }
        port.onMessage.addListener(messageHandler);
      });
    });
  },
  createInternalController: () => new InternalController(),
  createProxyController: () => {
    // listen to events from background
    if (chrome?.runtime) {
      chrome.runtime.onMessage.addListener(async (response) => {
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
      const blacklisted = await Messaging.sendToBackground({
        method: METHOD.blacklisted,
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
