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
  isUserGesture?: boolean;
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
          console.log('tab', tab);
          console.log('chrome.runtime.lastError', chrome.runtime.lastError);
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

class InternalSidePanelController {
  port: chrome.runtime.Port;
  tabId: number;

  constructor(tabId: number) {
    this.tabId = tabId;
    if (chrome?.runtime) {
      this.port = chrome.runtime.connect({
        name: 'internal-background-sidepanel-communication',
      });
      if (!Number.isInteger(this.tabId)) {
        console.error("SidePanelController: invalid or missing tabId in URL!");
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
    return new Promise((resolve, _reject) =>
      chrome.runtime.sendMessage(
        { ...request, target: TARGET, sender: SENDER.options },
        (response) => resolve(response)
      )
    );
  },
  sendToBackground: async function (request: Message) {
    return new Promise((resolve, _reject) =>
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
            port.postMessage(request);
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
      chrome.runtime.onConnect.addListener(port => {
        function messageHandler(response: any) {
          if (response.tabId !== tabIdd) return;
          if (response.method === METHOD.requestData) {
            port.postMessage(request);
          }
          if (response.method === METHOD.returnData) {
            resolve(response);
          }
        }
        port.onMessage.addListener(messageHandler);
      });
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
