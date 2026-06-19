import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

/**
 * Fetch from the SPO node monitor via the background service worker.
 *
 * Extension pages (options, sidepanel) are bound by CSP which blocks
 * HTTP requests to arbitrary IPs/domains. The background service worker
 * has broad host_permissions and can fetch any URL.
 *
 * This function routes the request through Chrome messaging → background → fetch.
 */
export async function nodeFetch(url: string, timeout = 10000): Promise<any> {
  const result = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SPO_NODE_FETCH,
    data: { url, timeout },
  }) as any;

  // Handle Chrome runtime error format (no data wrapper)
  if (result?.error && !result?.data) {
    throw new Error(result.error);
  }

  if (!result?.data?.success) {
    throw new Error(result?.data?.error || 'Node fetch failed');
  }

  return result.data.body;
}
