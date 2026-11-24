import { Network } from '@/models/types';

/**
 * Gero `Network` → the Midnight SDK's lowercase network id, as a dApp connector
 * request names it. Throws for a network the wallet does not run on: Stagenet is
 * retired (its wallets moved to Preview, issue 1453), so a dApp asking for
 * `stagenet` is refused like any other mismatch.
 */
export function midnightSdkNetworkId(network: string): string {
  switch (network) {
    case Network.MAINNET: return 'mainnet';
    case Network.PREVIEW: return 'preview';
    case Network.PREPROD: return 'preprod';
    case Network.TESTNET: return 'testnet';
    default: throw new Error(`Unsupported Midnight network: ${network}`);
  }
}

/**
 * True when a dApp's `connect(networkId)` names another network than the
 * wallet's. No id at all is no mismatch (the connector leaves it optional).
 */
export function isMidnightNetworkMismatch(requested: unknown, walletNetwork: string): boolean {
  if (requested === undefined || requested === null || requested === '') return false;
  return requested !== midnightSdkNetworkId(walletNetwork);
}
