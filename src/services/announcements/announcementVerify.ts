// Broadcast announcements: envelope verification (pure, no chrome, no network).
//
// An envelope is `{ payload, keyId, sig }`: the document's bytes as unpadded base64url, the id of
// the key that signed them, and an Ed25519 signature over `"gero-announcement-v1\n" || payloadBytes`.
// The signature is checked over the exact payload bytes BEFORE they are parsed, so there is no
// canonical form to disagree about, and nothing unsigned ever reaches the rules.
//
// The wallet holds no secret: the keys are public and pinned in the build (announcementKeys.ts).
// Knowing exactly how this works gives nobody a way in. Without the private key there is no
// envelope this function accepts.
//
// Verdicts are, in order: bad_envelope, too_large, unknown_key, bad_signature, then the rules'.
// The same order as gero-sync's AnnouncementVerifier.java; the shared vectors hold both to it.

import * as ed25519 from '@noble/ed25519';
import { hexToBytes } from '@/services/notify/notifyAuth';
import { check, MAX_PAYLOAD, type AnnouncementDocument, type AnnouncementTier } from './announcementRules';

export interface Envelope {
  payload: string;
  keyId: string;
  sig: string;
}

export interface VerifyKey {
  readonly keyId: string;
  readonly publicKeyHex: string;
}

export interface VerifyKeys {
  readonly editorial: readonly VerifyKey[];
  readonly feed: readonly VerifyKey[];
}

export type Verified =
  | { ok: true; document: AnnouncementDocument; tier: AnnouncementTier }
  | { ok: false; refusal: string };

const DOMAIN = new TextEncoder().encode('gero-announcement-v1\n');
const B64URL = /^[A-Za-z0-9_-]+$/;

/** Unpadded base64url, or null. Padding, `+`, `/` and whitespace are refused. */
export function decodeB64Url(s: unknown): Uint8Array | null {
  if (typeof s !== 'string' || !B64URL.test(s)) return null;
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The key and its tier. A key id listed in both tiers is usable in neither. */
function findKey(keys: VerifyKeys, keyId: string): { publicKeyHex: string; tier: AnnouncementTier } | null {
  const editorials = keys.editorial.filter((k) => k.keyId === keyId);
  const feeds = keys.feed.filter((k) => k.keyId === keyId);
  // One key id names one key in one tier. Listed twice, in either way, it names none (as on the server).
  if (editorials.length + feeds.length !== 1) return null;
  const editorial = editorials[0];
  const feed = feeds[0];
  if (editorial) return { publicKeyHex: editorial.publicKeyHex, tier: 'editorial' };
  if (feed) return { publicKeyHex: feed.publicKeyHex, tier: 'feed' };
  return null;
}

export async function verifyEnvelope(envelope: unknown, keys: VerifyKeys, now: number): Promise<Verified> {
  const e = (envelope && typeof envelope === 'object' ? envelope : {}) as Partial<Record<keyof Envelope, unknown>>;
  const payload = decodeB64Url(e.payload);
  const sig = decodeB64Url(e.sig);
  if (!payload || !sig || sig.length !== 64 || typeof e.keyId !== 'string') return { ok: false, refusal: 'bad_envelope' };
  if (payload.length > MAX_PAYLOAD) return { ok: false, refusal: 'too_large' };
  const key = findKey(keys, e.keyId);
  if (!key) return { ok: false, refusal: 'unknown_key' };
  const message = new Uint8Array(DOMAIN.length + payload.length);
  message.set(DOMAIN, 0);
  message.set(payload, DOMAIN.length);
  let valid = false;
  try {
    // zip215: false is strict RFC 8032, which is what the server's JDK verifier implements.
    valid = await ed25519.verifyAsync(sig, message, hexToBytes(key.publicKeyHex), { zip215: false });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, refusal: 'bad_signature' };
  const result = check(payload, key.tier, now);
  // `=== false`: this repo compiles without strictNullChecks, where a bare `!result.ok` does not narrow.
  if (result.ok === false) return { ok: false, refusal: result.refusal };
  return { ok: true, document: result.document, tier: key.tier };
}
