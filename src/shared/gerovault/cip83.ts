/**
 * CIP-83 `basic` encryption, as CIP-0146 uses it for the optional registration fields:
 * OpenSSL `enc -aes-256-cbc -pbkdf2 -iter 10000 -a` with passphrase `cardano` by default.
 * The envelope is `"Salted__" || salt(8) || ciphertext`, base64, split into 64-character strings
 * (the metadata text limit). PBKDF2-HMAC-SHA256 gives 48 bytes: the AES key, then the IV.
 * PKCS#7 padding.
 *
 * With the default passphrase this only keeps the text from being read off the wire at a glance:
 * anyone can decrypt it. Key hashes, scripts and `types` are always public.
 */
import { cbc } from '@noble/ciphers/aes.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const CIP83_DEFAULT_PASSPHRASE = 'cardano';
export const CIP83_ITERATIONS = 10000;
export const CIP83_CHUNK = 64;

const SALTED = Uint8Array.from([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]);
const SALT_LEN = 8;
const KEY_LEN = 32;
const IV_LEN = 16;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function deriveKeyIv(passphrase: string, salt: Uint8Array): { key: Uint8Array; iv: Uint8Array } {
  const out = pbkdf2(sha256, new TextEncoder().encode(passphrase), salt, { c: CIP83_ITERATIONS, dkLen: KEY_LEN + IV_LEN });
  return { key: out.subarray(0, KEY_LEN), iv: out.subarray(KEY_LEN) };
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array | undefined {
  if (!BASE64.test(text) || text.length % 4 !== 0) return undefined;
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Encrypts `plaintext` and returns the base64 envelope split into 64-character chunks.
 * `salt` is for tests only; by default 8 random bytes are used, as OpenSSL does.
 */
export function cip83Encrypt(plaintext: string, passphrase: string = CIP83_DEFAULT_PASSPHRASE, salt?: Uint8Array): string[] {
  const s = salt ?? crypto.getRandomValues(new Uint8Array(SALT_LEN));
  if (s.length !== SALT_LEN) throw new Error('A CIP-83 salt is 8 bytes');
  const { key, iv } = deriveKeyIv(passphrase, s);
  const ciphertext = cbc(key, iv).encrypt(new TextEncoder().encode(plaintext));
  const envelope = new Uint8Array(SALTED.length + SALT_LEN + ciphertext.length);
  envelope.set(SALTED, 0);
  envelope.set(s, SALTED.length);
  envelope.set(ciphertext, SALTED.length + SALT_LEN);
  const b64 = toBase64(envelope);
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += CIP83_CHUNK) chunks.push(b64.slice(i, i + CIP83_CHUNK));
  return chunks;
}

/**
 * Joins the chunks and decrypts them. Returns `undefined` for a malformed envelope, a wrong
 * passphrase (bad padding) or a plaintext that is not UTF-8; never throws.
 */
export function cip83Decrypt(chunks: readonly string[], passphrase: string = CIP83_DEFAULT_PASSPHRASE): string | undefined {
  if (!Array.isArray(chunks) || chunks.length === 0 || chunks.some(c => typeof c !== 'string' || c.length > CIP83_CHUNK)) {
    return undefined;
  }
  const raw = fromBase64(chunks.join(''));
  if (!raw || raw.length < SALTED.length + SALT_LEN + IV_LEN || (raw.length - SALTED.length - SALT_LEN) % IV_LEN !== 0
    || !SALTED.every((b, i) => raw[i] === b)) {
    return undefined;
  }
  try {
    const { key, iv } = deriveKeyIv(passphrase, raw.subarray(SALTED.length, SALTED.length + SALT_LEN));
    const plaintext = cbc(key, iv).decrypt(raw.subarray(SALTED.length + SALT_LEN));
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch {
    return undefined;
  }
}
