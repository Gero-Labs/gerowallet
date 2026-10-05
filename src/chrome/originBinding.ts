/**
 * The content relay writes `request.origin = window.origin` into the message
 * body. That runs inside the page's renderer process, so the body is not proof
 * of who sent it. Chrome also reports the sending frame's origin in the real
 * MessageSender (`sender.origin`, or the frame URL), which a page cannot set.
 */

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * True unless the message claims an origin that differs from the browser-
 * reported origin of the frame that sent it. Messages without a claimed origin
 * pass here: every handler that grants anything re-checks the origin against
 * the whitelist, which an absent origin never satisfies.
 */
export function claimedOriginMatchesSender(
  claimedOrigin: unknown,
  sender: chrome.runtime.MessageSender | undefined,
): boolean {
  if (claimedOrigin === undefined || claimedOrigin === null) return true;
  const reported = (sender as { origin?: string } | undefined)?.origin ?? originOf(sender?.url);
  if (reported === undefined) return true; // nothing to compare against (old Chrome)
  return claimedOrigin === reported;
}

/**
 * For a request sent from an embedded frame, the top-level site that embeds it
 * (when that is a different origin), so the prompt can say so. Undefined for a
 * top-level frame or a same-origin embed.
 */
export function embeddingSite(
  requestOrigin: string | undefined,
  sender: chrome.runtime.MessageSender | undefined,
): string | undefined {
  if (!sender || !sender.frameId) return undefined; // frameId 0 = top-level frame
  const top = originOf(sender.tab?.url);
  if (!top || top === 'null' || top === requestOrigin) return undefined;
  return top;
}
