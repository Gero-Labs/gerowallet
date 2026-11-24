// Private (shielded) legs for the wallet's own Midnight P2P swap, ledger 9.
//
// A swap offer (MIP-0006) is a SEALED, purposefully imbalanced transaction: a
// surplus of what the maker gives and a shortage of what it wants. The taker
// adds the mirror, pays the DUST fee and submits the merge; the ledger's
// homomorphic balance check is the whole settlement.
//
//   maker: buildPrivateSwapOffer9
//     private wallet synced (withSyncedShieldedWallet9) → wallet SDK 2's pure
//     shielded `initSwap` (its coins for what it gives, change and what it
//     wants as outputs to itself, all in the guaranteed Zswap offer) → for a
//     public leg, the unshielded `initSwap` (NIGHT in, change and NIGHT out,
//     one guaranteed unshielded offer in one intent) → check the result → prove
//     → sign → bind. No fee: MIP-0006 leaves it to the taker.
//
//   taker: takePrivateSwapOffer9
//     decode → refuse what is not exactly a two-sided swap in the guaranteed
//     section (analyzePrivateSwapOffer9) → compare with what the user approved
//     → its own mirror (the same two `initSwap`s) → check it → DUST spends in its
//     intent (midnightDustSpread9.ts) → prove → sign → bind → merge → check the
//     merged bytes: nothing left open, within the validation-time limit.
//
// Every check reads the bytes, not the builder: the terms are derived from the
// transaction's imbalances, every output the wallet adds pays the wallet (a
// shielded output by its commitment), every input it adds is its own.
//
// Lifetime: a public leg lives in an intent whose TTL bounds the offer. A
// fully shielded offer has no intent and no TTL: it lives while the Merkle
// root its inputs were proven against stays in the ledger's root-recency
// window (MIP-0006 "Offer lifetime"), so its expiry is an estimate.
//
// PRIVACY: never log transaction bytes, proofs, keys or coin values.

import * as ledger from '@midnightntwrk/ledger-v9';
import { CoinsAndBalances as ShieldedCoins, Keys as ShieldedKeys, Transacting as ShieldedTransacting, coreStateOf } from 'midnight-v9-shielded/v2';
import type { CoreWallet as ShieldedCoreWallet } from 'midnight-v9-shielded/v2';
import { CoinsAndBalances, Keys, Transacting } from 'midnight-v9-unshielded-wallet/v2';
import { MidnightBech32m, UnshieldedAddress } from 'midnight-v9-address-format';
import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { MidnightUnshieldedUtxo } from './midnightTypes';
import {
  connectorIntentSyncReady, connectorSegmentSpecifier, CONNECTOR_INTENT_TTL_MS, IntentInsufficientFundsError,
  isSdkInsufficientFunds, MIDNIGHT_WALLET_NOT_SYNCED, NIGHT_RAW_TOKEN_TYPE, uncoveredIntentInput,
} from './midnightConnectorIntent';
import { ledger9WalletState } from './midnightDappBalancer9';
import type { SealedTransaction9 } from './midnightDustSpread9';
import { midnightLedgerKey, strictMidnightHex } from './midnightLedger';
import { balanceLedger9Fees, ledger9Keystore, signLedger9Intents } from './midnightLedger9';
import { chooseLargestCoin9, decodeSealedTransaction9, SEALED_MINIMUM_TTL_MS } from './midnightSealedBalancer9';
import type { WalletProvingRequest } from './midnightProvingTarget';
import { describeWalletProving, walletProvingProvider } from './midnightWalletProver';
import { debugLog } from '@/utils/debug';
import { midnightTimer } from './midnightTiming';

/** The wallet's own swap flow may offer and take private legs. */
export const PRIVATE_SWAP_SUPPORTED = true;

/** Per side of a swap: each leg is an input and a proof, and the swap must fit the validation-time limit. */
export const PRIVATE_SWAP_MAX_LEGS = 4;
/** A real two-party private offer is about 15.5 KB; anything near this is not one. */
export const PRIVATE_SWAP_MAX_OFFER_BYTES = 256 * 1024;
/**
 * How long the ledger keeps accepting a Zswap Merkle root after it was last
 * current (MIP-0006 "Offer lifetime"): an hour on today's networks, the same
 * figure as the intent TTL bound.
 */
export const PRIVATE_SWAP_ROOT_WINDOW_MS = 60 * 60_000;
/** Taken off the root window for an estimate: the synced root may be a few blocks old, and clocks drift. */
export const PRIVATE_SWAP_EXPIRY_MARGIN_MS = 5 * 60_000;
/** The taker's intent TTL when the offer has no intent of its own (a fully shielded offer). */
export const PRIVATE_SWAP_TAKER_TTL_MS = 30 * 60_000;
/** Clock skew allowed over {@link CONNECTOR_INTENT_TTL_MS} for an offer's intent TTL. */
const OFFER_TTL_SKEW_MS = 60_000;
/** u128: the ledger's value range. */
const MAX_VALUE = (1n << 128n) - 1n;

export type PrivateSwapLegKind = 'shielded' | 'unshielded';

/** One token of a swap: its layer, its raw 32-byte colour (lower-case hex) and an amount in base units (decimal). */
export interface PrivateSwapLeg {
  readonly kind: PrivateSwapLegKind;
  readonly type: string;
  readonly value: string;
}

/** A swap from the maker's side: what the offer gives away and what it asks for. */
export interface PrivateSwapTerms {
  readonly gives: readonly PrivateSwapLeg[];
  readonly wants: readonly PrivateSwapLeg[];
}

/** The same swap from the taker's side: what the taker gives (the offer's wants) and receives (the offer's gives). */
export interface PrivateSwapTakerTerms {
  readonly gives: readonly PrivateSwapLeg[];
  readonly receives: readonly PrivateSwapLeg[];
}

/** Why an offer or a request is refused. Codes, so the extension pages can say them in the user's language. */
export const PRIVATE_SWAP_REFUSALS = {
  request: 'the swap request is not valid',
  noPrivateLeg: 'the swap has no private leg; use the public swap',
  shieldedNight: 'NIGHT is always public and cannot be a private leg',
  tooManyLegs: `a swap has at most ${PRIVATE_SWAP_MAX_LEGS} tokens on each side`,
  sameToken: 'the same token cannot be both given and asked for',
  decode: 'the offer is not a sealed ledger 9 transaction for this network',
  size: 'the offer is too large to be a swap offer',
  giveOnly: 'the offer gives tokens away and asks for nothing: it is not a swap',
  wantOnly: 'the offer asks for tokens and gives nothing: it is not a swap',
  fallible: 'the offer moves value outside the guaranteed section',
  contract: 'the offer calls a contract or spends or creates a contract\'s coins',
  dust: 'the offer carries DUST actions',
  transient: 'the offer carries a transient coin',
  unknownKind: 'the offer moves a kind of token this version does not know',
  expiry: `the offer must expire between ${SEALED_MINIMUM_TTL_MS / 60_000} and ${CONNECTOR_INTENT_TTL_MS / 60_000} minutes from now`,
  terms: 'the offer does not give and ask for exactly the approved amounts',
} as const;
export type PrivateSwapRefusal = keyof typeof PRIVATE_SWAP_REFUSALS;

/** A refused offer or request. `code` is stable; the message is the English text of {@link PRIVATE_SWAP_REFUSALS}. */
export class PrivateSwapRefusedError extends Error {
  constructor(readonly code: PrivateSwapRefusal) {
    super(PRIVATE_SWAP_REFUSALS[code]);
    this.name = 'PrivateSwapRefusedError';
  }
}

// ---------------------------------------------------------------------------
// Terms: requests and comparison
// ---------------------------------------------------------------------------

const legKey = (leg: Pick<PrivateSwapLeg, 'kind' | 'type'>) => `${leg.kind}:${leg.type}`;

function parseLegs(raw: unknown): PrivateSwapLeg[] | PrivateSwapRefusal {
  if (!Array.isArray(raw)) return 'request';
  const totals = new Map<string, { kind: PrivateSwapLegKind; type: string; value: bigint }>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return 'request';
    const { kind, type, value } = entry as { kind?: unknown; type?: unknown; value?: unknown };
    if (kind !== 'shielded' && kind !== 'unshielded') return 'request';
    if (typeof type !== 'string' || !/^[0-9a-fA-F]{64}$/.test(type)) return 'request';
    const colour = type.toLowerCase();
    if (kind === 'shielded' && colour === NIGHT_RAW_TOKEN_TYPE) return 'shieldedNight';
    if (typeof value !== 'string' || !/^[0-9]{1,39}$/.test(value)) return 'request';
    const amount = BigInt(value);
    if (amount <= 0n || amount > MAX_VALUE) return 'request';
    const key = `${kind}:${colour}`;
    const sum = (totals.get(key)?.value ?? 0n) + amount;
    if (sum > MAX_VALUE) return 'request';
    totals.set(key, { kind, type: colour, value: sum });
  }
  return [...totals.values()].map(leg => ({ kind: leg.kind, type: leg.type, value: leg.value.toString() }));
}

/**
 * Validate and normalize swap terms from a page (`{ gives, wants }`, maker
 * side): legs of the same token summed, colours lower-case, at least one leg
 * each way, at least one private leg, NIGHT never private. The worker re-runs
 * this; a page's copy is never trusted.
 */
export function validatePrivateSwapTerms(raw: unknown):
  | { ok: true; terms: PrivateSwapTerms }
  | { ok: false; code: PrivateSwapRefusal; reason: string } {
  const refuse = (code: PrivateSwapRefusal) => ({ ok: false as const, code, reason: PRIVATE_SWAP_REFUSALS[code] });
  if (!raw || typeof raw !== 'object') return refuse('request');
  const gives = parseLegs((raw as { gives?: unknown }).gives);
  const wants = parseLegs((raw as { wants?: unknown }).wants);
  if (typeof gives === 'string') return refuse(gives);
  if (typeof wants === 'string') return refuse(wants);
  if (!gives.length) return refuse('wantOnly');
  if (!wants.length) return refuse('giveOnly');
  if (gives.length > PRIVATE_SWAP_MAX_LEGS || wants.length > PRIVATE_SWAP_MAX_LEGS) return refuse('tooManyLegs');
  const given = new Set(gives.map(legKey));
  if (wants.some(leg => given.has(legKey(leg)))) return refuse('sameToken');
  if (![...gives, ...wants].some(leg => leg.kind === 'shielded')) return refuse('noPrivateLeg');
  return { ok: true, terms: { gives, wants } };
}

/** The same legs, whatever their order (each list already has one leg per token). */
export function samePrivateSwapLegs(a: readonly PrivateSwapLeg[], b: readonly PrivateSwapLeg[]): boolean {
  if (a.length !== b.length) return false;
  const values = new Map(a.map(leg => [legKey(leg), BigInt(leg.value)]));
  return b.every(leg => values.get(legKey(leg)) === BigInt(leg.value));
}

/** The taker's side of `terms`. */
export const takerTerms = (terms: PrivateSwapTerms): PrivateSwapTakerTerms => ({ gives: terms.wants, receives: terms.gives });

// ---------------------------------------------------------------------------
// Offer analysis
// ---------------------------------------------------------------------------

type AnyTx9 = ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>;

/** Per `kind:type`, the guaranteed-section imbalance of `tx`; refuses value anywhere else and unknown kinds. */
function guaranteedImbalances(tx: AnyTx9): Map<string, { kind: PrivateSwapLegKind; type: string; value: bigint }> {
  const totals = new Map<string, { kind: PrivateSwapLegKind; type: string; value: bigint }>();
  for (const segment of new Set<number>([0, ...(tx.intents ? [...tx.intents.keys()] : [])])) {
    for (const [token, value] of tx.imbalances(segment)) {
      // DUST is the fee, paid separately; a DUST action in an offer is refused on its own.
      if (value === 0n || token.tag === 'dust') continue;
      if (token.tag !== 'shielded' && token.tag !== 'unshielded') throw new PrivateSwapRefusedError('unknownKind');
      if (segment !== 0) throw new PrivateSwapRefusedError('fallible');
      const key = legKey({ kind: token.tag, type: token.raw.toLowerCase() });
      const sum = (totals.get(key)?.value ?? 0n) + value;
      totals.set(key, { kind: token.tag, type: token.raw.toLowerCase(), value: sum });
    }
  }
  for (const [key, entry] of totals) if (entry.value === 0n) totals.delete(key);
  return totals;
}

/**
 * Refuse a part of a swap (an offer, or the wallet's own mirror of one) that
 * carries anything but guaranteed value moves: a fallible Zswap or
 * unshielded offer, a contract call, a contract-owned coin, a transient, or
 * (unless `allowDust`) a DUST action.
 */
function assertSwapShape(tx: AnyTx9, options: { allowDust?: boolean } = {}): void {
  if (tx.fallibleOffer && tx.fallibleOffer.size > 0) throw new PrivateSwapRefusedError('fallible');
  const zswap = tx.guaranteedOffer;
  if (zswap) {
    if (zswap.transients.length) throw new PrivateSwapRefusedError('transient');
    if (zswap.inputs.some(input => input.contractAddress !== undefined)
      || zswap.outputs.some(output => output.contractAddress !== undefined)) throw new PrivateSwapRefusedError('contract');
  }
  for (const intent of tx.intents?.values() ?? []) {
    if (intent.actions.length) throw new PrivateSwapRefusedError('contract');
    const fallible = intent.fallibleUnshieldedOffer;
    if (fallible && (fallible.inputs.length || fallible.outputs.length)) throw new PrivateSwapRefusedError('fallible');
    if (intent.dustActions && !options.allowDust) throw new PrivateSwapRefusedError('dust');
  }
}

/** The earliest intent TTL of `tx`, or `undefined` for a transaction without intents. */
function earliestTtl(tx: AnyTx9): Date | undefined {
  let ttl: Date | undefined;
  for (const intent of tx.intents?.values() ?? []) if (!ttl || intent.ttl < ttl) ttl = intent.ttl;
  return ttl;
}

export interface PrivateSwapOfferAnalysis {
  /** The maker's terms, derived from the offer's imbalances (MIP-0006 "Deriving gives / wants"). */
  readonly terms: PrivateSwapTerms;
  /** The earliest intent TTL; absent for a fully shielded offer, which has none. */
  readonly ttl?: Date;
  /** Nullifiers of the offer's private inputs: the coins it spends (hex). */
  readonly nullifiers: readonly string[];
}

/**
 * The terms of a swap offer, refusing anything that is not exactly a two-sided
 * swap whose value moves only in the guaranteed section (MIP-0006 "Offer
 * Validation", "Segment placement"): give-only and want-only offers, fallible
 * sections, contract calls and coins, transients, DUST actions, more than
 * {@link PRIVATE_SWAP_MAX_LEGS} tokens a side, a private NIGHT leg, and (when
 * the offer has an intent) a TTL outside the window the public flow uses.
 * A fully public offer passes here: whether a private leg is required is the
 * caller's.
 */
export function analyzePrivateSwapOffer9(tx: AnyTx9, now = Date.now()): PrivateSwapOfferAnalysis {
  assertSwapShape(tx);
  const gives: PrivateSwapLeg[] = [];
  const wants: PrivateSwapLeg[] = [];
  for (const { kind, type, value } of guaranteedImbalances(tx).values()) {
    if (kind === 'shielded' && type === NIGHT_RAW_TOKEN_TYPE) throw new PrivateSwapRefusedError('shieldedNight');
    // A surplus is what the maker gives up; a shortage is what it wants.
    (value > 0n ? gives : wants).push({ kind, type, value: (value > 0n ? value : -value).toString() });
  }
  if (!gives.length) throw new PrivateSwapRefusedError('wantOnly');
  if (!wants.length) throw new PrivateSwapRefusedError('giveOnly');
  if (gives.length > PRIVATE_SWAP_MAX_LEGS || wants.length > PRIVATE_SWAP_MAX_LEGS) throw new PrivateSwapRefusedError('tooManyLegs');
  const ttl = earliestTtl(tx);
  if (ttl) {
    const ahead = ttl.getTime() - now;
    if (ahead < SEALED_MINIMUM_TTL_MS || ahead > CONNECTOR_INTENT_TTL_MS + OFFER_TTL_SKEW_MS) throw new PrivateSwapRefusedError('expiry');
  }
  const nullifiers = (tx.guaranteedOffer?.inputs ?? []).map(input => input.nullifier.toLowerCase());
  return { terms: { gives, wants }, ttl, nullifiers };
}

/**
 * When an offer stops being takeable, as far as the wallet can tell: the
 * earliest intent TTL for an offer with a public leg (exact), else the root
 * window from `rootSeenAt` less {@link PRIVATE_SWAP_EXPIRY_MARGIN_MS} (an
 * estimate: the root stays current, and the offer alive, for as long as no
 * new coin is created on the chain). Whichever comes first.
 */
export function estimatePrivateSwapExpiry(ttl: Date | undefined, rootSeenAt: number | undefined):
  { expiresAt?: number; expiry: 'ttl' | 'root-window' | 'unknown' } {
  const rootBound = rootSeenAt === undefined ? undefined : rootSeenAt + PRIVATE_SWAP_ROOT_WINDOW_MS - PRIVATE_SWAP_EXPIRY_MARGIN_MS;
  if (ttl && (rootBound === undefined || ttl.getTime() <= rootBound)) return { expiresAt: ttl.getTime(), expiry: 'ttl' };
  if (rootBound !== undefined) return { expiresAt: rootBound, expiry: 'root-window' };
  return { expiry: 'unknown' };
}

export type PrivateSwapOfferPreview =
  | {
    ok: true;
    /** The offer's own terms. */
    offer: PrivateSwapTerms;
    /** What taking it means for this wallet. */
    taker: PrivateSwapTakerTerms;
    /** Epoch ms; absent when the offer has no public leg and no `seenAt` was given. */
    expiresAt?: number;
    expiry: 'ttl' | 'root-window' | 'unknown';
  }
  | { ok: false; code: PrivateSwapRefusal; reason: string };

/**
 * What the approval for taking an offer shows, before the user is asked.
 * `seenAt` (epoch ms), when the caller knows when the offer was first seen,
 * bounds a fully shielded offer's expiry estimate from below (MIP-0006:
 * deriving it from first-seen errs early, never late).
 */
export function describePrivateSwapOffer9(offerHex: string, sdkNetworkId: string, options: { now?: number; seenAt?: number } = {}): PrivateSwapOfferPreview {
  const refuse = (code: PrivateSwapRefusal) => ({ ok: false as const, code, reason: PRIVATE_SWAP_REFUSALS[code] });
  if (typeof offerHex !== 'string' || offerHex.length > PRIVATE_SWAP_MAX_OFFER_BYTES * 2) return refuse('size');
  let tx: SealedTransaction9;
  try {
    tx = decodeSealedTransaction9(offerHex, midnightLedgerKey(sdkNetworkId));
  } catch {
    return refuse('decode');
  }
  try {
    const analysis = analyzePrivateSwapOffer9(tx, options.now);
    if (![...analysis.terms.gives, ...analysis.terms.wants].some(leg => leg.kind === 'shielded')) return refuse('noPrivateLeg');
    return { ok: true, offer: analysis.terms, taker: takerTerms(analysis.terms), ...estimatePrivateSwapExpiry(analysis.ttl, options.seenAt) };
  } catch (error) {
    if (error instanceof PrivateSwapRefusedError) return refuse(error.code);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The wallet's own part: building and checking it
// ---------------------------------------------------------------------------

/** What the wallet owns, to check every input and output it adds against. */
interface OwnParty {
  /** The NightExternal key: every unshielded input the wallet adds is this key's. */
  readonly key: ledger.SignatureVerifyingKey;
  /** `UserAddress` hex of that key: every unshielded output the wallet adds pays it. */
  readonly addressHex: string;
  /** Commitments of the private coins the wallet expects to receive (its change and its asks). */
  readonly commitments: ReadonlySet<string>;
  /** Nullifiers of the private coins the wallet holds. */
  readonly nullifiers: ReadonlySet<string>;
}

/**
 * Refuse a part the wallet built unless every unshielded input is its key's,
 * every unshielded output pays its address, every private output is a coin it
 * watches for itself and every private input spends one of its own coins.
 */
function assertOwnPart(tx: AnyTx9, own: OwnParty): void {
  for (const intent of tx.intents?.values() ?? []) {
    const offer = intent.guaranteedUnshieldedOffer;
    for (const input of offer?.inputs ?? []) {
      if (input.owner.tag !== own.key.tag || input.owner.value !== own.key.value) throw new Error('The swap spends public coins that are not this wallet\'s');
    }
    for (const output of offer?.outputs ?? []) {
      if (output.owner.toLowerCase() !== own.addressHex.toLowerCase()) throw new Error('The swap pays a public address that is not this wallet\'s');
    }
  }
  for (const output of tx.guaranteedOffer?.outputs ?? []) {
    if (!own.commitments.has(output.commitment.toLowerCase())) throw new Error('The swap creates a private coin that is not this wallet\'s');
  }
  for (const input of tx.guaranteedOffer?.inputs ?? []) {
    if (!own.nullifiers.has(input.nullifier.toLowerCase())) throw new Error('The swap spends a private coin that is not this wallet\'s');
  }
}

/** Refuse a part whose guaranteed imbalance is not exactly `+gives −takes` per token. */
function assertPartImbalance(tx: AnyTx9, gives: readonly PrivateSwapLeg[], takes: readonly PrivateSwapLeg[]): void {
  const expected = new Map<string, bigint>();
  for (const leg of gives) expected.set(legKey(leg), (expected.get(legKey(leg)) ?? 0n) + BigInt(leg.value));
  for (const leg of takes) expected.set(legKey(leg), (expected.get(legKey(leg)) ?? 0n) - BigInt(leg.value));
  for (const [key, value] of expected) if (value === 0n) expected.delete(key);
  const actual = guaranteedImbalances(tx);
  const same = actual.size === expected.size && [...expected].every(([key, value]) => actual.get(key)?.value === value);
  if (!same) throw new Error('The swap the wallet built does not give and take exactly the approved amounts');
}

/** Largest private coin of the colour first: every input is a proof and validation time (a swap is close to the limit). */
function largestShieldedFirst(skip: ReadonlySet<string>, nullifierOf: (coin: ledger.QualifiedShieldedCoinInfo) => string) {
  return (coins: readonly ledger.QualifiedShieldedCoinInfo[], tokenType: string) => coins
    .filter(coin => coin.type === tokenType && !skip.has(nullifierOf(coin)))
    .toSorted((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0))
    .at(0);
}

/** The private side of a swap part: `gives` spent from the wallet's coins, `takes` paid to the wallet. */
function shieldedSide(network: string, core: ShieldedCoreWallet, keys: ledger.ZswapSecretKeys,
  gives: readonly PrivateSwapLeg[], takes: readonly PrivateSwapLeg[], ttl: Date, skipNullifiers: ReadonlySet<string>) {
  const keysCapability = ShieldedKeys.makeDefaultKeysCapability();
  const nullifierOf = (coin: ledger.QualifiedShieldedCoinInfo) => ledger.coinNullifier(coin, keys.coinSecretKey).toLowerCase();
  const capability = ShieldedTransacting.makeDefaultTransactingCapability({ networkId: network }, () => ({
    coinSelection: largestShieldedFirst(skipNullifiers, nullifierOf) as never,
    coinsAndBalancesCapability: ShieldedCoins.makeDefaultCoinsAndBalancesCapability(),
    keysCapability,
  }));
  const own = keysCapability.getAddress(core);
  const desiredInputs: Record<string, bigint> = {};
  for (const leg of gives) if (leg.kind === 'shielded') desiredInputs[leg.type] = BigInt(leg.value);
  const desiredOutputs = takes.filter(leg => leg.kind === 'shielded')
    .map(leg => ({ type: leg.type, amount: BigInt(leg.value), receiverAddress: own }));
  if (!Object.keys(desiredInputs).length && !desiredOutputs.length) return undefined;
  const ownNullifiers = new Set([...core.state.coins].map(nullifierOf));
  const result = capability.initSwap(keys, core, desiredInputs, desiredOutputs, ttl);
  if (result._tag === 'Left') {
    if (isSdkInsufficientFunds(result.left)) throw new IntentInsufficientFundsError('Not enough private funds to give what this swap offers');
    throw result.left;
  }
  const [tx, after] = result.right;
  // The coins the wallet now watches for itself: its change and what it asked for.
  const commitments = new Set([...after.state.pendingOutputs.keys()].map(commitment => commitment.toLowerCase()));
  return { tx, commitments, nullifiers: ownNullifiers };
}

/** The public side of a swap part: `gives` from the wallet's UTxOs (largest first), `takes` paid to its own address. */
function unshieldedSide(network: string, keystore: ReturnType<typeof ledger9Keystore>, utxos: readonly MidnightUnshieldedUtxo[],
  gives: readonly PrivateSwapLeg[], takes: readonly PrivateSwapLeg[], ttl: Date): ledger.UnprovenIntent | undefined {
  const give: Record<string, bigint> = Object.create(null);
  for (const leg of gives) if (leg.kind === 'unshielded') give[leg.type] = BigInt(leg.value);
  const receiver = UnshieldedAddress.codec.decode(network, MidnightBech32m.parse(keystore.getBech32Address().toString()));
  const transfers = takes.filter(leg => leg.kind === 'unshielded')
    .map(leg => ({ amount: BigInt(leg.value), type: leg.type, receiverAddress: receiver }));
  if (!Object.keys(give).length && !transfers.length) return undefined;
  const keysCapability = Keys.makeDefaultKeysCapability();
  const capability = Transacting.makeDefaultTransactingCapability({ networkId: network }, () => ({
    coinSelection: chooseLargestCoin9,
    coinsAndBalancesCapability: CoinsAndBalances.makeDefaultCoinsAndBalancesCapability(),
    keysCapability,
  }));
  const swap = capability.initSwap(ledger9WalletState(network, keystore, utxos), give, transfers, ttl);
  if (swap._tag === 'Left') {
    if (isSdkInsufficientFunds(swap.left)) throw new IntentInsufficientFundsError();
    throw swap.left;
  }
  const intents = [...(swap.right.transaction.intents?.values() ?? [])];
  if (intents.length !== 1) throw new Error('The wallet built an unexpected number of intents');
  return intents[0];
}

/** `intentHash#outputNo` of every UTxO `tx` already spends (lower-case hash). */
function spentUtxos(tx: AnyTx9): Set<string> {
  const spent = new Set<string>();
  for (const intent of tx.intents?.values() ?? []) {
    for (const offer of [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]) {
      for (const input of offer?.inputs ?? []) spent.add(`${input.intentHash.toLowerCase()}#${input.outputNo}`);
    }
  }
  return spent;
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

/** The synced private wallet a pipeline builds from. */
export interface PrivateSwapShieldedContext {
  readonly network: string;
  /** Wallet SDK 2's ledger 9 core state of the synced private wallet. */
  readonly core: ShieldedCoreWallet;
  /** Cleared when the callback settles. */
  readonly keys: ledger.ZswapSecretKeys;
  assertChainUnchanged(): Promise<void>;
}

/** Injected so the pipelines are unit-testable without a sync, a DUST scan or a prover. */
export interface PrivateSwap9Deps {
  withShieldedWallet: <T>(args: { sdkNetworkId: string; endpoints: MidnightNetworkEndpoints; zswapSecretKeySeed: Uint8Array },
    use: (context: PrivateSwapShieldedContext) => Promise<T>) => Promise<T>;
  balanceFees: typeof balanceLedger9Fees;
  /** Proves a signed, unproven part and binds it. */
  seal: (tx: ledger.UnprovenTransaction, proving: WalletProvingRequest, network: string) => Promise<SealedTransaction9>;
  now: () => number;
}

/** The real dependencies: the wallet's private sync, its DUST fee, its proving target. */
export const privateSwap9Deps: PrivateSwap9Deps = {
  withShieldedWallet: async (args, use) => {
    // Loaded as the shielded send loads it (midnightShieldedBuilder.ts): never part of the worker's static graph.
    const { withSyncedShieldedWallet9 } = await import('./midnightShieldedLedger9');
    return withSyncedShieldedWallet9(args, async ({ network, state, keys, assertChainUnchanged }) => {
      const core = coreStateOf(state);
      // The fork-aware wallet still on the ledger 8 side holds no ledger 9 state to build from.
      if (core._tag === 'None') throw new Error('The private wallet has not caught up with the ledger 9 upgrade yet; try again when it has');
      return use({ network, core: core.value, keys, assertChainUnchanged });
    }, { operation: 'private swap' });
  },
  balanceFees: balanceLedger9Fees,
  seal: async (tx, proving, network) => {
    const provider = await walletProvingProvider(proving, { sdkNetworkId: network, shielded: true, ledger: 9 }) as unknown as ledger.ProvingProvider;
    const proven = await tx.prove(provider, ledger.CostModel.initialCostModel());
    return proven.bind() as unknown as SealedTransaction9;
  },
  now: () => Date.now(),
};

interface SwapWalletKeys {
  readonly sdkNetworkId: string;
  readonly endpoints: MidnightNetworkEndpoints;
  /** The wallet's Zswap seed. Caller wipes after. */
  readonly zswapSecretKeySeed: Uint8Array;
  /** The wallet's NightExternal secret key: signs public inputs, names the public address paid. Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
  /** The wallet's synced unshielded UTxOs (midnightStore.utxos); read only when the wallet gives a public leg. */
  readonly utxos: readonly MidnightUnshieldedUtxo[];
  /** The sync those UTxOs came from (midnightStore): when, and for which address. */
  readonly sync: { readonly lastSync: number | null; readonly addresses: { readonly unshielded?: string | null } };
  /** Where the proofs are made: this device, Gero Prover, or the user's proof server. */
  readonly proving: WalletProvingRequest;
}

export interface BuildPrivateSwapOffer9Args extends SwapWalletKeys {
  /** The maker's terms, as validated by {@link validatePrivateSwapTerms} (re-validated here). */
  readonly terms: PrivateSwapTerms;
  /** The intent TTL when a leg is public; defaults to now + {@link CONNECTOR_INTENT_TTL_MS} (55 min), never more. */
  readonly ttl?: Date;
}

export interface BuildPrivateSwapOffer9Result {
  /** The sealed (`signature / proof / binding`) offer, hex: the MIP-0005 offer bytes. */
  readonly offerHex: string;
  /** The offer's terms, read back from the sealed bytes. */
  readonly terms: PrivateSwapTerms;
  /** Epoch ms after which the offer can no longer be taken; see `expiry`. */
  readonly expiresAt: number;
  /** `ttl`: the intent's TTL, exact. `root-window`: estimated from the Merkle-root recency window (no public leg). */
  readonly expiry: 'ttl' | 'root-window';
  /** Nullifiers of the private coins the offer spends (hex): spending one elsewhere cancels the offer. */
  readonly nullifiers: readonly string[];
  readonly proveDurationMs: number;
}

/**
 * Make a swap offer with at least one private leg. The private coins the
 * offer spends are not booked in the wallet's saved state: until the offer is
 * taken, spending them (a send, another offer) cancels it (MIP-0006
 * "Cancellation").
 */
export async function buildPrivateSwapOffer9(args: BuildPrivateSwapOffer9Args, deps: PrivateSwap9Deps = privateSwap9Deps): Promise<BuildPrivateSwapOffer9Result> {
  const validated = validatePrivateSwapTerms(args.terms);
  if (validated.ok === false) throw new PrivateSwapRefusedError(validated.code);
  const { terms } = validated;
  const network = midnightLedgerKey(args.sdkNetworkId);
  if (args.endpoints.sdkNetworkId !== network) throw new Error('Midnight endpoint network mismatch');
  const now = deps.now();
  const ttl = args.ttl ?? new Date(now + CONNECTOR_INTENT_TTL_MS);
  if (!Number.isFinite(ttl.getTime()) || ttl.getTime() - now < SEALED_MINIMUM_TTL_MS || ttl.getTime() - now > CONNECTOR_INTENT_TTL_MS) {
    throw new PrivateSwapRefusedError('expiry');
  }
  const keystore = ledger9Keystore(args.unshieldedSecretKey, network);
  const publicGives = terms.gives.filter(leg => leg.kind === 'unshielded');
  const hasPublic = [...terms.gives, ...terms.wants].some(leg => leg.kind === 'unshielded');
  if (publicGives.length) {
    // Coins come from the wallet's own sync: never select from a view of another wallet or of no sync at all.
    if (!connectorIntentSyncReady(args.sync, keystore.getBech32Address().toString())) throw new Error(MIDNIGHT_WALLET_NOT_SYNCED);
    if (uncoveredIntentInput(publicGives, { lastSync: args.sync.lastSync, utxos: args.utxos })) {
      throw new IntentInsufficientFundsError();
    }
  }
  debugLog('🌙 private swap offer (ledger 9): start', { network, gives: terms.gives.length, wants: terms.wants.length, hasPublic });
  const timer = midnightTimer('private swap offer (ledger 9)');
  let outcome: 'ok' | 'failed' = 'failed';
  try {
    return await deps.withShieldedWallet(args, async ({ core, keys, assertChainUnchanged }) => {
      timer.lap('shieldedSync');
      const rootSeenAt = deps.now();
      // A fully shielded offer has no TTL; its coins are booked (in memory) for the root window.
      const bookUntil = hasPublic ? ttl : new Date(rootSeenAt + PRIVATE_SWAP_ROOT_WINDOW_MS);
      const shielded = shieldedSide(network, core, keys, terms.gives, terms.wants, bookUntil, new Set());
      if (!shielded) throw new PrivateSwapRefusedError('noPrivateLeg');
      let unproven: ledger.UnprovenTransaction = shielded.tx;
      const intent = hasPublic ? unshieldedSide(network, keystore, args.utxos, terms.gives, terms.wants, ttl) : undefined;
      if (intent) unproven = unproven.merge(ledger.Transaction.fromParts(network).addIntent(connectorSegmentSpecifier('random'), intent));
      const own: OwnParty = {
        key: keystore.getPublicKey(), addressHex: keystore.getAddress(), commitments: shielded.commitments, nullifiers: shielded.nullifiers,
      };
      // The bytes, not the builder: exactly the requested terms, every coin the wallet's.
      assertOwnPart(unproven, own);
      const built = analyzePrivateSwapOffer9(unproven, rootSeenAt);
      if (!samePrivateSwapLegs(built.terms.gives, terms.gives) || !samePrivateSwapLegs(built.terms.wants, terms.wants)) {
        throw new PrivateSwapRefusedError('terms');
      }
      timer.lap('build');

      debugLog('🌙 private swap offer (ledger 9): proving', { prover: describeWalletProving(args.proving) });
      const proveStart = Date.now();
      const sealedPart = await timer.time('prove', () => deps.seal(signLedger9Intents(unproven, keystore), args.proving, network));
      const proveDurationMs = Date.now() - proveStart;
      const offerBytes = sealedPart.serialize();
      // What leaves the wallet is read back from its bytes, as a taker will read it.
      const sealed = analyzePrivateSwapOffer9(decodeSealedTransaction9(Buffer.from(offerBytes).toString('hex'), network), rootSeenAt);
      if (!samePrivateSwapLegs(sealed.terms.gives, terms.gives) || !samePrivateSwapLegs(sealed.terms.wants, terms.wants)) {
        throw new PrivateSwapRefusedError('terms');
      }
      await assertChainUnchanged();
      const { expiresAt, expiry } = estimatePrivateSwapExpiry(sealed.ttl, rootSeenAt);
      debugLog('🌙 private swap offer (ledger 9): sealed', { bytes: offerBytes.length, proveDurationMs, expiry });
      outcome = 'ok';
      return {
        offerHex: Buffer.from(offerBytes).toString('hex'), terms: sealed.terms, expiresAt: expiresAt!, expiry: expiry as 'ttl' | 'root-window',
        nullifiers: sealed.nullifiers, proveDurationMs,
      };
    });
  } finally {
    timer.done(outcome);
  }
}

export interface TakePrivateSwapOffer9Args extends SwapWalletKeys {
  /** The offer (`signature / proof / binding` hex, the MIP-0005 bytes). */
  readonly offerHex: string;
  /** What the user approved, from the taker's side ({@link describePrivateSwapOffer9}'s `taker`). */
  readonly approved: PrivateSwapTakerTerms;
  /** The wallet's DUST secret seed: the taker pays the fee. Caller wipes after. */
  readonly dustSecretSeed: Uint8Array;
  readonly onDustSyncProgress?: (percent: number, detail: string) => void;
}

export interface TakePrivateSwapOffer9Result {
  /** The completed swap, sealed (`signature / proof / binding`) hex, ready for submit-proven. */
  readonly txHex: string;
  readonly gives: readonly PrivateSwapLeg[];
  readonly receives: readonly PrivateSwapLeg[];
  /** How many DUST spends the fee took. */
  readonly dustSpends: number;
  readonly proveDurationMs: number;
}

/**
 * Take a swap offer with at least one private leg: build the wallet's mirror
 * of it, pay the DUST fee and return the completed transaction for submission.
 * Refuses (PrivateSwapRefusedError) an offer that is not exactly a two-sided
 * guaranteed-section swap, or whose terms differ from `approved` in any way.
 */
export async function takePrivateSwapOffer9(args: TakePrivateSwapOffer9Args, deps: PrivateSwap9Deps = privateSwap9Deps): Promise<TakePrivateSwapOffer9Result> {
  const network = midnightLedgerKey(args.sdkNetworkId);
  if (args.endpoints.sdkNetworkId !== network) throw new Error('Midnight endpoint network mismatch');
  if (typeof args.offerHex !== 'string' || args.offerHex.length > PRIVATE_SWAP_MAX_OFFER_BYTES * 2) throw new PrivateSwapRefusedError('size');
  let offer: SealedTransaction9;
  try {
    offer = decodeSealedTransaction9(args.offerHex, network);
  } catch {
    throw new PrivateSwapRefusedError('decode');
  }
  const now = deps.now();
  const analysis = analyzePrivateSwapOffer9(offer, now);
  if (![...analysis.terms.gives, ...analysis.terms.wants].some(leg => leg.kind === 'shielded')) throw new PrivateSwapRefusedError('noPrivateLeg');
  const view = takerTerms(analysis.terms);
  const approved = validatePrivateSwapTerms({ gives: args.approved?.receives, wants: args.approved?.gives });
  if (!approved.ok || !samePrivateSwapLegs(view.gives, approved.terms.wants) || !samePrivateSwapLegs(view.receives, approved.terms.gives)) {
    throw new PrivateSwapRefusedError('terms');
  }
  const keystore = ledger9Keystore(args.unshieldedSecretKey, network);
  // A coin the offer already spends (the wallet's own offer) is not the wallet's to give again: a double spend.
  const offerSpends = spentUtxos(offer);
  const selectable = args.utxos.filter(utxo => !offerSpends.has(`${utxo.intentHash.toLowerCase()}#${utxo.outputIndex}`));
  const publicGives = view.gives.filter(leg => leg.kind === 'unshielded');
  if (publicGives.length) {
    if (!connectorIntentSyncReady(args.sync, keystore.getBech32Address().toString())) throw new Error(MIDNIGHT_WALLET_NOT_SYNCED);
    if (uncoveredIntentInput(publicGives, { lastSync: args.sync.lastSync, utxos: selectable })) {
      throw new IntentInsufficientFundsError();
    }
  }
  // The completed swap is dead after the offer's earliest TTL: the wallet's own intent need not outlive it.
  const ttl = analysis.ttl ?? new Date(now + PRIVATE_SWAP_TAKER_TTL_MS);
  debugLog('🌙 private swap take (ledger 9): start', { network, bytes: args.offerHex.length / 2, gives: view.gives.length, receives: view.receives.length });
  const timer = midnightTimer('private swap take (ledger 9)');
  let outcome: 'ok' | 'failed' = 'failed';
  try {
    return await deps.withShieldedWallet(args, async ({ core, keys, assertChainUnchanged }) => {
      timer.lap('shieldedSync');
      // Never select a private coin the offer itself spends (taking one's own offer).
      const shielded = shieldedSide(network, core, keys, view.gives, view.receives, ttl, new Set(analysis.nullifiers));
      const intent = unshieldedSide(network, keystore, selectable, view.gives, view.receives, ttl) ?? ledger.Intent.new(ttl);
      // The wallet's intent (its public leg, or an empty one to carry the fee) on a segment the offer leaves free.
      const taken = new Set(offer.intents ? [...offer.intents.keys()] : []);
      let segment = 1;
      while (taken.has(segment)) segment++;
      const intentPart = ledger.Transaction.fromParts(network).addIntent({ tag: 'specific', value: segment }, intent);
      const carrier: ledger.UnprovenTransaction = shielded ? shielded.tx.merge(intentPart) : intentPart;
      const own: OwnParty = {
        key: keystore.getPublicKey(), addressHex: keystore.getAddress(),
        commitments: shielded?.commitments ?? new Set(), nullifiers: shielded?.nullifiers ?? new Set(),
      };
      assertSwapShape(carrier);
      assertOwnPart(carrier, own);
      assertPartImbalance(carrier, view.gives, view.receives);
      timer.lap('build');

      let parameters: string | undefined;
      const withFee = await timer.time('dustFee', () => deps.balanceFees({
        sdkNetworkId: network, endpoints: args.endpoints, dustSecretSeed: args.dustSecretSeed, ttl,
        onDustSyncProgress: args.onDustSyncProgress,
        // Signed inside the spread, after its DUST actions are in and before the limit check.
        spread: { carrier, sign: unproven => signLedger9Intents(unproven, keystore), onBlock: block => { parameters = block.ledgerParameters; } },
      }, [offer]));
      // The fee added DUST spends and nothing else.
      assertSwapShape(withFee, { allowDust: true });
      assertOwnPart(withFee, own);
      assertPartImbalance(withFee, view.gives, view.receives);
      for (const part of withFee.intents?.values() ?? []) {
        if (part.dustActions && part.dustActions.registrations.length) throw new Error('The swap fee carries an unexpected DUST registration');
      }
      const dustSpends = [...(withFee.intents?.values() ?? [])].reduce((sum, part) => sum + (part.dustActions?.spends.length ?? 0), 0);

      debugLog('🌙 private swap take (ledger 9): proving', { prover: describeWalletProving(args.proving), dustSpends });
      const proveStart = Date.now();
      const sealedPart = await timer.time('prove', () => deps.seal(signLedger9Intents(withFee, keystore), args.proving, network));
      const proveDurationMs = Date.now() - proveStart;
      const merged = offer.merge(sealedPart);
      assertCompletedSwap(merged, parameters);
      await assertChainUnchanged();
      const sealed = merged.serialize();
      timer.lap('mergeCheck');
      debugLog('🌙 private swap take (ledger 9): sealed', { bytes: sealed.length, proveDurationMs, dustSpends });
      outcome = 'ok';
      return { txHex: Buffer.from(sealed).toString('hex'), gives: view.gives, receives: view.receives, dustSpends, proveDurationMs };
    });
  } finally {
    timer.done(outcome);
  }
}

/**
 * The completed swap, as it will be submitted: no token left open in any
 * section, and (with the parameters the fee was priced at) within the
 * ledger's validation-time limit on these exact bytes.
 */
export function assertCompletedSwap(merged: AnyTx9, ledgerParameters: string | undefined): void {
  for (const segment of new Set<number>([0, ...(merged.intents ? [...merged.intents.keys()] : [])])) {
    for (const [token, value] of merged.imbalances(segment)) {
      if (token.tag !== 'dust' && value !== 0n) throw new Error('The completed swap still has a token left open');
    }
  }
  if (!ledgerParameters) throw new Error('The completed swap could not be checked against the ledger\'s limits');
  const params = ledger.LedgerParameters.deserialize(strictMidnightHex(ledgerParameters));
  try {
    merged.cost(params, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`The completed swap is refused by the ledger's limits: ${message.slice(0, 160)}`);
  }
}
