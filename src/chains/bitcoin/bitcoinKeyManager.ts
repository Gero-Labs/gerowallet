/**
 * Bitcoin Key Manager
 *
 * Bitcoin key derivation using secp256k1 curve (not Ed25519 like Cardano).
 * Supports BIP44 (legacy), BIP84 (native SegWit), and BIP86 (Taproot) derivation paths.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { HDKey } from '@scure/bip32';
import * as bip39 from 'bip39';

// Initialize ECC library for bitcoinjs-lib
bitcoin.initEccLib(ecc);

/**
 * Bitcoin key derivation paths (BIP standards)
 */
export const BitcoinDerivationPaths = {
  BIP44: 44,      // Legacy P2PKH (1...)
  BIP49: 49,      // Nested SegWit P2SH-P2WPKH (3...)
  BIP84: 84,      // Native SegWit P2WPKH (bc1q...) [DEFAULT]
  BIP86: 86,      // Taproot P2TR (bc1p...)
};

export const BitcoinCoinType = 0;       // BIP44 coin type for Bitcoin
export const BitcoinTestnetCoinType = 1; // BIP44 coin type for Bitcoin Testnet

/**
 * Get derivation purpose based on address type
 */
export function getDerivationPurpose(addressType: string): number {
  switch (addressType) {
    case 'legacy':
      return BitcoinDerivationPaths.BIP44;
    case 'segwit':
      return BitcoinDerivationPaths.BIP84;  // DEFAULT
    case 'taproot':
      return BitcoinDerivationPaths.BIP86;
    default:
      return BitcoinDerivationPaths.BIP84;
  }
}

/**
 * Derive Bitcoin root key from BIP39 mnemonic
 *
 * @param mnemonic BIP39 mnemonic phrase (12 or 24 words)
 * @returns HDKey root key
 */
export function deriveBitcoinRootKey(mnemonic: string): HDKey {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  return HDKey.fromMasterSeed(seed);
}

/**
 * Derive account extended public key (xpub/ypub/zpub)
 * Path: m/purpose'/coin'/account'
 *
 * @param mnemonic BIP39 mnemonic phrase
 * @param network 'Mainnet' or 'Testnet'
 * @param addressType 'legacy' | 'segwit' | 'taproot'
 * @param accountIndex Account index (default: 0)
 * @returns Extended public key (base58 encoded)
 */
export function deriveBitcoinAccountXpub(
  mnemonic: string,
  network: string,
  addressType: string = 'segwit',
  accountIndex: number = 0
): string {
  const rootKey = deriveBitcoinRootKey(mnemonic);
  const purpose = getDerivationPurpose(addressType);
  const coinType = network === 'Mainnet' ? BitcoinCoinType : BitcoinTestnetCoinType;

  // Derive account key: m/purpose'/coinType'/account'
  const path = `m/${purpose}'/${coinType}'/${accountIndex}'`;
  const accountKey = rootKey.derive(path);

  // Return extended public key (xpub)
  return accountKey.publicExtendedKey;
}

/**
 * Derive Bitcoin address from extended public key
 * Path: xpub/chain/index (where chain=0 for external, 1 for internal/change)
 *
 * @param xpub Extended public key (base58 encoded)
 * @param network 'Mainnet' or 'Testnet'
 * @param addressType 'legacy' | 'segwit' | 'taproot'
 * @param chain 0 = external (receive), 1 = internal (change)
 * @param index Address index within chain
 * @returns Bitcoin address
 */
export function deriveBitcoinAddress(
  xpub: string,
  network: string,
  addressType: string = 'segwit',
  chain: number = 0,  // 0 = external (receive), 1 = internal (change)
  index: number = 0
): string {
  const bitcoinNetwork = network === 'Mainnet'
    ? bitcoin.networks.bitcoin
    : bitcoin.networks.testnet;

  // Derive child key from xpub
  const accountNode = HDKey.fromExtendedKey(xpub);
  // Use absolute path for derivation
  const path = `m/${chain}/${index}`;
  const childNode = accountNode.derive(path);

  if (!childNode.publicKey) {
    throw new Error('Failed to derive public key');
  }

  // Convert Uint8Array to Buffer for bitcoinjs-lib
  const pubkeyBuffer = Buffer.from(childNode.publicKey);

  switch (addressType) {
    case 'legacy':
      // P2PKH (1...)
      return bitcoin.payments.p2pkh({
        pubkey: pubkeyBuffer,
        network: bitcoinNetwork
      }).address!;

    case 'segwit':
      // P2WPKH (bc1q...)
      return bitcoin.payments.p2wpkh({
        pubkey: pubkeyBuffer,
        network: bitcoinNetwork
      }).address!;

    case 'taproot':
      // P2TR (bc1p...)
      // Taproot uses x-only pubkey (32 bytes without prefix)
      const slicedPubkey = childNode.publicKey.slice(1, 33);
      const internalPubkey: Buffer = Buffer.from(slicedPubkey);
      return bitcoin.payments.p2tr({
        internalPubkey,
        network: bitcoinNetwork
      }).address!;

    default:
      throw new Error(`Unknown address type: ${addressType}`);
  }
}

/**
 * Get the first receive address (external chain, index 0)
 *
 * @param xpub Extended public key
 * @param network 'Mainnet' or 'Testnet'
 * @param addressType 'legacy' | 'segwit' | 'taproot'
 * @returns First receive address
 */
export function getReceiveAddress(
  xpub: string,
  network: string,
  addressType: string = 'segwit'
): string {
  return deriveBitcoinAddress(xpub, network, addressType, 0, 0);
}

/**
 * Validate Bitcoin address
 *
 * @param address Bitcoin address to validate
 * @param network 'Mainnet' or 'Testnet'
 * @returns true if valid, false otherwise
 */
export function validateBitcoinAddress(address: string, network: string): boolean {
  try {
    const bitcoinNetwork = network === 'Mainnet'
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

    bitcoin.address.toOutputScript(address, bitcoinNetwork);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive x-only public key (32 bytes = 64 hex chars) from an account-level xpub.
 * Used for Babylon staking — the API requires the raw x-only pubkey of the
 * first external (receive) child key, not the xpub itself.
 *
 * @param xpub  Account xpub (base58 encoded, e.g. from m/84'/0'/0')
 * @param chain 0 = external (receive), 1 = internal (change)
 * @param index Child address index (0 = first address)
 * @returns 64-character hex string (x-only pubkey, no 02/03 prefix)
 */
export function deriveXOnlyPubKeyFromXpub(xpub: string, chain = 0, index = 0): string {
  const accountNode = HDKey.fromExtendedKey(xpub);
  const child = accountNode.derive(`m/${chain}/${index}`);
  if (!child.publicKey) throw new Error('Failed to derive public key from xpub');
  // Drop the 0x02/0x03 compression prefix → x-only 32 bytes → 64 hex chars
  return Buffer.from(child.publicKey.slice(1)).toString('hex');
}

/**
 * Derive multiple addresses for gap limit scanning
 *
 * @param xpub Extended public key
 * @param network 'Mainnet' or 'Testnet'
 * @param addressType 'legacy' | 'segwit' | 'taproot'
 * @param chain 0 = external, 1 = internal
 * @param count Number of addresses to derive
 * @param startIndex Starting index (default: 0)
 * @returns Array of addresses
 */
export function deriveAddressRange(
  xpub: string,
  network: string,
  addressType: string,
  chain: number,
  count: number,
  startIndex: number = 0
): string[] {
  const addresses: string[] = [];
  for (let i = 0; i < count; i++) {
    addresses.push(deriveBitcoinAddress(xpub, network, addressType, chain, startIndex + i));
  }
  return addresses;
}
