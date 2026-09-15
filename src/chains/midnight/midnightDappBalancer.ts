// Balance a dapp's proven-but-unbound transaction (DApp Connector
// `balanceUnsealedTransaction`) on ledger 8:
//
//   decode → SDK balanceUnboundTransaction (the wallet's NIGHT inputs and
//   change are merged into the dapp's OWN intent) → DUST fee tx from the
//   existing helper → prove the fee tx wallet-side → merge → sign every
//   NightExternal segment → bind → serialize.
//
// The fee transaction is the only part that needs a ZK proof (a DUST spend),
// so it is the only part that touches the user's proof server. The dapp's
// contract proofs are untouched: PreBinding exists precisely so a wallet can
// add inputs and outputs before the transaction is bound.
//
// PRIVACY: never log tx hex, proofs or keys. Sizes, durations, colours only.

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { MidnightNetworkEndpoints } from './midnightConfig';
import { decodeUnboundTransaction, summarizeContributions } from './midnightConnectorBalance';
import type { ConnectorContribution, UnboundTransaction } from './midnightConnectorBalance';
import { requireMidnightLedger8 } from './midnightLedger';
import { debugLog } from '@/utils/debug';

export interface BalanceDappTransactionArgs {
  readonly sdkNetworkId: string;
  readonly endpoints: MidnightNetworkEndpoints;
  /** `signature / proof / pre-binding` tx hex from the dapp. */
  readonly txHex: string;
  /** Sender's NightExternal secret key. Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
  /** Sender's DUST secret seed. Caller wipes after. */
  readonly dustSecretSeed: Uint8Array;
  readonly dustRegisteredAt?: Date;
  /** Native-API proof server for the DUST fee proof (resolveDappProvingTarget). */
  readonly proving: { readonly url: string; readonly headers?: Record<string, string> };
}

export interface BalanceDappTransactionResult {
  /** Sealed (`signature / proof / binding`) tx hex, ready for submit-proven. */
  readonly txHex: string;
  readonly contributions: ConnectorContribution[];
  readonly proveDurationMs: number;
}

/** The slice of the SDK unshielded wallet this pipeline uses. */
export interface UnshieldedSdkWallet {
  waitForSyncedState(allowedGap?: bigint): Promise<unknown>;
  balanceUnboundTransaction(tx: UnboundTransaction): Promise<UnboundTransaction | undefined>;
  signUnboundTransaction(tx: UnboundTransaction, sign: (data: Uint8Array) => ledger.Signature): Promise<UnboundTransaction>;
  stop(): Promise<void>;
}

/** Injected so the pipeline is unit-testable without SDK sync or a proof server. */
export interface BalanceDappTransactionDeps {
  startUnshieldedWallet: (sdkNetworkId: string, endpoints: MidnightNetworkEndpoints, secretKey: Uint8Array) =>
    Promise<{ wallet: UnshieldedSdkWallet; keystore: { signData(data: Uint8Array): ledger.Signature } }>;
  balanceFees: (
    args: { sdkNetworkId: string; endpoints: MidnightNetworkEndpoints; dustSecretSeed: Uint8Array; ttl: Date; dustRegisteredAt?: Date },
    txs: ReadonlyArray<UnboundTransaction>,
  ) => Promise<ledger.UnprovenTransaction>;
}

/** Coin selection reads UTxO state; an unshielded sync is an indexer query, not a chain walk. */
const UNSHIELDED_SYNC_TIMEOUT_MS = 90_000;

async function defaultDeps(): Promise<BalanceDappTransactionDeps> {
  const { startUnshieldedWalletForKey, syncDustWalletAndBalanceFees } = await import('./midnightTxBuilder');
  return {
    startUnshieldedWallet: async (sdkNetworkId, endpoints, secretKey) => {
      const { wallet, keystore } = await startUnshieldedWalletForKey(sdkNetworkId, endpoints, secretKey);
      return { wallet: wallet as unknown as UnshieldedSdkWallet, keystore };
    },
    balanceFees: (args, txs) => syncDustWalletAndBalanceFees(args, txs),
  };
}

/** The dapp's own deadline bounds the wallet's fee intent; fall back to 5 minutes for a tx without intents. */
function earliestTtl(tx: UnboundTransaction): Date {
  let ttl: Date | undefined;
  for (const intent of tx.intents?.values() ?? []) {
    const candidate = (intent as { ttl?: Date }).ttl;
    if (candidate instanceof Date && (!ttl || candidate < ttl)) ttl = candidate;
  }
  return ttl ?? new Date(Date.now() + 5 * 60_000);
}

export async function balanceDappTransaction(
  args: BalanceDappTransactionArgs,
  deps?: BalanceDappTransactionDeps,
): Promise<BalanceDappTransactionResult> {
  requireMidnightLedger8(args.sdkNetworkId, 'Dapp transaction balancing');
  const tx = await decodeUnboundTransaction(args.txHex, args.sdkNetworkId);
  const contributions = summarizeContributions(tx);
  const ttl = earliestTtl(tx);
  const d = deps ?? await defaultDeps();
  const ledgerMod = await import('@midnight-ntwrk/ledger-v8');
  debugLog('🌙 dapp balance: start', {
    network: args.sdkNetworkId, bytes: args.txHex.length / 2, colours: contributions.length,
  });

  const { wallet, keystore } = await d.startUnshieldedWallet(args.sdkNetworkId, args.endpoints, args.unshieldedSecretKey);
  try {
    await Promise.race([
      wallet.waitForSyncedState(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Unshielded wallet sync timed out')), UNSHIELDED_SYNC_TIMEOUT_MS);
      }),
    ]);
    // `undefined` = nothing to balance (the dapp already covered every colour).
    const balanced = (await wallet.balanceUnboundTransaction(tx)) ?? tx;
    debugLog('🌙 dapp balance: inputs selected');

    const feeTx = await d.balanceFees(
      {
        sdkNetworkId: args.sdkNetworkId, endpoints: args.endpoints, dustSecretSeed: args.dustSecretSeed,
        ttl, dustRegisteredAt: args.dustRegisteredAt,
      },
      [balanced],
    );

    // URL only — never the auth header values.
    debugLog('🌙 dapp balance: proving fee tx wallet-side', { url: args.proving.url });
    const proveStart = Date.now();
    const { makeLocalProvingProvider } = await import('./midnightLocalProver');
    const provider = makeLocalProvingProvider(args.proving.url, { headers: args.proving.headers, sdkNetworkId: args.sdkNetworkId });
    const provenFee = await (feeTx as unknown as {
      prove: (p: ledger.ProvingProvider, c: ledger.CostModel) => Promise<UnboundTransaction>;
    }).prove(provider, ledgerMod.CostModel.initialCostModel());
    const proveDurationMs = Date.now() - proveStart;

    const merged = (balanced as unknown as { merge: (other: UnboundTransaction) => UnboundTransaction }).merge(provenFee);
    const signed = await wallet.signUnboundTransaction(merged, (data) => keystore.signData(data));
    const sealed = (signed as unknown as { bind: () => { serialize: () => Uint8Array } }).bind().serialize();
    debugLog('🌙 dapp balance: sealed', { bytes: sealed.length, proveDurationMs });
    return { txHex: Buffer.from(sealed).toString('hex'), contributions, proveDurationMs };
  } finally {
    try { await wallet.stop(); } catch { /* swallow */ }
  }
}
