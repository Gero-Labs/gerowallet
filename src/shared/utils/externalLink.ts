/**
 * Safe handling of externally-supplied links.
 *
 * DRep / governance metadata anchors are off-chain JSON authored by whoever
 * registered the DRep, so every `uri` in them is attacker-controlled. Two things
 * follow from that:
 *
 *  1. A raw `:href="link.uri"` binding lets the author choose the scheme.
 *     Extension-page CSP currently blocks `javascript:`, but the safety of the
 *     link must not depend on the CSP staying exactly as it is — parse the URL
 *     and allow only http/https.
 *  2. Deciding a brand icon with `uri.includes('github.com')` matches on any
 *     part of the string, so `https://evil.example/?github.com` renders the
 *     GitHub icon — the icon then vouches for a site it has nothing to do with.
 *     Match on the parsed `hostname` instead.
 */

/** Schemes that may ever reach an `href`. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

/** Parse an untrusted value into a URL, or `undefined` if it is not a safe web link. */
export function parseSafeUrl(raw: unknown): URL | undefined {
  if (typeof raw !== 'string') return undefined;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  return SAFE_PROTOCOLS.has(url.protocol) ? url : undefined;
}

/** Normalized href for an untrusted link, or `undefined` when it must not be rendered. */
export function safeExternalHref(raw: unknown): string | undefined {
  return parseSafeUrl(raw)?.href;
}

export type SocialBrand = 'x' | 'telegram' | 'github' | 'youtube' | 'linkedin' | 'instagram' | 'discord';

/** Registrable domains per brand. A host matches a domain exactly, or as a subdomain of it. */
const BRAND_DOMAINS: ReadonlyArray<readonly [SocialBrand, readonly string[]]> = [
  ['x', ['x.com', 'twitter.com']],
  ['telegram', ['t.me']],
  ['github', ['github.com']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['linkedin', ['linkedin.com']],
  ['instagram', ['instagram.com']],
  ['discord', ['discord.com']],
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Brand a safe link belongs to, or `undefined` for an unrecognized (or unsafe) link. */
export function socialBrandOf(raw: unknown): SocialBrand | undefined {
  const url = parseSafeUrl(raw);
  if (!url) return undefined;
  const host = url.hostname.toLowerCase();
  return BRAND_DOMAINS.find(([, domains]) => domains.some(domain => hostMatches(host, domain)))?.[0];
}

const BRAND_ICONS: Partial<Record<SocialBrand, string>> = {
  github: 'mdi-github',
  youtube: 'mdi-youtube',
  linkedin: 'mdi-linkedin',
  instagram: 'mdi-instagram',
  discord: 'mdi-discord',
};

/** MDI icon for an untrusted link. Falls back to a generic link glyph. */
export function iconForUrl(raw: unknown): string {
  const brand = socialBrandOf(raw);
  return (brand && BRAND_ICONS[brand]) || 'mdi-link';
}

export interface SafeLink {
  /** Normalized, scheme-checked href — safe to bind. */
  href: string;
  brand?: SocialBrand;
  icon: string;
}

/**
 * Map a metadata `links` array to renderable links, dropping every entry that is
 * not a safe http(s) URL. Resolves each link once so templates can bind directly.
 */
export function toSafeLinks(links: unknown): SafeLink[] {
  if (!Array.isArray(links)) return [];
  return links.reduce<SafeLink[]>((acc, link) => {
    const raw = (link as { uri?: unknown } | null)?.uri;
    const url = parseSafeUrl(raw);
    if (!url) return acc;
    const brand = socialBrandOf(raw);
    acc.push({ href: url.href, brand, icon: (brand && BRAND_ICONS[brand]) || 'mdi-link' });
    return acc;
  }, []);
}
