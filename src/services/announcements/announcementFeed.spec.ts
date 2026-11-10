import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@/services/notify/notifyAuth';
import { createAnnouncementFeed, MAX_FEED_BYTES, MAX_FEED_ITEMS, sniffImageType } from './announcementFeed';
import { MAX_MEDIA_BYTES } from './announcementRules';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_SHA = bytesToHex(sha256(PNG));

function response(status: number, body: Uint8Array | string = '', headers: Record<string, string> = {}): Response {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: new Blob([bytes as BlobPart]).stream(),
    arrayBuffer: async () => { throw new Error('the body must be read as a stream, never buffered whole'); },
  } as unknown as Response;
}

/** A body that would never end: `chunk` again and again, counting how much was actually pulled. */
function endless(chunk: Uint8Array): { response: Response; pulled: () => number; cancelled: () => boolean } {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { pulled += chunk.length; controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  return { response: { status: 200, headers: { get: () => null }, body } as unknown as Response, pulled: () => pulled, cancelled: () => cancelled };
}

function feedWith(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, timeoutMs?: number) {
  const fetch = vi.fn(fetchImpl);
  return { fetch, feed: createAnnouncementFeed({ baseUrl: 'https://sync.example/api/announcements/v1/', fetch, ...(timeoutMs ? { timeoutMs } : {}) }) };
}

describe('announcement feed', () => {
  it('asks for the platform and nothing that identifies the user', async () => {
    const { fetch, feed } = feedWith(async () => response(200, '{"seq":3,"items":[{"payload":"a"}]}', { etag: 'W/"3.1"' }));
    const r = await feed.fetchFeed();
    expect(r).toEqual({ status: 'ok', seq: 3, envelopes: [{ payload: 'a' }] });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://sync.example/api/announcements/v1/feed?platform=extension');
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers: {} });
  });

  it('never sends back a value the server chose', async () => {
    // An ETag is picked by the server and replayed by the client: a per-client token. The feed is
    // read without conditions, so a 304 is not something this client can have asked for.
    const { fetch, feed } = feedWith(async () => response(200, '{"seq":3,"items":[]}', { etag: 'W/"unique-to-this-client"' }));
    await feed.fetchFeed();
    await feed.fetchFeed();
    for (const [, init] of fetch.mock.calls) expect((init as RequestInit).headers).toEqual({});
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('unique-to-this-client');
    expect(await feedWith(async () => response(304)).feed.fetchFeed()).toEqual({ status: 'failed', reason: 'http_304' });
  });

  it('stops reading a body that passes the limit instead of buffering it', async () => {
    // What a compressed bomb looks like after decoding: no content-length worth trusting, and no end.
    const bomb = endless(new Uint8Array(1024 * 1024));
    expect(await feedWith(async () => bomb.response).feed.fetchFeed()).toEqual({ status: 'failed', reason: 'network' });
    expect(bomb.cancelled()).toBe(true);
    expect(bomb.pulled()).toBeLessThanOrEqual(MAX_FEED_BYTES + 2 * 1024 * 1024);
    const image = endless(new Uint8Array(64 * 1024));
    expect(await feedWith(async () => image.response).feed.fetchMedia(PNG_SHA, 'image/png')).toBeNull();
    expect(image.cancelled()).toBe(true);
    expect(image.pulled()).toBeLessThanOrEqual(MAX_MEDIA_BYTES + 2 * 64 * 1024);
  });

  it('answers "failed" instead of throwing', async () => {
    expect(await feedWith(async () => { throw new Error('offline'); }).feed.fetchFeed()).toEqual({ status: 'failed', reason: 'network' });
    expect(await feedWith(async () => response(503)).feed.fetchFeed()).toEqual({ status: 'failed', reason: 'http_503' });
    expect(await feedWith(async () => response(200, '<html>')).feed.fetchFeed()).toEqual({ status: 'failed', reason: 'not_json' });
    for (const body of ['null', '[]', '{"seq":1}', '{"seq":"1","items":[]}', '{"seq":-1,"items":[]}', '{"seq":1.5,"items":[]}', '{"seq":1,"items":{}}']) {
      expect(await feedWith(async () => response(200, body)).feed.fetchFeed()).toEqual({ status: 'failed', reason: 'bad_shape' });
    }
    const tooMany = JSON.stringify({ seq: 1, items: Array.from({ length: MAX_FEED_ITEMS + 1 }, () => ({})) });
    expect(await feedWith(async () => response(200, tooMany)).feed.fetchFeed()).toEqual({ status: 'failed', reason: 'bad_shape' });
  });

  it('gives up on a server that never answers', async () => {
    const { feed } = feedWith((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }), 20);
    expect(await feed.fetchFeed()).toEqual({ status: 'failed', reason: 'network' });
  });
});

describe('announcement images', () => {
  it('keeps an image whose bytes hash to the signed fingerprint', async () => {
    const { fetch, feed } = feedWith(async () => response(200, PNG, { 'content-type': 'image/png' }));
    const media = await feed.fetchMedia(PNG_SHA, 'image/png');
    expect(media?.type).toBe('image/png');
    expect(Array.from(media!.bytes)).toEqual(Array.from(PNG));
    expect(fetch.mock.calls[0]![0]).toBe(`https://sync.example/api/announcements/v1/media/${PNG_SHA}`);
  });

  it('drops an image the server swapped', async () => {
    const other = new Uint8Array([...PNG.slice(0, 11), 9]);
    expect(await feedWith(async () => response(200, other)).feed.fetchMedia(PNG_SHA, 'image/png')).toBeNull();
  });

  it('goes by what the bytes are, not by what the server calls them', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const svgSha = bytesToHex(sha256(svg));
    expect(await feedWith(async () => response(200, svg, { 'content-type': 'image/png' })).feed.fetchMedia(svgSha, 'image/png')).toBeNull();
    // A real PNG that the document declared as a JPEG is refused too.
    expect(await feedWith(async () => response(200, PNG)).feed.fetchMedia(PNG_SHA, 'image/jpeg')).toBeNull();
  });

  it('never asks for anything but a hash, and refuses an oversized or missing image', async () => {
    const { fetch, feed } = feedWith(async () => response(200, PNG));
    expect(await feed.fetchMedia('../feed', 'image/png')).toBeNull();
    expect(await feed.fetchMedia(PNG_SHA, 'image/svg+xml')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await feedWith(async () => response(404)).feed.fetchMedia(PNG_SHA, 'image/png')).toBeNull();
    const huge = new Uint8Array(MAX_MEDIA_BYTES + 1);
    expect(await feedWith(async () => response(200, huge)).feed.fetchMedia(bytesToHex(sha256(huge)), 'image/png')).toBeNull();
    expect(await feedWith(async () => response(200, PNG, { 'content-length': String(MAX_MEDIA_BYTES + 1) })).feed.fetchMedia(PNG_SHA, 'image/png')).toBeNull();
  });
});

describe('sniffImageType', () => {
  it('knows PNG, JPEG and WebP and nothing else', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(new TextEncoder().encode('GIF89a\0\0\0\0\0\0'))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
  });
});
