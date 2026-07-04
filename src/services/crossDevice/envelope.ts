// Cross-device signing bridge — Ed25519 message authentication envelope (pure).
//
// This is the security-critical primitive. Every SIGN_REQUEST / SIGN_RESPONSE
// carries a `sig` field: an Ed25519 signature over a CANONICAL SIGNING SUBJECT.
//
// The subject is a pipe-joined string of explicit fields (NOT sorted-key JSON).
// This is deliberate: cross-language JSON canonicalization (Swift JSONEncoder vs
// JS JSON.stringify) diverges on number formatting, string escaping and
// whitespace, so a JSON-signed message will not verify across clients. An
// explicit, ordered, pipe-delimited subject with a hash of the large CBOR is
// reproducible byte-for-byte in Swift and TS. This matches the iOS approver.
//
// Subjects (utf8 bytes, signed with the device relay Ed25519 key):
//   SIGN_REQUEST:  gero-xdev/v1|SIGN_REQUEST|<reqId>|<nonce>|<from>|<stakeAddress or empty>|<expiresAt>|<blake2b256hex(rawUnsignedCborBytes)>
//   SIGN_RESPONSE: gero-xdev/v1|SIGN_RESPONSE|<reqId>|<nonce>|<deviceId>|<decision>|<blake2b256hex(rawWitnessBytes) or empty when rejected>
//   PAIR_CONFIRM:  gero-xdev/v1|PAIR_CONFIRM|<from>|<pubKey>|<to>|<nonce>|<stakeAddress>
//     (QR pairing. Unlike SIGN_*, `to` is INSIDE the subject: it binds the scanned
//      desktop so a captured confirm cannot be replayed to another desktop.)
//   PAIR_ACK:      gero-xdev/v1|PAIR_ACK|<from>|<to>|<nonce>
//     (desktop -> phone cosmetic ack; the phone reconstructs this from what it pinned.)
//
// Encodings: lowercase hex throughout, Ed25519, blake2b-256 (32-byte), expiresAt
// is unix SECONDS rendered as its decimal string.
//
// Pure module: no chrome, no WebSocket, no Date.now. Uses the async
// @noble/ed25519 API (signAsync/verifyAsync), which hashes internally.

import * as ed25519 from '@noble/ed25519';
import { blake2bHex } from 'blakejs';
import type { SignRequest, SignResponse, PairConfirm, PairAck } from './protocol';

/** Domain-separation + version tag that prefixes every signing subject. */
export const CROSS_DEVICE_SUBJECT_VERSION = 'gero-xdev/v1';

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${hex.length}`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** blake2b-256 of raw bytes, lowercase hex (64 chars). Shared with all clients. */
export function blake2b256Hex(bytes: Uint8Array): string {
  return blake2bHex(bytes, undefined, 32);
}

/** Hash a hex-CBOR string's RAW bytes; empty string in -> empty string out. */
function cborHash(hexCbor: string): string {
  return hexCbor ? blake2b256Hex(hexToBytes(hexCbor)) : '';
}

type UnsignedRequest = Omit<SignRequest, 'sig'>;
type UnsignedResponse = Omit<SignResponse, 'sig'>;
type UnsignedPairConfirm = Omit<PairConfirm, 'sig'>;
type UnsignedPairAck = Omit<PairAck, 'sig'>;
type UnsignedMessage = UnsignedRequest | UnsignedResponse | UnsignedPairConfirm | UnsignedPairAck;

/**
 * Build the canonical pipe-joined signing subject for a message. This exact
 * string (utf8) is what gets signed and verified, byte-for-byte identical across
 * the extension and the iOS approver.
 */
export function buildSubject(msg: UnsignedMessage): string {
  if (msg.type === 'SIGN_REQUEST') {
    return [
      CROSS_DEVICE_SUBJECT_VERSION,
      'SIGN_REQUEST',
      msg.reqId,
      msg.nonce,
      msg.from,
      msg.stakeAddress ?? '',
      String(msg.expiresAt),
      cborHash(msg.unsignedCbor),
    ].join('|');
  }
  if (msg.type === 'PAIR_ACK') {
    // Cosmetic ack; the phone re-derives this from what it pinned (qr.deviceId, its
    // own id, the nonce), not from the ack's self-declared fields.
    return [
      CROSS_DEVICE_SUBJECT_VERSION,
      'PAIR_ACK',
      msg.from,
      msg.to,
      msg.nonce,
    ].join('|');
  }
  if (msg.type === 'PAIR_CONFIRM') {
    // `to` is signed here (binds the scanned desktop); see the header note.
    return [
      CROSS_DEVICE_SUBJECT_VERSION,
      'PAIR_CONFIRM',
      msg.from,
      msg.pubKey,
      msg.to,
      msg.nonce,
      msg.stakeAddress,
    ].join('|');
  }
  return [
    CROSS_DEVICE_SUBJECT_VERSION,
    'SIGN_RESPONSE',
    msg.reqId,
    msg.nonce,
    msg.deviceId,
    msg.decision,
    msg.decision === 'approved' ? cborHash(msg.witnessSetCbor ?? '') : '',
  ].join('|');
}

/**
 * Sign a SIGN_REQUEST / SIGN_RESPONSE (minus its `sig`), returning it with `sig`
 * populated. The signature is over the canonical subject (buildSubject).
 */
export async function signMessage<T extends { sig: string }>(
  msg: Omit<T, 'sig'>,
  privKeyHex: string,
): Promise<T> {
  const subject = buildSubject(msg as unknown as UnsignedRequest | UnsignedResponse);
  const sigBytes = await ed25519.signAsync(new TextEncoder().encode(subject), hexToBytes(privKeyHex));
  return { ...(msg as object), sig: bytesToHex(sigBytes) } as T;
}

/**
 * Verify a message's `sig` against a public key. Returns false (never throws)
 * for a wrong key, tampered field, or malformed signature, so callers can safely
 * drop unverified inbound messages.
 */
export async function verifyMessage(
  msg: { sig: string } & UnsignedMessage,
  pubKeyHex: string,
): Promise<boolean> {
  try {
    const subject = buildSubject(msg);
    return await ed25519.verifyAsync(
      hexToBytes(msg.sig),
      new TextEncoder().encode(subject),
      hexToBytes(pubKeyHex),
    );
  } catch {
    return false;
  }
}
