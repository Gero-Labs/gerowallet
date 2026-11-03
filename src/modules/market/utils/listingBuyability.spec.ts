// What the wallet may do with a listing in a collection's list. The browse page offers Buy only
// where the worker would build one: never the wallet's own listing (it is cancelled, not bought),
// never a private listing (R2: the buy builder and the worker refuse every listing with a `buyer`
// in this phase, this account's own keys included), never a listing whose datum does not read as
// a Gero listing. The datum is read here the way the worker reads
// it, from the row's own bytes, because the row's other fields are Nexus's word.
import { describe, expect, it } from 'vitest';
import { MAX_ROYALTIES } from '@/utils/nftMarketDeployments';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import type { Keys } from '@/models/types';
import { listingRow, preprodAddress, refOf, STRANGER_KEY, STRANGER_STAKE } from './__fixtures__/listingFixtures';
import { buyerIdentity, listingBuyState, type BuyerIdentity } from './listingBuyability';

const TESTNET = 0;
const MY_PAYMENT = 'a1'.repeat(28);
const MY_CHANGE = 'a2'.repeat(28);
const MY_STAKE = 'a3'.repeat(28);
const MY_ADDRESS = preprodAddress(MY_PAYMENT, MY_STAKE);
const MY_CHANGE_ADDRESS = preprodAddress(MY_CHANGE, MY_STAKE);

const keys = {
  payment: [{ cred: MY_PAYMENT, address: MY_ADDRESS, path: 'm/1852/1815/0/0/0' }],
  change: [{ cred: MY_CHANGE, address: MY_CHANGE_ADDRESS, path: 'm/1852/1815/0/1/0' }],
  stake: [{ cred: MY_STAKE, address: 'stake_test1x', path: 'm/1852/1815/0/2/0' }],
} as unknown as Keys;

const own = (listings: readonly OwnListing[] = []): BuyerIdentity => buyerIdentity(keys, listings);

describe('buyerIdentity', () => {
  it('holds the account\'s payment, change and stake key hashes and its key addresses, lower-cased', () => {
    const who = buyerIdentity(
      { payment: [{ cred: MY_PAYMENT.toUpperCase(), address: MY_ADDRESS }], change: [], stake: [{ cred: MY_STAKE }] } as unknown as Keys,
      [],
    );
    expect(who.keyHashes).toEqual(new Set([MY_PAYMENT, MY_STAKE]));
    expect(who.addresses).toEqual(new Set([MY_ADDRESS]));
  });

  it('holds the refs of the wallet\'s own listings', () => {
    const ref = `${'ab'.repeat(32)}#3`;
    expect(own([{ ref } as OwnListing]).listingRefs).toEqual(new Set([ref]));
  });

  it('is empty, not an error, for a wallet whose keys have not loaded', () => {
    const who = buyerIdentity(null, []);
    expect(who.keyHashes.size + who.addresses.size + who.listingRefs.size).toBe(0);
  });

  it('ignores a malformed hash', () => {
    const who = buyerIdentity({ payment: [{ cred: 'xyz' }, { cred: 42 }], change: [], stake: [] } as unknown as Keys, []);
    expect(who.keyHashes.size).toBe(0);
  });
});

describe('listingBuyState', () => {
  it('is buyable for a public listing that is somebody else\'s', () => {
    expect(listingBuyState(listingRow(), TESTNET, own())).toEqual({ kind: 'buyable' });
  });

  describe('the wallet\'s own listing is shown as its own, and never offered', () => {
    it('by the wallet\'s own listing refs (useMyListings)', () => {
      const row = listingRow({ index: 4 });
      expect(listingBuyState(row, TESTNET, own([{ ref: refOf(row) } as OwnListing]))).toEqual({ kind: 'own' });
    });

    it('by the datum: owner AND seller are both the account\'s (a payment or change key and its own address)', () => {
      expect(listingBuyState(listingRow({ owner: MY_PAYMENT, stake: MY_STAKE }), TESTNET, own())).toEqual({ kind: 'own' });
      expect(listingBuyState(listingRow({ owner: MY_CHANGE, stake: MY_STAKE }), TESTNET, own())).toEqual({ kind: 'own' });
    });

    it('whatever the datum is: an unreadable datum under an own ref is still the wallet\'s own', () => {
      const row = listingRow({ datumCbor: '00' });
      expect(listingBuyState(row, TESTNET, own([{ ref: refOf(row) } as OwnListing]))).toEqual({ kind: 'own' });
    });

    it('whatever the row says: an own ref is the wallet\'s own', () => {
      const row = { ...listingRow({ index: 6 }), priceLovelace: '1' };
      expect(listingBuyState(row, TESTNET, own([{ ref: refOf(row) } as OwnListing]))).toEqual({ kind: 'own' });
    });
  });

  describe('a listing that names the account on only one side is not marked as its own, and is never offered', () => {
    it('the owner is the account\'s and the seller is somebody else\'s: the fake "your listing" that pays an attacker', () => {
      for (const owner of [MY_PAYMENT, MY_CHANGE, MY_STAKE]) {
        expect(listingBuyState(listingRow({ owner }), TESTNET, own()), owner).toEqual({ kind: 'contested' });
      }
      // The seller is an attacker's address, whoever the owner key is.
      const bait = listingRow({ owner: MY_PAYMENT, sellerAddress: preprodAddress(STRANGER_KEY, STRANGER_STAKE) });
      expect(listingBuyState(bait, TESTNET, own())).toEqual({ kind: 'contested' });
    });

    it('the seller address is the account\'s and the owner is somebody else\'s', () => {
      expect(listingBuyState(listingRow({ owner: STRANGER_KEY, sellerAddress: MY_CHANGE_ADDRESS }), TESTNET, own())).toEqual({ kind: 'contested' });
      expect(listingBuyState(listingRow({ owner: STRANGER_KEY, sellerAddress: MY_ADDRESS }), TESTNET, own())).toEqual({ kind: 'contested' });
    });
  });

  describe('a private listing (buyer set) is never shown, so never offered, whoever the buyer or the seller is', () => {
    it('a key that is not the account\'s', () => {
      expect(listingBuyState(listingRow({ buyer: STRANGER_KEY }), TESTNET, own())).toEqual({ kind: 'private' });
    });

    it('one of the account\'s own payment, change or stake keys: the worker refuses every private listing in this phase', () => {
      for (const buyer of [MY_PAYMENT, MY_CHANGE, MY_STAKE]) {
        expect(listingBuyState(listingRow({ buyer }), TESTNET, own()), buyer).toEqual({ kind: 'private' });
      }
    });

    it('the account\'s own private listing is hidden too (by owner and seller, and by an own ref)', () => {
      expect(listingBuyState(listingRow({ owner: MY_PAYMENT, stake: MY_STAKE, buyer: STRANGER_KEY }), TESTNET, own())).toEqual({ kind: 'private' });
      const row = listingRow({ index: 8, buyer: STRANGER_KEY });
      expect(listingBuyState(row, TESTNET, own([{ ref: refOf(row) } as OwnListing]))).toEqual({ kind: 'private' });
    });
  });

  describe('a row that contradicts its own datum is not read, and is never offered', () => {
    it('a bait price: the row says 10 ADA and the datum 120', () => {
      const row = { ...listingRow(), priceLovelace: (10n * 1_000_000n).toString() };
      expect(listingBuyState(row, TESTNET, own())).toEqual({ kind: 'unreadable' });
    });

    it('a different owner, or a different seller address', () => {
      expect(listingBuyState({ ...listingRow(), ownerPkh: '55'.repeat(28) }, TESTNET, own())).toEqual({ kind: 'unreadable' });
      expect(listingBuyState({ ...listingRow(), sellerAddress: MY_ADDRESS }, TESTNET, own())).toEqual({ kind: 'unreadable' });
    });

    it('a price that is not a number, and a row whose owner is not text', () => {
      expect(listingBuyState({ ...listingRow(), priceLovelace: 'lots' }, TESTNET, own())).toEqual({ kind: 'unreadable' });
      expect(listingBuyState({ ...listingRow(), ownerPkh: undefined as never }, TESTNET, own())).toEqual({ kind: 'unreadable' });
    });

    it('ignores the case of a hash or an address, which is not a contradiction', () => {
      const row = listingRow();
      expect(listingBuyState({ ...row, ownerPkh: row.ownerPkh.toUpperCase() }, TESTNET, own())).toEqual({ kind: 'buyable' });
    });

    // verifyBuy holds the row's royalties to the datum's (the contract pays the datum's), so a row
    // that shows others is not one Buy may be offered on: the worker would refuse it.
    describe('royalties', () => {
      const CREATOR_A = preprodAddress('c1'.repeat(28), 'c2'.repeat(28));
      const CREATOR_B = preprodAddress('c3'.repeat(28), 'c4'.repeat(28));
      const ROYALTIES = [{ address: CREATOR_A, lovelace: '5000000' }, { address: CREATOR_B, lovelace: '2000000' }];
      const withRoyalties = listingRow({ royalties: ROYALTIES });

      it('a row that reports the datum\'s royalties is buyable', () => {
        expect(listingBuyState(withRoyalties, TESTNET, own())).toEqual({ kind: 'buyable' });
      });

      it('ignores the case of a royalty address, which is not a contradiction', () => {
        const row = { ...withRoyalties, royalties: ROYALTIES.map((r) => ({ ...r, address: r.address.toUpperCase() })) };
        expect(listingBuyState(row, TESTNET, own())).toEqual({ kind: 'buyable' });
      });

      it.each([
        ['a lower amount', [{ ...ROYALTIES[0], lovelace: '4000000' }, ROYALTIES[1]]],
        ['a higher amount', [{ ...ROYALTIES[0], lovelace: '5000001' }, ROYALTIES[1]]],
        ['another address', [{ ...ROYALTIES[0], address: CREATOR_B }, ROYALTIES[1]]],
        ['the same royalties in another order', [ROYALTIES[1], ROYALTIES[0]]],
        ['one royalty left out', [ROYALTIES[0]]],
        ['no royalties at all', []],
        ['an extra royalty', [...ROYALTIES, { address: CREATOR_A, lovelace: '1000000' }]],
        ['no list at all', undefined],
        ['a list that is not one', 'five' as never],
      ])('a row that shows %s is not read', (_what, royalties) => {
        expect(listingBuyState({ ...withRoyalties, royalties: royalties as never }, TESTNET, own())).toEqual({ kind: 'unreadable' });
      });

      it('a row that hides royalties the datum pays is not read (the bait: a cheaper-looking listing)', () => {
        expect(listingBuyState({ ...withRoyalties, royalties: [] }, TESTNET, own())).toEqual({ kind: 'unreadable' });
      });

      it('a listing with no royalty in its datum and none on its row is buyable', () => {
        expect(listingBuyState(listingRow(), TESTNET, own())).toEqual({ kind: 'buyable' });
      });

      it('a datum with more than MAX_ROYALTIES royalties is not offered, though its row agrees: the worker refuses it', () => {
        const payee = (i: number) => ({ address: preprodAddress(`d${i}`.repeat(28), 'd9'.repeat(28)), lovelace: '100000' });
        const many = Array.from({ length: MAX_ROYALTIES + 1 }, (_, i) => payee(i));
        expect(listingBuyState(listingRow({ royalties: many }), TESTNET, own())).toEqual({ kind: 'unreadable' });
        const atLimit = Array.from({ length: MAX_ROYALTIES }, (_, i) => payee(i));
        expect(listingBuyState(listingRow({ royalties: atLimit }), TESTNET, own())).toEqual({ kind: 'buyable' });
      });
    });
  });

  describe('a datum that is not exactly a Gero listing is not bought', () => {
    for (const [what, datumCbor] of [
      ['not CBOR', 'zz'],
      ['an integer', '182a'],
      ['an empty constructor', 'd87980'],
      ['bytes after the datum', `${listingRow().datumCbor}00`],
    ] as const) {
      it(what, () => {
        expect(listingBuyState(listingRow({ datumCbor }), TESTNET, own())).toEqual({ kind: 'unreadable' });
      });
    }

    it('a row with no datum at all', () => {
      expect(listingBuyState({ ...listingRow(), datumCbor: undefined as never }, TESTNET, own())).toEqual({ kind: 'unreadable' });
    });

    it('even when the row says it is the account\'s own: nothing is marked as its own on a row that cannot be read', () => {
      expect(listingBuyState({ ...listingRow({ datumCbor: '182a' }), ownerPkh: MY_PAYMENT, sellerAddress: MY_ADDRESS }, TESTNET, own())).toEqual({ kind: 'unreadable' });
    });
  });
});
