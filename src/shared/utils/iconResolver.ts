import { detectCIDVersion, ipfsPathFromGatewayUrl, ipfsProxyUrl } from '@/shared/utils/ipfs';

const baseUrl = import.meta.env['VITE_BACKEND_URL'];

/**
 * An https image named by token or NFT metadata, fetched through Gero's image
 * proxy (`/api/img`, gero-backend) so the issuer's server never sees the user's
 * IP next to the wallet that holds the token: anyone can mint a token pointing at
 * their own server and airdrop it. Gero's own hosts are fetched directly, and
 * without a backend URL (tests, a misconfigured build) the URL is left as is.
 */
export function proxiedImageUrl(url: string): string {
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
  return `${baseUrl}/api/img?url=${encodeURIComponent(url)}`;
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
