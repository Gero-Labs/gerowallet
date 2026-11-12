// Build a DApp Connector `makeIntent` swap intent on ledger 9. The ledger 8
// twin is midnightIntentBuilder.ts; the shape is the same:
//
//   the wallet's synced UTxOs, only those its own address owns → wallet SDK 2's
//   `Transacting.initSwap` (the wallet's inputs for what it gives, change back
//   to itself, and the outputs it wants, in ONE guaranteed unshielded offer) →
//   move that intent to the requested segment id → check the result against
//   the request → optionally add the DUST fee intent → prove (only the DUST
//   spends have a circuit) → sign the wallet's inputs → bind → serialize.
//
// The result is sealed and purposefully imbalanced: a surplus of what the
// wallet gives and a shortage of what it wants, for a counterparty to fill.
// Signing happens after the segment move, because a signature covers its
// segment id.
//
// As in midnightDappBalancer9.ts, wallet SDK 2 is used through its pure `/v2`
// capabilities on ledger-v9 objects, and coin selection reads the UTxOs the
// wallet already synced (gero-sync): nothing new subscribes to the indexer.
// Where the ledger 8 builder waits for its own SDK wallet to sync, this one
// refuses unless the wallet's sync follows the signing key (review S1).
//
// PRIVACY: never log tx hex, proofs or keys. Sizes, durations, counts only.

import * as ledger from '@midnightntwrk/ledger-v9';
import { CoinsAndBalances, Keys, Transacting } from 'midnight-v9-unshielded-wallet/v2';
import { MidnightBech32m, UnshieldedAddress } from 'midnight-v9-address-format';
import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { MidnightUnshieldedUtxo } from './midnightTypes';
import {
  assertIntentMatchesRequest, connectorIntentSyncReady, connectorSegmentSpecifier, CONNECTOR_INTENT_TTL_MS,
  IntentInsufficientFundsError, isSdkInsufficientFunds, MIDNIGHT_WALLET_NOT_SYNCED,
} from './midnightConnectorIntent';
import type { ConnectorIntentRequest, ExpectedIntentOutput } from './midnightConnectorIntent';
import { chooseCoin9, CONNECTOR_MINIMUM_DUST_SPENDS, ledger9WalletState } from './midnightDappBalancer9';
import { MidnightLedgerChangedError, midnightLedgerKey, midnightLedgerVersion } from './midnightLedger';
import { resolveMidnightLedger } from './midnightChainLedger';
import { balanceLedger9Fees, ledger9Keystore, signLedger9Intents } from './midnightLedger9';
import type { WalletProvingRequest } from './midnightProvingTarget';
import { describeWalletProving, walletProvingProvider } from './midnightWalletProver';
import { debugLog } from '@/utils/debug';

export interface BuildConnectorIntent9Args {
  readonly sdkNetworkId: string;
  readonly endpoints: MidnightNetworkEndpoints;
  /** Validated by `validateConnectorIntentRequest`. */
  readonly request: ConnectorIntentRequest;
  /** Sender's NightExternal secret key. Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
  /** Sender's DUST secret seed, used only when `request.payFees`. Caller wipes after. */
  readonly dustSecretSeed: Uint8Array;
  /** The wallet's synced unshielded UTxOs (midnightStore.utxos). */
  readonly utxos: readonly MidnightUnshieldedUtxo[];
  /** The sync those UTxOs came from (midnightStore): when, and for which address. */
  readonly sync: { readonly lastSync: number | null; readonly addresses: { readonly unshielded?: string | null } };
  /** Where the DUST fee proof is made; unused when `request.payFees` is false. */
  readonly proving: WalletProvingRequest;
  /** Defaults to now + CONNECTOR_INTENT_TTL_MS. */
  readonly ttl?: Date;
}

export interface BuildConnectorIntent9Result {
  /** Sealed (`signature / proof / binding`) ledger 9 tx hex. */
  readonly txHex: string;
  /** The segment id the intent landed on. */
  readonly segmentId: number;
  readonly proveDurationMs: number;
}

/** Injected so the pipeline is unit-testable without a DUST sync or a proof server. */
export interface BuildConnectorIntent9Deps {
  balanceFees: typeof balanceLedger9Fees;
  provingProvider: (proving: WalletProvingRequest, sdkNetworkId: string) => Promise<ledger.ProvingProvider>;
}

const defaultDeps: BuildConnectorIntent9Deps = {
  balanceFees: balanceLedger9Fees,
  provingProvider: async (proving, sdkNetworkId) =>
    await walletProvingProvider(proving, { sdkNetworkId, shielded: false, ledger: 9 }) as unknown as ledger.ProvingProvider,
};

/** An intent without a DUST spend has no circuit: proving only turns the markers. */
const noCircuitProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected proof-server call while proving an intent without circuits'); },
  prove: async () => { throw new Error('unexpected proof-server call while proving an intent without circuits'); },
  lookupKey: async () => undefined,
};

/** Throws `MidnightLedgerChangedError` unless the chain was last read on ledger 9. */
function requireLedger9(network: string): void {
  const current = midnightLedgerVersion(network);
  if (current !== 9) throw new MidnightLedgerChangedError(network, current);
}

export async function buildConnectorIntent9(
  args: BuildConnectorIntent9Args,
  deps: BuildConnectorIntent9Deps = defaultDeps,
): Promise<BuildConnectorIntent9Result> {
  const network = midnightLedgerKey(args.sdkNetworkId);
  if (args.endpoints.sdkNetworkId !== network) throw new Error('Midnight endpoint network mismatch');
  // The caller routed here on a chain read (resolveMidnightLedger); before the read, this throws MIDNIGHT_LEDGER_UNKNOWN.
  requireLedger9(network);
  const { request } = args;
  const ttl = args.ttl ?? new Date(Date.now() + CONNECTOR_INTENT_TTL_MS);
  const keystore = ledger9Keystore(args.unshieldedSecretKey, network);
  const ownAddress = keystore.getAddress();
  // Review S1: coins come from the wallet's own sync, so it must follow this key.
  if (!connectorIntentSyncReady(args.sync, keystore.getBech32Address().toString())) throw new Error(MIDNIGHT_WALLET_NOT_SYNCED);
  debugLog('🌙 dapp intent (ledger 9): start', {
    network, inputs: request.inputs.length, outputs: request.outputs.length, payFees: request.payFees,
  });

  const transfers = request.outputs.map((output) => ({
    amount: BigInt(output.value),
    type: output.type,
    receiverAddress: UnshieldedAddress.codec.decode(network, MidnightBech32m.parse(output.recipient)),
  }));
  const expectedOutputs: ExpectedIntentOutput[] = transfers.map((transfer) => ({
    owner: transfer.receiverAddress.hexString, type: transfer.type, value: transfer.amount,
  }));
  const give: Record<ledger.RawTokenType, bigint> = Object.create(null);
  for (const input of request.inputs) give[input.type] = BigInt(input.value);

  const keysCapability = Keys.makeDefaultKeysCapability();
  const capability = Transacting.makeDefaultTransactingCapability({ networkId: network }, () => ({
    coinSelection: chooseCoin9,
    coinsAndBalancesCapability: CoinsAndBalances.makeDefaultCoinsAndBalancesCapability(),
    keysCapability,
  }));
  // Only rows the indexer reports as this key's address (the owner filter).
  const swap = capability.initSwap(ledger9WalletState(network, keystore, args.utxos), give, transfers, ttl);
  if (swap._tag === 'Left') {
    if (isSdkInsufficientFunds(swap.left)) throw new IntentInsufficientFundsError();
    throw swap.left;
  }
  const built = [...(swap.right.transaction.intents?.values() ?? [])];
  if (built.length !== 1) throw new Error('The wallet built an unexpected number of intents');

  // initSwap always uses segment 1; move the intent where the dapp asked.
  const homed = ledger.Transaction.fromParts(network).addIntent(connectorSegmentSpecifier(request.intentId), built[0]);
  const segmentId = [...(homed.intents?.keys() ?? [])][0];
  if (segmentId === undefined) throw new Error('The intent could not be placed in a segment');
  assertIntentMatchesRequest<ledger.SignatureVerifyingKey>(homed, {
    segmentId, request, expectedOutputs, ownAddress, addressOfKey: ledger.addressFromKey,
  });
  debugLog('🌙 dapp intent (ledger 9): built', { segmentId });

  const costModel = ledger.CostModel.initialCostModel();
  let proven: ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;
  let proveDurationMs = 0;
  if (request.payFees) {
    // The counterparty may complete the swap with a contract call, whose fee
    // ledger 9 can reject when paid with exactly one DUST spend: pay as a
    // connector fee, with two when the wallet holds two coins.
    const fee = await deps.balanceFees({
      sdkNetworkId: network, endpoints: args.endpoints, dustSecretSeed: args.dustSecretSeed, ttl,
      minimumDustSpends: CONNECTOR_MINIMUM_DUST_SPENDS,
    }, [homed]);
    const merged = homed.merge(fee);
    // URL only — never the auth header values.
    debugLog('🌙 dapp intent (ledger 9): proving the fee', { prover: describeWalletProving(args.proving) });
    const proveStart = Date.now();
    const provider = await deps.provingProvider(args.proving, network);
    proven = await merged.prove(provider, costModel);
    proveDurationMs = Date.now() - proveStart;
  } else {
    proven = await homed.prove(noCircuitProver, costModel);
  }

  const signed = signLedger9Intents(proven, keystore);
  const sealed = signed.bind().serialize();
  // The chain-ledger agreement: re-reads the chain's ledger (cached for up to a
  // minute) and never hands out ledger 9 bytes for a chain reported on another.
  if (await resolveMidnightLedger(network) !== 9) throw new MidnightLedgerChangedError(network, midnightLedgerVersion(network));
  debugLog('🌙 dapp intent (ledger 9): sealed', { bytes: sealed.length, proveDurationMs });
  return { txHex: Buffer.from(sealed).toString('hex'), segmentId, proveDurationMs };
}
