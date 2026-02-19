import Loading from '@/stores/loading';
import { Messaging } from '@/chrome/messaging';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import {
  APIError,
  METHOD,
  POPUP,
  SENDER,
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
  getUtxos,
  getBalance,
  getRewardAddress,
  getStakeKey,
  getDrepKey,
  urlScan,
  getUnusedAddresses,
} from '@/chrome/serialization';
import { Blockchain, coin_type, ERROR, purpose } from '@/models/types';
import networks from '@/utils/networks';
import { getDomain } from 'tldts';
import { MessageTypes } from '@/models/MessageTypes';
import { signInWithGoogle } from '@/chrome/auth';
import { loadConfig, loadWallets } from '@/plugins/geroLoader';
import WalletStore, { walletStore, hydrateWalletStore } from '@/stores/walletStore';
import { walletManager } from '@/services/walletManager.service';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { HexBlob } from '@cardano-sdk/util';
import trezor from '@/shared/utils/trezor';

if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client').catch(console.error)
  // load latest content script
  import('./contentScriptHMR').catch(console.error)
}

loadConfig().then(() => {
  // Config loaded
})
loadWallets().then(async () => {
  // Wait for the wallet store to be hydrated from Chrome storage
  await hydrateWalletStore();

  if (walletStore.loggedWallet) {
    // CRITICAL: Check auto-lock BEFORE logging in to catch expired sessions
    // This prevents the activity tracker from resetting lastActivityTimestamp
    await checkAutoLock();

    await walletManager.login(walletStore.loggedWallet);
  } else {
    Loading.setLoading(false)
  }
});

(async () => {
  await bringInitBackground({
    isEnabledByDefault: true,
    identifier: import.meta.env['VITE_CASHBACK_IDENTIFIER'],
    apiEndpoint: import.meta.env['VITE_CASHBACK_ENVIRONMENT'],
    cashbackPagePath: '/index.html#/cashback'
  })
})();

// Initialize background store messaging (the import alone initializes it)
//@ts-ignore
const isBeta: boolean = import.meta.env.VITE_IS_BETA === 'true';
const currentVersion: string = chrome.runtime.getManifest().version;

if (!isBeta) {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'update') {
      chrome.notifications.create('updateNotification', {
        type: 'image',
        title: 'Extension Updated',
        message: `Gero Dashboard has been updated to version ${currentVersion}!`,
        iconUrl: chrome.runtime.getURL('public/logo128.png'),
        imageUrl: chrome.runtime.getURL('public/v2.6.2.png'),
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
    }
  });
}

// Set an interval to clear the processed domains every 24 hours (86,400,000 milliseconds)
// const oneDayInMilliseconds = 24 * 60 * 60 * 1000;

/**
 * Check if the wallet should be auto-locked based on inactivity
 */
async function checkAutoLock(): Promise<void> {
  try {
    const wallet = walletStore.loggedWallet;

    // Skip if no wallet is logged in or already locked
    if (!wallet || walletStore.isLocked) {
      return;
    }

    // Get auto-lock configuration
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(wallet.id);
    const configTable = db.table('config');

    const autoLockConfig = await configTable.where({ key: 'autoLockMinutes' }).first();
    const autoLockMinutes = autoLockConfig?.value || 0;

    // If auto-lock is disabled (0), don't lock
    if (autoLockMinutes === 0) {
      return;
    }

    // Get unlock method - CRITICAL: Don't lock if no unlock method is configured
    const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
    const unlockMethod = unlockMethodConfig?.value;

    // If no unlock method is set, skip auto-lock (user won't be able to unlock!)
    if (!unlockMethod) {
      return;
    }

    // Get last activity timestamp
    const lastActivityConfig = await configTable.where({ key: 'lastActivityTimestamp' }).first();

    // If lastActivityTimestamp doesn't exist, it means the wallet was just logged in
    // and the activity tracker hasn't run yet. Skip the check.
    if (!lastActivityConfig || !lastActivityConfig.value) {
      return;
    }

    const lastActivityTimestamp = lastActivityConfig.value;

    // Calculate time since last activity
    const now = Date.now();
    const inactiveMinutes = (now - lastActivityTimestamp) / (1000 * 60);

    // Lock wallet if inactive for longer than configured time
    if (inactiveMinutes >= autoLockMinutes) {
      await walletManager.lock();
    }
  } catch (error) {
    console.error('❌ Error checking auto-lock:', error);
  }
}

// Use Chrome alarms API for reliable cleanup in service workers
chrome.alarms.create('clearProcessedDomains', {
  delayInMinutes: 24 * 60, // 24 hours
  periodInMinutes: 24 * 60 // repeat every 24 hours
});

// Create auto-lock alarm to check every minute
chrome.alarms.create('auto-lock-check', {
  delayInMinutes: 1,
  periodInMinutes: 1 // Check every minute
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'clearProcessedDomains') {
    clearProcessedDomains();
  } else if (alarm.name === 'auto-lock-check') {
    checkAutoLock().catch(error => {
      console.error('❌ Error in auto-lock check:', error);
    });
  }
});

let lastFullscreenTabId = -1;

const app = Messaging.createBackgroundController();

async function handleBlacklisted(request: any, tabId: number) {
  // Check if website protection is enabled
  const websiteProtectionEnabled = walletStore.config?.websiteProtection !== undefined
    ? walletStore.config.websiteProtection
    : true; // Default to enabled
  if (!websiteProtectionEnabled) {
    return 'skip';
  }

  let urlStatus;
  try {
    const response = await urlScan(request.origin);
    urlStatus = await response.json();
    if (urlStatus === 'blacklist'
      // || urlStatus === 'suspicious'
    ) {
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
    if (!domain) {
      return;
    }

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
      } else if (res === 'skip') {
        // nothing
      } else {
        console.error(res['error'])
      }
    }
  }
});

app.add(METHOD.getBalance, async (request, sendResponse) => {
  try {
    const collateral = WalletStore.state.collateral;
    const utxosFromStorage = WalletStore.state.utxos;
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
    const sidePanelUrl =
      `index.html#/${POPUP.dappConnect}` +
      `?website=${encodeURIComponent(origin)}` +
      `&tabId=${request.send.tab.id}`;

    openSidebar(tabId, sidePanelUrl)
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
  const loggedWallet = WalletStore.state.loggedWallet
  if (!loggedWallet) {
    sendResponse({
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  sendResponse({
    id: request.id,
    data: Cardano.Address.fromBech32(loggedWallet.baseAddress).toBytes(),
    target: TARGET,
    sender: SENDER.extension,
  });
});

app.add(METHOD.getAddressBech32, async (request, sendResponse) => {
  const loggedWallet = WalletStore.state.loggedWallet
  if (!loggedWallet || !loggedWallet.baseAddress) {
    sendResponse({
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  sendResponse({
    id: request.id,
    data: loggedWallet.baseAddress,
    target: TARGET,
    sender: SENDER.extension,
  });
});

app.add(METHOD.isWhitelisted, async (request, sendResponse) => {
  try {
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
  } catch (e) {
    console.error('[isWhitelisted] handler error:', e);
    sendResponse({
      error: APIError.InternalError,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

interface WhitelistedEntry {
  domain: string;
  id: number;
}

// In-memory cache for bringDomains with 4-hour TTL
let bringDomainsCache: { data: string[] | null; timestamp: number } = { data: null, timestamp: 0 };
const BRING_DOMAINS_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours in milliseconds

async function isWhitelisted(origin: string): Promise<boolean> {
  const whitelisted: WhitelistedEntry[] = WalletStore.state.connectedDapps || [];
  if (whitelisted.find(el => origin.includes(el.domain))) return true;

  // Only check bringDomains for Cardano Mainnet
  const loggedWallet = WalletStore.state.loggedWallet;
  if (!networks.resolveCashbackSupport(loggedWallet?.chain, loggedWallet?.network)) {
    return false;
  }

  // Check if cached data is still valid
  const now = Date.now();
  let bringDomains = bringDomainsCache.data;

  if (!bringDomains || (now - bringDomainsCache.timestamp) > BRING_DOMAINS_CACHE_TTL) {
    // Cache expired or doesn't exist, fetch new data
    bringDomains = await (globalThis as any).bringCache?.getReadable('relevantDomains');
    bringDomainsCache = { data: bringDomains, timestamp: now };
  }

  return !!(bringDomains && bringDomains.find((el: string) => origin.includes(el)));
}

app.add(METHOD.getNetworkId, async (request, sendResponse) => {
  const loggedWallet = WalletStore.state.loggedWallet
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
  const loggedWallet = WalletStore.state.loggedWallet
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
  try {
    const utxosFromStorage: Cardano.Utxo[] = WalletStore.state.utxos;
    const collateral = WalletStore.state.collateral;
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
  const storedUtxos = WalletStore.state.utxos;
  try {
    const utxos: string[] = getCollateral(request.data.params, storedUtxos)
    sendResponse({
      id: request.id,
      data: utxos,
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (e) {
    console.error('[CIP-30] getCollateral error:', e);
    sendResponse({
      id: request.id,
      error: e,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // IMPORTANT: return true for async handlers
});

app.add(METHOD.getUsedAddresses, async (request, sendResponse) => {
  try {
    const loggedWallet = WalletStore.state.loggedWallet
    if (!loggedWallet) {
      sendResponse({
        id: request.id,
        error: APIError.AccountNotSet,
        target: TARGET,
        sender: SENDER.extension,
      })
    }
    const addresses = getUsedAddresses(WalletStore.state.keys, request?.data?.paginate);
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
  try {
    const loggedWallet = WalletStore.state.loggedWallet
    if (!loggedWallet) {
      sendResponse({
        id: request.id,
        error: APIError.AccountNotSet,
        target: TARGET,
        sender: SENDER.extension,
      })
    }
    const addressesRes = getUnusedAddresses(loggedWallet.publicKey, loggedWallet.chain, loggedWallet.network, WalletStore.state.keys);
    sendResponse({
      id: request.id,
      data: addressesRes,
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (e) {
    console.error(e)
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
    const popupURL: string = chrome.runtime.getURL(`index.html#/${POPUP.dappSignData}?website=${encodeURIComponent(request.origin)}`);
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
  // Create a deep copy of the request to prevent mutations from affecting subsequent sign attempts
  const requestCopy = JSON.parse(JSON.stringify(request));

  let responsePromise: Promise<any>;
  if (WalletStore.state.config.useSidePanel) {
    const url =
      `index.html#/${POPUP.signTx}` +
      `?website=${encodeURIComponent(requestCopy.data.origin)}` +
      `&tabId=${requestCopy.send.tab.id}`;

    responsePromise = openSidebar(requestCopy.send.tab.id, url).then((tabId) =>
      Messaging.sendToSidePanelInternal(tabId, requestCopy)
    );
  } else {
    // Force close any existing SignTx popups before opening a new one
    // This prevents browser reuse of popup windows
    const windows = await chrome.windows.getAll({ populate: true });
    for (const window of windows) {
      if (window.type === 'popup') {
        for (const tab of window.tabs) {
          if (tab.url?.includes(`index.html#/${POPUP.signTx}`)) {
            await chrome.windows.remove(window.id);
            break;
          }
        }
      }
    }
    const popupURL = chrome.runtime.getURL(
      `index.html#/${POPUP.signTx}?website=${encodeURIComponent(requestCopy.data.origin)}`
    );
    responsePromise = focusOrCreatePopup(popupURL, 470, 852).then((tab) =>
      Messaging.sendToPopupInternal(tab.id, requestCopy)
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
    const loggedWallet = WalletStore.state.loggedWallet;
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
      let error: any;
      switch (response.status) {
        case 400:
          error = { ...TxSendError.Failure, message: response.statusText };
          break;
        case 500:
          error = APIError.InternalError;
          break;
        case 429:
          error = TxSendError.Refused;
          break;
        case 425:
          error = ERROR.fullMempool;
          break;
        default:
          error = APIError.InvalidRequest;
      }
      console.error("Error in submitTx:", error);
      sendResponse({
        id: request.id,
        error,
        target: TARGET,
        sender: SENDER.extension,
      });
    }
    const txCbor = request.data.tx
    const txIdResponse = await response.text();

    // Validate txId format (must be 64 hex characters)
    const isValidTxId = /^[a-f0-9]{64}$/i.test(txIdResponse);
    if (!isValidTxId) {
      console.error(txIdResponse);
      sendResponse({
        id: request.id,
        error: txIdResponse,
        target: TARGET,
        sender: SENDER.extension,
      });
    }

    if (txIdResponse) {
      const txDeserialized: Cardano.Tx = Serialization.TxCBOR.deserialize(Serialization.TxCBOR(txCbor));
      const pendingTx = {
        id: txIdResponse, // Required for a database key path
        tx_hash: txIdResponse,
        block_hash: '',
        block_height: 0,
        epoch_no: 0,
        absolute_slot: 0,
        tx_timestamp: Math.floor(Date.now() / 1000),
        tx_size: 0,
        cbor: txCbor,
        pending: true,
        utxo: null, // No UTXO data for submitted transactions
        ...txDeserialized, // Spreads body, witness, auxiliaryData, isValid, etc.
      };
      const currentWallet = walletManager.getWallet();
      if (currentWallet) {
        await currentWallet.setAccountTransactions([pendingTx])
      }
    }
    sendResponse({
      id: request.id,
      data: txIdResponse,
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
  const loggedWallet = WalletStore.state.loggedWallet;
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
    const account = WalletStore.state.account;
    if (!account) {
      sendResponse({
        id: request.id,
        error: APIError.Refused,
        target: TARGET,
        sender: SENDER.extension,
      });
    }
    if (account.active) {
      const loggedWallet = WalletStore.state.loggedWallet;
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
    const account = WalletStore.state.account;
    if (!account) {
      sendResponse({
        id: request.id,
        error: APIError.Refused,
        target: TARGET,
        sender: SENDER.extension,
      });
    }
    if (account.active) {
      const loggedWallet = WalletStore.state.loggedWallet;
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
  const loggedWallet = WalletStore.state.loggedWallet;
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
  const loggedWallet = WalletStore.state.loggedWallet;
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

app.addToOptions(MessageTypes.ACTIVATE_GOOGLE_WALLET, async (request, sendResponse) => {
  try {
    console.log('🔐 Processing Google wallet creation...');
    const { walletData } = request.data;

    if (!walletData) {
      throw new Error('Wallet data is required');
    }

    const { name, icon, theme, password, chain, network } = walletData;
    let jwt = walletData.jwt
    if (!jwt) {
      throw new Error('JWT not found');
    }

    if (!password) {
      throw new Error('Password is required');
    }

    // Extract user ID from JWT
    const parts = jwt.split(".");
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const userId = payload.email;

    console.log('🔍 Checking if wallet exists for:', userId);

    // Import database helpers
    const { getGoogleWalletWithEmail } = await import('../db/gero-db');
    const { upsertZkFoldWallet, isWalletActivated: checkActivated } = await import('../db/zkfold-db');
    const { default: ZkFoldStore } = await import('../stores/zkFoldStore');

    // Check if wallet already exists in main database
    const existingWallet = await getGoogleWalletWithEmail(userId);

    if (existingWallet) {
      console.log('✅ Wallet already exists with ID:', existingWallet.id);

      // Check if already activated
      const isActivated = await checkActivated(userId);

      sendResponse({
        id: request.id,
        data: {
          success: true,
          walletId: existingWallet.id,
          alreadyExists: true,
          isActivated
        },
        target: TARGET,
        sender: SENDER.extension,
      });
      return true;
    }

    // Wallet doesn't exist - create new wallet
    console.log('🔐 Creating new Google wallet:', name);

    // Import required utilities
    const { Bip32PrivateKey, SodiumBip32Ed25519 } = await import('@cardano-sdk/crypto');
    const { WalletTypePurpose, CoinTypes, HARDENED, WalletType } = await import('../models/types');
    const { encryptPrivateKey } = await import('../shared/utils/crypto');
    const { getKeyId, getMatchingKey, getSignature, stripSignature } = await import('@/services/zkFold/google.api');
    const { BigIntWrap } = await import('@/services/zkFold/types');
    const { b64ToBn } = await import('@/services/zkFold/utils/json.utils');
    const { Prover } = await import('@/services/zkFold/prover');
    const { Backend } = await import('@/services/zkFold/backend');

    // Generate random 96 bytes for BIP32 Ed25519 key
    const randomBytes = new Uint8Array(96);
    crypto.getRandomValues(randomBytes);
    const rootKey = Bip32PrivateKey.fromBytes(Buffer.from(randomBytes));

    // Encrypt the root key with password
    const encryptedPrivateKey = encryptPrivateKey(rootKey, password);

    // Get the public key for account #0
    const accountIndex = 0;
    const bip32Ed25519 = await SodiumBip32Ed25519.create();
    const xpubHex = bip32Ed25519.getBip32PublicKey(
      rootKey.derive([
        WalletTypePurpose.CIP1852,
        CoinTypes.CARDANO,
        HARDENED + accountIndex
      ]).hex()
    );

    // Derive payment key (m/1852'/1815'/0'/0/0)
    const accountKey = rootKey.derive([
      WalletTypePurpose.CIP1852,
      CoinTypes.CARDANO,
      HARDENED + accountIndex,
    ]);
    const paymentKey = accountKey.derive([0, 0]); //tokenSKey
    const pubkeyHex = paymentKey.toPublic().toRawKey().hash().hex();
    const keyId = getKeyId(jwt);
    const matchingKey = await getMatchingKey(keyId);
    if (!matchingKey) {
      throw new Error(`Failed to find matching Google cert for key ${keyId}`);
    }

    const signature = getSignature(jwt);
    const empi = {
      piPubE: b64ToBn(matchingKey.e),
      piPubN: b64ToBn(matchingKey.n),
      piSignature: b64ToBn(signature),
      piTokenName: new BigIntWrap("0x" + pubkeyHex)
    };

    const strippedJwt = stripSignature(jwt);
    const prover = new Prover();

    console.log('🔐 Requesting ZK proof...');
    const proofId = await prover.requestProof(empi);
    console.log('✅ Proof request submitted, ID:', proofId);

    // Create wallet in main database
    const { getDb, createNewWalletDb, getLatestWalletByOrder } = await import('../db/gero-db');
    const db = await getDb();

    let order = await getLatestWalletByOrder();
    if (order == null) {
      order = 1;
    } else {
      order++;
    }

    const walletId = await db['wallets'].add({
      name,
      icon,
      type: WalletType.Google,
      theme,
      order,
      encryptedPrivateKey,
      publicKey: xpubHex,
      passwordLastUpdate: new Date(),
      chain,
      network,
      userId,
      jwt,
    });

    console.log('✅ Wallet created in DB with ID:', walletId);

    // Create wallet-specific database
    await createNewWalletDb(walletId, false);
    console.log('✅ Wallet database created');

    // Store proofId in zkFold database and store
    await upsertZkFoldWallet({
      email: userId,
      userId,
      proofId,
      isActivated: false,
      walletId,
      createdAt: new Date()
    });
    ZkFoldStore.setProofId(userId, proofId);
    console.log('✅ ProofId stored in zkFold DB and store');

    // Update geroStore
    const { default: GeroStore } = await import('../stores/geroStore');
    await GeroStore.refreshWallets();

    // Send response immediately so wallet can be logged into
    sendResponse({
      id: request.id,
      data: {
        success: true,
        walletId,
        proofId,
        activating: true // Indicates activation is happening in background
      },
      target: TARGET,
      sender: SENDER.extension,
    });

    // Continue activation in the background (non-blocking)
    (async () => {
      try {
        console.log('🔐 Starting background activation for wallet:', walletId);
        console.log('🔐 Waiting for proof completion (this may take several minutes)...');

        const proof = await prover.prove(empi);
        console.log('✅ Proof generated successfully for wallet:', walletId);

        const zkFoldUrl = import.meta.env['VITE_ZKFOLD_API_URL'] || 'https://wallet-api.zkfold.io';
        const zkFoldApiKey = import.meta.env['VITE_ZKFOLD_API_KEY'] || null;
        const backend = new Backend(zkFoldUrl, zkFoldApiKey);

        console.log('🔐 Activating wallet on blockchain...');
        const createWalletResponse = await backend.activateWallet(strippedJwt, paymentKey.toPublic().hash(), proof);
        console.log('✅ Wallet activated successfully on blockchain!', createWalletResponse);

        // Mark as activated in zkFold database and store
        const { markWalletAsActivated } = await import('../db/zkfold-db');
        await markWalletAsActivated(userId, walletId);
        ZkFoldStore.markAsActivated(userId, walletId);

        console.log('✅ Background activation completed for wallet:', walletId);
      } catch (error) {
        console.error('❌ Background activation failed for wallet:', walletId, error);
        // Wallet is still usable, activation can be retried later
      }
    })();

  } catch (err) {
    console.error('❌ Wallet creation failed:', err);
    sendResponse({
      id: request.id,
      data: { success: false },
      target: TARGET,
      sender: SENDER.extension,
      error: (err instanceof Error ? err.message : String(err)) || 'Wallet creation failed',
    });
  }
  return true; // Keep message channel open for async response
});

app.addToOptions(MessageTypes.VERIFY_SPENDING_PASSWORD, async (request, sendResponse) => {
  try {
    // Note: Never log password data
    const walletBg = walletManager.getWallet();
    if (walletBg) {
      // Await verifySpendingPassword (now async to support PRF wallets)
      const isValid = await walletBg.verifySpendingPassword(request.data.password);
      sendResponse({
        id: request.id,
        data: { success: isValid, error: isValid ? undefined : 'Invalid spending password' },
        target: TARGET,
        sender: SENDER.extension,
      });
    } else {
      sendResponse({
        id: request.id,
        data: { success: false, error: 'Wallet instance not available' },
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  } catch (error) {
    console.error('Error verifying spending password:', error);
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
});

app.addToOptions(MessageTypes.SIGN_DATA, async (request, sendResponse) => {
  try {
    // Note: Never log request - contains password
    const walletBg = walletManager.getWallet();
    if (walletBg) {
      const res = await walletBg.signData(
        request.data.address,
        request.data.payload,
        request.data.password,
        request.data.accountIndex || 0,
        WalletStore.state.keys
      );
      sendResponse({
        id: request.id,
        data: res,
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
    console.error('Error signing Data:', error);
    sendResponse({
      id: request.id,
      data: { error: getErrorMessage(error) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.addToOptions(MessageTypes.SIGN_TX, async (request, sendResponse) => {
  try {
    // Note: Never log request - contains password
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

      // Convert privateKeyBytes array back to Uint8Array if passed (PRF wallets)
      const privateKeyBytes = request.data.privateKeyBytes
        ? new Uint8Array(request.data.privateKeyBytes)
        : undefined;

      const witnessResult = await walletBg.signTx(
        transaction,
        request.data.password,
        request.data.accountIndex || 0,
        request.data.utxos,
        request.data.addresses,
        privateKeyBytes, // Pass pre-decrypted private key for PRF wallets
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
      data: { error: getErrorMessage(error) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.addToOptions(MessageTypes.SUBMIT_TX, async (request, sendResponse) => {
  try {
    console.log('submit tx', request);
    const walletBg = walletManager.getWallet();
    if (walletBg) {
      // Handle different transaction input formats
      let txCbor: string;
      if (request.data.txCbor && request.data.witnessHex) {
        console.log('original Cbor', request.data.txCbor)
        console.log('witnessHex', request.data.witnessHex)
        const serializableTx: Serialization.Transaction = Serialization.Transaction.fromCbor(HexBlob(request.data.txCbor));
        const existingWitness = serializableTx.witnessSet();
        const existingWitnessCore = existingWitness.toCore();
        const newWitnesses: Cardano.Witness = Serialization.TransactionWitnessSet.fromCbor(request.data.witnessHex).toCore();

        // Merge existing signatures with new signatures
        const mergedSignatures = new Map([
          ...(existingWitnessCore.signatures?.entries() || []),
          ...newWitnesses.signatures.entries()
        ]);

        existingWitness.setVkeys(
          Serialization.CborSet.fromCore(
            [...mergedSignatures.entries()],
            Serialization.VkeyWitness.fromCore,
          ),
        );
        serializableTx.setWitnessSet(existingWitness);
        txCbor = serializableTx.toCbor();
        console.log('Submitting transaction with witnesses:', txCbor);
      } else if (request.data.txCbor) {
        // CBOR hex string format (already signed)
        txCbor = request.data.txCbor;
      } else if (request.data.tx) {
        // Legacy Transaction object or Cardano.Tx object
        txCbor = request.data.tx;
      } else {
        throw new Error('No transaction data provided (neither tx nor txCbor)');
      }

      const txId = await walletBg.submitTx(
        txCbor,
        request.data.utxos || []
      );

      sendResponse({
        id: request.id,
        data: { txId: txId },
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
    console.error('Error submitting transaction:', error);
    sendResponse({
      id: request.id,
      data: { error: getErrorMessage(error) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.addToOptions(MessageTypes.RESTORE, async (request, sendResponse) => {
  try {
    console.log('restore', request)
    const currentWallet = await walletManager.restore(request.data.wallet);
    if (currentWallet) {
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
    await walletManager.logout();
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

app.addToOptions(MessageTypes.LOCK, async (request, sendResponse) => {
  try {
    await walletManager.lock();
    sendResponse({
      id: request.id,
      data: { success: true },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (err) {
    console.error('lock error', err);
    sendResponse({
      id: request.id,
      data: { success: false },
      target: TARGET,
      sender: SENDER.extension,
      error: err,
    });
  }
});

app.addToOptions(MessageTypes.UNLOCK, async (request, sendResponse) => {
  try {
    const { unlockCredential, totpCode, password, unlockMethod } = request.data;
    const success = await walletManager.unlock(unlockCredential, totpCode, password, unlockMethod);
    sendResponse({
      id: request.id,
      data: { success },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (err) {
    console.error('unlock error', err);
    sendResponse({
      id: request.id,
      data: { success: false },
      target: TARGET,
      sender: SENDER.extension,
      error: err,
    });
  }
});

app.addToOptions(MessageTypes.VERIFY_PRE_LOGIN_UNLOCK, async (request, sendResponse) => {
  try {
    const { walletId, unlockCredential, totpCode, password, unlockMethod } = request.data;
    const success = await walletManager.verifyPreLoginUnlock(walletId, unlockCredential, totpCode, password, unlockMethod);
    sendResponse({
      id: request.id,
      data: { success },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (err) {
    console.error('pre-login unlock verification error', err);
    sendResponse({
      id: request.id,
      data: { success: false },
      target: TARGET,
      sender: SENDER.extension,
      error: err,
    });
  }
});

app.addToOptions(MessageTypes.CHECK_AUTO_LOCK, async (request, sendResponse) => {
  try {
    // Trigger immediate auto-lock check
    await checkAutoLock();
    sendResponse({
      id: request.id,
      data: { success: true },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (err) {
    console.error('check auto-lock error', err);
    sendResponse({
      id: request.id,
      data: { success: false },
      target: TARGET,
      sender: SENDER.extension,
      error: err,
    });
  }
});

app.addToOptions(MessageTypes.SYNC_VIA_REST, async (request, sendResponse) => {
  try {
    const currentWallet = walletManager.getWallet();
    if (currentWallet) {
      await currentWallet.syncService.syncViaRest();
      sendResponse({
        id: request.id,
        data: { success: true },
        target: TARGET,
        sender: SENDER.extension,
      });
    } else {
      sendResponse({
        id: request.id,
        data: { success: false, error: 'No wallet loaded' },
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  } catch (err) {
    console.error('SYNC_VIA_REST error:', err);
    sendResponse({
      id: request.id,
      data: { success: false },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true;
});

app.addToOptions(MessageTypes.RESYNC, async (request, sendResponse) => {
  try {
    const currentWallet = walletManager.getWallet();
    if (currentWallet) {
      await currentWallet.syncService.resync();
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

app.addToOptions(MessageTypes.REMOVE_PENDING_TRANSACTION, async (request, sendResponse) => {
  try {
    const currentWallet = walletManager.getWallet();
    if (currentWallet) {
      const { txId } = request.data;
      const { removePendingTransaction } = await import('@/db/wallet-db');

      // Remove from database - the TransactionsLoader subscription will auto-update the UI
      const success = await removePendingTransaction(currentWallet.id, txId);

      sendResponse({
        id: request.id,
        data: { success },
        target: TARGET,
        sender: SENDER.extension,
      });
    } else {
      sendResponse({
        id: request.id,
        data: { success: false, error: 'Wallet instance not available' },
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  } catch (err) {
    console.error('Error removing pending transaction:', err);
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(err) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

app.addToOptions(MessageTypes.TREZOR, async (request, sendResponse) => {
  try {
    if (request.data.method === 'initTrezor') {
      const network = networks.resolveNetwork(request.data.chain, request.data.network);

      let path;
      if (network.blockchain === Blockchain.CARDANO) {
        path = `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'`
      }
      // Use the clean Trezor wrapper (handles initialization, device name, etc.)
      const coldWalletProps = await trezor.getXpub(path);
      sendResponse({
        id: request.id,
        data: { success: true, coldWalletProps },
        target: TARGET,
        sender: SENDER.extension,
      });
    } else if (request.data.method === 'signData') {
      const { address, payload, accountIndex } = request.data;
      const currentWallet = walletManager.getWallet();
      const network = networks.resolveNetwork(currentWallet.chain, currentWallet.network);


      // Sign data with Trezor
      const signatureData: {
        signatureHex: string;
        signingPublicKeyHex: string;
        addressFieldHex: string;
      } = await trezor.signData(address, payload, network.networkId, accountIndex, WalletStore.state.keys);

      sendResponse({
        id: request.id,
        data: { success: true, signatureData },
        target: TARGET,
        sender: SENDER.extension,
      });
    } else if (request.data.method === 'signTx') {
      const { txCbor } = request.data;

      const tx = deserializeCardanoJsSdkTx(txCbor);

      // For partial transactions, strip existing witnesses before signing with Trezor
      // This prevents Trezor from seeing/including witnesses from the partial transaction
      const txWithoutWitnesses: Cardano.Tx = {
        ...tx,
        witness: {
          signatures: new Map(),
          // Preserve other witness fields that Trezor needs (scripts, datums, redeemers)
          ...(tx.witness?.scripts && { scripts: tx.witness.scripts }),
          ...(tx.witness?.datums && { datums: tx.witness.datums }),
          ...(tx.witness?.redeemers && { redeemers: tx.witness.redeemers }),
        }
      };

      const utxos: Cardano.Utxo[] = WalletStore.state.utxos;

      // Get current wallet and network info
      const currentWallet = walletManager.getWallet();
      const network = networks.resolveNetwork(currentWallet.chain, currentWallet.network);
      console.log('[TREZOR Background] Signing transaction...', { tx: txWithoutWitnesses, network });

      // Sign transaction with Trezor SDK (includes witness filtering)
      // Pass original CBOR to preserve exact transaction hash computation
      const signatures: Cardano.Signatures = await trezor.signTransaction(
        txWithoutWitnesses,
        WalletStore.state.keys,
        utxos,
        false,
        network,
        WalletStore.state.loggedWallet.publicKey,
        txCbor  // Pass original CBOR for correct hash computation
      );

      // Convert Map to array for Chrome messaging (Maps don't serialize properly)
      const signaturesArray = Array.from(signatures.entries());
      console.log('[TREZOR Background] Signatures array:', signaturesArray);

      sendResponse({
        id: request.id,
        data: { success: true, signatures: signaturesArray },
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  } catch (err) {
    console.error('[TREZOR Background] Error:', err);
    sendResponse({
      id: request.id,
      data: { success: false, error: (err instanceof Error ? err.message : 'Trezor operation failed') },
      target: TARGET,
      sender: SENDER.extension,
    })
  }
  return true; // Important: return true for async handlers
});

const openUI = async () => {
  await openDashboard();
};

chrome.action.onClicked.addListener(openUI);

app.listen();
