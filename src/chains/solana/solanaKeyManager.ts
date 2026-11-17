/**
 * Solana keys: SLIP-0010 ed25519 derivation from a BIP-39 phrase, and base58 addresses.
 *
 * Built only on @noble primitives (no bip39 / Buffer), so it runs unchanged in the
 * background worker, whose pbkdf2 shim breaks other libraries' derivation
 * (see `rootKeyFromMnemonic.ts`).
 */
import * as ed25519 from '@noble/ed25519';
import { hmac } from '@noble/hashes/hmac.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { solanaAccountPathIndexes } from './solanaPaths';
import { base58Decode, base58Encode } from './solanaBase58';

if (!ed25519.hashes.sha512) {
  ed25519.hashes.sha512 = sha512;
}

const textEncoder = new TextEncoder();
const ED25519_SEED_KEY = textEncoder.encode('ed25519 seed');

export interface SolanaKeypair {
  /** 32-byte ed25519 private seed. Never persist or log it. */
  secretKey: Uint8Array;
  /** 32-byte ed25519 public key. */
  publicKey: Uint8Array;
  /** Base58 public key: the Solana address. */
  address: string;
}

/** BIP-39 seed (64 bytes) from a phrase, with an optional passphrase. */
export function solanaSeedFromMnemonic(mnemonic: string, passphrase = ''): Uint8Array {
  const words = mnemonic.trim().split(/\s+/).join(' ').normalize('NFKD');
  const salt = `mnemonic${passphrase}`.normalize('NFKD');
  return pbkdf2(sha512, textEncoder.encode(words), textEncoder.encode(salt), { c: 2048, dkLen: 64 });
}

/** SLIP-0010 ed25519 derivation (hardened indexes only). Returns the 32-byte private seed. */
export function slip10DeriveEd25519(seed: Uint8Array, hardenedIndexes: number[]): Uint8Array {
  let digest = hmac(sha512, ED25519_SEED_KEY, seed);
  let key = digest.slice(0, 32);
  let chainCode = digest.slice(32);
  for (const index of hardenedIndexes) {
    if (index < 0x80000000 || index > 0xffffffff) {
      throw new Error('SLIP-0010 ed25519 supports hardened indexes only');
    }
    const data = new Uint8Array(37);
    data[0] = 0;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, index, false);
    digest = hmac(sha512, chainCode, data);
    key.fill(0);
    data.fill(0);
    key = digest.slice(0, 32);
    chainCode = digest.slice(32);
  }
  chainCode.fill(0);
  return key;
}

/** Keypair for Solana account `account` (`m/44'/501'/account'/0'`) from a BIP-39 seed. */
export function deriveSolanaKeypairFromSeed(seed: Uint8Array, account = 0): SolanaKeypair {
  const secretKey = slip10DeriveEd25519(seed, solanaAccountPathIndexes(account));
  const publicKey = ed25519.getPublicKey(secretKey);
  return { secretKey, publicKey, address: base58Encode(publicKey) };
}

/** Keypair for Solana account `account` from a recovery phrase. */
export function deriveSolanaKeypairFromMnemonic(mnemonic: string, account = 0, passphrase = ''): SolanaKeypair {
  const seed = solanaSeedFromMnemonic(mnemonic, passphrase);
  try {
    return deriveSolanaKeypairFromSeed(seed, account);
  } finally {
    seed.fill(0);
  }
}

/** Address of Solana account `account` from a recovery phrase (the private key is wiped). */
export function deriveSolanaAddressFromMnemonic(mnemonic: string, account = 0): string {
  const keypair = deriveSolanaKeypairFromMnemonic(mnemonic, account);
  keypair.secretKey.fill(0);
  return keypair.address;
}

/** Decodes a base58 Solana address to its 32 bytes, or throws. */
export function solanaAddressToBytes(address: string): Uint8Array {
  const bytes = base58Decode(address);
  if (bytes.length !== 32) {
    throw new Error('A Solana address is 32 bytes');
  }
  return bytes;
}

/**
 * True for a well-formed Solana address: base58 of exactly 32 bytes. This accepts
 * off-curve addresses (program-derived addresses), which are valid transfer targets.
 */
export function isValidSolanaAddress(address: unknown): address is string {
  if (typeof address !== 'string' || address.length < 32 || address.length > 44) return false;
  try {
    return base58Decode(address).length === 32;
  } catch {
    return false;
  }
}

/** True when `address` is a point on the ed25519 curve, i.e. a key someone can sign for. */
export function isOnCurveSolanaAddress(address: string): boolean {
  try {
    ed25519.Point.fromBytes(solanaAddressToBytes(address));
    return true;
  } catch {
    return false;
  }
}
