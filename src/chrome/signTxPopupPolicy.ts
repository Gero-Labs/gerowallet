/**
 * What to do with already-open signTx popup windows when a new signTx request
 * arrives on the popup path.
 *
 * A pending prompt belongs to the origin that opened it. Another origin must
 * never close it and put its own prompt in the same place, because the user
 * may be about to click Sign on what they believe is the first dApp's
 * transaction. The same origin may supersede its own pending prompt (a dApp
 * that re-requests replaces its earlier request).
 */

/** The `website` query value of a `index.html#/<route>?website=...` popup URL, or null. */
export function popupWebsite(url: string | undefined, route: string): string | null {
  if (!url) return null;
  const hash = url.indexOf('#');
  if (hash < 0) return null;
  const fragment = url.slice(hash + 1); // "/signTx?website=..."
  const [path, query = ''] = fragment.split('?');
  if (path !== `/${route}`) return null;
  return new URLSearchParams(query).get('website');
}

export type SignTxPopupDecision =
  | { action: 'open'; closeTabUrls: string[] }
  | { action: 'busy' };

/**
 * @param openPopupTabUrls URLs of tabs in open popup windows.
 * @param origin           origin of the new request.
 */
export function decideSignTxPopup(openPopupTabUrls: Array<string | undefined>, origin: string, route: string): SignTxPopupDecision {
  const pending = openPopupTabUrls
    .map(url => ({ url, website: popupWebsite(url, route) }))
    .filter((p): p is { url: string; website: string } => typeof p.url === 'string' && p.website !== null);
  if (pending.some(p => p.website !== origin)) return { action: 'busy' };
  return { action: 'open', closeTabUrls: pending.map(p => p.url) };
}
