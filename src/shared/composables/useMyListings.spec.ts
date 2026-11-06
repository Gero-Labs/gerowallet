// The wallet's own Gero listings as a page reads them: from walletStore.listedListings, where the
// bigint fields of each datum can be decimal strings (a store broadcast, or IndexedDB). The page
// always gets bigints back, keyed by ref list and by NFT unit.
import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ listedListings: [] as unknown[] }) };
});

import { useMyListings } from './useMyListings';
import { walletStore } from '@/stores/walletStore';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';

const OWNER = 'aa'.repeat(28);
const UNIT_A = `${'01'.repeat(28)}4e4654`;
const UNIT_B = `${'02'.repeat(28)}4e4655`;

/** A listing as the store holds it after a JSON round trip: bigints as decimal strings. */
const stored = (ref: string, unit: string, price: string) => ({
  ref,
  unit,
  depositLovelace: '2000000',
  deploymentVersion: 1,
  datum: {
    owner: OWNER,
    sellerAddress: 'addr_test1seller',
    price,
    royalties: [{ address: 'addr_test1artist', lovelace: '500000' }],
    buyer: null,
  },
});

/** The store typed as its callers see it; what it holds after a JSON round trip is not that shape. */
const holds = (rows: unknown[]): void => {
  walletStore.listedListings = rows as OwnListing[];
};

const REF_A = `${'a1'.repeat(32)}#0`;
const REF_B = `${'b2'.repeat(32)}#3`;

describe('useMyListings', () => {
  beforeEach(() => {
    holds([]);
  });

  it('is empty while the wallet has no listings', () => {
    const { listings, byUnit } = useMyListings();
    expect(listings.value).toEqual([]);
    expect(byUnit.value.size).toBe(0);
  });

  it('revives the bigint fields the store carries as decimal strings', () => {
    holds([stored(REF_A, UNIT_A, '25000000')]);
    const { listings } = useMyListings();

    expect(listings.value).toHaveLength(1);
    const [listing] = listings.value;
    expect(listing.ref).toBe(REF_A);
    expect(listing.unit).toBe(UNIT_A);
    expect(listing.datum.price).toBe(25_000_000n);
    expect(listing.datum.royalties).toEqual([{ address: 'addr_test1artist', lovelace: 500_000n }]);
    expect(listing.depositLovelace).toBe('2000000');
  });

  it('accepts listings whose bigints are already bigints', () => {
    const listing = stored(REF_A, UNIT_A, '1');
    holds([{ ...listing, datum: { ...listing.datum, price: 9_000_000n, royalties: [] } }]);
    const { listings } = useMyListings();
    expect(listings.value[0].datum.price).toBe(9_000_000n);
  });

  it('keys the listings by the NFT unit', () => {
    holds([stored(REF_A, UNIT_A, '25000000'), stored(REF_B, UNIT_B, '30000000')]);
    const { byUnit } = useMyListings();

    expect(byUnit.value.size).toBe(2);
    expect(byUnit.value.get(UNIT_A)?.ref).toBe(REF_A);
    expect(byUnit.value.get(UNIT_B)?.datum.price).toBe(30_000_000n);
    expect(byUnit.value.get(`${'03'.repeat(28)}00`)).toBeUndefined();
  });

  it('follows the store: a new listing appears, a sold one goes', async () => {
    const { listings, byUnit } = useMyListings();
    expect(listings.value).toHaveLength(0);

    holds([stored(REF_A, UNIT_A, '25000000')]);
    await nextTick();
    expect(listings.value.map((l) => l.ref)).toEqual([REF_A]);
    expect(byUnit.value.has(UNIT_A)).toBe(true);

    holds([]);
    await nextTick();
    expect(listings.value).toEqual([]);
    expect(byUnit.value.has(UNIT_A)).toBe(false);
  });

  it('skips a row that cannot be read rather than failing the page', () => {
    holds([{ ref: 'broken' }, stored(REF_A, UNIT_A, '25000000'), null]);
    const { listings } = useMyListings();
    expect(listings.value.map((l) => l.ref)).toEqual([REF_A]);
  });

  it('keeps the first listing of a unit if a stale store ever shows two', () => {
    holds([stored(REF_A, UNIT_A, '25000000'), stored(REF_B, UNIT_A, '30000000')]);
    const { listings, byUnit } = useMyListings();
    expect(listings.value).toHaveLength(2);
    expect(byUnit.value.get(UNIT_A)?.ref).toBe(REF_A);
  });
});
