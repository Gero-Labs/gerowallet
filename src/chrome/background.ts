import {
  extractKeyHash,
  focusOrCreatePopup,
  getAddress,
  getBalance,
  getCollateral,
  getPubDRepKey,
  getPubKey,
  getRegisteredPubStakeKeys,
  getRewardAddresses,
  getStorage,
  getUnregisteredPubStakeKeys,
  getUsedAddresses,
  getUtxos,
  isWhitelisted,
  submitTx,
  urlScan,
  verifyPayload,
  verifyTx,
} from './extension';
import { Messaging } from './messaging';
import { APIError, METHOD, POPUP, SENDER, STORAGE, TARGET } from './config';
import networks from '@/shared/utils/networks';
import { bringInitBackground } from '@bringweb3/chrome-extension-kit';
import { Address, TransactionUnspentOutput } from '@emurgo/cardano-serialization-lib-browser';
import { getDomain } from 'tldts';

await bringInitBackground({
  identifier: '94cnbcoEYv5A6z1yxSizi8RAa7kq71nq6miZeSNh',
  apiEndpoint: 'prod',
  cashbackPagePath: '/wallet/cashback'
})

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
      const popupResponse: Response = await focusOrCreatePopup(popupURL, 470, 600)
        .then(tab => Messaging.sendToPopupInternal(tab, request))
        .then(response => response);
      console.log(popupResponse)
      return popupResponse;
    }
    return 'approved';
  } catch (error) {
    return error;
  }
}

chrome.webNavigation.onCommitted.addListener(async (details) => {
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
  const address: Address = await getAddress();
  if (address) {
    sendResponse({
      id: request.id,
      data: address.to_hex(),
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
  const address: Address = await getAddress();
  if (address) {
    sendResponse({
      id: request.id,
      data: address.to_bech32(),
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
    .then((utxos) => {
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

app.add(METHOD.getCollateral, (request, sendResponse) => {
  getCollateral(request.data.params)
    .then((utxos) => {
      const res: string[] = utxos.map((utxo: TransactionUnspentOutput) => utxo.to_hex());
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

app.add(METHOD.submitTx, async (request, sendResponse) => {
  await verifyTx(request.data.tx)
  submitTx(request.data.tx)
    .then((txHash) => {
      sendResponse({
        id: request.id,
        data: txHash,
        target: TARGET,
        sender: SENDER.extension,
      });
    })
    .catch(e => {
      sendResponse({
        id: request.id,
        error: e,
        target: TARGET,
        sender: SENDER.extension,
      });
    });
});

app.add(METHOD.getPubDRepKey, async (request, sendResponse) => {
  const key = await getPubDRepKey();
  if (key) {
    sendResponse({
      id: request.id,
      data: key,
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

app.add(METHOD.getPubDRepKey, async (request, sendResponse) => {
  const key = await getPubDRepKey();
  if (key) {
    sendResponse({
      id: request.id,
      data: key,
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

app.add(METHOD.getRegisteredPubStakeKeys, async (request, sendResponse) => {
  const key = await getRegisteredPubStakeKeys();
  if (key) {
    sendResponse({
      id: request.id,
      data: key,
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

app.add(METHOD.getUnregisteredPubStakeKeys, async (request, sendResponse) => {
  const key = await getUnregisteredPubStakeKeys();
  if (key) {
    sendResponse({
      id: request.id,
      data: key,
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

app.add(METHOD.getAccountPub, async (request, sendResponse) => {
  const key = await getPubKey();
  if (key) {
    sendResponse({
      id: request.id,
      data: key.to_hex(),
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
