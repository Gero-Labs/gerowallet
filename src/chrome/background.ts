import { onMessage } from 'webext-bridge/background'
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
  getRewardAddresses,
  getStakeKey,
  getDrepKey,
  urlScan,
} from '@/chrome/serialization';
import { ERROR } from '@/models/types';
import Tab = chrome.tabs.Tab;
import networks from '../shared/utils/networks';
import { getDomain } from 'tldts';

if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client')
  // load latest content script
  import('./contentScriptHMR')
}

// TODO Use Env Variables
(async () => {
  await bringInitBackground({
    identifier: '94cnbcoEYv5A6z1yxSizi8RAa7kq71nq6miZeSNh',
    apiEndpoint: 'prod',
    cashbackPagePath: '/index.html#/cashback'
  })
})();

chrome.runtime.onInstalled.addListener((details) => {
  console.log(details);
  if (details.reason === 'update') {
    const currentVersion = chrome.runtime.getManifest().version;
    chrome.notifications.create('updateNotification', {
      type: 'image',
      title: 'Extension Updated',
      message: `Your extension has been updated to version ${currentVersion}!`,
      iconUrl: chrome.runtime.getURL('assets/logo128.png'),
      imageUrl: chrome.runtime.getURL('assets/logo.png'),
    });
  }
});
chrome.notifications.onClicked.addListener(function(notificationId) {
  if (notificationId === 'updateNotification') {
    // Perform your action here, for example, open a URL in a new tab
    chrome.tabs.create({ url: 'https://google.com' });

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

async function getBalanceCip30(request: any): Promise<any> {
  const utxosFromStorage = await getStorage(STORAGE.utxos);
  if (!utxosFromStorage) {
    return {
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    };
  } else {
    const balance = getBalance(utxosFromStorage);
    return {
      id: request.id,
      data: balance.toCbor(),
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function enable(request: any): Promise<any> {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet) {
    return {
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    };
  } else {
    try {
      const whitelisted = await isWhitelisted(request.origin);
      if (whitelisted) {
        return {
          id: request.id,
          data: true,
          target: TARGET,
          sender: SENDER.extension,
        };
      } else {
        const popupURL: string = chrome.runtime.getURL(`index.html#/${POPUP.dappConnect}?website=${encodeURIComponent(request.origin)}`);
        const response: any = await focusOrCreatePopup(popupURL, 470, 600)
          .then(tab => Messaging.sendToPopupInternal(tab, request))
          .then(response => response);
        if (response.data === true) {
          return {
            id: request.id,
            data: true,
            target: TARGET,
            sender: SENDER.extension,
          };
        } else if (response.error) {
          return {
            id: request.id,
            error: response.error,
            target: TARGET,
            sender: SENDER.extension,
          };
        } else {
          return {
            id: request.id,
            error: APIError.InternalError,
            target: TARGET,
            sender: SENDER.extension,
          };
        }
      }
    } catch (error) {
      return {
        id: request.id,
        error: APIError.InternalError,
        target: TARGET,
        sender: SENDER.extension,
      };
    }
  }
}

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

async function isEnabled(request: any): Promise<any> {
  try {
    const whitelisted = await isWhitelisted(request.origin)
    return {
      id: request.id,
      data: whitelisted,
      target: TARGET,
      sender: SENDER.extension,
    };
  } catch (error) {
    console.log(error);
    return {
      id: request.id,
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function getAddressCip30(request: any): Promise<any> {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet || !loggedWallet.publicKey) {
    return {
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
  const address = getAddress(loggedWallet.publicKey, loggedWallet.chain, loggedWallet.network);
  if (address) {
    return {
      id: request.id,
      data: address.toBytes(),
      target: TARGET,
      sender: SENDER.extension,
    };
  } else {
    return {
      id: request.id,
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function getAddressBech32(request: any): Promise<any> {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet || !loggedWallet.publicKey) {
    return {
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
  const address = getAddress(loggedWallet.publicKey, loggedWallet.chain, loggedWallet.network);
  if (address) {
    return {
      id: request.id,
      data: address.toBech32(),
      target: TARGET,
      sender: SENDER.extension,
    };
  } else {
    return {
      id: request.id,
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function isWhitelistedCip30(request: any): Promise<any> {
  const whitelisted = await isWhitelisted(request.origin);
  console.debug('Background::isWhitelisted:origin', request.origin)
  if (whitelisted) {
    return {
      data: whitelisted,
      target: TARGET,
      sender: SENDER.extension,
    };
  } else {
    console.debug('refuse')
    return {
      error: APIError.Refused,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function getNetworkId(request: any): Promise<any> {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet) {
    return {
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    };
  } else {
    return {
      id: request.id,
      data: networks.resolveNetworkId(loggedWallet['chain'], loggedWallet['network']),
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function getRewardAddressesCip30(request: any): Promise<any> {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet) {
    return {
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    };
  } else {
    const addresses = getRewardAddresses(loggedWallet.publicKey, loggedWallet.chain, loggedWallet.network);
    return {
      id: request.id,
      data: addresses,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function getUtxosCip30(request: any): Promise<any> {
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
  return {
    id: request.id,
    data: res,
    target: TARGET,
    sender: SENDER.extension,
  };
}

async function getCollateralCip30(request: any): Promise<any> {
  console.log('Background::getCollateralCip30:request', JSON.stringify(request.data));
  const storedUtxos = await getStorage(STORAGE.utxos);
  try {
    const utxos = getCollateral(request.data.params, storedUtxos)
    const res: string[] = utxos.map((utxo) => utxo.toCbor());
    console.log(res)
    return {
      id: request.id,
      data: res,
      target: TARGET,
      sender: SENDER.extension,
    };
  } catch (e) {
    return {
      id: request.id,
      data: e,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function getUsedAddressesCip30(request: any): Promise<any> {
  try {
    const addresses = getUsedAddresses(await getStorage(STORAGE.addresses), request?.data?.paginate);
    return {
      id: request.id,
      data: addresses,
      target: TARGET,
      sender: SENDER.extension,
    };
  } catch (e) {
    return {
      id: request.id,
      data: e,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function popupLogin(request: any): Promise<any> {
  try {
    const popupURL: string = chrome.runtime.getURL(`index.html#/${POPUP.login}`);
    const response: any = await focusOrCreatePopup(popupURL, 470, 600)
      .then((tab: Tab) => Messaging.sendToPopupInternal(tab, request))
    return {
      id: request.id,
      data: response.data,
      target: TARGET,
      sender: SENDER.extension,
    };
  } catch (e) {
    return {
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function signData(request: any): Promise<any> {
  try {
    const popupURL: string = chrome.runtime.getURL(`index.html#/${POPUP.dappSignData}?website=${encodeURIComponent(request.origin)}`);
    await focusOrCreatePopup(popupURL, 470, 600)
      .then((tab: Tab) => Messaging.sendToPopupInternal(tab, request))
      .then((response: any) => {
        if (response.data) {
          return {
            id: request.id,
            data: response.data,
            target: TARGET,
            sender: SENDER.extension,
          };
        } else if (response.error) {
          return {
            id: request.id,
            error: response.error,
            target: TARGET,
            sender: SENDER.extension,
          };
        } else {
          return {
            id: request.id,
            error: APIError.InternalError,
            target: TARGET,
            sender: SENDER.extension,
          };
        }
      });
  } catch (e) {
    return {
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function signTx(request: any): Promise<any> {
  try {
    const popupURL: string = chrome.runtime.getURL(`index.html#/${POPUP.signTx}?website=${encodeURIComponent(request.origin)}`);
    await focusOrCreatePopup(popupURL, 470, 852)
      .then((tab: Tab) => Messaging.sendToPopupInternal(tab, request))
      .then((response: any) => {
        if (response.data) {
          return {
            id: request.id,
            data: response.data,
            target: TARGET,
            sender: SENDER.extension,
          };
        } else if (response.error) {
          return {
            id: request.id,
            error: response.error,
            target: TARGET,
            sender: SENDER.extension,
          };
        } else {
          return {
            id: request.id,
            error: APIError.InternalError,
            target: TARGET,
            sender: SENDER.extension,
          };
        }
      });
  } catch (e) {
    return {
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function submitTxCip30(request: any): Promise<any> {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet || !loggedWallet.publicKey) {
    return {
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    };
  }

  submitTx(request.data.tx, loggedWallet['chain'], loggedWallet['network'])
    .then(async (response: Response) => {
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
      return {
        id: request.id,
        data: await response.text(),
        target: TARGET,
        sender: SENDER.extension,
      };
    })
    .catch(e => {
      return {
        id: request.id,
        error: e,
        target: TARGET,
        sender: SENDER.extension,
      };
    });
}

async function getPubDRepKey(request: any): Promise<any> {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  if (!loggedWallet || !loggedWallet.publicKey) {
    return {
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    };
  }

  try {
    const key = getDrepKey(loggedWallet.publicKey, 0);
    return {
      id: request.id,
      data: key.hex(),
      target: TARGET,
      sender: SENDER.extension,
    };
  } catch (error) {
    console.error("Error deserializing Drep key:", error);
    return {
      id: request.id,
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function getRegisteredPubStakeKeys(request: any): Promise<any> {
  try {
    const account = await getStorage(STORAGE.account);
    if (!account) {
      return {
        id: request.id,
        error: APIError.Refused,
        target: TARGET,
        sender: SENDER.extension,
      };
    }
    if (account.active) {
      const loggedWallet = await getStorage(STORAGE.loggedWallet);
      if (!loggedWallet || !loggedWallet.publicKey) {
        return {
          id: request.id,
          error: APIError.AccountNotSet,
          target: TARGET,
          sender: SENDER.extension,
        };
      }
      const key: string = getStakeKey(loggedWallet.publicKey, 0).hex()
      if (key) {
        return {
          id: request.id,
          data: [key],
          target: TARGET,
          sender: SENDER.extension,
        };
      } else {
        return {
          id: request.id,
          data: [],
          target: TARGET,
          sender: SENDER.extension,
        };
      }
    }
  } catch (error) {
    console.error("Error in getUnregisteredPubStakeKeys:", error);
    return {
      id: request.id,
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function getUnregisteredPubStakeKeys(request: any): Promise<any> {
  try {
    const account = await getStorage(STORAGE.account);
    if (!account) {
      return {
        id: request.id,
        error: APIError.Refused,
        target: TARGET,
        sender: SENDER.extension,
      };
    }
    if (account.active) {
      const loggedWallet = await getStorage(STORAGE.loggedWallet);
      if (!loggedWallet || !loggedWallet.publicKey) {
        return {
          id: request.id,
          error: APIError.AccountNotSet,
          target: TARGET,
          sender: SENDER.extension,
        };
      }
      const key: string = getStakeKey(loggedWallet.publicKey, 0).hex()
      if (key) {
        return {
          id: request.id,
          data: [],
          target: TARGET,
          sender: SENDER.extension,
        };
      } else {
        return {
          id: request.id,
          data: [key],
          target: TARGET,
          sender: SENDER.extension,
        };
      }
    }
  } catch (error) {
    console.error("Error in getUnregisteredPubStakeKeys:", error);
    return {
      id: request.id,
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

async function getAccountPub(request: any): Promise<any> {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);

  if (!loggedWallet || !loggedWallet.publicKey) {
    return {
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    };
  }

  try {
    const key = getPublicKey(loggedWallet.publicKey).toRawKey().hex();
    return {
      id: request.id,
      data: key,
      target: TARGET,
      sender: SENDER.extension,
    };
  } catch (error) {
    console.error("Error deserializing public key:", error);
    return {
      id: request.id,
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

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
          url: chrome.runtime.getURL("options/index.html"),
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

onMessage(METHOD.getBalance, async ({ data }) => {
  return await getBalanceCip30(data);
})

onMessage(METHOD.enable, async ({ data }) => {
  console.info('Background::enable:request', data)
  const enableResponse = await enable(data);
  console.info('Background::enable:response', enableResponse);
  return enableResponse;
})

onMessage(METHOD.isEnabled, async ({ data }) => {
  console.info('Background::isEnabled:request', data)
  const isEnabledResponse = await isEnabled(data);
  console.info('Background::isEnabled:response', isEnabledResponse);
  return isEnabledResponse;
})

onMessage(METHOD.getAddress, async ({ data }) => {
  return await getAddressCip30(data);
})

onMessage(METHOD.getAddressBech32, async ({ data }) => {
  return await getAddressBech32(data);
})

onMessage(METHOD.isWhitelisted, async ({ data }) => {
  return await isWhitelistedCip30(data);
})

onMessage(METHOD.getNetworkId, async ({ data }) => {
  return await getNetworkId(data);
})

onMessage(METHOD.getRewardAddresses, async ({ data }) => {
  return await getRewardAddressesCip30(data);
})

onMessage(METHOD.getUtxos, async ({ data }) => {
  return await getUtxosCip30(data);
})

onMessage(METHOD.getCollateral, async ({ data }) => {
  return await getCollateralCip30(data);
})

onMessage(METHOD.getUsedAddresses, async ({ data }) => {
  return await getUsedAddressesCip30(data);
})

onMessage(METHOD.popupLogin, async ({ data }) => {
  return await popupLogin(data);
})

onMessage(METHOD.signData, async ({ data }) => {
  return await signData(data);
})

onMessage(METHOD.signTx, async ({ data }) => {
  return await signTx(data);
})

onMessage(METHOD.submitTx, async ({ data }) => {
  return await submitTxCip30(data);
})

onMessage(METHOD.getPubDRepKey, async ({ data }) => {
  return await getPubDRepKey(data);
})

onMessage(METHOD.getRegisteredPubStakeKeys, async ({ data }) => {
  return await getRegisteredPubStakeKeys(data);
})

onMessage(METHOD.getUnregisteredPubStakeKeys, async ({ data }) => {
  return await getUnregisteredPubStakeKeys(data);
})

onMessage(METHOD.getAccountPub, async ({ data }) => {
  return await getAccountPub(data);
})
