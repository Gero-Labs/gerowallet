import { detectCIDVersion, ipfsPathFromGatewayUrl, ipfsProxyUrl } from '@/shared/utils/ipfs';

const baseUrl = import.meta.env['VITE_BACKEND_URL'];

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
 * hosts 403 cross-origin extension requests), plain http/data passthrough,
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

  if (icon.startsWith('http') || icon.startsWith('data:')) {
    return icon;
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
