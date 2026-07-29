import { Buffer } from 'buffer';
import Loading from '@/stores/loading';
import { Messaging } from '@/chrome/messaging';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import { APIError, BITCOIN_METHOD, MIDNIGHT_METHOD, MidnightErrorCode, METHOD, POPUP, SENDER, TARGET, TxSendError } from '@/chrome/config';
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
  isRecentNexusLent,
  submitTx,
  urlScan,
} from '@/chrome/serialization';
import { Blockchain, coin_type, ERROR, Network, purpose } from '@/models/types';
import networks from '@/utils/networks';
import { getDomain } from 'tldts';
import { MessageTypes } from '@/models/MessageTypes';
import { signInWithGoogle } from '@/chrome/auth';
import { loadConfig, loadWallets } from '@/plugins/geroLoader';
import WalletStore, { hydrateWalletStore, matchesDappWhitelistEntry, walletStore } from '@/stores/walletStore';
import { walletManager } from '@/services/walletManager.service';
import { shouldAutoLock } from '@/services/autoLock';
import { nexusCollateralApi } from '@/api/nexus-collateral-api';
import { toNexusNetwork } from '@/api/nexus-tx-api';
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
  storeRecoveryShareFlow,
  revealMpcSrpFlow,
  setRecoveryPasswordFlow,
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
  // If this tab's panel is already connected, do NOT rewrite its path:
  // setOptions with a new path reloads the panel document and destroys
  // whatever the user was doing (half-filled send form, running flow).
  if (!miniGeroPorts.has(tabId)) {
    // Append tabId so the side panel can identify which tab it belongs to
    const separator = path.includes('?') ? '&' : '?';
    const fullPath = `${path}${separator}tabId=${tabId}`;
    chrome.sidePanel.setOptions({
      tabId,
      path: fullPath,
      enabled: true
    });
  }
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
// Synthetic key generator for panels that connect without a resolvable tab id
// (opened manually / pinned). Decrements so keys stay negative and never collide
// with real chrome tab ids.
let syntheticPortSeq = -1;

// requestId → pending entry. `payload`/`method` are kept so a request can be
// RE-DELIVERED when a panel port (re)connects: closing the panel, locking it,
// or switching tabs PARKS requests instead of rejecting them. Only an explicit
// user response (approve/reject) or a NACK settles the dApp's promise.
// `walletId` snapshots the wallet the request was issued against so a mid-
// request wallet switch cannot silently have the NEW wallet's keys answer it.
type PendingDAppEntry = {
  resolve: DAppRequestResolver;
  tabId: number;
  method: string;
  payload: unknown;
  walletId?: string;
};
const pendingDAppRequests = new Map<string, PendingDAppEntry>();

function redeliverParkedRequests(tabId: number, port: chrome.runtime.Port) {
  for (const [requestId, entry] of pendingDAppRequests.entries()) {
    const matchesTab = entry.tabId === tabId || Number.isNaN(entry.tabId);
    if (!matchesTab) continue;
    try {
      port.postMessage({ type: 'dapp-request', method: entry.method, requestId, payload: entry.payload });
    } catch {
      // Port died mid-loop; the next connect will retry.
      return;
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('mini-gero-dapp-channel')) return;
  // Only our own extension pages may register an approval surface.
  if (port.sender?.id !== chrome.runtime.id) {
    console.warn('[DApp] rejected foreign mini-gero port from', port.sender?.id);
    try { port.disconnect(); } catch { /* noop */ }
    return;
  }
  // Extract tab ID from port name (e.g. "mini-gero-dapp-channel:123").
  const parts = port.name.split(':');
  const parsed = parts.length > 1 ? parseInt(parts[1], 10) : NaN;
  // A panel opened without a tab context (manually / pinned) can't resolve its
  // tab id and connects with an empty one. Register it anyway under a synthetic
  // negative key so tab-agnostic routing (miniGeroPorts.size / any-panel
  // fallback in the sign handlers) still finds it — we only lose the exact-tab
  // match, which the fallback already covers. Negative keys never collide with
  // real chrome tab ids.
  const tabId = isNaN(parsed) ? syntheticPortSeq-- : parsed;

  const oldPort = miniGeroPorts.get(tabId);
  if (oldPort) {
    try { oldPort.disconnect(); } catch { /* already disconnected */ }
  }
  miniGeroPorts.set(tabId, port);

  port.onMessage.addListener((message) => {
    if (!message?.requestId) return;
    const entry = pendingDAppRequests.get(message.requestId);
    if (!entry) return;
    if (message.type === 'dapp-response') {
      // Wallet-switch guard: if the active wallet changed since the request
      // was issued, an approval must not be honored silently.
      const activeWalletId = (WalletStore.state.loggedWallet as { id?: string } | null)?.id;
      if (entry.walletId && message.error == null && activeWalletId !== entry.walletId) {
        entry.resolve({ error: 'wallet_changed_during_request' });
      } else {
        entry.resolve(message);
      }
      pendingDAppRequests.delete(message.requestId);
    } else if (message.type === 'dapp-nack') {
      entry.resolve({ error: String(message.error || 'unsupported_method') });
      pendingDAppRequests.delete(message.requestId);
    }
  });

  port.onDisconnect.addListener(() => {
    if (miniGeroPorts.get(tabId) === port) {
      miniGeroPorts.delete(tabId);
    }
    // PARK, do not reject: closing the panel, locking it, or switching tabs
    // must not answer a pending dApp request on the user's behalf. Pending
    // entries stay in the map and are re-delivered once a panel port
    // reconnects (see redeliverParkedRequests below); only an explicit user
    // action (approve/reject) or a NACK settles them.
  });

  // Re-deliver anything parked for this tab (and tabless requests).
  redeliverParkedRequests(tabId, port);
});

function sendToMiniGero(method: string, payload: unknown, tabId?: number): Promise<BackgroundResponse> {
  // Exact-port routing for tab-originated requests: rendering tab A's
  // approval in tab B's panel is a trust bug, so a tab with no connected port
  // does NOT fall back to some other tab's panel. Tabless requests (no
  // tabId — WalletConnect relay events, which are never tied to a browser
  // tab) use any connected panel instead: whichever panel the user has open
  // is the only one that could possibly show it, and there is no tab to open
  // one on if none is connected — callers must check miniGeroPorts.size > 0
  // themselves and fall back to a popup when it's empty.
  const port = typeof tabId === 'number'
    ? miniGeroPorts.get(tabId)
    : miniGeroPorts.values().next().value;
  const sendingTabId = typeof tabId === 'number' ? tabId : NaN;
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    // No timeout — user interaction can take as long as needed. Requests are
    // parked across disconnects and settled only by an explicit response/NACK.
    pendingDAppRequests.set(requestId, {
      tabId: sendingTabId,
      method,
      payload,
      walletId: (WalletStore.state.loggedWallet as { id?: string } | null)?.id,
      resolve: (response) => {
        if (response.error) reject(new Error(String(response.error)));
        else resolve(response);
      },
    });
    if (port) {
      try {
        port.postMessage({ type: 'dapp-request', method, requestId, payload });
      } catch {
        // Port died between lookup and post: the entry stays parked and will
        // be re-delivered on the next connect.
      }
    }
    // No port: stays parked; openSidebar + the panel's own connect handles delivery.
  });
}

/**
 * Wait for the mini-gero side panel to connect its DApp channel port for a specific tab.
 * Resolves once the port for `tabId` is set, rejects after `timeoutMs`.
 */
// How long a dApp signTx waits for the side-panel drawer to connect. Long enough
// to sit through a lock screen while the user signs in (matches the enable/login
// 5-min cap) — the port connects instantly once the panel is unlocked, so this
// only matters while locked. Prevents falling back to a welcome popup that can't sign.
const SIGN_TX_PORT_WAIT_MS = 5 * 60 * 1000;

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

  const favIconUrl = send.tab?.favIconUrl;
  const enablePayload = { ...request.data, website: origin, favIconUrl };

  const handleMiniGeroEnable = () => {
    return sendToMiniGero('enable', enablePayload, tabId)
      .then(async (response) => {
        if (response.data === true) {
          // Read the wallet fresh: a cold-start request may have logged a
          // wallet in between the initial check and this resolution.
          const walletNow = walletManager.getWallet();
          if (walletNow) await WalletStore.addConnectedDapp(walletNow.id, origin);
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

  const routeEnable = () => {
    if (WalletStore.isWhitelisted(origin)) {
      return reply({ data: true });
    }
    // Primary: route through mini-gero side panel drawer
    if (typeof tabId === 'number' && miniGeroPorts.has(tabId)) {
      handleMiniGeroEnable()
        .catch((err: unknown) => {
          reply({ error: errorMessage(err) || APIError.InternalError });
        });
    } else {
      openSidePanelAndSend();
    }
  };

  const currentWallet = walletManager.getWallet();
  if (!currentWallet) {
    // Cold start: open the panel so the user can log in, then continue the
    // enable flow. Mirrors the popupLogin machinery (login wait, 5 min cap)
    // instead of returning AccountNotSet before any UI ever opens.
    if (typeof tabId !== 'number') {
      return reply({ error: APIError.AccountNotSet });
    }
    openSidebar(tabId, 'sidepanel/index.html')
      .then(() => new Promise<boolean>((resolve) => {
        const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
        const started = Date.now();
        const interval = setInterval(() => {
          if (WalletStore.state.loggedWallet) {
            clearInterval(interval);
            resolve(true);
          } else if (Date.now() - started >= LOGIN_TIMEOUT_MS) {
            clearInterval(interval);
            resolve(false);
          }
        }, 250);
      }))
      .then((loggedIn) => {
        if (!loggedIn) return reply({ error: APIError.Refused });
        routeEnable();
      })
      .catch(() => reply({ error: APIError.InternalError }));
    return true;
  }

  routeEnable();

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
  return whitelisted.some(el => el.domain && matchesDappWhitelistEntry(origin, String(el.domain)));
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

/**
 * The Nexus shared-pool collateral is Gero's own ADA, so only TRUSTED dApps may
 * draw from it. A dApp qualifies only when its origin is BOTH (a) on Gero's
 * curated allowlist — served by the feature-flag service (`collateralTrustedDapps`)
 * and mirrored to chrome.storage.local for the background — AND (b) already
 * connected/whitelisted by the user. Dev convenience: on a non-mainnet network,
 * localhost origins pass the allowlist half so the preprod test harness works
 * without touching the remote list (never applies on mainnet).
 */
async function isTrustedCollateralDapp(origin?: string): Promise<boolean> {
  if (!origin) return false;
  // Canonicalize to scheme+host+port. A gate on Gero's own ADA must match origins
  // EXACTLY — never substring/startsWith/endsWith, which "https://app.minswap.org"
  // would let "https://app.minswap.org.evil.com" (or "…minswap.org#@x") bypass.
  let reqOrigin: string;
  try {
    reqOrigin = new URL(origin).origin;
  } catch {
    return false; // unparseable origin → untrusted
  }
  // (b) user must have connected/whitelisted the dApp.
  if (!WalletStore.isWhitelisted(origin)) return false;
  // (a) Gero-curated allowlist — entries are full origins, compared by exact equality.
  try {
    const stored = await chrome.storage.local.get('featureFlags');
    const list = (stored?.featureFlags as { collateralTrustedDapps?: unknown })?.collateralTrustedDapps;
    if (Array.isArray(list) && list.some((e) => {
      if (typeof e !== 'string' || e.length === 0) return false;
      try {
        return new URL(e).origin === reqOrigin;
      } catch {
        return false; // malformed allowlist entry → ignore, never match
      }
    })) {
      return true;
    }
  } catch (e) {
    debugLog('[collateral] trusted-dapp allowlist read failed:', e);
  }
  // Dev-only fallback: localhost harness on an EXPLICIT non-mainnet network.
  // Require a logged-in wallet whose network resolves to a known testnet id — a
  // null/unknown wallet must NOT enable the bypass (fail closed).
  const wallet = WalletStore.state.loggedWallet;
  const netId = wallet ? networks.resolveNetworkId(wallet.chain, wallet.network) : undefined;
  const isNonMainnet = typeof netId === 'number' && netId !== 1;
  const isLocalDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(reqOrigin);
  return isNonMainnet && isLocalDev;
}

app.add(METHOD.getCollateral, async (request, sendResponse) => {
  const storedUtxos = WalletStore.state.utxos;
  try {
    const allowNexusFallback = await isTrustedCollateralDapp(request.origin);
    const utxos: string[] = await getCollateral(request.data.params, storedUtxos as Cardano.Utxo[], { allowNexusFallback })
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
  // The content relay now fast-paths sign requests straight to background
  // (see messaging.ts) so the user gesture survives to sidePanel.open();
  // enforce the whitelist here instead of in that pre-check round-trip.
  if (!WalletStore.isWhitelisted(request.origin)) {
    return signDataReply({ error: APIError.Refused });
  }

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
  // Same fast-path/whitelist split as signData above.
  if (!WalletStore.isWhitelisted(request.data?.origin || request.origin)) {
    return signTxReply({ error: APIError.Refused });
  }

  const signTxPayload = { ...request.data, website: request.data?.origin || request.origin, favIconUrl: request.send?.tab?.favIconUrl };
  const tabId = request.send?.tab?.id;

  const handleMiniGeroSignTx = () => {
    // Prefer this tab's panel port, but fall back to any open panel. The panel
    // registers its port under whatever tab was active when it connected (see
    // dappRequestHub.resolveTabId), which isn't always the dApp's tab — with a
    // single side panel open, routing to it is correct and beats hanging.
    const deliverTabId = typeof tabId === 'number' && miniGeroPorts.has(tabId) ? tabId : undefined;
    return sendToMiniGero('signTx', signTxPayload, deliverTabId)
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

    // Phase 1: open the side panel. If the panel itself can't open (e.g. the
    // user disabled the side panel), the popup window is the only way to show
    // the prompt at all — fall back to it.
    try {
      await openSidebar(tabId, 'sidepanel/index.html');
    } catch {
      return openPopupForSignTx();
    }

    // Phase 2: wait for the mini-gero port. When the wallet is LOCKED the panel
    // shows its lock screen and never registers the port until the user signs
    // in, so wait through the unlock (5 min cap, mirroring the enable/login
    // wait) instead of racing a 5s timeout into a useless welcome popup that
    // can't sign anyway. Already-unlocked is the common case — the port
    // connects in well under a second, so the long cap only bites while locked.
    try {
      // Wait for ANY panel port, not this tab's specifically — the panel may
      // register under a different active-tab id, and handleMiniGeroSignTx
      // falls back to whatever panel is open.
      await waitForMiniGeroPort(SIGN_TX_PORT_WAIT_MS);
    } catch {
      // Panel opened but no port ever connected (user never unlocked, or
      // closed the panel). Fail the request cleanly rather than spawning a
      // second, unusable window on top of the panel.
      return signTxReply({ error: APIError.Refused });
    }

    // Phase 3: deliver via the connected port. Errors here (incl. the user
    // clicking Reject) are real responses relayed back to the dApp.
    handleMiniGeroSignTx().catch((err: unknown) => {
      signTxReply({ error: errorMessage(err) || APIError.InternalError });
    });
  };

  // Primary: route through the mini-gero side panel drawer if ANY panel is open
  // (handleMiniGeroSignTx prefers this tab's port, falls back to any). Only open
  // a fresh panel when none is connected at all.
  if (miniGeroPorts.size > 0) {
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
    const alreadyEnrolled = isMpcConflictError(error);
    const message = alreadyEnrolled
      ? 'This Google account is already enrolled for an MPC wallet.'
      : getErrorMessage(error, 'Failed to create MPC wallet');
    console.error('Error creating MPC Google wallet:', message);
    sendResponse({
      id: request.id,
      // `code: 'already_enrolled'` lets the UI key off a stable machine-readable
      // signal (rather than string-matching the human-readable `error`) to offer
      // the "reset this Google account" flow (DEREGISTER_MPC_ACCOUNT) below.
      data: { success: false, error: message, ...(alreadyEnrolled ? { code: 'already_enrolled' } : {}) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
});

/**
 * Encrypt the recovery share under the user's recovery passphrase and upload it
 * (+ xpub anchor) to the backend, keyed by the verified Google subject. NON-FATAL:
 * the wallet is already created and usable on THIS device (device + login = 2 of
 * 3), so a failed upload only means cross-device restore isn't armed yet — the
 * onboarding backup step (StepGoogleBackup.vue) surfaces a retry instead of
 * blocking wallet creation.
 */
app.addToOptions(MessageTypes.STORE_MPC_RECOVERY, async (request, sendResponse) => {
  try {
    // Note: Never log request.data — contains idToken/recoveryShare/recoveryPassword.
    const { idToken, chain, network, recoveryShare, recoveryPassword, publicKey } = request.data || {};
    if (!idToken) throw new Error('idToken is required');
    if (!recoveryShare) throw new Error('recoveryShare is required');
    if (!recoveryPassword) throw new Error('recoveryPassword is required');
    if (!publicKey) throw new Error('publicKey is required');

    const { encryptRecoveryShare } = await import('@/shared/utils/mpc');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    const { stored } = await storeRecoveryShareFlow(
      { idToken, chain, network, recoveryShare, recoveryPassword, publicKey },
      {
        encryptRecoveryShare,
        storeRecovery: (idTok, ch, net, blob, pub) => api.mpc.storeRecovery(idTok, ch, net, blob, pub),
      },
    );

    sendResponse({
      id: request.id,
      data: { success: true, stored },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    // NON-FATAL: the wallet is already created and usable on THIS device (device + login
    // = 2 of 3). A failed recovery upload only means cross-device restore isn't armed yet;
    // the onboarding backup step surfaces a retry. Log only the message — never the
    // recovery blob/share/password.
    console.error('Error storing MPC recovery share:', getErrorMessage(error, 'store recovery failed'));
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error, 'Failed to store recovery backup') },
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
    const { getAllWallets, promoteMpcDeviceShareNext } = await import('@/db/gero-db');
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
        promoteMpcDeviceShareNext,
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

app.addToOptions(MessageTypes.RECOVER_MPC_GOOGLE_WALLET, async (request, sendResponse) => {
  try {
    // Note: Never log request.data — contains idToken/recoveryPassword/spendingPassword/prfOutputHex
    const { name, icon, theme, chain, network, idToken, recoveryPassword } = request.data || {};
    if (!idToken || !chain || !network || !recoveryPassword) {
      throw new Error('idToken, chain, network and recoveryPassword are required');
    }
    const { secret: newSecret, webAuthnCredentialId, mpcPrfSaltId } = buildDeviceShareSecret(request.data);

    const { decryptRecoveryShare, reconstructAndValidateEntropy, encryptDeviceShare } = await import('@/shared/utils/mpc');
    const { createMpcGoogleWallet } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    const { walletId, publicKey } = await recoverMpcGoogleWalletFlow(
      {
        name, icon, theme, chain, network, idToken, recoveryPassword, newSecret,
        webAuthnCredentialId, mpcPrfSaltId,
      },
      {
        fetchRecovery: (idTok, ch, net) => api.mpc.fetchRecovery(idTok, ch, net),
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
    // Anchor mismatch (wrong Google account for this recovery) surfaces as a
    // clean message; the raw MpcValidationError is not leaked.
    const { MpcValidationError, NoRecoveryBackupError } = await import('@/shared/utils/mpc');
    let message: string;
    let code: string | undefined;
    if (error instanceof NoRecoveryBackupError) {
      message = 'No recovery backup found for this Google account';
      code = 'no_recovery_backup';
    } else if (error instanceof MpcValidationError) {
      message = "This recovery doesn't match this Google account.";
    } else {
      message = getErrorMessage(error, 'Failed to recover MPC wallet');
    }
    console.error('Error recovering MPC Google wallet:', message);
    sendResponse({
      id: request.id,
      data: { success: false, error: message, code },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
});

/**
 * Set / change the recovery password from an unlocked wallet. NEVER asks for the
 * old password (by design): device + login reconstruct the entropy, then a
 * crash-safe re-split rotates all three shares and stores a fresh recovery blob
 * under the new password. Requires device-secret re-auth (secret in request.data).
 * Never log request.data — it carries idToken / newRecoveryPassword / device secret.
 */
app.addToOptions(MessageTypes.SET_RECOVERY_PASSWORD, async (request, sendResponse) => {
  try {
    const { walletId, idToken, newRecoveryPassword } = request.data || {};
    if (!walletId || !idToken || !newRecoveryPassword) {
      throw new Error('walletId, idToken and newRecoveryPassword are required');
    }
    const { secret } = buildDeviceShareSecret(request.data);

    const {
      decryptDeviceShare,
      encryptDeviceShare,
      encryptRecoveryShare,
      createMpcShareSet,
      reconstructAndValidateEntropy,
    } = await import('@/shared/utils/mpc');
    const { getAllWallets, setMpcDeviceShareNext, promoteMpcDeviceShareNext } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    await setRecoveryPasswordFlow(
      { walletId, idToken, newRecoveryPassword, secret },
      {
        getWallet: async (id) => (await getAllWallets())[id],
        getLoginShare: (idTok, ch, net) => api.mpc.getLoginShare(idTok, ch, net),
        decryptDeviceShare,
        reconstructAndValidateEntropy,
        createMpcShareSet,
        encryptDeviceShare,
        encryptRecoveryShare,
        setMpcDeviceShareNext,
        rotate: (idTok, ch, net, loginShare) => api.mpc.rotate(idTok, ch, net, loginShare),
        promoteMpcDeviceShareNext,
        storeRecovery: (idTok, ch, net, blob, pub) => api.mpc.storeRecovery(idTok, ch, net, blob, pub),
        clearLoginShareCache: (id) => mpcLoginShareCache.clear(id),
      },
    );

    sendResponse({
      id: request.id,
      data: { success: true },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    // storeRecovery (the LAST step) failed after rotate+promote already succeeded —
    // the wallet is already live on the new split, but the new recovery backup wasn't
    // saved (and the OLD recovery password is now dead too). Flag this distinctly so
    // the dialog doesn't tell the user "nothing changed" when something did.
    const { RecoveryBackupStoreError } = await import('@/shared/utils/mpc');
    const backupNotStored = error instanceof RecoveryBackupStoreError;
    console.error('Error setting MPC recovery password:', getErrorMessage(error, 'set recovery password failed'));
    sendResponse({
      id: request.id,
      data: {
        success: false,
        error: getErrorMessage(error, 'Failed to set recovery password'),
        ...(backupNotStored ? { code: 'recovery_backup_not_stored' } : {}),
      },
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
    try {
      await api.mpc.getLoginShare(idToken, chain, network);
      enrolled = true; // share returned → enrolled
    } catch (probeError) {
      const raw = typeof probeError === 'string' ? probeError : getErrorMessage(probeError, '');
      if (raw.includes('"status":404')) {
        enrolled = false; // no share stored → not enrolled
      } else {
        throw probeError; // unknown error — don't misreport as "not enrolled"
      }
    }

    sendResponse({
      id: request.id,
      data: { success: true, enrolled },
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

/**
 * Reset (deregister) this Google account's MPC enrollment on the backend — deletes
 * the account's stored login + recovery shares so a subsequent CREATE_MPC_GOOGLE_WALLET
 * for the same account no longer 409s. Onboarding surfaces this ONLY after CREATE_MPC_GOOGLE_WALLET
 * fails with `code: 'already_enrolled'`, gated behind an explicit user confirmation
 * (StepGoogleSecure.vue) — never auto-triggered from here.
 * Never log request.data — contains idToken.
 */
app.addToOptions(MessageTypes.DEREGISTER_MPC_ACCOUNT, async (request, sendResponse) => {
  try {
    const { idToken, chain, network } = request.data || {};
    if (!idToken || !chain || !network) {
      throw new Error('idToken, chain and network are required');
    }
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    const { deregistered } = await api.mpc.deregister(idToken, chain, network);

    sendResponse({
      id: request.id,
      data: { success: true, deregistered },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error('Error deregistering MPC account:', getErrorMessage(error, 'deregister failed'));
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error, 'Failed to reset this Google account') },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
});

/**
 * Reveal the MPC wallet's BIP39 seed phrase (escape hatch) after a device-secret
 * re-auth, even in an unlocked session. Reconstructs entropy from device+login,
 * validates the xpub, and returns the mnemonic to the UI EXACTLY ONCE.
 *
 * Secret hygiene: never log request.data (idToken / spendingPassword / prfOutputHex)
 * and never log the mnemonic. The mnemonic is returned only in this response body
 * for one-time display; it is not persisted or cached anywhere.
 */
app.addToOptions(MessageTypes.REVEAL_MPC_SRP, async (request, sendResponse) => {
  try {
    const { walletId, idToken } = request.data || {};
    if (!walletId) throw new Error('walletId is required');
    // Unlocked-session reveal: a fresh Google idToken OR a login share cached
    // this session must be present (device secret alone is below threshold).
    const hasCachedLoginShare = await mpcLoginShareCache.has(walletId);
    if (!idToken && !hasCachedLoginShare) {
      throw new Error('MPC session expired — sign in with Google');
    }
    const { secret } = buildDeviceShareSecret(request.data);

    const { decryptDeviceShare, reconstructAndValidateEntropy, entropyToMnemonic } = await import('@/shared/utils/mpc');
    const { getAllWallets } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    const getLoginShare = idToken
      ? async (idTok: string, ch: string, net: string): Promise<string> => api.mpc.getLoginShare(idTok, ch, net)
      : async (): Promise<string> => {
          const cached = await mpcLoginShareCache.get(walletId);
          if (!cached) throw new Error('MPC session expired — sign in with Google');
          return cached;
        };

    const { mnemonic } = await revealMpcSrpFlow(
      { walletId, idToken: idToken || '', secret },
      {
        getWallet: async (id) => {
          const wallets = await getAllWallets();
          return wallets[id];
        },
        getLoginShare,
        decryptDeviceShare,
        reconstructAndValidateEntropy,
        entropyToMnemonic,
      },
    );

    sendResponse({
      id: request.id,
      data: { success: true, mnemonic },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    // getErrorMessage only — never let a share/mnemonic reach the log or response.
    console.error('Error revealing MPC seed phrase:', getErrorMessage(error, 'reveal failed'));
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error, 'Failed to reveal seed phrase') },
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
        // Route the cosign to the wallet's network so Nexus uses that network's hot
        // wallet key/pool (one Nexus serves preprod / preview / mainnet).
        const cosignNetwork = toNexusNetwork(WalletStore.state.loggedWallet?.network);
        for (const c of transaction.body.collaterals) {
          const ref = `${c.txId}#${c.index}`;
          const weLentThisRef = isRecentNexusLent(ref);
          try {
            const { witness } = await nexusCollateralApi.cosign(txCborForCosign, ref, cosignNetwork);
            const merged = await mergeWitnessSets(witnessResult.witnesses, witness);
            witnessResult = { witnesses: merged };
            debugLog('🔗 Merged Nexus collateral cosign for', ref);
          } catch (cosignErr: unknown) {
            const err = cosignErr as { response?: { status?: number }; message?: string };
            const status = err?.response?.status;
            if (weLentThisRef) {
              // We handed this UTxO to the dApp from the Nexus pool, so the tx
              // CANNOT be submitted without the hot wallet's witness. Surface the
              // failure instead of returning an under-signed witness that would
              // fail opaquely at the node.
              debugLog('⛔ Nexus cosign failed for lent ref', ref, status, err?.message);
              throw new Error(getErrorMessage(cosignErr) || 'Collateral co-signing failed');
            }
            // Otherwise the ref is a user-owned UTxO we never lent: 404 (not in
            // pool) / 400 (adversarial-tx guard) are expected — swallow them.
            if (status !== 404 && status !== 400) {
              debugLog('⚠️ Nexus cosign failed for', ref, status, err?.message);
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

    const { txCbor, password, accountIndex, utxos, addresses, privateKeyBytes, coldKeyOnly } = request.data;

    // Step 1: Sign with wallet keys (payment + stake) using existing signTx
    let transaction;
    if (txCbor) {
      transaction = deserializeCardanoJsSdkTx(txCbor);
    } else {
      throw new Error('No transaction data provided');
    }

    // Skip wallet-key signing for Ledger wallets (coldKeyOnly): there are no
    // decryptable software payment/stake keys — the Ledger owner witness is
    // produced in the popup context, and only the cold-key witness is built here.
    let walletWitnesses: { witnesses: string } | undefined;
    if (!coldKeyOnly) {
      // Route through resolveSignPrivateKeyBytes so an MPC Google wallet (SPO
      // cold-key import permits WalletType.Google) signs with its cached
      // root-key bytes instead of hitting decrypt(undefined). PRF/password
      // wallets are unaffected (explicit bytes / undefined pass straight through).
      const prfSecret = resolveSignPrivateKeyBytes(
        WalletStore.state.loggedWallet,
        privateKeyBytes ? new Uint8Array(privateKeyBytes) : undefined
      );
      walletWitnesses = await walletBg.signTx(transaction, password, accountIndex || 0, utxos, addresses, prfSecret);
    }

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

    // Get the transaction body hash (what we sign). `TransactionBody.hash()` is
    // the SDK's own blake2b-256 tx-body hash (the same value SUBMIT_TX's
    // integrity guard compares) — using it directly here fixes a bug where the
    // previous manual blake2b call fed `toCbor()`'s hex STRING into a library
    // that asserts `instanceof Uint8Array`, throwing before ever signing.
    const txBody = Serialization.TransactionBody.fromCore(transaction.body);
    const txBodyHash = Buffer.from(txBody.hash(), 'hex');

    // Sign with the cold key
    const coldKeySignature = ed25519.sign(txBodyHash, new Uint8Array(coldKeyBytes));
    const coldPubKey = ed25519.getPublicKey(new Uint8Array(coldKeyBytes));

    // Step 4: Build cold key VKeyWitness and merge with wallet witnesses
    const coldPubKeyHex = Array.from(coldPubKey).map(b => b.toString(16).padStart(2, '0')).join('');
    const coldSigHex = Array.from(coldKeySignature).map(b => b.toString(16).padStart(2, '0')).join('');

    sendResponse({
      id: request.id,
      data: {
        witnesses: coldKeyOnly ? undefined : (walletWitnesses.witnesses || walletWitnesses),
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

    // Route through walletManager so the refresh uses the active sync path: a
    // gero-sync WS resubscribe (applied under tipMutex) when enabled, or the Esplora
    // one-shot fetch only in kill-switch mode. Prevents a manual refresh from racing
    // the WS apply or making a direct 3rd-party call when WS is the source.
    await walletManager.refreshBitcoin();

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

  // Same fast-path/whitelist split and primary(mini-gero port)/fallback(popup)
  // shape as METHOD.signTx above.
  const signPsbtReply = (opts: ReplyOpts) => {
    sendResponse({ id: request.id, ...opts, target: TARGET, sender: SENDER.extension });
  };
  const btcSignPsbtPayload = { ...request.data, website: request.origin, favIconUrl: request.send?.tab?.favIconUrl };
  const tabId = request.send?.tab?.id;

  const handleMiniGeroSignPsbt = () => {
    return sendToMiniGero('btcSignPsbt', btcSignPsbtPayload, tabId)
      .then((response) => signPsbtReply({ data: response.data }));
  };

  const openPopupForSignPsbt = () => {
    const popupURL = chrome.runtime.getURL(
      `index.html#/${POPUP.bitcoinSignPsbt}?website=${encodeURIComponent(request.origin)}`
    );
    return focusOrCreatePopup(popupURL, 470, 600)
      .then(tab => Messaging.sendToPopupInternal(tab.id, request))
      .then((response: BackgroundResponse) => {
        if (response.data !== undefined) signPsbtReply({ data: response.data });
        else signPsbtReply({ error: response.error ?? APIError.InternalError });
      })
      .catch((e) => signPsbtReply({ error: e }));
  };

  const openSidePanelForSignPsbt = () => {
    if (typeof tabId !== 'number') {
      return signPsbtReply({ error: APIError.InternalError });
    }
    return openSidebar(tabId, 'sidepanel/index.html')
      .then(() => waitForMiniGeroPort(5000, tabId))
      .then(() => handleMiniGeroSignPsbt())
      .catch(() => openPopupForSignPsbt());
  };

  if (typeof tabId === 'number' && miniGeroPorts.has(tabId)) {
    handleMiniGeroSignPsbt().catch((err: unknown) => {
      signPsbtReply({ error: errorMessage(err) || APIError.InternalError });
    });
  } else {
    openSidePanelForSignPsbt();
  }
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
  const tabId = request.send?.tab?.id;
  const favIconUrl = request.send?.tab?.favIconUrl;

  // Signs one PSBT in the batch via the mini-gero port (primary), an
  // auto-opened side panel (secondary), or a standalone popup (fallback, when
  // no panel connects) — same primary/fallback shape as the singular
  // signPsbt handler above, extracted here since this handler drives it once
  // per PSBT in a sequential loop (matching the popup-only version's original
  // one-popup-per-PSBT behavior).
  const signOne = async (psbtHex: string): Promise<string> => {
    const singleRequest = { ...request, data: { psbtHex, options } };

    const viaPopup = async (): Promise<string> => {
      const popupURL = chrome.runtime.getURL(
        `index.html#/${POPUP.bitcoinSignPsbt}?website=${encodeURIComponent(request.origin)}`
      );
      const tab = await focusOrCreatePopup(popupURL, 470, 600);
      const response = await Messaging.sendToPopupInternal(tab.id, singleRequest) as BackgroundResponse;
      if (response.data !== undefined) return response.data as string;
      throw response.error ?? APIError.InternalError;
    };

    const viaMiniGero = async (): Promise<string> => {
      try {
        const response = await sendToMiniGero('btcSignPsbt', { psbtHex, options, website: request.origin, favIconUrl }, tabId);
        return response.data as string;
      } catch (err) {
        throw errorMessage(err) || APIError.InternalError;
      }
    };

    if (typeof tabId === 'number' && miniGeroPorts.has(tabId)) return viaMiniGero();
    if (typeof tabId !== 'number') throw APIError.InternalError;
    try {
      await openSidebar(tabId, 'sidepanel/index.html');
      await waitForMiniGeroPort(5000, tabId);
    } catch {
      return viaPopup();
    }
    return viaMiniGero();
  };

  const signedHexs: string[] = [];
  try {
    for (const psbtHex of psbtHexs) {
      signedHexs.push(await signOne(psbtHex));
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

  const signMessageReply = (opts: ReplyOpts) => {
    sendResponse({ id: request.id, ...opts, target: TARGET, sender: SENDER.extension });
  };
  const btcSignMessagePayload = { ...request.data, website: request.origin, favIconUrl: request.send?.tab?.favIconUrl };
  const tabId = request.send?.tab?.id;

  const handleMiniGeroSignMessage = () => {
    return sendToMiniGero('btcSignMessage', btcSignMessagePayload, tabId)
      .then((response) => signMessageReply({ data: response.data }));
  };

  const openPopupForSignMessage = () => {
    const popupURL = chrome.runtime.getURL(
      `index.html#/${POPUP.bitcoinSignMessage}?website=${encodeURIComponent(request.origin)}`
    );
    return focusOrCreatePopup(popupURL, 470, 600)
      .then(tab => Messaging.sendToPopupInternal(tab.id, request))
      .then((response: BackgroundResponse) => {
        if (response.data !== undefined) signMessageReply({ data: response.data });
        else signMessageReply({ error: response.error ?? APIError.InternalError });
      })
      .catch((e) => signMessageReply({ error: e }));
  };

  const openSidePanelForSignMessage = () => {
    if (typeof tabId !== 'number') {
      return signMessageReply({ error: APIError.InternalError });
    }
    return openSidebar(tabId, 'sidepanel/index.html')
      .then(() => waitForMiniGeroPort(5000, tabId))
      .then(() => handleMiniGeroSignMessage())
      .catch(() => openPopupForSignMessage());
  };

  if (typeof tabId === 'number' && miniGeroPorts.has(tabId)) {
    handleMiniGeroSignMessage().catch((err: unknown) => {
      signMessageReply({ error: errorMessage(err) || APIError.InternalError });
    });
  } else {
    openSidePanelForSignMessage();
  }
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

  // ---- Session Proposal → mini-gero panel (if one's open) or approval popup ----
  wcService.onSessionProposal = async (proposal) => {
    try {
      const proposalData = proposal.params;
      const peerUrl = proposalData?.proposer?.metadata?.url || '';

      // Blacklist check: WC pairing had no equivalent of the tab-navigation
      // blacklist scan (handleBlacklisted above) — a malicious dApp's WC
      // metadata was never checked, unlike a malicious website's URL.
      if (peerUrl) {
        try {
          const websiteProtectionEnabled = walletStore.config?.websiteProtection !== undefined
            ? walletStore.config.websiteProtection : true;
          if (websiteProtectionEnabled) {
            const scanResponse = await urlScan(peerUrl);
            const verdict = await scanResponse.json();
            if (verdict === 'blacklist') {
              await wcService.rejectSession(proposalData.id, 'Website flagged as malicious');
              return;
            }
          }
        } catch {
          // Scan failure must not block legitimate pairing — fail open, same
          // as handleBlacklisted's catch-all for tab navigation.
        }
      }

      let approved = false;
      if (miniGeroPorts.size > 0) {
        try {
          const response = await sendToMiniGero('wcSessionProposal', { ...proposalData, website: peerUrl || 'WalletConnect' }, undefined);
          approved = !!(response.data as { approved?: boolean } | undefined)?.approved;
        } catch {
          approved = false; // explicit reject, NACK, or wallet-changed guard
        }
      } else {
        const popupURL = chrome.runtime.getURL(`index.html#/${POPUP.wcSessionProposal}`);
        const tab = await focusOrCreatePopup(popupURL, 470, 600);
        const popupResponse = await Messaging.sendToPopupInternal(tab.id, { data: proposalData }) as { data?: { approved?: boolean } };
        approved = !!popupResponse?.data?.approved;
      }

      if (approved) {
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

  // Routes one WC session-request (signing) through the mini-gero panel if
  // one's connected, reusing the SAME port methods (signTx/signData/
  // btcSignPsbt/btcSignMessage) an injected dApp's request would use — same
  // rendering, different origin metadata — falling back to the existing
  // popup fallback (fakeRequest + focusOrCreatePopup) when no panel is open,
  // since a tabless relay event can never open one itself.
  async function routeWcSigningRequest(
    portMethod: 'signTx' | 'signData' | 'btcSignPsbt' | 'btcSignMessage',
    data: Record<string, unknown>,
    topic: string,
    id: number,
    popupRoute: string,
    popupSize: [number, number],
  ): Promise<void> {
    const session = wcService.getSessionForTopic(topic) as { peer?: { metadata?: { url?: string; icons?: string[] } } } | null;
    const peerMeta = session?.peer?.metadata;
    const payload = { ...data, website: peerMeta?.url || 'WalletConnect', favIconUrl: peerMeta?.icons?.[0] };

    if (miniGeroPorts.size > 0) {
      try {
        const response = await sendToMiniGero(portMethod, payload, undefined);
        await wcService.respondSuccess(topic, id, response.data);
      } catch (err) {
        await wcService.respondError(topic, id, 4001, errorMessage(err) || 'User rejected');
      }
      return;
    }

    const fakeRequest = { id: `wc-${id}`, data: payload, origin: 'WalletConnect', send: { tab: { id: -1 } } };
    const popupURL = chrome.runtime.getURL(`index.html#/${popupRoute}?website=${encodeURIComponent('WalletConnect')}`);
    const tab = await focusOrCreatePopup(popupURL, popupSize[0], popupSize[1]);
    const response = await Messaging.sendToPopupInternal(tab.id, fakeRequest) as BackgroundResponse;
    if (response.data !== undefined) {
      await wcService.respondSuccess(topic, id, response.data);
    } else {
      const errInfo = (response.error as { info?: string } | undefined)?.info;
      await wcService.respondError(topic, id, 4001, errInfo || 'User rejected');
    }
  }

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
            // getCollateral is async (Pass-2 lends from the Nexus pool); it must
            // be awaited or the dApp receives a serialized pending Promise ({}).
            // WalletConnect dApp origins aren't resolved here, so the shared-pool
            // fallback is disabled for WC in v1 (trusted-dApp gate can't be
            // evaluated) — WC dApps still get the user's own collateral.
            const result = await getCollateral(wcParams, storedUtxos, { allowNexusFallback: false });
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
            const wcParams = wcRequest.params || {};
            await routeWcSigningRequest(
              'signTx',
              { tx: wcParams.tx || wcParams, partialSign: wcParams.partialSign, origin: 'WalletConnect' },
              topic, id, POPUP.signTx, [470, 852],
            );
            return;
          }
          case 'cardano_signData': {
            const wcParams = wcRequest.params || {};
            await routeWcSigningRequest(
              'signData',
              { address: wcParams.addr || wcParams.address, payload: wcParams.payload, origin: 'WalletConnect' },
              topic, id, POPUP.dappSignData, [470, 600],
            );
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
            await routeWcSigningRequest(
              'btcSignPsbt',
              { psbtHex: wcParams.psbt || wcParams.psbtHex, options: wcParams.signInputs },
              topic, id, POPUP.bitcoinSignPsbt, [470, 600],
            );
            return;
          }
          case 'signMessage': {
            const wcParams = wcRequest.params || {};
            await routeWcSigningRequest(
              'btcSignMessage',
              { message: wcParams.message, type: wcParams.type || 'ecdsa' },
              topic, id, POPUP.bitcoinSignMessage, [470, 600],
            );
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

/**
 * Persist a re-derived Midnight publicKey JSON for an existing Midnight wallet.
 * The browser context runs the SDK derivation (ledger-v8 WASM doesn't run in
 * service workers), then ships the resulting `{ unshielded, shielded, dust }`
 * JSON here so the BG can update the wallet record + propagate to walletStore.
 *
 * The expected request shape: `{ walletId: number; publicKey: string }`.
 * Caller is responsible for having already verified the user's password (the
 * derivation requires decrypting the mnemonic — if that succeeds the password
 * was valid, no separate VERIFY_SPENDING_PASSWORD call is needed).
 */
app.addToOptions(MessageTypes.UPDATE_MIDNIGHT_PUBLIC_KEY, async (request, sendResponse) => {
  try {
    const { walletId, publicKey } = request.data || {};
    if (typeof walletId !== 'number' || typeof publicKey !== 'string' || !publicKey) {
      throw new Error('walletId and publicKey are required');
    }
    const { getDb } = await import('@/db/gero-db');
    const db = await getDb();
    await db['wallets'].update(walletId, { publicKey });

    // Refresh the live walletBg if this is the currently logged-in wallet so
    // subsequent code paths (sync, signing) see the new addresses without
    // requiring a re-login.
    const walletBg = walletManager.getWallet();
    if (walletBg && walletBg.id === walletId) {
      walletBg.publicKey = publicKey;
      try {
        const parsed = JSON.parse(publicKey);
        if (parsed && typeof parsed === 'object' && parsed.unshielded) {
          walletBg.baseAddress = parsed.unshielded;
        }
      } catch { /* publicKey shape mismatch — DB still updated; next login will pick up. */ }
      WalletStore.setLoggedWallet({ ...walletBg });
    }

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
});

/**
 * Midnight: sign a list of intent-hash segments with the user's role-derived
 * key. Used by the Midnight send pipeline (see `services/midnight-tx.service`).
 * Mnemonic decryption + signing happen entirely inside `walletBg.signMidnightSegments`;
 * this handler is a thin transport.
 *
 * Request shape: `{ segments: MidnightSegmentToSign[]; password?: string;
 *                   prfSecret?: number[] /* serialized Uint8Array * / }`.
 */
app.addToOptions(MessageTypes.SIGN_MIDNIGHT_SEGMENTS, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg) throw new Error('No wallet logged in');
    const { segments, password, prfSecret } = request.data || {};
    if (!Array.isArray(segments)) throw new Error('segments[] is required');
    const prfBytes = prfSecret ? new Uint8Array(prfSecret) : undefined;
    const signatures = await walletBg.signMidnightSegments(segments, password, prfBytes);
    sendResponse({
      id: request.id,
      data: { success: true, signatures },
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
});

/**
 * Midnight: DUST-balance + sign the unproven unshielded NIGHT-transfer tx
 * Nexus built. Returns the signed-but-unproven tx hex. Sidecar's /tx/finalize
 * handles ZK proving + binding + submission.
 *
 * Request shape: `{ unprovenTxHex: string, ttlMs: number,
 *                   password?: string, prfSecret?: number[] }`.
 */
app.addToOptions(
  MessageTypes.BALANCE_AND_SIGN_MIDNIGHT_UNSHIELDED_TX,
  async (request, sendResponse) => {
    try {
      const walletBg = walletManager.getWallet();
      if (!walletBg) throw new Error('No wallet logged in');
      if (walletBg.chain !== Blockchain.MIDNIGHT) {
        throw new Error('BALANCE_AND_SIGN_MIDNIGHT_UNSHIELDED_TX called on non-Midnight wallet');
      }
      const { unprovenTxHex, ttlMs, password, prfSecret } = request.data || {};
      if (typeof unprovenTxHex !== 'string' || unprovenTxHex.length === 0) {
        throw new Error('unprovenTxHex is required');
      }
      if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs)) {
        throw new Error('ttlMs is required (epoch millis)');
      }
      const prfBytes = prfSecret ? new Uint8Array(prfSecret) : undefined;
      const signedTxHex = await walletBg.balanceAndSignMidnightUnshieldedTransfer(
        unprovenTxHex,
        ttlMs,
        password,
        prfBytes,
      );
      sendResponse({
        id: request.id,
        data: { success: true, signedTxHex },
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
  },
);

/**
 * Header names a `proving.headers` request may carry — exactly the Arkhia
 * zkPaaS auth pair. An allowlist (rather than pass-through) so a crafted
 * message can't smuggle arbitrary headers (Authorization, Cookie, Host
 * overrides, ...) into the BG's fetch to the proof server.
 */
const PROVING_HEADER_ALLOWLIST = new Set(['x-api-key', 'x-api-secret']);

/**
 * Validate the optional `proving` field on BUILD_AND_SIGN_MIDNIGHT_SHIELDED_TX
 * requests (WP-P2 local mode; zkPaaS adds `headers`). This crosses the BG
 * message boundary from browser/options/popup context, so it's checked here
 * even though it originates from our own UI: http(s) scheme only, no
 * embedded credentials (a crafted `http://user:pass@host` URL would
 * otherwise smuggle Basic-Auth into the BG's fetch to the "proof server"),
 * and only allowlisted auth headers with sane, injection-free values.
 */
function parseProvingRequest(value: unknown): { url: string; headers?: Record<string, string> } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') throw new Error('proving must be an object');
  const url = (value as { url?: unknown }).url;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('proving.url is required and must be a non-empty string');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('proving.url is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('proving.url must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('proving.url must not contain credentials');
  }
  const rawHeaders = (value as { headers?: unknown }).headers;
  if (rawHeaders === undefined || rawHeaders === null) return { url };
  if (typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)) {
    throw new Error('proving.headers must be an object');
  }
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(rawHeaders as Record<string, unknown>)) {
    if (!PROVING_HEADER_ALLOWLIST.has(name.toLowerCase())) {
      throw new Error(`proving.headers: "${name}" is not an allowed header`);
    }
    // Value stays out of the error text — it's an API credential.
    if (typeof headerValue !== 'string' || headerValue.length === 0 || headerValue.length > 512
      || /[\r\n\0]/.test(headerValue)) {
      throw new Error(`proving.headers: invalid value for "${name}"`);
    }
    headers[name.toLowerCase()] = headerValue;
  }
  return Object.keys(headers).length > 0 ? { url, headers } : { url };
}

/**
 * Midnight: build + sign a shielded NIGHT transfer entirely in BG.
 *
 * Request shape: `{ outputs: [{receiverAddress, amount, tokenType?}], password?,
 * prfSecret?, proving?: { url, headers? } }`. Amounts are passed as decimal strings to
 * survive Chrome messaging's BigInt-unfriendly serialization; BG parses back
 * to bigint. `proving` is optional (WP-P2, local proof-server mode) — when
 * present, BG proves the tx itself before returning.
 *
 * Response: `{ success: true, signedTxHex, proven }`. When `proven` is
 * false (default, no `proving` in the request), `signedTxHex` is SIGNED but
 * UNPROVEN — UI must hand it to Nexus's /tx/prove-and-submit, NOT
 * /tx/submit(-proven). When `proven` is true, `signedTxHex` is a finalized
 * tx for /tx/submit-proven instead.
 */
app.addToOptions(
  MessageTypes.BUILD_AND_SIGN_MIDNIGHT_SHIELDED_TX,
  async (request, sendResponse) => {
    try {
      const walletBg = walletManager.getWallet();
      if (!walletBg) throw new Error('No wallet logged in');
      if (walletBg.chain !== Blockchain.MIDNIGHT) {
        throw new Error('BUILD_AND_SIGN_MIDNIGHT_SHIELDED_TX called on non-Midnight wallet');
      }
      const { outputs, password, prfSecret, proving } = request.data || {};
      if (!Array.isArray(outputs) || outputs.length === 0) {
        throw new Error('outputs is required (non-empty array)');
      }
      // Outputs come over the wire with amount as a string (BigInt isn't JSON-
      // serializable). Parse back to bigint here before handing off to the BG
      // builder. Fail loudly on a bad amount rather than passing 0 onward.
      const parsedOutputs = outputs.map((o: unknown, idx: number) => {
        if (!o || typeof o !== 'object') {
          throw new Error(`outputs[${idx}] is not an object`);
        }
        const obj = o as { receiverAddress?: string; amount?: string | number; tokenType?: string };
        if (typeof obj.receiverAddress !== 'string' || obj.receiverAddress.length === 0) {
          throw new Error(`outputs[${idx}].receiverAddress is required`);
        }
        const amount = typeof obj.amount === 'bigint'
          ? obj.amount
          : BigInt(String(obj.amount ?? '0'));
        if (amount <= 0n) {
          throw new Error(`outputs[${idx}].amount must be > 0`);
        }
        return {
          receiverAddress: obj.receiverAddress,
          amount,
          tokenType: obj.tokenType,
        };
      });
      const prfBytes = prfSecret ? new Uint8Array(prfSecret) : undefined;
      const provingArg = parseProvingRequest(proving);
      const { signedTxHex, proven } = await walletBg.buildAndSignMidnightShieldedTransfer(
        parsedOutputs,
        password,
        prfBytes,
        provingArg,
      );
      sendResponse({
        id: request.id,
        data: { success: true, signedTxHex, proven },
        target: TARGET,
        sender: SENDER.extension,
      });
    } catch (error) {
      console.error('Error building/signing Midnight shielded transfer:', error);
      sendResponse({
        id: request.id,
        data: { success: false, error: getErrorMessage(error) },
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  },
);

/**
 * Midnight: build + sign the SHIELD direction of a shield/unshield
 * conversion (public NIGHT -> private/shielded NIGHT). No recipient — shield
 * always moves value between the wallet's own two addresses.
 *
 * Request shape: `{ amount, password?, prfSecret?, proving?: { url, headers? } }`.
 * `amount` is a decimal string (Chrome messaging can't carry BigInt); BG
 * parses back to bigint. `proving` is optional (WP-P2 local mode; zkPaaS
 * adds auth headers), same as BUILD_AND_SIGN_MIDNIGHT_SHIELDED_TX above.
 *
 * Response: `{ success: true, signedTxHex, proven }`. Same proven/unproven
 * routing rule as the shielded-transfer handler above (proven=false ->
 * /tx/prove-and-submit, proven=true -> /tx/submit-proven).
 */
app.addToOptions(
  MessageTypes.BUILD_AND_SIGN_MIDNIGHT_SHIELD_TX,
  async (request, sendResponse) => {
    try {
      const walletBg = walletManager.getWallet();
      if (!walletBg) throw new Error('No wallet logged in');
      if (walletBg.chain !== Blockchain.MIDNIGHT) {
        throw new Error('BUILD_AND_SIGN_MIDNIGHT_SHIELD_TX called on non-Midnight wallet');
      }
      const { amount, password, prfSecret, proving } = request.data || {};
      const parsedAmount = typeof amount === 'bigint' ? amount : BigInt(String(amount ?? '0'));
      if (parsedAmount <= 0n) {
        throw new Error('amount must be > 0');
      }
      const prfBytes = prfSecret ? new Uint8Array(prfSecret) : undefined;
      const provingArg = parseProvingRequest(proving);
      const { signedTxHex, proven } = await walletBg.buildAndSignMidnightShield(
        parsedAmount,
        password,
        prfBytes,
        provingArg,
      );
      sendResponse({
        id: request.id,
        data: { success: true, signedTxHex, proven },
        target: TARGET,
        sender: SENDER.extension,
      });
    } catch (error) {
      console.error('Error building/signing Midnight shield conversion:', error);
      sendResponse({
        id: request.id,
        data: { success: false, error: getErrorMessage(error) },
        target: TARGET,
        sender: SENDER.extension,
      });
    }
  },
);

/**
 * Midnight: persist the user's consent to ship shielded-tx witness data
 * through Gero Cloud's proving service. BG-side action so the value
 * propagates to every browser context (popup, options, sidepanel) via the
 * standard midnightStore broadcast — the user shouldn't need to re-consent
 * just because they accepted in options and then opened the popup.
 *
 * Body shape: `{}` (no params — current SHIELDED_PROVING_CONSENT_VERSION
 * is fixed in code; future bumps invalidate the recorded acceptance).
 */
app.addToOptions(
  MessageTypes.ACCEPT_MIDNIGHT_SHIELDED_PROVING_CONSENT,
  async (request, sendResponse) => {
    try {
      const { midnightActions } = await import('@/stores/midnightStore');
      midnightActions.acceptShieldedProvingConsent();
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
  },
);

/**
 * Shared URL-shape check for proof-server preference fields: http(s) only,
 * no embedded credentials. Field name (never the value's credentials) goes
 * into the error text.
 */
function validateProofServerUrlField(field: string, value: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`${field} is not a valid URL`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`${field} must use http or https`);
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error(`${field} must not contain credentials`);
  }
}

/**
 * Arkhia credential fields: optional strings, bounded, header-injection
 * free (they end up as header VALUES in the BG's proof-server fetches).
 * Returns the normalized value ('' when absent). The credential itself is
 * never echoed into error messages.
 */
function validateZkpaasCredential(field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (value.length > 512 || /[\r\n\0]/.test(value)) {
    throw new Error(`${field} is not a valid credential`);
  }
  return value;
}

/**
 * Midnight: persist the user's proof-server preference (WP-P4 Settings UI).
 * Browser-side only sets `midnightStore.proofServer` in its own tab's memory
 * (see the store's `broadcastFromBackground` guard) so, like
 * ACCEPT_MIDNIGHT_SHIELDED_PROVING_CONSENT above, the Settings radio group
 * routes the change here to persist + broadcast to every connected browser
 * context.
 *
 * Request shape: `{ mode: 'remote' | 'local' | 'zkpaas', localUrl: string,
 * zkpaasUrl?: string, zkpaasApiKey?: string, zkpaasApiSecret?: string }`.
 * Validated at the message boundary (same posture as `parseProvingRequest`
 * above) even though it currently only originates from our own UI: http(s)
 * scheme only, no embedded credentials, bounded credential strings (never
 * echoed into error text or logs).
 */
app.addToOptions(
  MessageTypes.SET_MIDNIGHT_PROOF_SERVER,
  async (request, sendResponse) => {
    try {
      const {
        mode, localUrl, zkpaasUrl, zkpaasApiKey, zkpaasApiSecret,
      } = request.data || {};
      if (mode !== 'remote' && mode !== 'local' && mode !== 'zkpaas') {
        throw new Error('mode must be "remote", "local" or "zkpaas"');
      }
      if (typeof localUrl !== 'string' || localUrl.length === 0) {
        throw new Error('localUrl is required and must be a non-empty string');
      }
      validateProofServerUrlField('localUrl', localUrl);
      const { midnightStore, midnightActions } = await import('@/stores/midnightStore');
      // The zkPaaS fields are OPTIONAL per request: absent means "keep the
      // stored value" (older call sites like the consent dialog's
      // use-local-instead only send mode+localUrl and must not wipe saved
      // Arkhia credentials), while an explicit '' means "clear it" ('' is
      // also the valid "derive the endpoint per network" state for the URL).
      const current = midnightStore.proofServer;
      const zkpaasUrlValue = zkpaasUrl === undefined || zkpaasUrl === null
        ? current.zkpaasUrl : zkpaasUrl;
      if (typeof zkpaasUrlValue !== 'string') throw new Error('zkpaasUrl must be a string');
      if (zkpaasUrlValue.length > 0) validateProofServerUrlField('zkpaasUrl', zkpaasUrlValue);
      const zkpaasApiKeyValue = zkpaasApiKey === undefined || zkpaasApiKey === null
        ? current.zkpaasApiKey : validateZkpaasCredential('zkpaasApiKey', zkpaasApiKey);
      const zkpaasApiSecretValue = zkpaasApiSecret === undefined || zkpaasApiSecret === null
        ? current.zkpaasApiSecret : validateZkpaasCredential('zkpaasApiSecret', zkpaasApiSecret);
      midnightActions.setProofServer({
        mode,
        localUrl,
        zkpaasUrl: zkpaasUrlValue,
        zkpaasApiKey: zkpaasApiKeyValue,
        zkpaasApiSecret: zkpaasApiSecretValue,
      });
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
  },
);

/**
 * Midnight: submit a fully-signed (and proven, for shielded) transaction via
 * Nexus's relay endpoint. Nexus calls `PolkadotNodeClient.sendMidnightTransaction`
 * against the Midnight RPC node and bubbles the submission event back here.
 *
 * Request shape: `{ signedTxHex: string; waitFor?: 'Submitted'|'InBlock'|'Finalized' }`.
 */
app.addToOptions(MessageTypes.SUBMIT_MIDNIGHT_TX, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg) throw new Error('No wallet logged in');
    if (walletBg.chain !== Blockchain.MIDNIGHT) {
      throw new Error('SUBMIT_MIDNIGHT_TX called on non-Midnight wallet');
    }
    const { signedTxHex, waitFor } = request.data || {};
    if (typeof signedTxHex !== 'string' || !signedTxHex) {
      throw new Error('signedTxHex is required');
    }
    const { getMidnightApi } = await import('@/api/midnight-api');
    const api = getMidnightApi(walletBg.network);
    const result = await api.submitMidnightTx({ signedTxHex, waitFor });
    sendResponse({
      id: request.id,
      data: { success: true, result },
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
});

/**
 * Midnight: get the publicKeyHex + addressHex the Nexus sidecar needs for
 * seedless wallet construction. Fast path if already persisted; slow path
 * decrypts the mnemonic once and persists for next time.
 *
 * Request shape: `{ password?: string; prfSecret?: number[] }`.
 */
app.addToOptions(MessageTypes.GET_MIDNIGHT_WALLET_KEYS, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg) throw new Error('No wallet logged in');
    const { password, prfSecret } = request.data || {};
    const prfBytes = prfSecret ? new Uint8Array(prfSecret) : undefined;
    const keys = await walletBg.getMidnightWalletKeys(password, prfBytes);
    sendResponse({
      id: request.id,
      data: { success: true, ...keys },
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
});

/**
 * Midnight: sign + submit the Cardano-side DUST registration tx. Same wallet
 * mnemonic that derives Midnight HD keys also derives the CIP-1852 Cardano
 * payment key. Request shape: `{ txCborHex: string; password?: string;
 * prfSecret?: number[] }`. Returns `{ txHash }` on success.
 */
app.addToOptions(MessageTypes.SIGN_AND_SUBMIT_DUST_REGISTRATION_TX, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg) throw new Error('No wallet logged in');
    const { txCborHex, password, prfSecret } = request.data || {};
    if (!txCborHex) throw new Error('txCborHex is required');
    const prfBytes = prfSecret ? new Uint8Array(prfSecret) : undefined;
    const { txHash } = await walletBg.signAndSubmitDustRegistrationTx(txCborHex, password, prfBytes);
    sendResponse({
      id: request.id,
      data: { success: true, txHash },
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
});

/**
 * Midnight: force a full re-sync from block 0. Clears the gero-sync WS cursor +
 * store snapshot and the persisted SDK wallet-state blobs, then resubscribes
 * from genesis. User-triggered recovery for a stuck/stale local view. The WS
 * and the sync service live in BG, so this must run here. No params.
 */
app.addToOptions(MessageTypes.RESYNC_MIDNIGHT, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg) throw new Error('No wallet logged in');
    if (walletBg.chain !== Blockchain.MIDNIGHT) {
      throw new Error('RESYNC_MIDNIGHT called on non-Midnight wallet');
    }
    const { default: midnightSyncService } = await import('@/services/midnight-sync.service');
    if (!midnightSyncService.isActive()) {
      throw new Error('Midnight sync service is not active');
    }
    midnightSyncService.forceResync();
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
});

/**
 * Midnight: optimistically insert a just-submitted tx as `pending` so the send
 * appears in history immediately. gero-sync's confirmed entry (same hash)
 * replaces it via `applyTransaction`'s hash dedup once indexed.
 *
 * Request shape: `{ hash, amount (decimal string), counterparty?, isShielded? }`.
 * Amount is a string because Chrome messaging can't carry BigInt.
 */
app.addToOptions(MessageTypes.ADD_MIDNIGHT_PENDING_TX, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg) throw new Error('No wallet logged in');
    if (walletBg.chain !== Blockchain.MIDNIGHT) {
      throw new Error('ADD_MIDNIGHT_PENDING_TX called on non-Midnight wallet');
    }
    const { hash, amount, counterparty, isShielded } = request.data || {};
    if (typeof hash !== 'string' || !hash) throw new Error('hash is required');
    const { midnightActions } = await import('@/stores/midnightStore');
    let amountBig = 0n;
    try { amountBig = BigInt(amount ?? '0'); } catch { amountBig = 0n; }
    midnightActions.applyTransaction({
      hash,
      type: 'send',
      token: 'NIGHT',
      amount: amountBig,
      counterparty: typeof counterparty === 'string' ? counterparty : '',
      timestamp: Date.now(),
      status: 'pending',
      fee: 0n,
      isShielded: !!isShielded,
    });
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
});

// ═════════════════════════════════════════════════════════════════════════
// Midnight DApp Connector (@midnight-ntwrk/dapp-connector-api v4.0.1)
//
// Phase 1: discovery + connect + all read getters + signData +
// submitTransaction. See docs/midnight/2026-07-09-midnight-dapp-connector-plan.md
// for the full spec-vs-shipped-package verification this is grounded in
// (several details here diverge from the SPECIFICATION.md prose because the
// prose is measurably stale against the actual published 4.0.1 types).
//
// Registered via `app.add` (webpage-facing, sender:'webpage') — mirrors the
// CIP-30 METHOD.* handlers above, NOT the internal MessageTypes handlers.
// Every method except `connect` reaches here only after content.ts's relay
// (messaging.ts createProxyController) has already confirmed the origin is
// whitelisted. `WalletStore.connectedDapps` is loaded from the ACTIVE
// wallet's own per-wallet IndexedDB (`wallet-{id}`), so a Midnight wallet's
// whitelist is naturally disjoint from any Cardano wallet's approvals for
// the same origin — no extra chain-scoping code needed.
// ═════════════════════════════════════════════════════════════════════════

function midnightApiError(code: string, reason: string) {
  return { type: 'DAppConnectorAPIError', code, reason, message: reason };
}

/**
 * `sendToMiniGero`'s resolver rejects with `new Error(String(response.error))`
 * — the mini-gero port protocol only carries a plain string, not a structured
 * object. The side panel's Midnight branches (DAppOverlay.vue) JSON-encode a
 * DAppConnectorAPIError into that string so the rich {code, reason} shape
 * survives the round trip; decode it back here, with a safe fallback for any
 * other rejection shape (timeouts, non-Midnight panel-closed strings, etc).
 */
function parseMidnightMiniGeroError(
  err: unknown,
  fallbackCode: string,
  fallbackReason: string,
): { type: string; code: string; reason: string; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(message);
    if (parsed && typeof parsed === 'object' && parsed.type === 'DAppConnectorAPIError') {
      return parsed;
    }
  } catch { /* not a JSON-encoded Midnight error — synthesize below */ }
  return midnightApiError(fallbackCode, message || fallbackReason);
}

/**
 * Per-tab record of Midnight connector methods the user has explicitly
 * declined THIS session — implements the spec's Rejected-vs-PermissionRejected
 * distinction (SPECIFICATION.md §Permissions / §Errors): `Rejected` is
 * one-time, `PermissionRejected` "persists for the session (until the
 * browser window/tab with the DApp page is closed)". Without this, a dapp
 * could re-prompt the user for the same approval indefinitely after an
 * explicit decline (a "prompt bombing" consent-fatigue pattern).
 *
 * Scoped per-tab (not per-origin) so it naturally bounds itself: the user's
 * escape hatch is reloading the dapp's page, which gets a fresh tab-relative
 * state. Cleared via chrome.tabs.onRemoved — a single module-level listener,
 * not one per request, to avoid a listener leak across many declines.
 */
const midnightDeclinedMethodsByTab = new Map<number, Set<string>>();
chrome.tabs?.onRemoved?.addListener((tabId) => {
  midnightDeclinedMethodsByTab.delete(tabId);
});

function hasMidnightPermissionDenial(tabId: number | undefined, method: string): boolean {
  return typeof tabId === 'number' && !!midnightDeclinedMethodsByTab.get(tabId)?.has(method);
}

function recordMidnightPermissionDenial(tabId: number | undefined, method: string): void {
  if (typeof tabId !== 'number') return;
  const existing = midnightDeclinedMethodsByTab.get(tabId);
  if (existing) existing.add(method);
  else midnightDeclinedMethodsByTab.set(tabId, new Set([method]));
}

/**
 * Gero `Network` enum → Midnight SDK's lowercase networkId string. The same
 * mapping is duplicated at every other Midnight SDK call site in this
 * codebase (signMidnightSegments, balanceAndSignUnshieldedTransfer, ...) —
 * kept local here rather than centralized, matching that established pattern.
 */
function midnightSdkNetworkId(network: string): string {
  switch (network) {
    case Network.MAINNET: return 'mainnet';
    case Network.PREVIEW: return 'preview';
    case Network.PREPROD: return 'preprod';
    case Network.TESTNET: return 'testnet';
    default: throw new Error(`Unsupported Midnight network: ${network}`);
  }
}

/**
 * Chain + wallet-presence + unlocked guard shared by every MIDNIGHT_METHOD.*
 * read/submit handler. `connect` and `signData` don't use this — they need to
 * report WHY there's no connectable wallet via a popup/reply rather than a
 * bare null.
 *
 * The lock check matters even for an already-whitelisted origin: locking the
 * wallet (walletManager.lock()) only flips walletStore.isLocked — it does NOT
 * clear the in-memory walletBg instance or midnightStore, so without this
 * check a previously-approved dapp could keep reading real addresses,
 * balances, and tx history from a wallet the USER believes is locked. Matches
 * the plan doc's explicit "no capability leakage when locked" requirement.
 */
function requireMidnightWallet(): ReturnType<typeof walletManager.getWallet> | null {
  if (walletStore.isLocked) return null;
  const wallet = walletManager.getWallet();
  if (!wallet || wallet.chain !== Blockchain.MIDNIGHT) return null;
  return wallet;
}

/**
 * Approve/open a Midnight dapp connection. Routes EXCLUSIVELY through the
 * mini-gero side panel (same `sendToMiniGero`/`miniGeroPorts`/`openSidebar`/
 * `waitForMiniGeroPort` mechanism as CIP-30's `enable`, background.ts:488) —
 * deliberately NO popup fallback: if the side panel can't be opened/
 * connected, the request fails outright rather than degrading to a
 * standalone popup window. One extra guard `enable` doesn't need: verifying
 * the ACTIVE wallet is actually a Midnight wallet, since `window.midnight` is
 * installed regardless of which chain is logged in.
 */
app.add(MIDNIGHT_METHOD.connect, (request, sendResponse) => {
  const { id, origin, send, data } = request;
  const networkId = (data as { networkId?: string } | undefined)?.networkId;
  const reply = (opts: ReplyOpts) => {
    sendResponse({ id, ...opts, target: TARGET, sender: SENDER.extension });
  };

  const currentWallet = walletManager.getWallet();
  if (!currentWallet || currentWallet.chain !== Blockchain.MIDNIGHT) {
    reply({ error: midnightApiError(MidnightErrorCode.InternalError, 'No Midnight wallet is currently active') });
    return true;
  }
  // A locked wallet must not connect (or silently stay connected — see
  // requireMidnightWallet's doc comment for why an already-whitelisted origin
  // is still a risk here): report Disconnected rather than proceeding.
  if (walletStore.isLocked) {
    reply({ error: midnightApiError(MidnightErrorCode.Disconnected, 'Wallet is locked') });
    return true;
  }
  // The connector spec only formally standardizes 'mainnet' as a well-known
  // network id (SPECIFICATION.md §Initial API point 13) — non-mainnet ids
  // aren't governed by a canonical registry across dapps/wallets. But our
  // own SDK networkId vocabulary ('mainnet'/'preview'/'preprod'/'testnet',
  // via midnightSdkNetworkId) is exactly what a Gero-aware dapp — or any
  // dapp using the same SDK convention — would send. Reject on ANY mismatch
  // against the active wallet's actual network, not just a mainnet-specific
  // special case: silently accepting e.g. a 'preview' request while the
  // wallet is on 'preprod' would connect the dapp to the wrong chain without
  // it ever knowing. Better to over-reject an unusual-but-valid networkId
  // string than to silently cross-connect networks.
  if (networkId && networkId !== midnightSdkNetworkId(currentWallet.network)) {
    reply({ error: midnightApiError(MidnightErrorCode.InvalidRequest, `Wallet is on ${currentWallet.network}, not ${networkId}`) });
    return true;
  }

  if (WalletStore.isWhitelisted(origin)) {
    reply({ data: true });
    return true;
  }

  const tabId = send.tab?.id;
  if (hasMidnightPermissionDenial(tabId, MIDNIGHT_METHOD.connect)) {
    reply({ error: midnightApiError(MidnightErrorCode.PermissionRejected, 'User already declined this connection request this session') });
    return true;
  }
  if (typeof tabId !== 'number') {
    reply({ error: midnightApiError(MidnightErrorCode.InternalError, 'No tab context for this request') });
    return true;
  }

  const favIconUrl = send.tab?.favIconUrl;
  const connectPayload = { website: origin, favIconUrl };

  const sendToPanel = () =>
    sendToMiniGero(MIDNIGHT_METHOD.connect, connectPayload, tabId)
      .then(async (response: BackgroundResponse) => {
        if (response.data === true) {
          await WalletStore.addConnectedDapp(currentWallet.id, origin);
        }
        reply({ data: response.data });
      })
      .catch(err => {
        // Fallback code is deliberately NOT Rejected: Rejected must only ever
        // come from a genuinely-parsed JSON round-trip of the panel's own
        // explicit rejectMidnightConnect() (see midnightError() in
        // DAppOverlay.vue) — sticky-denial below keys off exactly that. An
        // unparseable/unexpected rejection (a bug, a future refactor that
        // makes sendToMiniGero reject with a plain Error) must NOT be able
        // to masquerade as a user decision just because Rejected happened to
        // be convenient as a fallback value.
        const midnightErr = parseMidnightMiniGeroError(err, MidnightErrorCode.InternalError, 'Failed to complete the connection request');
        if (midnightErr.code === MidnightErrorCode.Rejected) {
          recordMidnightPermissionDenial(tabId, MIDNIGHT_METHOD.connect);
        }
        reply({ error: midnightErr });
      });

  // Primary: the panel is already open and listening for this tab.
  if (miniGeroPorts.has(tabId)) {
    sendToPanel();
    return true;
  }

  // Open the panel and wait for it to connect. No popup fallback.
  openSidebar(tabId, 'sidepanel/index.html')
    .then(() => waitForMiniGeroPort(5000, tabId))
    .then(() => sendToPanel())
    .catch(err => reply({
      error: midnightApiError(MidnightErrorCode.InternalError, `Failed to open the wallet's approval panel: ${getErrorMessage(err)}`),
    }));

  return true; // async
});

app.add(MIDNIGHT_METHOD.getUnshieldedAddress, async (request, sendResponse) => {
  const { midnightStore } = await import('@/stores/midnightStore');
  const wallet = requireMidnightWallet();
  if (!wallet || !midnightStore.addresses.unshielded) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.Disconnected, 'No Midnight wallet connected'), target: TARGET, sender: SENDER.extension });
    return;
  }
  sendResponse({
    id: request.id,
    data: { unshieldedAddress: midnightStore.addresses.unshielded },
    target: TARGET,
    sender: SENDER.extension,
  });
});

app.add(MIDNIGHT_METHOD.getDustAddress, async (request, sendResponse) => {
  const { midnightStore } = await import('@/stores/midnightStore');
  const wallet = requireMidnightWallet();
  if (!wallet || !midnightStore.addresses.dust) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.Disconnected, 'No Midnight wallet connected'), target: TARGET, sender: SENDER.extension });
    return;
  }
  sendResponse({
    id: request.id,
    data: { dustAddress: midnightStore.addresses.dust },
    target: TARGET,
    sender: SENDER.extension,
  });
});

/**
 * The shielded address bech32m string is a PUBLIC, reversible encoding of the
 * coin + encryption public keys (wallet-sdk-address-format's ShieldedAddress
 * class). Decoding it back needs no mnemonic decrypt / no auth prompt — see
 * build plan doc §3 for the verification.
 */
app.add(MIDNIGHT_METHOD.getShieldedAddresses, async (request, sendResponse) => {
  const { midnightStore } = await import('@/stores/midnightStore');
  const wallet = requireMidnightWallet();
  const shieldedAddress = midnightStore.addresses.shielded;
  if (!wallet || !shieldedAddress) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.Disconnected, 'No Midnight wallet connected'), target: TARGET, sender: SENDER.extension });
    return;
  }
  try {
    const { ShieldedAddress, MidnightBech32m } = await import('@midnightntwrk/wallet-sdk-address-format');
    const decoded = ShieldedAddress.codec.decode(
      midnightSdkNetworkId(wallet.network),
      MidnightBech32m.parse(shieldedAddress),
    );
    sendResponse({
      id: request.id,
      data: {
        shieldedAddress,
        shieldedCoinPublicKey: decoded.coinPublicKeyString(),
        shieldedEncryptionPublicKey: decoded.encryptionPublicKeyString(),
      },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.InternalError, getErrorMessage(error)), target: TARGET, sender: SENDER.extension });
  }
});

app.add(MIDNIGHT_METHOD.getUnshieldedBalances, async (request, sendResponse) => {
  const { midnightStore } = await import('@/stores/midnightStore');
  const { NIGHT_TOKEN_TYPE_NULL } = await import('@/services/midnight-sync.service');
  const wallet = requireMidnightWallet();
  if (!wallet) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.Disconnected, 'No Midnight wallet connected'), target: TARGET, sender: SENDER.extension });
    return;
  }
  // midnightStore.utxos only ever carries NIGHT-type outputs today (the sync
  // layer filters non-native tokenTypes out — see midnight-sync.service.ts's
  // isNightOutput), so this record has at most one key. Normalize an empty
  // tokenType (Gero's internal "native NIGHT" convention) to the canonical
  // 32-byte-zero hex a dapp checking nativeToken().raw would expect.
  let night = 0n;
  for (const u of midnightStore.utxos) {
    const tt = u.tokenType ?? '';
    if (tt === '' || tt === NIGHT_TOKEN_TYPE_NULL) night += u.value;
  }
  sendResponse({
    id: request.id,
    data: night > 0n ? { [NIGHT_TOKEN_TYPE_NULL]: night.toString() } : {},
    target: TARGET,
    sender: SENDER.extension,
  });
});

app.add(MIDNIGHT_METHOD.getShieldedBalances, async (request, sendResponse) => {
  const { midnightStore } = await import('@/stores/midnightStore');
  const { NIGHT_TOKEN_TYPE_NULL } = await import('@/services/midnight-sync.service');
  const wallet = requireMidnightWallet();
  if (!wallet) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.Disconnected, 'No Midnight wallet connected'), target: TARGET, sender: SENDER.extension });
    return;
  }
  // Gero only tracks native shielded NIGHT as a scalar today (no per-token
  // breakdown from a ShieldedWallet state yet — Phase 1 known limitation,
  // see build plan doc §3 "small gap" note).
  const night = midnightStore.balances.nightShielded;
  sendResponse({
    id: request.id,
    data: night > 0n ? { [NIGHT_TOKEN_TYPE_NULL]: night.toString() } : {},
    target: TARGET,
    sender: SENDER.extension,
  });
});

app.add(MIDNIGHT_METHOD.getDustBalance, async (request, sendResponse) => {
  const { midnightStore } = await import('@/stores/midnightStore');
  const wallet = requireMidnightWallet();
  if (!wallet) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.Disconnected, 'No Midnight wallet connected'), target: TARGET, sender: SENDER.extension });
    return;
  }
  const dustState = midnightStore.dustState;
  if (!dustState) {
    // Don't guess: reporting {cap:0,balance:0} would read as "you have zero
    // DUST" when the truth is "not loaded yet" — force the dapp to retry.
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.InternalError, 'DUST state not yet loaded'), target: TARGET, sender: SENDER.extension });
    return;
  }
  sendResponse({
    id: request.id,
    data: { cap: dustState.cap.toString(), balance: dustState.current.toString() },
    target: TARGET,
    sender: SENDER.extension,
  });
});

app.add(MIDNIGHT_METHOD.getTxHistory, async (request, sendResponse) => {
  const { midnightStore } = await import('@/stores/midnightStore');
  const wallet = requireMidnightWallet();
  if (!wallet) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.Disconnected, 'No Midnight wallet connected'), target: TARGET, sender: SENDER.extension });
    return;
  }
  const { pageNumber, pageSize } = (request.data as { pageNumber?: number; pageSize?: number } | undefined) ?? {};
  const size = typeof pageSize === 'number' && pageSize > 0 ? pageSize : 20;
  const page = typeof pageNumber === 'number' && pageNumber >= 0 ? pageNumber : 0;
  const slice = midnightStore.transactions.slice(page * size, page * size + size);
  // Gero tracks confirmed/pending/failed; the connector's TxStatus distinguishes
  // finalized/confirmed/pending/discarded with per-segment executionStatus we
  // don't track yet (D8 in the July 2026 audit) — map to the closest fit with
  // an empty executionStatus placeholder rather than inventing data.
  const entries = slice.map(tx => ({
    txHash: tx.hash,
    txStatus: tx.status === 'pending'
      ? { status: 'pending' as const }
      : tx.status === 'failed'
        ? { status: 'discarded' as const }
        : { status: 'confirmed' as const, executionStatus: {} },
  }));
  sendResponse({ id: request.id, data: entries, target: TARGET, sender: SENDER.extension });
});

app.add(MIDNIGHT_METHOD.getConfiguration, async (request, sendResponse) => {
  const wallet = requireMidnightWallet();
  if (!wallet) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.Disconnected, 'No Midnight wallet connected'), target: TARGET, sender: SENDER.extension });
    return;
  }
  try {
    const { getMidnightEndpoints } = await import('@/chains/midnight/midnightConfig');
    const { midnightStore } = await import('@/stores/midnightStore');
    const endpoints = getMidnightEndpoints(wallet.network);
    if (!endpoints) throw new Error(`No Midnight endpoints configured for network ${wallet.network}`);
    // A dApp has no way to reach Gero's internal cloud prover directly, so
    // when the user's preference is 'remote' the network's default proof
    // server URL remains the least-wrong answer to advertise here (WP-P5:
    // connector `getProvingProvider()` delegation is a separate, later
    // phase). Only report the user's own local proof server once they've
    // actually opted into local mode (WP-P1/P4). zkPaaS mode deliberately
    // ALSO reports the default: the Arkhia endpoint is useless to a dApp
    // without the user's API key, and a user-pasted override URL may embed
    // that key as a path segment — advertising it would hand the user's
    // paid credential to every connected dApp.
    const proverServerUri = midnightStore.proofServer.mode === 'local'
      ? midnightStore.proofServer.localUrl
      : (endpoints.defaultProofServerUrl || undefined);
    sendResponse({
      id: request.id,
      data: {
        indexerUri: endpoints.publicIndexerUrl,
        indexerWsUri: endpoints.publicIndexerWsUrl,
        proverServerUri,
        substrateNodeUri: endpoints.publicRpcUrl,
        networkId: midnightSdkNetworkId(wallet.network),
      },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.InternalError, getErrorMessage(error)), target: TARGET, sender: SENDER.extension });
  }
});

app.add(MIDNIGHT_METHOD.getConnectionStatus, async (request, sendResponse) => {
  const wallet = requireMidnightWallet();
  if (!wallet) {
    sendResponse({ id: request.id, data: { status: 'disconnected' }, target: TARGET, sender: SENDER.extension });
    return;
  }
  sendResponse({
    id: request.id,
    data: { status: 'connected', networkId: midnightSdkNetworkId(wallet.network) },
    target: TARGET,
    sender: SENDER.extension,
  });
});

/**
 * Relay a balanced + sealed (proofs, signatures, cryptographically bound) tx
 * to the network. The connector is a submit-only relayer here, mirroring
 * midnight-tx.service's submitSignedTx — no build/balance/sign happens.
 */
app.add(MIDNIGHT_METHOD.submitTransaction, async (request, sendResponse) => {
  const wallet = requireMidnightWallet();
  if (!wallet) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.Disconnected, 'No Midnight wallet connected'), target: TARGET, sender: SENDER.extension });
    return;
  }
  const tx = (request.data as { tx?: string } | undefined)?.tx;
  if (typeof tx !== 'string' || !tx) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.InvalidRequest, 'tx is required'), target: TARGET, sender: SENDER.extension });
    return;
  }
  try {
    const { getMidnightApi } = await import('@/api/midnight-api');
    const api = getMidnightApi(wallet.network);
    await api.submitMidnightTx({ signedTxHex: tx, waitFor: 'Submitted' });
    sendResponse({ id: request.id, data: undefined, target: TARGET, sender: SENDER.extension });
  } catch (error) {
    sendResponse({ id: request.id, error: midnightApiError(MidnightErrorCode.InvalidRequest, getErrorMessage(error)), target: TARGET, sender: SENDER.extension });
  }
});

/**
 * Opens the sign-data approval view in the mini-gero side panel (password/PRF
 * wallets only — Midnight has no hardware-wallet support, see the July 2026
 * gap analysis). Same side-panel-only routing as `connect` above — no popup
 * fallback. The panel itself calls MessageTypes.SIGN_MIDNIGHT_CONNECTOR_DATA
 * once the user authenticates; see walletBg.signMidnightConnectorData for the
 * actual signing + mandatory prefix logic.
 */
app.add(MIDNIGHT_METHOD.signData, (request, sendResponse) => {
  const { id, origin, send, data } = request;
  const reply = (opts: ReplyOpts) => {
    sendResponse({ id, ...opts, target: TARGET, sender: SENDER.extension });
  };
  const currentWallet = walletManager.getWallet();
  if (!currentWallet || currentWallet.chain !== Blockchain.MIDNIGHT) {
    reply({ error: midnightApiError(MidnightErrorCode.Disconnected, 'No Midnight wallet connected') });
    return true;
  }
  if (walletStore.isLocked) {
    reply({ error: midnightApiError(MidnightErrorCode.Disconnected, 'Wallet is locked') });
    return true;
  }
  // Same fast-path/whitelist split as Cardano's signTx/signData: the content
  // relay now sends this straight through (see messaging.ts) so the user
  // gesture survives to sidePanel.open(); enforce the connect-first
  // requirement here instead of in that pre-check round-trip.
  if (!WalletStore.isWhitelisted(origin)) {
    reply({ error: midnightApiError(MidnightErrorCode.Disconnected, 'Not connected — call connect() first') });
    return true;
  }
  const tabId = send.tab?.id;
  if (typeof tabId !== 'number') {
    reply({ error: midnightApiError(MidnightErrorCode.InternalError, 'No tab context for this request') });
    return true;
  }
  // Unlike `connect` (above), signData does NOT use the sticky-denial
  // tracker: each call carries materially different data (a login challenge,
  // an attestation, ...), so blocking every FUTURE signData request because
  // the user declined one unrelated one would be a functionality regression,
  // not a security improvement. `connect` is coherent to sticky-deny because
  // it's always the same idempotent action; signData isn't.
  const favIconUrl = send.tab?.favIconUrl;
  const signDataPayload = { data, website: origin, favIconUrl };

  const sendToPanel = () =>
    sendToMiniGero(MIDNIGHT_METHOD.signData, signDataPayload, tabId)
      .then((response: BackgroundResponse) => reply({ data: response.data }))
      .catch(err => reply({
        // Same reasoning as connect's catch above: the fallback must not be
        // Rejected, or a dapp branching on error.code === 'Rejected' would
        // be told "the user declined" for e.g. a panel-closed/internal
        // failure that was never an actual decision.
        error: parseMidnightMiniGeroError(err, MidnightErrorCode.InternalError, 'Failed to complete the signing request'),
      }));

  if (miniGeroPorts.has(tabId)) {
    sendToPanel();
    return true;
  }

  openSidebar(tabId, 'sidepanel/index.html')
    .then(() => waitForMiniGeroPort(5000, tabId))
    .then(() => sendToPanel())
    .catch(err => reply({
      error: midnightApiError(MidnightErrorCode.InternalError, `Failed to open the wallet's approval panel: ${getErrorMessage(err)}`),
    }));
  return true;
});

app.add(MIDNIGHT_METHOD.hintUsage, (request, sendResponse) => {
  // No usage-hinted permission pre-prompting implemented yet (Phase 1 scope,
  // separate from the sticky-denial tracking on `connect` above) — resolve
  // immediately with void per the spec's required return type.
  sendResponse({ id: request.id, data: undefined, target: TARGET, sender: SENDER.extension });
});

/** Canonical 32-byte-zero RawTokenType — how the ledger/connector names native
 * NIGHT (see midnightShieldedBuilder.ts NIGHT_RAW_TOKEN_TYPE). */
const MIDNIGHT_NATIVE_NIGHT_TOKEN_TYPE =
  '0000000000000000000000000000000000000000000000000000000000000000';

type MakeTransferRequestData = {
  desiredOutputs?: Array<{ kind?: string; type?: string; value?: string; recipient?: string }>;
  options?: { payFees?: boolean };
};

/**
 * Validate a connector makeTransfer request BEFORE prompting the user, so an
 * unsupported/malformed request rejects cleanly without wasting an approval
 * dialog. Phase 2 scope: native-NIGHT UNSHIELDED outputs only, wallet pays DUST
 * fees. Mirrors MidnightSendDialog's per-network address-prefix check
 * (mainnet omits the network segment; others embed it lowercased).
 */
function validateMakeTransferInputs(
  data: MakeTransferRequestData | undefined,
  network: string,
): { ok: true } | { ok: false; reason: string } {
  const desiredOutputs = data?.desiredOutputs;
  if (!Array.isArray(desiredOutputs) || desiredOutputs.length === 0) {
    return { ok: false, reason: 'desiredOutputs must be a non-empty array' };
  }
  // Cap the output count: the array is walked synchronously in the service
  // worker and rendered in the approval panel, so an unbounded length is a DoS
  // vector. A real transfer never needs this many outputs (Nexus/tx-size limits
  // bite far sooner).
  if (desiredOutputs.length > 100) {
    return { ok: false, reason: 'too many outputs (max 100 per transfer)' };
  }
  if (data?.options?.payFees === false) {
    return { ok: false, reason: 'payFees:false is not supported in this version (GeroWallet pays DUST fees; fee delegation is planned)' };
  }
  const isMain = network === Network.MAINNET;
  const prefix = isMain ? 'mn_addr1' : `mn_addr_${network.toLowerCase()}1`;
  for (const o of desiredOutputs) {
    if (!o || typeof o !== 'object') {
      return { ok: false, reason: 'each desiredOutput must be an object' };
    }
    if (o.kind !== 'unshielded') {
      return { ok: false, reason: `only unshielded transfers are supported in this version (got kind='${o.kind}')` };
    }
    // Native NIGHT only: the canonical 32-byte-zero RawTokenType, or the empty
    // 'native' shorthand. Any other hex token type is unsupported (Nexus only
    // builds native NIGHT today).
    if (o.type !== undefined && o.type !== '' && o.type !== MIDNIGHT_NATIVE_NIGHT_TOKEN_TYPE) {
      return { ok: false, reason: 'only native NIGHT transfers are supported in this version' };
    }
    // value arrives as a decimal string (the page bridge stringifies the bigint).
    let value: bigint;
    try {
      value = BigInt(o.value as string);
    } catch {
      return { ok: false, reason: `invalid amount: ${o.value}` };
    }
    if (value <= 0n) {
      return { ok: false, reason: 'amount must be a positive integer' };
    }
    if (typeof o.recipient !== 'string' || !o.recipient.startsWith(prefix)) {
      return { ok: false, reason: `recipient must be a ${prefix}… unshielded address on the connected network` };
    }
  }
  return { ok: true };
}

/**
 * Opens the makeTransfer approval view in the mini-gero side panel (password/
 * PRF wallets only — Midnight has no hardware-wallet support). Same
 * side-panel-only routing as signData — no popup fallback.
 *
 * Phase 2: native-NIGHT UNSHIELDED transfers only. The panel builds +
 * DUST-balances + signs (but does NOT submit) via buildAndSignUnshieldedTransfer
 * and returns `{ tx }`; the dapp submits it via submitTransaction, which
 * proves + binds server-side. Shielded/mixed outputs and payFees:false reject
 * with InvalidRequest BEFORE the user is prompted (validateMakeTransferInputs).
 */
app.add(MIDNIGHT_METHOD.makeTransfer, (request, sendResponse) => {
  const { id, origin, send, data } = request;
  const reply = (opts: ReplyOpts) => {
    sendResponse({ id, ...opts, target: TARGET, sender: SENDER.extension });
  };
  const currentWallet = walletManager.getWallet();
  if (!currentWallet || currentWallet.chain !== Blockchain.MIDNIGHT) {
    reply({ error: midnightApiError(MidnightErrorCode.Disconnected, 'No Midnight wallet connected') });
    return true;
  }
  if (walletStore.isLocked) {
    reply({ error: midnightApiError(MidnightErrorCode.Disconnected, 'Wallet is locked') });
    return true;
  }
  // Fast-pathed past the content whitelist pre-check (to keep the user gesture
  // alive for sidePanel.open()), so enforce connect-first here — same as signData.
  if (!WalletStore.isWhitelisted(origin)) {
    reply({ error: midnightApiError(MidnightErrorCode.Disconnected, 'Not connected — call connect() first') });
    return true;
  }
  const tabId = send.tab?.id;
  if (typeof tabId !== 'number') {
    reply({ error: midnightApiError(MidnightErrorCode.InternalError, 'No tab context for this request') });
    return true;
  }
  const validation = validateMakeTransferInputs(data as MakeTransferRequestData, currentWallet.network);
  if (!validation.ok) {
    reply({ error: midnightApiError(MidnightErrorCode.InvalidRequest, validation.reason) });
    return true;
  }
  const favIconUrl = send.tab?.favIconUrl;
  const makeTransferPayload = { data, website: origin, favIconUrl };

  const sendToPanel = () =>
    sendToMiniGero(MIDNIGHT_METHOD.makeTransfer, makeTransferPayload, tabId)
      .then((response: BackgroundResponse) => reply({ data: response.data })) // response.data === { tx }
      .catch(err => reply({
        // Never Rejected on internal/panel failure (only a real user decline
        // arrives as the panel's own Rejected) — same reasoning as signData.
        error: parseMidnightMiniGeroError(err, MidnightErrorCode.InternalError, 'Failed to build the transfer'),
      }));

  if (miniGeroPorts.has(tabId)) {
    sendToPanel();
    return true;
  }

  openSidebar(tabId, 'sidepanel/index.html')
    .then(() => waitForMiniGeroPort(5000, tabId))
    .then(() => sendToPanel())
    .catch(err => reply({
      error: midnightApiError(MidnightErrorCode.InternalError, `Failed to open the wallet's approval panel: ${getErrorMessage(err)}`),
    }));
  return true;
});

/**
 * Options-context (side-panel bundle): called by DAppOverlay.vue's Midnight
 * signData branch once the user has approved + authenticated. See
 * walletBg.signMidnightConnectorData for the midnight_signed_message: prefix
 * + BIP-340 signing logic.
 *
 * Request shape: `{ data: string, options: SignDataOptions, password?, prfSecret? }`.
 */
app.addToOptions(MessageTypes.SIGN_MIDNIGHT_CONNECTOR_DATA, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg) throw new Error('No wallet logged in');
    if (walletBg.chain !== Blockchain.MIDNIGHT) {
      throw new Error('SIGN_MIDNIGHT_CONNECTOR_DATA called on non-Midnight wallet');
    }
    const { data, options, password, prfSecret } = request.data || {};
    if (typeof data !== 'string' || !data) throw new Error('data is required');
    const encoding = options?.encoding;
    if (encoding !== 'hex' && encoding !== 'base64' && encoding !== 'text') {
      throw new Error(`Unsupported encoding: ${encoding}`);
    }
    if (options?.keyType !== 'unshielded') {
      throw new Error(`Unsupported keyType: ${options?.keyType} — only 'unshielded' is implemented`);
    }
    // Strict decode — shared with the approval popup's preview (see
    // midnightSignDataCodec.ts) so what the user is shown can never diverge
    // from what actually gets signed. Buffer.from(str,'hex'|'base64') is
    // LENIENT (silently truncates/skips invalid characters instead of
    // throwing), which would let a malicious dapp show a long deceptive
    // string while only a short, attacker-chosen prefix is actually signed.
    const { decodeSignDataPayload } = await import('@/chrome/midnightSignDataCodec');
    const dataBytes = decodeSignDataPayload(data, encoding);

    const prfBytes = prfSecret ? new Uint8Array(prfSecret) : undefined;
    const result = await walletBg.signMidnightConnectorData(new Uint8Array(dataBytes), password, prfBytes);
    sendResponse({
      id: request.id,
      data: { success: true, signature: { data: result.dataHex, signature: result.signatureHex, verifyingKey: result.verifyingKeyHex } },
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
