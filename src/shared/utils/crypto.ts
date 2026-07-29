import * as CryptoTS from 'crypto-ts';
import { Buffer } from 'buffer';
import cryptoRandomString from 'crypto-random-string';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';
import { encryptSecret, decryptSecret, isLegacySecret } from './passwordSecret';
import i18n from '@/plugins/i18n';

/**
 * Encrypt a small UTF-8 secret (mnemonic, 2FA data, MPC password device share)
 * under a password. Now delegates to the strong Argon2id/XChaCha20 cipher
 * (`gpw1.` format); it no longer uses the weak crypto-ts / CryptoJS MD5-1-iter
 * KDF. Callers are unchanged. NOTE: not for CSL-format root-key blobs — those
 * use `encryptWithPassword` / `encryptPrivateKey`.
 */
export function encrypt(text: string, password: string): string {
  return encryptSecret(text, password);
}

/**
 * Decrypt a secret produced by `encrypt`. Transparently reads both the new
 * Argon2id format and legacy crypto-ts blobs (backward compatible), so existing
 * wallets keep working. The legacy branch is byte-for-byte the old behavior.
 */
export function decrypt(ciphertext: string, password: string): string {
  if (!isLegacySecret(ciphertext)) {
    return decryptSecret(ciphertext, password);
  }
  const bytes = CryptoTS.AES.decrypt(ciphertext, password);
  return bytes.toString(CryptoTS.enc.Utf8);
}

/**
 * Encrypts data with a password using ChaCha20-Poly1305 AEAD
 * Matches CSL's encrypt_with_password implementation exactly
 * CSL format: salt(32B) + nonce(12B) + tag(16B) + ciphertext as hex string
 * CSL converts all hex strings to bytes via hex::decode()
 * @param password - Password string
 * @param rootKeyBytes - Data to encrypt (hex string or Buffer)
 * @returns Hex string containing: salt + nonce + tag + ciphertext
 */
export function encryptWithPassword(password, rootKeyBytes): string {
  if (!password || password.length === 0) {
    throw new Error(i18n.t('common.passwordCannotBeEmpty') as string);
  }

  // Convert data to bytes
  const dataBytes = Buffer.from(rootKeyBytes, 'hex');

  // Generate random salt (32 bytes) and nonce (12 bytes) - CSL format
  const salt = Buffer.from(cryptoRandomString({ length: 2 * 32 }), 'hex');
  const nonce = Buffer.from(cryptoRandomString({ length: 2 * 12 }), 'hex');

  // CSL's password handling: password -> hex string -> hex::decode() to bytes
  const passwordHex = Buffer.from(password, 'utf8').toString('hex');
  const passwordBytes = Buffer.from(passwordHex, 'hex');

  // Derive key using PBKDF2 with HMAC-SHA512 (cryptoxide)
  const key = pbkdf2(sha512, passwordBytes, salt, {
    c: 19162, // CSL's iteration count
    dkLen: 32 // ChaCha20 key length
  });

  // Encrypt using ChaCha20-Poly1305
  const cipher = chacha20poly1305(key, nonce);
  const encrypted = cipher.encrypt(dataBytes);

  // ChaCha20-Poly1305 returns: ciphertext + tag (tag is last 16 bytes)
  const encryptedBytes = Buffer.from(encrypted);
  const ciphertext = encryptedBytes.subarray(0, encryptedBytes.length - 16);
  const tag = encryptedBytes.subarray(encryptedBytes.length - 16);

  // CSL format: salt + nonce + tag + ciphertext (tag BEFORE ciphertext!)
  const result = Buffer.concat([salt, nonce, tag, ciphertext]);
  return result.toString('hex');
}

/**
 * Decrypts data encrypted with encryptWithPassword
 * Matches CSL's decrypt_with_password implementation exactly
 * CSL format: salt(32B) + nonce(12B) + tag(16B) + ciphertext as hex string
 * CSL converts all hex strings to bytes via hex::decode()
 * @param password - Password string
 * @param encryptedData - Hex string containing: salt + nonce + tag + ciphertext
 * @returns Decrypted data as Buffer
 */
export function decryptWithPassword(password: string, encryptedData): Buffer {
  if (!password || password.length === 0) {
    throw new Error(i18n.t('common.passwordCannotBeEmpty') as string);
  }

  try {
    const encryptedBytes = Buffer.from(encryptedData, 'hex');

    // Extract components (CSL format: salt + nonce + tag + ciphertext)
    const salt = encryptedBytes.subarray(0, 32);
    const nonce = encryptedBytes.subarray(32, 44);
    const tag = encryptedBytes.subarray(44, 60);
    const ciphertext = encryptedBytes.subarray(60);

    // CSL's password handling: password -> hex string -> hex::decode() to bytes
    const passwordHex = Buffer.from(password, 'utf8').toString('hex');
    const passwordBytes = Buffer.from(passwordHex, 'hex');

    // Derive key using PBKDF2 with HMAC-SHA512 (cryptoxide)
    const key = pbkdf2(sha512, passwordBytes, salt, {
      c: 19162, // CSL's iteration count
      dkLen: 32 // ChaCha20 key length
    });

    // ChaCha20-Poly1305 expects: ciphertext + tag (tag at the end)
    const combined = Buffer.concat([ciphertext, tag]);

    // Decrypt using ChaCha20-Poly1305
    const cipher = chacha20poly1305(key, nonce);
    const decrypted = cipher.decrypt(combined);

    return Buffer.from(decrypted);
  } catch (err) {
    throw new Error(i18n.t('common.wrongPassphrase') as string);
  }
}

export function encryptPrivateKey(rootKey: Bip32PrivateKey, password: string): string {
  const privateKey = encryptWithPassword(password, rootKey.bytes());
  return CryptoTS.AES.encrypt(JSON.stringify(privateKey), password).toString();
}
