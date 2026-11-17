// Build a DApp Connector `makeIntent` swap intent on ledger 8 (ledger 9:
// midnightIntentBuilder9.ts; the shared checks are in midnightConnectorIntent.ts):
//
//   start + sync the SDK unshielded wallet → `initSwap` (the wallet's inputs
//   for what it gives, change back to itself, and the outputs it wants, in
//   ONE guaranteed unshielded offer) → move that intent to the requested
//   segment id → check the result against the request → optionally add the
//   DUST fee intent → prove (only the DUST spend has a circuit) → sign the
//   wallet's inputs → bind → serialize.
//
// The result is sealed and purposefully imbalanced: a surplus of what the
// wallet gives and a shortage of what it wants, for a counterparty to fill.
// Signing happens after the segment move, because a signature covers its
// segment id.
//
// PRIVACY: never log tx hex, proofs or keys. Sizes, durations, counts only.

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import type { MidnightNetworkEndpoints } from './midnightConfig';
import { unreachableProver } from './midnightConnectorBalance';
import type { UnboundTransaction } from './midnightConnectorBalance';
import {
  assertIntentMatchesRequest as assertIntentMatchesRequestFor, connectorSegmentSpecifier, IntentInsufficientFundsError,
  isSdkInsufficientFunds, CONNECTOR_INTENT_TTL_MS,
} from './midnightConnectorIntent';
import type { ConnectorIntentRequest, ExpectedIntentOutput, IntentTxView } from './midnightConnectorIntent';
import { requireChainLedger8 } from './midnightChainLedger';
import type { WalletProvingRequest } from './midnightProvingTarget';
import { describeWalletProving, walletProvingProvider } from './midnightWalletProver';
import { debugLog } from '@/utils/debug';

// Kept importable from here for existing callers.
export { CONNECTOR_INTENT_TTL_MS, IntentInsufficientFundsError };
export type { ExpectedIntentOutput, IntentTxView };

/** Coin selection reads UTxO state; an unshielded sync is an indexer query, not a chain walk. */
const UNSHIELDED_SYNC_TIMEOUT_MS = 90_000;

export interface BuildConnectorIntentArgs {
  readonly sdkNetworkId: string;
  readonly endpoints: MidnightNetworkEndpoints;
  /** Validated by `validateConnectorIntentRequest`. */
  readonly request: ConnectorIntentRequest;
  /** Sender's NightExternal secret key. Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
  /** Sender's DUST secret seed, used only when `request.payFees`. Caller wipes after. */
  readonly dustSecretSeed: Uint8Array;
  readonly dustRegisteredAt?: Date;
  /** Where the DUST fee proof is made; unused when `request.payFees` is false. */
  readonly proving: WalletProvingRequest;
  /** Defaults to now + CONNECTOR_INTENT_TTL_MS. */
  readonly ttl?: Date;
}

export interface BuildConnectorIntentResult {
  /** Sealed (`signature / proof / binding`) tx hex. */
  readonly txHex: string;
  /** The segment id the intent landed on. */
  readonly segmentId: number;
  readonly proveDurationMs: number;
}

/** `TokenTransfer` from the SDK's Transacting module. */
interface SwapTransfer {
  readonly amount: bigint;
  readonly type: ledger.RawTokenType;
  readonly receiverAddress: UnshieldedAddress;
}

/** The slice of the SDK unshielded wallet this pipeline uses. */
export interface IntentSdkWallet {
  waitForSyncedState(allowedGap?: bigint): Promise<unknown>;
  initSwap(
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: readonly SwapTransfer[],
    ttl: Date,
  ): Promise<ledger.UnprovenTransaction>;
  signUnboundTransaction(tx: UnboundTransaction, sign: (data: Uint8Array) => ledger.Signature): Promise<UnboundTransaction>;
  stop(): Promise<void>;
}

/** Injected so the pipeline is unit-testable without SDK sync or a proof server. */
export interface BuildConnectorIntentDeps {
  startUnshieldedWallet: (sdkNetworkId: string, endpoints: MidnightNetworkEndpoints, secretKey: Uint8Array) =>
    Promise<{ wallet: IntentSdkWallet; keystore: { signData(data: Uint8Array): ledger.Signature; getAddress(): ledger.UserAddress } }>;
  balanceFees: (
    args: { sdkNetworkId: string; endpoints: MidnightNetworkEndpoints; dustSecretSeed: Uint8Array; ttl: Date; dustRegisteredAt?: Date },
    txs: ReadonlyArray<ledger.UnprovenTransaction>,
  ) => Promise<ledger.UnprovenTransaction>;
  provingProvider: (proving: WalletProvingRequest, sdkNetworkId: string) => Promise<ledger.ProvingProvider>;
}

async function defaultDeps(): Promise<BuildConnectorIntentDeps> {
  const { startUnshieldedWalletForKey, syncDustWalletAndBalanceFees } = await import('./midnightTxBuilder');
  return {
    startUnshieldedWallet: async (sdkNetworkId, endpoints, secretKey) => {
      const { wallet, keystore } = await startUnshieldedWalletForKey(sdkNetworkId, endpoints, secretKey);
      return { wallet: wallet as unknown as IntentSdkWallet, keystore };
    },
    balanceFees: (args, txs) => syncDustWalletAndBalanceFees(args, txs),
    provingProvider: (proving, sdkNetworkId) => walletProvingProvider(proving, { sdkNetworkId, shielded: false }),
  };
}

/** {@link assertIntentMatchesRequestFor} with ledger 8's `addressFromKey` unless one is given. */
export function assertIntentMatchesRequest(
  tx: IntentTxView,
  args: Omit<Parameters<typeof assertIntentMatchesRequestFor<ledger.SignatureVerifyingKey>>[1], 'addressOfKey'> & {
    addressOfKey?: (key: ledger.SignatureVerifyingKey) => ledger.UserAddress;
  },
): void {
  assertIntentMatchesRequestFor<ledger.SignatureVerifyingKey>(tx, { ...args, addressOfKey: args.addressOfKey ?? ledger.addressFromKey });
}

export async function buildConnectorIntent(
  args: BuildConnectorIntentArgs,
  deps?: BuildConnectorIntentDeps,
): Promise<BuildConnectorIntentResult> {
  await requireChainLedger8(args.sdkNetworkId, 'makeIntent');
  const { request } = args;
  const ttl = args.ttl ?? new Date(Date.now() + CONNECTOR_INTENT_TTL_MS);
  const d = deps ?? await defaultDeps();
  debugLog('🌙 dapp intent: start', {
    network: args.sdkNetworkId, inputs: request.inputs.length, outputs: request.outputs.length, payFees: request.payFees,
  });

  const transfers: SwapTransfer[] = request.outputs.map((output) => ({
    amount: BigInt(output.value),
    type: output.type,
    receiverAddress: UnshieldedAddress.codec.decode(args.sdkNetworkId, MidnightBech32m.parse(output.recipient)),
  }));
  const expectedOutputs: ExpectedIntentOutput[] = transfers.map((transfer) => ({
    owner: transfer.receiverAddress.hexString, type: transfer.type, value: transfer.amount,
  }));
  const give: Record<ledger.RawTokenType, bigint> = Object.create(null);
  for (const input of request.inputs) give[input.type] = BigInt(input.value);

  const { wallet, keystore } = await d.startUnshieldedWallet(args.sdkNetworkId, args.endpoints, args.unshieldedSecretKey);
  try {
    await Promise.race([
      wallet.waitForSyncedState(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Unshielded wallet sync timed out')), UNSHIELDED_SYNC_TIMEOUT_MS);
      }),
    ]);

    let swap: ledger.UnprovenTransaction;
    try {
      swap = await wallet.initSwap(give, transfers, ttl);
    } catch (error) {
      if (isSdkInsufficientFunds(error)) throw new IntentInsufficientFundsError();
      throw error;
    }
    const built = [...(swap.intents?.values() ?? [])];
    if (built.length !== 1) throw new Error('The wallet built an unexpected number of intents');

    // initSwap always uses segment 1; move the intent where the dapp asked.
    const homed = ledger.Transaction.fromParts(args.sdkNetworkId)
      .addIntent(connectorSegmentSpecifier(request.intentId), built[0] as ledger.UnprovenIntent);
    const segmentId = [...(homed.intents?.keys() ?? [])][0];
    if (segmentId === undefined) throw new Error('The intent could not be placed in a segment');
    assertIntentMatchesRequest(homed, {
      segmentId, request, expectedOutputs, ownAddress: keystore.getAddress(),
    });
    debugLog('🌙 dapp intent: built', { segmentId });

    const costModel = ledger.CostModel.initialCostModel();
    let proven: UnboundTransaction;
    let proveDurationMs = 0;
    if (request.payFees) {
      const fee = await d.balanceFees(
        {
          sdkNetworkId: args.sdkNetworkId, endpoints: args.endpoints, dustSecretSeed: args.dustSecretSeed,
          ttl, dustRegisteredAt: args.dustRegisteredAt,
        },
        [homed],
      );
      const merged = homed.merge(fee);
      // URL only — never the auth header values.
      debugLog('🌙 dapp intent: proving the fee', { prover: describeWalletProving(args.proving) });
      const proveStart = Date.now();
      const provider = await d.provingProvider(args.proving, args.sdkNetworkId);
      proven = await merged.prove(provider, costModel) as unknown as UnboundTransaction;
      proveDurationMs = Date.now() - proveStart;
    } else {
      // No DUST spend means no circuit: proving only turns the markers.
      proven = await homed.prove(unreachableProver, costModel) as unknown as UnboundTransaction;
    }

    const signed = await wallet.signUnboundTransaction(proven, (data) => keystore.signData(data));
    const sealed = (signed as unknown as { bind: () => { serialize: () => Uint8Array } }).bind().serialize();
    debugLog('🌙 dapp intent: sealed', { bytes: sealed.length, proveDurationMs });
    return { txHex: Buffer.from(sealed).toString('hex'), segmentId, proveDurationMs };
  } finally {
    try { await wallet.stop(); } catch { /* swallow */ }
  }
}
