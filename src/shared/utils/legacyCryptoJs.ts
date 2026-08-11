import { md5 } from '@noble/hashes/legacy.js';
import { cbc } from '@noble/ciphers/aes.js';

/**
 * Decrypt-only, byte-for-byte reimplementation of the single CryptoJS call the
 * wallet still relies on for backward compatibility:
 *
 *   CryptoTS.AES.decrypt(blob, password).toString(CryptoTS.enc.Utf8)
 *
 * where `blob` was produced by `CryptoJS.AES.encrypt(message, passwordString)`.
 * That default (password-string) mode uses the OpenSSL "Salted__" envelope with
 * EVP_BytesToKey (MD5, 1 iteration) key derivation and AES-256-CBC / PKCS7.
 *
 * This exists ONLY to read legacy blobs written before the migration to the
 * strong Argon2id/XChaCha20 (`gpw1.`) and raw-hex PBKDF2/ChaCha20 formats. It
 * lets us drop the `crypto-ts` dependency (which transitively pulled in
 * `@angular/*`, ~12 Dependabot alerts) without a data migration. Do NOT use it
 * to encrypt anything new — the KDF is intentionally the weak legacy one.
 */

// "Salted__" magic prefix of the OpenSSL format.
const SALTED = Uint8Array.from([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]);
const KEY_LEN = 32; // AES-256
const IV_LEN = 16;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * OpenSSL EVP_BytesToKey with MD5 and a single iteration — exactly what CryptoJS
 * uses to turn a password string + salt into an AES key and IV.
 */
function evpBytesToKey(password: Uint8Array, salt: Uint8Array): { key: Uint8Array; iv: Uint8Array } {
  const total = KEY_LEN + IV_LEN;
  const derived = new Uint8Array(total);
  let filled = 0;
  let block = new Uint8Array(0);
  while (filled < total) {
    const input = new Uint8Array(block.length + password.length + salt.length);
    input.set(block, 0);
    input.set(password, block.length);
    input.set(salt, block.length + password.length);
    block = md5(input);
    const take = Math.min(block.length, total - filled);
    derived.set(block.subarray(0, take), filled);
    filled += take;
  }
  return { key: derived.subarray(0, KEY_LEN), iv: derived.subarray(KEY_LEN, total) };
}

/**
 * Decrypt a legacy CryptoJS/`crypto-ts` AES blob. Throws on a wrong password or
 * tampering (invalid PKCS7 padding), matching the old code, which threw on
 * malformed output. Never returns a partial/garbage secret.
 */
export function decryptLegacyAes(blob: string, password: string): string {
  const raw = base64ToBytes(blob);
  if (raw.length < 16 || !SALTED.every((b, i) => raw[i] === b)) {
    throw new Error('Malformed legacy secret blob');
  }
  const salt = raw.subarray(8, 16);
  const ciphertext = raw.subarray(16);
  const { key, iv } = evpBytesToKey(new TextEncoder().encode(password), salt);
  // cbc() applies PKCS7 by default and throws on invalid padding (wrong password).
  const plaintext = cbc(key, iv).decrypt(ciphertext);
  return new TextDecoder().decode(plaintext);
}
