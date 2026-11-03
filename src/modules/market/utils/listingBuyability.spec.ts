// What the wallet may do with a listing in a collection's list. The browse page offers Buy only
// where the worker would build one: never the wallet's own listing (it is cancelled, not bought),
// never a private listing (R2: the buy builder and the worker refuse every listing with a `buyer`
// in this phase, this account's own keys included), never a listing whose datum does not read as
// a Gero listing. The datum is read here the way the worker reads
// it, from the row's own bytes, because the row's other fields are Nexus's word.
import { describe, expect, it } from 'vitest';
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

  describe('the wallet\'s own listings are never offered', () => {
    it('by the wallet\'s own listing refs (useMyListings)', () => {
      const row = listingRow({ index: 4 });
      expect(listingBuyState(row, TESTNET, own([{ ref: refOf(row) } as OwnListing]))).toEqual({ kind: 'own' });
    });

    it('by an owner that is one of the account\'s payment or change keys', () => {
      expect(listingBuyState(listingRow({ owner: MY_PAYMENT }), TESTNET, own())).toEqual({ kind: 'own' });
      expect(listingBuyState(listingRow({ owner: MY_CHANGE }), TESTNET, own())).toEqual({ kind: 'own' });
    });

    it('by an owner that is the account\'s stake key, as the worker counts it', () => {
      expect(listingBuyState(listingRow({ owner: MY_STAKE }), TESTNET, own())).toEqual({ kind: 'own' });
    });

    it('by a seller address that is one of the account\'s addresses', () => {
      const row = { ...listingRow(), sellerAddress: MY_CHANGE_ADDRESS };
      expect(listingBuyState(row, TESTNET, own())).toEqual({ kind: 'own' });
    });

    it('by the DATUM when the row says otherwise: the row is Nexus\'s word', () => {
      const row = { ...listingRow({ owner: MY_PAYMENT }), ownerPkh: STRANGER_KEY, sellerAddress: preprodAddress(STRANGER_KEY, STRANGER_STAKE) };
      expect(listingBuyState(row, TESTNET, own())).toEqual({ kind: 'own' });
    });

    it('whatever the datum is: an unreadable datum under an own ref is still the wallet\'s own', () => {
      const row = listingRow({ datumCbor: '00' });
      expect(listingBuyState(row, TESTNET, own([{ ref: refOf(row) } as OwnListing]))).toEqual({ kind: 'own' });
    });
  });

  describe('a private listing (buyer set) is never offered, whoever the buyer is', () => {
    it('a key that is not the account\'s', () => {
      expect(listingBuyState(listingRow({ buyer: STRANGER_KEY }), TESTNET, own())).toEqual({ kind: 'private' });
    });

    it('one of the account\'s own payment, change or stake keys: the worker refuses every private listing in this phase', () => {
      for (const buyer of [MY_PAYMENT, MY_CHANGE, MY_STAKE]) {
        expect(listingBuyState(listingRow({ buyer }), TESTNET, own()), buyer).toEqual({ kind: 'private' });
      }
    });

    it('but a private listing of the account\'s own is the account\'s own first', () => {
      expect(listingBuyState(listingRow({ owner: MY_PAYMENT, buyer: STRANGER_KEY }), TESTNET, own())).toEqual({ kind: 'own' });
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
  });
});
