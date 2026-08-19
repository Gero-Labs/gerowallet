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
 * Builds the backend IPFS proxy URL for a `<cid>[/sub/path]` whose sub-path segments
 * are still in their original (possibly percent-encoded) URL form.
 *
 * Each raw segment is percent-encoded once more into the single `path` param — so a
 * literal `%` becomes `%25` — and segments are joined with `%2F`. The backend decodes
 * the query param exactly once, which restores the raw segments byte-identical, and
 * the gateway then performs the final URL decode. Never decode here: a segment whose
 * literal name contains an encoded slash (`a%2Fb.png`) must not collapse into two
 * path segments, and only double-encoding survives the backend's single decode.
 * The `%2F` join (rather than a raw `/`) is deliberate: nexus's `IpfsPathValidator`
 * rejects a raw `//` and any `http://` substring as path traversal / protocol
 * injection.
 */
export function ipfsProxyUrl(path: string): string {
  const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('%2F');
  return `${baseUrl}/api/ipfs?path=${encoded}`;
}

/**
 * Extracts `<cid>[/sub/path]` from a public IPFS gateway URL, or returns null when
 * the URL isn't one. The sub-path keeps its original percent-encoding — see
 * {@link ipfsProxyUrl} for why it must not be decoded here.
 *
 * Token metadata frequently hardcodes a gateway (`https://ipfs.io/ipfs/<cid>`,
 * `https://<cid>.ipfs.dweb.link`, Pinata, Cloudflare, …) instead of the `ipfs://`
 * scheme. Those hosts answer cross-origin requests from the extension with 403 plus
 * a `Cross-Origin-Resource-Policy` header, which Chrome blocks outright
 * (`ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`), so the image never renders. Since IPFS
 * is content-addressed, re-pointing the same CID at our own proxy returns identical
 * bytes from an origin we control.
 *
 * Deliberately left alone:
 * - URLs whose leading path segment doesn't parse as a real CID (they merely happen
 *   to contain an `/ipfs/` segment);
 * - URLs carrying a query string other than the cosmetic `?filename=` — e.g. a
 *   `?pinataGatewayToken=` on a dedicated gateway is an access credential for
 *   privately-pinned content, which our proxy cannot resolve.
 */
export function ipfsPathFromGatewayUrl(value: string): string | null {
  // Cheap pre-filters: resolveIcon calls this for EVERY icon string on every
  // render, including multi-KB base64 data: URIs — don't pay a URL parse for
  // strings that cannot be gateway URLs.
  if (!value.startsWith('http')) return null;
  if (!value.includes('/ipfs/') && !value.includes('.ipfs.')) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  for (const key of url.searchParams.keys()) {
    if (key !== 'filename') return null;
  }

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

/** Joins a CID with an optional gateway sub-path, keeping the raw segment encoding. */
function joinCidPath(cid: string, subPath: string): string {
  const segments = subPath.split('/').filter(Boolean);
  return segments.length ? `${cid}/${segments.join('/')}` : cid;
}
