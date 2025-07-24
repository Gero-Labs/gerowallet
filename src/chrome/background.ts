import Loading from '@/stores/loading';

self.addEventListener('online', () => {
  console.log('Network is online');
  // You can dispatch custom events or use a global state manager
});

self.addEventListener('offline', () => {
  console.log('Network is offline');
  // Handle offline state
});

// For Service Worker lifecycle events
self.addEventListener('install', (event) => {
  console.log('Service Worker installing');
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activated');
});

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
} from '@/chrome/serialization';
import { ERROR } from '@/models/types';
import networks from '@/utils/networks';
import { getDomain } from 'tldts';
import { MessageTypes } from '@/models/MessageTypes';
import { signInWithGoogle } from '@/chrome/auth';
import { convertToTxSchema } from '@/chrome/helper';
import { loadConfig, loadWallets } from '@/plugins/geroLoader';
import WalletStore, { walletStore, hydrateWalletStore } from '@/stores/walletStore';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { walletManager } from '@/services/walletManager.service';

if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client')
  // load latest content script
  import('./contentScriptHMR')
}

loadConfig().then(() => {
  console.log('Gero Config loaded')
})
loadWallets().then(async () => {
  console.log('Wallets loaded')

  // Wait for wallet store to be hydrated from Chrome storage
  await hydrateWalletStore();
  console.log('Wallet store hydrated, checking for logged wallet...');

  if (walletStore.loggedWallet) {
    console.log('Login in wallet: ', walletStore.loggedWallet.name);
    await walletManager.login(walletStore.loggedWallet);
  } else {
    console.log('No logged wallet found after hydration');
    Loading.setLoading(false)
  }
});

//@ts-ignore
const isBeta: boolean = import.meta.env.VITE_IS_BETA === 'true';

(async () => {
  await bringInitBackground({
    isEnabledByDefault: true,
    identifier: import.meta.env['VITE_CASHBACK_IDENTIFIER'],
    apiEndpoint: import.meta.env['VITE_CASHBACK_ENVIRONMENT'],
    cashbackPagePath: '/index.html#/cashback'
  })
})();
const currentVersion: string = chrome.runtime.getManifest().version;

if (!isBeta) {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'update') {
      chrome.notifications.create('updateNotification', {
        type: 'image',
        title: 'Extension Updated',
        message: `Gero Dashboard has been updated to version ${currentVersion}!`,
        iconUrl: chrome.runtime.getURL('public/logo128.png'),
        imageUrl: chrome.runtime.getURL('public/2.5.4.png'),
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
}

export async function openSidebar(tabId: number, path: string) {
  if (typeof tabId !== 'number') {
    return null;
  }
  chrome.sidePanel.setOptions({
      tabId,
      path,
      enabled: true
  })
  chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: false
  })
  chrome.sidePanel.open({ tabId });
  return tabId;
}

const processedDomains: Set<string> = new Set<string>();

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

async function handleBlacklisted(request: any, tabId: number) {
  let urlStatus;
  try {
    const response = await urlScan(request.origin);
    urlStatus = await response.json();
    console.log('urlScan', urlStatus);
    if (urlStatus === 'blacklist' || urlStatus === 'suspicious') {
      // Send the overlay message immediately
      await chrome.tabs.sendMessage(tabId, { action: 'showOverlay', url: request.origin });

      const popupURL = chrome.runtime.getURL(`index.html#/${POPUP.warning}?website=${encodeURIComponent(request.origin)}`);
      const popupResponse: any = await focusOrCreatePopup(popupURL, 470, 600)
        .then(tab => Messaging.sendToPopupInternal(tab.id, request))
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

app.add(METHOD.enable, (request, sendResponse) => {
  console.log('enable', request)
  const { id, origin, send } = request;
  const tabId = send.tab?.id;
  const reply = (opts: { data?: any; error?: any }) => {
    sendResponse({
      id,
      ...opts,
      target: TARGET,
      sender: SENDER.extension,
    });
  };


  const currentWallet = walletManager.getWallet();
  if (!currentWallet) {
    return reply({ error: APIError.AccountNotSet });
  }
  if (WalletStore.isWhitelisted(origin)) {
    return reply({ data: true });
  }

  if (typeof tabId !== 'number') {
    return reply({ error: APIError.InternalError });
  }

  const normalizeAndSend = (response: any) => {
    if (response.data) {
      reply({ data: response.data });
    } else if (response.error) {
      reply({ error: response.error });
    } else {
      reply({ error: APIError.InternalError });
    }
  };

  if (WalletStore.state.config.useSidePanel && request.data.userGesture) {
    const sidepanelUrl =
      `index.html#/${POPUP.dappConnect}` +
      `?website=${encodeURIComponent(origin)}` +
      `&tabId=${request.send.tab.id}`;

    openSidebar(tabId, sidepanelUrl)
      .then(openedTabId => Messaging.sendToSidePanelInternal(openedTabId, request))
      .then(normalizeAndSend)
      .catch(err => reply({ error: err }));
  } else {
    const popupURL =
      chrome.runtime.getURL(
        `index.html#/${POPUP.dappConnect}?website=${encodeURIComponent(origin)}`
      );

    focusOrCreatePopup(popupURL, 470, 600)
      .then(newTab => Messaging.sendToPopupInternal(newTab.id, request))
      .then(normalizeAndSend)
      .catch(err => reply({ error: err }));
  }

  // IMPORTANT: Return true so that Chrome knows we'll call sendResponse asynchronously
  return true;
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
  let responsePromise: Promise<any>;
  if (WalletStore.state.config.useSidePanel && request.data.userGesture) {
    const url =
      `index.html#/${POPUP.login}` +
      `&tabId=${request.send.tab.id}`;
    responsePromise = openSidebar(request.send.tab.id, url).then((tabId) =>
      Messaging.sendToSidePanelInternal(tabId, request)
    );
  } else {
    const popupURL = chrome.runtime.getURL(`index.html#/${POPUP.login}}`);
    responsePromise = focusOrCreatePopup(popupURL, 470, 600).then((tab) =>
      Messaging.sendToPopupInternal(tab.id, request)
    );
  }
  responsePromise
    .then((response: any) => {
      if (response.data) {
        sendResponse({
          id: request.id,
          data: response.data,
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

app.add(METHOD.signData, (request, sendResponse) => {
  console.log('signData', request)
  let responsePromise: Promise<any>;
  if (WalletStore.state.config.useSidePanel) {
    const url =
      `index.html#/${POPUP.dappSignData}` +
      `?website=${encodeURIComponent(request.origin)}` +
      `&tabId=${request.send.tab.id}`;
    responsePromise = openSidebar(request.send.tab.id, url).then((tabId) =>
      Messaging.sendToSidePanelInternal(tabId, request)
    );
  } else {
    const popupURL = chrome.runtime.getURL(`index.html#/${POPUP.dappSignData}?website=${encodeURIComponent(request.origin)}`);
    responsePromise = focusOrCreatePopup(popupURL, 470, 600).then((tab) =>
      Messaging.sendToPopupInternal(tab.id, request)
    );
  }
  responsePromise
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

app.add(METHOD.signTx, async (request, sendResponse) => {
  let responsePromise: Promise<any>;
  if (WalletStore.state.config.useSidePanel) {
    const url =
      `index.html#/${POPUP.signTx}` +
      `?website=${encodeURIComponent(request.origin)}` +
      `&tabId=${request.send.tab.id}`;
    responsePromise = openSidebar(request.send.tab.id, url).then((tabId) =>
      Messaging.sendToSidePanelInternal(tabId, request)
    );
  } else {
    const popupURL = chrome.runtime.getURL(`index.html#/${POPUP.signTx}?website=${encodeURIComponent(request.origin)}`);
    responsePromise = focusOrCreatePopup(popupURL, 470, 852).then((tab) =>
      Messaging.sendToPopupInternal(tab.id, request)
    );
  }
  responsePromise
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

app.add(METHOD.submitTx, async (request, sendResponse) => {
  try {
    const loggedWallet = await getStorage(STORAGE.loggedWallet);
    if (!loggedWallet || !loggedWallet.publicKey) {
      sendResponse({
        id: request.id,
        error: APIError.AccountNotSet,
        target: TARGET,
        sender: SENDER.extension,
      });
    }
    const response = await submitTx(request.data.tx, loggedWallet['chain'], loggedWallet['network'])
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
    const utxos = await getStorage(STORAGE.utxos);
    const txCbor = request.data.tx
    const txId = await response.text();
    if (txId) {
      const tx = convertToTxSchema(txId, txCbor, utxos, networks.resolveNetworkId(loggedWallet['chain'], loggedWallet['network']))
      const currentWallet = walletManager.getWallet();
      if (currentWallet) {
        await currentWallet.setAccountTransactions([tx])
      }
    }
    console.log('txId', txId)
    sendResponse({
      id: request.id,
      data: txId,
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (e) {
    console.error("Error in submitTx:", e);
    sendResponse({
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
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

app.add(METHOD.getNetworkMagic, async (request, sendResponse) => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet);
  try {
    sendResponse({
      id: request.id,
      data: networks.resolveNetworkMagic(loggedWallet['chain'], loggedWallet['network']),
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

// Open the dashboard in a new tab or focus on an existing tab
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

app.addToOptions(MessageTypes.SIGN_WITH_GOOGLE, async (request, sendResponse) => {
  try {
    const tokens = await signInWithGoogle();
    if (tokens) {
      sendResponse({
        id: request.id,
        data: { success: true, tokens },
        target: TARGET,
        sender: SENDER.extension,
      });
    } else {
      sendResponse({
        id: request.id,
        data: { success: false },
        target: TARGET,
        sender: SENDER.extension,
      })
    }
  } catch (err) {
    sendResponse({
      id: request.id,
      data: { success: false },
      target: TARGET,
      sender: SENDER.extension,
      error: err,
    })
  }
});

app.addToOptions(MessageTypes.VERIFY_SPENDING_PASSWORD, async (request, sendResponse) => {
  try {
    console.log('verify spending password', request);
    const walletBg = walletManager.getWallet();
    if (walletBg) {
      const isValid = walletBg.verifySpendingPassword(request.data.password);
      sendResponse({
        id: request.id,
        data: { isValid },
        target: TARGET,
        sender: SENDER.extension,
      });
    } else {
      sendResponse({
        id: request.id,
        data: { error: 'Wallet instance not available' },
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  } catch (error) {
    console.error('Error verifying spending password:', error);
    sendResponse({
      id: request.id,
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.addToOptions(MessageTypes.SIGN_TX, async (request, sendResponse) => {
  try {
    console.log('sign tx', request);
    const walletBg = walletManager.getWallet();
    if (walletBg) {
      // Handle both legacy (tx object) and new (txCbor string) formats
      let transaction;
      if (request.data.txCbor) {
        // New format: deserialize CBOR to Cardano.Tx object
        console.log('Deserializing CBOR transaction:', request.data.txCbor);
        transaction = deserializeCardanoJsSdkTx(request.data.txCbor);
      } else if (request.data.tx) {
        // Legacy format: use transaction object directly
        console.log('Using legacy transaction object');
        transaction = request.data.tx;
      } else {
        throw new Error('No transaction data provided (neither tx nor txCbor)');
      }

      const witnessResult = await walletBg.signTx(
        transaction,
        request.data.partialSign || false,
        request.data.password,
        request.data.accountIndex || 0,
        request.data.utxos,
        request.data.addresses,
        request.data.isUsb
      );
      sendResponse({
        id: request.id,
        data: witnessResult,
        target: TARGET,
        sender: SENDER.extension,
      });
    } else {
      sendResponse({
        id: request.id,
        data: { error: 'Wallet instance not available' },
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  } catch (error) {
    console.error('Error signing transaction:', error);
    sendResponse({
      id: request.id,
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.addToOptions(MessageTypes.LOGIN, async (request, sendResponse) => {
  try {
    console.log('login', request)
    const walletBg = await walletManager.login(request.data.wallet);
    if (walletBg) {
      sendResponse({
        id: request.id,
        data: { success: true },
        target: TARGET,
        sender: SENDER.extension,
      });
    } else {
      sendResponse({
        id: request.id,
        data: { success: false },
        target: TARGET,
        sender: SENDER.extension,
      })
    }
  } catch (err) {
    console.log('login error', err)
    sendResponse({
      id: request.id,
      data: { success: false },
      target: TARGET,
      sender: SENDER.extension,
      error: err,
    })
  }
});

app.addToOptions(MessageTypes.LOGOUT, async (request, sendResponse) => {
  try {
    await walletManager.clearWallet();
    sendResponse({
      id: request.id,
      data: { success: true },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (err) {
    console.log('logout error', err)
    sendResponse({
      id: request.id,
      data: { success: false },
      target: TARGET,
      sender: SENDER.extension,
      error: err,
    })
  }
});

app.addToOptions(MessageTypes.RESYNC, async (request, sendResponse) => {
  try {
    console.log('resync')
    const currentWallet = walletManager.getWallet();
    if (currentWallet) {
      await currentWallet.resync();
      sendResponse({
        id: request.id,
        data: { success: true },
        target: TARGET,
        sender: SENDER.extension,
      });
    } else {
      sendResponse({
        id: request.id,
        data: { success: false },
        target: TARGET,
        sender: SENDER.extension,
      })
    }
  } catch (err) {
    console.log('resync error', err)
    sendResponse({
      id: request.id,
      data: { success: false },
      target: TARGET,
      sender: SENDER.extension,
      error: err,
    })
  }
});

const openUI = async () => {
  await openDashboard();
};

chrome.action.onClicked.addListener(openUI);

app.listen();
