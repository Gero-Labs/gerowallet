import { detectCIDVersion, ipfsPathFromGatewayUrl, ipfsProxyUrl } from '@/shared/utils/ipfs';

const baseUrl = import.meta.env['VITE_BACKEND_URL'];

/**
 * An https URL through one of gero-backend's proxies (`route`). Gero's own hosts
 * are fetched directly, and without a backend URL (tests, a misconfigured build)
 * the URL is left as is.
 */
function viaBackendProxy(route: string, url: string): string {
  if (!baseUrl) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== 'https:') return url;
  const host = parsed.hostname.toLowerCase();
  let backendHost = '';
  try { backendHost = new URL(baseUrl).hostname.toLowerCase(); } catch { /* compare by brand only */ }
  if (host === backendHost || host === 'gerowallet.io' || host.endsWith('.gerowallet.io')) return url;
  return `${baseUrl}${route}?url=${encodeURIComponent(url)}`;
}

/**
 * An https image named by token or NFT metadata, fetched through Gero's image
 * proxy (`/api/img`, gero-backend) so the issuer's server never sees the user's
 * IP next to the wallet that holds the token: anyone can mint a token pointing at
 * their own server and airdrop it.
 */
export function proxiedImageUrl(url: string): string {
  return viaBackendProxy('/api/img', url);
}

/**
 * A governance anchor document (a CIP-136 vote rationale) at an https URL,
 * fetched through gero-backend's `/api/anchor` proxy so the author's host never
 * sees who reads it. The proxy relays the bytes unchanged: the anchor's on-chain
 * hash is over them.
 */
export function proxiedAnchorUrl(url: string): string {
  return viaBackendProxy('/api/anchor', url);
}

/**
 * An image a third party published for something the wallet shows (a stake
 * pool's icon from its extended metadata, a DRep's CIP-119 avatar), as the page
 * may load it: IPFS through the IPFS proxy, https through the image proxy
 * (proxiedImageUrl), so the host never sees the user's IP next to the pool or
 * DRep they are looking at. Null for anything else, plain http included.
 */
export function thirdPartyImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  const gatewayPath = ipfsPathFromGatewayUrl(value);
  if (gatewayPath) return ipfsProxyUrl(gatewayPath);
  const ipfs = /^ipfs:\/\/(?:ipfs\/)?(.+)$/i.exec(value);
  if (ipfs) return detectCIDVersion(ipfs[1].split('/')[0]) != null ? ipfsProxyUrl(ipfs[1]) : null;
  if (!/^https:\/\/\S+$/i.test(value)) return null;
  return proxiedImageUrl(value);
}

/**
 * Placeholder images the icon resolver falls back to for color keywords and
 * unrecognized input. Injected by the caller because the two call sites source
 * them differently: `utils/assets.ts` uses its static imports directly, while
 * `shared/utils/resolver.ts` is also bundled into the background service worker
 * and substitutes empty strings there.
 */
export interface IconPlaceholders {
  greenSvg: string;
  yellowSvg: string;
  purpleSvg: string;
  pinkSvg: string;
  orangeSvg: string;
  blueSvg: string;
  greySvg: string;
  errorImage: string;
}

/**
 * The single icon-source resolver behind both `resolveIcon` entry points
 * (`shared/utils/resolver.ts` and `utils/assets.ts`), which historically were
 * two byte-identical copies that had to be patched in lockstep.
 *
 * Handles, in order: public IPFS gateway URLs (re-pointed at our proxy — those
 * hosts 403 cross-origin extension requests), data passthrough, https images
 * through the image proxy (proxiedImageUrl),
 * ar:// and ipfs:// schemes, bare CIDs, wallet color keywords, and raw base64
 * image blobs sniffed by their first character.
 */
export function resolveIconUrl(icon: string, placeholders: IconPlaceholders): string {
  if (!icon) {
    return placeholders.errorImage;
  }

  const gatewayPath = ipfsPathFromGatewayUrl(icon);
  if (gatewayPath) {
    return ipfsProxyUrl(gatewayPath);
  }

  if (icon.startsWith('data:')) {
    return icon;
  } else if (icon.startsWith('http')) {
    return proxiedImageUrl(icon);
  } else if (icon.startsWith('ar://') || icon.startsWith('ar/')) {
    return `${baseUrl}/api/ar/${icon.replace('ar://', '').replace('ar/', '')}`
  } else if (icon.startsWith('ipfs://') || icon.startsWith('ipfs/')) {
    return ipfsProxyUrl(icon.replace('ipfs://', '').replace('ipfs/', ''));
  } else if (detectCIDVersion(icon) != null) {
    return ipfsProxyUrl(icon);
  }

  switch (icon) {
    case 'green':
    case 'teal':
      return placeholders.greenSvg;
    case 'yellow':
      return placeholders.yellowSvg;
    case 'purple':
    case 'deep-purple':
      return placeholders.purpleSvg;
    case 'pink':
      return placeholders.pinkSvg;
    case 'orange':
    case 'chocolate':
      return placeholders.orangeSvg;
    case 'blue':
    case 'cyan':
      return placeholders.blueSvg;
    case 'grey':
      return placeholders.greySvg;
  }

  const firstChar = icon.charAt(0);
  let mimeType: string | null = null;

  switch (firstChar) {
    case '/':
      mimeType = 'image/jpeg';
      break;
    case 'i':
      mimeType = 'image/png';
      break;
    case 'R':
      mimeType = 'image/gif';
      break;
    case 'U':
      mimeType = 'image/webp';
      break;
    default:
      return placeholders.errorImage;
  }

  return `data:${mimeType};base64,${icon}`;
}
