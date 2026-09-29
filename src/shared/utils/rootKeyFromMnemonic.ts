import { Buffer } from 'buffer';
import * as bip39 from 'bip39';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { HDKey } from '@scure/bip32';
import { Blockchain } from '@/models/types';

/**
 * The root-key bytes a wallet stores in `encryptedPrivateKey`, re-derived from
 * its mnemonic. Mirrors `createWallet()` in gero-db.ts exactly:
 *  - Bitcoin: BIP-32 master private key (32 bytes) from the BIP-39 seed.
 *  - Midnight: the 64-byte BIP-39 seed itself.
 *  - Everything else (Cardano, Apex): the 96-byte Icarus / CIP-3 root key,
 *    `Bip32PrivateKey.fromBip39Entropy(entropy, '')`.
 *
 * Used to prove a decrypted root key and a decrypted mnemonic belong together
 * before either is rewritten. Built on @noble primitives rather than
 * `@cardano-sdk/crypto` so it works in the background bundle, whose pbkdf2 shim
 * breaks the SDK's BIP-32 derivation.
 */
export function rootKeyFromMnemonic(chain: string | undefined, mnemonic: string): Uint8Array {
  if (chain === Blockchain.BITCOIN) {
    const key = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic)).privateKey;
    if (!key) throw new Error('Could not derive Bitcoin root key');
    return key;
  }
  if (chain === Blockchain.MIDNIGHT) {
    return new Uint8Array(bip39.mnemonicToSeedSync(mnemonic));
  }
  // Icarus (CIP-3): PBKDF2-HMAC-SHA512(passphrase '', salt = entropy, 4096, 96), then clamp.
  const entropy = Uint8Array.from(Buffer.from(bip39.mnemonicToEntropy(mnemonic), 'hex'));
  const key = pbkdf2(sha512, new Uint8Array(0), entropy, { c: 4096, dkLen: 96 });
  key[0] &= 0b1111_1000;
  key[31] &= 0b0001_1111;
  key[31] |= 0b0100_0000;
  return key;
}
