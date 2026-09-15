import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { poolOperatorStore } from '@/stores/poolOperatorStore';

/**
 * Resolve the auth token registered for the agent this URL belongs to.
 *
 * Matched on ORIGIN, not `startsWith`: a node saved as `https://a.example`
 * is a string prefix of `https://a.example.attacker.test`, so prefix matching
 * would hand that node's bearer token to an unrelated host. Comparing parsed
 * origins means the token only ever travels to the agent it was issued for.
 *
 * Returns undefined for an unknown origin or an agent with no token — the
 * request then goes out unauthenticated, which is what a local-only agent
 * (no `authToken` set) expects.
 */
function tokenForUrl(url: string): string | undefined {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return undefined;
  }
  const node = poolOperatorStore.nodes.find(n => {
    try {
      return new URL(n.url).origin === origin;
    } catch {
      return false;
    }
  });
  return node?.authToken || undefined;
}

interface NodeFetchResponse {
  error?: string;
  data?: { success?: boolean; error?: string; body?: unknown };
}

/**
 * Fetch from the SPO node monitor via the background service worker.
 *
 * Extension pages (options, sidepanel) are bound by CSP which blocks
 * HTTP requests to arbitrary IPs/domains. The background service worker
 * has broad host_permissions and can fetch any URL.
 *
 * This function routes the request through Chrome messaging → background → fetch.
 *
 * The agent's bearer token is looked up here rather than passed by callers:
 * there are a dozen call sites, and one that forgot to pass it would fail as an
 * opaque 401 rather than anything obviously wrong.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- agent returns arbitrary JSON; callers narrow
export async function nodeFetch(url: string, timeout = 10000): Promise<any> {
  const result = (await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SPO_NODE_FETCH,
    data: { url, timeout, authToken: tokenForUrl(url) },
  })) as NodeFetchResponse;

  // Handle Chrome runtime error format (no data wrapper)
  if (result?.error && !result?.data) {
    throw new Error(result.error);
  }

  if (!result?.data?.success) {
    throw new Error(result?.data?.error || 'Node fetch failed');
  }

  return result.data.body;
}
