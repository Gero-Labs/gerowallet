// Push notifications (gero-notify v1) — request signing (pure).
//
// CONTRACT.md §3.2–§3.5. Every signed request carries four headers:
//   X-Gero-Device  deviceId (32 hex)          X-Gero-Ts     Unix ms, 13 digits
//   X-Gero-Nonce   16 CSPRNG bytes (32 hex)   X-Gero-Sig    Ed25519 over the canonical string
//
//   gero-notify/v1|<METHOD>|<PATH>|<TS>|<NONCE>|<BODY_SHA256>
//
// PATH is the raw request path from `/api/notify/v1/…`, no host, no query. BODY_SHA256 is the
// hash of the exact bytes sent (the empty hash for GET / DELETE). The relay key signs it
// ("pure" Ed25519, RFC 8032), and the `gero-notify/v1|` prefix keeps it apart from every
// `gero-xdev/v1|…` relay subject the same key signs. Noble is deterministic, so the §3.8
// vectors are reproduced byte for byte (notifyAuth.spec.ts).
//
// Pure: no chrome, no fetch, no Date.now. The caller passes the clock and, in tests, the nonce.

import * as ed25519 from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';

// noble v3's synchronous API needs a sha512 wired in once (same as deviceIdentity.ts).
if (!ed25519.hashes.sha512) {
  ed25519.hashes.sha512 = sha512;
}

export const NOTIFY_SIGNING_DOMAIN = 'gero-notify/v1';
/** SHA-256 of zero bytes: the body hash of every GET and DELETE (§3.3). */
export const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
/** |serverTime − X-Gero-Ts| must stay within this (§3.4 step 3). */
export const NOTIFY_SKEW_MS = 300_000;

export type NotifyMethod = 'GET' | 'PUT' | 'POST' | 'DELETE';

export interface NotifyHeaders {
  'X-Gero-Device': string;
  'X-Gero-Ts': string;
  'X-Gero-Nonce': string;
  'X-Gero-Sig': string;
}

export interface SigningIdentity {
  deviceId: string;
  privKeyHex: string;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`Invalid hex string length: ${hex.length}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Serialise a body ONCE. The same bytes are hashed, signed and sent (§3.3). */
export function encodeBody(body: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body));
}

export function bodySha256Hex(body: Uint8Array): string {
  return body.length === 0 ? EMPTY_BODY_SHA256 : bytesToHex(sha256(body));
}

export function canonicalString(method: NotifyMethod, path: string, ts: string, nonce: string, body: Uint8Array): string {
  return [NOTIFY_SIGNING_DOMAIN, method, path, ts, nonce, bodySha256Hex(body)].join('|');
}

/** 16 CSPRNG bytes as lowercase hex (§3.5). Never reused, even on a retry. */
export function randomNonceHex(random: (n: number) => Uint8Array = defaultRandomBytes): string {
  return bytesToHex(random(16));
}

function defaultRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** The exact `X-Gero-Ts` characters for a signing time (13 digits in v1's lifetime). */
export function timestampHeader(nowMs: number): string {
  return String(Math.floor(nowMs));
}

/**
 * The four signed headers for one request. `nowMs` is the caller's corrected clock
 * (local now + clockOffset, §3.6); `nonce` is injectable for the vectors only.
 */
export function signHeaders(
  identity: SigningIdentity,
  method: NotifyMethod,
  path: string,
  body: Uint8Array,
  nowMs: number,
  nonce: string = randomNonceHex(),
): NotifyHeaders {
  const ts = timestampHeader(nowMs);
  const subject = canonicalString(method, path, ts, nonce, body);
  const sig = ed25519.sign(new TextEncoder().encode(subject), hexToBytes(identity.privKeyHex));
  return { 'X-Gero-Device': identity.deviceId, 'X-Gero-Ts': ts, 'X-Gero-Nonce': nonce, 'X-Gero-Sig': bytesToHex(sig) };
}
