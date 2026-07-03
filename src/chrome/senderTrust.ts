// Background message-router trust boundary (pure, unit-tested).
//
// The router dispatches options-context messages on a `sender` STRING in the
// message body. For sensitive handlers we additionally require the REAL
// chrome.runtime.MessageSender to be one of this extension's own pages, so a
// content script that forged `sender:'options'` cannot reach them.

/**
 * Sensitive options-context methods that must originate from an own extension
 * page (the wallet UI), never a content script. Scoped to the cross-device
 * settings/signing mutators to keep the router-level check's blast radius small.
 */
export const EXTENSION_PAGE_ONLY_METHODS = new Set<string>([
  'SET_REMOTE_SIGNING_ENABLED',
  'SET_CROSS_DEVICE_POLICY',
  'TRUST_CROSS_DEVICE',
  'UNTRUST_CROSS_DEVICE',
  'REQUEST_CROSS_DEVICE_SIGNATURE',
]);

/**
 * True only for a message from one of this extension's own pages (popup, options,
 * side panel, in a tab or not). The reliable distinguisher from a content script
 * is the URL scheme: an extension page reports a chrome-extension:// URL/origin,
 * whereas a content script reports the http(s) page URL even though its
 * sender.id is the extension id. (sender.tab is NOT a distinguisher — an
 * extension page opened in a tab, e.g. the dashboard, also carries one.)
 *
 * `ownId` is passed in (chrome.runtime.id at the call site) so this stays pure.
 */
export function isOwnExtensionPageSender(
  sender: chrome.runtime.MessageSender | undefined,
  ownId: string | undefined,
): boolean {
  if (!sender || !ownId || sender.id !== ownId) return false;
  const url = typeof sender.url === 'string' ? sender.url : '';
  const origin = typeof (sender as { origin?: string }).origin === 'string'
    ? (sender as { origin?: string }).origin as string
    : '';
  return url.startsWith('chrome-extension://') || origin.startsWith('chrome-extension://');
}
