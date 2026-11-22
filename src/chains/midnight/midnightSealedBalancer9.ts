// Complete another party's SEALED transaction (DApp Connector
// `balanceSealedTransaction`) on ledger 9: typically a swap offer made with
// `makeIntent`, which is sealed and left imbalanced on purpose.
//
//   decode → refuse what a sealed transaction cannot have balanced (shielded
//   value, a fallible section) → wallet SDK 2's `balanceFinalizedTransaction`
//   (one new intent: the wallet's inputs for what the offer asks, outputs to
//   the wallet for what it gives) → DUST spends added to that same intent, as
//   few as the validation-time limit accepts (midnightDustSpread9.ts) → prove
//   → sign the wallet's inputs → bind → merge with the untouched sealed part.
//
// The sealed part is never modified and nothing in it is signed here: the
// wallet signs only the inputs of the intent it adds.
//
// PRIVACY: never log tx hex, proofs or keys. Sizes, durations, counts only.

import * as ledger from '@midnightntwrk/ledger-v9';
import { CoinsAndBalances, Keys, Transacting } from 'midnight-v9-unshielded-wallet/v2';
import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { MidnightUnshieldedUtxo } from './midnightTypes';
import {
  summarizeForeignPayments, unshieldedAddressCodec, type ConnectorContribution, type ConnectorPayment,
} from './midnightConnectorBalance';
import { CONNECTOR_INTENT_TTL_MS, connectorIntentSyncReady, MIDNIGHT_WALLET_NOT_SYNCED } from './midnightConnectorIntent';
import { ledger9WalletState } from './midnightDappBalancer9';
import type { SealedTransaction9 } from './midnightDustSpread9';
import { midnightLedgerKey, midnightLedgerVersion, midnightNetworkName, strictMidnightHex } from './midnightLedger';
import { resolveMidnightLedger } from './midnightChainLedger';
import { balanceLedger9Fees, ledger9Keystore, signLedger9Intents } from './midnightLedger9';
import type { WalletProvingRequest } from './midnightProvingTarget';
import { describeWalletProving, walletProvingProvider } from './midnightWalletProver';
import { debugLog } from '@/utils/debug';
import { midnightTimer } from './midnightTiming';

/** Closer to expiry than this, the proof the wallet would make is likely wasted. */
export const SEALED_MINIMUM_TTL_MS = 2 * 60_000;
/** Clock skew allowed over {@link CONNECTOR_INTENT_TTL_MS} (an offer made with the full makeIntent TTL on a clock a little ahead). */
const SEALED_TTL_SKEW_MS = 60_000;

/** Why a sealed transaction cannot be balanced by this wallet; told to the dapp as `InvalidRequest`. */
export const SEALED_BALANCE_REFUSALS = {
  shielded: 'tx needs shielded value balanced; this version balances public (unshielded) tokens only',
  fallible: 'tx is imbalanced in a fallible section; a sealed transaction can only be balanced in its guaranteed section',
  expiry: `tx must expire between ${SEALED_MINIMUM_TTL_MS / 60_000} and ${CONNECTOR_INTENT_TTL_MS / 60_000} minutes from now`,
} as const;

export interface SealedBalanceSummary {
  /** What the wallet must add, per colour: the guaranteed section's deficits. */
  readonly gives: ConnectorContribution[];
  /** What the wallet takes, per colour: the guaranteed section's surpluses. */
  readonly receives: ConnectorContribution[];
  readonly problem?: keyof typeof SEALED_BALANCE_REFUSALS;
}

/** The earliest TTL of `tx`'s intents (the ledger refuses the merged transaction after it); `undefined` without intents. */
function sealedTtl(tx: SealedTransaction9): Date | undefined {
  let ttl: Date | undefined;
  for (const intent of tx.intents?.values() ?? []) {
    if (!ttl || intent.ttl < ttl) ttl = intent.ttl;
  }
  return ttl;
}

/**
 * Decode `signature / proof / binding` and prove it belongs to `network`: the
 * ledger refuses to merge transactions of different networks. Proofs are
 * erased for the check only; the result is discarded.
 */
export function decodeSealedTransaction9(hex: string, network: string): SealedTransaction9 {
  const tx: SealedTransaction9 = ledger.Transaction.deserialize('signature', 'proof', 'binding', strictMidnightHex(hex));
  ledger.Transaction.fromParts(midnightLedgerKey(network)).eraseProofs().merge(tx.eraseProofs());
  return tx;
}

/**
 * What balancing `tx` means for the wallet. Segment 0 is the guaranteed
 * section across every intent; a segment's own id is its fallible section,
 * which nobody can add to once the intent is bound. DUST (the fee) is not a
 * token the wallet gives here: the fee is paid separately.
 *
 * The wallet's signed, completed intent is valid until the sealed part
 * expires: an offer that expires far ahead would let the dapp hold the
 * completed swap and submit it whenever the price suits it, and one about to
 * expire wastes the proof. So the earliest TTL must lie within
 * {@link SEALED_MINIMUM_TTL_MS} .. {@link CONNECTOR_INTENT_TTL_MS} of `now`.
 */
export function summarizeSealed9(tx: SealedTransaction9, now = Date.now()): SealedBalanceSummary {
  const gives = new Map<string, bigint>();
  const receives = new Map<string, bigint>();
  let problem: SealedBalanceSummary['problem'];
  for (const segment of new Set<number>([0, ...(tx.intents ? [...tx.intents.keys()] : [])])) {
    for (const [token, value] of tx.imbalances(segment)) {
      if (value === 0n || token.tag === 'dust') continue;
      // Fails closed: today the only other kind is shielded, and a kind this build does not know is refused the same way.
      if (token.tag !== 'unshielded') { problem ??= 'shielded'; continue; }
      if (segment !== 0) { problem ??= 'fallible'; continue; }
      const side = value < 0n ? gives : receives;
      side.set(token.raw, (side.get(token.raw) ?? 0n) + (value < 0n ? -value : value));
    }
  }
  const ttl = sealedTtl(tx);
  if (ttl) {
    const ahead = ttl.getTime() - now;
    if (ahead < SEALED_MINIMUM_TTL_MS || ahead > CONNECTOR_INTENT_TTL_MS + SEALED_TTL_SKEW_MS) problem ??= 'expiry';
  }
  const list = (totals: Map<string, bigint>) => [...totals].map(([token, amount]) => ({ token, amount: amount.toString() }));
  return { gives: list(gives), receives: list(receives), problem };
}

/**
 * Largest coin of the colour first. Every signed coin input adds about 3.5 ms
 * to the transaction's validation time, and a swap is already close to the
 * 15 ms floor (midnightDustSpread9.ts): fewer inputs means fewer DUST spends.
 */
export const chooseLargestCoin9 = (coins: readonly ledger.Utxo[], tokenType: string) => coins
  .filter(coin => coin.type === tokenType)
  .toSorted((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0))
  .at(0);

export interface BalanceSealedTransaction9Args {
  readonly sdkNetworkId: string;
  readonly endpoints: MidnightNetworkEndpoints;
  /** `signature / proof / binding` tx hex from the dapp. */
  readonly txHex: string;
  /** The wallet's NightExternal secret key. Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
  /** The wallet's DUST secret seed. Caller wipes after. */
  readonly dustSecretSeed: Uint8Array;
  /** The wallet's synced unshielded UTxOs (midnightStore.utxos). */
  readonly utxos: readonly MidnightUnshieldedUtxo[];
  /** The sync those UTxOs came from (midnightStore): when, and for which address. */
  readonly sync: { readonly lastSync: number | null; readonly addresses: { readonly unshielded?: string | null } };
  /** Where the DUST fee proof is made: this device, or the user's proof server. */
  readonly proving: WalletProvingRequest;
}

export interface BalanceSealedTransaction9Result {
  /** Sealed (`signature / proof / binding`) tx hex, ready for submit-proven. */
  readonly txHex: string;
  readonly gives: ConnectorContribution[];
  readonly receives: ConnectorContribution[];
  /** How many DUST spends the fee took. */
  readonly dustSpends: number;
  readonly proveDurationMs: number;
}

/** Injected so the pipeline is unit-testable without a DUST sync or a proof server. */
export interface BalanceSealedTransaction9Deps {
  balanceFees: typeof balanceLedger9Fees;
  provingProvider: (proving: WalletProvingRequest, sdkNetworkId: string) => Promise<ledger.ProvingProvider>;
}

const defaultDeps: BalanceSealedTransaction9Deps = {
  balanceFees: balanceLedger9Fees,
  provingProvider: async (proving, sdkNetworkId) =>
    await walletProvingProvider(proving, { sdkNetworkId, shielded: false, ledger: 9 }) as unknown as ledger.ProvingProvider,
};

/**
 * The sealed part's own deadline bounds the wallet's intent; 5 minutes for a
 * transaction without intents. That case skips the expiry check in
 * `summarizeSealed9` on purpose: with no intent there is no deadline of the
 * other party's to bound, and the wallet's own intent then lives 5 minutes.
 */
function earliestTtl(tx: SealedTransaction9): Date {
  return sealedTtl(tx) ?? new Date(Date.now() + 5 * 60_000);
}

/** `intentHash#outputNo` of every UTxO the sealed part already spends (lower-case hash). */
function spentBySealed(tx: SealedTransaction9): Set<string> {
  const spent = new Set<string>();
  for (const intent of tx.intents?.values() ?? []) {
    for (const offer of [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]) {
      for (const input of offer?.inputs ?? []) spent.add(`${input.intentHash.toLowerCase()}#${input.outputNo}`);
    }
  }
  return spent;
}

export async function balanceSealedTransaction9(
  args: BalanceSealedTransaction9Args,
  deps: BalanceSealedTransaction9Deps = defaultDeps,
): Promise<BalanceSealedTransaction9Result> {
  const network = midnightLedgerKey(args.sdkNetworkId);
  if (args.endpoints.sdkNetworkId !== network) throw new Error('Midnight endpoint network mismatch');
  if (midnightLedgerVersion(network) !== 9) {
    throw new Error(`Midnight ${midnightNetworkName(network)} runs ledger ${midnightLedgerVersion(network)}; this is a ledger 9 dapp transaction path`);
  }
  const tx = decodeSealedTransaction9(args.txHex, network);
  const summary = summarizeSealed9(tx);
  if (summary.problem) throw new Error(SEALED_BALANCE_REFUSALS[summary.problem]);
  const keystore = ledger9Keystore(args.unshieldedSecretKey, network);
  // Coins come from the wallet's own sync: never select from a view of another wallet or of no sync at all.
  if (!connectorIntentSyncReady(args.sync, keystore.getBech32Address().toString())) throw new Error(MIDNIGHT_WALLET_NOT_SYNCED);
  const ttl = earliestTtl(tx);
  debugLog('🌙 sealed balance (ledger 9): start', { network, bytes: args.txHex.length / 2, gives: summary.gives.length, receives: summary.receives.length });
  const timer = midnightTimer('connector balanceSealedTransaction (ledger 9)');
  let outcome: 'ok' | 'failed' = 'failed';
  try {
    const keysCapability = Keys.makeDefaultKeysCapability();
    const capability = Transacting.makeDefaultTransactingCapability({ networkId: network }, () => ({
      coinSelection: chooseLargestCoin9,
      coinsAndBalancesCapability: CoinsAndBalances.makeDefaultCoinsAndBalancesCapability(),
      keysCapability,
    }));
    // A coin the sealed part already spends (the wallet's own earlier offer)
    // is not the wallet's to select again: the node would refuse the double spend.
    const spent = spentBySealed(tx);
    const selectable = args.utxos.filter(utxo => !spent.has(`${utxo.intentHash.toLowerCase()}#${utxo.outputIndex}`));
    const result = capability.balanceFinalizedTransaction(ledger9WalletState(network, keystore, selectable), tx);
    if (result._tag === 'Left') throw result.left;
    // `undefined` = the guaranteed section is already balanced: the wallet only pays the fee.
    const balancing: ledger.UnprovenTransaction | undefined = result.right[0];
    if (balancing) {
      // The SDK gives the wallet's intent the FIRST intent's TTL; the merged
      // transaction is dead after the EARLIEST one, so the wallet's signature
      // need not outlive it. Set before anything is signed.
      for (const [segment, intent] of balancing.intents ?? []) {
        intent.ttl = ttl;
        balancing.intents = balancing.intents!.set(segment, intent);
      }
    }
    timer.lap('decodeAndSelectInputs');

    const withFee = await timer.time('dustFee', () => deps.balanceFees({
      sdkNetworkId: network, endpoints: args.endpoints, dustSecretSeed: args.dustSecretSeed, ttl,
      // Signed inside the spread, after its DUST actions are in and before the limit check.
      spread: { carrier: balancing, sign: unproven => signLedger9Intents(unproven, keystore) },
    }, [tx]));
    const dustSpends = [...(withFee.intents?.values() ?? [])].reduce((sum, intent) => sum + (intent.dustActions?.spends.length ?? 0), 0);

    debugLog('🌙 sealed balance (ledger 9): proving the wallet\'s part', { prover: describeWalletProving(args.proving), dustSpends });
    const proveStart = Date.now();
    const provider = await timer.time('proverSetup', () => deps.provingProvider(args.proving, network));
    const proven = await timer.time('prove', () => withFee.prove(provider, ledger.CostModel.initialCostModel()));
    const proveDurationMs = Date.now() - proveStart;

    // The spread signed already; this pass keeps those signatures and signs any input it did not.
    const merged = tx.merge(signLedger9Intents(proven, keystore).bind());
    // What the approval promised: nothing public left open.
    for (const [token, value] of merged.imbalances(0)) {
      if (token.tag === 'unshielded' && value !== 0n) throw new Error('The balanced transaction still has a public token left open');
    }
    const sealed = merged.serialize();
    timer.lap('signBindMerge');
    debugLog('🌙 sealed balance (ledger 9): sealed', { bytes: sealed.length, proveDurationMs, dustSpends });
    outcome = 'ok';
    return { txHex: Buffer.from(sealed).toString('hex'), gives: summary.gives, receives: summary.receives, dustSpends, proveDurationMs };
  } finally {
    timer.done(outcome);
  }
}

export type SealedBalancePrompt =
  | { ok: true; gives: ConnectorContribution[]; receives: ConnectorContribution[]; payments: ConnectorPayment[] }
  /** `internal`: the wallet could not check the request (a network failure), not the dapp's mistake. */
  | { ok: false; reason: string; internal?: true };

/**
 * What the `balanceSealedTransaction` approval shows, built before the user is
 * asked: what the wallet gives, what it receives, and whom the sealed
 * transaction pays (recipients as bech32m). `ownAddress` is the wallet's
 * unshielded bech32m address; when it is unknown every output is listed.
 * What the sealed part's guaranteed section pays straight to `ownAddress` is
 * not a payment to someone else, so it is counted in `receives` beside the
 * surplus the wallet takes (otherwise the approval could show a give with
 * nothing received), unless the sealed part spends the wallet's own coins.
 */
export async function sealedBalancePrompt(txHex: string, sdkNetworkId: string, ownAddress: string): Promise<SealedBalancePrompt> {
  const name = midnightNetworkName(sdkNetworkId);
  let version: number;
  try {
    version = await resolveMidnightLedger(sdkNetworkId);
  } catch {
    return { ok: false, reason: `Could not read which ledger Midnight ${name} runs`, internal: true };
  }
  if (version !== 9) return { ok: false, reason: `balanceSealedTransaction needs a ledger 9 network; Midnight ${name} runs ledger ${version}` };
  let tx: SealedTransaction9;
  try {
    tx = decodeSealedTransaction9(txHex, sdkNetworkId);
  } catch {
    return { ok: false, reason: `tx is not a valid sealed ledger 9 transaction for Midnight ${name}` };
  }
  const summary = summarizeSealed9(tx);
  if (summary.problem) return { ok: false, reason: SEALED_BALANCE_REFUSALS[summary.problem] };
  const codec = await unshieldedAddressCodec(midnightLedgerKey(sdkNetworkId));
  let ownHex = '';
  try {
    ownHex = ownAddress ? codec.toHex(ownAddress) : '';
  } catch {
    ownHex = '';
  }
  const payments = summarizeForeignPayments(tx as unknown as { intents?: Map<number, unknown> }, ownHex).map((payment) => {
    try {
      return { ...payment, recipient: codec.toBech32(payment.recipient) };
    } catch {
      return payment;
    }
  });
  const receives = new Map(summary.receives.map(({ token, amount }) => [token, BigInt(amount)]));
  const own = ownHex.toLowerCase();
  const intents = [...(tx.intents?.values() ?? [])];
  // When the sealed part spends the wallet's own coins (its own earlier
  // offer), an output to the wallet is that offer's change, not something
  // received: show the imbalances only.
  const spendsOwn = intents.some(intent => [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]
    .some(offer => offer?.inputs.some(input => ledger.addressFromKey(input.owner).toLowerCase() === own)));
  if (own && !spendsOwn) {
    // GUARANTEED outputs only: that section is all-or-nothing with the
    // wallet's give, while a fallible section can fail (an input missing)
    // after the give went through, so its payment may never arrive.
    for (const intent of intents) {
      for (const output of intent.guaranteedUnshieldedOffer?.outputs ?? []) {
        if (output.owner.toLowerCase() === own) receives.set(output.type, (receives.get(output.type) ?? 0n) + output.value);
      }
    }
  }
  return {
    ok: true, gives: summary.gives, payments,
    receives: [...receives].map(([token, amount]) => ({ token, amount: amount.toString() })),
  };
}
