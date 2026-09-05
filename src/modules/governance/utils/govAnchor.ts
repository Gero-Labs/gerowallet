/**
 * Off-chain governance assets: DRep avatars and CIP-136 rationale documents.
 *
 * Both are author-hosted, so both arrive as a URI the wallet did not choose, and
 * roughly a quarter of them are `ipfs://`. Two DIFFERENT URLs come out of the
 * same input here, and conflating them is the bug this module exists to prevent:
 *
 *  - {@link toInAppUrl} is what the extension page itself loads (an `<img>` src,
 *    a `fetch`). An `ipfs://` URI cannot be one, and neither can a public
 *    gateway URL: `ipfs.io`, Pinata and Cloudflare answer cross-origin extension
 *    requests with 403 plus `Cross-Origin-Resource-Policy`, which Chrome blocks
 *    outright (see `shared/utils/ipfs.ts`). That is precisely why so many DRep
 *    avatars render blank today. IPFS is content-addressed, so the same CID
 *    through gero-backend's own `/api/ipfs` proxy returns identical bytes from
 *    an origin the extension is allowed to talk to — and the user's IP never
 *    reaches the gateway.
 *  - {@link toExternalHref} is what a NEW BROWSER TAB opens. No extension CSP
 *    applies there, so an `ipfs://` CID becomes an ordinary public gateway link.
 *
 * Everything is scheme-checked. `javascript:`, `data:` and every other scheme
 * resolve to null rather than being handed to an `<img>` or an `href`.
 */

import { detectCIDVersion, ipfsPathFromGatewayUrl, ipfsProxyUrl } from '@/shared/utils/ipfs';
import { safeExternalHref } from '@/shared/utils/externalLink';

/**
 * The public gateway an `ipfs://` link is opened through OUTSIDE the extension.
 * Only ever used to build an href for a new tab — never as a fetch target.
 */
export const PUBLIC_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * `<cid>[/sub/path]` for anything that names IPFS content, or null.
 *
 * Deliberately tolerant about how the CID is spelled — `ipfs://cid`,
 * `ipfs://ipfs/cid`, `ipfs/cid`, a bare CID, or any of the public gateway
 * spellings — and strict about what counts: the leading segment must PARSE as a
 * real CID. Without that check `https://example.test/ipfs/logo.png` would be
 * re-pointed at the IPFS proxy, which cannot resolve it.
 *
 * Sub-path segments keep their original percent-encoding; `ipfsProxyUrl` needs
 * them that way (see its own doc for why decoding here would corrupt a name
 * containing an encoded slash).
 */
export function ipfsPathOf(raw: unknown): string | null {
  const value = text(raw);
  if (!value) return null;

  const fromGateway = ipfsPathFromGatewayUrl(value);
  if (fromGateway) return fromGateway;

  const withoutScheme = value.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '');
  const segments = withoutScheme.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (detectCIDVersion(segments[0]) === null) return null;
  return segments.join('/');
}

/**
 * A URL the extension page may load itself, or null when there is nothing safe
 * to load. IPFS goes through the backend proxy; http(s) passes through the
 * shared scheme guard unchanged.
 */
export function toInAppUrl(raw: unknown): string | null {
  const path = ipfsPathOf(raw);
  if (path) return ipfsProxyUrl(path);
  return safeExternalHref(raw) ?? null;
}

/**
 * The avatar URI a DRep published, kept in the form they wrote it.
 *
 * The single source for every DRep face in the app. It deliberately does NOT
 * resolve the URI: `DRepAvatar` runs it through `toInAppUrl`, and it must stay
 * the only place that maps one.
 *
 * The bug this replaced: the directory and the profile both read the avatar
 * through `drepImageUrl()`, which resolved via `safeExternalHref` — http(s)
 * ONLY. About half of mainnet's avatars are `ipfs://`, so those were discarded
 * before `DRepAvatar` ever saw them, and a DRep who had published a picture
 * rendered as one who had not. Nothing errored; the face was simply absent.
 *
 * The value is still scheme-checked, by the SAME mapping the avatar will use: a
 * URI `toInAppUrl` cannot turn into something loadable is not returned at all.
 */
export function drepImageSource(record: unknown): string | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const meta = (record as { metadata?: { meta_json?: { body?: Record<string, unknown> | null } | null } | null })
    .metadata;
  const image = meta?.meta_json?.body?.['image'];
  if (!image || typeof image !== 'object') return undefined;
  const raw = (image as Record<string, unknown>)['contentUrl'];
  if (typeof raw !== 'string') return undefined;
  const uri = raw.trim();
  return uri && toInAppUrl(uri) ? uri : undefined;
}

/**
 * A URL to hand the browser in a new tab, or null. IPFS becomes a public
 * gateway link — the one place that is the right answer, because the tab is not
 * the extension origin and nothing about the wallet is attached to the request.
 */
export function toExternalHref(raw: unknown): string | null {
  const path = ipfsPathOf(raw);
  if (path) return `${PUBLIC_IPFS_GATEWAY}${path}`;
  return safeExternalHref(raw) ?? null;
}

/**
 * The payout address a DRep published under CIP-119, or null.
 *
 * `DelegatedDRepRecord.metadata` is typed `unknown` — it is upstream JSON-LD
 * and nothing validates its shape — so it has to be walked, not dotted into.
 * MyGovernance read `record.metadata?.meta_json?.body?.paymentAddress` straight
 * through, which TypeScript rejects on `unknown` regardless of strictness. It
 * survived review only because `tsc --noEmit` does not read `.vue` files and
 * `vue-tsc` is not in CI, so neither gate ever saw it.
 *
 * The prefix test is deliberate and is NOT `isPaymentAddress`: that helper is
 * `Cardano.Address.isValid`, which accepts a STAKE address, and a stake address
 * cannot receive a payout. What a supporter needs is somewhere the money can
 * actually land, so only `addr1…` / `addr_test1…` qualify.
 */
export function drepPayoutAddress(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const meta = (record as { metadata?: { meta_json?: { body?: Record<string, unknown> | null } | null } | null })
    .metadata;
  const raw = meta?.meta_json?.body?.['paymentAddress'];
  if (typeof raw !== 'string') return null;
  const address = raw.trim();
  return address.startsWith('addr1') || address.startsWith('addr_test1') ? address : null;
}
