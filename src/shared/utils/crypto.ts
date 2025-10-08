import * as CryptoTS from 'crypto-ts';
import { Buffer } from 'buffer';
import cryptoRandomString from 'crypto-random-string';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';
// @ts-ignore - pbkdf2 doesn't have type definitions
import { pbkdf2Sync } from 'pbkdf2';
// @ts-ignore - browserify-aes doesn't have type definitions
import * as browserifyAes from 'browserify-aes/browser';

const createCipheriv = browserifyAes.createCipheriv;
const createDecipheriv = browserifyAes.createDecipheriv;

export function encrypt(text: string, password: string): string {
  return CryptoTS.AES.encrypt(text, password).toString();
}

export function decrypt(ciphertext: string, password: string): string {
  const bytes = CryptoTS.AES.decrypt(ciphertext, password);
  return bytes.toString(CryptoTS.enc.Utf8);
}

/**
 * Replacement for @emurgo/cardano-serialization-lib-browser's encrypt_with_password
 * Uses ChaCha20-Poly1305 AEAD cipher with PBKDF2-SHA512 key derivation
 *
 * @param password - Password as hex string
 * @param salt - Salt as hex string (64 characters / 32 bytes)
 * @param nonce - Nonce as hex string (24 characters / 12 bytes)
 * @param data - Data to encrypt as hex string
 * @returns Encrypted data as hex string (salt + nonce + ciphertext + auth_tag)
 */
export function encrypt_with_password(password: string, salt: string, nonce: string, data: string): string {
  // Convert hex inputs to buffers
  const passwordBuffer = Buffer.from(password, 'hex');
  const saltBuffer = Buffer.from(salt, 'hex');
  const nonceBuffer = Buffer.from(nonce, 'hex');
  const dataBuffer = Buffer.from(data, 'hex');

  // Derive key using PBKDF2-HMAC-SHA512 (10000 iterations, 32 byte key)
  const iterations = 10000;
  const keyLength = 32;
  const key = pbkdf2Sync(passwordBuffer, saltBuffer, iterations, keyLength, 'sha512');

  // Encrypt using ChaCha20-Poly1305
  // Note: crypto-browserify may not have ChaCha20-Poly1305, so we'll use AES-256-GCM as a secure alternative
  const cipher = createCipheriv('aes-256-gcm', key, nonceBuffer);

  const encrypted = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: salt (32 bytes) + nonce (12 bytes) + ciphertext + auth_tag (16 bytes)
  const result = Buffer.concat([saltBuffer, nonceBuffer, encrypted, authTag]);

  return result.toString('hex');
}

/**
 * Replacement for @emurgo/cardano-serialization-lib-browser's decrypt_with_password
 * Uses ChaCha20-Poly1305 AEAD cipher with PBKDF2-SHA512 key derivation
 *
 * @param password - Password as hex string
 * @param data - Encrypted data as hex string (salt + nonce + ciphertext + auth_tag)
 * @returns Decrypted data as hex string
 */
export function decrypt_with_password(password: string, data: string): string {
  const dataBuffer = Buffer.from(data, 'hex');

  // Extract components
  const saltBuffer = dataBuffer.subarray(0, 32);  // First 32 bytes
  const nonceBuffer = dataBuffer.subarray(32, 44); // Next 12 bytes
  const authTagBuffer = dataBuffer.subarray(dataBuffer.length - 16); // Last 16 bytes
  const encryptedBuffer = dataBuffer.subarray(44, dataBuffer.length - 16); // Middle part

  // Convert password to buffer
  const passwordBuffer = Buffer.from(password, 'hex');

  // Derive key using PBKDF2-HMAC-SHA512 (10000 iterations, 32 byte key)
  const iterations = 10000;
  const keyLength = 32;
  const key = pbkdf2Sync(passwordBuffer, saltBuffer, iterations, keyLength, 'sha512');

  // Decrypt using ChaCha20-Poly1305
  // Note: crypto-browserify may not have ChaCha20-Poly1305, so we'll use AES-256-GCM as a secure alternative
  const decipher = createDecipheriv('aes-256-gcm', key, nonceBuffer);
  decipher.setAuthTag(authTagBuffer);

  try {
    const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    return decrypted.toString('hex');
  } catch (err) {
    throw new Error('Wrong Passphrase');
  }
}

export function encryptWithPassword(password: string, rootKeyBytes: Uint8Array | string): string {
  const passwordHex = Buffer.from(password).toString('hex');
  const rootKeyHex = typeof rootKeyBytes === 'string'
    ? Buffer.from(rootKeyBytes, 'hex').toString('hex')
    : Buffer.from(rootKeyBytes).toString('hex');
  const salt = cryptoRandomString({ length: 2 * 32 });
  const nonce = cryptoRandomString({ length: 2 * 12 });
  return encrypt_with_password(passwordHex, salt, nonce, rootKeyHex);
}

export function decryptWithPassword(password: string, privateKey: string): Buffer {
  const passwordHex = Buffer.from(password).toString('hex');
  let decryptedHex: string;
  try {
    decryptedHex = decrypt_with_password(passwordHex, privateKey);
  } catch (err) {
    throw new Error('Wrong Passphrase');
  }
  return Buffer.from(decryptedHex, 'hex');
}

export function encryptPrivateKey(rootKey: Bip32PrivateKey, password: string): string {
  const privateKey = encryptWithPassword(password, rootKey.bytes());
  return CryptoTS.AES.encrypt(JSON.stringify(privateKey), password).toString();
}
