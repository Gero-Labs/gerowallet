/**
 * Bitcoin derivation paths, and the form the wallet stores an account key in.
 *
 * No dependencies, so the hardware wallet modules (also loaded for Cardano) can name
 * Bitcoin paths without bundling Bitcoin's crypto.
 */

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
 * The version bytes of every Bitcoin account key the wallet stores (`xpub`), on every
 * network: the network picks the addresses, not the key's encoding. Software wallets
 * derive keys in this form, so hardware wallets export or convert to it too.
 */
export const ACCOUNT_XPUB_VERSION = 0x0488b21e;

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

/** A Bitcoin account's derivation path: m/purpose'/coinType'/account' (coin type 1 off Mainnet). */
export function bitcoinAccountPath(network: string, addressType: string = 'segwit', accountIndex: number = 0): string {
  const purpose = getDerivationPurpose(addressType);
  const coinType = network === 'Mainnet' ? BitcoinCoinType : BitcoinTestnetCoinType;
  return `m/${purpose}'/${coinType}'/${accountIndex}'`;
}

/** The path of an account's address: its account path, then chain (1 = change) and index. */
export function bitcoinAddressPath(
  network: string,
  addressType: string,
  accountIndex: number,
  isChange: boolean,
  addressIndex: number,
): string {
  return `${bitcoinAccountPath(network, addressType, accountIndex)}/${isChange ? 1 : 0}/${addressIndex}`;
}

/** Trezor Connect's coin for the wallet's network (its testnet coin is Testnet4). */
export function trezorCoin(network: string): 'btc' | 'test' {
  return network === 'Mainnet' ? 'btc' : 'test';
}
