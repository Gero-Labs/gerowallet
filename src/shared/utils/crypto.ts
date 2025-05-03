import * as CryptoTS from 'crypto-ts';

export function encrypt(text: string, password: string): string {
  return CryptoTS.AES.encrypt(text, password).toString();
}

export function decrypt(ciphertext: string, password: string): string {
  const bytes = CryptoTS.AES.decrypt(ciphertext, password);
  return bytes.toString(CryptoTS.enc.Utf8);
}
