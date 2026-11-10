// Royalty entries for a new Gero listing.
//
// When a user lists an NFT the worker computes the royalty payees that go into the listing datum
// from the collection's own royalty terms (CIP-27 or CIP-102, read by Nexus from the NFT's own
// policy only: `RoyaltyInfo`). The contract then forces every buyer to pay exactly those entries
// (docs/rules.md, one tagged ADA-only output per royalty, each `lovelace > 0`), so what is chosen
// here is what the seller, every buyer and the verifier of the built transaction will hold the
// listing to.
//
// Rules:
//  - the amount of each entry is floor(price x rate), in lovelace, exact. A rate arrives as a JS
//    number and is converted to an exact fraction of 10^12 from its decimal text before it meets a
//    lovelace amount, so no float multiplication touches money (100 ADA x 0.0157 must be
//    1_570_000, not the 1_569_999 that Math.floor(1e8 * 0.0157) gives);
//  - a CIP-102 recipient may carry a minimum and a maximum fee, and the amount is then
//    max(min, min(max, floor(price x rate))) (CIP-102), an absent bound ignored. Without the clamp
//    a 5% royalty with a 10 ADA maximum would write 500 ADA into a 10 000 ADA listing instead of
//    10. Everything below (the cap question, min-UTxO, the royalty count) works on the clamped
//    amounts;
//  - the 10% cap is judged twice: on the TOTAL rate across recipients and on the EFFECTIVE total
//    (the sum of the clamped amounts, as a share of the price, compared exactly in bigint). Either
//    one above ROYALTY_RATE_CAP means nothing is computed until the seller confirms, and then the
//    entries are applied as they are. A minimum can push a 1% royalty far above 10%; a maximum can
//    bring a 12% rate under it, and the rate total still asks;
//  - an entry under the output's min-UTxO is left out (`dropped`, for the list sheet to show the
//    seller), because the builder would otherwise raise it and the buyer would pay the gap;
//  - at most MAX_ROYALTIES entries are kept: the largest by amount, ties broken by address so the
//    same terms always keep the same entries, in the order the collection gave them;
//  - terms that contradict themselves (including a minimum above a maximum, or royalties that cost
//    more than the whole price) produce no royalty and a flag, never a guess.
//
// Addresses pass through unchanged. Checking an address's shape and network belongs to whoever
// turns the result into a list intent; only an entry with no address at all is dropped here.

import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import type { RoyaltyInfo } from '@/api/nft-market-api';
import { DEFAULT_COINS_PER_UTXO_BYTE } from '@/shared/utils/txIntentGuard';
import { inlineDatumFromCbor } from '@/shared/utils/utxoCbor';
import { MAX_ROYALTIES, ROYALTY_RATE_CAP } from '@/utils/nftMarketDeployments';
import type { Payee } from './listingDatum';
import { effectiveCoinsPerUtxoByte, minUtxoOf } from './minUtxo';

export interface RoyaltyOptions {
  /** The seller has accepted a total above ROYALTY_RATE_CAP. */
  confirmAboveCap: boolean;
  /** Least lovelace an output with a 32-byte inline datum may hold; entries under it are left out. */
  minUtxo: bigint;
}

export interface RoyaltyComputation {
  /** The entries for the datum, in the order the collection gave them. Every lovelace is above 0. */
  royalties: Payee[];
  /** Entries left out for being under min-UTxO or beyond MAX_ROYALTIES, in the collection's order. */
  dropped: Payee[];
  /**
   * The total rate the collection asks for, a fraction from 0 to 1: the sum of its recipients'
   * rates, including entries that were dropped. It is the rate, not what is paid: fee bounds can
   * make the royalties cost more or less. 0 when the terms are malformed.
   */
  rate: number;
  /**
   * The total rate, or the total the clamped royalties actually cost, is above ROYALTY_RATE_CAP
   * (of the price) and the seller has not confirmed: nothing was computed.
   */
  needsConfirmation: boolean;
  /**
   * The terms contradict themselves (a rate outside 0..1, a total that is not the sum of its
   * recipients, a `none` source that carries a rate, an unknown source, a fee bound that is not a
   * non-negative bigint or a minimum above its maximum, royalties that add up to more than the
   * price): no royalty was computed and the caller should say the collection's royalty terms could
   * not be read.
   */
  malformed: boolean;
  /** Entries dropped because they had no usable address (not in `dropped`: there is no address to show). */
  invalidRecipients: number;
}

/** Rates are held as whole multiples of 1 / RATE_SCALE. */
const RATE_DECIMALS = 12;
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);
/** A total may differ from its recipients' sum by this much (1e-9) before the terms are malformed. */
const RATE_TOLERANCE = RATE_SCALE / 1_000_000_000n;

/** The result for terms that cannot be trusted: nothing computed, flagged. A fresh object per call. */
function malformedTerms(): RoyaltyComputation {
  return { royalties: [], dropped: [], rate: 0, needsConfirmation: false, malformed: true, invalidRecipients: 0 };
}

/**
 * A rate (a JS number from 0 to 1) as an exact whole number of 1e-12 units, read from its
 * shortest decimal text ("0.0333", "1e-7"), never by multiplying floats. Digits beyond the 12th
 * decimal are rounded half up: they are float noise (0.1 + 0.2 is 0.30000000000000004, and means
 * 0.3). Returns null for anything that is not a finite number in [0, 1].
 */
function rateUnits(rate: unknown): bigint | null {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) return null;
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(rate));
  if (!m) return null;
  const fraction = m[2] ?? '';
  const digits = BigInt(m[1] + fraction);
  // value = digits x 10^(exponent - fraction.length); in units of 1e-12 that is digits x 10^shift.
  const shift = Number(m[3] ?? 0) - fraction.length + RATE_DECIMALS;
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  return (digits + divisor / 2n) / divisor;
}

/** ROYALTY_RATE_CAP in the same units, read once. */
const CAP_UNITS: bigint = (() => {
  const units = rateUnits(ROYALTY_RATE_CAP);
  if (units === null) throw new Error('ROYALTY_RATE_CAP must be a fraction from 0 to 1');
  return units;
})();

/**
 * Whether `royaltiesLovelace` is more than ROYALTY_RATE_CAP of `price`, compared exactly in bigint
 * (cross-multiplied, so nothing is rounded: for the 10% cap this is royalties x 10 > price). The
 * one test of "above the usual limit", used for the computed royalties of a new listing, a move and
 * a reprice (whose royalties are computed again at its new price).
 */
export function royaltiesAboveCap(royaltiesLovelace: bigint, price: bigint): boolean {
  return royaltiesLovelace * RATE_SCALE > price * CAP_UNITS;
}

/** Units of 1e-12 back to the nearest double (1e12 is exact, so the division rounds once). */
function unitsToRate(units: bigint): number {
  return Number(units) / Number(RATE_SCALE);
}

interface Entry {
  /** Position in the collection's list: the output order, and the last tie-break. */
  index: number;
  address: string;
  units: bigint;
  minFee: bigint | null;
  maxFee: bigint | null;
}

interface PricedEntry extends Entry {
  lovelace: bigint;
}

function usableAddress(address: unknown): address is string {
  return typeof address === 'string' && address.trim().length > 0;
}

/**
 * A fee bound: a non-negative bigint, or null when the collection sets none (a recipient from
 * before the bounds existed has the field missing, which reads as none). `false` for anything else.
 */
function feeBound(value: unknown): bigint | null | false {
  if (value === undefined || value === null) return null;
  return typeof value === 'bigint' && value >= 0n ? value : false;
}

/** CIP-102: max(min, min(max, floor(price x rate))), a null bound ignored. Exact, all bigint. */
function clamped(price: bigint, units: bigint, minFee: bigint | null, maxFee: bigint | null): bigint {
  let lovelace = (price * units) / RATE_SCALE;
  if (maxFee !== null && lovelace > maxFee) lovelace = maxFee;
  if (minFee !== null && lovelace < minFee) lovelace = minFee;
  return lovelace;
}

/**
 * The royalty entries for a listing at `price` (lovelace, above 0) from a collection's royalty
 * terms. Pure and deterministic. See the module comment for the rules; `RoyaltyComputation` says
 * what every field means. Throws RangeError for a price that is not positive (the caller checks
 * the price against MIN_LIST_PRICE before it gets here).
 */
export function computeRoyalties(price: bigint, info: RoyaltyInfo, opts: RoyaltyOptions): RoyaltyComputation {
  if (typeof price !== 'bigint' || price <= 0n) {
    throw new RangeError('A listing price must be a positive amount of lovelace');
  }
  if (!info || (info.source !== 'cip27' && info.source !== 'cip102' && info.source !== 'none') || !Array.isArray(info.recipients)) {
    return malformedTerms();
  }
  const claimed = rateUnits(info.rate);
  if (claimed === null) return malformedTerms();

  // Every recipient's rate and clamped amount, valid address or not, counts toward the totals.
  const entries: Entry[] = [];
  let total = 0n;
  let effective = 0n;
  let invalidRecipients = 0;
  for (const [index, raw] of info.recipients.entries()) {
    const units = rateUnits(raw?.rate);
    if (units === null) return malformedTerms();
    const minFee = feeBound(raw.minFeeLovelace);
    const maxFee = feeBound(raw.maxFeeLovelace);
    if (minFee === false || maxFee === false) return malformedTerms();
    if (minFee !== null && maxFee !== null && minFee > maxFee) return malformedTerms();
    total += units;
    effective += clamped(price, units, minFee, maxFee);
    // A 0% entry with no minimum owes nothing: it is not a royalty to leave out.
    if (units === 0n && (minFee === null || minFee === 0n)) continue;
    if (!usableAddress(raw.address)) {
      invalidRecipients++;
      continue;
    }
    entries.push({ index, address: raw.address, units, minFee, maxFee });
  }

  // The collection's own total must be what its recipients add up to, and a `none` source must
  // carry nothing: otherwise the terms contradict themselves.
  const gap = claimed > total ? claimed - total : total - claimed;
  if (gap > RATE_TOLERANCE) return malformedTerms();
  if (info.source === 'none' && (total !== 0n || claimed !== 0n)) return malformedTerms();

  // Royalties that cost more than the whole price leave the seller nothing to be paid out of: the
  // terms cannot be honoured, confirmed or not (the amount analogue of a total rate above 1).
  if (effective > price) return malformedTerms();

  const rate = unitsToRate(total);
  const overCap = total > CAP_UNITS || royaltiesAboveCap(effective, price);
  if (overCap && !opts.confirmAboveCap) {
    return { royalties: [], dropped: [], rate, needsConfirmation: true, malformed: false, invalidRecipients };
  }

  const priced: PricedEntry[] = entries.map((e) => ({ ...e, lovelace: clamped(price, e.units, e.minFee, e.maxFee) }));
  const keep = new Set(
    priced
      .filter((e) => e.lovelace > 0n && e.lovelace >= opts.minUtxo)
      .sort(largestThenAddress)
      .slice(0, MAX_ROYALTIES)
      .map((e) => e.index),
  );

  const royalties: Payee[] = [];
  const dropped: Payee[] = [];
  for (const e of priced) {
    (keep.has(e.index) ? royalties : dropped).push({ address: e.address, lovelace: e.lovelace });
  }
  return { royalties, dropped, rate, needsConfirmation: false, malformed: false, invalidRecipients };
}

/** Largest amount first; a tie goes to the smaller address (code-unit order), then to the earlier entry. */
function largestThenAddress(a: PricedEntry, b: PricedEntry): number {
  if (a.lovelace !== b.lovelace) return a.lovelace > b.lovelace ? -1 : 1;
  if (a.address !== b.address) return a.address < b.address ? -1 : 1;
  return a.index - b.index;
}

// ---------------------------------------------------------------------------------------------
// The smallest royalty an output can hold
// ---------------------------------------------------------------------------------------------

/** 32-byte inline datum: what a payee output with its listing tag carries. */
const TAG_DATUM_SAMPLE = `5820${'00'.repeat(32)}`;
/** Any amount that encodes the way a royalty usually does (4 bytes); the minimum hardly moves with it. */
const SAMPLE_COINS = 2_000_000n;

/**
 * The least lovelace a royalty payee output (a base address, an ADA amount, the 32-byte tag as
 * inline datum) may hold: `(160 + serialised size) * coinsPerUtxoByte`, 1,155,080 at 4310. A
 * royalty under it is left out of the datum rather than raised by the builder at the buyer's
 * expense (spec 5.5). A shorter address (enterprise) could hold a little less; the base address
 * is the common case and the larger of the two, so a royalty that is left out is never one that
 * would have fitted.
 */
export function royaltyOutputMinUtxo(coinsPerUtxoByte: bigint): bigint {
  const key = { hash: Hash28ByteBase16('00'.repeat(28)), type: Cardano.CredentialType.KeyHash };
  const address = Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, key, key).toAddress().toBech32();
  const output: Cardano.TxOut = {
    address: Cardano.PaymentAddress(address),
    value: { coins: SAMPLE_COINS },
    datum: inlineDatumFromCbor(HexBlob(TAG_DATUM_SAMPLE)),
  };
  return minUtxoOf(output, coinsPerUtxoByte);
}

/** A protocol parameter from the store: a positive whole number as a number, a bigint or decimal text; else none. */
export function protocolParameter(raw: unknown): bigint | undefined {
  let value: bigint | undefined;
  if (typeof raw === 'bigint') value = raw;
  else if (typeof raw === 'number' && Number.isSafeInteger(raw)) value = BigInt(raw);
  else if (typeof raw === 'string' && /^[0-9]{1,15}$/.test(raw)) value = BigInt(raw);
  return value !== undefined && value > 0n ? value : undefined;
}

/**
 * The least a royalty output may hold at the network's `coinsPerUtxoByte` (`protocolParameter`'s
 * answer: a positive whole number, or undefined for an unusable one), capped at the reviewed
 * ceiling (`effectiveCoinsPerUtxoByte`, as verifyBuy does): an inflated figure in the store must
 * not make every royalty look too small to keep, and none is the ceiling itself. The one
 * threshold of the worker's royalty choice and of the list sheet's preview.
 */
export function royaltyMinUtxoFor(coinsPerUtxoByte: bigint | undefined): bigint {
  return royaltyOutputMinUtxo(effectiveCoinsPerUtxoByte(coinsPerUtxoByte) ?? DEFAULT_COINS_PER_UTXO_BYTE);
}
