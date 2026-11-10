// Broadcast announcements: fetching the public feed and its images (background only).
//
// The feed is an unauthenticated GET that is the same for everyone: the request names the platform
// and nothing else. No wallet id, no device id, no cookies. Nothing fetched here is trusted: every
// envelope is verified by announcementVerify before it is kept, and an image is kept only when its
// bytes hash to the SHA-256 the signed document names and are a real PNG, JPEG or WebP.
//
// Every failure is an answer, never a throw: a bad or unreachable feed must not disturb the worker.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@/services/notify/notifyAuth';
import { MAX_MEDIA_BYTES, MEDIA_TYPES, SHA256_HEX } from './announcementRules';

export const DEFAULT_ANNOUNCEMENTS_API_URL = 'https://sync.gerowallet.io/api/announcements/v1';
/** More than the server ever serves (20): a feed this long is not ours. */
export const MAX_FEED_ITEMS = 50;
/** 50 envelopes of 64 KiB in base64, with room: a body past this is dropped unread. */
export const MAX_FEED_BYTES = 6 * 1024 * 1024;

export interface FeedDeps {
  baseUrl: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

export type FeedResult =
  | { status: 'ok'; seq: number; etag: string | null; envelopes: unknown[] }
  | { status: 'unchanged' }
  | { status: 'failed'; reason: string };

export interface FetchedMedia {
  type: string;
  bytes: Uint8Array;
}

export interface AnnouncementFeed {
  fetchFeed(etag: string | null): Promise<FeedResult>;
  /** The image, only when its bytes hash to `sha256`, are of `expectedType` by their magic bytes, and are not oversized. */
  fetchMedia(sha256Hex: string, expectedType: string): Promise<FetchedMedia | null>;
}

/** PNG, JPEG or WebP by the first bytes, else null. SVG and everything else is refused. */
export function sniffImageType(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export function createAnnouncementFeed(deps: FeedDeps): AnnouncementFeed {
  const baseUrl = deps.baseUrl.replace(/\/+$/, '');
  const timeoutMs = deps.timeoutMs ?? 8_000;

  /** One GET with a hard deadline that also covers reading the body. Null on any failure. */
  async function get(url: string, headers: Record<string, string>, maxBytes: number): Promise<{ status: number; etag: string | null; body: Uint8Array } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await deps.fetch(url, {
        method: 'GET', headers, signal: controller.signal,
        credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      });
      const etag = res.headers.get('etag');
      if (res.status !== 200) return { status: res.status, etag, body: new Uint8Array(0) };
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > maxBytes) return null;
      const body = new Uint8Array(await res.arrayBuffer());
      if (body.length > maxBytes) return null;
      return { status: 200, etag, body };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async fetchFeed(etag) {
      const res = await get(`${baseUrl}/feed?platform=extension`, etag ? { 'If-None-Match': etag } : {}, MAX_FEED_BYTES);
      if (!res) return { status: 'failed', reason: 'network' };
      if (res.status === 304) return { status: 'unchanged' };
      if (res.status !== 200) return { status: 'failed', reason: `http_${res.status}` };
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(res.body));
      } catch {
        return { status: 'failed', reason: 'not_json' };
      }
      const feed = parsed as { seq?: unknown; items?: unknown } | null;
      if (!feed || typeof feed !== 'object' || !Array.isArray(feed.items) || feed.items.length > MAX_FEED_ITEMS
        || typeof feed.seq !== 'number' || !Number.isSafeInteger(feed.seq) || feed.seq < 0) {
        return { status: 'failed', reason: 'bad_shape' };
      }
      return { status: 'ok', seq: feed.seq, etag: res.etag, envelopes: feed.items };
    },

    async fetchMedia(sha256Hex, expectedType) {
      if (!SHA256_HEX.test(sha256Hex) || !MEDIA_TYPES.includes(expectedType)) return null;
      const res = await get(`${baseUrl}/media/${sha256Hex}`, {}, MAX_MEDIA_BYTES);
      if (!res || res.status !== 200 || res.body.length === 0) return null;
      if (bytesToHex(sha256(res.body)) !== sha256Hex) return null;
      // The type is what the bytes are, never what the server says: a header is not signed.
      const type = sniffImageType(res.body);
      if (type === null || type !== expectedType) return null;
      return { type, bytes: res.body };
    },
  };
}
