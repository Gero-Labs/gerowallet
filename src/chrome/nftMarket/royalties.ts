// Royalty entries for a new Gero listing.
//
// When a user lists an NFT the worker computes the royalty payees that go into the listing datum
// from the collection's own royalty terms (CIP-27 or CIP-102, read by Nexus from the NFT's own
// policy only: `RoyaltyInfo`). The contract then forces every buyer to pay exactly those entries
// (docs/rules.md, one tagged ADA-only output per royalty, each `lovelace > 0`), so what is chosen
// here is what the seller, every buyer and the verifier of the built transaction will hold the
// listing to (spec 5.7 "Royalties").
//
// Rules (spec 5.7):
//  - the amount of each entry is floor(price x rate), in lovelace, exact. A rate arrives as a JS
//    number and is converted to an exact fraction of 10^12 from its decimal text before it meets a
//    lovelace amount, so no float multiplication touches money (100 ADA x 0.0157 must be
//    1_570_000, not the 1_569_999 that Math.floor(1e8 * 0.0157) gives);
//  - the TOTAL rate across recipients is capped at ROYALTY_RATE_CAP: above it nothing is computed
//    until the seller confirms, and then the rate is applied as it is;
//  - an entry under the output's min-UTxO is left out (`dropped`, for the list sheet to show the
//    seller), because the builder would otherwise raise it and the buyer would pay the gap;
//  - at most MAX_ROYALTIES entries are kept: the largest by amount, ties broken by address so the
//    same terms always keep the same entries, in the order the collection gave them;
//  - terms that contradict themselves produce no royalty and a flag, never a guess.
//
// Addresses pass through unchanged. Checking an address's shape and network belongs to whoever
// turns the result into a list intent; only an entry with no address at all is dropped here.

import type { RoyaltyInfo } from '@/api/nft-market-api';
import { MAX_ROYALTIES, ROYALTY_RATE_CAP } from '@/utils/nftMarketDeployments';
import type { Payee } from './listingDatum';

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
   * rates, including entries that were dropped. 0 when the terms are malformed.
   */
  rate: number;
  /** The total is above ROYALTY_RATE_CAP and the seller has not confirmed: nothing was computed. */
  needsConfirmation: boolean;
  /**
   * The terms contradict themselves (a rate outside 0..1, a total that is not the sum of its
   * recipients, a `none` source that carries a rate, an unknown source): no royalty was computed
   * and the caller should say the collection's royalty terms could not be read.
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

/** Units of 1e-12 back to the nearest double (1e12 is exact, so the division rounds once). */
function unitsToRate(units: bigint): number {
  return Number(units) / Number(RATE_SCALE);
}

interface Entry {
  /** Position in the collection's list: the output order, and the last tie-break. */
  index: number;
  address: string;
  units: bigint;
}

interface PricedEntry extends Entry {
  lovelace: bigint;
}

function usableAddress(address: unknown): address is string {
  return typeof address === 'string' && address.trim().length > 0;
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

  // Every recipient's rate, valid or not, counts toward the total.
  const entries: Entry[] = [];
  let total = 0n;
  let invalidRecipients = 0;
  for (const [index, raw] of info.recipients.entries()) {
    const units = rateUnits(raw?.rate);
    if (units === null) return malformedTerms();
    total += units;
    if (units === 0n) continue; // a 0% entry owes nothing: it is not a royalty to leave out
    if (!usableAddress(raw.address)) {
      invalidRecipients++;
      continue;
    }
    entries.push({ index, address: raw.address, units });
  }

  // The collection's own total must be what its recipients add up to, and a `none` source must
  // carry nothing: otherwise the terms contradict themselves.
  const gap = claimed > total ? claimed - total : total - claimed;
  if (gap > RATE_TOLERANCE) return malformedTerms();
  if (info.source === 'none' && (total !== 0n || claimed !== 0n)) return malformedTerms();

  const rate = unitsToRate(total);
  if (total > CAP_UNITS && !opts.confirmAboveCap) {
    return { royalties: [], dropped: [], rate, needsConfirmation: true, malformed: false, invalidRecipients };
  }

  const priced: PricedEntry[] = entries.map((e) => ({ ...e, lovelace: (price * e.units) / RATE_SCALE }));
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
