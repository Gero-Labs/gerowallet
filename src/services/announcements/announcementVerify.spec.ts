import { describe, expect, it } from 'vitest';
import { ANNOUNCEMENT_EDITORIAL_KEYS, ANNOUNCEMENT_FEED_KEYS } from '@/utils/announcementKeys';
import { MAX_PAYLOAD } from './announcementRules';
import { decodeB64Url, verifyEnvelope, type Envelope, type VerifyKeys } from './announcementVerify';
import { b64, bytes, editorial, feed, ID, NOW, signEditorial, signFeed, TEST_KEYS } from './__fixtures__/docs';
import vectors from './__fixtures__/vectors.json';

async function verdict(e: unknown, keys: VerifyKeys = TEST_KEYS): Promise<string | null> {
  const v = await verifyEnvelope(e, keys, NOW);
  return v.ok === false ? v.refusal : null;
}

describe('announcement envelope verification', () => {
  it('accepts a signed document, with the tier of its key', async () => {
    const v = await verifyEnvelope(await signEditorial(editorial()), TEST_KEYS, NOW);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.tier).toBe('editorial');
    expect(v.document.id).toBe(ID);
    const f = await verifyEnvelope(await signFeed(feed()), TEST_KEYS, NOW);
    expect(f.ok && f.tier).toBe('feed');
  });

  it('holds a document signed by the feed key to the feed rules', async () => {
    expect(await verdict(await signFeed(editorial()))).toBe('tier_limit');
  });

  it('refuses a changed payload or signature', async () => {
    const good = await signEditorial(editorial());
    const other = editorial();
    other['severity'] = 'info';
    expect(await verdict({ ...good, payload: b64(bytes(other)) })).toBe('bad_signature');
    const sig = decodeB64Url(good.sig)!;
    sig[0] = sig[0]! ^ 1;
    expect(await verdict({ ...good, sig: b64(sig) })).toBe('bad_signature');
  });

  it('refuses a signature made under the other key', async () => {
    const byFeed = await signFeed(feed());
    expect(await verdict({ ...byFeed, keyId: 'vec-ed' })).toBe('bad_signature');
  });

  it('refuses a malformed envelope without throwing', async () => {
    const good = await signEditorial(editorial());
    expect(await verdict({ ...good, keyId: 'nobody' })).toBe('unknown_key');
    expect(await verdict({ ...good, payload: `${good.payload}=` })).toBe('bad_envelope');
    expect(await verdict({ ...good, sig: good.sig.slice(4) })).toBe('bad_envelope');
    expect(await verdict({ keyId: good.keyId, sig: good.sig })).toBe('bad_envelope');
    expect(await verdict({ ...good, keyId: 7 })).toBe('bad_envelope');
    expect(await verdict(null)).toBe('bad_envelope');
    expect(await verdict('{"payload":"x"}')).toBe('bad_envelope');
    expect(await verdict(await signEditorial(new Uint8Array(MAX_PAYLOAD + 1)))).toBe('too_large');
  });

  it('accepts nothing when a key id is listed in both tiers', async () => {
    const both: VerifyKeys = { editorial: TEST_KEYS.editorial, feed: [{ keyId: 'vec-ed', publicKeyHex: TEST_KEYS.editorial[0]!.publicKeyHex }] };
    expect(await verdict(await signEditorial(editorial()), both)).toBe('unknown_key');
  });

  it('accepts nothing at all with no key pinned', async () => {
    const none: VerifyKeys = { editorial: [], feed: [] };
    expect(await verdict(await signEditorial(editorial()), none)).toBe('unknown_key');
    expect(await verdict(await signFeed(feed()), none)).toBe('unknown_key');
  });

  it('cannot be satisfied by the test keys in a real build', async () => {
    // The build's pinned lists, not the injected test keys: a document signed with the published
    // RFC 8032 keys must never verify against what ships.
    const pinned: VerifyKeys = { editorial: ANNOUNCEMENT_EDITORIAL_KEYS, feed: ANNOUNCEMENT_FEED_KEYS };
    expect(await verdict(await signEditorial(editorial()), pinned)).not.toBeNull();
    expect(await verdict(await signFeed(feed()), pinned)).not.toBeNull();
  });
});

// The cross-client vectors: gero-sync, this extension, iOS and Android run the same file, so all
// four give the same verdict for the same envelope. The file is copied unchanged from gero-sync.
describe('the shared announcement vectors', () => {
  const file = vectors as {
    domain: string;
    now: number;
    keys: { editorial: Record<string, string>; feed: Record<string, string> };
    vectors: Array<{ name: string; envelope: Envelope; expect: string }>;
  };
  const keys: VerifyKeys = {
    editorial: Object.entries(file.keys.editorial).map(([keyId, publicKeyHex]) => ({ keyId, publicKeyHex })),
    feed: Object.entries(file.keys.feed).map(([keyId, publicKeyHex]) => ({ keyId, publicKeyHex })),
  };

  it('are all here', () => {
    expect(file.vectors).toHaveLength(33);
    expect(file.domain).toBe('gero-announcement-v1\n');
  });

  it.each(file.vectors.map((v) => [v.name, v] as const))('%s', async (_name, v) => {
    const result = await verifyEnvelope(v.envelope, keys, file.now);
    expect(result.ok === false ? result.refusal : 'ok').toBe(v.expect);
  });
});
