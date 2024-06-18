import {
  focusOrCreatePopup,
  extractKeyHash,
  getAddress,
  getBalance,
  getStorage,
  isWhitelisted,
  verifyPayload,
  verifyTx,
  getUsedAddresses,
  getRewardAddresses,
  getUtxos
} from './extension';
import { Messaging } from './messaging';
import {
  APIError,
  METHOD,
  POPUP,
  SENDER,
  STORAGE,
  TARGET,
} from './config';
import networks from '@/shared/utils/networks';
import { TransactionUnspentOutput } from '@emurgo/cardano-serialization-lib-browser';

console.log('Background Loaded');

let lastFullscreenTabId = -1;

const app = Messaging.createBackgroundController();

interface Response {
  data?: any;
  error?: any;
}

app.add(METHOD.getBalance, (request, sendResponse) => {
  console.log('getBalance')
  getBalance()
    .then((value) => {
      sendResponse({
        id: request.id,
        data: Buffer.from(value.to_bytes()).toString('hex'),
        target: TARGET,
        sender: SENDER.extension,
      });
    })
    .catch((e) => {
      sendResponse({
        id: request.id,
        error: e,
        target: TARGET,
        sender: SENDER.extension,
      });
    });
});

app.add(METHOD.enable, async (request, sendResponse) => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet) {
    sendResponse({
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    });
  } else {
    try {
      const whitelisted = await isWhitelisted(request.origin);
      if (whitelisted) {
        sendResponse({
          id: request.id,
          data: true,
          target: TARGET,
          sender: SENDER.extension,
        });
      } else {
        const popupURL: string = chrome.runtime.getURL(`index.html#/${POPUP.dappConnect}?website=${encodeURIComponent(request.origin)}`);
        const response: Response = await focusOrCreatePopup(popupURL, 470, 600)
          .then(tab => Messaging.sendToPopupInternal(tab, request))
          .then(response => response);
        if (response.data === true) {
          sendResponse({
            id: request.id,
            data: true,
            target: TARGET,
            sender: SENDER.extension,
          });
        } else if (response.error) {
          sendResponse({
            id: request.id,
            error: response.error,
            target: TARGET,
            sender: SENDER.extension,
          });
        } else {
          sendResponse({
            id: request.id,
            error: APIError.InternalError,
            target: TARGET,
            sender: SENDER.extension,
          });
        }
      }
    } catch (error) {
      sendResponse({
        id: request.id,
        error: APIError.InternalError,
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  }
});

app.add(METHOD.isEnabled, (request, sendResponse) => {
  isWhitelisted(request.origin)
    .then((whitelisted) => {
      sendResponse({
        id: request.id,
        data: whitelisted,
        target: TARGET,
        sender: SENDER.extension,
      });
    })
    .catch(() => {
      sendResponse({
        id: request.id,
        error: APIError.InternalError,
        target: TARGET,
        sender: SENDER.extension,
      });
    });
});

app.add(METHOD.getAddress, async (request, sendResponse) => {
  const address = await getAddress();
  if (address) {
    sendResponse({
      id: request.id,
      data: address,
      target: TARGET,
      sender: SENDER.extension,
    });
  } else {
    sendResponse({
      id: request.id,
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.isWhitelisted, async (request, sendResponse) => {
  const whitelisted = await isWhitelisted(request.origin);
  if (whitelisted) {
    sendResponse({
      data: whitelisted,
      target: TARGET,
      sender: SENDER.extension,
    });
  } else {
    sendResponse({
      error: APIError.Refused,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.getNetworkId, async (request, sendResponse) => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet) {
    sendResponse({
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    });
  } else {
    sendResponse({
      id: request.id,
      data: networks.resolveNetworkId(loggedWallet['chain'], loggedWallet['network']),
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.getRewardAddresses, async (request, sendResponse) => {
  const addresses = await getRewardAddresses();
  sendResponse({
    id: request.id,
    data: addresses,
    target: TARGET,
    sender: SENDER.extension,
  });
});

app.add(METHOD.getUtxos, (request, sendResponse) => {
  getUtxos(request.data.amount, request.data.paginate)
    .then((utxos: TransactionUnspentOutput[]) => {
      let res: string[] | null;
      if (utxos) {
        // LEGACY support => TODO change in the future
        res = utxos.map((utxo) => Buffer.from(utxo.to_bytes()).toString('hex'))
      } else {
        res = null
      }
      sendResponse({
        id: request.id,
        data: res,
        target: TARGET,
        sender: SENDER.extension,
      });
    })
    .catch((e) => {
      sendResponse({
        id: request.id,
        error: e,
        target: TARGET,
        sender: SENDER.extension,
      });
    });
});

app.add(METHOD.getUsedAddresses, async (request, sendResponse) => {
  const addresses = await getUsedAddresses(request?.data?.paginate);
  sendResponse({
    id: request.id,
    data: addresses,
    target: TARGET,
    sender: SENDER.extension,
  });
});

app.add(METHOD.signData, async (request, sendResponse) => {
  try {
    console.log(request)
    verifyPayload(request.data.payload);
    try {
      await extractKeyHash(request.data.address);
    } catch (e) {
      console.log(e)
      throw e
    }
    const popupURL: string = chrome.runtime.getURL(`index.html#/${POPUP.dappSignData}?website=${encodeURIComponent(request.origin)}`);
    const response: Response = await focusOrCreatePopup(popupURL, 470, 600)
      .then((tab) => Messaging.sendToPopupInternal(tab, request))
      .then((response) => response);

    if (response.data) {
      sendResponse({
        id: request.id,
        data: response.data,
        target: TARGET,
        sender: SENDER.extension,
      });
    } else if (response.error) {
      sendResponse({
        id: request.id,
        error: response.error,
        target: TARGET,
        sender: SENDER.extension,
      });
    } else {
      sendResponse({
        id: request.id,
        error: APIError.InternalError,
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  } catch (e) {
    sendResponse({
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.signTx, async (request, sendResponse) => {
  try {
    await verifyTx(request.data.tx);
    const popupURL: string = chrome.runtime.getURL(`index.html#/${POPUP.signTx}?website=${encodeURIComponent(request.origin)}`);
    const response: Response = await focusOrCreatePopup(popupURL, 470, 852)
      .then((tab) => Messaging.sendToPopupInternal(tab, request))
      .then((response) => response);
    if (response.data) {
      sendResponse({
        id: request.id,
        data: response.data,
        target: TARGET,
        sender: SENDER.extension,
      });
    } else if (response.error) {
      sendResponse({
        id: request.id,
        error: response.error,
        target: TARGET,
        sender: SENDER.extension,
      });
    } else {
      sendResponse({
        id: request.id,
        error: APIError.InternalError,
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  } catch (e) {
    sendResponse({
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

// Check if a specific tab is open
const checkTabOpen = (tabId) => {
  return new Promise((resolve) => {
    const url = chrome.runtime.getURL("*");
    chrome.tabs.query({ url }, function (tabList) {
      let isTabOpen = false;
      for (let i = 0; i < tabList.length; i++) {
        const tmpTab = tabList[i];
        if (tmpTab && tmpTab.id === tabId) {
          isTabOpen = true;
          break;
        }
      }
      resolve(isTabOpen);
    });
  });
};

// Open the dashboard in a new tab or focus an existing tab
const openDashboard = () => {
  return new Promise((resolve) => {
    checkTabOpen(lastFullscreenTabId).then((isOpen) => {
      if (!isOpen) {
        chrome.tabs.create({
          url: chrome.runtime.getURL("index.html"),
          active: true
        }, (tab) => {
          lastFullscreenTabId = tab?.id ?? -1;
          const popupTabId = lastFullscreenTabId;
          const handleRemove = (tabId) => {
            if (tabId === popupTabId) {
              chrome.tabs.onRemoved.removeListener(handleRemove);
            }
          };
          chrome.tabs.onRemoved.addListener(handleRemove);
          return resolve(true);
        });
      } else {
        chrome.tabs.update(lastFullscreenTabId, { selected: true });
        chrome.windows.getAll({ populate: true, windowTypes: ["normal", "popup"] }, (list) => {
          for (const win of list) {
            if (win.id && win.tabs) {
              for (const tab of win.tabs) {
                if (tab.id === lastFullscreenTabId) {
                  chrome.windows.update(win.id, { focused: true });
                  break;
                }
              }
            }
          }
        });
        resolve(true);
      }
    });
  });
};

const openUI = async () => {
  await openDashboard();
};

if (chrome?.action) {
  chrome.action.onClicked.addListener(openUI);
}

app.listen();
