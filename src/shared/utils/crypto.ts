import * as CryptoTS from 'crypto-ts';
import { Buffer } from 'buffer';
import cryptoRandomString from 'crypto-random-string';
import { decrypt_with_password, encrypt_with_password } from '@emurgo/cardano-serialization-lib-browser';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';

export function encrypt(text: string, password: string): string {
  return CryptoTS.AES.encrypt(text, password).toString();
}

export function decrypt(ciphertext: string, password: string): string {
  const bytes = CryptoTS.AES.decrypt(ciphertext, password);
  return bytes.toString(CryptoTS.enc.Utf8);
}

export function encryptWithPassword(password, rootKeyBytes): string {
  const passwordHex = Buffer.from(password).toString('hex');
  const rootKeyHex = Buffer.from(rootKeyBytes, 'hex').toString('hex');
  const salt = cryptoRandomString({ length: 2 * 32 });
  const nonce = cryptoRandomString({ length: 2 * 12 });
  return encrypt_with_password(passwordHex, salt, nonce, rootKeyHex);
}

export function decryptWithPassword(password: string, privateKey): Buffer {
  const passwordHex = Buffer.from(password).toString('hex');
  let decryptedHex;
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
