import * as CryptoTS from 'crypto-ts';
import { Buffer } from 'buffer';
import cryptoRandomString from 'crypto-random-string';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';

// Lazy-loaded CSL crypto imports (WASM blocks extension initialization)
let encrypt_with_password: any = null;
let decrypt_with_password: any = null;

// Lazy load CSL crypto library to prevent WASM blocking
async function loadCSLCrypto() {
  if (!encrypt_with_password) {
    const csl = await import('@emurgo/cardano-serialization-lib-browser');
    encrypt_with_password = csl.encrypt_with_password;
    decrypt_with_password = csl.decrypt_with_password;
  }
}

export function encrypt(text: string, password: string): string {
  return CryptoTS.AES.encrypt(text, password).toString();
}

export function decrypt(ciphertext: string, password: string): string {
  const bytes = CryptoTS.AES.decrypt(ciphertext, password);
  return bytes.toString(CryptoTS.enc.Utf8);
}

export async function encryptWithPassword(password, rootKeyBytes): Promise<string> {
  await loadCSLCrypto();
  const passwordHex = Buffer.from(password).toString('hex');
  const rootKeyHex = Buffer.from(rootKeyBytes, 'hex').toString('hex');
  const salt = cryptoRandomString({ length: 2 * 32 });
  const nonce = cryptoRandomString({ length: 2 * 12 });
  return encrypt_with_password(passwordHex, salt, nonce, rootKeyHex);
}

export async function decryptWithPassword(password: string, privateKey): Promise<Buffer> {
  await loadCSLCrypto();
  const passwordHex = Buffer.from(password).toString('hex');
  let decryptedHex;
  try {
    decryptedHex = decrypt_with_password(passwordHex, privateKey);
  } catch (err) {
    throw new Error('Wrong Passphrase');
  }
  return Buffer.from(decryptedHex, 'hex');
}

export async function encryptPrivateKey(rootKey: Bip32PrivateKey, password: string): Promise<string> {
  const privateKey = await encryptWithPassword(password, rootKey.bytes());
  return CryptoTS.AES.encrypt(JSON.stringify(privateKey), password).toString();
}
