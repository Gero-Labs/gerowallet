// Read a MIP-0005 swap offer on ledger 9: what it gives and asks for, when it
// expires, which coins it spends and the hash of the maker's intent. Every
// figure comes from the transaction bytes, never from where the offer came
// from (a pasted string, a QR code, a file or Gero's open-offers list).
//
// The maker's offer is sealed and purposefully imbalanced: the guaranteed
// section's SURPLUS per colour is what the maker gives (the taker receives
// it) and its DEFICIT is what the maker asks for (the taker pays it). This is
// summarizeSealed9 (midnightSealedBalancer9.ts) read from the maker's side.
//
// PRIVACY: never log tx bytes. Counts only.

import * as ledger from '@midnightntwrk/ledger-v9';
import { decodeSealedTransaction9, summarizeSealed9 } from './midnightSealedBalancer9';
import type { SealedTransaction9 } from './midnightDustSpread9';
import { CONNECTOR_INTENT_TTL_MS } from './midnightConnectorIntent';
import { MIDNIGHT_SWAP_MIN_TAKE_MS, type MidnightSwapCode } from './midnightSwapConfig';
import { decodeSwapOffer, swapOfferId, SwapOfferFormatError } from './midnightSwapOffer';
import type { MidnightSwapLeg } from './midnightSwapRecords';

/** Allowed clock skew over the longest offer life (as the sealed balancer allows). */
const TTL_SKEW_MS = 60_000;

export interface SwapOfferFacts9 {
  /** MIP-0005 content address of the bytes. */
  readonly offerId: string;
  readonly bytes: number;
  /** What the maker gives: the taker receives it. */
  readonly makerGives: MidnightSwapLeg[];
  /** What the maker asks for: the taker pays it. */
  readonly makerWants: MidnightSwapLeg[];
  /** The earliest intent TTL, epoch ms; `null` when the transaction has no intent. */
  readonly expiresAt: number | null;
  /** Every coin the offer spends, `intentHash#outputNo` (lower-case hash). */
  readonly inputs: string[];
  /** Owners of those coins, as `UserAddress` hex (lower case, de-duplicated). */
  readonly inputOwners: string[];
  /** Recipients of the offer's outputs, as `UserAddress` hex (lower case, de-duplicated). */
  readonly payees: string[];
  /**
   * The intent hash each intent's guaranteed outputs are created under, in
   * segment order (lower case): `intentHash(0)`, the guaranteed segment, not
   * the intent's own segment id. Checked on preprod: the maker's coins from a
   * taken offer carry this hash, so it is how the maker sees the offer taken.
   */
  readonly intentHashes: string[];
  /** Why the wallet cannot take it whatever the time: a private leg, a fallible section, nothing asked or nothing given. */
  readonly unsupported?: 'shielded' | 'fallible' | 'giveOnly' | 'nothingGiven';
}

/** A well-formed sealed ledger 9 offer made on another Midnight network. */
export class SwapOfferWrongNetworkError extends Error {
  constructor() {
    super('The offer is for another Midnight network');
    this.name = 'SwapOfferWrongNetworkError';
  }
}

/**
 * Decode a `swapoffer1…` string to a ledger 9 sealed transaction of
 * `sdkNetworkId`. Throws {@link SwapOfferFormatError} for anything that is not
 * an offer, and {@link SwapOfferWrongNetworkError} for one of another network.
 */
export function readSwapOffer9(offer: string, sdkNetworkId: string): { tx: SealedTransaction9; bytes: Uint8Array } {
  const bytes = decodeSwapOffer(offer);
  let tx: SealedTransaction9;
  try {
    tx = decodeSealedTransaction9(Buffer.from(bytes).toString('hex'), sdkNetworkId);
  } catch {
    let sealed = false;
    try {
      ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
      sealed = true;
    } catch { /* not a sealed transaction at all */ }
    if (sealed) throw new SwapOfferWrongNetworkError();
    throw new SwapOfferFormatError('Not a sealed ledger 9 transaction');
  }
  return { tx, bytes };
}

/** The facts of a decoded offer. The sealed summary's own expiry flag is ignored: {@link swapTakeRefusal} judges the clock. */
export function swapOfferFacts9(tx: SealedTransaction9, bytes: Uint8Array): SwapOfferFacts9 {
  const summary = summarizeSealed9(tx);
  const inputs = new Set<string>();
  const inputOwners = new Set<string>();
  const payees = new Set<string>();
  const intentHashes: string[] = [];
  let expiresAt: number | null = null;
  for (const [, intent] of [...(tx.intents ?? new Map())].sort(([a], [b]) => a - b)) {
    intentHashes.push(String(intent.intentHash(0)).toLowerCase());
    const ttl = intent.ttl.getTime();
    if (expiresAt === null || ttl < expiresAt) expiresAt = ttl;
    for (const offer of [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]) {
      for (const input of offer?.inputs ?? []) {
        inputs.add(`${String(input.intentHash).toLowerCase()}#${input.outputNo}`);
        inputOwners.add(String(ledger.addressFromKey(input.owner)).toLowerCase());
      }
      for (const output of offer?.outputs ?? []) payees.add(String(output.owner).toLowerCase());
    }
  }
  const legs = (side: ReadonlyArray<{ token: string; amount: string }>): MidnightSwapLeg[] =>
    side.map(({ token, amount }) => ({ tokenType: token.toLowerCase(), amount }));
  const makerGives = legs(summary.receives);
  const makerWants = legs(summary.gives);
  let unsupported: SwapOfferFacts9['unsupported'];
  if (summary.problem === 'shielded' || summary.problem === 'fallible') unsupported = summary.problem;
  else if (!makerWants.length) unsupported = 'giveOnly';
  else if (!makerGives.length) unsupported = 'nothingGiven';
  return {
    offerId: swapOfferId(bytes),
    bytes: bytes.length,
    makerGives,
    makerWants,
    expiresAt,
    inputs: [...inputs],
    inputOwners: [...inputOwners],
    payees: [...payees],
    intentHashes,
    unsupported,
  };
}

/**
 * Why `facts` cannot be taken by a wallet whose address is `ownAddressHex` at
 * `now`, or `undefined` when it can. The worker checks again right before it
 * balances: the offer's coins and clock can change between review and take.
 */
export function swapTakeRefusal(facts: SwapOfferFacts9, ownAddressHex: string, now: number): MidnightSwapCode | undefined {
  if (facts.unsupported === 'giveOnly') return 'SWAP_OFFER_GIVE_ONLY';
  if (facts.unsupported) return 'SWAP_OFFER_UNSUPPORTED';
  if (facts.inputOwners.includes(ownAddressHex.toLowerCase())) return 'SWAP_OFFER_OWN';
  if (facts.expiresAt === null) return 'SWAP_OFFER_UNSUPPORTED';
  const ahead = facts.expiresAt - now;
  if (ahead < MIDNIGHT_SWAP_MIN_TAKE_MS) return 'SWAP_OFFER_EXPIRED';
  if (ahead > CONNECTOR_INTENT_TTL_MS + TTL_SKEW_MS) return 'SWAP_OFFER_TOO_LONG';
  return undefined;
}

/** Same legs, in any order: what the page showed against what the bytes say. */
export function sameSwapLegs(a: readonly MidnightSwapLeg[], b: readonly MidnightSwapLeg[]): boolean {
  if (a.length !== b.length) return false;
  const key = (leg: MidnightSwapLeg) => `${leg.tokenType.toLowerCase()}:${leg.amount}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((value, i) => value === right[i]);
}
