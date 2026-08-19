import { CID } from 'multiformats/cid';

const baseUrl = import.meta.env['VITE_BACKEND_URL'];

/**
 * Returns the CID version (0, 1) for a valid content identifier, or null when the
 * string isn't a CID at all.
 */
export function detectCIDVersion(cidStr: string): number | null {
  try {
    return CID.parse(cidStr).version;
  } catch {
    return null;
  }
}

/**
 * Builds the backend IPFS proxy URL for an already-normalized `<cid>[/sub/path]`.
 *
 * The sub-path is percent-encoded into the single `path` param on purpose: the
 * proxies reject a raw `//` and any `http://` substring as path traversal /
 * protocol injection (nexus `IpfsPathValidator`), and gero-backend explicitly
 * decodes `%2F` back to `/` before hitting the gateway.
 */
export function ipfsProxyUrl(path: string): string {
  return `${baseUrl}/api/ipfs?path=${encodeURIComponent(path)}`;
}

/** Joins a CID with an optional gateway sub-path, decoded so callers can re-encode once. */
function joinCidPath(cid: string, subPath: string): string {
  const rest = subPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!rest) return cid;
  try {
    return `${cid}/${decodeURIComponent(rest)}`;
  } catch {
    return `${cid}/${rest}`;
  }
}

/**
 * Extracts `<cid>[/sub/path]` from a public IPFS gateway URL, or returns null when
 * the URL isn't one.
 *
 * Token metadata frequently hardcodes a gateway (`https://ipfs.io/ipfs/<cid>`,
 * `https://<cid>.ipfs.dweb.link`, Pinata, Cloudflare, …) instead of the `ipfs://`
 * scheme. Those hosts answer cross-origin requests from the extension with 403 plus
 * a `Cross-Origin-Resource-Policy` header, which Chrome blocks outright
 * (`ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`), so the image never renders. Since IPFS
 * is content-addressed, re-pointing the same CID at our own proxy returns identical
 * bytes from an origin we control.
 *
 * The leading path segment must parse as a real CID, so URLs that merely happen to
 * contain an `/ipfs/` segment are left alone.
 */
export function ipfsPathFromGatewayUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  // Subdomain gateways: https://<cid>.ipfs.<host>/<sub/path>
  const subdomainCid = url.hostname.match(/^([^.]+)\.ipfs\..+$/)?.[1];
  if (subdomainCid && detectCIDVersion(subdomainCid) !== null) {
    return joinCidPath(subdomainCid, url.pathname);
  }

  // Path gateways: https://<host>/ipfs/<cid>/<sub/path>
  const pathMatch = url.pathname.match(/^\/ipfs\/([^/]+)(\/.*)?$/);
  if (pathMatch && detectCIDVersion(pathMatch[1]) !== null) {
    return joinCidPath(pathMatch[1], pathMatch[2] ?? '');
  }

  return null;
}
