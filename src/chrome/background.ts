import { Messaging } from '@/chrome/messaging';
import {
  APIError,
  METHOD,
  POPUP,
  SENDER,
  STORAGE,
  TARGET,
  TxSendError,
} from '@/chrome/config';
import { bringInitBackground } from '@bringweb3/chrome-extension-kit';
import {
  getPublicKey,
  submitTx,
  focusOrCreatePopup,
  getUsedAddresses,
  getCollateral,
  getAddress,
  getUtxos,
  getBalance,
  getRewardAddress,
  getStakeKey,
  getDrepKey,
  urlScan,
  getUnusedAddresses,
  // convertToTxSchema,
} from '@/chrome/serialization';
import { ERROR } from '@/models/types';
import Tab = chrome.tabs.Tab;
import networks from '../shared/utils/networks';
import { getDomain } from 'tldts';
// import { setAccountTransactions } from '@/chrome/backgroundWalletDB';

if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client')
  // load latest content script
  import('./contentScriptHMR')
}

(async () => {
  await bringInitBackground({
    identifier: import.meta.env['VITE_CASHBACK_IDENTIFIER'],
    apiEndpoint: import.meta.env['VITE_CASHBACK_ENVIRONMENT'],
    cashbackPagePath: '/index.html#/cashback'
  })
})();

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'update') {
    const currentVersion = chrome.runtime.getManifest().version;
    chrome.notifications.create('updateNotification', {
      type: 'image',
      title: 'Extension Updated',
      message: `Gero Dashboard has been updated to version ${currentVersion}!`,
      iconUrl: chrome.runtime.getURL('public/logo128.png'),
      imageUrl: chrome.runtime.getURL('public/2.5.1.png'),
    });
  }
});
chrome.notifications.onClicked.addListener(function(notificationId) {
  if (notificationId === 'updateNotification') {
    // Perform your action here, for example, open a URL in a new tab
    chrome.tabs.create({ url: chrome.runtime.getURL("index.html#/?changeLog=true") });

    // Optionally, clear the notification if needed
    chrome.notifications.clear(notificationId);
  }
});

const processedDomains = new Set<string>();

chrome.storage.local.get(['processedDomains', 'lastCleared'], (result) => {
  const domains = result['processedDomains'] || [];
  domains.forEach((domain: string) => processedDomains.add(domain));
});

function clearProcessedDomains() {
  processedDomains.clear();
  chrome.storage.local.remove(['processedDomains', 'lastCleared'], () => {
    if (chrome.runtime.lastError) {
      console.error('Error removing processedDomains from storage:', chrome.runtime.lastError);
    } else {
      console.log('Processed domains have been cleared.');
    }
  });
}

// Set an interval to clear the processed domains every 24 hours (86,400,000 milliseconds)
const oneDayInMilliseconds = 24 * 60 * 60 * 1000;
setInterval(clearProcessedDomains, oneDayInMilliseconds);

console.log('Background Loaded');

let lastFullscreenTabId = -1;

const app = Messaging.createBackgroundController();

interface Response {
  data?: any;
  error?: any;
}

async function handleBlacklisted(request: any, tabId: number) {
  let urlStatus;
  try {
    const response = await urlScan(request.origin);
    urlStatus = await response.json();

    if (urlStatus === 'blacklist' || urlStatus === 'suspicious') {
      // Send the overlay message immediately
      await chrome.tabs.sendMessage(tabId, { action: 'showOverlay', url: request.origin });

      const popupURL = chrome.runtime.getURL(`index.html#/${POPUP.warning}?website=${encodeURIComponent(request.origin)}`);
      const popupResponse: any = await focusOrCreatePopup(popupURL, 470, 600)
        .then(tab => Messaging.sendToPopupInternal(tab, request))
        .then(response => response);
      return popupResponse;
    }
    return 'approved';
  } catch (error) {
    return error;
  }
}

chrome.webNavigation?.onCommitted.addListener(async (details) => {
  if (details.frameId === 0) { // Only consider top-level navigation
    const url = new URL(details.url);
    const origin = url.origin;
    const domain = getDomain(url.hostname);

    const request = {
      id: 'unique_id_' + Date.now(), // Generate a unique id
      origin: origin
    };

    if (domain && !processedDomains.has(domain)) {
      const res = await handleBlacklisted(request, details.tabId);
      if (res['data'] === 'proceed') {
        processedDomains.add(domain);
        await chrome.storage.local.set({ processedDomains: Array.from(processedDomains) });
        await chrome.tabs.sendMessage(details.tabId, { action: 'removeOverlay', url: request.origin });
      } else if (res['data'] === 'safety') {
        await chrome.tabs.update(details.tabId, { url: 'https://www.google.com' });
      } else if (res['data'] === 'report') {
        await chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL(`index.html#/transactions?website=${request.origin}`) });
      } else if (res === 'approved') {
        processedDomains.add(domain);
        await chrome.storage.local.set({ processedDomains: Array.from(processedDomains) });
      } else {
        console.log(res['error'])
      }
    }
  }
});

app.add(METHOD.getBalance, async (request, sendResponse) => {
  console.log('getBalance', request)
  try {
    const collateral = await getStorage(STORAGE.collateral);
    const utxosFromStorage = await getStorage(STORAGE.utxos);
    const balance = getBalance(utxosFromStorage, collateral)
    sendResponse({
      id: request.id,
      data: balance.toCbor(),
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (e) {
    sendResponse({
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
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
  console.log('getAddress', request)
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet || !loggedWallet.publicKey) {
    sendResponse({
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  const address = await getAddress(loggedWallet.publicKey, loggedWallet.chain, loggedWallet.network);
  if (address) {
    sendResponse({
      id: request.id,
      data: address.toBytes(),
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

app.add(METHOD.getAddressBech32, async (request, sendResponse) => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet || !loggedWallet.publicKey) {
    sendResponse({
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  const address = getAddress(loggedWallet.publicKey, loggedWallet.chain, loggedWallet.network);
  if (address) {
    sendResponse({
      id: request.id,
      data: address.toBech32(),
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
  console.log(request.origin)
  if (whitelisted) {
    sendResponse({
      data: whitelisted,
      target: TARGET,
      sender: SENDER.extension,
    });
  } else {
    console.log('refuse')
    sendResponse({
      error: APIError.Refused,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

interface WhitelistedEntry {
  domain: string;
  id: number;
}

async function isWhitelisted(origin: string): Promise<boolean> {
  const whitelisted: WhitelistedEntry[] = await getWhitelisted();
  const bringDomains = await getStorage('bring_relevantDomains')
  if (whitelisted.find(el => origin.includes(el.domain))) return true;
  return !!(bringDomains && bringDomains.find(el => origin.includes(el)));
}

async function getWhitelisted(): Promise<WhitelistedEntry[]> {
  const result = await getStorage(STORAGE.whitelisted);
  return Array.isArray(result) ? result : [];
}

app.add(METHOD.getNetworkId, async (request, sendResponse) => {
  console.log('getNetworkId', request)
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
  console.log('getRewardAddresses', request)
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet) {
    sendResponse({
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    });
  } else {
    const address = getRewardAddress(loggedWallet.publicKey, loggedWallet.chain, loggedWallet.network);
    sendResponse({
      id: request.id,
      data: [address.toBytes()],
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.getUtxos, async (request, sendResponse) => {
  console.log('getUtxos', request)
  try {
    const utxosFromStorage = await getStorage(STORAGE.utxos);
    const collateral = await getStorage(STORAGE.collateral);
    const utxos = getUtxos(request.data.amount, request.data.paginate, utxosFromStorage, collateral)
    let res: string[] | null;
    if (utxos) {
      // LEGACY support => TODO change in the future
      res = utxos.map((utxo) => utxo.toCbor())
    } else {
      res = null
    }
    sendResponse({
      id: request.id,
      data: res,
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (e) {
    sendResponse({
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.getCollateral, async (request, sendResponse) => {
  const storedUtxos = await getStorage(STORAGE.utxos);
  try {
    const utxos: string[] =  getCollateral(request.data.params, storedUtxos)
    sendResponse({
      id: request.id,
      data: utxos,
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (e) {
    sendResponse({
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.getUsedAddresses, async (request, sendResponse) => {
  console.log('getUsedAddresses', request)
  try {
    const addresses = getUsedAddresses(await getStorage(STORAGE.addresses), request?.data?.paginate);
    sendResponse({
      id: request.id,
      data: addresses,
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (e) {
    sendResponse({
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.getUnusedAddresses, async (request, sendResponse) => {
  console.log('getUnusedAddresses', request)
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  const addresses = await getStorage(STORAGE.addresses)
  try {
    const addressesRes = getUnusedAddresses(loggedWallet.publicKey, loggedWallet.chain, loggedWallet.network, addresses);
    sendResponse({
      id: request.id,
      data: addressesRes,
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (e) {
    sendResponse({
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.popupLogin, async (request, sendResponse) => {
  try {
    const popupURL: string = chrome.runtime.getURL(`index.html#/${POPUP.login}`);
    const response: Response = await focusOrCreatePopup(popupURL, 470, 600)
      .then((tab) => Messaging.sendToPopupInternal(tab, request))
      .then((response) => response);
    sendResponse({
      id: request.id,
      data: response.data,
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (e) {
    sendResponse({
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.signData, async (request, sendResponse) => {
  try {
    const popupURL: string = chrome.runtime.getURL(`index.html#/${POPUP.dappSignData}?website=${encodeURIComponent(request.origin)}`);
    await focusOrCreatePopup(popupURL, 470, 600)
      .then((tab: Tab) => Messaging.sendToPopupInternal(tab, request))
      .then((response: any) => {
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
      });
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
    const popupURL: string = chrome.runtime.getURL(`index.html#/${POPUP.signTx}?website=${encodeURIComponent(request.origin)}`);
    const tab: Tab = await focusOrCreatePopup(popupURL, 470, 852);
    const response: any = await Messaging.sendToPopupInternal(tab, request);
    console.log(response)
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

app.add(METHOD.submitTx, async (request, sendResponse) => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet || !loggedWallet.publicKey) {
    sendResponse({
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    });
  }

  submitTx(request.data.tx, loggedWallet['chain'], loggedWallet['network'])
    .then(async (response: any) => {
      if (!response.ok) {
        switch (response.status) {
          case 400:
            throw { ...TxSendError.Failure, message: response.statusText };
          case 500:
            throw APIError.InternalError;
          case 429:
            throw TxSendError.Refused;
          case 425:
            throw ERROR.fullMempool;
          default:
            throw APIError.InvalidRequest;
        }
      }
      // const utxos = await getStorage(STORAGE.utxos);
      // const txCbor = request.data.tx
      const txId = await response.text();
      // const tx = convertToTxSchema(txId, txCbor, utxos, networks.resolveNetworkId(loggedWallet['chain'], loggedWallet['network']))
      // await setAccountTransactions(loggedWallet.id, [tx])
      sendResponse({
        id: request.id,
        data: txId,
        target: TARGET,
        sender: SENDER.extension,
      });
    })
    .catch(e => {
      return {
        id: request.id,
        error: e,
        target: TARGET,
        sender: SENDER.extension,
      };
    });
});

app.add(METHOD.getPubDRepKey, async (request, sendResponse) => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet || !loggedWallet.publicKey) {
    sendResponse({
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  try {
    const key = getDrepKey(loggedWallet.publicKey, 0);
    sendResponse({
      id: request.id,
      data: key.hex(),
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error("Error deserializing Drep key:", error);
    sendResponse({
      id: request.id,
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.getRegisteredPubStakeKeys, async (request, sendResponse) => {
  try {
    const account = await getStorage(STORAGE.account);
    if (!account) {
      sendResponse({
        id: request.id,
        error: APIError.Refused,
        target: TARGET,
        sender: SENDER.extension,
      });
    }
    if (account.active) {
      const loggedWallet = await getStorage(STORAGE.loggedWallet);
      if (!loggedWallet || !loggedWallet.publicKey) {
        sendResponse({
          id: request.id,
          error: APIError.AccountNotSet,
          target: TARGET,
          sender: SENDER.extension,
        });
      }
      const key: string = getStakeKey(loggedWallet.publicKey, 0).hex()
      if (key) {
        sendResponse({
          id: request.id,
          data: [key],
          target: TARGET,
          sender: SENDER.extension,
        });
      } else {
        sendResponse({
          id: request.id,
          data: [],
          target: TARGET,
          sender: SENDER.extension,
        });
      }
    }
  } catch (error) {
    console.error("Error in getUnregisteredPubStakeKeys:", error);
    sendResponse({
      id: request.id,
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.getUnregisteredPubStakeKeys, async (request, sendResponse) => {
  try {
    const account = await getStorage(STORAGE.account);
    if (!account) {
      sendResponse({
        id: request.id,
        error: APIError.Refused,
        target: TARGET,
        sender: SENDER.extension,
      });
    }
    if (account.active) {
      const loggedWallet = await getStorage(STORAGE.loggedWallet);
      if (!loggedWallet || !loggedWallet.publicKey) {
        sendResponse({
          id: request.id,
          error: APIError.AccountNotSet,
          target: TARGET,
          sender: SENDER.extension,
        });
      }
      const key: string = getStakeKey(loggedWallet.publicKey, 0).hex()
      if (key) {
        sendResponse({
          id: request.id,
          data: [],
          target: TARGET,
          sender: SENDER.extension,
        });
      } else {
        sendResponse({
          id: request.id,
          data: [key],
          target: TARGET,
          sender: SENDER.extension,
        });
      }
    }
  } catch (error) {
    console.error("Error in getUnregisteredPubStakeKeys:", error);
    sendResponse({
      id: request.id,
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.add(METHOD.getAccountPub, async (request, sendResponse) => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet || !loggedWallet.publicKey) {
    sendResponse({
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  try {
    const key = getPublicKey(loggedWallet.publicKey).toRawKey().hex();
    sendResponse({
      id: request.id,
      data: key,
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error("Error deserializing public key:", error);
    sendResponse({
      id: request.id,
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

const getStorage = (key) =>
  new Promise<any>((res, rej) =>
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) rej(undefined);
      res(key ? result[key] : result);
    }),
  );

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

chrome.action.onClicked.addListener(openUI);

app.listen();
