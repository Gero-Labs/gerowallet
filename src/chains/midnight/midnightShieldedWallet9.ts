import * as ledger from '@midnightntwrk/ledger-v9';
import { CustomShieldedWallet } from 'midnight-v9-shielded';
import { V2Builder, type TransactionHistory } from 'midnight-v9-shielded/v2';
import type { MidnightNetworkEndpoints } from './midnightConfig';

/**
 * Wallet SDK 2's ledger 9 shielded variant on its own (`CustomShieldedWallet`
 * over the V2 builder), without the ledger 8 variant the SDK's default
 * `ShieldedWallet` registers below the fork. It reads a chain from the ledger 9
 * side only, so it does not pull ledger 8 into the bundle.
 */
export function ledger9ShieldedWallet(
  networkId: string,
  endpoints: Pick<MidnightNetworkEndpoints, 'publicIndexerUrl' | 'publicIndexerWsUrl'>,
  txHistoryStorage: TransactionHistory.ShieldedHistoryStorage,
) {
  return CustomShieldedWallet({
    networkId,
    indexerClientConnection: {
      indexerHttpUrl: endpoints.publicIndexerUrl,
      indexerWsUrl: endpoints.publicIndexerWsUrl,
    },
    txHistoryStorage,
  }, new V2Builder().withDefaults());
}

export type Ledger9ShieldedWallet = ReturnType<ReturnType<typeof ledger9ShieldedWallet>['startWithSecretKeys']>;

/**
 * SDK 2 returns transactions as version-stamped `WalletTransaction` handles.
 * Their own `serialize()` gives the bytes; this module's ledger reads them, so
 * no handle crosses between the SDK packages' separate copies of the
 * abstractions package (which would refuse a foreign handle).
 */
export function unprovenTransactionFromHandle(handle: { serialize(): Uint8Array }): ledger.UnprovenTransaction {
  return ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', handle.serialize());
}
