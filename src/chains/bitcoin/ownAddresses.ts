import { deriveBitcoinAddressSetFromXpubs, type BitcoinAddressTypeName } from './bitcoinKeyManager';
import type { OwnBitcoinAddresses } from './psbtReview';

interface WalletLike {
  publicKey?: string;
  addressType?: string;
  network?: string;
  baseAddress?: string;
}

interface KeysLike {
  payment?: { address?: string }[];
  change?: { address?: string }[];
}

/**
 * The wallet's receive and change addresses: those of its account xpub (the
 * set the signer matches inputs against, 20 per chain), any keys a sync has
 * named, and its base address. Public data only.
 */
export function ownBitcoinAddresses(wallet: WalletLike, keys?: KeysLike | null): OwnBitcoinAddresses {
  const receive = new Set<string>();
  const change = new Set<string>();
  if (wallet.publicKey && wallet.network) {
    try {
      const addressType = (wallet.addressType || 'segwit').toLowerCase() as BitcoinAddressTypeName;
      const { derivationMap } = deriveBitcoinAddressSetFromXpubs({ [addressType]: wallet.publicKey }, wallet.network);
      for (const [address, info] of Object.entries(derivationMap)) {
        (info.chain === 1 ? change : receive).add(address);
      }
    } catch {
      // Not an account xpub: the synced keys and the base address still count
    }
  }
  for (const key of keys?.payment ?? []) if (key.address) receive.add(key.address);
  for (const key of keys?.change ?? []) if (key.address) change.add(key.address);
  if (wallet.baseAddress) receive.add(wallet.baseAddress);
  return { receive, change };
}
