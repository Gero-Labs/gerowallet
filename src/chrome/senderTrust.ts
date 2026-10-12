// Background message-router trust boundary (pure, unit-tested).
//
// The router dispatches options-context messages on a `sender` STRING in the
// message body. That string is not a trust signal: the content script runs in
// every frame of every page, inside the page's renderer process, so code with
// content-script privileges (e.g. a compromised renderer) can send any body it
// likes with the extension's own sender.id. The options channel is therefore
// DEFAULT-DENY: a message is dispatched only when the REAL
// chrome.runtime.MessageSender is one of this extension's own pages, or the
// method is explicitly allowlisted for the content script below.

/**
 * Options-context methods that are especially sensitive. Since the channel is
 * default-deny these are already page-only; the list is kept as a tripwire so
 * none of them can ever be added to CONTENT_SCRIPT_OPTIONS_METHODS (asserted in
 * senderTrust.spec.ts and services/cip45/authorization.spec.ts).
 */
export const EXTENSION_PAGE_ONLY_METHODS = new Set<string>([
  'CIP45_BEGIN_SESSION',
  'CIP45_END_SESSION',
  'CIP45_VALIDATE_SESSION',
  'CIP45_INVOKE',
  'CIP45_UPDATE_SESSION',
  'SET_REMOTE_SIGNING_ENABLED',
  'SET_CROSS_DEVICE_POLICY',
  'TRUST_CROSS_DEVICE',
  'UNTRUST_CROSS_DEVICE',
  'REQUEST_CROSS_DEVICE_SIGNATURE',
  'PRODUCE_DEVICE_REGISTER_PROOF',
  'SUPPORT_CHAT_AUTH',
  // Push notifications: subscribe / register / unregister this browser and its wallets.
  'NOTIFY_SET_BROWSER_ENABLED',
  'NOTIFY_ENABLE_WALLET',
  'NOTIFY_DISABLE_WALLET',
  'NOTIFY_SET_PREFS',
  'NOTIFY_WALLET_REMOVED',
  'NOTIFY_INBOX_READ',
  'NOTIFY_INBOX_CLEAR',
  'NOTIFY_WATCH_ORDERS',
  'NOTIFY_INTRO_ANSWER',
  // Part of signing: only the wallet's own pages sign (Trezor over WebUSB, trezorDispatch.ts).
  'CIP113_SIGN_PREFLIGHT',
  // Submit API (Settings > Advanced): where the wallet sends its signed transactions, and the auth header value.
  'SET_SUBMIT_API',
  'TEST_SUBMIT_API',
  'CLEAR_SUBMIT_API',
]);

/**
 * This extension's identity as the runtime reports it: its id, and the root of
 * its own page URLs (`chrome-extension://<id>/`). The root is read from
 * `runtime.getURL('')` rather than assembled from the id, so the check follows
 * whatever the browser actually serves the pages from.
 */
export interface OwnExtension {
  id: string | undefined;
  root: string | undefined;
}

/** The running extension's identity (empty, so every check fails closed, outside an extension). */
export function ownExtension(): OwnExtension {
  const runtime = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
  let root: string | undefined;
  try { root = runtime?.getURL?.(''); } catch { root = undefined; }
  return { id: runtime?.id, root };
}

const EXTENSION_PAGE_SCHEMES = new Set(['chrome-extension:']);

/** `<scheme>://<host>/` for a well-formed extension root, else null. */
function normalizedRoot(root: string | undefined): string | null {
  if (!root) return null;
  let parsed: URL;
  try { parsed = new URL(root); } catch { return null; }
  if (!EXTENSION_PAGE_SCHEMES.has(parsed.protocol) || !parsed.host || parsed.pathname !== '/') return null;
  return `${parsed.protocol}//${parsed.host}/`;
}

/**
 * True only for a message from one of this extension's own pages (popup, options,
 * side panel, in a tab or not). The reliable distinguisher from a content script
 * is the URL: an extension page reports a URL/origin under our own extension
 * root, whereas a content script reports the http(s) page URL even though its
 * sender.id is the extension id. (sender.tab is NOT a distinguisher: an
 * extension page opened in a tab, e.g. the dashboard, also carries one.)
 *
 * `own` is passed in (`ownExtension()` at the call site) so this stays pure.
 */
export function isOwnExtensionPageSender(
  sender: chrome.runtime.MessageSender | undefined,
  own: OwnExtension,
): boolean {
  if (!sender || !own.id || sender.id !== own.id) return false;
  const root = normalizedRoot(own.root);
  if (!root) return false;
  const url = typeof sender.url === 'string' ? sender.url : '';
  const origin = typeof (sender as { origin?: string }).origin === 'string'
    ? (sender as { origin?: string }).origin as string
    : '';
  // The root ends in "/", so another extension's page or a look-alike host
  // prefix never matches.
  return url.startsWith(root) || `${origin}/` === root;
}

/**
 * The only options-context methods the content script (or anything else that is
 * not an extension page) may call. Each entry must be safe to call from a
 * hostile renderer:
 * - WC_PAIR: the user clicked a `wc:` link (content.ts); the handler only opens
 *   the pairing approval UI, it approves nothing.
 */
export const CONTENT_SCRIPT_OPTIONS_METHODS: ReadonlySet<string> = new Set<string>([
  'WC_PAIR',
]);

/** Router gate for the options channel: own extension page, or an allowlisted content-script method. */
export function isOptionsSenderAllowed(
  method: string,
  sender: chrome.runtime.MessageSender | undefined,
  own: OwnExtension,
): boolean {
  if (isOwnExtensionPageSender(sender, own)) return true;
  return CONTENT_SCRIPT_OPTIONS_METHODS.has(method) && !EXTENSION_PAGE_ONLY_METHODS.has(method);
}

/**
 * Whether an approval panel bound to `panelTabId` may settle a pending dApp
 * request issued from `requestTabId`. A tab's prompt can only be answered by
 * that tab's panel; tabless requests (NaN, e.g. WalletConnect relay events)
 * are delivered to, and may be settled by, any of our panels.
 */
export function panelMaySettleRequest(requestTabId: number, panelTabId: number): boolean {
  return Number.isNaN(requestTabId) || requestTabId === panelTabId;
}
