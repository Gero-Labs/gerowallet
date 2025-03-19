import { APIError, METHOD, SENDER, TARGET } from '@/chrome/config';

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

export const Messaging = {
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
  sendToPopupInternal: function (tab: chrome.tabs.Tab, request: Message) {
    return new Promise((resolve, _reject) => {
      chrome.runtime.onConnect.addListener(function connectionHandler(port) {
        function messageHandler(response: any) {
          if (response.tabId !== tab.id) return;
          if (response.method === METHOD.requestData) {
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
  createInternalController: () => new InternalController(),
};
