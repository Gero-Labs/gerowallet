// Which `listed` candidates are the wallet's own listings, and how the store's copy of them is
// read back. The decision is pure: a UTxO, the deployments, and what identifies the wallet.
//
// The datum is Nexus's two-royalty round-trip fixture (as pinned in listingDatum.spec.ts, built
// independently of both codecs): owner 0102..1c, seller address
// addr_test1qqqsyqcy...l3d7 (payment key 0102..1c, stake key 2122..3c), two royalties, no buyer.
import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import {
  listedLovelace,
  ownListingIdentity,
  reviveOwnListings,
  singleNftUnit,
  verifyOwnListing,
  type OwnListing,
  type OwnListingContext,
} from './ownListings';
import { NFT_MARKET_DEPLOYMENTS_PREPROD, type NftMarketDeployment } from '@/utils/nftMarketDeployments';
import type { Keys } from '@/models/types';

const V1: NftMarketDeployment = NFT_MARKET_DEPLOYMENTS_PREPROD[0];

/** What the store's broadcast and its IndexedDB write do to a bigint (walletStore's serializeValue). */
const wireReplacer = (_key: string, value: unknown) => (typeof value === 'bigint' ? value.toString() : value);

const FIXTURE_TWO_ROYALTIES =
  'd8799f581c0102030405060708090a0b0c0d0e0f101112131415161718191a1b1cd8799fd8799f581c0102030405060708090a0b0c0d0e0f101112131415161718191a1b1cffd8799fd8799fd8799f581c2122232425262728292a2b2c2d2e2f303132333435363738393a3b3cffffffff1a05f5e1009fd8799fd8799fd8799f581c4142434445464748494a4b4c4d4e4f505152535455565758595a5b5cffd87a80ff1a004c4b40ffd8799fd8799fd87a9f581c6162636465666768696a6b6c6d6e6f707172737475767778797a7b7cffd8799fd8799fd8799f581c2122232425262728292a2b2c2d2e2f303132333435363738393a3b3cffffffff1a001e8480ffffd87a80ff';

const OWNER = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c';
const STAKE = '2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c';
const SELLER = 'addr_test1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8ppyg3jgffxyu5zj23t9skjutesxyerxdp4xcmnswf68v7qz5l3d7';
const NFT = `${'b'.repeat(56)}${Buffer.from('NFT').toString('hex')}`;
const TX = '7'.repeat(64);

const own = { paymentKeyHashes: new Set([OWNER]), addresses: new Set([SELLER]) };
const ctx: OwnListingContext = { networkId: 0, deployments: [V1], own };

function addressAt(scriptHash: string): Cardano.PaymentAddress {
  return Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Testnet,
    { hash: Hash28ByteBase16(scriptHash), type: Cardano.CredentialType.ScriptHash },
    { hash: Hash28ByteBase16(STAKE), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32() as Cardano.PaymentAddress;
}

function candidate(
  over: { address?: string; datum?: unknown; assets?: [string, bigint][] | null; coins?: bigint } = {},
): Cardano.Utxo {
  const address = (over.address ?? addressAt(V1.scriptHash)) as Cardano.PaymentAddress;
  const assets = over.assets === null ? undefined : new Map((over.assets ?? [[NFT, 1n]]).map(([u, q]) => [Cardano.AssetId(u), q]));
  return [
    { txId: Cardano.TransactionId(TX), index: 3, address },
    {
      address,
      value: { coins: over.coins ?? 2_000_000n, assets },
      datum: ('datum' in over ? over.datum : { cbor: FIXTURE_TWO_ROYALTIES }) as Cardano.PlutusData,
    },
  ] as Cardano.Utxo;
}

describe('verifyOwnListing', () => {
  it('accepts a listing whose datum names the wallet as owner and seller', () => {
    expect(verifyOwnListing(candidate(), ctx)).toEqual({
      listing: {
        ref: `${TX}#3`,
        unit: NFT,
        datum: expect.objectContaining({ owner: OWNER, sellerAddress: SELLER, price: 100_000_000n, buyer: null }),
        depositLovelace: '2000000',
        deploymentVersion: 1,
      },
    });
  });

  it('keeps the royalties in datum order', () => {
    const verdict = verifyOwnListing(candidate(), ctx);
    expect('listing' in verdict && verdict.listing.datum.royalties.map((r) => r.lovelace)).toEqual([5_000_000n, 2_000_000n]);
  });

  it('refuses a datum whose owner is not one of the wallet\'s payment keys', () => {
    const stranger = { ...own, paymentKeyHashes: new Set(['ff'.repeat(28)]) };
    expect(verifyOwnListing(candidate(), { ...ctx, own: stranger })).toEqual({ rejected: 'OWNER' });
  });

  it('refuses a datum whose seller address is not one of the wallet\'s addresses', () => {
    const stranger = { ...own, addresses: new Set(['addr_test1vpq5ys6yg4rywjzfff95cn2wfag9z5jn2324v46ct9d9khqnf0e2x']) };
    expect(verifyOwnListing(candidate(), { ...ctx, own: stranger })).toEqual({ rejected: 'SELLER' });
  });

  it('checks the owner before the seller, and needs both', () => {
    const nobody = { paymentKeyHashes: new Set<string>(), addresses: new Set<string>() };
    expect(verifyOwnListing(candidate(), { ...ctx, own: nobody })).toEqual({ rejected: 'OWNER' });
  });

  it('matches the seller address in full, not by its payment part', () => {
    // Same payment key, a different stake part: another address, a fake.
    const sameKeyOtherStake = Cardano.BaseAddress.fromCredentials(
      Cardano.NetworkId.Testnet,
      { hash: Hash28ByteBase16(OWNER), type: Cardano.CredentialType.KeyHash },
      { hash: Hash28ByteBase16('ee'.repeat(28)), type: Cardano.CredentialType.KeyHash },
    ).toAddress().toBech32();
    const lookalike = { ...own, addresses: new Set([sameKeyOtherStake]) };
    expect(verifyOwnListing(candidate(), { ...ctx, own: lookalike })).toEqual({ rejected: 'SELLER' });
  });

  it('compares key hashes without regard to case', () => {
    const upper = { ...own, paymentKeyHashes: new Set([OWNER.toUpperCase()]) };
    // The set is built lower-case by ownListingIdentity; a raw upper-case set does not match,
    // and that is why the identity is always built through it.
    expect(verifyOwnListing(candidate(), { ...ctx, own: upper })).toEqual({ rejected: 'OWNER' });
    const built = ownListingIdentity({ payment: [{ cred: OWNER.toUpperCase(), path: '', address: SELLER }] } as unknown as Keys);
    expect('listing' in verifyOwnListing(candidate(), { ...ctx, own: built })).toBe(true);
  });

  it('refuses an address that is not a script payment base address', () => {
    const enterprise = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, {
      hash: Hash28ByteBase16(OWNER),
      type: Cardano.CredentialType.KeyHash,
    }).toAddress().toBech32();
    expect(verifyOwnListing(candidate({ address: enterprise }), ctx)).toEqual({ rejected: 'ADDRESS' });
    expect(verifyOwnListing(candidate({ address: 'not-an-address' }), ctx)).toEqual({ rejected: 'ADDRESS' });
  });

  it('refuses a script that is not a configured deployment', () => {
    expect(verifyOwnListing(candidate({ address: addressAt('9'.repeat(56)) }), ctx)).toEqual({ rejected: 'DEPLOYMENT' });
    expect(verifyOwnListing(candidate(), { ...ctx, deployments: [] })).toEqual({ rejected: 'DEPLOYMENT' });
  });

  it('reads the deployment version from the script the UTxO sits at', () => {
    const v2: NftMarketDeployment = { ...V1, version: 2, scriptHash: '9'.repeat(56) };
    const verdict = verifyOwnListing(candidate({ address: addressAt(v2.scriptHash) }), { ...ctx, deployments: [v2, V1] });
    expect('listing' in verdict && verdict.listing.deploymentVersion).toBe(2);
  });

  it.each([
    ['no datum', undefined],
    ['an empty datum', ''],
    ['a datum hash', 'ab'.repeat(32).slice(0, 8)],
  ])('refuses %s as NO_DATUM or NOT_A_LISTING, never a listing', (_name, datum) => {
    const verdict = verifyOwnListing(candidate({ datum }), ctx);
    expect('rejected' in verdict).toBe(true);
  });

  it('refuses a missing inline datum as NO_DATUM', () => {
    expect(verifyOwnListing(candidate({ datum: undefined }), ctx)).toEqual({ rejected: 'NO_DATUM' });
  });

  it('refuses a datum that is not exactly a Listing as NOT_A_LISTING', () => {
    expect(verifyOwnListing(candidate({ datum: { cbor: 'd87980' } }), ctx)).toEqual({ rejected: 'NOT_A_LISTING' });
    // Trailing bytes after a valid datum.
    expect(verifyOwnListing(candidate({ datum: { cbor: `${FIXTURE_TWO_ROYALTIES}00` } }), ctx)).toEqual({ rejected: 'NOT_A_LISTING' });
  });

  it('refuses the datum of the wrong network', () => {
    // The same bytes rendered for mainnet name a different seller address string.
    expect(verifyOwnListing(candidate(), { ...ctx, networkId: 1 })).toEqual({ rejected: 'SELLER' });
  });

  it.each([
    ['no assets', null],
    ['an empty asset map', []],
    ['two NFTs', [[NFT, 1n], [`${'c'.repeat(56)}01`, 1n]]],
    ['a quantity of 2', [[NFT, 2n]]],
    ['a quantity of 0', [[NFT, 0n]]],
  ] as [string, [string, bigint][] | null][])('refuses %s as VALUE', (_name, assets) => {
    expect(verifyOwnListing(candidate({ assets }), ctx)).toEqual({ rejected: 'VALUE' });
  });
});

describe('ownListingIdentity', () => {
  const key = (cred: string, address?: string) => ({ cred, path: '', address });

  it('takes payment and change keys and addresses, never the stake key', () => {
    const identity = ownListingIdentity({
      payment: [key('aa'.repeat(28), 'addr_test1payment')],
      change: [key('bb'.repeat(28), 'addr_test1change')],
      stake: [key('cc'.repeat(28), 'stake_test1reward')],
    } as unknown as Keys);

    expect([...identity.paymentKeyHashes].sort()).toEqual(['aa'.repeat(28), 'bb'.repeat(28)]);
    expect([...identity.addresses].sort()).toEqual(['addr_test1change', 'addr_test1payment']);
  });

  it('adds the locally derived payment keys', () => {
    const identity = ownListingIdentity(null, ['dd'.repeat(28), 'EE'.repeat(28)]);

    expect([...identity.paymentKeyHashes].sort()).toEqual(['dd'.repeat(28), 'ee'.repeat(28)]);
    expect(identity.addresses.size).toBe(0);
  });

  it('ignores a malformed hash and a missing key set', () => {
    expect(ownListingIdentity(undefined).paymentKeyHashes.size).toBe(0);
    const identity = ownListingIdentity({ payment: [key('xyz', 'addr_test1a'), key('aa'.repeat(27))] } as unknown as Keys, ['short']);
    expect(identity.paymentKeyHashes.size).toBe(0);
    expect([...identity.addresses]).toEqual(['addr_test1a']);
  });
});

describe('listedLovelace and reviveOwnListings', () => {
  const listing = (ref: string, deposit: string): OwnListing => ({
    ref,
    unit: NFT,
    depositLovelace: deposit,
    deploymentVersion: 1,
    datum: {
      owner: OWNER,
      sellerAddress: SELLER,
      price: 100_000_000n,
      royalties: [{ address: SELLER, lovelace: 5_000_000n }],
      buyer: null,
    },
  });

  it('sums the deposits', () => {
    expect(listedLovelace([])).toBe(0n);
    expect(listedLovelace([listing('a#0', '2000000'), listing('b#1', '1500000')])).toBe(3_500_000n);
  });

  it('gets the bigints back after the store\'s JSON round trip', () => {
    const listings = [listing('a#0', '2000000'), { ...listing('b#1', '1500000'), datum: { ...listing('b#1', '1').datum, buyer: OWNER } }];
    const wire = JSON.parse(JSON.stringify(listings, wireReplacer));
    // On the wire the bigints are strings…
    expect(wire[0].datum.price).toBe('100000000');

    // …and come back as bigints, field for field.
    expect(reviveOwnListings(wire)).toEqual(listings);
  });

  it('skips a malformed entry instead of throwing', () => {
    const good = JSON.parse(JSON.stringify([listing('a#0', '2000000')], wireReplacer));
    expect(reviveOwnListings([null, 5, { ref: 'x' }, ...good])).toEqual([listing('a#0', '2000000')]);
    expect(reviveOwnListings(undefined)).toEqual([]);
    expect(reviveOwnListings({})).toEqual([]);
  });
});

// The one-NFT question verifyOwnListing asks of a listing UTxO, shared with the dApp approval
// preview, which asks it of a listing a transaction creates.
describe('singleNftUnit', () => {
  const value = (assets?: Array<[string, bigint]>): Cardano.Value =>
    ({ coins: 2_000_000n, assets: assets ? new Map(assets.map(([unit, quantity]) => [Cardano.AssetId(unit), quantity])) : undefined });

  it('is the unit of exactly one asset held once', () => {
    expect(singleNftUnit(value([[NFT, 1n]]))).toBe(NFT);
  });

  it('is null for no asset, the NFT twice, or a second asset', () => {
    expect(singleNftUnit(value())).toBeNull();
    expect(singleNftUnit(value([]))).toBeNull();
    expect(singleNftUnit(value([[NFT, 2n]]))).toBeNull();
    expect(singleNftUnit(value([[NFT, 1n], [`${'c'.repeat(56)}${Buffer.from('X').toString('hex')}`, 1n]]))).toBeNull();
  });
});
