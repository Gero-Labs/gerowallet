import { Buffer } from 'buffer';
import Loading from '@/stores/loading';
import { Messaging } from '@/chrome/messaging';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import { APIError, BITCOIN_METHOD, METHOD, POPUP, SENDER, TARGET, TxSendError } from '@/chrome/config';
import { bringInitBackground } from '@bringweb3/chrome-extension-kit';
import {
  focusOrCreatePopup,
  getBalance,
  getCollateral,
  getDrepKey,
  getPublicKey,
  getRewardAddress,
  getStakeKey,
  getUnusedAddresses,
  getUsedAddresses,
  getUtxos,
  submitTx,
  urlScan,
} from '@/chrome/serialization';
import { Blockchain, coin_type, ERROR, purpose } from '@/models/types';
import networks from '@/utils/networks';
import { getDomain } from 'tldts';
import { MessageTypes } from '@/models/MessageTypes';
import { signInWithGoogle } from '@/chrome/auth';
import { loadConfig, loadWallets } from '@/plugins/geroLoader';
import WalletStore, { hydrateWalletStore, walletStore } from '@/stores/walletStore';
import { walletManager } from '@/services/walletManager.service';
import { shouldAutoLock } from '@/services/autoLock';
import { nexusCollateralApi } from '@/api/nexus-collateral-api';
import { debugLog } from '@/utils/debug';
import type { walletConnectService } from '@/services/walletConnect/walletConnect.service';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { HexBlob } from '@cardano-sdk/util';
import trezor from '@/shared/utils/trezor';
import type { IUnifiedUtxo } from '@/chains/common/interfaces';
import { mpcSessionCache } from '@/chrome/mpcSessionCache';
import { mpcLoginShareCache } from '@/chrome/mpcLoginShareCache';
import {
  createMpcGoogleWalletFlow,
  unlockMpcWalletFlow,
  recoverMpcGoogleWalletFlow,
  subFromIdToken,
  resolveSignPrivateKeyBytes,
  assertMpcActionSupported,
} from '@/chrome/mpcWalletHandlers';
import type { DeviceShareSecret } from '@/shared/utils/mpc';

type WalletConnectServiceInstance = typeof walletConnectService;

if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client').catch(console.error)
  // load latest content script
  import('./contentScriptHMR').catch(console.error)
}

loadConfig().then(() => {
  // Config loaded
})

// Restore side panel behavior from its own chrome.storage key
chrome.storage.local.get('openMiniGeroOnClick', (result) => {
  if (result['openMiniGeroOnClick']) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  }
});
loadWallets().then(async () => {
  // Wait for the wallet store to be hydrated from Chrome storage
  await hydrateWalletStore();

  if (walletStore.loggedWallet) {
    // Safety: clear stale isLocked if no unlock method is configured
    // Prevents users from being trapped on lock screen (e.g. after a bug or reset)
    if (walletStore.isLocked) {
      try {
        const { getDb } = await import('@/db/wallet-db');
        const db = await getDb(walletStore.loggedWallet.id);
        const configTable = db.table('config');
        const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
        // Clear a stray lock when no unlock method is configured (incl. MPC set to
        // None) so the user is never trapped on a lock screen they can't dismiss.
        if (!unlockMethodConfig?.value) {
          WalletStore.setLocked(false);
          console.log('🔓 Cleared stale lock — no unlock method configured');
        }
      } catch (e) {
        console.warn('Failed to check unlock method for stale lock:', e);
        WalletStore.setLocked(false);
      }
    }

    // CRITICAL: Check auto-lock BEFORE logging in to catch expired sessions
    // This prevents the activity tracker from resetting lastActivityTimestamp
    await checkAutoLock();

    await walletManager.login(walletStore.loggedWallet);

    // Initialize WalletConnect in background (non-blocking)
    import('@/services/walletConnect/walletConnect.service').then(({ walletConnectService }) => {
      walletConnectService.initialize()
        .then(() => setupWalletConnectCallbacks(walletConnectService))
        .catch(e => console.warn('⚠️ WC init failed:', e));
    });
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
        imageUrl: chrome.runtime.getURL('public/v2.6.3.png'),
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

// Shared shapes used throughout the dApp pipeline. Handlers receive `request`
// objects with a loose shape from `Messaging`/`app.add`, and they routinely
// build replies via helpers that only ever send `{ data?, error? }`.
interface BackgroundResponse {
  data?: unknown;
  error?: unknown;
  method?: string;
  tabId?: number;
  target?: string;
  sender?: string;
  id?: string;
}
interface ReplyOpts {
  data?: unknown;
  error?: unknown;
}
type DAppRequestResolver = (response: BackgroundResponse) => void;

function errorMessage(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === 'string' ? m : undefined;
  }
  return undefined;
}

export async function openSidebar(tabId: number, path: string) {
  if (typeof tabId !== 'number') {
    return null;
  }
  // Append tabId so the side panel can identify which tab it belongs to
  const separator = path.includes('?') ? '&' : '?';
  const fullPath = `${path}${separator}tabId=${tabId}`;
  chrome.sidePanel.setOptions({
      tabId,
      path: fullPath,
      enabled: true
  })
  try {
    await chrome.sidePanel.open({ tabId });
  } catch (e) {
    // sidePanel.open() requires a user gesture; silently ignore when called programmatically
    const message = e instanceof Error ? e.message : String(e);
    console.debug('sidePanel.open skipped (no user gesture):', message);
  }
  return tabId;
}

// Mini-gero: default to dashboard on icon click, restored from config after loadConfig()
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

// Mini-gero DApp channel — per-tab port routing
// Port name format: "mini-gero-dapp-channel" or "mini-gero-dapp-channel:${tabId}"
const miniGeroPorts = new Map<number, chrome.runtime.Port>();
// requestId → { resolver, tabId } so port-disconnect handlers can reject the
// requests sent through that specific tab's port (closing the side panel via
// the X button must register as a user reject, not silently hang).
const pendingDAppRequests = new Map<string, { resolve: DAppRequestResolver; tabId: number }>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith('mini-gero-dapp-channel')) {
    // Extract tab ID from port name (e.g. "mini-gero-dapp-channel:123")
    const parts = port.name.split(':');
    const tabId = parts.length > 1 ? parseInt(parts[1], 10) : NaN;
    if (isNaN(tabId)) {
      console.warn('[DApp] mini-gero port connected without tab ID, ignoring');
      return;
    }

    // Reject pending requests from old port for this tab
    const oldPort = miniGeroPorts.get(tabId);
    if (oldPort) {
      try { oldPort.disconnect(); } catch { /* already disconnected */ }
    }
    miniGeroPorts.set(tabId, port);

    port.onMessage.addListener((message) => {
      if (message.type === 'dapp-response' && message.requestId) {
        const entry = pendingDAppRequests.get(message.requestId);
        if (entry) {
          entry.resolve(message);
          pendingDAppRequests.delete(message.requestId);
        }
      }
    });

    port.onDisconnect.addListener(() => {
      if (miniGeroPorts.get(tabId) === port) {
        miniGeroPorts.delete(tabId);
      }
      // Closing the side panel (X button) disconnects the port. Treat that as
      // a user reject for any in-flight request so the dApp gets a real
      // response instead of hanging forever waiting on a sign that won't come.
      for (const [requestId, entry] of pendingDAppRequests.entries()) {
        if (entry.tabId === tabId) {
          entry.resolve({ error: APIError.Refused.info || 'User rejected' });
          pendingDAppRequests.delete(requestId);
        }
      }
    });
  }
});

function sendToMiniGero(method: string, payload: unknown, tabId?: number): Promise<BackgroundResponse> {
  // Find the correct port: prefer exact tab, fall back to any connected port
  const port = (typeof tabId === 'number' && miniGeroPorts.get(tabId)) || miniGeroPorts.values().next().value;
  if (!port) return Promise.reject(new Error('mini-gero not connected'));
  // Resolve the tabId we're actually sending through so the disconnect handler
  // can reject this request if the side panel closes before responding.
  const sendingTabId = (typeof tabId === 'number' ? tabId : NaN);
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    // No timeout — user interaction can take as long as needed.
    // Cleanup happens via port disconnect or explicit user response.
    pendingDAppRequests.set(requestId, {
      tabId: sendingTabId,
      resolve: (response) => {
        if (response.error) reject(new Error(String(response.error)));
        else resolve(response);
      },
    });
    port.postMessage({
      type: 'dapp-request',
      method,
      requestId,
      payload,
    });
  });
}

/**
 * Wait for the mini-gero side panel to connect its DApp channel port for a specific tab.
 * Resolves once the port for `tabId` is set, rejects after `timeoutMs`.
 */
function waitForMiniGeroPort(timeoutMs = 5000, tabId?: number): Promise<void> {
  const hasPort = () => typeof tabId === 'number' ? miniGeroPorts.has(tabId) : miniGeroPorts.size > 0;
  if (hasPort()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (hasPort()) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve();
      }
    }, 100);
    const timer = setTimeout(() => {
      clearInterval(interval);
      reject(new Error('mini-gero port connection timeout'));
    }, timeoutMs);
  });
}

const processedDomains: Set<string> = new Set<string>();

// Own/trusted domains — registrable domain (tldts getDomain), covers all subdomains.
// Always approved: skip the urlScan blacklist check.
const TRUSTED_DOMAINS: Set<string> = new Set<string>(['gerowallet.io']);

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

    // Lock method: a wallet auto-locks only when one is configured. MPC wallets
    // set unlockMethod to 'passkey'/'password' when their session lock is enabled
    // and leave it null for "None" — same rule as Normal wallets, no special case.
    const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
    const hasUnlockMethod = !!unlockMethodConfig?.value;

    // Last activity: absent means the wallet just logged in and the tracker hasn't
    // run yet — skip this tick.
    const lastActivityConfig = await configTable.where({ key: 'lastActivityTimestamp' }).first();
    if (!lastActivityConfig || !lastActivityConfig.value) {
      return;
    }

    const inactiveMinutes = (Date.now() - lastActivityConfig.value) / (1000 * 60);

    if (shouldAutoLock({ autoLockMinutes, hasUnlockMethod, inactiveMinutes })) {
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
  } else if (alarm.name === 'wc-keepalive') {
    import('@/services/walletConnect/walletConnect.service').then(({ walletConnectService }) => {
      walletConnectService.pingAll().catch(() => {});
    }).catch(() => {});
  }
});

let lastFullscreenTabId = -1;

const app = Messaging.createBackgroundController();

async function handleBlacklisted(request: { id: string; origin: string }, tabId: number) {
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
      return (await focusOrCreatePopup(popupURL, 470, 600)
        .then(tab => Messaging.sendToPopupInternal(tab.id, request))) as BackgroundResponse;
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

    // Own/trusted domain — always approved, skip blacklist scan.
    if (TRUSTED_DOMAINS.has(domain)) {
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
    const balance = getBalance(utxosFromStorage as Cardano.Utxo[], collateral)
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
  const reply = (opts: ReplyOpts) => {
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

  const favIconUrl = send.tab?.favIconUrl;
  const enablePayload = { ...request.data, website: origin, favIconUrl };

  const handleMiniGeroEnable = () => {
    return sendToMiniGero('enable', enablePayload, tabId)
      .then(async (response) => {
        if (response.data === true) {
          await WalletStore.addConnectedDapp(currentWallet.id, origin);
        }
        reply({ data: response.data });
      });
  };

  const openSidePanelAndSend = () => {
    if (typeof tabId !== 'number') {
      return reply({ error: APIError.InternalError });
    }
    openSidebar(tabId, 'sidepanel/index.html')
      .then(() => waitForMiniGeroPort(5000, tabId))
      .then(() => handleMiniGeroEnable())
      .catch(() => {
        // Fallback: popup window when side panel is not supported or fails
        const popupURL = chrome.runtime.getURL(
          `index.html#/${POPUP.dappConnect}?website=${encodeURIComponent(origin)}` +
            (favIconUrl ? `&favIconUrl=${encodeURIComponent(favIconUrl)}` : '')
        );
        focusOrCreatePopup(popupURL, 470, 600)
          .then(newTab => Messaging.sendToPopupInternal(newTab.id, request))
          .then((response: BackgroundResponse) => {
            if (response.data) reply({ data: response.data });
            else if (response.error) reply({ error: response.error });
            else reply({ error: APIError.InternalError });
          })
          .catch(err => reply({ error: err }));
      });
  };

  // Primary: route through mini-gero side panel drawer
  if (typeof tabId === 'number' && miniGeroPorts.has(tabId)) {
    handleMiniGeroEnable()
      .catch((err: unknown) => {
        reply({ error: errorMessage(err) || APIError.InternalError });
      });
  } else {
    openSidePanelAndSend();
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
    return;
  }
  // Only support Cardano-based chains for dApp API
  if (loggedWallet.chain !== Blockchain.CARDANO &&
      loggedWallet.chain !== Blockchain.APEX_PRIME &&
      loggedWallet.chain !== Blockchain.APEX_VECTOR) {
    sendResponse({
      id: request.id,
      error: APIError.Refused,
      target: TARGET,
      sender: SENDER.extension,
    });
    return;
  }
  sendResponse({
    id: request.id,
    data: Cardano.Address.fromBech32(loggedWallet.baseAddress).toBytes(),
    target: TARGET,
    sender: SENDER.extension,
  });
});

app.add(METHOD.getAddressBech32, async (request, sendResponse) => {
  const loggedWallet = WalletStore.state.loggedWallet;
  if (!loggedWallet || !loggedWallet.baseAddress) {
    sendResponse({
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    });
    return;
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

async function isWhitelisted(origin: string): Promise<boolean> {
  const whitelisted: WhitelistedEntry[] = WalletStore.state.connectedDapps || [];
  return !!whitelisted.find(el => el.domain && origin.indexOf(String(el.domain)) !== -1);
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
    const utxosFromStorage = WalletStore.state.utxos as Cardano.Utxo[];
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
    const utxos: string[] = await getCollateral(request.data.params, storedUtxos as Cardano.Utxo[])
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

/**
 * popupLogin — open the side panel so the user can pick a wallet.
 *
 * The side panel's own SPA (`sidepanel/index.html`) already renders
 * `WalletSelector` whenever no wallet is active, and auto-flips to the
 * mini-Gero UI once one becomes active. Rather than route to a bespoke
 * `Login.vue` page and round-trip through a port, we simply open the
 * side panel and poll `WalletStore.loggedWallet` until it is set (or the
 * user walks away and we time out).
 */
app.add(METHOD.popupLogin, async (request, sendResponse) => {
  const reply = (opts: ReplyOpts) =>
    sendResponse({ id: request.id, ...opts, target: TARGET, sender: SENDER.extension });

  // If somehow already logged in, resolve immediately.
  if (WalletStore.state.loggedWallet) {
    return reply({ data: 'login' });
  }

  const tabId = request.send?.tab?.id;
  const canUseSidePanel = !!request.data?.userGesture && typeof tabId === 'number';

  try {
    if (canUseSidePanel) {
      await openSidebar(tabId as number, 'sidepanel/index.html');
    } else {
      // Fallback: open the side-panel SPA in a popup window when no user
      // gesture is present (chrome.sidePanel.open requires one).
      const popupURL = chrome.runtime.getURL('sidepanel/index.html');
      await focusOrCreatePopup(popupURL, 470, 600);
    }
  } catch (e) {
    console.error('[popupLogin] failed to open side panel', e);
    return reply({ error: APIError.InternalError });
  }

  // Wait for the user to pick a wallet. Resolves once `loggedWallet` flips
  // from null to a wallet, rejects after 5 minutes of inactivity.
  const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
  const POLL_MS = 250;
  const ok = await new Promise<boolean>((resolve) => {
    const started = Date.now();
    const interval = setInterval(() => {
      if (WalletStore.state.loggedWallet) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - started >= LOGIN_TIMEOUT_MS) {
        clearInterval(interval);
        resolve(false);
      }
    }, POLL_MS);
  });

  if (ok) {
    reply({ data: 'login' });
  } else {
    reply({ error: APIError.Refused });
  }
});

app.add(METHOD.signData, (request, sendResponse) => {
  const signDataReply = (opts: ReplyOpts) => {
    sendResponse({ id: request.id, ...opts, target: TARGET, sender: SENDER.extension });
  };

  const signDataPayload = { ...request.data, website: request.origin, favIconUrl: request.send?.tab?.favIconUrl };
  const tabId = request.send?.tab?.id;

  const handleMiniGeroSignData = () => {
    return sendToMiniGero('signData', signDataPayload, tabId)
      .then((response) => signDataReply({ data: response.data }));
  };

  const openSidePanelForSignData = () => {
    if (typeof tabId !== 'number') {
      return signDataReply({ error: APIError.InternalError });
    }
    openSidebar(tabId, 'sidepanel/index.html')
      .then(() => waitForMiniGeroPort(5000, tabId))
      .then(() => handleMiniGeroSignData())
      .catch(() => {
        // Fallback: popup window
        const popupURL = chrome.runtime.getURL(`index.html#/${POPUP.dappSignData}?website=${encodeURIComponent(request.origin)}`);
        focusOrCreatePopup(popupURL, 470, 600)
          .then((tab) => Messaging.sendToPopupInternal(tab.id, request))
          .then((response: BackgroundResponse) => {
            if (response.data) signDataReply({ data: response.data });
            else if (response.error) signDataReply({ error: response.error });
            else signDataReply({ error: APIError.InternalError });
          })
          .catch((e) => signDataReply({ error: e }));
      });
  };

  // Primary: route through mini-gero side panel drawer
  if (typeof tabId === 'number' && miniGeroPorts.has(tabId)) {
    handleMiniGeroSignData()
      .catch((err: unknown) => {
        signDataReply({ error: errorMessage(err) || APIError.InternalError });
      });
  } else {
    openSidePanelForSignData();
  }
});

app.add(METHOD.signTx, async (request, sendResponse) => {
  const signTxReply = (opts: ReplyOpts) => {
    sendResponse({ id: request.id, ...opts, target: TARGET, sender: SENDER.extension });
  };

  const signTxPayload = { ...request.data, website: request.data?.origin || request.origin, favIconUrl: request.send?.tab?.favIconUrl };
  const tabId = request.send?.tab?.id;

  const handleMiniGeroSignTx = () => {
    return sendToMiniGero('signTx', signTxPayload, tabId)
      .then((response) => signTxReply({ data: response.data }));
  };

  // Pop a popup window with the SignTx route, send the request, and wire the
  // response back to the dApp. Used both as the primary path when the user has
  // disabled the side panel and as a fallback when opening the side panel fails.
  const openPopupForSignTx = async () => {
    const requestCopy = JSON.parse(JSON.stringify(request));
    // Force close any existing SignTx popups before opening a new one
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
    return focusOrCreatePopup(popupURL, 470, 852)
      .then((tab) => Messaging.sendToPopupInternal(tab.id, requestCopy))
      .then((response: BackgroundResponse) => {
        if (response.data) signTxReply({ data: response.data });
        else if (response.error) signTxReply({ error: response.error });
        else signTxReply({ error: APIError.InternalError });
      })
      .catch((e) => signTxReply({ error: e }));
  };

  const openSidePanelForSignTx = async () => {
    if (typeof tabId !== 'number') {
      return signTxReply({ error: APIError.InternalError });
    }

    // Phase 1: open the side panel and wait for the mini-gero port. Failures
    // here mean the user can't see the prompt at all, so we fall back to the
    // popup window. Phase 2 sends the request via the connected port —
    // errors there (incl. the user clicking Reject) are real responses and
    // must be relayed back to the dApp without spawning a second prompt.
    try {
      await openSidebar(tabId, 'sidepanel/index.html');
      await waitForMiniGeroPort(5000, tabId);
    } catch {
      return openPopupForSignTx();
    }

    handleMiniGeroSignTx().catch((err: unknown) => {
      signTxReply({ error: errorMessage(err) || APIError.InternalError });
    });
  };

  // Honor the user's "Prompt Display Mode" preference (Settings → Advanced).
  // useSidePanel === false means the user picked Popup, so skip the side panel
  // entirely instead of opening it and forcing a Reject before falling through.
  const useSidePanel = WalletStore.state.config?.useSidePanel !== false;

  if (!useSidePanel) {
    openPopupForSignTx();
    return;
  }

  // Primary: route through mini-gero side panel drawer
  if (typeof tabId === 'number' && miniGeroPorts.has(tabId)) {
    handleMiniGeroSignTx()
      .catch((err: unknown) => {
        signTxReply({ error: errorMessage(err) || APIError.InternalError });
      });
  } else {
    openSidePanelForSignTx();
  }
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
      let error: unknown;
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
    const { upsertZkSmartWalletWallet, isWalletActivated: checkActivated } = await import('../db/zk-smart-wallet-db');
    const { default: ZkSmartWalletStore } = await import('../stores/zkSmartWalletStore');

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
    const { getKeyId, getMatchingKey, getSignature, stripSignature } = await import('@/services/zkSmartWallet/google.api');
    const { BigIntWrap } = await import('@/services/zkSmartWallet/types');
    const { b64ToBn } = await import('@/services/zkSmartWallet/utils/json.utils');
    const { Prover } = await import('@/services/zkSmartWallet/prover');
    const { Backend } = await import('@/services/zkSmartWallet/backend');

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

    // Store proofId in zkSmartWallet database and store
    await upsertZkSmartWalletWallet({
      email: userId,
      userId,
      proofId,
      isActivated: false,
      walletId,
      createdAt: new Date()
    });
    ZkSmartWalletStore.setProofId(userId, proofId);
    console.log('✅ ProofId stored in zkSmartWallet DB and store');

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

        const zkSmartWalletUrl = import.meta.env['VITE_ZK_SMART_WALLET_API_URL'] || ''; // legacy hosted endpoint — unused, retained for reference
        const zkSmartWalletApiKey = import.meta.env['VITE_ZK_SMART_WALLET_API_KEY'] || null;
        const backend = new Backend(zkSmartWalletUrl, zkSmartWalletApiKey);

        console.log('🔐 Activating wallet on blockchain...');
        const createWalletResponse = await backend.activateWallet(strippedJwt, paymentKey.toPublic().hash(), proof);
        console.log('✅ Wallet activated successfully on blockchain!', createWalletResponse);

        // Mark as activated in zkSmartWallet database and store
        const { markWalletAsActivated } = await import('../db/zk-smart-wallet-db');
        await markWalletAsActivated(userId, walletId);
        ZkSmartWalletStore.markAsActivated(userId, walletId);

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

/**
 * Detect a backend "already enrolled" (HTTP 409) response without logging the
 * raw error (which may echo request details). `Api` throws a JSON-stringified
 * blob (see parseHttpError) rather than an Error instance on HTTP failures.
 */
function isMpcConflictError(error: unknown): boolean {
  const raw = typeof error === 'string' ? error : getErrorMessage(error, '');
  return raw.includes('"status":409');
}

/** Build a DeviceShareSecret from a request payload (passkey PRF or password). Never logged. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- request.data payload shape varies per handler (see Message.data in messaging.ts)
function buildDeviceShareSecret(data: any): { secret: DeviceShareSecret; webAuthnCredentialId?: string; mpcPrfSaltId?: string } {
  if (data?.prfOutputHex && data?.webAuthnCredentialId && data?.mpcPrfSaltId) {
    const prfOutput = Uint8Array.from(Buffer.from(data.prfOutputHex, 'hex'));
    return {
      secret: { kind: 'prf', prfOutput, credentialId: data.webAuthnCredentialId, saltId: data.mpcPrfSaltId },
      webAuthnCredentialId: data.webAuthnCredentialId,
      mpcPrfSaltId: data.mpcPrfSaltId,
    };
  }
  if (data?.spendingPassword) {
    return { secret: { kind: 'password', password: data.spendingPassword } };
  }
  throw new Error('A passkey or spending password is required');
}

app.addToOptions(MessageTypes.CREATE_MPC_GOOGLE_WALLET, async (request, sendResponse) => {
  try {
    // Note: Never log request.data — contains idToken/spendingPassword/prfOutputHex
    const { name, icon, theme, chain, network, idToken } = request.data || {};
    if (!idToken) throw new Error('idToken is required');
    const { secret, webAuthnCredentialId, mpcPrfSaltId } = buildDeviceShareSecret(request.data);

    const { prepareMpcWalletCreation, encryptDeviceShare } = await import('@/shared/utils/mpc');
    const { createMpcGoogleWallet } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    const { walletId, recoveryShare, publicKey } = await createMpcGoogleWalletFlow(
      { name, icon, theme, chain, network, idToken, secret, webAuthnCredentialId, mpcPrfSaltId },
      {
        prepareMpcWalletCreation,
        encryptDeviceShare,
        enrollLoginShare: (idTok, ch, net, loginShare) => api.mpc.enroll(idTok, ch, net, loginShare),
        createMpcGoogleWallet,
        subFromIdToken,
      },
    );

    sendResponse({
      id: request.id,
      // recoveryShare is returned to the caller for the encrypted-download backup step —
      // it is never logged or persisted by this handler. publicKey (xpub, not secret)
      // is embedded in the recovery-file envelope as the restore-time anchor.
      data: { success: true, walletId, recoveryShare, publicKey },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    const message = isMpcConflictError(error)
      ? 'This Google account is already enrolled for an MPC wallet.'
      : getErrorMessage(error, 'Failed to create MPC wallet');
    console.error('Error creating MPC Google wallet:', message);
    sendResponse({
      id: request.id,
      data: { success: false, error: message },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
});

app.addToOptions(MessageTypes.UNLOCK_MPC_WALLET, async (request, sendResponse) => {
  try {
    // Note: Never log request.data — contains idToken/spendingPassword/prfOutputHex
    const { walletId, idToken } = request.data || {};
    if (!walletId) throw new Error('walletId is required');
    // Two ways in: a fresh Google idToken (first unlock of the session) OR a
    // login share already cached from an earlier unlock this session (re-unlock
    // after a lock, no repeat Google sign-in). One of them must be present.
    const hasCachedLoginShare = await mpcLoginShareCache.has(walletId);
    if (!idToken && !hasCachedLoginShare) {
      // No fresh Google token and no cached session (e.g. the service worker
      // restarted). Surface guidance the UI can show and fall back to Google.
      throw new Error('MPC session expired — sign in with Google');
    }
    const { secret } = buildDeviceShareSecret(request.data);

    const { reconstructRootKeyBytes } = await import('@/shared/utils/mpc');
    const { getAllWallets } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    // With an idToken: fetch the login share from the backend. Without one:
    // reuse the cached share (device + cached-login = 2 of 3, still gated by the
    // device secret the user just supplied). Never log the share. The freshly
    // fetched share is cached only AFTER reconstruct+validate succeeds below, so
    // a wrong device secret / wrong account can never seed the Google-free path.
    let fetchedLoginShare: string | null = null;
    const getLoginShare = idToken
      ? async (idTok: string, ch: string, net: string): Promise<string> => {
          const share = await api.mpc.getLoginShare(idTok, ch, net);
          fetchedLoginShare = share;
          return share;
        }
      : async (): Promise<string> => {
          const cached = await mpcLoginShareCache.get(walletId);
          if (!cached) throw new Error('MPC session expired — sign in with Google');
          return cached;
        };

    await unlockMpcWalletFlow(
      { walletId, idToken: idToken || '', secret },
      {
        getWallet: async (id) => {
          const wallets = await getAllWallets();
          return wallets[id];
        },
        getLoginShare,
        reconstructRootKeyBytes,
        sessionCache: mpcSessionCache,
      },
    );

    // Reconstruct+validate passed — only now is it safe to cache the freshly
    // fetched login share so later re-unlocks this session can skip Google.
    if (fetchedLoginShare) {
      await mpcLoginShareCache.set(walletId, fetchedLoginShare);
    }

    // Flip the global lock the same way walletManager.unlock() does. Without
    // this, an already-logged-in MPC wallet that was re-locked stays stuck:
    // the dashboard router guard (needsAuth && isLocked) bounces to /welcome
    // and the side panel keeps rendering LockScreen (both gate on isLocked).
    WalletStore.setLocked(false);

    sendResponse({
      id: request.id,
      data: { success: true },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error('Error unlocking MPC wallet:', getErrorMessage(error, 'unlock failed'));
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error, 'Failed to unlock MPC wallet') },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
});

/**
 * Whether this MPC wallet has a login share cached this session — i.e. it was
 * unlocked with Google earlier and can be re-unlocked with just the device
 * secret (passkey/spending password), skipping a repeat Google sign-in. Returns
 * false after the service worker restarts or the wallet logs out (cache gone),
 * so the unlock UI falls back to Google. No secrets are returned.
 */
app.addToOptions(MessageTypes.HAS_MPC_SESSION, async (request, sendResponse) => {
  const { walletId } = request.data || {};
  const hasSession = !!walletId && (await mpcLoginShareCache.has(walletId));
  sendResponse({
    id: request.id,
    data: { success: true, hasSession },
    target: TARGET,
    sender: SENDER.extension,
  });
  return true;
});

/**
 * Server-INDEPENDENT unlock (safety valve): reconstruct from the LOCAL device share
 * + the user's recovery file (device + recovery = 2 of 3), so a lost/unreachable
 * backend can't lock the user out of the funds on this device. No login-share fetch,
 * no Google call. reconstructRootKeyBytes combines any two shares — here we pass the
 * recovery share as the second share instead of the backend login share. Never log
 * the device secret / recovery passphrase / shares.
 */
app.addToOptions(MessageTypes.UNLOCK_MPC_WALLET_OFFLINE, async (request, sendResponse) => {
  try {
    const { walletId, recoveryBlob, recoveryPassword } = request.data || {};
    if (!walletId || !recoveryBlob || !recoveryPassword) {
      throw new Error('walletId, recoveryBlob and recoveryPassword are required');
    }
    const { secret } = buildDeviceShareSecret(request.data);

    const { reconstructRootKeyBytes, decryptRecoveryShare, MpcValidationError } = await import('@/shared/utils/mpc');
    const { getAllWallets } = await import('@/db/gero-db');

    const wallet = (await getAllWallets())[walletId];
    if (!wallet || !wallet.mpcDeviceShare) {
      throw new Error('MPC wallet not found on this device');
    }

    const recoveryShare = await decryptRecoveryShare(recoveryBlob, recoveryPassword);
    try {
      // device + recovery (recoveryShare passed as the second share); validates xpub.
      const bytes = await reconstructRootKeyBytes(wallet.mpcDeviceShare, secret, recoveryShare, wallet.publicKey);
      mpcSessionCache.set(walletId, bytes);
    } catch (err) {
      if (err instanceof MpcValidationError) {
        throw new Error('Recovery data does not match this wallet — check your recovery file and password.');
      }
      throw err;
    }

    // Same as the online path: clear the global lock so the dashboard/side panel
    // actually leave the locked state after a successful offline reconstruction.
    WalletStore.setLocked(false);

    sendResponse({
      id: request.id,
      data: { success: true },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error('Error unlocking MPC wallet offline:', getErrorMessage(error, 'offline unlock failed'));
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error, 'Failed to unlock offline') },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
});

app.addToOptions(MessageTypes.RECOVER_MPC_GOOGLE_WALLET, async (request, sendResponse) => {
  try {
    // Note: Never log request.data — contains idToken/recoveryPassword/spendingPassword/prfOutputHex
    const {
      name, icon, theme, chain, network, idToken,
      recoveryBlob, recoveryPassword, publicKey: expectedXpub,
    } = request.data || {};
    if (!idToken || !recoveryBlob || !recoveryPassword || !expectedXpub) {
      throw new Error('idToken, recoveryBlob, recoveryPassword and publicKey are required');
    }
    const { secret: newSecret, webAuthnCredentialId, mpcPrfSaltId } = buildDeviceShareSecret(request.data);

    const { decryptRecoveryShare, reconstructAndValidateEntropy, encryptDeviceShare } = await import('@/shared/utils/mpc');
    const { createMpcGoogleWallet } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    const { walletId, publicKey } = await recoverMpcGoogleWalletFlow(
      {
        name, icon, theme, chain, network, idToken, recoveryBlob, recoveryPassword, newSecret,
        expectedXpub, webAuthnCredentialId, mpcPrfSaltId,
      },
      {
        decryptRecoveryShare,
        getLoginShare: (idTok, ch, net) => api.mpc.getLoginShare(idTok, ch, net),
        reconstructAndValidateEntropy,
        encryptDeviceShare,
        createMpcGoogleWallet,
        subFromIdToken,
      },
    );

    sendResponse({
      id: request.id,
      data: { success: true, walletId, publicKey },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    // Anchor mismatch (wrong recovery file / wrong Google account) surfaces as a
    // clean message; the raw MpcValidationError is not leaked.
    const { MpcValidationError } = await import('@/shared/utils/mpc');
    const message = error instanceof MpcValidationError
      ? "This recovery file doesn't match this Google account."
      : getErrorMessage(error, 'Failed to recover MPC wallet');
    console.error('Error recovering MPC Google wallet:', message);
    sendResponse({
      id: request.id,
      data: { success: false, error: message },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
});

/**
 * Check whether this Google account is already enrolled for an MPC wallet on the
 * backend (for a fresh device with no local wallet). Probes the login-share
 * endpoint: a stored share (idempotent retrieval) means enrolled; a 404 means not.
 * The JWT is verified server-side; the login share is never logged.
 */
app.addToOptions(MessageTypes.CHECK_MPC_ENROLLMENT, async (request, sendResponse) => {
  try {
    // Note: Never log request.data — contains idToken
    const { idToken, chain, network } = request.data || {};
    if (!idToken || !chain || !network) {
      throw new Error('idToken, chain and network are required');
    }
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    let enrolled = false;
    let serverReachable = true;
    try {
      await api.mpc.getLoginShare(idToken, chain, network);
      enrolled = true; // share returned → enrolled, server up
    } catch (probeError) {
      const raw = typeof probeError === 'string' ? probeError : getErrorMessage(probeError, '');
      if (raw.includes('"status":404')) {
        enrolled = false; // no share stored → not enrolled, server up
      } else {
        // Network error / timeout / 5xx → the backend is unreachable. Report it so the
        // UI can offer the server-independent (offline) recovery only when relevant.
        serverReachable = false;
      }
    }

    sendResponse({
      id: request.id,
      data: { success: true, enrolled, serverReachable },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error('Error checking MPC enrollment:', getErrorMessage(error, 'check failed'));
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error, 'Failed to check enrollment') },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
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
      // Convert privateKeyBytes array back to Uint8Array if passed (PRF wallets).
      // Mirrors the SIGN_TX handler convention (number[] over the wire).
      const privateKeyBytes = resolveSignPrivateKeyBytes(
        WalletStore.state.loggedWallet,
        request.data.privateKeyBytes ? new Uint8Array(request.data.privateKeyBytes) : undefined
      );

      const res = await walletBg.signData(
        request.data.address,
        request.data.payload,
        request.data.password,
        request.data.accountIndex || 0,
        WalletStore.state.keys,
        privateKeyBytes, // Pass pre-decrypted root key for PRF wallets
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

/**
 * Merge two TransactionWitnessSet CBOR blobs into one. Used to fold the Nexus
 * collateral co-sign witness into the user's witness before returning to the
 * dApp. Cardano's witness set deduplicates VKeyWitnesses by pubkey, so the
 * Map-based merge preserves both signers without producing duplicates.
 */
async function mergeWitnessSets(userWitnessCbor: string, extraWitnessCbor: string): Promise<string> {
  const { Serialization } = await import('@cardano-sdk/core');
  const { HexBlob } = await import('@cardano-sdk/util');

  const userCore = Serialization.TransactionWitnessSet.fromCbor(HexBlob(userWitnessCbor)).toCore();
  const extraCore = Serialization.TransactionWitnessSet.fromCbor(HexBlob(extraWitnessCbor)).toCore();

  const merged = {
    signatures: new Map([
      ...(userCore.signatures?.entries() || []),
      ...(extraCore.signatures?.entries() || []),
    ]),
    ...(userCore.bootstrap && { bootstrap: userCore.bootstrap }),
    ...(userCore.scripts && { scripts: userCore.scripts }),
    ...(userCore.redeemers && { redeemers: userCore.redeemers }),
    ...(userCore.datums && { datums: userCore.datums }),
  };

  return Serialization.TransactionWitnessSet.fromCore(merged).toCbor();
}

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
      const privateKeyBytes = resolveSignPrivateKeyBytes(
        WalletStore.state.loggedWallet,
        request.data.privateKeyBytes ? new Uint8Array(request.data.privateKeyBytes) : undefined
      );

      let witnessResult = await walletBg.signTx(
        transaction,
        request.data.password,
        request.data.accountIndex || 0,
        request.data.utxos,
        request.data.addresses,
        privateKeyBytes, // Pass pre-decrypted private key for PRF wallets
      );

      // Nexus shared-pool collateral co-sign. If the tx's collateralInputs include
      // any UTxO from the Nexus enterprise pool, request the hot wallet's witness
      // for it and merge it with the user's witness. We don't track which inputs
      // are "ours" (no client-side cache) — we just ask Nexus, which returns 404
      // for any ref that isn't in its pool, and merge witnesses from the ones
      // that succeed.
      const txCborForCosign: string | undefined = request.data.txCbor;
      if (txCborForCosign && transaction?.body?.collaterals?.length) {
        for (const c of transaction.body.collaterals) {
          const ref = `${c.txId}#${c.index}`;
          try {
            const { witness } = await nexusCollateralApi.cosign(txCborForCosign, ref);
            const merged = await mergeWitnessSets(witnessResult.witnesses, witness);
            witnessResult = { witnesses: merged };
            debugLog('🔗 Merged Nexus collateral cosign for', ref);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- axios-shaped error, status/message accessed defensively below
          } catch (cosignErr: any) {
            const status = cosignErr?.response?.status;
            // 404 = ref isn't in the Nexus pool (it's a user-owned UTxO),
            // 400 = adversarial-tx guard tripped — both expected for non-pool refs.
            if (status !== 404 && status !== 400) {
              debugLog('⚠️ Nexus cosign failed for', ref, status, cosignErr?.message);
            }
          }
        }
      }

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

// Cross-device signing (requester side). Hands an UNSIGNED tx CBOR to the
// cross-device bridge, which relays it to another registered device for
// approval + local signing, and returns a SignDecision. Dark unless the
// isCrossDeviceSigningEnabled flag is on (getCrossDeviceSigning() returns null).
app.addToOptions(MessageTypes.REQUEST_CROSS_DEVICE_SIGNATURE, async (request, sendResponse) => {
  try {
    const signing = walletManager.getCrossDeviceSigning();
    if (!signing) {
      sendResponse({
        id: request.id,
        data: { decision: 'rejected', reason: 'Cross-device signing is not available' },
        target: TARGET,
        sender: SENDER.extension,
      });
      return;
    }

    const { unsignedCbor, intent, stakeAddress, ttlMs } = request.data;
    // Route to a specific device when the caller named one, else to the sole
    // online trusted signer; null => broadcast (backward-compatible).
    const to = (typeof request.data?.to === 'string' && request.data.to)
      || walletManager.getDefaultCrossDeviceTarget()
      || undefined;
    const decision = await signing.requestSignature({ unsignedCbor, intent, stakeAddress, ttlMs, to });

    sendResponse({
      id: request.id,
      data: decision,
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error('Error requesting cross-device signature:', error);
    sendResponse({
      id: request.id,
      data: { decision: 'rejected', reason: getErrorMessage(error) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

// ---- Remote-signing settings (Security tab) --------------------------------
// Read + mutate per-wallet trusted devices + policy. Mutations are auth-gated in
// the UI (the Security verification overlay). Each responds with the fresh
// settings so the UI store stays in sync.
function crossDeviceReply(id: string, data: unknown) {
  return { id, data, target: TARGET, sender: SENDER.extension };
}

app.addToOptions(MessageTypes.GET_CROSS_DEVICE_SETTINGS, async (request, sendResponse) => {
  sendResponse(crossDeviceReply(request.id, { success: true, settings: walletManager.getRemoteSigningSettings() }));
});

app.addToOptions(MessageTypes.GET_CROSS_DEVICE_DEVICES, async (request, sendResponse) => {
  sendResponse(crossDeviceReply(request.id, { success: true, devices: walletManager.getCrossDeviceDevices() }));
});

app.addToOptions(MessageTypes.SET_REMOTE_SIGNING_ENABLED, async (request, sendResponse) => {
  try {
    const settings = await walletManager.setRemoteSigningEnabled(!!request.data?.enabled);
    sendResponse(crossDeviceReply(request.id, { success: true, settings }));
  } catch (error) {
    sendResponse(crossDeviceReply(request.id, { success: false, error: getErrorMessage(error) }));
  }
});

app.addToOptions(MessageTypes.SET_CROSS_DEVICE_POLICY, async (request, sendResponse) => {
  try {
    const policy = request.data?.policy === 'require_remote' ? 'require_remote' : 'ask';
    const settings = await walletManager.setCrossDevicePolicy(policy);
    sendResponse(crossDeviceReply(request.id, { success: true, settings }));
  } catch (error) {
    sendResponse(crossDeviceReply(request.id, { success: false, error: getErrorMessage(error) }));
  }
});

app.addToOptions(MessageTypes.TRUST_CROSS_DEVICE, async (request, sendResponse) => {
  try {
    const deviceId = String(request.data?.deviceId ?? '');
    const settings = await walletManager.trustCrossDevice(deviceId);
    // Pairing no-ops if the device left the registry between listing and click.
    const pinned = !!settings.trustedDevices[deviceId];
    sendResponse(crossDeviceReply(request.id, pinned
      ? { success: true, settings }
      : { success: false, error: 'device_unavailable', settings }));
  } catch (error) {
    sendResponse(crossDeviceReply(request.id, { success: false, error: getErrorMessage(error) }));
  }
});

app.addToOptions(MessageTypes.UNTRUST_CROSS_DEVICE, async (request, sendResponse) => {
  try {
    const settings = await walletManager.untrustCrossDevice(String(request.data?.deviceId ?? ''));
    sendResponse(crossDeviceReply(request.id, { success: true, settings }));
  } catch (error) {
    sendResponse(crossDeviceReply(request.id, { success: false, error: getErrorMessage(error) }));
  }
});

// Sign the one-time wallet-control proof endorsing this device's relay-auth key.
// Requires spending auth (the wallet stake key COSE-signs), so the UI collects the
// password / passkey at enable-time and passes it here; the proof is then cached and
// rides every DEVICE_REGISTER. See docs/plans/2026-07-03-authenticated-device-register-contract.md.
app.addToOptions(MessageTypes.PRODUCE_DEVICE_REGISTER_PROOF, async (request, sendResponse) => {
  try {
    const password = typeof request.data?.password === 'string' ? request.data.password : undefined;
    const pkBytes = request.data?.privateKeyBytes;
    const privateKeyBytes = Array.isArray(pkBytes) ? Uint8Array.from(pkBytes) : undefined;
    const ok = await walletManager.produceDeviceRegisterProof({ password, privateKeyBytes });
    sendResponse(crossDeviceReply(request.id, { success: ok }));
  } catch (error) {
    sendResponse(crossDeviceReply(request.id, { success: false, error: getErrorMessage(error) }));
  }
});

// QR scan-to-pair: mint the payload the desktop renders as a QR (identity + proof +
// a fresh single-use nonce). Returns success:false when the wallet can't be paired
// (no cached proof / no stake) so the UI can prompt to re-enable.
app.addToOptions(MessageTypes.GET_PAIRING_QR, async (request, sendResponse) => {
  try {
    const payload = await walletManager.buildPairingQrPayload();
    sendResponse(crossDeviceReply(request.id, { success: !!payload, payload }));
  } catch (error) {
    sendResponse(crossDeviceReply(request.id, { success: false, error: getErrorMessage(error) }));
  }
});

// QR scan-to-pair: the last device paired via a scan (consumed on read), for the
// settings dialog's success poll.
app.addToOptions(MessageTypes.GET_PAIRING_STATUS, async (request, sendResponse) => {
  sendResponse(crossDeviceReply(request.id, { success: true, paired: walletManager.getPairingStatus() }));
});

// Pool operator transaction signing handler (cold key + wallet keys)
app.addToOptions(MessageTypes.SIGN_TX_WITH_POOL_KEYS, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg) {
      sendResponse({ id: request.id, data: { error: 'Wallet instance not available' }, target: TARGET, sender: SENDER.extension });
      return;
    }

    const { txCbor, password, accountIndex, utxos, addresses, privateKeyBytes } = request.data;

    // Step 1: Sign with wallet keys (payment + stake) using existing signTx
    let transaction;
    if (txCbor) {
      transaction = deserializeCardanoJsSdkTx(txCbor);
    } else {
      throw new Error('No transaction data provided');
    }

    // Route through resolveSignPrivateKeyBytes so an MPC Google wallet (SPO
    // cold-key import permits WalletType.Google) signs with its cached
    // root-key bytes instead of hitting decrypt(undefined). PRF/password
    // wallets are unaffected (explicit bytes / undefined pass straight through).
    const prfSecret = resolveSignPrivateKeyBytes(
      WalletStore.state.loggedWallet,
      privateKeyBytes ? new Uint8Array(privateKeyBytes) : undefined
    );
    const walletWitnesses = await walletBg.signTx(transaction, password, accountIndex || 0, utxos, addresses, prfSecret);

    // Step 2: Decrypt cold key from wallet DB and sign with it
    const { getDb } = await import('@/db/wallet-db');
    const db = await getDb(walletBg.id);
    const configTable = db.table('config');
    const encryptedColdKeyEntry = await configTable.where({ key: 'spo_encryptedColdKey' }).first();
    const coldKeyEncryptionEntry = await configTable.where({ key: 'spo_coldKeyEncryption' }).first();

    if (!encryptedColdKeyEntry?.value) {
      throw new Error('No cold key configured. Import your cold key first.');
    }

    // Decrypt the cold key based on encryption method
    let coldKeyBytes: Buffer | Uint8Array;
    const coldKeyEncryption = coldKeyEncryptionEntry?.value || 'password';

    if (coldKeyEncryption === 'prf') {
      // PRF wallet: decrypt with PRF-derived key
      const { decryptPrivateKeyWithPrf } = await import('@/shared/utils/webauthn-prf');
      const wallet = walletManager.getWallet();
      if (!wallet?.webAuthnCredentialId) {
        throw new Error('PRF wallet credentials not available');
      }
      coldKeyBytes = await decryptPrivateKeyWithPrf(
        encryptedColdKeyEntry.value,
        wallet.webAuthnCredentialId,
        wallet.id.toString()
      );
    } else {
      // Normal wallet: decrypt with spending password
      const { decryptWithPassword } = await import('@/shared/utils/crypto');
      coldKeyBytes = decryptWithPassword(password, encryptedColdKeyEntry.value);
    }

    // Step 3: Sign the transaction hash with the cold key
    const { ed25519 } = await import('@noble/curves/ed25519');
    const { Serialization } = await import('@cardano-sdk/core');

    // Get the transaction body hash (what we sign)
    const txBody = Serialization.TransactionBody.fromCore(transaction.body);
    const blake2b = (await import('blake2b')).default;
    const txBodyCbor = txBody.toCbor() as unknown as Uint8Array;
    const txBodyHash = blake2b(32).update(txBodyCbor).digest();

    // Sign with the cold key
    const coldKeySignature = ed25519.sign(txBodyHash, new Uint8Array(coldKeyBytes));
    const coldPubKey = ed25519.getPublicKey(new Uint8Array(coldKeyBytes));

    // Step 4: Build cold key VKeyWitness and merge with wallet witnesses
    const coldPubKeyHex = Array.from(coldPubKey).map(b => b.toString(16).padStart(2, '0')).join('');
    const coldSigHex = Array.from(coldKeySignature).map(b => b.toString(16).padStart(2, '0')).join('');

    sendResponse({
      id: request.id,
      data: {
        witnesses: walletWitnesses.witnesses || walletWitnesses,
        coldKeyWitness: {
          vkey: coldPubKeyHex,
          signature: coldSigHex,
        },
      },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error('Error signing pool operator transaction:', error);
    sendResponse({
      id: request.id,
      data: { error: getErrorMessage(error) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

// SPO Node Monitor — proxy fetch through background (bypasses extension page CSP)
app.addToOptions(MessageTypes.SPO_NODE_FETCH, async (request, sendResponse) => {
  try {
    const { url, timeout, method, body } = request.data;
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout || 10000);
    const fetchOpts: RequestInit = { signal: controller.signal };
    if (method === 'POST') {
      fetchOpts.method = 'POST';
      fetchOpts.headers = { 'Content-Type': 'application/json' };
      if (body) fetchOpts.body = body;
    }
    const response = await fetch(url, fetchOpts);
    clearTimeout(timer);
    const data = await response.json();
    sendResponse({
      id: request.id,
      data: { success: true, status: response.status, body: data },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error: unknown) {
    sendResponse({
      id: request.id,
      data: { success: false, error: errorMessage(error) || 'Fetch failed' },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

// Bitcoin transaction signing handler (software wallets)
app.addToOptions(MessageTypes.SIGN_BITCOIN_TX, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (walletBg && walletBg.chain === Blockchain.BITCOIN) {
      // Defense-in-depth: MPC wallets are Cardano-only, so chain-gating above
      // already excludes them, but guard the Bitcoin-specific signer explicitly.
      assertMpcActionSupported(WalletStore.state.loggedWallet, 'Bitcoin signing');
      const { psbtHex, password, prfSecret } = request.data;

      // Sign Bitcoin transaction
      const signedTx = await walletBg.signBitcoinTransaction(psbtHex, password, prfSecret);

      sendResponse({
        id: request.id,
        data: { success: true, ...signedTx },
        target: TARGET,
        sender: SENDER.extension,
      });
    } else {
      sendResponse({
        id: request.id,
        data: { error: 'Not a Bitcoin wallet or wallet not available' },
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  } catch (error) {
    console.error('Error signing Bitcoin transaction:', error);
    sendResponse({
      id: request.id,
      data: { error: getErrorMessage(error) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

// Bitcoin hardware wallet signing handler
app.addToOptions(MessageTypes.SIGN_BITCOIN_TX_HARDWARE, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (walletBg && walletBg.chain === Blockchain.BITCOIN) {
      // Sign Bitcoin transaction with hardware wallet
      const result = await walletBg.signBitcoinTransactionWithHardware();

      sendResponse({
        id: request.id,
        data: result,
        target: TARGET,
        sender: SENDER.extension,
      });
    } else {
      sendResponse({
        id: request.id,
        data: { success: false, error: 'Not a Bitcoin wallet or wallet not available' },
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  } catch (error) {
    console.error('Error signing Bitcoin transaction with hardware wallet:', error);
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

// Bitcoin sync handler (manual refresh)
app.addToOptions(MessageTypes.SYNC_BITCOIN, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
      sendResponse({
        id: request.id,
        data: { success: false, error: 'Not a Bitcoin wallet or wallet not available' },
        target: TARGET,
        sender: SENDER.extension,
      });
      return;
    }

    // Sync UTXOs and transactions
    await walletBg.syncBitcoinWalletComplete();

    sendResponse({
      id: request.id,
      data: { success: true },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error('Error syncing Bitcoin wallet:', error);
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

// Bitcoin send transaction handler (complete flow: build, sign, broadcast)
app.addToOptions(MessageTypes.SEND_BITCOIN, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
      sendResponse({
        id: request.id,
        data: { success: false, error: 'Not a Bitcoin wallet or wallet not available' },
        target: TARGET,
        sender: SENDER.extension,
      });
      return;
    }

    // Defense-in-depth: MPC wallets are Cardano-only (chain-gated out above);
    // guard the Bitcoin send path explicitly so MPC never hits decrypt(undefined).
    assertMpcActionSupported(WalletStore.state.loggedWallet, 'Bitcoin signing');

    const { recipientAddress, amount, feeRate, password, privateKeyBytes } = request.data;

    // Convert privateKeyBytes array back to Uint8Array if passed (PRF wallets)
    const prfSecret = privateKeyBytes ? new Uint8Array(privateKeyBytes) : undefined;

    // Import Bitcoin transaction building modules
    const { buildSimpleSendPsbt } = await import('@/chains/bitcoin/bitcoinPsbtBuilder');
    const { BitcoinApi } = await import('@/api/bitcoin-api');

    // Step 1: Fetch UTXOs from store (WalletBg doesn't hold UTXOs directly)
    const utxos = WalletStore.state.utxos;
    if (!utxos || utxos.length === 0) {
      throw new Error('No UTXOs available');
    }

    // Step 2: Build PSBT
    const changeAddress = walletBg.baseAddress;
    const unsignedTx = buildSimpleSendPsbt(
      utxos as IUnifiedUtxo[],
      recipientAddress,
      BigInt(amount),
      changeAddress,
      feeRate,
      walletBg.network,
      walletBg.publicKey
    );

    // Step 3: Sign PSBT
    const signedTx = await walletBg.signBitcoinTransaction(
      unsignedTx.raw.hex,
      password,
      prfSecret
    );

    // Step 4: Broadcast transaction
    const bitcoinApi = new BitcoinApi(
      { chain: walletBg.chain, network: walletBg.network },
      walletBg.provider
    );
    const txId = await bitcoinApi.broadcastTransaction(signedTx.txHex);

    // Step 5: Refresh wallet data
    await walletBg.syncBitcoinWallet();
    await walletBg.syncBitcoinTransactions();

    sendResponse({
      id: request.id,
      data: { success: true, txId, txHex: signedTx.txHex },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error('Error sending Bitcoin transaction:', error);
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

// Babylon staking handler
// PSBT is built in the frontend (BabylonStakeDialog) to avoid bundling the heavy
// @babylonlabs-io/btc-staking-ts library into the background service worker.
// This handler only receives the pre-built psbtHex, signs it, and broadcasts.
app.addToOptions(MessageTypes.BABYLON_STAKE, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
      sendResponse({
        id: request.id,
        data: { success: false, error: 'Not a Bitcoin wallet or wallet not available' },
        target: TARGET,
        sender: SENDER.extension,
      });
      return;
    }

    // Defense-in-depth: MPC wallets are Cardano-only (chain-gated out above).
    assertMpcActionSupported(WalletStore.state.loggedWallet, 'Bitcoin signing');

    const { psbtHex, password, privateKeyBytes } = request.data;
    const prfSecret = privateKeyBytes ? new Uint8Array(privateKeyBytes) : undefined;

    const { BitcoinApi } = await import('@/api/bitcoin-api');

    // Step 1: Sign the pre-built PSBT
    const signedTx = await walletBg.signBitcoinTransaction(psbtHex, password, prfSecret);

    // Step 2: Broadcast
    const bitcoinApi = new BitcoinApi(
      { chain: walletBg.chain, network: walletBg.network },
      walletBg.provider
    );
    const txId = await bitcoinApi.broadcastTransaction(signedTx.txHex);

    // Step 3: Refresh wallet data
    await walletBg.syncBitcoinWallet();
    await walletBg.syncBitcoinTransactions();

    sendResponse({
      id: request.id,
      data: { success: true, txId, txHex: signedTx.txHex },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error('Error signing/broadcasting Babylon staking transaction:', error);
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error) },
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
        // Integrity guard: capture the tx body hash BEFORE merging the external
        // witness set. Merging a VKey witness set must never alter body bytes;
        // this defends the cross-device signing path (and any external cosigner)
        // against a swapped body sneaking in with the returned witnesses.
        const bodyHashBefore = serializableTx.body().hash();
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
        // Re-check the body hash after applying witnesses. If it changed, the
        // merge touched body bytes: refuse to submit rather than sign something
        // the user never confirmed.
        const bodyHashAfter = serializableTx.body().hash();
        if (bodyHashBefore !== bodyHashAfter) {
          throw new Error('Transaction body changed while applying witness set; refusing to submit');
        }
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
      // Initialize WalletConnect in background (non-blocking)
      import('@/services/walletConnect/walletConnect.service').then(({ walletConnectService }) => {
        walletConnectService.initialize()
          .then(() => setupWalletConnectCallbacks(walletConnectService))
          .catch(e => console.warn('⚠️ WC init failed:', e));
      });
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
    // Disconnect all WC sessions on logout (non-blocking)
    import('@/services/walletConnect/walletConnect.service').then(async ({ walletConnectService }) => {
      await walletConnectService.disconnectAllSessions();
      walletConnectService.destroy();
      const { default: WCStore } = await import('@/stores/walletConnectStore');
      WCStore.clear();
    }).catch(() => {});

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

      let coldWalletProps;
      if (network.blockchain === Blockchain.CARDANO) {
        const path = `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'`;
        coldWalletProps = await trezor.getXpub(path);
      } else if (network.blockchain === Blockchain.BITCOIN) {
        // Bitcoin wallet - use default SegWit address type
        coldWalletProps = await trezor.initBitcoinTrezor('segwit', 0);

        // Format Bitcoin response to match expected structure
        if (coldWalletProps) {
          const { xpub, deviceLabel, firmwareVersion } = coldWalletProps;
          coldWalletProps = {
            productName: deviceLabel,
            hwPublicKey: xpub,
            keys: [{ publicKey: xpub, chainCode: '', path: "m/84'/0'/0'" }],
            btSupported: true,
            version: firmwareVersion
          };
        }
      }

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

      const utxos = WalletStore.state.utxos as Cardano.Utxo[];

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
    } else if (request.data.method === 'verifyBitcoinAddress') {
      // Verify Bitcoin address on Trezor device
      const { addressType, accountIndex, addressIndex, isChange } = request.data;

      const verifiedAddress = await trezor.verifyBitcoinAddress(
        addressType || 'segwit',
        accountIndex || 0,
        addressIndex || 0,
        isChange || false
      );

      sendResponse({
        id: request.id,
        data: { success: true, address: verifiedAddress },
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

app.addToOptions(MessageTypes.OPEN_SIDE_PANEL, async (request, sendResponse) => {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) {
      await openSidebar(activeTab.id, 'sidepanel/index.html');
    }
    sendResponse({
      id: request.id,
      data: { success: true },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (err) {
    console.error('open side panel error', err);
    sendResponse({
      id: request.id,
      data: { success: false },
      target: TARGET,
      sender: SENDER.extension,
      error: err,
    });
  }
});

// ─── Bitcoin DApp API (Unisat-compatible) ──────────────────────────────────────

app.add(BITCOIN_METHOD.enable, (request, sendResponse) => {
  const { id, origin, send } = request;
  const tabId = send.tab?.id;
  const reply = (opts: ReplyOpts) =>
    sendResponse({ id, ...opts, target: TARGET, sender: SENDER.extension });

  const currentWallet = walletManager.getWallet();
  if (!currentWallet || currentWallet.chain !== Blockchain.BITCOIN) {
    return reply({ error: APIError.AccountNotSet });
  }

  if (WalletStore.isWhitelisted(origin)) {
    return reply({ data: [currentWallet.baseAddress] });
  }

  if (typeof tabId !== 'number') {
    return reply({ error: APIError.InternalError });
  }

  const handleResponse = (response: BackgroundResponse) => {
    if (response.data) {
      // Immediately update the background's in-memory whitelist so that subsequent
      // calls (getPublicKey, getNetwork, etc.) pass the whitelist check without
      // waiting for the Dexie live-query subscription to fire asynchronously.
      if (!WalletStore.isWhitelisted(origin)) {
        try {
          const hostname = new URL(origin).hostname;
          const currentDapps = WalletStore.state.connectedDapps || [];
          WalletStore.setConnectedDapps([...currentDapps, { domain: hostname }]);
        } catch {}
      }
      reply({ data: [currentWallet.baseAddress] });
    } else if (response.error) {
      reply({ error: response.error });
    } else {
      reply({ error: APIError.InternalError });
    }
  };

  const handleMiniGeroBtcEnable = () => {
    sendToMiniGero('enable', { ...request.data, website: origin }, tabId)
      .then(async (response) => {
        if (response.data === true) {
          await WalletStore.addConnectedDapp(currentWallet.id, origin);
        }
        handleResponse(response);
      })
      .catch((err: unknown) => reply({ error: errorMessage(err) || APIError.InternalError }));
  };

  // Primary: route through mini-gero side panel drawer
  if (miniGeroPorts.has(tabId)) {
    handleMiniGeroBtcEnable();
  } else {
    openSidebar(tabId, 'sidepanel/index.html')
      .then(() => waitForMiniGeroPort(5000, tabId))
      .then(() => handleMiniGeroBtcEnable())
      .catch(() => {
        // Fallback: popup window
        const popupURL = chrome.runtime.getURL(
          `index.html#/${POPUP.dappConnect}?website=${encodeURIComponent(origin)}`
        );
        focusOrCreatePopup(popupURL, 470, 600)
          .then(tab => Messaging.sendToPopupInternal(tab.id, request))
          .then(handleResponse)
          .catch(err => reply({ error: err }));
      });
  }

  return true;
});

app.add(BITCOIN_METHOD.isEnabled, (request, sendResponse) => {
  isWhitelisted(request.origin)
    .then(whitelisted => {
      sendResponse({
        id: request.id,
        data: whitelisted,
        target: TARGET,
        sender: SENDER.extension,
      });
    })
    .catch(() => {
      sendResponse({ id: request.id, error: APIError.InternalError, target: TARGET, sender: SENDER.extension });
    });
  return true;
});

app.add(BITCOIN_METHOD.getAccounts, async (request, sendResponse) => {
  const walletBg = walletManager.getWallet();
  if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
    return sendResponse({ id: request.id, error: APIError.AccountNotSet, target: TARGET, sender: SENDER.extension });
  }
  if (!WalletStore.isWhitelisted(request.origin)) {
    return sendResponse({ id: request.id, error: APIError.Refused, target: TARGET, sender: SENDER.extension });
  }
  sendResponse({ id: request.id, data: [walletBg.baseAddress], target: TARGET, sender: SENDER.extension });
});

app.add(BITCOIN_METHOD.getPublicKey, async (request, sendResponse) => {
  const walletBg = walletManager.getWallet();
  if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
    return sendResponse({ id: request.id, error: APIError.AccountNotSet, target: TARGET, sender: SENDER.extension });
  }
  if (!WalletStore.isWhitelisted(request.origin)) {
    return sendResponse({ id: request.id, error: APIError.Refused, target: TARGET, sender: SENDER.extension });
  }
  try {
    const pubkey = await walletBg.getBitcoinPublicKey();
    sendResponse({ id: request.id, data: pubkey, target: TARGET, sender: SENDER.extension });
  } catch (e) {
    sendResponse({ id: request.id, error: APIError.InternalError, target: TARGET, sender: SENDER.extension });
  }
  return true;
});

app.add(BITCOIN_METHOD.getNetwork, (request, sendResponse) => {
  const walletBg = walletManager.getWallet();
  if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
    return sendResponse({ id: request.id, error: APIError.AccountNotSet, target: TARGET, sender: SENDER.extension });
  }
  if (!WalletStore.isWhitelisted(request.origin)) {
    return sendResponse({ id: request.id, error: APIError.Refused, target: TARGET, sender: SENDER.extension });
  }
  const network = walletBg.network.toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';
  sendResponse({ id: request.id, data: network, target: TARGET, sender: SENDER.extension });
});

app.add(BITCOIN_METHOD.getBalance, (request, sendResponse) => {
  const walletBg = walletManager.getWallet();
  if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
    return sendResponse({ id: request.id, error: APIError.AccountNotSet, target: TARGET, sender: SENDER.extension });
  }
  if (!WalletStore.isWhitelisted(request.origin)) {
    return sendResponse({ id: request.id, error: APIError.Refused, target: TARGET, sender: SENDER.extension });
  }
  const bal = WalletStore.state.bitcoinBalance;
  const total = Number(bal?.total ?? 0);
  const confirmed = Number(bal?.available ?? 0);
  sendResponse({
    id: request.id,
    data: { confirmed, unconfirmed: total - confirmed, total },
    target: TARGET,
    sender: SENDER.extension,
  });
});

app.add(BITCOIN_METHOD.getUtxos, (request, sendResponse) => {
  const walletBg = walletManager.getWallet();
  if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
    return sendResponse({ id: request.id, error: APIError.AccountNotSet, target: TARGET, sender: SENDER.extension });
  }
  if (!WalletStore.isWhitelisted(request.origin)) {
    return sendResponse({ id: request.id, error: APIError.Refused, target: TARGET, sender: SENDER.extension });
  }
  sendResponse({ id: request.id, data: WalletStore.state.utxos || [], target: TARGET, sender: SENDER.extension });
});

app.add(BITCOIN_METHOD.signPsbt, (request, sendResponse) => {
  const walletBg = walletManager.getWallet();
  if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
    return sendResponse({ id: request.id, error: APIError.AccountNotSet, target: TARGET, sender: SENDER.extension });
  }
  if (!WalletStore.isWhitelisted(request.origin)) {
    return sendResponse({ id: request.id, error: APIError.Refused, target: TARGET, sender: SENDER.extension });
  }

  const popupURL = chrome.runtime.getURL(
    `index.html#/${POPUP.bitcoinSignPsbt}?website=${encodeURIComponent(request.origin)}`
  );
  focusOrCreatePopup(popupURL, 470, 600)
    .then(tab => Messaging.sendToPopupInternal(tab.id, request))
    .then((response: BackgroundResponse) => {
      if (response.data !== undefined) {
        sendResponse({ id: request.id, data: response.data, target: TARGET, sender: SENDER.extension });
      } else {
        sendResponse({ id: request.id, error: response.error ?? APIError.InternalError, target: TARGET, sender: SENDER.extension });
      }
    })
    .catch(err => sendResponse({ id: request.id, error: err, target: TARGET, sender: SENDER.extension }));

  return true;
});

app.add(BITCOIN_METHOD.signPsbts, async (request, sendResponse) => {
  const walletBg = walletManager.getWallet();
  if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
    return sendResponse({ id: request.id, error: APIError.AccountNotSet, target: TARGET, sender: SENDER.extension });
  }
  if (!WalletStore.isWhitelisted(request.origin)) {
    return sendResponse({ id: request.id, error: APIError.Refused, target: TARGET, sender: SENDER.extension });
  }

  const { psbtHexs, options } = request.data;
  const signedHexs: string[] = [];
  try {
    for (const psbtHex of psbtHexs) {
      const singleRequest = { ...request, data: { psbtHex, options } };
      const popupURL = chrome.runtime.getURL(
        `index.html#/${POPUP.bitcoinSignPsbt}?website=${encodeURIComponent(request.origin)}`
      );
      const tab = await focusOrCreatePopup(popupURL, 470, 600);
      const response = await Messaging.sendToPopupInternal(tab.id, singleRequest) as BackgroundResponse;
      if (response.error) throw response.error;
      signedHexs.push(response.data as string);
    }
    sendResponse({ id: request.id, data: signedHexs, target: TARGET, sender: SENDER.extension });
  } catch (err) {
    sendResponse({ id: request.id, error: err, target: TARGET, sender: SENDER.extension });
  }
  return true;
});

app.add(BITCOIN_METHOD.signMessage, (request, sendResponse) => {
  const walletBg = walletManager.getWallet();
  if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
    return sendResponse({ id: request.id, error: APIError.AccountNotSet, target: TARGET, sender: SENDER.extension });
  }
  if (!WalletStore.isWhitelisted(request.origin)) {
    return sendResponse({ id: request.id, error: APIError.Refused, target: TARGET, sender: SENDER.extension });
  }

  const popupURL = chrome.runtime.getURL(
    `index.html#/${POPUP.bitcoinSignMessage}?website=${encodeURIComponent(request.origin)}`
  );
  focusOrCreatePopup(popupURL, 470, 600)
    .then(tab => Messaging.sendToPopupInternal(tab.id, request))
    .then((response: BackgroundResponse) => {
      if (response.data !== undefined) {
        sendResponse({ id: request.id, data: response.data, target: TARGET, sender: SENDER.extension });
      } else {
        sendResponse({ id: request.id, error: response.error ?? APIError.InternalError, target: TARGET, sender: SENDER.extension });
      }
    })
    .catch(err => sendResponse({ id: request.id, error: err, target: TARGET, sender: SENDER.extension }));

  return true;
});

app.add(BITCOIN_METHOD.pushTx, async (request, sendResponse) => {
  const walletBg = walletManager.getWallet();
  if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
    return sendResponse({ id: request.id, error: APIError.AccountNotSet, target: TARGET, sender: SENDER.extension });
  }
  if (!WalletStore.isWhitelisted(request.origin)) {
    return sendResponse({ id: request.id, error: APIError.Refused, target: TARGET, sender: SENDER.extension });
  }
  try {
    const { BitcoinApi } = await import('@/api/bitcoin-api');
    const bitcoinApi = new BitcoinApi({ chain: walletBg.chain, network: walletBg.network }, walletBg.provider);
    const txid = await bitcoinApi.broadcastTransaction(request.data.rawtx);
    sendResponse({ id: request.id, data: txid, target: TARGET, sender: SENDER.extension });
  } catch (e) {
    sendResponse({ id: request.id, error: getErrorMessage(e), target: TARGET, sender: SENDER.extension });
  }
  return true;
});

app.add(BITCOIN_METHOD.pushPsbt, async (request, sendResponse) => {
  const walletBg = walletManager.getWallet();
  if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
    return sendResponse({ id: request.id, error: APIError.AccountNotSet, target: TARGET, sender: SENDER.extension });
  }
  if (!WalletStore.isWhitelisted(request.origin)) {
    return sendResponse({ id: request.id, error: APIError.Refused, target: TARGET, sender: SENDER.extension });
  }
  try {
    const bitcoin = await import('bitcoinjs-lib');
    const { getBitcoinNetwork } = await import('@/chains/bitcoin/bitcoinPsbtBuilder');
    const network = getBitcoinNetwork(walletBg.network);
    let psbt: InstanceType<typeof bitcoin.Psbt>;
    try { psbt = bitcoin.Psbt.fromHex(request.data.psbtHex, { network }); }
    catch { psbt = bitcoin.Psbt.fromBase64(request.data.psbtHex, { network }); }
    // Only finalize if inputs are not already finalized (prevents double-finalize crash
    // when signAndSendTransaction passes an already-finalized PSBT from btcSignPsbt)
    const alreadyFinalized = psbt.data.inputs.every(
      (input) => input.finalScriptSig || input.finalScriptWitness,
    );
    if (!alreadyFinalized) {
      psbt.finalizeAllInputs();
    }
    const txHex = psbt.extractTransaction().toHex();

    const { BitcoinApi } = await import('@/api/bitcoin-api');
    const bitcoinApi = new BitcoinApi({ chain: walletBg.chain, network: walletBg.network }, walletBg.provider);
    const txid = await bitcoinApi.broadcastTransaction(txHex);
    sendResponse({ id: request.id, data: txid, target: TARGET, sender: SENDER.extension });
  } catch (e) {
    sendResponse({ id: request.id, error: getErrorMessage(e), target: TARGET, sender: SENDER.extension });
  }
  return true;
});

// Popup → background handlers for Bitcoin DApp signing (software wallets)
app.addToOptions(MessageTypes.BITCOIN_DAPP_SIGN_PSBT, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
      sendResponse({ id: request.id, data: { success: false, error: 'Not a Bitcoin wallet' }, target: TARGET, sender: SENDER.extension });
      return;
    }
    // Defense-in-depth: MPC wallets are Cardano-only (chain-gated out above).
    assertMpcActionSupported(WalletStore.state.loggedWallet, 'Bitcoin signing');
    const { psbtHex, options, password, privateKeyBytes } = request.data;
    const prfSecret = privateKeyBytes ? new Uint8Array(privateKeyBytes) : undefined;
    const signedHex = await walletBg.signBitcoinDappPsbt(psbtHex, options, password, prfSecret);
    sendResponse({ id: request.id, data: { success: true, signedHex }, target: TARGET, sender: SENDER.extension });
  } catch (error) {
    sendResponse({ id: request.id, data: { success: false, error: getErrorMessage(error) }, target: TARGET, sender: SENDER.extension });
  }
});

app.addToOptions(MessageTypes.BITCOIN_DAPP_SIGN_MESSAGE, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg || walletBg.chain !== Blockchain.BITCOIN) {
      sendResponse({ id: request.id, data: { success: false, error: 'Not a Bitcoin wallet' }, target: TARGET, sender: SENDER.extension });
      return;
    }
    // Defense-in-depth: MPC wallets are Cardano-only (chain-gated out above).
    assertMpcActionSupported(WalletStore.state.loggedWallet, 'Bitcoin signing');
    const { message, type, password, privateKeyBytes } = request.data;
    const prfSecret = privateKeyBytes ? new Uint8Array(privateKeyBytes) : undefined;
    const signature = await walletBg.signBitcoinDappMessage(message, type, password, prfSecret);
    sendResponse({ id: request.id, data: { success: true, signature }, target: TARGET, sender: SENDER.extension });
  } catch (error) {
    sendResponse({ id: request.id, data: { success: false, error: getErrorMessage(error) }, target: TARGET, sender: SENDER.extension });
  }
});

// ====== WalletConnect v2 ======

// WC keepalive alarm
chrome.alarms.create('wc-keepalive', {
  delayInMinutes: 5,
  periodInMinutes: 5,
});

/**
 * Wire up WalletConnect event callbacks after SDK initialization.
 * Handles session proposals, session requests (signing + read-only), and session deletions.
 */
function setupWalletConnectCallbacks(wcService: WalletConnectServiceInstance) {
  // Import store lazily (only needed in background)
  const updateStore = async () => {
    const { default: WCStore } = await import('@/stores/walletConnectStore');
    WCStore.setActiveSessions(wcService.getActiveSessions());
  };

  // Sync store on init
  updateStore().catch(() => {});

  // ---- Session Proposal → open approval popup ----
  wcService.onSessionProposal = async (proposal) => {
    try {
      const proposalData = proposal.params;
      const popupURL = chrome.runtime.getURL(`index.html#/${POPUP.wcSessionProposal}`);
      const tab = await focusOrCreatePopup(popupURL, 470, 600);
      const response = await Messaging.sendToPopupInternal(tab.id, { data: proposalData }) as { data?: { approved?: boolean } };

      if (response?.data?.approved) {
        // Build accounts from current wallet
        const loggedWallet = WalletStore.state.loggedWallet;
        if (!loggedWallet) {
          await wcService.rejectSession(proposalData.id, 'No wallet logged in');
          return;
        }

        const accounts: { cardano?: string[]; bitcoin?: string[] } = {};
        if (loggedWallet.chain === Blockchain.CARDANO || loggedWallet.chain === 'Apex Prime' || loggedWallet.chain === 'Apex Vector') {
          accounts.cardano = [loggedWallet.baseAddress];
        } else if (loggedWallet.chain === Blockchain.BITCOIN) {
          accounts.bitcoin = loggedWallet.bitcoinAddress ? [loggedWallet.bitcoinAddress] : [];
        }

        await wcService.approveSession(proposalData.id, accounts, loggedWallet.chain, loggedWallet.network);
        await updateStore();
      } else {
        await wcService.rejectSession(proposalData.id, 'User rejected');
      }
    } catch (e) {
      console.error('❌ WC session proposal handling failed:', e);
      try { await wcService.rejectSession(proposal.params.id, 'Internal error'); } catch {}
    }
  };

  // ---- Session Request → route to appropriate handler ----
  wcService.onSessionRequest = async (event) => {
    const { topic, params, id } = event;
    const { request: wcRequest, chainId } = params;
    const method = wcRequest.method;

    try {
      const loggedWallet = WalletStore.state.loggedWallet;
      if (!loggedWallet) {
        await wcService.respondError(topic, id, 4100, 'No wallet logged in');
        return;
      }

      const { isCardanoChain, isBitcoinChain } = await import('@/services/walletConnect/chainUtils');

      // ---- Cardano read-only methods ----
      if (isCardanoChain(chainId)) {
        switch (method) {
          case 'cardano_getBalance': {
            const collateral = WalletStore.state.collateral;
            const utxos = WalletStore.state.utxos;
            const balance = getBalance(utxos as Cardano.Utxo[], collateral);
            await wcService.respondSuccess(topic, id, balance.toCbor());
            return;
          }
          case 'cardano_getNetworkId': {
            const netId = networks.resolveNetworkId(loggedWallet.chain, loggedWallet.network);
            await wcService.respondSuccess(topic, id, netId);
            return;
          }
          case 'cardano_getUtxos': {
            const utxos = WalletStore.state.utxos as Cardano.Utxo[];
            const collateral = WalletStore.state.collateral;
            const wcParams = wcRequest.params || {};
            const converted = getUtxos(wcParams.amount, wcParams.paginate, utxos, collateral);
            const result = converted ? converted.map(u => u.toCbor()) : null;
            await wcService.respondSuccess(topic, id, result);
            return;
          }
          case 'cardano_getCollateral': {
            const storedUtxos = WalletStore.state.utxos as Cardano.Utxo[];
            const wcParams = wcRequest.params || {};
            const result = getCollateral(wcParams, storedUtxos);
            await wcService.respondSuccess(topic, id, result);
            return;
          }
          case 'cardano_getUsedAddresses': {
            const keys = WalletStore.state.keys;
            const wcParams = wcRequest.params || {};
            const result = getUsedAddresses(keys, wcParams.paginate);
            await wcService.respondSuccess(topic, id, result);
            return;
          }
          case 'cardano_getUnusedAddresses': {
            const keys = WalletStore.state.keys;
            const result = getUnusedAddresses(loggedWallet.publicKey, loggedWallet.chain, loggedWallet.network, keys);
            await wcService.respondSuccess(topic, id, result);
            return;
          }
          case 'cardano_getChangeAddress': {
            const addr = Cardano.Address.fromBech32(loggedWallet.baseAddress).toBytes();
            await wcService.respondSuccess(topic, id, addr);
            return;
          }
          case 'cardano_submitTx': {
            const txCbor = wcRequest.params?.tx || wcRequest.params;
            const response = await submitTx(txCbor, loggedWallet.chain, loggedWallet.network);
            if (response.ok) {
              const txHash = await response.text();
              await wcService.respondSuccess(topic, id, txHash);
            } else {
              await wcService.respondError(topic, id, 4100, `Submit failed: ${response.statusText}`);
            }
            return;
          }
          case 'cardano_signTx': {
            // Open SignTx popup — reuse existing pattern
            const wcParams = wcRequest.params || {};
            const fakeRequest = {
              id: `wc-${id}`,
              data: { tx: wcParams.tx || wcParams, partialSign: wcParams.partialSign, origin: 'WalletConnect' },
              origin: 'WalletConnect',
              send: { tab: { id: -1 } },
            };
            const popupURL = chrome.runtime.getURL(
              `index.html#/${POPUP.signTx}?website=${encodeURIComponent('WalletConnect')}`
            );
            const tab = await focusOrCreatePopup(popupURL, 470, 852);
            const response = await Messaging.sendToPopupInternal(tab.id, fakeRequest) as BackgroundResponse;
            if (response.data) {
              await wcService.respondSuccess(topic, id, response.data);
            } else {
              await wcService.respondError(topic, id, 4001, (response.error as { info?: string } | undefined)?.info || 'User rejected');
            }
            return;
          }
          case 'cardano_signData': {
            const wcParams = wcRequest.params || {};
            const fakeRequest = {
              id: `wc-${id}`,
              data: { address: wcParams.addr || wcParams.address, payload: wcParams.payload, origin: 'WalletConnect' },
              origin: 'WalletConnect',
              send: { tab: { id: -1 } },
            };
            const popupURL = chrome.runtime.getURL(
              `index.html#/${POPUP.dappSignData}?website=${encodeURIComponent('WalletConnect')}`
            );
            const tab = await focusOrCreatePopup(popupURL, 470, 600);
            const response = await Messaging.sendToPopupInternal(tab.id, fakeRequest) as BackgroundResponse;
            if (response.data) {
              await wcService.respondSuccess(topic, id, response.data);
            } else {
              await wcService.respondError(topic, id, 4001, (response.error as { info?: string } | undefined)?.info || 'User rejected');
            }
            return;
          }
        }
      }

      // ---- Bitcoin methods ----
      if (isBitcoinChain(chainId)) {
        switch (method) {
          case 'getAccountAddresses': {
            const addresses = loggedWallet.bitcoinAddress ? [{ address: loggedWallet.bitcoinAddress, publicKey: loggedWallet.publicKey }] : [];
            await wcService.respondSuccess(topic, id, addresses);
            return;
          }
          case 'signPsbt': {
            const wcParams = wcRequest.params || {};
            const fakeRequest = {
              id: `wc-${id}`,
              data: { psbtHex: wcParams.psbt || wcParams.psbtHex, options: wcParams.signInputs },
              origin: 'WalletConnect',
              send: { tab: { id: -1 } },
            };
            const popupURL = chrome.runtime.getURL(
              `index.html#/${POPUP.bitcoinSignPsbt}?website=${encodeURIComponent('WalletConnect')}`
            );
            const tab = await focusOrCreatePopup(popupURL, 470, 600);
            const response = await Messaging.sendToPopupInternal(tab.id, fakeRequest) as BackgroundResponse;
            if (response.data !== undefined) {
              await wcService.respondSuccess(topic, id, response.data);
            } else {
              await wcService.respondError(topic, id, 4001, 'User rejected');
            }
            return;
          }
          case 'signMessage': {
            const wcParams = wcRequest.params || {};
            const fakeRequest = {
              id: `wc-${id}`,
              data: { message: wcParams.message, type: wcParams.type || 'ecdsa' },
              origin: 'WalletConnect',
              send: { tab: { id: -1 } },
            };
            const popupURL = chrome.runtime.getURL(
              `index.html#/${POPUP.bitcoinSignMessage}?website=${encodeURIComponent('WalletConnect')}`
            );
            const tab = await focusOrCreatePopup(popupURL, 470, 600);
            const response = await Messaging.sendToPopupInternal(tab.id, fakeRequest) as BackgroundResponse;
            if (response.data !== undefined) {
              await wcService.respondSuccess(topic, id, response.data);
            } else {
              await wcService.respondError(topic, id, 4001, 'User rejected');
            }
            return;
          }
        }
      }

      // Unknown method
      await wcService.respondError(topic, id, 4200, `Method not supported: ${method}`);
    } catch (e) {
      console.error('❌ WC session request handling failed:', e);
      try { await wcService.respondError(topic, id, 4100, getErrorMessage(e)); } catch {}
    }
  };

  // ---- Session Delete → update store ----
  wcService.onSessionDelete = async () => {
    await updateStore();
  };
}

app.addToOptions(MessageTypes.WC_PAIR, async (request, sendResponse) => {
  try {
    const { walletConnectService } = await import('@/services/walletConnect/walletConnect.service');
    if (!walletConnectService.initialized) await walletConnectService.initialize();
    await walletConnectService.pair(request.data.uri);
    sendResponse({ id: request.id, data: { success: true }, target: TARGET, sender: SENDER.extension });
  } catch (error) {
    sendResponse({ id: request.id, data: { success: false, error: getErrorMessage(error) }, target: TARGET, sender: SENDER.extension });
  }
});

app.addToOptions(MessageTypes.WC_APPROVE_SESSION, async (request, sendResponse) => {
  try {
    const { walletConnectService } = await import('@/services/walletConnect/walletConnect.service');
    const { default: WCStore } = await import('@/stores/walletConnectStore');
    const { id, accounts, chain, network } = request.data;
    const session = await walletConnectService.approveSession(id, accounts, chain, network);
    WCStore.setActiveSessions(walletConnectService.getActiveSessions());
    sendResponse({ id: request.id, data: { success: true, session }, target: TARGET, sender: SENDER.extension });
  } catch (error) {
    sendResponse({ id: request.id, data: { success: false, error: getErrorMessage(error) }, target: TARGET, sender: SENDER.extension });
  }
});

app.addToOptions(MessageTypes.WC_REJECT_SESSION, async (request, sendResponse) => {
  try {
    const { walletConnectService } = await import('@/services/walletConnect/walletConnect.service');
    await walletConnectService.rejectSession(request.data.id, request.data.reason);
    sendResponse({ id: request.id, data: { success: true }, target: TARGET, sender: SENDER.extension });
  } catch (error) {
    sendResponse({ id: request.id, data: { success: false, error: getErrorMessage(error) }, target: TARGET, sender: SENDER.extension });
  }
});

app.addToOptions(MessageTypes.WC_DISCONNECT_SESSION, async (request, sendResponse) => {
  try {
    const { walletConnectService } = await import('@/services/walletConnect/walletConnect.service');
    const { default: WCStore } = await import('@/stores/walletConnectStore');
    await walletConnectService.disconnectSession(request.data.topic);
    WCStore.setActiveSessions(walletConnectService.getActiveSessions());
    sendResponse({ id: request.id, data: { success: true }, target: TARGET, sender: SENDER.extension });
  } catch (error) {
    sendResponse({ id: request.id, data: { success: false, error: getErrorMessage(error) }, target: TARGET, sender: SENDER.extension });
  }
});

app.addToOptions(MessageTypes.WC_GET_SESSIONS, async (request, sendResponse) => {
  try {
    const { walletConnectService } = await import('@/services/walletConnect/walletConnect.service');
    const sessions = walletConnectService.getActiveSessions();
    sendResponse({ id: request.id, data: { success: true, sessions }, target: TARGET, sender: SENDER.extension });
  } catch (error) {
    sendResponse({ id: request.id, data: { success: false, error: getErrorMessage(error) }, target: TARGET, sender: SENDER.extension });
  }
});

app.addToOptions(MessageTypes.SET_OPEN_MINI_GERO_ON_CLICK, async (request, sendResponse) => {
  try {
    // Only update panel behavior — storage is written directly by the component
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !!request.data.value });
    sendResponse({
      id: request.id,
      data: { success: true },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true;
});

const openUI = async () => {
  // When openPanelOnActionClick is true, Chrome opens the side panel automatically
  // and onClicked does NOT fire. So if we're here, we always open the dashboard.
  await openDashboard();
};

chrome.action.onClicked.addListener(openUI);

app.listen();
