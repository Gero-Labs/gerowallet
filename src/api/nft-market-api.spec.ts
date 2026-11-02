// The Gero NFT market talks to Nexus through gero-backend's proxy (VITE_NEXUS_URL ->
// <backend>/api/nexus). These specs run the REAL axios instances (and so the real error
// interceptor of nexus-tx-api) against a fake adapter, so they pin the URL, the `?network=`
// slug, the body, what a Nexus 4xx looks like to the caller, and that a response which does
// not read back whole is refused rather than half used.
import { AxiosError, type AxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapter = vi.hoisted(() => vi.fn());
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const create = actual.default.create.bind(actual.default);
  actual.default.create = ((config?: AxiosRequestConfig) => create({ ...config, adapter })) as typeof actual.default.create;
  return actual;
});

import { Network } from '@/models/types';
import {
  LISTINGS_MAX_LIMIT,
  nftMarketApi,
  type ListingDto,
  type RoyaltyInfo,
} from './nft-market-api';
import { NftMarketResponseError } from './nftMarketValidation';
import {
  nexusErrorCode,
  nexusTxApi,
  type NftMarketBuyBuildRequest,
  type NftMarketCancelBuildRequest,
  type NftMarketListBuildRequest,
  type NftMarketMigrateBuildRequest,
  type NftMarketRepriceBuildRequest,
} from './nexus-tx-api';

const TX = 'fb150415126b92a47b46b3a8214d138bdbaab124615afaf8f4d612dd3c16c165';
const OWNER = '1864a6eb4242da06750913784d9afb549dc3022d01bbd316530f390c';
const SCRIPT = '558802cc2e2f21e4e13662cdf73f979ce0140e7dbd7ce13911a9063d';
const POLICY = '22d843e9e8b39d105c645944cc848abee2673d64e60f1f022791ec85';
const ASSET_NAME = '457175696e6550696f6e656572536b696e3034363031';
const UNIT = POLICY + ASSET_NAME;
const SELLER = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';
const ROYALTY_ADDRESS = 'addr_test1vqeux7xwusdju9dvsj8h7mca9aup2k439kfmwy773xxc2hcu7zy99';
const BUYER = 'addr_test1qqbuyer';
const CHANGE = 'addr_test1qqchange';
const DATUM = 'd8799f581c1864a6eb4242da06750913784d9afb549dc3022d01bbd316530f390cff';

const LISTING: ListingDto = {
  txHash: TX,
  outputIndex: 3,
  version: 1,
  scriptHash: SCRIPT,
  unit: UNIT,
  policyId: POLICY,
  assetName: ASSET_NAME,
  priceLovelace: '100000000',
  feeLovelace: '1500000',
  royalties: [{ address: ROYALTY_ADDRESS, lovelace: '5000000' }],
  depositLovelace: '1800000',
  sellerAddress: SELLER,
  ownerPkh: OWNER,
  listedSlot: 71_234_567,
  datumCbor: DATUM,
};

const ROYALTIES: RoyaltyInfo = {
  source: 'cip102',
  rate: 0.05,
  recipients: [
    { address: ROYALTY_ADDRESS, rate: 0.03 },
    { address: SELLER, rate: 0.02 },
  ],
};

const answer = (data: unknown) =>
  adapter.mockImplementationOnce(async (config: AxiosRequestConfig) => ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }));

const refuse = (status: number, data: unknown) =>
  adapter.mockImplementationOnce(async (config: AxiosRequestConfig) => {
    throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config as never, null, {
      data,
      status,
      statusText: 'Unprocessable Entity',
      headers: {},
      config: config as never,
    });
  });

const sentTo = (call = 0) => {
  const config = adapter.mock.calls[call][0] as AxiosRequestConfig;
  return {
    method: config.method,
    url: config.url,
    params: config.params,
    body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
  };
};

beforeEach(() => {
  adapter.mockReset();
});

describe('nftMarketApi.listings: requests', () => {
  it("gets the policy's listings from the market route with the Nexus slug and every option", async () => {
    answer({ items: [LISTING], nextCursor: 'c2' });
    const page = await nftMarketApi.listings(POLICY, { sort: 'price', cursor: 'c1', limit: 25 }, Network.PREPROD);
    expect(page).toEqual({ items: [LISTING], nextCursor: 'c2' });
    expect(adapter).toHaveBeenCalledTimes(1);
    const sent = sentTo();
    expect(sent.method).toBe('get');
    expect(sent.url).toBe('/api/nft-market/listings');
    expect(sent.params).toEqual({ policy: POLICY, sort: 'price', cursor: 'c1', limit: 25, network: 'cardano-preprod' });
  });

  it('sends only the policy and the network when no option is given', async () => {
    answer({ items: [], nextCursor: null });
    await nftMarketApi.listings(POLICY, {}, Network.MAINNET);
    const { params } = sentTo();
    expect(params).toEqual({ policy: POLICY, network: 'cardano-mainnet' });
    expect(Object.values(params).every((v) => v !== undefined)).toBe(true);
  });

  it.each([1, LISTINGS_MAX_LIMIT])('accepts limit %i', async (limit) => {
    answer({ items: [], nextCursor: null });
    await nftMarketApi.listings(POLICY, { limit }, Network.PREPROD);
    expect(sentTo().params.limit).toBe(limit);
  });

  it('accepts the recent sort', async () => {
    answer({ items: [], nextCursor: null });
    await nftMarketApi.listings(POLICY, { sort: 'recent' }, Network.PREPROD);
    expect(sentTo().params.sort).toBe('recent');
  });

  it('reads a missing nextCursor as the last page', async () => {
    answer({ items: [LISTING] });
    expect((await nftMarketApi.listings(POLICY, {}, Network.PREPROD)).nextCursor).toBeNull();
  });

  it('refuses a network Nexus has no slug for, without a request', async () => {
    await expect(nftMarketApi.listings(POLICY, {}, 'Nowhere')).rejects.toThrow(/not supported/i);
    await expect(nftMarketApi.listings(POLICY, {}, undefined as unknown as string)).rejects.toThrow(/not supported/i);
    expect(adapter).not.toHaveBeenCalled();
  });

  it.each([
    ['a short policy', POLICY.slice(2)],
    ['an upper-case policy', POLICY.toUpperCase()],
    ['a non-hex policy', 'z'.repeat(56)],
    ['an empty policy', ''],
  ])('refuses %s without a request', async (_, policy) => {
    await expect(nftMarketApi.listings(policy, {}, Network.PREPROD)).rejects.toThrow(/policy/i);
    expect(adapter).not.toHaveBeenCalled();
  });

  it.each([
    ['limit 0', { limit: 0 }],
    ['limit 101', { limit: LISTINGS_MAX_LIMIT + 1 }],
    ['a fractional limit', { limit: 1.5 }],
    ['a negative limit', { limit: -1 }],
    ['an unknown sort', { sort: 'cheapest' as 'price' }],
    ['an empty cursor', { cursor: '' }],
  ])('refuses %s without a request', async (_, options) => {
    await expect(nftMarketApi.listings(POLICY, options, Network.PREPROD)).rejects.toThrow();
    expect(adapter).not.toHaveBeenCalled();
  });

  it('passes a Nexus 422 errorCode through for the caller', async () => {
    refuse(422, { errorCode: 'NETWORK_UNSUPPORTED', message: 'Network not supported' });
    const failure = await nftMarketApi.listings(POLICY, {}, Network.PREPROD).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(nexusErrorCode(failure)).toBe('NETWORK_UNSUPPORTED');
  });
});

describe('nftMarketApi.listings: responses', () => {
  const fetchPage = async (data: unknown) => {
    answer(data);
    return nftMarketApi.listings(POLICY, {}, Network.PREPROD);
  };

  it('copies only the contract fields of a listing', async () => {
    const page = await fetchPage({
      items: [{ ...LISTING, injected: 'x', royalties: [{ address: ROYALTY_ADDRESS, lovelace: '5000000', extra: 1 }] }],
      nextCursor: null,
      extra: true,
    });
    expect(page).toEqual({ items: [LISTING], nextCursor: null });
  });

  it('keeps a listing with no royalties', async () => {
    const bare = { ...LISTING, royalties: [] };
    expect((await fetchPage({ items: [bare], nextCursor: null })).items).toEqual([bare]);
  });

  it('keeps an NFT with an empty asset name', async () => {
    const bare = { ...LISTING, assetName: '', unit: POLICY };
    expect((await fetchPage({ items: [bare], nextCursor: null })).items).toEqual([bare]);
  });

  it.each([
    ['a body that is not an object', 'nope'],
    ['a null body', null],
    ['an array body', []],
    ['items that are not a list', { items: { 0: LISTING }, nextCursor: null }],
    ['no items', { nextCursor: null }],
    ['a numeric nextCursor', { items: [], nextCursor: 7 }],
    ['an empty nextCursor', { items: [], nextCursor: '' }],
  ])('rejects %s', async (_, data) => {
    await expect(fetchPage(data)).rejects.toBeInstanceOf(NftMarketResponseError);
  });

  it.each([
    ['a short txHash', { txHash: TX.slice(2) }],
    ['an upper-case txHash', { txHash: TX.toUpperCase() }],
    ['no txHash', { txHash: undefined }],
    ['a negative output index', { outputIndex: -1 }],
    ['a fractional output index', { outputIndex: 1.5 }],
    ['a string output index', { outputIndex: '3' }],
    ['a negative version', { version: -1 }],
    ['a fractional version', { version: 1.5 }],
    ['a string version', { version: '1' }],
    ['a short script hash', { scriptHash: SCRIPT.slice(2) }],
    ['an upper-case script hash', { scriptHash: SCRIPT.toUpperCase() }],
    ['a unit that is not hex', { unit: 'lovelace' }],
    ['a unit that is not the policy and asset name', { unit: POLICY + '00' }],
    ['a short policy id', { policyId: POLICY.slice(2), unit: POLICY.slice(2) + ASSET_NAME }],
    ['an asset name of odd length', { assetName: ASSET_NAME + '0', unit: UNIT + '0' }],
    ['an asset name that is not hex', { assetName: 'zz', unit: POLICY + 'zz' }],
    ['an asset name over 32 bytes', { assetName: '00'.repeat(33), unit: POLICY + '00'.repeat(33) }],
    ['a decimal price', { priceLovelace: '1.5' }],
    ['a numeric price', { priceLovelace: 100000000 }],
    ['a negative price', { priceLovelace: '-1' }],
    ['an empty price', { priceLovelace: '' }],
    ['a non-decimal fee', { feeLovelace: '1e6' }],
    ['a numeric fee', { feeLovelace: 1500000 }],
    ['a non-decimal deposit', { depositLovelace: '0x10' }],
    ['a numeric deposit', { depositLovelace: 1800000 }],
    ['royalties that are not a list', { royalties: { address: ROYALTY_ADDRESS, lovelace: '1' } }],
    ['a royalty that is not an object', { royalties: [null] }],
    ['a royalty with a non-decimal amount', { royalties: [{ address: ROYALTY_ADDRESS, lovelace: '5.0' }] }],
    ['a royalty with a numeric amount', { royalties: [{ address: ROYALTY_ADDRESS, lovelace: 5 }] }],
    ['a royalty with no address', { royalties: [{ lovelace: '5000000' }] }],
    ['a royalty with an empty address', { royalties: [{ address: '', lovelace: '5000000' }] }],
    ['an empty seller address', { sellerAddress: '' }],
    ['a numeric seller address', { sellerAddress: 7 }],
    ['a short owner key hash', { ownerPkh: OWNER.slice(2) }],
    ['an upper-case owner key hash', { ownerPkh: OWNER.toUpperCase() }],
    ['a negative slot', { listedSlot: -1 }],
    ['a fractional slot', { listedSlot: 1.5 }],
    ['a string slot', { listedSlot: '71234567' }],
    ['a datum of odd length', { datumCbor: 'abc' }],
    ['a datum that is not hex', { datumCbor: 'zz' }],
    ['an upper-case datum', { datumCbor: DATUM.toUpperCase() }],
    ['an empty datum', { datumCbor: '' }],
    ['no datum', { datumCbor: undefined }],
    ['a listing of another policy', { policyId: 'ab'.repeat(28), unit: 'ab'.repeat(28) + ASSET_NAME }],
  ])('rejects a listing with %s', async (_, patch) => {
    await expect(fetchPage({ items: [{ ...LISTING, ...patch }], nextCursor: null })).rejects.toBeInstanceOf(
      NftMarketResponseError,
    );
  });

  it.each([null, 'x', 7, []])('rejects an entry that is not an object (%j)', async (entry) => {
    await expect(fetchPage({ items: [entry], nextCursor: null })).rejects.toBeInstanceOf(NftMarketResponseError);
  });

  it('returns nothing, not the good listings, when one in the page is malformed', async () => {
    const failure = await fetchPage({
      items: [LISTING, { ...LISTING, priceLovelace: 'free' }, { ...LISTING, outputIndex: 4 }],
      nextCursor: null,
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(NftMarketResponseError);
    expect((failure as NftMarketResponseError).field).toBe('items[1].priceLovelace');
  });
});

describe('nftMarketApi.listing', () => {
  const REF = { txHash: TX, outputIndex: 3 };

  it('gets one listing by its out-ref with the Nexus slug', async () => {
    answer(LISTING);
    expect(await nftMarketApi.listing(REF, Network.PREPROD)).toEqual(LISTING);
    const sent = sentTo();
    expect(sent.method).toBe('get');
    expect(sent.url).toBe(`/api/nft-market/listing/${TX}/3`);
    expect(sent.params).toEqual({ network: 'cardano-preprod' });
  });

  it('refuses a network Nexus has no slug for, without a request', async () => {
    await expect(nftMarketApi.listing(REF, 'Nowhere')).rejects.toThrow(/not supported/i);
    expect(adapter).not.toHaveBeenCalled();
  });

  it.each([
    ['a short hash', { txHash: TX.slice(2), outputIndex: 0 }],
    ['an upper-case hash', { txHash: TX.toUpperCase(), outputIndex: 0 }],
    ['a negative index', { txHash: TX, outputIndex: -1 }],
    ['a fractional index', { txHash: TX, outputIndex: 1.5 }],
    ['a string index', { txHash: TX, outputIndex: '0' as unknown as number }],
  ])('refuses %s without a request', async (_, ref) => {
    await expect(nftMarketApi.listing(ref, Network.PREPROD)).rejects.toThrow(/listing/i);
    expect(adapter).not.toHaveBeenCalled();
  });

  it('passes a Nexus 404 errorCode through for the caller (LISTING_NOT_FOUND)', async () => {
    refuse(404, { errorCode: 'LISTING_NOT_FOUND', message: 'Listing not found' });
    const failure = await nftMarketApi.listing(REF, Network.PREPROD).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(nexusErrorCode(failure)).toBe('LISTING_NOT_FOUND');
  });

  it('rejects a body that is not a listing', async () => {
    answer({ items: [LISTING] });
    await expect(nftMarketApi.listing(REF, Network.PREPROD)).rejects.toBeInstanceOf(NftMarketResponseError);
  });

  it('rejects a malformed listing', async () => {
    answer({ ...LISTING, datumCbor: 'xyz' });
    await expect(nftMarketApi.listing(REF, Network.PREPROD)).rejects.toBeInstanceOf(NftMarketResponseError);
  });

  it.each([
    ['another transaction', { txHash: 'ab'.repeat(32) }],
    ['another output of the transaction', { outputIndex: 4 }],
  ])('rejects the listing of %s than the one asked for', async (_, patch) => {
    answer({ ...LISTING, ...patch });
    await expect(nftMarketApi.listing(REF, Network.PREPROD)).rejects.toBeInstanceOf(NftMarketResponseError);
  });
});

describe('nftMarketApi.royalties', () => {
  it("gets the policy's royalties with the Nexus slug", async () => {
    answer(ROYALTIES);
    expect(await nftMarketApi.royalties(POLICY, Network.PREPROD)).toEqual(ROYALTIES);
    const sent = sentTo();
    expect(sent.method).toBe('get');
    expect(sent.url).toBe(`/api/nft-market/royalties/${POLICY}`);
    expect(sent.params).toEqual({ network: 'cardano-preprod' });
  });

  it('reads "none" as no royalties', async () => {
    const none: RoyaltyInfo = { source: 'none', rate: 0, recipients: [] };
    answer(none);
    expect(await nftMarketApi.royalties(POLICY, Network.PREPROD)).toEqual(none);
  });

  it.each([0, 1])('accepts a rate of %i', async (rate) => {
    answer({ source: 'cip27', rate, recipients: [{ address: ROYALTY_ADDRESS, rate }] });
    expect((await nftMarketApi.royalties(POLICY, Network.PREPROD)).rate).toBe(rate);
  });

  it('copies only the contract fields', async () => {
    answer({ ...ROYALTIES, injected: 1, recipients: [{ ...ROYALTIES.recipients[0], extra: 1 }, ROYALTIES.recipients[1]] });
    expect(await nftMarketApi.royalties(POLICY, Network.PREPROD)).toEqual(ROYALTIES);
  });

  it('refuses a network Nexus has no slug for, without a request', async () => {
    await expect(nftMarketApi.royalties(POLICY, 'Nowhere')).rejects.toThrow(/not supported/i);
    expect(adapter).not.toHaveBeenCalled();
  });

  it.each([
    ['a short policy', POLICY.slice(2)],
    ['an upper-case policy', POLICY.toUpperCase()],
  ])('refuses %s without a request', async (_, policy) => {
    await expect(nftMarketApi.royalties(policy, Network.PREPROD)).rejects.toThrow(/policy/i);
    expect(adapter).not.toHaveBeenCalled();
  });

  it('passes a Nexus 422 errorCode through for the caller', async () => {
    refuse(422, { errorCode: 'NETWORK_UNSUPPORTED', message: 'Network not supported' });
    const failure = await nftMarketApi.royalties(POLICY, Network.PREPROD).catch((e: unknown) => e);
    expect(nexusErrorCode(failure)).toBe('NETWORK_UNSUPPORTED');
  });

  it.each([
    ['a body that is not an object', 'nope'],
    ['an unknown source', { ...ROYALTIES, source: 'cip99' }],
    ['no source', { ...ROYALTIES, source: undefined }],
    ['a negative rate', { ...ROYALTIES, rate: -0.01 }],
    ['a rate above 1', { ...ROYALTIES, rate: 1.01 }],
    ['a NaN rate', { ...ROYALTIES, rate: Number.NaN }],
    ['an infinite rate', { ...ROYALTIES, rate: Number.POSITIVE_INFINITY }],
    ['a string rate', { ...ROYALTIES, rate: '0.05' }],
    ['recipients that are not a list', { ...ROYALTIES, recipients: {} }],
    ['a recipient that is not an object', { ...ROYALTIES, recipients: [null] }],
    ['a recipient with a negative rate', { ...ROYALTIES, recipients: [{ address: SELLER, rate: -0.1 }] }],
    ['a recipient with a rate above 1', { ...ROYALTIES, recipients: [{ address: SELLER, rate: 2 }] }],
    ['a recipient with a NaN rate', { ...ROYALTIES, recipients: [{ address: SELLER, rate: Number.NaN }] }],
    ['a recipient with a string rate', { ...ROYALTIES, recipients: [{ address: SELLER, rate: '0.1' }] }],
    ['a recipient with no address', { ...ROYALTIES, recipients: [{ rate: 0.1 }] }],
    ['a recipient with an empty address', { ...ROYALTIES, recipients: [{ address: '', rate: 0.1 }] }],
  ])('rejects %s', async (_, data) => {
    answer(data);
    await expect(nftMarketApi.royalties(POLICY, Network.PREPROD)).rejects.toBeInstanceOf(NftMarketResponseError);
  });
});

// ── Builders ──

const FEE_INPUT = {
  txHash: 'ab'.repeat(32),
  outputIndex: 0,
  address: CHANGE,
  lovelace: '20000000',
};
const LISTING_REF = { txHash: TX, outputIndex: 3 };
const ROYALTY_PAYEES = [{ address: ROYALTY_ADDRESS, lovelace: '5000000' }];

const BUILT = {
  tx_cbor: '84a300d90102818258',
  tx_hash: 'cd'.repeat(32),
  estimated_fee: '230000',
  requiredSigners: [OWNER],
};

const LIST: NftMarketListBuildRequest = {
  unit: UNIT,
  priceLovelace: '100000000',
  ownerPkh: OWNER,
  sellerAddress: SELLER,
  stakeCredential: 'ee'.repeat(28),
  buyerPkh: null,
  royalties: ROYALTY_PAYEES,
  feeInputs: [FEE_INPUT],
  changeAddress: CHANGE,
};
const CANCEL: NftMarketCancelBuildRequest = {
  listingRef: LISTING_REF,
  returnAddress: SELLER,
  feeInputs: [FEE_INPUT],
  changeAddress: CHANGE,
  allowSponsoredCollateral: true,
};
const REPRICE: NftMarketRepriceBuildRequest = {
  listingRef: LISTING_REF,
  priceLovelace: '90000000',
  feeInputs: [FEE_INPUT],
  changeAddress: CHANGE,
  allowSponsoredCollateral: false,
};
const BUY: NftMarketBuyBuildRequest = {
  listingRef: LISTING_REF,
  buyerAddress: BUYER,
  feeInputs: [FEE_INPUT],
  changeAddress: CHANGE,
  allowSponsoredCollateral: true,
};
const MIGRATE: NftMarketMigrateBuildRequest = {
  legacyRef: { txHash: 'ef'.repeat(32), outputIndex: 1 },
  priceLovelace: '100000000',
  ownerPkh: OWNER,
  sellerAddress: SELLER,
  stakeCredential: 'ee'.repeat(28),
  royalties: ROYALTY_PAYEES,
  feeInputs: [FEE_INPUT],
  changeAddress: CHANGE,
  allowSponsoredCollateral: true,
};

describe.each([
  ['buildNftMarketList', 'list', LIST],
  ['buildNftMarketCancel', 'cancel', CANCEL],
  ['buildNftMarketReprice', 'reprice', REPRICE],
  ['buildNftMarketBuy', 'buy', BUY],
  ['buildNftMarketMigrate', 'migrate', MIGRATE],
] as const)('nexusTxApi.%s', (method, route, request) => {
  const build = (network: string) =>
    (nexusTxApi[method] as (r: typeof request, n: string) => Promise<unknown>)(request, network);

  it('posts to the market route with the Nexus slug in the query and the body', async () => {
    answer(BUILT);
    expect(await build(Network.PREPROD)).toEqual(BUILT);
    expect(adapter).toHaveBeenCalledTimes(1);
    const sent = sentTo();
    expect(sent.method).toBe('post');
    expect(sent.url).toBe(`/api/tx/build/nft-market/${route}?network=cardano-preprod`);
    expect(sent.body).toEqual({ ...request, network: 'cardano-preprod' });
  });

  it('uses the mainnet slug on mainnet', async () => {
    answer(BUILT);
    await build(Network.MAINNET);
    expect(sentTo().url).toBe(`/api/tx/build/nft-market/${route}?network=cardano-mainnet`);
    expect(sentTo().body.network).toBe('cardano-mainnet');
  });

  it('refuses a network Nexus has no slug for, without a request', async () => {
    await expect(build('Nowhere')).rejects.toThrow(/not supported/i);
    expect(adapter).not.toHaveBeenCalled();
  });

  it('passes a Nexus 422 errorCode through for the caller (LISTING_NOT_FOUND)', async () => {
    refuse(422, { errorCode: 'LISTING_NOT_FOUND', message: 'Listing already spent' });
    const failure = await build(Network.PREPROD).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Listing already spent');
    expect(nexusErrorCode(failure)).toBe('LISTING_NOT_FOUND');
  });

  it('rejects a response that does not read back whole', async () => {
    answer({ ...BUILT, tx_hash: 'cd' });
    await expect(build(Network.PREPROD)).rejects.toBeInstanceOf(NftMarketResponseError);
  });
});

describe('nexusTxApi.buildNftMarket*: responses', () => {
  const buildOne = async (data: unknown) => {
    answer(data);
    return nexusTxApi.buildNftMarketBuy(BUY, Network.PREPROD);
  };

  it('keeps the optional fields Nexus sends', async () => {
    const full = {
      ...BUILT,
      sponsoredCollateralRef: `${TX}#0`,
      listingOutputIndex: 2,
      minUtxoTopUpLovelace: '150000',
    };
    expect(await buildOne(full)).toEqual(full);
  });

  it('reads a null optional field as absent', async () => {
    const built = await buildOne({ ...BUILT, sponsoredCollateralRef: null, listingOutputIndex: null, minUtxoTopUpLovelace: null });
    expect(built).toEqual(BUILT);
    expect(built).not.toHaveProperty('sponsoredCollateralRef');
    expect(built).not.toHaveProperty('listingOutputIndex');
    expect(built).not.toHaveProperty('minUtxoTopUpLovelace');
  });

  it('accepts an empty list of required signers and an upper-case transaction body', async () => {
    const built = await buildOne({ ...BUILT, requiredSigners: [], tx_cbor: 'ABCDEF01' });
    expect(built.requiredSigners).toEqual([]);
    expect(built.tx_cbor).toBe('ABCDEF01');
  });

  it('copies only the contract fields', async () => {
    expect(await buildOne({ ...BUILT, injected: 'x' })).toEqual(BUILT);
  });

  it.each([
    ['a body that is not an object', 'nope'],
    ['a null body', null],
    ['no transaction body', { ...BUILT, tx_cbor: undefined }],
    ['an empty transaction body', { ...BUILT, tx_cbor: '' }],
    ['a transaction body of odd length', { ...BUILT, tx_cbor: 'abc' }],
    ['a transaction body that is not hex', { ...BUILT, tx_cbor: 'zz' }],
    ['a short transaction hash', { ...BUILT, tx_hash: 'cd'.repeat(31) }],
    ['an upper-case transaction hash', { ...BUILT, tx_hash: 'CD'.repeat(32) }],
    ['no transaction hash', { ...BUILT, tx_hash: undefined }],
    ['a decimal fee', { ...BUILT, estimated_fee: '0.23' }],
    ['a numeric fee', { ...BUILT, estimated_fee: 230000 }],
    ['no fee', { ...BUILT, estimated_fee: undefined }],
    ['required signers that are not a list', { ...BUILT, requiredSigners: OWNER }],
    ['no required signers', { ...BUILT, requiredSigners: undefined }],
    ['a short required signer', { ...BUILT, requiredSigners: [OWNER.slice(2)] }],
    ['an upper-case required signer', { ...BUILT, requiredSigners: [OWNER.toUpperCase()] }],
    ['a collateral ref with no index', { ...BUILT, sponsoredCollateralRef: TX }],
    ['a collateral ref with a short hash', { ...BUILT, sponsoredCollateralRef: `${TX.slice(2)}#0` }],
    ['a collateral ref with a non-numeric index', { ...BUILT, sponsoredCollateralRef: `${TX}#x` }],
    ['a numeric collateral ref', { ...BUILT, sponsoredCollateralRef: 7 }],
    ['a negative listing output index', { ...BUILT, listingOutputIndex: -1 }],
    ['a fractional listing output index', { ...BUILT, listingOutputIndex: 0.5 }],
    ['a string listing output index', { ...BUILT, listingOutputIndex: '1' }],
    ['a decimal top-up', { ...BUILT, minUtxoTopUpLovelace: '1.5' }],
    ['a numeric top-up', { ...BUILT, minUtxoTopUpLovelace: 150000 }],
  ])('rejects %s', async (_, data) => {
    await expect(buildOne(data)).rejects.toBeInstanceOf(NftMarketResponseError);
  });

  it('names the route and field it refused', async () => {
    const failure = await buildOne({ ...BUILT, estimated_fee: 'x' }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(NftMarketResponseError);
    expect((failure as NftMarketResponseError).route).toBe('/api/tx/build/nft-market/buy');
    expect((failure as NftMarketResponseError).field).toBe('estimated_fee');
  });
});
