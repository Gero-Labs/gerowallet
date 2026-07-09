import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { argon2id } from '@noble/hashes/argon2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { toB64url, fromB64url } from './base64url';
import { RecoveryDecryptError } from './types';

const BLOB_PREFIX = 'gmpc-recovery1';
const SALT_LEN = 16;
const NONCE_LEN = 24;

// v1 (legacy, decrypt-only): version | iter(BE32) | salt(16) | nonce(24)
const V1 = 1;
const V1_HEADER_LEN = 1 + 4 + SALT_LEN + NONCE_LEN; // 45

// v2 (current): version | t(BE32) | m(BE32) | p(BE32) | salt(16) | nonce(24)
const V2 = 2;
// OWASP-recommended Argon2id baseline, extension-friendly. Pinned in the header
// so future tuning stays decryptable.
const V2_ARGON = { t: 2, m: 19_456 /* KiB = 19 MiB */, p: 1 };
const V2_HEADER_LEN = 1 + 4 + 4 + 4 + SALT_LEN + NONCE_LEN; // 53

function v1Key(password: string, salt: Uint8Array, iterations: number): Uint8Array {
  return pbkdf2(sha256, password, salt, { c: iterations, dkLen: 32 });
}

function v2Key(password: string, salt: Uint8Array, t: number, m: number, p: number): Uint8Array {
  return argon2id(password, salt, { t, m, p, dkLen: 32 });
}

/** Encrypt an encoded recovery share under a user passphrase (Argon2id v2). Safe to download. */
export async function encryptRecoveryShare(encodedShare: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const { t, m, p } = V2_ARGON;
  const key = v2Key(password, salt, t, m, p);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(encodedShare));

  const blob = new Uint8Array(V2_HEADER_LEN + ciphertext.length);
  const view = new DataView(blob.buffer);
  blob[0] = V2;
  view.setUint32(1, t, false);
  view.setUint32(5, m, false);
  view.setUint32(9, p, false);
  blob.set(salt, 13);
  blob.set(nonce, 13 + SALT_LEN);
  blob.set(ciphertext, V2_HEADER_LEN);
  return `${BLOB_PREFIX}.${toB64url(blob)}`;
}

/** Decrypt a recovery-share blob (v2 Argon2id or v1 PBKDF2). Throws RecoveryDecryptError. */
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
  const version = raw[0];
  let key: Uint8Array;
  let nonce: Uint8Array;
  let ciphertext: Uint8Array;

  if (version === V2) {
    if (raw.length < V2_HEADER_LEN) throw new RecoveryDecryptError('unsupported recovery backup version');
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const t = view.getUint32(1, false);
    const m = view.getUint32(5, false);
    const p = view.getUint32(9, false);
    const salt = raw.slice(13, 13 + SALT_LEN);
    nonce = raw.slice(13 + SALT_LEN, V2_HEADER_LEN);
    ciphertext = raw.slice(V2_HEADER_LEN);
    key = v2Key(password, salt, t, m, p);
  } else if (version === V1) {
    if (raw.length < V1_HEADER_LEN) throw new RecoveryDecryptError('unsupported recovery backup version');
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const iterations = view.getUint32(1, false);
    const salt = raw.slice(5, 5 + SALT_LEN);
    nonce = raw.slice(5 + SALT_LEN, V1_HEADER_LEN);
    ciphertext = raw.slice(V1_HEADER_LEN);
    key = v1Key(password, salt, iterations);
  } else {
    throw new RecoveryDecryptError('unsupported recovery backup version');
  }

  try {
    const plaintext = xchacha20poly1305(key, nonce).decrypt(ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new RecoveryDecryptError('wrong password or corrupted recovery backup');
  }
}
