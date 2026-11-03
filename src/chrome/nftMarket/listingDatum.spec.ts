// The Gero listing datum codec, the output tag and the fee arithmetic the worker holds every
// market transaction to. The decoder is what decides which UTxOs at the contract are Gero
// listings the wallet may call its own, and what a buy must pay: it is strict, and anything
// that is not exactly a `Listing` is refused.
//
// Provenance of the pinned values:
//  - `__fixtures__/tags.json` is a byte copy of gero-market-contracts `test-vectors/tags.json`
//    (main 26fff54).
//  - FIXTURE_TWO_ROYALTIES and FIXTURE_PRIVATE are Nexus's `GeroListingCodec` round-trip
//    fixtures (Nexus Task 1, 4bb371327). They were built independently of both codecs, and the
//    expected addresses were rendered by cardano-client-lib.
import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import tagVectors from './__fixtures__/tags.json';
import {
  ListingDatumError,
  decodeListingDatum,
  listingFee,
  listingSplit,
  listingTag,
  listingTagPreimage,
  sellerDue,
  sellerShare,
  type ListingDatum,
} from './listingDatum';
import { NFT_MARKET_DEPLOYMENTS_PREPROD, type NftMarketDeployment } from '@/utils/nftMarketDeployments';

const ADA = 1_000_000n;
const V1: NftMarketDeployment = NFT_MARKET_DEPLOYMENTS_PREPROD[0];

// ---------------------------------------------------------------------------------------------
// Pinned datums
// ---------------------------------------------------------------------------------------------

/** Two royalties (an enterprise key payee, a script payee with a stake key), buyer None. */
const FIXTURE_TWO_ROYALTIES =
  'd8799f581c0102030405060708090a0b0c0d0e0f101112131415161718191a1b1cd8799fd8799f581c0102030405060708090a0b0c0d0e0f101112131415161718191a1b1cffd8799fd8799fd8799f581c2122232425262728292a2b2c2d2e2f303132333435363738393a3b3cffffffff1a05f5e1009fd8799fd8799fd8799f581c4142434445464748494a4b4c4d4e4f505152535455565758595a5b5cffd87a80ff1a004c4b40ffd8799fd8799fd87a9f581c6162636465666768696a6b6c6d6e6f707172737475767778797a7b7cffd8799fd8799fd8799f581c2122232425262728292a2b2c2d2e2f303132333435363738393a3b3cffffffff1a001e8480ffffd87a80ff';

/** Private listing: a stake SCRIPT credential, one script/script royalty, buyer Some(a1..bc). */
const FIXTURE_PRIVATE =
  'd8799f581c0102030405060708090a0b0c0d0e0f101112131415161718191a1b1cd8799fd8799f581c0102030405060708090a0b0c0d0e0f101112131415161718191a1b1cffd8799fd8799fd87a9f581c8182838485868788898a8b8c8d8e8f909192939495969798999a9b9cffffffff1a0ee6b2809fd8799fd8799fd87a9f581c6162636465666768696a6b6c6d6e6f707172737475767778797a7b7cffd8799fd8799fd87a9f581c8182838485868788898a8b8c8d8e8f909192939495969798999a9b9cffffffff1a000f4240ffffd8799f581ca1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcffff';

const OWNER = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c';
const STAKE_KEY = '2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c';
const ENTERPRISE_KEY = '4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c';
const PAYEE_SCRIPT = '6162636465666768696a6b6c6d6e6f707172737475767778797a7b7c';
const STAKE_SCRIPT = '8182838485868788898a8b8c8d8e8f909192939495969798999a9b9c';
const BUYER = 'a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbc';

describe('decodeListingDatum: pinned datums', () => {
  it('decodes the two-royalty fixture field by field (preprod)', () => {
    expect(decodeListingDatum(FIXTURE_TWO_ROYALTIES, 0)).toEqual<ListingDatum>({
      owner: OWNER,
      sellerAddress:
        'addr_test1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8ppyg3jgffxyu5zj23t9skjutesxyerxdp4xcmnswf68v7qz5l3d7',
      price: 100_000_000n,
      royalties: [
        { address: 'addr_test1vpq5ys6yg4rywjzfff95cn2wfag9z5jn2324v46ct9d9khqnf0e2x', lovelace: 5_000_000n },
        {
          address:
            'addr_test1zpskycmyv4nxw6rfdf4kcmtwdac8zunnw36hvamc09a8klppyg3jgffxyu5zj23t9skjutesxyerxdp4xcmnswf68v7qzwsnr8',
          lovelace: 2_000_000n,
        },
      ],
      buyer: null,
    });
  });

  it('renders the same datum for mainnet (network id 1)', () => {
    const l = decodeListingDatum(FIXTURE_TWO_ROYALTIES, 1);
    expect(l.sellerAddress).toBe(
      'addr1qyqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8ppyg3jgffxyu5zj23t9skjutesxyerxdp4xcmnswf68v7qpzz3pp',
    );
    expect(l.royalties.every((r) => r.address.startsWith('addr1'))).toBe(true);
    expect(l.owner).toBe(OWNER);
    expect(l.price).toBe(100_000_000n);
  });

  it('decodes the private fixture: stake script, script royalty, a buyer (preprod)', () => {
    expect(decodeListingDatum(FIXTURE_PRIVATE, 0)).toEqual<ListingDatum>({
      owner: OWNER,
      sellerAddress:
        'addr_test1yqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8yps2pcfpvxs7ygnz5t3jxcarusjxff89y4j6te3xv6nwwq85ewz6',
      price: 250_000_000n,
      royalties: [
        {
          address:
            'addr_test1xpskycmyv4nxw6rfdf4kcmtwdac8zunnw36hvamc09a8klyps2pcfpvxs7ygnz5t3jxcarusjxff89y4j6te3xv6nwwq8wkvvr',
          lovelace: 1_000_000n,
        },
      ],
      buyer: BUYER,
    });
  });

  it('renders addresses with the credential kinds the datum names', () => {
    const l = decodeListingDatum(FIXTURE_TWO_ROYALTIES, 0);
    const seller = Cardano.Address.fromBech32(l.sellerAddress).asBase()!;
    expect(seller.getPaymentCredential()).toEqual({ type: Cardano.CredentialType.KeyHash, hash: OWNER });
    expect(seller.getStakeCredential()).toEqual({ type: Cardano.CredentialType.KeyHash, hash: STAKE_KEY });
    expect(Cardano.Address.fromBech32(l.royalties[0].address).asEnterprise()!.getPaymentCredential()).toEqual({
      type: Cardano.CredentialType.KeyHash,
      hash: ENTERPRISE_KEY,
    });
    const scriptPayee = Cardano.Address.fromBech32(l.royalties[1].address).asBase()!;
    expect(scriptPayee.getPaymentCredential()).toEqual({ type: Cardano.CredentialType.ScriptHash, hash: PAYEE_SCRIPT });
    expect(scriptPayee.getStakeCredential()).toEqual({ type: Cardano.CredentialType.KeyHash, hash: STAKE_KEY });

    const priv = Cardano.Address.fromBech32(decodeListingDatum(FIXTURE_PRIVATE, 0).sellerAddress).asBase()!;
    expect(priv.getStakeCredential()).toEqual({ type: Cardano.CredentialType.ScriptHash, hash: STAKE_SCRIPT });
  });

  it('accepts upper-case hex input', () => {
    expect(decodeListingDatum(FIXTURE_TWO_ROYALTIES.toUpperCase(), 0)).toEqual(
      decodeListingDatum(FIXTURE_TWO_ROYALTIES, 0),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// A small independent CBOR builder, to make datums that differ from the fixtures in one place.
// `buildListing()` with no overrides must reproduce FIXTURE_TWO_ROYALTIES byte for byte.
// ---------------------------------------------------------------------------------------------

const head = (major: number, n: number | bigint): string => {
  const v = BigInt(n);
  const m = major << 5;
  const h = (x: number, bytes: number) => x.toString(16).padStart(bytes * 2, '0');
  if (v < 24n) return h(m | Number(v), 1);
  if (v < 0x100n) return h(m | 24, 1) + h(Number(v), 1);
  if (v < 0x10000n) return h(m | 25, 1) + h(Number(v), 2);
  if (v < 0x100000000n) return h(m | 26, 1) + h(Number(v), 4);
  return h(m | 27, 1) + v.toString(16).padStart(16, '0');
};
const bytes = (hex: string): string => head(2, hex.length / 2) + hex;
const int = (n: bigint | number): string => head(0, n);
const list = (items: string[], indefinite = true): string =>
  indefinite ? (items.length === 0 ? '80' : `9f${items.join('')}ff`) : head(4, items.length) + items.join('');
const constr = (index: number, fields: string[], indefinite = true): string => {
  const tag = index < 7 ? `d8${(121 + index).toString(16)}` : `d905${(index - 7).toString(16).padStart(2, '0')}`;
  return tag + list(fields, indefinite);
};

const key = (hash = OWNER, indefinite = true) => constr(0, [bytes(hash)], indefinite);
const script = (hash = PAYEE_SCRIPT, indefinite = true) => constr(1, [bytes(hash)], indefinite);
const some = (x: string, indefinite = true) => constr(0, [x], indefinite);
const none = (indefinite = true) => constr(1, [], indefinite);
const inline = (cred: string, indefinite = true) => constr(0, [cred], indefinite);
const address = (payment: string, stake: string, indefinite = true) => constr(0, [payment, stake], indefinite);
const payee = (addr: string, lovelace: bigint, indefinite = true) => constr(0, [addr, int(lovelace)], indefinite);

interface Parts {
  owner: string;
  seller: string;
  price: string;
  royalties: string;
  buyer: string;
}

function validParts(indefinite = true): Parts {
  const i = indefinite;
  return {
    owner: bytes(OWNER),
    seller: address(key(OWNER, i), some(inline(key(STAKE_KEY, i), i), i), i),
    price: int(100_000_000n),
    royalties: list(
      [
        payee(address(key(ENTERPRISE_KEY, i), none(i), i), 5_000_000n, i),
        payee(address(script(PAYEE_SCRIPT, i), some(inline(key(STAKE_KEY, i), i), i), i), 2_000_000n, i),
      ],
      i,
    ),
    buyer: none(i),
  };
}

function buildListing(over: Partial<Parts> = {}, extraField?: string, indefinite = true): string {
  const p = { ...validParts(indefinite), ...over };
  const fields = [p.owner, p.seller, p.price, p.royalties, p.buyer];
  if (extraField !== undefined) fields.push(extraField);
  return constr(0, fields, indefinite);
}

describe('the test CBOR builder', () => {
  it('reproduces the independently built fixture byte for byte', () => {
    expect(buildListing()).toBe(FIXTURE_TWO_ROYALTIES);
  });

  it('makes the private fixture from its parts', () => {
    expect(
      buildListing({
        seller: address(key(OWNER), some(inline(script(STAKE_SCRIPT)))),
        price: int(250_000_000n),
        royalties: list([payee(address(script(PAYEE_SCRIPT), some(inline(script(STAKE_SCRIPT)))), 1_000_000n)]),
        buyer: some(bytes(BUYER)),
      }),
    ).toBe(FIXTURE_PRIVATE);
  });
});

describe('decodeListingDatum: list encodings', () => {
  const expected = decodeListingDatum(FIXTURE_TWO_ROYALTIES, 0);

  it('accepts definite-length arrays at every level, the same datum', () => {
    const definite = buildListing({}, undefined, false);
    expect(definite).not.toContain('9f');
    expect(definite).not.toBe(FIXTURE_TWO_ROYALTIES);
    expect(decodeListingDatum(definite, 0)).toEqual(expected);
  });

  it('accepts a mix of definite and indefinite arrays', () => {
    const mixed = constr(
      0,
      [
        bytes(OWNER),
        address(key(OWNER, false), some(inline(key(STAKE_KEY, true), false), true), true),
        int(100_000_000n),
        list(
          [
            payee(address(key(ENTERPRISE_KEY), none(false), false), 5_000_000n, true),
            payee(address(script(PAYEE_SCRIPT, false), some(inline(key(STAKE_KEY)), false), true), 2_000_000n, false),
          ],
          false,
        ),
        none(false),
      ],
      false,
    );
    expect(decodeListingDatum(mixed, 0)).toEqual(expected);
  });

  it('accepts an empty royalty list (80) and no royalties', () => {
    const l = decodeListingDatum(buildListing({ royalties: list([]) }), 0);
    expect(l.royalties).toEqual([]);
    expect(l.price).toBe(100_000_000n);
  });

  it('accepts a price beyond 64 bits and keeps it exact', () => {
    const huge = 1n << 70n;
    expect(decodeListingDatum(buildListing({ price: `c2${bytes(huge.toString(16).padStart(20, '0'))}` }), 0).price).toBe(
      huge,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Strictness: anything that is not exactly a Listing is refused
// ---------------------------------------------------------------------------------------------

describe('decodeListingDatum: refusals', () => {
  const refuses = (cbor: unknown, match?: RegExp | string, networkId = 0) => {
    let thrown: unknown;
    try {
      decodeListingDatum(cbor as string, networkId);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ListingDatumError);
    expect((thrown as Error).name).toBe('ListingDatumError');
    if (match) expect((thrown as Error).message).toMatch(match);
  };

  describe('the Listing constructor', () => {
    it('refuses another constructor index', () => {
      const p = validParts();
      refuses(constr(1, [p.owner, p.seller, p.price, p.royalties, p.buyer]));
      refuses(constr(2, [p.owner, p.seller, p.price, p.royalties, p.buyer]));
    });

    it('refuses a sixth field', () => {
      refuses(buildListing({}, int(1)), /6 fields, expected 5/);
    });

    it('refuses a missing buyer field and a bare owner', () => {
      const p = validParts();
      refuses(constr(0, [p.owner, p.seller, p.price, p.royalties]), /4 fields, expected 5/);
      refuses(constr(0, [p.owner]), /1 fields, expected 5/);
      refuses(constr(0, []), /0 fields, expected 5/);
    });

    it('refuses a datum that is not a constructor at all', () => {
      refuses(int(42));
      refuses(bytes(OWNER));
      refuses(list([bytes(OWNER)]));
      refuses('a0'); // an empty map
      refuses('a1' + int(1) + int(2)); // a map
    });

    it('refuses the right fields in the wrong order', () => {
      const p = validParts();
      refuses(constr(0, [p.seller, p.owner, p.price, p.royalties, p.buyer]));
      refuses(constr(0, [p.owner, p.seller, p.royalties, p.price, p.buyer]));
      refuses(constr(0, [p.owner, p.seller, p.price, p.buyer, p.royalties]));
    });
  });

  describe('owner', () => {
    it('refuses a 27 or 29 byte owner', () => {
      refuses(buildListing({ owner: bytes(OWNER.slice(2)) }), /owner/);
      refuses(buildListing({ owner: bytes(OWNER + '00') }), /owner/);
    });

    it('refuses an owner that is not a byte string', () => {
      refuses(buildListing({ owner: int(1) }), /owner/);
      refuses(buildListing({ owner: key() }), /owner/);
    });
  });

  describe('addresses', () => {
    it('refuses an Address with another constructor, or a wrong field count', () => {
      refuses(buildListing({ seller: constr(1, [key(), none()]) }), /address/);
      refuses(buildListing({ seller: constr(0, [key()]) }), /address/);
      refuses(buildListing({ seller: constr(0, [key(), none(), none()]) }), /address/);
    });

    it('refuses a credential that is neither VerificationKey nor Script', () => {
      refuses(buildListing({ seller: address(constr(2, [bytes(OWNER)]), none()) }), /credential/);
      refuses(buildListing({ seller: address(constr(7, [bytes(OWNER)]), none()) }), /credential/);
      refuses(buildListing({ seller: address(bytes(OWNER), none()) }), /credential/);
    });

    it('refuses a credential with no hash or an extra field', () => {
      refuses(buildListing({ seller: address(constr(0, []), none()) }), /credential/);
      refuses(buildListing({ seller: address(constr(0, [bytes(OWNER), int(0)]), none()) }), /credential/);
      refuses(buildListing({ seller: address(constr(1, [bytes(OWNER), int(0)]), none()) }), /credential/);
    });

    it('refuses a credential hash of 27 or 29 bytes, or not bytes', () => {
      refuses(buildListing({ seller: address(key(OWNER.slice(2)), none()) }), /credential/);
      refuses(buildListing({ seller: address(key(OWNER + '00'), none()) }), /credential/);
      refuses(buildListing({ seller: address(constr(0, [int(5)]), none()) }), /credential/);
    });

    it('refuses a pointer stake address, naming it', () => {
      // Some(Pointer { slot, tx, cert }): the Referenced type's second constructor.
      const pointer = some(constr(1, [int(1), int(2), int(3)]));
      refuses(buildListing({ seller: address(key(), pointer) }), /pointer/i);
      // ... in a royalty payee too
      refuses(
        buildListing({ royalties: list([payee(address(key(ENTERPRISE_KEY), pointer), 5_000_000n)]) }),
        /pointer/i,
      );
      // ... whatever fields the second constructor carries
      refuses(buildListing({ seller: address(key(), some(constr(1, []))) }), /pointer/i);
    });

    it('refuses a malformed Option stake', () => {
      refuses(buildListing({ seller: address(key(), constr(2, [])) }), /stake/);
      refuses(buildListing({ seller: address(key(), constr(1, [inline(key())])) }), /stake/); // None with a field
      refuses(buildListing({ seller: address(key(), constr(0, [])) }), /stake/); // Some with none
      refuses(buildListing({ seller: address(key(), constr(0, [inline(key()), int(1)])) }), /stake/); // Some with two
      refuses(buildListing({ seller: address(key(), int(0)) }), /stake/);
      refuses(buildListing({ seller: address(key(), bytes(STAKE_KEY)) }), /stake/);
    });

    it('refuses a stake credential that is not wrapped in Inline, or wrapped wrongly', () => {
      refuses(buildListing({ seller: address(key(), some(key(STAKE_KEY))) }), /stake|credential/); // credential, no Inline
      refuses(buildListing({ seller: address(key(), some(constr(0, [key(STAKE_KEY), int(1)]))) }), /stake|inline/i);
      refuses(buildListing({ seller: address(key(), some(constr(0, []))) }), /stake|inline/i);
      refuses(buildListing({ seller: address(key(), some(constr(2, [key(STAKE_KEY)]))) }), /stake|inline/i);
      refuses(buildListing({ seller: address(key(), some(inline(key(STAKE_KEY.slice(2))))) }), /credential/);
    });
  });

  describe('price', () => {
    it('refuses a price that is not an integer', () => {
      refuses(buildListing({ price: bytes('00') }), /price/);
      refuses(buildListing({ price: list([int(1)]) }), /price/);
      refuses(buildListing({ price: constr(0, [int(1)]) }), /price/);
      refuses(buildListing({ price: none() }), /price/);
    });
  });

  describe('royalties', () => {
    it('refuses royalties that are not a list', () => {
      refuses(buildListing({ royalties: bytes('00') }), /royalt/);
      refuses(buildListing({ royalties: int(0) }), /royalt/);
      refuses(buildListing({ royalties: constr(0, []) }), /royalt/);
      refuses(buildListing({ royalties: 'a0' }), /royalt/);
    });

    it('refuses a Payee with another constructor or field count', () => {
      const addr = address(key(ENTERPRISE_KEY), none());
      refuses(buildListing({ royalties: list([constr(1, [addr, int(1)])]) }), /payee/i);
      refuses(buildListing({ royalties: list([constr(0, [addr])]) }), /payee/i);
      refuses(buildListing({ royalties: list([constr(0, [addr, int(1), int(2)])]) }), /payee/i);
      refuses(buildListing({ royalties: list([int(1)]) }), /payee/i);
    });

    it('refuses a Payee whose lovelace is not an integer', () => {
      const addr = address(key(ENTERPRISE_KEY), none());
      refuses(buildListing({ royalties: list([constr(0, [addr, bytes('01')])]) }), /lovelace/);
      refuses(buildListing({ royalties: list([constr(0, [addr, list([int(1)])])]) }), /lovelace/);
    });

    it('refuses one bad Payee among good ones', () => {
      const good = payee(address(key(ENTERPRISE_KEY), none()), 5_000_000n);
      refuses(buildListing({ royalties: list([good, constr(0, [int(1), int(1)]), good]) }));
    });
  });

  describe('buyer', () => {
    it('refuses a Some buyer of 27 or 29 bytes, or not bytes', () => {
      refuses(buildListing({ buyer: some(bytes(BUYER.slice(2))) }), /buyer/);
      refuses(buildListing({ buyer: some(bytes(BUYER + '00')) }), /buyer/);
      refuses(buildListing({ buyer: some(int(7)) }), /buyer/);
    });

    it('refuses a malformed Option buyer', () => {
      refuses(buildListing({ buyer: constr(2, []) }), /buyer/);
      refuses(buildListing({ buyer: constr(1, [bytes(BUYER)]) }), /buyer/); // None with a field
      refuses(buildListing({ buyer: constr(0, []) }), /buyer/); // Some with none
      refuses(buildListing({ buyer: constr(0, [bytes(BUYER), bytes(BUYER)]) }), /buyer/);
      refuses(buildListing({ buyer: int(7) }), /buyer/);
      refuses(buildListing({ buyer: bytes(BUYER) }), /buyer/);
    });
  });

  describe('the bytes themselves', () => {
    it('refuses anything after the single top-level item', () => {
      refuses(FIXTURE_TWO_ROYALTIES + '00', /trailing/);
      refuses(FIXTURE_TWO_ROYALTIES + 'd87a80', /trailing/); // a second valid datum
      refuses(FIXTURE_TWO_ROYALTIES + 'ff', /trailing/);
      refuses(FIXTURE_TWO_ROYALTIES + FIXTURE_TWO_ROYALTIES, /trailing/);
      refuses(FIXTURE_PRIVATE + '00', /trailing/);
      refuses(buildListing({}, undefined, false) + '00', /trailing/); // definite arrays too
    });

    it('refuses a truncated datum', () => {
      refuses(FIXTURE_TWO_ROYALTIES.slice(0, -2));
      refuses(FIXTURE_TWO_ROYALTIES.slice(0, 40));
    });

    it('refuses empty, odd-length and non-hex input, and non-strings', () => {
      refuses('');
      refuses('d87a8');
      refuses('zz');
      refuses('0x' + FIXTURE_TWO_ROYALTIES);
      refuses(` ${FIXTURE_TWO_ROYALTIES}`);
      refuses(null);
      refuses(undefined);
      refuses(42);
      refuses({});
    });

    it('turns a datum nested 20,000 levels deep into a ListingDatumError, fast, not a stack overflow', () => {
      const started = Date.now();
      refuses('81'.repeat(20_000) + '00', /nested/);
      refuses('9f'.repeat(20_000) + 'ff'.repeat(20_000), /nested/);
      refuses('d8799f'.repeat(20_000) + 'ff'.repeat(20_000), /nested/);
      expect(Date.now() - started).toBeLessThan(2_000);
    });
  });

  describe('CBOR tags', () => {
    // Only 121-127, 1280-1400 and 102 are Plutus constructor tags (and 2 and 3 the bignums).
    const items = (p: Parts) => [p.owner, p.seller, p.price, p.royalties, p.buyer];
    const body = items(validParts()).join('');

    it('refuses a foreign tag where the constructor should be, whatever follows', () => {
      refuses('d8ff00', /tag 255/); // an unassigned tag over an integer
      refuses(`d86482${int(1)}${int(2)}`, /tag 100/); // 100 over an array
      refuses(`d8789f${body}ff`, /tag 120/); // one below the constructor range
      refuses(`d8809f${body}ff`, /tag 128/); // one above it
      refuses(`d904ff9f${body}ff`, /tag 1279/);
      refuses(`d905799f${body}ff`, /tag 1401/);
      refuses(`d9ffff9f${body}ff`, /tag 65535/);
      refuses(`da000186a09f${body}ff`, /tag 100000/);
    });

    it('refuses a foreign tag around the whole datum, and around any part of it', () => {
      refuses(`c1${FIXTURE_TWO_ROYALTIES}`, /tag 1\b/); // epoch time over the Listing
      refuses(`d818${bytes(FIXTURE_TWO_ROYALTIES)}`, /tag 24/); // the inline-datum wrapper itself
      refuses(buildListing({ price: `c1${int(100_000_000n)}` }), /tag 1\b/);
      refuses(buildListing({ owner: `c1${bytes(OWNER)}` }), /tag 1\b/);
      refuses(buildListing({ buyer: `d8ff${none()}` }), /tag 255/);
      refuses(buildListing({ royalties: `c0${list([])}` }), /tag 0\b/);
      refuses(buildListing({ seller: `d87880` }), /tag 120/);
    });

    it('refuses a tag stacked on a tag, and a tag over the wrong kind of item', () => {
      refuses(`d879d87980`, /wrong kind/);
      refuses(`d87901`, /wrong kind/); // a constructor over an integer
      refuses(`d8795820${'00'.repeat(32)}`, /wrong kind/); // ... over bytes
      refuses(buildListing({ price: 'c201' }), /wrong kind/); // a bignum over an integer
      refuses(buildListing({ price: `c2${list([])}` }), /wrong kind/);
    });

    it('refuses a tag head with no argument item after it', () => {
      refuses('d879', /truncated/);
      refuses('c2', /truncated/);
    });

    it('accepts the whole constructor range: 121-127 and 1280-1400 reach the constructor check', () => {
      // These are constructors 6, 7 and 127: not a Listing, so they are refused as the wrong
      // constructor, which is the proof the tag itself was read as a constructor tag.
      refuses(`d87f9f${body}ff`, /constructor 6, expected 0/);
      refuses(`d905009f${body}ff`, /constructor 7, expected 0/);
      refuses(`d905789f${body}ff`, /constructor 127, expected 0/);
    });

    it('accepts the general constructor form (tag 102), which is the same Plutus data', () => {
      const general = `d86682${int(0)}${list(items(validParts()))}`;
      expect(decodeListingDatum(general, 0)).toEqual(decodeListingDatum(FIXTURE_TWO_ROYALTIES, 0));
      const definite = `d86682${int(0)}${list(items(validParts(false)), false)}`;
      expect(decodeListingDatum(definite, 0)).toEqual(decodeListingDatum(FIXTURE_TWO_ROYALTIES, 0));
      // ... and a Listing in that form is still held to the 5 fields
      refuses(`d86682${int(0)}${list([...items(validParts()), int(1)])}`, /6 fields, expected 5/);
      refuses(`d86682${int(1)}${list(items(validParts()))}`, /constructor 1, expected 0/);
    });

    it('accepts the bignum tag 2 over a byte string for the price, exactly', () => {
      expect(decodeListingDatum(buildListing({ price: `c2${bytes('01' + '00'.repeat(9))}` }), 0).price).toBe(1n << 72n);
      expect(decodeListingDatum(buildListing({ price: `c2${bytes('ff')}` }), 0).price).toBe(255n);
    });

    it('refuses the negative bignum tag 3: the SDK reads it one off, and no listing holds one', () => {
      refuses(buildListing({ price: `c3${bytes('01')}` }), /negative bignum/);
      refuses(buildListing({ price: `c3${bytes('01' + '00'.repeat(9))}` }), /negative bignum/);
      refuses(buildListing({ royalties: list([constr(0, [address(key(), none()), `c3${bytes('01')}`])]) }), /negative bignum/);
    });

    it('reads the negative integers of major type 1 exactly (a price that cannot be bought, but a faithful one)', () => {
      expect(decodeListingDatum(buildListing({ price: '20' }), 0).price).toBe(-1n);
      expect(decodeListingDatum(buildListing({ price: '3903e7' }), 0).price).toBe(-1000n);
    });
  });

  describe('declared lengths larger than the input', () => {
    // A head that claims 2 GB must fail on the spot, before anything is read or allocated.
    const LIE = /length|truncated/;

    it.each([
      ['a byte string', '5a7fffffff00'],
      ['an array', '9a7fffffff00'],
      ['a constructor', 'd8799a7fffffff00'],
      ['a constructor, indefinite, holding a byte string', 'd8799f5a7fffffff00ff'],
      ['a map', 'ba7fffffff00'],
      ['an 8 byte byte-string length', '5bffffffffffffffff00'],
      ['an 8 byte array length', '9b00000001000000000000'],
      ['a 4 byte array length of 2^32 - 1', '9affffffff00'],
      ['a chunk of a chunked byte string', '5f5a7fffffff00ff'],
      ['an array of two with one item', '8200'],
      ['an array of one with none', '81'],
      ['a byte string one byte short', '5801'],
      ['an array of 255 in 3 bytes', '98ff0000'],
    ])('refuses %s', (_label, hex) => {
      const started = Date.now();
      refuses(hex, LIE);
      expect(Date.now() - started).toBeLessThan(1_000);
    });

    it('refuses the lie wherever it sits in an otherwise valid datum', () => {
      refuses(buildListing({ owner: `5a7fffffff${'00'.repeat(28)}` }), LIE);
      refuses(buildListing({ royalties: `9a7fffffff${payee(address(key(), none()), 1n)}` }), LIE);
      refuses(buildListing({ seller: `d8799a7fffffff${key()}${none()}` }), LIE);
      refuses(buildListing({ buyer: `d87a9a7fffffff00` }), LIE);
      refuses(buildListing({ price: `c25a7fffffff00` }), LIE);
    });

    it('refuses a datum that only announces more than it holds, even in a few bytes', () => {
      refuses('9f'); // an indefinite array never closed
      refuses('9f00'); // ... with an item
      refuses('5f'); // an indefinite byte string never closed
      refuses('5f4100'); // ... with a chunk
    });
  });

  describe('things Plutus data cannot hold', () => {
    it('refuses text, floats, simple values and a stray break, as the datum or in it', () => {
      refuses('6161', /Plutus data cannot/); // the text "a"
      refuses('f6', /Plutus data cannot/); // null
      refuses('f5', /Plutus data cannot/); // true
      refuses('f94000', /Plutus data cannot/); // a float
      refuses('ff', /Plutus data cannot/); // a break with nothing to close
      refuses(buildListing({ price: '6161' }), /Plutus data cannot/);
      refuses(buildListing({ price: 'f6' }), /Plutus data cannot/);
      refuses(buildListing({ owner: '6161' }), /Plutus data cannot/);
    });

    it('refuses malformed CBOR heads', () => {
      refuses('1c', /malformed/); // additional info 28
      refuses('1d', /malformed/);
      refuses('1e', /malformed/);
      refuses('1f', /malformed/); // an indefinite integer
      refuses('df', /malformed/); // an indefinite tag
      refuses(buildListing({ price: '1f' }), /malformed/);
    });

    it('refuses a chunked byte string with a non-bytes or nested chunk', () => {
      refuses(buildListing({ owner: `5f01ff` }), /chunk/);
      refuses(buildListing({ owner: `5f5f${bytes(OWNER)}ffff` }), /chunk/);
    });

    it('accepts a chunked byte string for a hash: it is the same Plutus data', () => {
      const chunked = `5f${bytes(OWNER.slice(0, 28))}${bytes(OWNER.slice(28))}ff`;
      expect(decodeListingDatum(buildListing({ owner: chunked }), 0)).toEqual(decodeListingDatum(FIXTURE_TWO_ROYALTIES, 0));
    });
  });

  describe('the network id', () => {
    it('refuses a network id that is not 0 (testnets) or 1 (mainnet)', () => {
      for (const id of [2, 15, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        refuses(FIXTURE_TWO_ROYALTIES, /network/, id);
      }
      refuses(FIXTURE_TWO_ROYALTIES, /network/, '0' as unknown as number);
      refuses(FIXTURE_TWO_ROYALTIES, /network/, null as unknown as number);
      expect(() => (decodeListingDatum as (hex: string) => ListingDatum)(FIXTURE_TWO_ROYALTIES)).toThrow(ListingDatumError);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The output tag
// ---------------------------------------------------------------------------------------------

describe('listingTag', () => {
  it.each(tagVectors.map((v) => [v.index, v] as const))(
    'matches the contract test vector for output index %i',
    (_index, v) => {
      expect(listingTagPreimage(v.txId, v.index)).toBe(v.serialised);
      expect(listingTag(v.txId, v.index)).toBe(v.tag);
      // the vector's own bytes hash to its tag, so the check above is not circular
      expect(bytesToHex(blake2b(hexToBytes(v.serialised), { dkLen: 32 }))).toBe(v.tag);
    },
  );

  it('covers the four contract vectors (indices 0, 23, 24 and 256)', () => {
    expect(tagVectors.map((v) => v.index)).toEqual([0, 23, 24, 256]);
  });

  const TX = '6d2a1f9c3b8e4f0a5c7d9e1b2a3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e';
  const preimageTail = (index: number) => listingTagPreimage(TX, index).slice(`d8799f5820${TX}`.length);

  it('uses the shortest CBOR unsigned integer for the index', () => {
    expect(preimageTail(0)).toBe('00ff');
    expect(preimageTail(23)).toBe('17ff');
    expect(preimageTail(24)).toBe('1818ff');
    expect(preimageTail(255)).toBe('18ffff');
    expect(preimageTail(256)).toBe('190100ff');
    expect(preimageTail(65_535)).toBe('19ffffff');
    expect(preimageTail(65_536)).toBe('1a00010000ff');
    expect(preimageTail(0xffffffff)).toBe('1affffffffff');
    expect(preimageTail(0x100000000)).toBe('1b0000000100000000ff');
  });

  it('is an indefinite-length constructor (d8799f ... ff), never a definite array', () => {
    for (const index of [0, 1, 24, 300]) {
      const pre = listingTagPreimage(TX, index);
      expect(pre.startsWith('d8799f5820')).toBe(true);
      expect(pre.endsWith('ff')).toBe(true);
      expect(pre.startsWith('d87982')).toBe(false);
    }
  });

  it('tags differ per output index of one transaction, and per transaction', () => {
    const tags = new Set([0, 1, 2, 23, 24, 255, 256].map((i) => listingTag(TX, i)));
    expect(tags.size).toBe(7);
    expect(listingTag(TX.replace(/^6d/, '6e'), 0)).not.toBe(listingTag(TX, 0));
  });

  it('is 32 bytes of lower-case hex, and ignores the case of the transaction id', () => {
    expect(listingTag(TX, 0)).toMatch(/^[0-9a-f]{64}$/);
    expect(listingTag(TX.toUpperCase(), 24)).toBe(listingTag(TX, 24));
  });

  it('is not the tag a definite-length array or a raw one-byte index would give', () => {
    const hash = (hex: string) => bytesToHex(blake2b(hexToBytes(hex), { dkLen: 32 }));
    // `d87982`: the definite-length constructor a generic PlutusData encoder writes
    expect(listingTag(TX, 0)).not.toBe(hash(`d879825820${TX}00`));
    // the index byte written raw, as if every index fitted one byte
    expect(listingTag(TX, 24)).not.toBe(hash(`d8799f5820${TX}18ff`));
    expect(listingTag(TX, 256)).not.toBe(hash(`d8799f5820${TX}00ff`));
  });

  it('refuses a negative or non-integer index', () => {
    for (const index of [-1, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53]) {
      expect(() => listingTag(TX, index), String(index)).toThrow(ListingDatumError);
      expect(() => listingTagPreimage(TX, index), String(index)).toThrow(ListingDatumError);
    }
    expect(() => listingTag(TX, '1' as unknown as number)).toThrow(ListingDatumError);
    expect(() => listingTag(TX, undefined as unknown as number)).toThrow(ListingDatumError);
  });

  it('refuses a transaction id that is not 64 hex characters', () => {
    for (const bad of ['', TX.slice(2), TX + '00', `0x${TX}`, TX.replace(/^6d/, 'zz'), ` ${TX}`, `${TX}\n`]) {
      expect(() => listingTag(bad, 0), JSON.stringify(bad)).toThrow(ListingDatumError);
    }
    expect(() => listingTag(undefined as unknown as string, 0)).toThrow(ListingDatumError);
    expect(() => listingTag(null as unknown as string, 0)).toThrow(ListingDatumError);
  });
});

// ---------------------------------------------------------------------------------------------
// Fee and the seller's share
// ---------------------------------------------------------------------------------------------

describe('listingFee', () => {
  it('is the v1 deployment, as shipped', () => {
    expect(V1.feeBps).toBe(100);
    expect(V1.minFeeLovelace).toBe(1_500_000n);
    expect(V1.maxFeeLovelace).toBe(5_000_000n);
  });

  // Spec 5.5 and gero-market-contracts docs/rules.md "Fee examples", v1 terms.
  it.each([
    ['10 ADA', 10n * ADA, 1_500_000n],
    ['50 ADA', 50n * ADA, 1_500_000n],
    ['75 ADA', 75n * ADA, 1_500_000n],
    ['100 ADA', 100n * ADA, 1_500_000n],
    ['149.999999 ADA', 149_999_999n, 1_500_000n],
    ['150 ADA (1% is exactly the minimum)', 150n * ADA, 1_500_000n],
    ['150.000099 ADA (1% rounds down to 1,500,000)', 150_000_099n, 1_500_000n],
    ['151 ADA', 151n * ADA, 1_510_000n],
    ['160.000099 ADA (rounds down)', 160_000_099n, 1_600_000n],
    ['499.99 ADA', 499_990_000n, 4_999_900n],
    ['499.999999 ADA (just under the cap)', 499_999_999n, 4_999_999n],
    ['500 ADA (1% is exactly the cap)', 500n * ADA, 5_000_000n],
    ['500.000001 ADA', 500_000_001n, 5_000_000n],
    ['5,000 ADA', 5_000n * ADA, 5_000_000n],
    ['10,000,000 ADA', 10_000_000n * ADA, 5_000_000n],
  ])('v1 fee for %s', (_label, price, fee) => {
    expect(listingFee(price, V1)).toBe(fee);
  });

  it('is the minimum for the smallest prices, including zero', () => {
    expect(listingFee(1n, V1)).toBe(1_500_000n);
    expect(listingFee(0n, V1)).toBe(1_500_000n);
  });

  it('applies the minimum first and the cap last: a cap below the minimum wins', () => {
    const inverted: NftMarketDeployment = { ...V1, minFeeLovelace: 6_000_000n, maxFeeLovelace: 5_000_000n };
    expect(listingFee(10n * ADA, inverted)).toBe(5_000_000n);
    expect(listingFee(1_000n * ADA, inverted)).toBe(5_000_000n);
  });

  it('applies only the minimum when there is no cap', () => {
    const uncapped: NftMarketDeployment = { ...V1, maxFeeLovelace: null };
    expect(listingFee(10n * ADA, uncapped)).toBe(1_500_000n);
    expect(listingFee(5_000n * ADA, uncapped)).toBe(50n * ADA);
    expect(listingFee(10_000_000n * ADA, uncapped)).toBe(100_000n * ADA);
  });

  it('follows the deployment passed in, not v1', () => {
    const other: NftMarketDeployment = { ...V1, feeBps: 250, minFeeLovelace: 2_000_000n, maxFeeLovelace: 20_000_000n };
    expect(listingFee(100n * ADA, other)).toBe(2_500_000n);
    expect(listingFee(10n * ADA, other)).toBe(2_000_000n);
    expect(listingFee(1_000n * ADA, other)).toBe(20_000_000n);
  });

  it('is exact beyond the safe number range (bigint only)', () => {
    const uncapped: NftMarketDeployment = { ...V1, maxFeeLovelace: null };
    const price = 9_007_199_254_740_993_000_000n; // far past 2^53
    expect(listingFee(price, uncapped)).toBe(90_071_992_547_409_930_000n);
    // the floor, not a float
    expect(listingFee(price + 99n, uncapped)).toBe(90_071_992_547_409_930_000n);
  });
});

describe('sellerShare and sellerDue', () => {
  const listing = (price: bigint, royalties: bigint[] = []): ListingDatum => ({
    owner: OWNER,
    sellerAddress: 'addr_test1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8ppyg3jgffxyu5zj23t9skjutesxyerxdp4xcmnswf68v7qz5l3d7',
    price,
    royalties: royalties.map((lovelace, i) => ({ address: `addr_test1royalty${i}`, lovelace })),
    buyer: null,
  });

  it('matches the Nexus pinned fixture: 100 ADA, 1.5 fee, royalties 5 + 2', () => {
    const l = decodeListingDatum(FIXTURE_TWO_ROYALTIES, 0);
    expect(sellerShare(l, V1)).toBe(91_500_000n);
    expect(sellerDue(l, V1, 0n)).toBe(91_500_000n);
    expect(sellerDue(l, V1, 2_000_000n)).toBe(93_500_000n);
  });

  it('matches the table of spec 5.5 (no royalty): share is price - fee', () => {
    expect(sellerShare(listing(10n * ADA), V1)).toBe(8_500_000n);
    expect(sellerShare(listing(50n * ADA), V1)).toBe(48_500_000n);
    expect(sellerShare(listing(75n * ADA), V1)).toBe(73_500_000n);
    expect(sellerShare(listing(100n * ADA), V1)).toBe(98_500_000n);
    expect(sellerShare(listing(500n * ADA), V1)).toBe(495n * ADA);
    expect(sellerShare(listing(5_000n * ADA), V1)).toBe(4_995n * ADA);
  });

  it('matches the contract worked purchase: 100 ADA, 2 ADA royalty, 2 ADA deposit pays the seller 98.5 ADA', () => {
    const l = listing(100n * ADA, [2n * ADA]);
    expect(sellerShare(l, V1)).toBe(96_500_000n);
    expect(sellerDue(l, V1, 2n * ADA)).toBe(98_500_000n);
  });

  it('matches the contract second purchase: 600 ADA, no royalty, 3 ADA deposit is due 598 ADA', () => {
    expect(sellerDue(listing(600n * ADA), V1, 3n * ADA)).toBe(598n * ADA);
  });

  it('is zero or negative when fee and royalties leave nothing (P2: such a listing cannot be bought)', () => {
    expect(sellerShare(listing(3_500_000n, [2n * ADA]), V1)).toBe(0n); // the rules.md example
    expect(sellerShare(listing(3_500_001n, [2n * ADA]), V1)).toBe(1n);
    expect(sellerShare(listing(3n * ADA, [2n * ADA]), V1)).toBe(-500_000n);
  });

  it('subtracts every royalty', () => {
    expect(sellerShare(listing(200n * ADA, [1n * ADA, 2n * ADA, 3n * ADA]), V1)).toBe(192n * ADA);
  });

  it('adds the deposit on top of the share, and nothing else', () => {
    const l = listing(100n * ADA);
    expect(sellerDue(l, V1, 0n)).toBe(sellerShare(l, V1));
    expect(sellerDue(l, V1, 1_234_567n)).toBe(sellerShare(l, V1) + 1_234_567n);
  });

  it('follows the deployment passed in', () => {
    const uncapped: NftMarketDeployment = { ...V1, maxFeeLovelace: null };
    expect(sellerShare(listing(5_000n * ADA), uncapped)).toBe(4_950n * ADA);
  });
});

describe('listingSplit', () => {
  it('splits 100 ADA with a 5 ADA royalty into fee 1.5, royalties 5 and 93.5 for the seller', () => {
    expect(listingSplit(100n * ADA, [{ lovelace: 5n * ADA }], V1)).toEqual({ fee: 1_500_000n, royalties: 5_000_000n, sellerShare: 93_500_000n });
  });

  it('is the arithmetic of sellerShare: the same number for the same price and royalties', () => {
    for (const price of [5n * ADA, 10n * ADA, 150n * ADA, 600n * ADA, 5_000n * ADA]) {
      const royalties = [{ lovelace: 1_250_000n }, { lovelace: 777_777n }];
      const l = { owner: OWNER, sellerAddress: 'addr_test1seller', price, royalties: royalties.map((r) => ({ address: 'a', lovelace: r.lovelace })), buyer: null };
      expect(listingSplit(price, royalties, V1).sellerShare).toBe(sellerShare(l, V1));
      expect(listingSplit(price, royalties, V1).fee).toBe(listingFee(price, V1));
    }
  });

  it('has no royalties to add up for an empty list, and can go negative when nothing is left', () => {
    expect(listingSplit(10n * ADA, [], V1)).toEqual({ fee: 1_500_000n, royalties: 0n, sellerShare: 8_500_000n });
    expect(listingSplit(3n * ADA, [{ lovelace: 2n * ADA }], V1).sellerShare).toBe(-500_000n);
  });
});
