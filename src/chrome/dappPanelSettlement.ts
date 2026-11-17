import { approvalNamesActiveAccount } from '@/chrome/connectApproval';
import { isOwnExtensionPageSender, panelMaySettleRequest, type OwnExtension } from '@/chrome/senderTrust';

/** A dApp request waiting in the worker for the side panel's answer. */
export interface PanelPendingEntry {
  resolve: (response: { data?: unknown; error?: unknown }) => void;
  /** The requesting tab; NaN for a tabless request (WalletConnect), which any panel may answer. */
  tabId: number;
  method: string;
  /** The wallet the request was issued against (a wallet record id). */
  walletId?: unknown;
  /** Kept so the request can be re-delivered when a panel (re)connects. */
  payload?: unknown;
}

/** What a side-panel port sends back for a request. */
export interface PanelMessage {
  requestId?: unknown;
  type?: unknown;
  data?: unknown;
  error?: unknown;
}

/**
 * Settles a pending dApp request from a side-panel port message, at most once:
 * the entry leaves `pending` when it is answered, so a second answer, an answer
 * after a worker restart (the restarted worker never issued that id) or an
 * answer from another tab's panel settles nothing. An approval made after the
 * active wallet changed is answered `wallet_changed_during_request`, unless it
 * is a connect approval naming the now-active account. Returns whether an entry
 * was settled.
 */
export function settlePanelMessage(
  pending: Map<string, PanelPendingEntry>,
  message: PanelMessage | null | undefined,
  panelTabId: number,
  activeWalletId: unknown,
): boolean {
  const requestId = message?.requestId;
  if (!message || typeof requestId !== 'string' || !requestId) return false;
  const entry = pending.get(requestId);
  if (!entry) return false;
  // A panel may only settle requests delivered to it: its own tab's, or
  // tabless ones (which go to any panel). Never another tab's prompt.
  if (!panelMaySettleRequest(entry.tabId, panelTabId)) return false;
  if (message.type === 'dapp-response') {
    if (entry.walletId && message.error == null && activeWalletId !== entry.walletId
      && !approvalNamesActiveAccount(entry.method, message, activeWalletId)) {
      entry.resolve({ error: 'wallet_changed_during_request' });
    } else {
      entry.resolve(message);
    }
  } else if (message.type === 'dapp-nack') {
    entry.resolve({ error: String(message.error || 'unsupported_method') });
  } else {
    return false;
  }
  pending.delete(requestId);
  return true;
}

/** Side-panel dApp ports are named `mini-gero-dapp-channel` or `mini-gero-dapp-channel:<tabId>`. */
export const PANEL_PORT_PREFIX = 'mini-gero-dapp-channel';

/**
 * The key a side-panel dApp port registers under, or null when the port is not
 * one (another port name) or is refused. Only our own extension pages may
 * register an approval surface: a content script has the same sender.id, so a
 * forged port could otherwise replace the real panel, read pending payloads and
 * approve; it is disconnected. A panel opened without a tab context (manually or
 * pinned) connects with an empty tab id and gets a synthetic negative key from
 * `syntheticKey`, so tab-agnostic routing still finds it.
 */
export function admitPanelPort(port: chrome.runtime.Port, own: OwnExtension, syntheticKey: () => number): number | null {
  if (!port.name.startsWith(PANEL_PORT_PREFIX)) return null;
  if (!isOwnExtensionPageSender(port.sender, own)) {
    console.warn('[DApp] rejected foreign mini-gero port from', port.sender?.id);
    try { port.disconnect(); } catch { /* already disconnected */ }
    return null;
  }
  const parts = port.name.split(':');
  const parsed = parts.length > 1 ? parseInt(parts[1], 10) : NaN;
  return Number.isNaN(parsed) ? syntheticKey() : parsed;
}

/**
 * Sends a connecting panel every request parked for its tab (and every tabless
 * one), then the ids this worker still holds (`dapp-live`), so the panel drops
 * a prompt that died with a previous worker. A port that dies mid-way is left
 * alone: the next connect sends everything again.
 */
export function redeliverParkedRequests(pending: Map<string, PanelPendingEntry>, tabId: number, port: chrome.runtime.Port): void {
  const requestIds: string[] = [];
  for (const [requestId, entry] of pending.entries()) {
    // OX Agent: [javascript-authorization-security] A panel gets only its own tab's requests and tabless ones, never another tab's prompt
    if (entry.tabId !== tabId && !Number.isNaN(entry.tabId)) continue;
    requestIds.push(requestId);
    try {
      port.postMessage({ type: 'dapp-request', method: entry.method, requestId, payload: entry.payload });
    } catch {
      return;
    }
  }
  try {
    port.postMessage({ type: 'dapp-live', requestIds });
  } catch {
    // Port died; the next connect sends it again.
  }
}

export interface PanelChannel {
  /** The connected panel port of each tab key. */
  ports: Map<number, chrome.runtime.Port>;
  pending: Map<string, PanelPendingEntry>;
  /** The logged wallet's id now, for the wallet-switch guard. */
  activeWalletId: () => unknown;
  /** Called after an answer settled a request (the badge count changed). */
  onSettled: () => void;
}

/**
 * Wires an admitted panel port: it replaces the tab's previous port, settles
 * answers through `settlePanelMessage`, and gets everything parked for it.
 * Closing the panel PARKS its requests instead of answering them: locking the
 * panel, switching tabs or closing it must not answer a dApp on the user's
 * behalf, so the entries stay in `pending` until a panel reconnects and the
 * user approves or rejects, or the panel NACKs.
 */
export function attachPanelPort(channel: PanelChannel, port: chrome.runtime.Port, tabId: number): void {
  const previous = channel.ports.get(tabId);
  if (previous) {
    try { previous.disconnect(); } catch { /* already disconnected */ }
  }
  channel.ports.set(tabId, port);
  port.onMessage.addListener((message) => {
    if (settlePanelMessage(channel.pending, message, tabId, channel.activeWalletId())) channel.onSettled();
  });
  port.onDisconnect.addListener(() => {
    if (channel.ports.get(tabId) === port) channel.ports.delete(tabId);
  });
  redeliverParkedRequests(channel.pending, tabId, port);
}
