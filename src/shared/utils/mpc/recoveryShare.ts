import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { toB64url, fromB64url } from './base64url';
import { RecoveryDecryptError } from './types';

const BLOB_PREFIX = 'gmpc-recovery1';
const VERSION = 1;
const PBKDF2_ITERATIONS = 210_000;
const SALT_LEN = 16;
const NONCE_LEN = 24;
const HEADER_LEN = 1 + 4 + SALT_LEN + NONCE_LEN; // version | iter(BE32) | salt | nonce

function deriveKey(password: string, salt: Uint8Array, iterations: number): Uint8Array {
  return pbkdf2(sha256, password, salt, { c: iterations, dkLen: 32 });
}

/** Encrypt an encoded recovery share under a user password. Output is safe to download/store. */
export async function encryptRecoveryShare(encodedShare: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const key = deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(encodedShare));

  const blob = new Uint8Array(HEADER_LEN + ciphertext.length);
  const view = new DataView(blob.buffer);
  blob[0] = VERSION;
  view.setUint32(1, PBKDF2_ITERATIONS, false); // big-endian
  blob.set(salt, 5);
  blob.set(nonce, 5 + SALT_LEN);
  blob.set(ciphertext, HEADER_LEN);
  return `${BLOB_PREFIX}.${toB64url(blob)}`;
}

/** Decrypt a recovery-share blob. Throws RecoveryDecryptError on wrong password or corruption. */
export async function decryptRecoveryShare(blob: string, password: string): Promise<string> {
  const parts = blob.split('.');
  if (parts.length !== 2 || parts[0] !== BLOB_PREFIX) {
    throw new RecoveryDecryptError('invalid recovery backup format');
  }
  let raw: Uint8Array;
  try {
    raw = fromB64url(parts[1]);
  } catch {
    throw new RecoveryDecryptError('invalid recovery backup encoding');
  }
  if (raw.length < HEADER_LEN || raw[0] !== VERSION) {
    throw new RecoveryDecryptError('unsupported recovery backup version');
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const iterations = view.getUint32(1, false);
  const salt = raw.slice(5, 5 + SALT_LEN);
  const nonce = raw.slice(5 + SALT_LEN, HEADER_LEN);
  const ciphertext = raw.slice(HEADER_LEN);
  const key = deriveKey(password, salt, iterations);
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(key, nonce).decrypt(ciphertext);
  } catch {
    throw new RecoveryDecryptError('wrong password or corrupted recovery backup');
  }
  return new TextDecoder().decode(plaintext);
}
