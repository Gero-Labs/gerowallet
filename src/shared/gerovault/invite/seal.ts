/**
 * Encryption of `gero-vault-invite/v1` (`PROTOCOL.md` section 3). Pure: every key, nonce and
 * ephemeral secret comes in as an argument.
 *
 *   K  = 32 random bytes (content key);  N = 24 random bytes
 *   body AAD = "gero-vault-invite/v1|<KIND>|" || setupId
 *   ciphertext = XChaCha20-Poly1305(K, N, body AAD, plaintext)
 *
 * Per recipient key R at `slot` (INVITE: slots 0 to 4, ACCEPT and DECLINE: slot 0 only):
 *
 *   e = 32 random bytes;  E = X25519(e, 9);  ss = X25519(e, R), refused when all zero
 *   wrapKey   = HKDF-SHA256(ikm = ss, salt = setupId, info = "gero-vault-invite/v1|WRAP|<KIND>|" || slot || E || R, 32)
 *   wrap AAD  = "gero-vault-invite/v1|WRAP|<KIND>|" || setupId || slot
 *   wrappedKey = XChaCha20-Poly1305(wrapKey, wrapNonce, wrap AAD, K)       (48 bytes)
 *
 * `slot` is one byte. LINK has no wraps: K is the link's content key (`link.ts`).
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  CREDENTIAL_BYTES,
  DECOY_TAG,
  DIRECTORY_SLOTS,
  INVITE_PROTOCOL,
  InviteNetwork,
  INVITE_NETWORKS,
  KEY_BYTES,
  MAX_PLAINTEXT_BYTES,
  NONCE_BYTES,
  SETUP_ID_BYTES,
  SealKind,
  TAG_BYTES,
  WRAP_COUNT,
  WRAP_INFO_TAG,
} from './constants';
import { InviteResult, ascii, attempt, bytesToHex, concatBytes, fixedHex, fromBase64Url, isUsableX25519Key, refuse, sameBytes, toBase64Url } from './codec';

/** One per-recipient wrap, as it travels (hex, lowercase). */
export interface WireWrap {
  readonly slot: number;
  /** The recipient's invite key this wrap opens with: the server delivers by it. */
  readonly recipientKey: string;
  readonly ephemeralKey: string;
  readonly nonce: string;
  /** 48 bytes: the sealed content key and its tag. */
  readonly wrappedKey: string;
}

/** A sealed object as it travels: `wraps` (none for LINK), the body nonce (hex) and the ciphertext (base64url). */
export interface WireSealed {
  readonly wraps: readonly WireWrap[];
  readonly nonce: string;
  readonly ciphertext: string;
}

/** What a recipient is handed: the one wrap for its own key. */
export interface WireDelivery {
  readonly wrap: WireWrap;
  readonly nonce: string;
  readonly ciphertext: string;
}

export interface SealRecipient {
  readonly slot: number;
  readonly key: Uint8Array;
}

export interface SealRandomness {
  readonly contentKey: Uint8Array;
  readonly nonce: Uint8Array;
  /** One per recipient, in the order of `recipients`. */
  readonly wraps: readonly { readonly ephemeralSecret: Uint8Array; readonly nonce: Uint8Array }[];
}

type WrappedKind = Exclude<SealKind, 'LINK'>;

function assertSetupId(setupId: Uint8Array): void {
  if (!(setupId instanceof Uint8Array) || setupId.length !== SETUP_ID_BYTES) throw new TypeError('A setup id is 16 bytes');
}

function assertBytes(value: Uint8Array, length: number, what: string): void {
  if (!(value instanceof Uint8Array) || value.length !== length) throw new TypeError(`${what} is ${length} bytes`);
}

/** `"gero-vault-invite/v1|<KIND>|" || setupId`: the body's associated data. */
export function bodyAad(kind: SealKind, setupId: Uint8Array): Uint8Array {
  assertSetupId(setupId);
  return concatBytes(ascii(`${INVITE_PROTOCOL}|${kind}|`), setupId);
}

/** `"gero-vault-invite/v1|WRAP|<KIND>|" || setupId || slot`: a wrap's associated data. */
export function wrapAad(kind: WrappedKind, setupId: Uint8Array, slot: number): Uint8Array {
  assertSetupId(setupId);
  return concatBytes(ascii(`${WRAP_INFO_TAG}${kind}|`), setupId, Uint8Array.of(slot));
}

/** X25519 public key of a 32-byte secret (clamped as RFC 7748 says). */
export function x25519PublicKey(secret: Uint8Array): Uint8Array {
  assertBytes(secret, KEY_BYTES, 'An X25519 secret');
  return x25519.getPublicKey(secret);
}

/** X25519 shared secret; refuses a small-order peer key and an all-zero result. */
function sharedSecret(secret: Uint8Array, peer: Uint8Array): Uint8Array {
  if (!isUsableX25519Key(peer)) return refuse('BAD_KEY');
  let ss: Uint8Array;
  try {
    ss = x25519.getSharedSecret(secret, peer);
  } catch {
    return refuse('BAD_KEY');
  }
  if (ss.every(b => b === 0)) refuse('BAD_KEY');
  return ss;
}

/** The wrap key for one recipient (exported for the vectors, which pin it). */
export function wrapKey(kind: WrappedKind, setupId: Uint8Array, slot: number, sharedSecretBytes: Uint8Array, ephemeralKey: Uint8Array, recipientKey: Uint8Array): Uint8Array {
  assertSetupId(setupId);
  const info = concatBytes(ascii(`${WRAP_INFO_TAG}${kind}|`), Uint8Array.of(slot), ephemeralKey, recipientKey);
  return hkdf(sha256, sharedSecretBytes, setupId, info, KEY_BYTES);
}

function checkSlots(kind: WrappedKind, slots: readonly number[]): void {
  const expected = WRAP_COUNT[kind];
  if (slots.length !== expected) throw new TypeError(`${kind} is sealed to exactly ${expected} keys`);
  const seen = new Set(slots);
  if (seen.size !== expected || slots.some(s => !Number.isInteger(s) || s < 0 || s >= expected)) {
    throw new TypeError(`${kind} slots are 0 to ${expected - 1}, each once`);
  }
}

/**
 * Seals `plaintext` to `recipients` (INVITE: the five directory entries; ACCEPT, DECLINE: the
 * initiator's reply key at slot 0). Throws for a caller error, including a recipient key that is
 * not a usable X25519 key: the directory and the reply key are checked before this.
 */
export function sealForRecipients(kind: WrappedKind, setupId: Uint8Array, plaintext: Uint8Array, recipients: readonly SealRecipient[], rnd: SealRandomness): WireSealed {
  assertSetupId(setupId);
  checkSlots(kind, recipients.map(r => r.slot));
  if (plaintext.length > MAX_PLAINTEXT_BYTES[kind]) throw new TypeError(`${kind} plaintext is at most ${MAX_PLAINTEXT_BYTES[kind]} bytes`);
  assertBytes(rnd.contentKey, KEY_BYTES, 'A content key');
  assertBytes(rnd.nonce, NONCE_BYTES, 'A nonce');
  if (rnd.wraps.length !== recipients.length) throw new TypeError('One wrap randomness per recipient');
  const wraps = recipients.map((r, i) => {
    const { ephemeralSecret, nonce } = rnd.wraps[i];
    assertBytes(ephemeralSecret, KEY_BYTES, 'An ephemeral secret');
    assertBytes(nonce, NONCE_BYTES, 'A wrap nonce');
    if (!isUsableX25519Key(r.key)) throw new TypeError(`Recipient key at slot ${r.slot} is not a usable X25519 key`);
    const ephemeral = x25519PublicKey(ephemeralSecret);
    const ss = attempt(() => sharedSecret(ephemeralSecret, r.key));
    if (ss.ok === false) throw new TypeError(`Recipient key at slot ${r.slot} gives no shared secret`);
    const key = wrapKey(kind, setupId, r.slot, ss.value, ephemeral, r.key);
    const wrapped = xchacha20poly1305(key, nonce, wrapAad(kind, setupId, r.slot)).encrypt(rnd.contentKey);
    return { slot: r.slot, recipientKey: bytesToHex(r.key), ephemeralKey: bytesToHex(ephemeral), nonce: bytesToHex(nonce), wrappedKey: bytesToHex(wrapped) };
  });
  const ciphertext = xchacha20poly1305(rnd.contentKey, rnd.nonce, bodyAad(kind, setupId)).encrypt(plaintext);
  return { wraps, nonce: bytesToHex(rnd.nonce), ciphertext: toBase64Url(ciphertext) };
}

function readCiphertext(kind: SealKind, nonceHex: unknown, ciphertextText: unknown): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const nonce = fixedHex(nonceHex, NONCE_BYTES);
  if (!nonce) return refuse('MALFORMED', 'nonce');
  if (typeof ciphertextText !== 'string' || ciphertextText.length > Math.ceil(((MAX_PLAINTEXT_BYTES[kind] + TAG_BYTES) * 4) / 3)) refuse('TOO_LARGE');
  const ciphertext = fromBase64Url(ciphertextText);
  if (!ciphertext || ciphertext.length < TAG_BYTES) return refuse('MALFORMED', 'ciphertext');
  if (ciphertext.length > MAX_PLAINTEXT_BYTES[kind] + TAG_BYTES) refuse('TOO_LARGE');
  return { nonce, ciphertext };
}

function decrypt(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  try {
    return xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
  } catch {
    return refuse('DECRYPT_FAILED');
  }
}

/**
 * Opens what the server handed this device: its one wrap, then the body. `secret` is this
 * device's X25519 invite secret. Never throws for untrusted input.
 */
export function openForRecipient(kind: WrappedKind, setupId: Uint8Array, delivery: WireDelivery, secret: Uint8Array): InviteResult<Uint8Array> {
  assertSetupId(setupId);
  assertBytes(secret, KEY_BYTES, 'An X25519 secret');
  return attempt(() => {
    const wrap = delivery?.wrap;
    if (!wrap || typeof wrap !== 'object') return refuse('MALFORMED', 'wrap');
    const slot = wrap.slot;
    if (!Number.isInteger(slot) || slot < 0 || slot >= WRAP_COUNT[kind]) refuse('MALFORMED', 'wrap.slot');
    const recipientKey = fixedHex(wrap.recipientKey, KEY_BYTES);
    const ephemeralKey = fixedHex(wrap.ephemeralKey, KEY_BYTES);
    const wrapNonce = fixedHex(wrap.nonce, NONCE_BYTES);
    const wrapped = fixedHex(wrap.wrappedKey, KEY_BYTES + TAG_BYTES);
    if (!recipientKey || !ephemeralKey || !wrapNonce || !wrapped) return refuse('MALFORMED', 'wrap');
    const own = x25519PublicKey(secret);
    if (!sameBytes(own, recipientKey)) refuse('WRONG_RECIPIENT');
    const { nonce, ciphertext } = readCiphertext(kind, delivery.nonce, delivery.ciphertext);
    const ss = sharedSecret(secret, ephemeralKey);
    const contentKey = decrypt(wrapKey(kind, setupId, slot, ss, ephemeralKey, own), wrapNonce, wrapAad(kind, setupId, slot), wrapped);
    return decrypt(contentKey, nonce, bodyAad(kind, setupId), ciphertext);
  });
}

/** Seals the link copy of an invitation under the link's content key (`link.ts`). */
export function sealWithLinkKey(setupId: Uint8Array, plaintext: Uint8Array, contentKey: Uint8Array, nonce: Uint8Array): Omit<WireSealed, 'wraps'> {
  assertSetupId(setupId);
  assertBytes(contentKey, KEY_BYTES, 'A content key');
  assertBytes(nonce, NONCE_BYTES, 'A nonce');
  if (plaintext.length > MAX_PLAINTEXT_BYTES.LINK) throw new TypeError(`LINK plaintext is at most ${MAX_PLAINTEXT_BYTES.LINK} bytes`);
  const ciphertext = xchacha20poly1305(contentKey, nonce, bodyAad('LINK', setupId)).encrypt(plaintext);
  return { nonce: bytesToHex(nonce), ciphertext: toBase64Url(ciphertext) };
}

export function openWithLinkKey(setupId: Uint8Array, sealed: { readonly nonce: unknown; readonly ciphertext: unknown }, contentKey: Uint8Array): InviteResult<Uint8Array> {
  assertSetupId(setupId);
  assertBytes(contentKey, KEY_BYTES, 'A content key');
  return attempt(() => {
    const { nonce, ciphertext } = readCiphertext('LINK', sealed?.nonce, sealed?.ciphertext);
    return decrypt(contentKey, nonce, bodyAad('LINK', setupId), ciphertext);
  });
}

/**
 * The server's decoy for `(network, credential, slot)`: HMAC-SHA256(serverSecret,
 * "gero-vault-invite/v1|DECOY|<network>|" || credential || slot) used as an X25519 secret, and its
 * public key. Stable for the same inputs, indistinguishable from a device key without the secret.
 * gero-sync's reference; the extension never calls it.
 */
export function decoyInviteKey(serverSecret: Uint8Array, network: InviteNetwork, credential: Uint8Array, slot: number): Uint8Array {
  if (!(serverSecret instanceof Uint8Array) || serverSecret.length < KEY_BYTES) throw new TypeError('A decoy secret is at least 32 bytes');
  if (!INVITE_NETWORKS.includes(network)) throw new TypeError('Unknown network');
  assertBytes(credential, CREDENTIAL_BYTES, 'A stake credential');
  if (!Number.isInteger(slot) || slot < 0 || slot >= DIRECTORY_SLOTS) throw new TypeError('A slot is 0 to 4');
  const scalar = hmac(sha256, serverSecret, concatBytes(ascii(`${DECOY_TAG}${network}|`), credential, Uint8Array.of(slot)));
  return x25519PublicKey(scalar);
}
