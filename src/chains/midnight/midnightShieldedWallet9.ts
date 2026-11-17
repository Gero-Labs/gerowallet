import * as ledger from '@midnightntwrk/ledger-v9';
import { CustomShieldedWallet, ShieldedWallet } from 'midnight-v9-shielded';
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

/** Wallet SDK 2's `V9NativeForkVersion`: the protocol version from which a chain runs ledger 9. */
const V9_FORK = 2_000_000n;

/**
 * Wallet SDK 2's fork-aware shielded wallet (`ShieldedWallet`): ledger 8
 * (`@midnightntwrk/ledger-v8`) below the fork, ledger 9 from it, handing over
 * at the crossing. For a chain that crossed the upgrade (mainnet, preprod),
 * whose notes and history start on ledger 8 (#1452 M9). It asks the indexer
 * which side the chain is on before it picks a variant.
 */
export function forkingShieldedWallet(
  networkId: string,
  endpoints: Pick<MidnightNetworkEndpoints, 'publicIndexerUrl' | 'publicIndexerWsUrl'>,
  txHistoryStorage: TransactionHistory.ShieldedHistoryStorage,
) {
  return ShieldedWallet({
    networkId,
    indexerClientConnection: {
      indexerHttpUrl: endpoints.publicIndexerUrl,
      indexerWsUrl: endpoints.publicIndexerWsUrl,
    },
    txHistoryStorage,
    // A branded bigint in the SDK; the brand is a type, not a value.
    forks: { v9: V9_FORK as never },
  });
}

export type ForkingShieldedWallet = Awaited<ReturnType<ReturnType<typeof forkingShieldedWallet>['startWithKeys']>>;

/**
 * Both ledgers' Zswap keys from one seed, as the fork-aware wallet starts with
 * them (`{ v8, v9 }`). Caller clears both.
 */
export async function shieldedKeysByEpoch(seed: Uint8Array): Promise<{ v8: import('@midnightntwrk/ledger-v8').ZswapSecretKeys; v9: ledger.ZswapSecretKeys }> {
  const ledger8 = await import('@midnightntwrk/ledger-v8');
  return { v8: ledger8.ZswapSecretKeys.fromSeed(seed), v9: ledger.ZswapSecretKeys.fromSeed(seed) };
}

/**
 * A ledger 9 send must be built by the ledger 9 side: a fork-aware wallet still
 * catching up on ledger 8 history would build a ledger 8 transaction the chain
 * can no longer read. The fork-aware wallet stamps each handle with the side
 * that built it (the ledger 9-only wallet stamps the SDK's minimum version, so
 * this is for the fork-aware one).
 */
export function assertLedger9Handle(handle: { readonly protocolVersion: bigint }): void {
  if (typeof handle.protocolVersion !== 'bigint' || handle.protocolVersion < V9_FORK) {
    throw new Error('The private wallet has not caught up with the ledger 9 upgrade yet; try again when it has');
  }
}

/**
 * SDK 2 returns transactions as version-stamped `WalletTransaction` handles.
 * Their own `serialize()` gives the bytes; this module's ledger reads them, so
 * no handle crosses between the SDK packages' separate copies of the
 * abstractions package (which would refuse a foreign handle).
 */
export function unprovenTransactionFromHandle(handle: { serialize(): Uint8Array }): ledger.UnprovenTransaction {
  return ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', handle.serialize());
}
