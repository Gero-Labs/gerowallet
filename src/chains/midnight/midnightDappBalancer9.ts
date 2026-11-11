// Balance a dapp's proven-but-unbound transaction (DApp Connector
// `balanceUnsealedTransaction`) on ledger 9. The ledger 8 twin is
// midnightDappBalancer.ts; the shape is the same:
//
//   decode → refuse a tx that already spends the wallet's coins → wallet SDK 2's
//   unshielded balancing (the wallet's NIGHT inputs and change merged into the
//   dapp's own intent) → DUST fee paid with two or more spends → prove the fee
//   tx wallet-side → merge → sign the wallet's inputs → bind → serialize.
//
// Wallet SDK 2 is used through its pure `/v2` capabilities on ledger-v9
// objects, never through `WalletTransaction` handles: each SDK package
// installs its own copy of the abstractions package, and a copy refuses a
// handle another sealed. Coin selection reads the UTxOs the wallet already
// synced (gero-sync), so nothing new subscribes to the indexer.
//
// PRIVACY: never log tx hex, proofs or keys. Sizes, durations, colours only.

import * as ledger from '@midnightntwrk/ledger-v9';
import { CoinsAndBalances, CoreWallet, Keys, Transacting, UnshieldedState } from 'midnight-v9-unshielded-wallet/v2';
import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { MidnightUnshieldedUtxo } from './midnightTypes';
import type { ConnectorContribution } from './midnightConnectorBalance';
import { midnightLedgerKey, midnightLedgerVersion, midnightNetworkName, strictMidnightHex } from './midnightLedger';
import { balanceLedger9Fees, ledger9Keystore, signLedger9Intents } from './midnightLedger9';
import type { WalletProvingRequest } from './midnightProvingTarget';
import { describeWalletProving, walletProvingProvider } from './midnightWalletProver';
import { debugLog } from '@/utils/debug';

/** A dapp's proven, not yet bound, ledger 9 transaction. */
export type UnboundTransaction9 = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

/**
 * A DApp's connector fee is a contract call's fee: ledger 9 can reject one paid
 * with exactly one DUST spend (`OutsideTimeToDismiss`, midnight-ledger#838).
 */
export const CONNECTOR_MINIMUM_DUST_SPENDS = 2;

export interface BalanceDappTransaction9Args {
  readonly sdkNetworkId: string;
  readonly endpoints: MidnightNetworkEndpoints;
  /** `signature / proof / pre-binding` tx hex from the dapp. */
  readonly txHex: string;
  /** Sender's NightExternal secret key. Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
  /** Sender's DUST secret seed. Caller wipes after. */
  readonly dustSecretSeed: Uint8Array;
  /** The wallet's synced unshielded UTxOs (midnightStore.utxos). */
  readonly utxos: readonly MidnightUnshieldedUtxo[];
  /** Where the DUST fee proof is made: this device, or the user's proof server. */
  readonly proving: WalletProvingRequest;
}

export interface BalanceDappTransaction9Result {
  /** Sealed (`signature / proof / binding`) tx hex, ready for submit-proven. */
  readonly txHex: string;
  readonly contributions: ConnectorContribution[];
  readonly proveDurationMs: number;
}

/** Injected so the pipeline is unit-testable without a DUST sync or a proof server. */
export interface BalanceDappTransaction9Deps {
  balanceFees: typeof balanceLedger9Fees;
  provingProvider: (proving: WalletProvingRequest, sdkNetworkId: string) => Promise<ledger.ProvingProvider>;
}

const defaultDeps: BalanceDappTransaction9Deps = {
  balanceFees: balanceLedger9Fees,
  provingProvider: async (proving, sdkNetworkId) =>
    await walletProvingProvider(proving, { sdkNetworkId, shielded: false, ledger: 9 }) as unknown as ledger.ProvingProvider,
};

/**
 * Decode `signature / proof / pre-binding` and prove it belongs to `network`:
 * the ledger refuses to merge transactions of different networks. Proofs are
 * erased for the check only; the result is discarded.
 */
export function decodeUnboundTransaction9(hex: string, network: string): UnboundTransaction9 {
  const tx: UnboundTransaction9 = ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', strictMidnightHex(hex));
  ledger.Transaction.fromParts(midnightLedgerKey(network)).eraseProofs().merge(tx.eraseProofs());
  return tx;
}

/** The dapp's own deadline bounds the wallet's fee intent; 5 minutes for a tx without intents. */
function earliestTtl(tx: UnboundTransaction9): Date {
  let ttl: Date | undefined;
  for (const intent of tx.intents?.values() ?? []) {
    if (!ttl || intent.ttl < ttl) ttl = intent.ttl;
  }
  return ttl ?? new Date(Date.now() + 5 * 60_000);
}

/** What the wallet must supply, per unshielded colour: the deficits `imbalances()` reports. */
export function summarizeContributions9(tx: UnboundTransaction9): ConnectorContribution[] {
  const totals = new Map<string, bigint>();
  const segments = new Set<number>([0, ...(tx.intents ? [...tx.intents.keys()] : [])]);
  for (const segment of segments) {
    for (const [token, value] of tx.imbalances(segment)) {
      if (token.tag !== 'unshielded' || value >= 0n) continue;
      totals.set(token.raw, (totals.get(token.raw) ?? 0n) - value);
    }
  }
  return [...totals].map(([token, amount]) => ({ token, amount: amount.toString() }));
}

/** Unsigned or signed, how many unshielded inputs of `tx` the wallet's key owns. */
export function countWalletOwnedInputs9(tx: UnboundTransaction9, key: ledger.SignatureVerifyingKey): number {
  let count = 0;
  for (const intent of tx.intents?.values() ?? []) {
    for (const offer of [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]) {
      for (const input of offer?.inputs ?? []) if (input.owner.tag === key.tag && input.owner.value === key.value) count++;
    }
  }
  return count;
}

function utxoTime(ctime: number | undefined): Date {
  if (!ctime || !Number.isFinite(ctime) || ctime < 0) return new Date(0);
  // The indexer reports seconds; tolerate milliseconds.
  return new Date(ctime < 1e12 ? ctime * 1000 : ctime);
}

/** The wallet's spendable UTxOs, as the SDK's coin selection reads them. */
function walletState(
  network: string,
  keystore: ReturnType<typeof ledger9Keystore>,
  utxos: readonly MidnightUnshieldedUtxo[],
) {
  const address = keystore.getAddress();
  const created = utxos
    .filter(u => /^[0-9a-fA-F]{64}$/.test(u.tokenType) && /^[0-9a-fA-F]{64}$/.test(u.intentHash) && u.value > 0n)
    .map(u => new UnshieldedState.UtxoWithMeta({
      utxo: { value: u.value, owner: address, type: u.tokenType.toLowerCase(), intentHash: u.intentHash.toLowerCase(), outputNo: u.outputIndex },
      meta: { ctime: utxoTime(u.ctime), registeredForDustGeneration: u.registeredForDustGeneration },
    }));
  const publicKey = {
    publicKey: keystore.getPublicKey(), addressHex: address, address: keystore.getBech32Address().toString(),
  };
  const applied = CoreWallet.applyUpdate(CoreWallet.init(publicKey, network), { createdUtxos: created, spentUtxos: [], status: 'SUCCESS' });
  if (applied._tag === 'Left') throw applied.left;
  return applied.right;
}

/** Smallest coin of the colour first, as the SDK's default selection does. */
const chooseCoin = (coins: readonly ledger.Utxo[], tokenType: string) => coins
  .filter(coin => coin.type === tokenType)
  .toSorted((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
  .at(0);

export async function balanceDappTransaction9(
  args: BalanceDappTransaction9Args,
  deps: BalanceDappTransaction9Deps = defaultDeps,
): Promise<BalanceDappTransaction9Result> {
  const network = midnightLedgerKey(args.sdkNetworkId);
  if (args.endpoints.sdkNetworkId !== network) throw new Error('Midnight endpoint network mismatch');
  if (midnightLedgerVersion(network) !== 9) {
    throw new Error(`Midnight ${midnightNetworkName(network)} runs ledger ${midnightLedgerVersion(network)}; this is a ledger 9 dapp transaction path`);
  }
  const tx = decodeUnboundTransaction9(args.txHex, network);
  const contributions = summarizeContributions9(tx);
  const ttl = earliestTtl(tx);
  const keystore = ledger9Keystore(args.unshieldedSecretKey, network);
  // The signer signs every input this key owns; the approval listed only what
  // balancing adds, so refuse inputs the dapp put in from the wallet.
  if (countWalletOwnedInputs9(tx, keystore.getPublicKey()) > 0) {
    throw new Error('This transaction already spends from your wallet; the wallet only adds its own inputs when it balances');
  }
  debugLog('🌙 dapp balance (ledger 9): start', { network, bytes: args.txHex.length / 2, colours: contributions.length });

  const keysCapability = Keys.makeDefaultKeysCapability();
  const capability = Transacting.makeDefaultTransactingCapability({ networkId: network }, () => ({
    coinSelection: chooseCoin,
    coinsAndBalancesCapability: CoinsAndBalances.makeDefaultCoinsAndBalancesCapability(),
    keysCapability,
  }));
  const result = capability.balanceUnboundTransaction(walletState(network, keystore, args.utxos), tx);
  if (result._tag === 'Left') throw result.left;
  // `undefined` = nothing to balance (the dapp already covered every colour).
  const balanced: UnboundTransaction9 = result.right[0] ?? tx;
  debugLog('🌙 dapp balance (ledger 9): inputs selected');

  const feeTx = await deps.balanceFees({
    sdkNetworkId: network, endpoints: args.endpoints, dustSecretSeed: args.dustSecretSeed, ttl,
    minimumDustSpends: CONNECTOR_MINIMUM_DUST_SPENDS,
  }, [balanced]);

  debugLog('🌙 dapp balance (ledger 9): proving fee tx wallet-side', { prover: describeWalletProving(args.proving) });
  const proveStart = Date.now();
  const provider = await deps.provingProvider(args.proving, network);
  const provenFee = await feeTx.prove(provider, ledger.CostModel.initialCostModel());
  const proveDurationMs = Date.now() - proveStart;

  const merged = balanced.merge(provenFee);
  const signed = signLedger9Intents(merged, keystore);
  const sealed = signed.bind().serialize();
  debugLog('🌙 dapp balance (ledger 9): sealed', { bytes: sealed.length, proveDurationMs });
  return { txHex: Buffer.from(sealed).toString('hex'), contributions, proveDurationMs };
}
