import { argon2id } from '@noble/hashes/argon2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { decryptLegacyAes } from './legacyCryptoJs';
import { toB64url, fromB64url } from './mpc/base64url';

/**
 * Password-based encryption for small UTF-8 secrets (mnemonic, MPC password
 * device share, 2FA seed/backup codes).
 *
 * New format `gpw1.<base64url>`: Argon2id(t=2, m≈19 MiB, p=1) → XChaCha20-Poly1305,
 * with the KDF params pinned in a versioned header so the cost can be raised later
 * while old blobs stay decryptable.
 *
 * This REPLACES the legacy `crypto.ts` `encrypt`/`decrypt` (crypto-ts / CryptoJS
 * AES with an MD5, single-iteration OpenSSL KDF — trivially brute-forceable
 * offline). `decryptSecret` still reads legacy blobs for backward compatibility;
 * callers should re-encrypt with `encryptSecret` on next unlock (see
 * `isLegacySecret`). The legacy read path is the only remaining use of crypto-ts
 * and can be removed once all wallets have migrated.
 */

const PREFIX = 'gpw1';
const SALT_LEN = 16;
const NONCE_LEN = 24;
const V1 = 1;
// OWASP-recommended Argon2id baseline (same params as the recovery-share format).
const ARGON = { t: 2, m: 19_456 /* KiB ≈ 19 MiB */, p: 1 };
const HEADER_LEN = 1 + 4 + 4 + 4 + SALT_LEN + NONCE_LEN; // version | t | m | p | salt | nonce = 53

const te = new TextEncoder();
const td = new TextDecoder();

function argonKey(password: string, salt: Uint8Array, t: number, m: number, p: number): Uint8Array {
  return argon2id(te.encode(password), salt, { t, m, p, dkLen: 32 });
}

/** True if `blob` is NOT the new Argon2id envelope (i.e. a legacy crypto-ts blob or empty). */
export function isLegacySecret(blob: string | null | undefined): boolean {
  return !(typeof blob === 'string' && blob.startsWith(`${PREFIX}.`));
}

/** Encrypt a UTF-8 secret under a password (Argon2id → XChaCha20-Poly1305). */
export function encryptSecret(plaintext: string, password: string): string {
  if (!password) throw new Error('Password cannot be empty');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const { t, m, p } = ARGON;
  const key = argonKey(password, salt, t, m, p);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(te.encode(plaintext));

  const blob = new Uint8Array(HEADER_LEN + ciphertext.length);
  const view = new DataView(blob.buffer);
  blob[0] = V1;
  view.setUint32(1, t, false);
  view.setUint32(5, m, false);
  view.setUint32(9, p, false);
  blob.set(salt, 13);
  blob.set(nonce, 13 + SALT_LEN);
  blob.set(ciphertext, HEADER_LEN);
  return `${PREFIX}.${toB64url(blob)}`;
}

/**
 * Decrypt a secret. Handles both the new Argon2id envelope and legacy crypto-ts
 * blobs. Throws on a wrong password or tampering (never returns a partial/empty
 * secret).
 */
export function decryptSecret(blob: string, password: string): string {
  if (!password) throw new Error('Password cannot be empty');

  if (!isLegacySecret(blob)) {
    const raw = fromB64url(blob.slice(PREFIX.length + 1));
    if (raw.length < HEADER_LEN || raw[0] !== V1) throw new Error('Malformed secret blob');
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const t = view.getUint32(1, false);
    const m = view.getUint32(5, false);
    const p = view.getUint32(9, false);
    const salt = raw.subarray(13, 13 + SALT_LEN);
    const nonce = raw.subarray(13 + SALT_LEN, HEADER_LEN);
    const ciphertext = raw.subarray(HEADER_LEN);
    const key = argonKey(password, salt, t, m, p);
    // XChaCha20-Poly1305 throws if the tag is invalid (wrong password / tampering).
    return td.decode(xchacha20poly1305(key, nonce).decrypt(ciphertext));
  }

  // Legacy CryptoJS blob — decrypt-only, for backward compatibility.
  const decrypted = decryptLegacyAes(blob, password);
  if (!decrypted) throw new Error('Wrong password');
  return decrypted;
}
