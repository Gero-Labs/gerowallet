// Wallet records outlive the networks they were created on. When a network
// leaves the build (`networks.ts`), its records stay in gero-db: they are not
// listed, not logged in and not counted, but nothing deletes them.
import networks from '@/utils/networks';

type NetworkRef = { chain?: string; network?: string } | null | undefined;

/** Whether this build has the wallet's chain and network. */
export function isOnSupportedNetwork(wallet: NetworkRef): boolean {
  return !!wallet && !!networks.resolveNetwork(wallet.chain ?? '', wallet.network ?? '');
}

/**
 * A record that names a chain and network this build no longer has. A record
 * missing either field is not judged here: it names no network at all.
 */
export function isOnRemovedNetwork(wallet: NetworkRef): boolean {
  return !!wallet?.chain && !!wallet.network && !networks.resolveNetwork(wallet.chain, wallet.network);
}

/** The records of a wallet list or id-keyed map that this build can still open. */
export function supportedWallets<T extends NetworkRef>(wallets: T[] | Record<string | number, T> | null | undefined): T[] {
  const list = Array.isArray(wallets) ? wallets : Object.values(wallets ?? {});
  return list.filter(isOnSupportedNetwork);
}
