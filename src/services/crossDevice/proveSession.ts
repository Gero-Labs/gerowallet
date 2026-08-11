// Cross-Device Proving (XDP) — per-job session crypto (pure). Requirement R4.
//
// Every proving job gets a FRESH X25519 key pair on each side. The public keys
// travel INSIDE the Ed25519-signed PROVE_INIT / PROVE_ACCEPT subjects
// (proveEnvelope.ts), so the relay cannot substitute them — it can drop or
// misdeliver a job, never read one. No static encryption key exists anywhere in
// XDP, and both ephemerals are wiped at job end, so a later device compromise
// cannot decrypt a captured job (forward secrecy).
//
// The relay is treated as an active attacker throughout: it sees only
// ciphertext, nonces, and lengths.
//
// Layering (mirrors the signing bridge's protocol/envelope split): this module
// is pure crypto with no frame types and no transport. The frames that carry
// these bytes live in proveProtocol.ts; the signatures that authenticate the
// handshake live in proveEnvelope.ts.
//
// PRIVACY (ground rule 13): callers must never log plaintext, keys, or
// ciphertext bodies. Lengths and counts are fine.

import { x25519 } from '@noble/curves/ed25519';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

/** Domain-separation + version tag. Matches the signing subjects' prefix rule. */
export const XPROVE_VERSION = 'gero-xprove/v1';

/**
 * Direction labels. `p2d` = phone -> desktop (the unproven tx), `d2p` = desktop
 * -> phone (the finalized tx). Both directions get DISTINCT keys derived from
 * the same ECDH secret, so a reflected chunk can never decrypt as inbound — the
 * cheapest defense against a relay replaying our own bytes back at us.
 */
export type ChunkDirection = 'p2d' | 'd2p';

/**
 * OPEN CONTRACT ITEM — iOS uses `request`/`response` for the same two
 * directions. One side must move before the golden vectors can be frozen; the
 * labels appear in BOTH the HKDF info string and the chunk AAD, so every vector
 * changes with them.
 *
 * Desktop's argument for `p2d`/`d2p`: they name the physical direction, which
 * stays unambiguous no matter who initiated. `request`/`response` is defined
 * relative to the initiator, and the payloads are not a request/response pair —
 * both directions carry a transaction. Not a strong preference; whichever iOS
 * ratifies, changing this is a one-line edit here plus a vector regeneration.
 */

/** Which end of the job this device is. The desktop extension is always `desktop`. */
export type SessionRole = 'phone' | 'desktop';

/**
 * KDF SPECIFICATION — read this before porting to another language.
 *
 * "HKDF-BLAKE2b" is ambiguous and the two readings do NOT interoperate. BLAKE2b
 * has a NATIVE keyed mode, which most crypto libraries expose (CryptoKit,
 * libsodium), so "keyed BLAKE2b" is the intuitive implementation — and it
 * produces completely different bytes from the one specified here.
 *
 * This protocol uses **RFC 5869 HKDF with HMAC-BLAKE2b-512**, i.e. the standard
 * HMAC construction (ipad/opad, 128-byte block) over unkeyed BLAKE2b — NOT
 * BLAKE2b's native keying. Concretely:
 *
 *   hashLen   = 64  (BLAKE2b-512 output)
 *   blockLen  = 128 (HMAC block size)
 *   salt      = 64 ZERO bytes  (RFC 5869's "if not provided, HashLen zeros")
 *   PRK       = HMAC-BLAKE2b(key = salt, msg = ECDH shared secret)  -> 64 bytes
 *   OKM       = HKDF-Expand(PRK, info = sessionInfo(...), L = 32)   -> 32 bytes
 *
 * The salt is passed EXPLICITLY below rather than relying on a library default,
 * because the default is exactly the kind of implicit value that diverges
 * silently across implementations. {@link sessionPrk} is exported so the
 * conformance vectors can pin the INTERMEDIATE PRK: when two clients disagree,
 * a pinned PRK localizes the fault to extract-vs-expand instead of "somewhere
 * in the KDF".
 */
const HKDF_HASH_LEN = 64;
const HKDF_SALT = new Uint8Array(HKDF_HASH_LEN);

/** XChaCha20-Poly1305: 32-byte key, 24-byte nonce, 16-byte tag. */
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
export const AEAD_TAG_BYTES = 16;

/**
 * Plaintext bytes per chunk. Confirmed against iOS's measurements (their
 * 2026-08-11 reply §4): a real unshielded proven tx is ~3.6 KB, and the range
 * across shapes tops out near 60 KB, so 64 KiB carries every measured shape in
 * a SINGLE chunk.
 *
 * That makes chunking near-vestigial for v1 unshielded — deliberately kept
 * anyway, because the variable-size contract/shield-swap proofs iOS flags will
 * exceed one chunk, and retrofitting reassembly into a shipped protocol is far
 * worse than carrying it unused. It also means the multi-chunk paths are
 * exercised only by tests today; do not delete those tests as "unreachable".
 *
 * Q2 (gero-sync's max WebSocket message size) is no longer blocking at these
 * sizes: one chunk is ~87 KB of base64 worst case, under any plausible limit.
 */
export const DEFAULT_CHUNK_BYTES = 64 * 1024;

export interface EphemeralKeyPair {
  /** Raw 32-byte X25519 secret. Wipe with {@link wipe} when the job ends. */
  readonly privKey: Uint8Array;
  /** Lowercase hex of the 32-byte public key — what goes in the signed subject. */
  readonly pubKeyHex: string;
}

/**
 * Directional keys for one job. `send` encrypts what this device transmits;
 * `receive` decrypts what the peer transmits. Which HKDF label maps to which
 * depends on the role, so neither side has to reason about direction twice.
 */
export interface SessionKeys {
  readonly send: Uint8Array;
  readonly receive: Uint8Array;
}

/**
 * An encrypted chunk's wire fields.
 *
 * Mixed encodings on purpose: the nonce is hex (24 bytes — matches every other
 * small field in the signing protocol, and stays greppable in a capture), while
 * the ciphertext BODY is base64. The body is the only field where encoding cost
 * is material — hex would double a payload the brief sizes at 10²–10³ KB, where
 * base64 costs ~33 % (Q3).
 */
export interface SealedChunk {
  readonly nonceHex: string;
  readonly ciphertextB64: string;
}

// ---------------------------------------------------------------------------
// Hex helpers (local: this module must not depend on the signing envelope)
// ---------------------------------------------------------------------------

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`Invalid hex string length: ${hex.length}`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('Invalid hex string');
    bytes[i] = byte;
  }
  return bytes;
}

/**
 * Base64 for chunk bodies. `btoa`/`atob` exist in both the BG service worker
 * and extension pages, so no polyfill and no Buffer dependency (this module is
 * shared with pure-browser contexts). Chunked through String.fromCharCode to
 * avoid blowing the argument limit on a 64 KiB body.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const STRIDE = 0x8000;
  for (let i = 0; i < bytes.length; i += STRIDE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STRIDE));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Best-effort zeroing of key material. JS cannot guarantee the bytes are gone
 * (GC may have copied the buffer), but not wiping guarantees they linger — and
 * the BG service worker is long-lived, so a job's keys would otherwise sit in
 * memory until the worker recycles.
 */
export function wipe(...buffers: Array<Uint8Array | undefined>): void {
  for (const b of buffers) b?.fill(0);
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

/** Mint a fresh per-job X25519 key pair. Never reuse one across jobs. */
export function generateEphemeralKeyPair(): EphemeralKeyPair {
  const privKey = x25519.utils.randomPrivateKey();
  return { privKey, pubKeyHex: bytesToHex(x25519.getPublicKey(privKey)) };
}

/**
 * HKDF info string. Binds the derived key to the protocol version, this exact
 * job, BOTH device identities, and the direction — so a key can never be
 * reused across jobs, devices, protocol versions, or directions even if an
 * ECDH secret somehow repeated.
 *
 * Device ids are ordered phone-then-desktop (by ROLE, not by who is deriving),
 * so both sides build the identical string.
 */
export function sessionInfo(
  reqId: string,
  phoneDeviceId: string,
  desktopDeviceId: string,
  dir: ChunkDirection,
): string {
  return [XPROVE_VERSION, reqId, phoneDeviceId, desktopDeviceId, dir].join('|');
}

export interface DeriveSessionKeysArgs {
  /** This device's ephemeral secret. */
  readonly ourPrivKey: Uint8Array;
  /** The peer's ephemeral public key, hex, as carried in their signed subject. */
  readonly theirPubKeyHex: string;
  readonly reqId: string;
  readonly phoneDeviceId: string;
  readonly desktopDeviceId: string;
  /** This device's role — decides which label is `send` vs `receive`. */
  readonly role: SessionRole;
}

/**
 * HKDF-Extract step, exported so conformance vectors can pin the intermediate
 * PRK (see the KDF SPECIFICATION note above). `sharedSecret` is the raw 32-byte
 * X25519 ECDH output; the result is a 64-byte PRK.
 *
 * The all-zero salt is deliberate and specified, not an omission: the input is
 * a fresh ECDH secret and every binding value lives in the info string, so a
 * salt would add nothing an attacker does not already have.
 */
export function sessionPrk(sharedSecret: Uint8Array): Uint8Array {
  return extract(blake2b, sharedSecret, HKDF_SALT);
}

/**
 * ECDH + HKDF (HMAC-BLAKE2b-512) into two direction-labeled keys.
 * See the KDF SPECIFICATION note above before porting this.
 */
export function deriveSessionKeys(args: DeriveSessionKeysArgs): SessionKeys {
  const shared = x25519.getSharedSecret(args.ourPrivKey, hexToBytes(args.theirPubKeyHex));
  const prk = sessionPrk(shared);
  const derive = (dir: ChunkDirection): Uint8Array =>
    expand(
      blake2b,
      prk,
      new TextEncoder().encode(
        sessionInfo(args.reqId, args.phoneDeviceId, args.desktopDeviceId, dir),
      ),
      KEY_BYTES,
    );
  const p2d = derive('p2d');
  const d2p = derive('d2p');
  wipe(shared, prk);
  return args.role === 'phone'
    ? { send: p2d, receive: d2p }
    : { send: d2p, receive: p2d };
}

// ---------------------------------------------------------------------------
// Chunk sealing
// ---------------------------------------------------------------------------

/**
 * Additional authenticated data for one chunk:
 * `gero-xprove/v1|<reqId>|<dir>|<seq>|<count>`.
 *
 * This is what makes per-chunk signatures unnecessary (R4): the AEAD tag binds
 * each chunk to its job, direction, and exact position in the stream, so a
 * relay cannot reorder, drop-and-renumber, duplicate, or splice chunks between
 * jobs without the tag failing. The INIT/ACCEPT signatures are the handshake;
 * this is the per-chunk integrity.
 */
export function chunkAad(
  reqId: string,
  dir: ChunkDirection,
  seq: number,
  count: number,
): Uint8Array {
  return new TextEncoder().encode([XPROVE_VERSION, reqId, dir, String(seq), String(count)].join('|'));
}

/** Encrypt one chunk under a fresh random nonce. */
export function sealChunk(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): SealedChunk {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
  return { nonceHex: bytesToHex(nonce), ciphertextB64: bytesToBase64(ciphertext) };
}

/**
 * Decrypt one chunk. Throws on any tag failure — which includes a wrong key, a
 * tampered body, AND a chunk whose (dir, seq, count) does not match what the
 * caller expected, because those are in the AAD.
 */
export function openChunk(
  key: Uint8Array,
  chunk: SealedChunk,
  aad: Uint8Array,
): Uint8Array {
  return xchacha20poly1305(key, hexToBytes(chunk.nonceHex), aad)
    .decrypt(base64ToBytes(chunk.ciphertextB64));
}

// ---------------------------------------------------------------------------
// Payload splitting / reassembly
// ---------------------------------------------------------------------------

/**
 * Split a payload into fixed-size plaintext chunks. An EMPTY payload yields one
 * empty chunk rather than zero chunks, so `count` is never 0 and the receiver's
 * "have I got all of them" test stays a simple equality. (An empty payload is
 * not a legal tx, but the framing shouldn't be the thing that decides that —
 * the digest check will.)
 */
export function splitPayload(payload: Uint8Array, chunkBytes = DEFAULT_CHUNK_BYTES): Uint8Array[] {
  if (chunkBytes <= 0) throw new Error('chunkBytes must be positive');
  if (payload.length === 0) return [new Uint8Array(0)];
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < payload.length; offset += chunkBytes) {
    out.push(payload.subarray(offset, Math.min(offset + chunkBytes, payload.length)));
  }
  return out;
}

/** Concatenate decrypted chunks back into the payload, in the given order. */
export function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
