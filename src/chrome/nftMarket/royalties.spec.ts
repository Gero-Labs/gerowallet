// Royalty computation for a new listing: the entries the worker puts into the listing datum from
// the collection's own royalty terms, which the contract then forces every buyer to pay.
//
// What matters here is that the amounts are exact (floor(price x rate) in lovelace, never a
// floating-point product), that a total above the 10% cap is never applied without the seller's
// say-so, that no entry the contract or the min-UTxO rule would choke on is kept, and that
// malformed royalty terms produce no royalty at all rather than a guess.
import { describe, expect, it } from 'vitest';
import type { RoyaltyInfo } from '@/api/nft-market-api';
import { MAX_ROYALTIES, ROYALTY_RATE_CAP } from '@/utils/nftMarketDeployments';
import { computeRoyalties } from './royalties';

const ADA = 1_000_000n;
// Seller and royalty outputs carry a 32-byte inline datum and need about 1.2 ADA (spec 5.5).
const MIN_UTXO = 1_200_000n;
const OPTS = { confirmAboveCap: false, minUtxo: MIN_UTXO };

const CREATOR_A = 'addr1qxcreatora0000000000000000000000000000000000000000000000000000000000000000000000';
const CREATOR_B = 'addr1qxcreatorb0000000000000000000000000000000000000000000000000000000000000000000000';
const CREATOR_C = 'addr1qxcreatorc0000000000000000000000000000000000000000000000000000000000000000000000';
const CREATOR_D = 'addr1qxcreatord0000000000000000000000000000000000000000000000000000000000000000000000';
const CREATOR_E = 'addr1qxcreatore0000000000000000000000000000000000000000000000000000000000000000000000';

/** A CIP-27 or CIP-102 answer whose total is the sum of its recipients (as Nexus sends it). */
function info(recipients: { address: string; rate: number }[], total?: number, source: RoyaltyInfo['source'] = 'cip27'): RoyaltyInfo {
  const sum = recipients.reduce((s, r) => s + r.rate, 0);
  return { source, rate: total ?? sum, recipients };
}

describe('computeRoyalties: amounts', () => {
  it('pays 5% of 100 ADA to one recipient, exactly 5 ADA', () => {
    const r = computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0.05 }]), OPTS);
    expect(r.royalties).toEqual([{ address: CREATOR_A, lovelace: 5_000_000n }]);
    expect(r.dropped).toEqual([]);
    expect(r.rate).toBe(0.05);
    expect(r.needsConfirmation).toBe(false);
    expect(r.malformed).toBe(false);
    expect(r.invalidRecipients).toBe(0);
  });

  it('splits two recipients, each floored on its own rate, in the order they came', () => {
    const r = computeRoyalties(
      100n * ADA,
      info([
        { address: CREATOR_A, rate: 0.05 },
        { address: CREATOR_B, rate: 0.025 },
      ]),
      OPTS,
    );
    expect(r.royalties).toEqual([
      { address: CREATOR_A, lovelace: 5_000_000n },
      { address: CREATOR_B, lovelace: 2_500_000n },
    ]);
    expect(r.rate).toBe(0.075);
    expect(r.needsConfirmation).toBe(false);
  });

  it('floors a fractional lovelace amount: 0.0333 of 123 456 789 lovelace', () => {
    // 123_456_789 * 333 / 10_000 = 4_111_111.0737
    const r = computeRoyalties(123_456_789n, info([{ address: CREATOR_A, rate: 0.0333 }]), OPTS);
    expect(r.royalties).toEqual([{ address: CREATOR_A, lovelace: 4_111_111n }]);
  });

  it('does not lose a lovelace to floating point: 1.57% of 100 ADA is 1 570 000, not 1 569 999', () => {
    // Math.floor(100_000_000 * 0.0157) is 1_569_999 because the product is 1569999.9999999998.
    expect(Math.floor(Number(100n * ADA) * 0.0157)).toBe(1_569_999);
    const r = computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0.0157 }]), OPTS);
    expect(r.royalties).toEqual([{ address: CREATOR_A, lovelace: 1_570_000n }]);
  });

  it('reads a rate written with an exponent (1e-7 of 20 million ADA is exactly 2 ADA)', () => {
    expect(String(1e-7)).toBe('1e-7');
    const r = computeRoyalties(20_000_000n * ADA, info([{ address: CREATOR_A, rate: 1e-7 }]), OPTS);
    expect(r.royalties).toEqual([{ address: CREATOR_A, lovelace: 2_000_000n }]);
  });

  it('absorbs float noise past the 12th decimal instead of paying one lovelace short', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point; it is 30% as far as anyone means.
    const noisy = 0.1 + 0.2;
    expect(noisy).not.toBe(0.3);
    const r = computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: noisy }]), { ...OPTS, confirmAboveCap: true });
    expect(r.royalties).toEqual([{ address: CREATOR_A, lovelace: 30_000_000n }]);
  });

  it('handles prices far beyond 2^53 lovelace without rounding', () => {
    const price = 9_007_199_254_740_993n * 1000n; // not representable as a double
    const r = computeRoyalties(price, info([{ address: CREATOR_A, rate: 0.05 }]), OPTS);
    expect(r.royalties[0].lovelace).toBe((price * 5n) / 100n);
  });

  it('never mutates the info it was given', () => {
    const given = info([
      { address: CREATOR_A, rate: 0.05 },
      { address: CREATOR_B, rate: 0.02 },
    ]);
    const before = JSON.stringify(given);
    computeRoyalties(100n * ADA, given, OPTS);
    expect(JSON.stringify(given)).toBe(before);
  });

  it('refuses a price that is not positive', () => {
    expect(() => computeRoyalties(0n, info([{ address: CREATOR_A, rate: 0.05 }]), OPTS)).toThrow(RangeError);
    expect(() => computeRoyalties(-1n, info([{ address: CREATOR_A, rate: 0.05 }]), OPTS)).toThrow(RangeError);
  });
});

describe('computeRoyalties: none and empty terms', () => {
  it('gives [] for a collection with no royalty terms', () => {
    const r = computeRoyalties(100n * ADA, { source: 'none', rate: 0, recipients: [] }, OPTS);
    expect(r).toEqual({ royalties: [], dropped: [], rate: 0, needsConfirmation: false, malformed: false, invalidRecipients: 0 });
  });

  it('gives [] for CIP-27 terms of 0%', () => {
    const r = computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0 }]), OPTS);
    expect(r.royalties).toEqual([]);
    expect(r.dropped).toEqual([]);
    expect(r.malformed).toBe(false);
    expect(r.rate).toBe(0);
  });

  it('skips a 0% entry beside a real one: it is not a royalty to leave out', () => {
    const r = computeRoyalties(
      100n * ADA,
      info([
        { address: CREATOR_A, rate: 0 },
        { address: CREATOR_B, rate: 0.05 },
      ]),
      OPTS,
    );
    expect(r.royalties).toEqual([{ address: CREATOR_B, lovelace: 5_000_000n }]);
    expect(r.dropped).toEqual([]);
  });

  it('treats a none source that carries a rate or recipients as malformed', () => {
    expect(computeRoyalties(100n * ADA, { source: 'none', rate: 0.05, recipients: [] }, OPTS).malformed).toBe(true);
    expect(
      computeRoyalties(100n * ADA, { source: 'none', rate: 0, recipients: [{ address: CREATOR_A, rate: 0.05 }] }, OPTS).malformed,
    ).toBe(true);
  });
});

describe('computeRoyalties: the 10% cap', () => {
  it('uses the shared cap constant', () => {
    expect(ROYALTY_RATE_CAP).toBe(0.1);
  });

  it('asks for confirmation above the cap and computes nothing until it is given', () => {
    const r = computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0.12 }]), OPTS);
    expect(r.needsConfirmation).toBe(true);
    expect(r.royalties).toEqual([]);
    expect(r.dropped).toEqual([]);
    expect(r.rate).toBe(0.12);
    expect(r.malformed).toBe(false);
  });

  it('computes an above-cap rate once the seller has confirmed it', () => {
    const r = computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0.12 }]), { ...OPTS, confirmAboveCap: true });
    expect(r.needsConfirmation).toBe(false);
    expect(r.royalties).toEqual([{ address: CREATOR_A, lovelace: 12_000_000n }]);
    expect(r.rate).toBe(0.12);
  });

  it('does not ask at exactly 10%', () => {
    const r = computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0.1 }]), OPTS);
    expect(r.needsConfirmation).toBe(false);
    expect(r.royalties).toEqual([{ address: CREATOR_A, lovelace: 10_000_000n }]);
  });

  it('asks as soon as the total is a hair above 10%', () => {
    const r = computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0.1000001 }]), OPTS);
    expect(r.needsConfirmation).toBe(true);
    expect(r.royalties).toEqual([]);
  });

  it('judges the TOTAL across recipients, not each one: 6% + 6% is 12%', () => {
    const terms = info([
      { address: CREATOR_A, rate: 0.06 },
      { address: CREATOR_B, rate: 0.06 },
    ]);
    const asked = computeRoyalties(100n * ADA, terms, OPTS);
    expect(asked.needsConfirmation).toBe(true);
    expect(asked.royalties).toEqual([]);
    expect(asked.rate).toBe(0.12);
    const confirmed = computeRoyalties(100n * ADA, terms, { ...OPTS, confirmAboveCap: true });
    expect(confirmed.royalties).toEqual([
      { address: CREATOR_A, lovelace: 6_000_000n },
      { address: CREATOR_B, lovelace: 6_000_000n },
    ]);
  });

  it('counts a recipient that gets dropped toward the total the seller is asked about', () => {
    // Four recipients means one is dropped for the count, but its rate is still part of what the
    // collection asks for, so the seller is asked about all 12%.
    const terms = info([
      { address: CREATOR_A, rate: 0.03 },
      { address: CREATOR_B, rate: 0.03 },
      { address: CREATOR_C, rate: 0.03 },
      { address: CREATOR_D, rate: 0.03 },
    ]);
    const r = computeRoyalties(100n * ADA, terms, OPTS);
    expect(r.needsConfirmation).toBe(true);
    expect(r.rate).toBe(0.12);
  });
});

describe('computeRoyalties: min-UTxO and the royalty count', () => {
  it('leaves out a 0.5 ADA entry and reports it in dropped', () => {
    // 5% of 10 ADA is 0.5 ADA, under the 1.2 ADA an output with a 32-byte datum needs.
    const r = computeRoyalties(10n * ADA, info([{ address: CREATOR_A, rate: 0.05 }]), OPTS);
    expect(r.royalties).toEqual([]);
    expect(r.dropped).toEqual([{ address: CREATOR_A, lovelace: 500_000n }]);
    expect(r.needsConfirmation).toBe(false);
    expect(r.malformed).toBe(false);
  });

  it('keeps an entry of exactly min-UTxO and drops one lovelace less', () => {
    const exact = computeRoyalties(24n * ADA, info([{ address: CREATOR_A, rate: 0.05 }]), OPTS); // 1_200_000
    expect(exact.royalties).toEqual([{ address: CREATOR_A, lovelace: 1_200_000n }]);
    const short = computeRoyalties(23_999_999n, info([{ address: CREATOR_A, rate: 0.05 }]), OPTS); // 1_199_999
    expect(short.royalties).toEqual([]);
    expect(short.dropped).toEqual([{ address: CREATOR_A, lovelace: 1_199_999n }]);
  });

  it('keeps the big entry and drops the small one when they differ', () => {
    const r = computeRoyalties(
      30n * ADA,
      info([
        { address: CREATOR_A, rate: 0.01 }, // 0.3 ADA, dropped
        { address: CREATOR_B, rate: 0.08 }, // 2.4 ADA, kept
      ]),
      OPTS,
    );
    expect(r.royalties).toEqual([{ address: CREATOR_B, lovelace: 2_400_000n }]);
    expect(r.dropped).toEqual([{ address: CREATOR_A, lovelace: 300_000n }]);
  });

  it('never keeps a zero amount, even when min-UTxO is 0', () => {
    // 1e-7 of 5 ADA floors to 0 lovelace.
    const r = computeRoyalties(5n * ADA, info([{ address: CREATOR_A, rate: 1e-7 }]), { confirmAboveCap: false, minUtxo: 0n });
    expect(r.royalties).toEqual([]);
    expect(r.dropped).toEqual([{ address: CREATOR_A, lovelace: 0n }]);
  });

  it('allows exactly MAX_ROYALTIES entries', () => {
    expect(MAX_ROYALTIES).toBe(3);
    const r = computeRoyalties(
      100n * ADA,
      info([
        { address: CREATOR_A, rate: 0.04 },
        { address: CREATOR_B, rate: 0.03 },
        { address: CREATOR_C, rate: 0.02 },
      ]),
      OPTS,
    );
    expect(r.royalties).toHaveLength(3);
    expect(r.dropped).toEqual([]);
  });

  it('keeps the three largest of four and drops the smallest, in input order', () => {
    const r = computeRoyalties(
      100n * ADA,
      info([
        { address: CREATOR_A, rate: 0.02 },
        { address: CREATOR_B, rate: 0.01 }, // the smallest
        { address: CREATOR_C, rate: 0.04 },
        { address: CREATOR_D, rate: 0.03 },
      ]),
      OPTS,
    );
    expect(r.royalties).toEqual([
      { address: CREATOR_A, lovelace: 2_000_000n },
      { address: CREATOR_C, lovelace: 4_000_000n },
      { address: CREATOR_D, lovelace: 3_000_000n },
    ]);
    expect(r.dropped).toEqual([{ address: CREATOR_B, lovelace: 1_000_000n }]);
    expect(r.rate).toBe(0.1);
    expect(r.needsConfirmation).toBe(false);
  });

  it('breaks a tie by address, so the same terms always keep the same three', () => {
    const entries = [
      { address: CREATOR_E, rate: 0.02 },
      { address: CREATOR_D, rate: 0.02 },
      { address: CREATOR_C, rate: 0.02 },
      { address: CREATOR_B, rate: 0.02 },
      { address: CREATOR_A, rate: 0.02 },
    ];
    const keptOf = (order: typeof entries): string[] =>
      computeRoyalties(100n * ADA, info(order, 0.1), OPTS)
        .royalties.map((p) => p.address)
        .sort();
    // The three smallest addresses win a tie; D and E are dropped.
    expect(keptOf(entries)).toEqual([CREATOR_A, CREATOR_B, CREATOR_C]);
    expect(keptOf([...entries].reverse())).toEqual([CREATOR_A, CREATOR_B, CREATOR_C]);
    expect(keptOf([entries[2], entries[4], entries[0], entries[3], entries[1]])).toEqual([CREATOR_A, CREATOR_B, CREATOR_C]);
    const r = computeRoyalties(100n * ADA, info(entries, 0.1), OPTS);
    expect(r.dropped.map((p) => p.address).sort()).toEqual([CREATOR_D, CREATOR_E]);
  });

  it('drops everything when every entry is under min-UTxO, even with more than three of them', () => {
    const r = computeRoyalties(
      20n * ADA,
      info([
        { address: CREATOR_A, rate: 0.04 }, // 0.8 ADA: under min
        { address: CREATOR_B, rate: 0.03 }, // 0.6 ADA: under min
        { address: CREATOR_C, rate: 0.01 }, // 0.2 ADA: under min
        { address: CREATOR_D, rate: 0.02 }, // 0.4 ADA: under min
      ]),
      OPTS,
    );
    expect(r.royalties).toEqual([]);
    expect(r.dropped).toHaveLength(4);
    for (const p of r.royalties) expect(p.lovelace).toBeGreaterThan(0n);
  });
});

describe('computeRoyalties: malformed terms give no royalty and a flag', () => {
  const none = (r: ReturnType<typeof computeRoyalties>): void => {
    expect(r.royalties).toEqual([]);
    expect(r.dropped).toEqual([]);
    expect(r.needsConfirmation).toBe(false);
    expect(r.malformed).toBe(true);
  };

  it('flags a total that disagrees with the sum of its recipients', () => {
    none(computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0.05 }], 0.08), OPTS));
    none(computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0.05 }], 0.02), OPTS));
  });

  it('accepts a total that differs from the sum by float noise only', () => {
    const r = computeRoyalties(
      100n * ADA,
      info(
        [
          { address: CREATOR_A, rate: 0.1 },
          { address: CREATOR_B, rate: 0.2 },
        ],
        0.1 + 0.2, // 0.30000000000000004
      ),
      { ...OPTS, confirmAboveCap: true },
    );
    expect(r.malformed).toBe(false);
    expect(r.royalties).toEqual([
      { address: CREATOR_A, lovelace: 10_000_000n },
      { address: CREATOR_B, lovelace: 20_000_000n },
    ]);
  });

  it('accepts a total within 1e-9 and flags one beyond it', () => {
    expect(computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0.05 }], 0.05 + 5e-10), OPTS).malformed).toBe(false);
    expect(computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0.05 }], 0.05 + 2e-9), OPTS).malformed).toBe(true);
  });

  it('flags a rate that is not a fraction between 0 and 1', () => {
    for (const bad of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      none(computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: bad }], 0.05), OPTS));
      none(computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0.05 }], bad), OPTS));
    }
  });

  it('flags recipients that add up to more than the whole price', () => {
    none(
      computeRoyalties(
        100n * ADA,
        info([
          { address: CREATOR_A, rate: 0.6 },
          { address: CREATOR_B, rate: 0.6 },
        ]),
        { ...OPTS, confirmAboveCap: true },
      ),
    );
  });

  it('flags a source it does not know and a recipients list that is not a list', () => {
    none(computeRoyalties(100n * ADA, { source: 'cip99' as RoyaltyInfo['source'], rate: 0.05, recipients: [{ address: CREATOR_A, rate: 0.05 }] }, OPTS));
    none(computeRoyalties(100n * ADA, { source: 'cip27', rate: 0.05, recipients: null as unknown as RoyaltyInfo['recipients'] }, OPTS));
  });

  it('has the same shape whatever is wrong: rate 0 and nothing invalid counted', () => {
    const r = computeRoyalties(100n * ADA, info([{ address: CREATOR_A, rate: 0.05 }], 0.5), OPTS);
    expect(r.rate).toBe(0);
    expect(r.invalidRecipients).toBe(0);
  });
});

describe('computeRoyalties: unusable addresses', () => {
  it('drops an entry whose address is not a non-empty string and counts it', () => {
    const r = computeRoyalties(
      100n * ADA,
      info([
        { address: '', rate: 0.02 },
        { address: CREATOR_A, rate: 0.03 },
        { address: undefined as unknown as string, rate: 0.01 },
        { address: '   ', rate: 0.01 },
      ]),
      OPTS,
    );
    expect(r.royalties).toEqual([{ address: CREATOR_A, lovelace: 3_000_000n }]);
    expect(r.invalidRecipients).toBe(3);
    expect(r.dropped).toEqual([]);
    expect(r.malformed).toBe(false);
    // The total the collection asked for still counts: 2 + 3 + 1 + 1 = 7%.
    expect(r.rate).toBe(0.07);
  });

  it('passes a usable address through unchanged', () => {
    const odd = 'addr_test1QPaddress-with_MiXeD-case';
    const r = computeRoyalties(100n * ADA, info([{ address: odd, rate: 0.05 }]), OPTS);
    expect(r.royalties[0].address).toBe(odd);
  });

  it('counts an unusable address toward the cap check', () => {
    const r = computeRoyalties(
      100n * ADA,
      info([
        { address: '', rate: 0.11 },
        { address: CREATOR_A, rate: 0.01 },
      ]),
      OPTS,
    );
    expect(r.needsConfirmation).toBe(true);
    expect(r.invalidRecipients).toBe(1);
    expect(r.royalties).toEqual([]);
  });
});
