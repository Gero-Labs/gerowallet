// Broadcast announcements: the content rules (pure).
//
// What every client and gero-sync apply to a document, whatever was signed. This is a port of
// gero-sync's AnnouncementRules.java: the checks run in the same fixed order and the first failure is
// the verdict, so the server, this extension and the mobile apps agree on the shared test vectors
// (__fixtures__/vectors.json). A changed verdict is a contract change: change every implementation
// and the vectors together.
//
// Lengths are UTF-16 code units (String.length), the same count Java and Swift's utf16.count give.
//
// One accepted difference from the server: Jackson refuses `1.0` where an integer is required and
// JSON.parse cannot tell it from `1`. The server refuses such a draft, so it is never published.

export type AnnouncementTier = 'editorial' | 'feed';
export type AnnouncementKind = 'service' | 'product' | 'news';
export type AnnouncementSeverity = 'info' | 'warning' | 'critical';

export interface AnnouncementContent {
  title: string;
  summary: string;
  /** Markdown; empty when the document has none. */
  body: string;
}

export interface AnnouncementMedia {
  sha256: string;
  type: string;
  bytes: number;
  w: number;
  h: number;
}

/** A document that passed {@link check}. Plain data: it is stored and sent to pages. */
export interface AnnouncementDocument {
  id: string;
  kind: AnnouncementKind;
  severity: AnnouncementSeverity;
  ts: number;
  exp: number;
  platforms: string[];
  networks: string[];
  minVersion: Record<string, string>;
  content: Record<string, AnnouncementContent>;
  thumb: string | null;
  media: AnnouncementMedia[];
  /** A route KEY the client looks up in its own fixed map, never a path it navigates to as given. */
  actionRoute: string | null;
  actionUrl: string | null;
}

export type RulesResult = { ok: true; document: AnnouncementDocument } | { ok: false; refusal: string };

export const MAX_PAYLOAD = 65_536;
export const MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
export const MAX_MEDIA_BYTES = 524_288;
export const PLATFORMS: readonly string[] = ['extension', 'ios', 'android'];
export const KINDS: readonly string[] = ['service', 'product', 'news'];
export const MEDIA_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

// Java's Pattern.matches() is a full match, so every pattern that was used with it is anchored here.
export const ANNOUNCEMENT_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;
/** The only hosts an announcement may link to: exact names, no wildcard, https only. */
export const ALLOWED_URL = /^https:\/\/(gerowallet\.io|www\.gerowallet\.io|support\.gerowallet\.io)(\/[A-Za-z0-9/_.~%?&=#-]*)?$/;
const SEVERITIES: readonly string[] = ['info', 'warning', 'critical'];
const LOCALES: readonly string[] = ['en', 'de', 'es'];
const NETWORK = /^[a-z0-9-]{1,40}$/;
const VERSION = /^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$/;
const ROUTE = /^\/[A-Za-z0-9/_-]{0,80}$/;
const MEDIA_REF = /media:([0-9a-f]{64})/g;
// Feed tier: no URL, nothing domain-like, nothing address-like in a headline. Used with find semantics.
const FEED_SCHEME = /:\/\//;
const FEED_DOMAIN = /[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
const FEED_ADDRESS = /(addr|stake|addr_test|stake_test|drep|pool|bc)1[0-9a-z]{6,}/;
const FEED_LONG_RUN = /[0-9A-Za-z]{30,}/;

const refuse = (refusal: string): RulesResult => ({ ok: false, refusal });
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const text = (o: Record<string, unknown>, field: string): string | null => (typeof o[field] === 'string' ? (o[field] as string) : null);

/** An array of at most `max` distinct strings, or null. */
function strings(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || out.includes(x)) return null;
    out.push(x);
  }
  return out;
}

/** The integer at `field` when it is within [min, max], else -1. */
function intIn(o: unknown, field: string, min: number, max: number): number {
  const v = isObject(o) ? o[field] : undefined;
  return isInt(v) && v >= min && v <= max ? v : -1;
}

export function feedTextForbidden(s: string): boolean {
  return FEED_SCHEME.test(s) || FEED_DOMAIN.test(s) || FEED_ADDRESS.test(s.toLowerCase()) || FEED_LONG_RUN.test(s);
}

export function check(payload: Uint8Array | null | undefined, tier: AnnouncementTier, now: number): RulesResult {
  if (!payload) return refuse('bad_json');
  if (payload.length > MAX_PAYLOAD) return refuse('too_large');
  let root: unknown;
  try {
    root = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
  } catch {
    return refuse('bad_json');
  }
  if (!isObject(root)) return refuse('bad_json');
  if (root['v'] !== 1) return refuse('bad_version');
  const id = text(root, 'id');
  if (id === null || !ANNOUNCEMENT_ID.test(id)) return refuse('bad_id');
  const kind = text(root, 'kind');
  if (kind === null || !KINDS.includes(kind)) return refuse('bad_kind');
  const severity = text(root, 'severity');
  if (severity === null || !SEVERITIES.includes(severity)) return refuse('bad_severity');
  const ts = root['ts'];
  const exp = root['exp'];
  if (!isInt(ts) || !isInt(exp)) return refuse('bad_time');
  if (ts <= 0 || exp <= ts) return refuse('bad_time');
  if (exp - ts > MAX_LIFETIME_MS) return refuse('lifetime_too_long');
  if (ts > now + MAX_FUTURE_MS) return refuse('ts_in_future');
  if (now > exp) return refuse('expired');

  const audience = root['audience'];
  if (!isObject(audience)) return refuse('bad_audience');
  const platforms = strings(audience['platforms'], 3);
  if (!platforms || platforms.length === 0 || !platforms.every((p) => PLATFORMS.includes(p))) return refuse('bad_audience');
  let networks: string[] = [];
  if ('networks' in audience) {
    const n = strings(audience['networks'], 10);
    if (!n || n.length === 0 || !n.every((x) => NETWORK.test(x))) return refuse('bad_audience');
    networks = n;
  }
  const minVersion: Record<string, string> = {};
  if ('minVersion' in audience) {
    const mv = audience['minVersion'];
    if (!isObject(mv)) return refuse('bad_audience');
    for (const [platform, version] of Object.entries(mv)) {
      if (!PLATFORMS.includes(platform) || typeof version !== 'string' || !VERSION.test(version)) return refuse('bad_audience');
      minVersion[platform] = version;
    }
  }

  const contentNode = root['content'];
  if (!isObject(contentNode) || !('en' in contentNode)) return refuse('bad_content');
  const content: Record<string, AnnouncementContent> = {};
  for (const [locale, l] of Object.entries(contentNode)) {
    const title = isObject(l) ? text(l, 'title') : null;
    const summary = isObject(l) ? text(l, 'summary') : null;
    if (!isObject(l) || !LOCALES.includes(locale) || title === null || summary === null || title === '' || summary === ''
      || ('body' in l && typeof l['body'] !== 'string')) {
      return refuse('bad_content');
    }
    content[locale] = { title, summary, body: typeof l['body'] === 'string' ? l['body'] : '' };
  }
  const locales = Object.values(content);
  if (locales.some((c) => c.title.length > 80)) return refuse('title_too_long');
  if (locales.some((c) => c.summary.length > 200)) return refuse('summary_too_long');
  if (locales.some((c) => c.body.length > 20_000)) return refuse('body_too_long');

  const media: AnnouncementMedia[] = [];
  if ('media' in root) {
    const arr = root['media'];
    if (!Array.isArray(arr) || arr.length > 8) return refuse('bad_media');
    for (const m of arr) {
      const sha = isObject(m) ? text(m, 'sha256') : null;
      const type = isObject(m) ? text(m, 'type') : null;
      const bytes = intIn(m, 'bytes', 1, MAX_MEDIA_BYTES);
      const w = intIn(m, 'w', 1, 4096);
      const h = intIn(m, 'h', 1, 4096);
      if (sha === null || !SHA256_HEX.test(sha) || type === null || !MEDIA_TYPES.includes(type) || bytes < 0 || w < 0 || h < 0
        || media.some((x) => x.sha256 === sha)) {
        return refuse('bad_media');
      }
      media.push({ sha256: sha, type, bytes, w, h });
    }
  }
  let thumb: string | null = null;
  if ('thumb' in root) {
    thumb = text(root, 'thumb');
    if (thumb === null || !media.some((x) => x.sha256 === thumb)) return refuse('bad_thumb');
  }
  for (const c of locales) {
    for (const ref of c.body.matchAll(MEDIA_REF)) {
      if (!media.some((x) => x.sha256 === ref[1])) return refuse('bad_media_ref');
    }
  }

  let actionRoute: string | null = null;
  let actionUrl: string | null = null;
  if ('action' in root) {
    const a = root['action'];
    if (!isObject(a) || Object.keys(a).length !== 1) return refuse('bad_action');
    actionRoute = text(a, 'route');
    actionUrl = text(a, 'url');
    const routeOk = actionRoute !== null && ROUTE.test(actionRoute);
    const urlOk = actionUrl !== null && actionUrl.length <= 300 && ALLOWED_URL.test(actionUrl);
    if (!routeOk && !urlOk) return refuse('bad_action');
  }

  if (tier === 'feed') {
    if (kind !== 'news' || severity !== 'info' || actionRoute !== null || locales.some((c) => c.body !== '')) return refuse('tier_limit');
    if (locales.some((c) => feedTextForbidden(c.title) || feedTextForbidden(c.summary))) return refuse('feed_text_not_allowed');
  }

  return {
    ok: true,
    document: {
      id, kind: kind as AnnouncementKind, severity: severity as AnnouncementSeverity, ts, exp, platforms, networks, minVersion, content,
      thumb, media, actionRoute, actionUrl,
    },
  };
}
