// What the list and edit-price sheets show before anything is built: the price the seller typed as
// an exact lovelace amount, and how that price splits between Gero's fee, the creators' royalties
// and the seller. The worker re-derives all of it (marketPrepare.ts) and the review screen shows
// the worker's verified figures, so this is the preview, held to the same arithmetic.
import { describe, expect, it } from 'vitest';
import type { RoyaltyInfo } from '@/api/nft-market-api';
import { NFT_MARKET_DEPLOYMENTS_PREPROD, MAX_LIST_PRICE } from '@/utils/nftMarketDeployments';
import {
  adaInputText,
  classifyDroppedRoyalties,
  pageRoyaltyMinUtxo,
  parseAdaPrice,
  previewNewListing,
  previewRepricedListing,
} from './listingPreview';

const ADA = 1_000_000n;
const V1 = NFT_MARKET_DEPLOYMENTS_PREPROD[0];
/** Under it an output with a tag datum is below min-UTxO (1 155 080 at 4310 per byte). */
const MIN_UTXO = 1_155_080n;

const CREATOR_A = 'addr_test1qpcreatora0000000000000000000000000000000000000000000000000000000000000000';
const CREATOR_B = 'addr_test1qpcreatorb0000000000000000000000000000000000000000000000000000000000000000';
const CREATOR_C = 'addr_test1qpcreatorc0000000000000000000000000000000000000000000000000000000000000000';
const CREATOR_D = 'addr_test1qpcreatord0000000000000000000000000000000000000000000000000000000000000000';

const terms = (recipients: { address: string; rate: number; min?: bigint; max?: bigint }[], source: RoyaltyInfo['source'] = 'cip27'): RoyaltyInfo => ({
  source,
  rate: recipients.reduce((sum, r) => sum + r.rate, 0),
  recipients: recipients.map((r) => ({ address: r.address, rate: r.rate, minFeeLovelace: r.min ?? null, maxFeeLovelace: r.max ?? null })),
});
const NONE: RoyaltyInfo = { source: 'none', rate: 0, recipients: [] };
const preview = (price: bigint, info: RoyaltyInfo) => previewNewListing(price, info, V1, { minUtxo: MIN_UTXO });

describe('parseAdaPrice', () => {
  it('reads ADA text as an exact lovelace amount', () => {
    expect(parseAdaPrice('100')).toEqual({ ok: true, lovelace: 100_000_000n });
    expect(parseAdaPrice('100.5')).toEqual({ ok: true, lovelace: 100_500_000n });
    expect(parseAdaPrice('0.000001')).toEqual({ ok: true, lovelace: 1n });
    expect(parseAdaPrice('007')).toEqual({ ok: true, lovelace: 7_000_000n });
  });

  it('never goes through a float: 4.35, 1.005 and 0.3 come out to the lovelace', () => {
    // 4.35 * 1e6 is 4349999.999999999 as a float.
    expect(parseAdaPrice('4.35')).toEqual({ ok: true, lovelace: 4_350_000n });
    expect(parseAdaPrice('1.005')).toEqual({ ok: true, lovelace: 1_005_000n });
    expect(parseAdaPrice('0.3')).toEqual({ ok: true, lovelace: 300_000n });
    expect(parseAdaPrice('9007199254740993')).toEqual({ ok: true, lovelace: 9_007_199_254_740_993_000_000n });
  });

  it('accepts a comma as the decimal separator, and a bare leading or trailing separator', () => {
    expect(parseAdaPrice('12,5')).toEqual({ ok: true, lovelace: 12_500_000n });
    expect(parseAdaPrice('.5')).toEqual({ ok: true, lovelace: 500_000n });
    expect(parseAdaPrice('5.')).toEqual({ ok: true, lovelace: 5_000_000n });
  });

  it('ignores the whitespace around the text', () => {
    expect(parseAdaPrice('  12 ')).toEqual({ ok: true, lovelace: 12_000_000n });
  });

  it('says empty for nothing at all, so the sheet can stay quiet until the seller types', () => {
    expect(parseAdaPrice('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseAdaPrice('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('refuses anything that is not a plain decimal rather than guessing', () => {
    for (const text of ['abc', '1e3', '-5', '+5', '1 000', '1,000.5', '1.2.3', '1,2,3', '.', ',', '0x10', '١٢٣', '5 ADA', '1_000']) {
      expect(parseAdaPrice(text), text).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('refuses a seventh decimal instead of rounding the price', () => {
    expect(parseAdaPrice('1.0000001')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseAdaPrice('1.000001')).toEqual({ ok: true, lovelace: 1_000_001n });
  });

  it('refuses a number with an absurd number of digits', () => {
    expect(parseAdaPrice('9'.repeat(60))).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('adaInputText', () => {
  it('writes a lovelace amount the way a price is typed: no grouping, no trailing zeros', () => {
    expect(adaInputText(12_500_000n)).toBe('12.5');
    expect(adaInputText(4_995_000_000n)).toBe('4995');
    expect(adaInputText(1n)).toBe('0.000001');
  });

  it('round-trips through parseAdaPrice', () => {
    for (const lovelace of [5_000_000n, 1_234_567n, 100_000_000_001n, 45_000_000_000_000_000n]) {
      expect(parseAdaPrice(adaInputText(lovelace))).toEqual({ ok: true, lovelace });
    }
  });
});

describe('previewNewListing: the split of the price', () => {
  it('100 ADA with a 5% royalty: fee 1.5, royalty 5, you receive 93.5', () => {
    const p = preview(100n * ADA, terms([{ address: CREATOR_A, rate: 0.05 }]))!;
    expect(p.fee).toBe(1_500_000n);
    expect(p.royalties).toEqual([{ address: CREATOR_A, lovelace: 5_000_000n }]);
    expect(p.royaltiesTotal).toBe(5_000_000n);
    expect(p.sellerReceives).toBe(93_500_000n);
    expect(p.issue).toBeNull();
    expect(p.overCap).toBe(false);
    expect(p.dropped).toEqual([]);
  });

  it('takes the fee clamp from the deployment: 10 ADA pays the 1.5 minimum, 600 ADA the 5 cap', () => {
    expect(preview(10n * ADA, NONE)!.fee).toBe(1_500_000n);
    expect(preview(600n * ADA, NONE)!.fee).toBe(5_000_000n);
    expect(preview(600n * ADA, NONE)!.sellerReceives).toBe(595n * ADA);
  });

  it('has nothing to preview for a price of zero or less', () => {
    expect(preview(0n, NONE)).toBeNull();
    expect(preview(-1n, NONE)).toBeNull();
  });

  it('shows each recipient with its own amount, in the collection\'s order', () => {
    const p = preview(200n * ADA, terms([{ address: CREATOR_A, rate: 0.05 }, { address: CREATOR_B, rate: 0.02 }]))!;
    expect(p.royalties.map((r) => [r.address, r.lovelace])).toEqual([[CREATOR_A, 10n * ADA], [CREATOR_B, 4n * ADA]]);
    expect(p.royaltiesTotal).toBe(14n * ADA);
    // 1% of 200 ADA is 2 ADA, above the 1.5 ADA minimum.
    expect(p.fee).toBe(2n * ADA);
    expect(p.sellerReceives).toBe(184n * ADA);
  });

  it('applies a CIP-102 maximum: 5% of 1000 ADA with a 10 ADA cap pays 10 ADA, not 50', () => {
    const p = preview(1_000n * ADA, terms([{ address: CREATOR_A, rate: 0.05, max: 10n * ADA }], 'cip102'))!;
    expect(p.royaltiesTotal).toBe(10n * ADA);
    expect(p.overCap).toBe(false);
  });
});

describe('previewNewListing: what blocks a price', () => {
  it('refuses a price under the 5 ADA minimum, and still shows what 4 ADA would split into', () => {
    const p = preview(4n * ADA, NONE)!;
    expect(p.issue).toBe('PRICE_TOO_LOW');
    expect(p.fee).toBe(1_500_000n);
    expect(p.sellerReceives).toBe(2_500_000n);
  });

  it('accepts exactly the minimum', () => {
    expect(preview(5n * ADA, NONE)!.issue).toBeNull();
    expect(preview(5n * ADA - 1n, NONE)!.issue).toBe('PRICE_TOO_LOW');
  });

  it('refuses a price above what the worker accepts', () => {
    expect(preview(MAX_LIST_PRICE, NONE)!.issue).toBeNull();
    expect(preview(MAX_LIST_PRICE + 1n, NONE)!.issue).toBe('PRICE_TOO_HIGH');
  });

  it('refuses a price that leaves the seller under 1.5 ADA after the fee and royalties', () => {
    // 5 ADA with a 50% royalty (confirmed): fee 1.5, royalty 2.5, seller keeps 1.
    const p = preview(5n * ADA, terms([{ address: CREATOR_A, rate: 0.5 }]))!;
    expect(p.sellerReceives).toBe(1n * ADA);
    expect(p.issue).toBe('SELLER_SHARE_TOO_LOW');
  });

  it('keeps a seller share of exactly 1.5 ADA', () => {
    // 5 ADA with a 40% royalty: fee 1.5, royalty 2, seller keeps 1.5.
    const p = preview(5n * ADA, terms([{ address: CREATOR_A, rate: 0.4 }]))!;
    expect(p.sellerReceives).toBe(1_500_000n);
    expect(p.issue).toBeNull();
  });

  it('refuses a collection whose royalty terms contradict themselves, with no royalties computed', () => {
    const p = preview(100n * ADA, { source: 'cip27', rate: 2, recipients: [{ address: CREATOR_A, rate: 2, minFeeLovelace: null, maxFeeLovelace: null }] })!;
    expect(p.issue).toBe('ROYALTIES_MALFORMED');
    expect(p.royalties).toEqual([]);
  });

  it('reports the price check before the royalty one, as the worker does', () => {
    expect(preview(1n * ADA, { source: 'cip27', rate: 2, recipients: [] })!.issue).toBe('PRICE_TOO_LOW');
  });
});

describe('previewNewListing: royalties above the 10% cap', () => {
  const twelvePercent = terms([{ address: CREATOR_A, rate: 0.12 }]);

  it('asks for the seller\'s confirmation and shows what would be paid, at its effective amount', () => {
    const p = preview(100n * ADA, twelvePercent)!;
    expect(p.overCap).toBe(true);
    expect(p.royalties).toEqual([{ address: CREATOR_A, lovelace: 12n * ADA }]);
    expect(p.royaltiesTotal).toBe(12n * ADA);
    expect(p.sellerReceives).toBe(100n * ADA - 1_500_000n - 12n * ADA);
    expect(p.issue).toBeNull();
  });

  it('is judged on the effective amount: a 1% royalty with a 15 ADA minimum on 100 ADA is 15%', () => {
    const p = preview(100n * ADA, terms([{ address: CREATOR_A, rate: 0.01, min: 15n * ADA }], 'cip102'))!;
    expect(p.overCap).toBe(true);
    expect(p.royaltiesTotal).toBe(15n * ADA);
    expect(p.royaltyFraction).toBe(0.15);
  });

  it('is not asked for at exactly 10%', () => {
    expect(preview(100n * ADA, terms([{ address: CREATOR_A, rate: 0.1 }]))!.overCap).toBe(false);
  });

  it('reads the share of the price as a fraction', () => {
    expect(preview(100n * ADA, terms([{ address: CREATOR_A, rate: 0.05 }]))!.royaltyFraction).toBe(0.05);
    expect(preview(100n * ADA, NONE)!.royaltyFraction).toBe(0);
  });
});

describe('previewNewListing: royalties that are left out', () => {
  it('leaves a royalty under min-UTxO out and keeps the rest', () => {
    // 0.5% of 100 ADA is 0.5 ADA: too small to pay out as its own output.
    const p = preview(100n * ADA, terms([{ address: CREATOR_A, rate: 0.05 }, { address: CREATOR_B, rate: 0.005 }]))!;
    expect(p.royalties).toEqual([{ address: CREATOR_A, lovelace: 5n * ADA }]);
    expect(p.dropped).toEqual([{ address: CREATOR_B, lovelace: 500_000n }]);
    // What was left out is not taken from the seller.
    expect(p.royaltiesTotal).toBe(5n * ADA);
    expect(p.sellerReceives).toBe(93_500_000n);
  });

  it('keeps three recipients at most and says which one did not fit', () => {
    const p = preview(
      100n * ADA,
      terms([
        { address: CREATOR_A, rate: 0.02 },
        { address: CREATOR_B, rate: 0.03 },
        { address: CREATOR_C, rate: 0.04 },
        { address: CREATOR_D, rate: 0.025 },
      ]),
    )!;
    expect(p.royalties.map((r) => r.address)).toEqual([CREATOR_B, CREATOR_C, CREATOR_D]);
    expect(p.dropped).toEqual([{ address: CREATOR_A, lovelace: 2n * ADA }]);
  });

  it('counts recipients with no usable address', () => {
    const p = preview(100n * ADA, terms([{ address: CREATOR_A, rate: 0.05 }, { address: '  ', rate: 0.01 }]))!;
    expect(p.invalidRecipients).toBe(1);
    expect(p.royalties).toEqual([{ address: CREATOR_A, lovelace: 5n * ADA }]);
  });
});

describe('classifyDroppedRoyalties', () => {
  const entry = (address: string, lovelace: bigint) => ({ address, lovelace });

  it('tells a royalty too small to pay apart from one beyond the three-recipient limit', () => {
    const { tooSmall, tooMany } = classifyDroppedRoyalties([entry(CREATOR_A, 500_000n), entry(CREATOR_B, 2n * ADA)], MIN_UTXO);
    expect(tooSmall).toEqual([entry(CREATOR_A, 500_000n)]);
    expect(tooMany).toEqual([entry(CREATOR_B, 2n * ADA)]);
  });

  it('says nothing about an entry of zero lovelace: there was nothing to pay', () => {
    expect(classifyDroppedRoyalties([entry(CREATOR_A, 0n)], MIN_UTXO)).toEqual({ tooSmall: [], tooMany: [] });
  });

  it('puts an entry of exactly min-UTxO with the ones that did not fit', () => {
    expect(classifyDroppedRoyalties([entry(CREATOR_A, MIN_UTXO)], MIN_UTXO)).toEqual({ tooSmall: [], tooMany: [entry(CREATOR_A, MIN_UTXO)] });
    expect(classifyDroppedRoyalties([entry(CREATOR_A, MIN_UTXO - 1n)], MIN_UTXO).tooSmall).toHaveLength(1);
  });
});

describe('previewRepricedListing: a new price, the same royalties', () => {
  const ROYALTIES = [{ address: CREATOR_A, lovelace: 5n * ADA }];

  it('keeps each royalty amount and moves only the fee and the seller\'s share', () => {
    const p = previewRepricedListing(50n * ADA, ROYALTIES, V1)!;
    expect(p.fee).toBe(1_500_000n);
    expect(p.royalties).toEqual(ROYALTIES);
    expect(p.royaltiesTotal).toBe(5n * ADA);
    expect(p.sellerReceives).toBe(50n * ADA - 1_500_000n - 5n * ADA);
    expect(p.issue).toBeNull();
    expect(p.overCap).toBe(false);
    expect(p.dropped).toEqual([]);
  });

  it('refuses a price under the minimum, one above the maximum, and one that leaves the seller under 1.5 ADA', () => {
    expect(previewRepricedListing(4n * ADA, [], V1)!.issue).toBe('PRICE_TOO_LOW');
    expect(previewRepricedListing(MAX_LIST_PRICE + 1n, [], V1)!.issue).toBe('PRICE_TOO_HIGH');
    // 6 ADA: fee 1.5, the fixed 5 ADA royalty leaves -0.5.
    expect(previewRepricedListing(6n * ADA, ROYALTIES, V1)!.issue).toBe('SELLER_SHARE_TOO_LOW');
  });

  it('shows the royalty as a share of the NEW price', () => {
    expect(previewRepricedListing(50n * ADA, ROYALTIES, V1)!.royaltyFraction).toBe(0.1);
  });
});

describe('pageRoyaltyMinUtxo', () => {
  it('is the worker\'s min-UTxO at the reviewed ceiling of 4310 per byte', () => {
    expect(pageRoyaltyMinUtxo(4310)).toBe(1_155_080n);
    expect(pageRoyaltyMinUtxo(undefined)).toBe(1_155_080n);
  });

  it('never goes above that ceiling, so an inflated figure cannot make a royalty look too small', () => {
    expect(pageRoyaltyMinUtxo(999_999)).toBe(1_155_080n);
  });

  it('follows a lower parameter, and ignores one that is not a positive whole number', () => {
    expect(pageRoyaltyMinUtxo(4000)).toBeLessThan(1_155_080n);
    expect(pageRoyaltyMinUtxo('4000')).toBe(pageRoyaltyMinUtxo(4000));
    for (const bad of [0, -5, 4310.5, Number.NaN, 'abc', null, {}]) expect(pageRoyaltyMinUtxo(bad), String(bad)).toBe(1_155_080n);
  });
});
