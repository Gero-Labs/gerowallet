import { describe, expect, it } from 'vitest';
import { ANNOUNCEMENT_EDITORIAL_KEYS, ANNOUNCEMENT_FEED_KEYS } from './announcementKeys';

// The RFC 8032 section 7.1 test keys. Their private halves are published, and the shared test
// vectors are signed with them: pinning either would let anyone sign as Gero.
const PUBLICLY_KNOWN = [
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
  '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
];

describe('announcement signing keys', () => {
  const all = [...ANNOUNCEMENT_EDITORIAL_KEYS, ...ANNOUNCEMENT_FEED_KEYS];

  it('are well-formed', () => {
    for (const key of all) {
      expect(key.keyId).toMatch(/^[A-Za-z0-9._-]{1,40}$/);
      expect(key.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('cannot be changed at runtime', () => {
    expect(Object.isFrozen(ANNOUNCEMENT_EDITORIAL_KEYS)).toBe(true);
    expect(Object.isFrozen(ANNOUNCEMENT_FEED_KEYS)).toBe(true);
  });

  it('name each key id once, in one tier', () => {
    const ids = all.map((k) => k.keyId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never pin a key whose private half is public', () => {
    for (const key of all) expect(PUBLICLY_KNOWN).not.toContain(key.publicKeyHex);
  });
});
