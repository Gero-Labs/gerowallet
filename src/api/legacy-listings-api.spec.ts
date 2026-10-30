// The legacy-listing rescue talks to Nexus through gero-backend's proxy (VITE_NEXUS_URL ->
// <backend>/api/nexus). These specs run the REAL axios instances (and so the real error
// interceptor of nexus-tx-api) against a fake adapter, so they pin the URL, the body and
// what a Nexus 422 looks like to the caller.
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
  LEGACY_CANCEL_MAX,
  LEGACY_CANCEL_MAX_COLLATERAL,
  LEGACY_CANCEL_MAX_FEE,
  LEGACY_RESCUE_HARDWARE_WALLET_TYPES,
  LEGACY_SCRIPTS,
  isLegacyRescueHardware,
} from '@/utils/legacyMarketScripts';
import {
  fetchLegacyListings,
  legacyRef,
  type LegacyListingItem,
} from './legacy-listings-api';
import { nexusErrorCode, nexusTxApi, type LegacyCancelBuildRequest } from './nexus-tx-api';

const TX = 'fb150415126b92a47b46b3a8214d138bdbaab124615afaf8f4d612dd3c16c165';
const OWNER = '1864a6eb4242da06750913784d9afb549dc3022d01bbd316530f390c';
const UNIT = '22d843e9e8b39d105c645944cc848abee2673d64e60f1f022791ec85457175696e6550696f6e656572536b696e3034363031';

const ITEM: LegacyListingItem = {
  txHash: TX,
  outputIndex: 0,
  contract: 'legacy_v3',
  kind: 'listing',
  ownerPkh: OWNER,
  lovelace: '1361960',
  assets: [{ unit: UNIT, quantity: '1' }],
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

/** `count` distinct, well-formed owner key hashes. */
const pkhs = (count: number) => Array.from({ length: count }, (_, i) => i.toString(16).padStart(56, '0'));

beforeEach(() => {
  adapter.mockReset();
});

describe('legacyRef', () => {
  it('joins hash and index', () => {
    expect(legacyRef(ITEM)).toBe(`${TX}#0`);
    expect(legacyRef({ ...ITEM, outputIndex: 12 })).toBe(`${TX}#12`);
  });
});

describe('fetchLegacyListings: requests', () => {
  it('returns [] without a request off mainnet', async () => {
    expect(await fetchLegacyListings([OWNER], 'preprod')).toEqual([]);
    expect(await fetchLegacyListings([OWNER], Network.PREPROD)).toEqual([]);
    expect(await fetchLegacyListings([OWNER], Network.PREVIEW)).toEqual([]);
    expect(await fetchLegacyListings([OWNER], undefined as unknown as string)).toEqual([]);
    expect(adapter).not.toHaveBeenCalled();
  });

  it('returns [] without a request when there are no owners', async () => {
    expect(await fetchLegacyListings([], Network.MAINNET)).toEqual([]);
    expect(adapter).not.toHaveBeenCalled();
  });

  it("posts the owners to Nexus's by-owner route through the backend proxy", async () => {
    answer({ items: [ITEM] });
    const items = await fetchLegacyListings([OWNER], Network.MAINNET);
    expect(items).toEqual([ITEM]);
    expect(adapter).toHaveBeenCalledTimes(1);
    const sent = sentTo();
    expect(sent.method).toBe('post');
    expect(sent.url).toBe('/api/legacy-listings/by-owner');
    expect(sent.params).toEqual({ network: 'cardano-mainnet' });
    expect(sent.body).toEqual({ ownerPkhs: [OWNER] });
  });

  it('sends owners in chunks of 200', async () => {
    answer({ items: [] });
    answer({ items: [] });
    await fetchLegacyListings(pkhs(250), Network.MAINNET);
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(sentTo(0).body.ownerPkhs).toHaveLength(200);
    expect(sentTo(1).body.ownerPkhs).toHaveLength(50);
  });

  it('sends exactly 200 owners in one request', async () => {
    answer({ items: [] });
    await fetchLegacyListings(pkhs(200), Network.MAINNET);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('asks about each owner once', async () => {
    answer({ items: [] });
    await fetchLegacyListings([OWNER, OWNER, pkhs(1)[0]], Network.MAINNET);
    expect(sentTo().body.ownerPkhs).toEqual([OWNER, pkhs(1)[0]]);
  });

  it('collects the items of every chunk, in order', async () => {
    const second = { ...ITEM, txHash: 'a'.repeat(64), contract: 'legacy_v2' as const };
    answer({ items: [ITEM] });
    answer({ items: [second] });
    expect(await fetchLegacyListings(pkhs(201), Network.MAINNET)).toEqual([ITEM, second]);
  });

  it('throws, rather than reporting none stuck, when Nexus fails', async () => {
    refuse(422, { message: 'Network not supported', errorCode: 'NETWORK_UNSUPPORTED' });
    await expect(fetchLegacyListings([OWNER], Network.MAINNET)).rejects.toThrow();
  });

  it('throws on a reply that is not an items list', async () => {
    answer({ nope: true });
    await expect(fetchLegacyListings([OWNER], Network.MAINNET)).rejects.toThrow(/malformed/i);
  });
});

describe('fetchLegacyListings: malformed items', () => {
  const fetchOne = async (item: unknown) => {
    answer({ items: [item] });
    return fetchLegacyListings([OWNER], Network.MAINNET);
  };

  it('keeps a well-formed v2 offer', async () => {
    const offer: LegacyListingItem = { ...ITEM, contract: 'legacy_v2', kind: 'offer', assets: [] };
    expect(await fetchOne(offer)).toEqual([offer]);
  });

  it('drops items with a bad txHash, contract or kind', async () => {
    answer({
      items: [
        ITEM,
        { ...ITEM, txHash: 'FB'.repeat(32) },
        { ...ITEM, txHash: 'ab'.repeat(31) },
        { ...ITEM, txHash: undefined },
        { ...ITEM, contract: 'legacy_v1' },
        { ...ITEM, contract: undefined },
        { ...ITEM, kind: 'sale' },
        { ...ITEM, kind: undefined },
      ],
    });
    expect(await fetchLegacyListings([OWNER], Network.MAINNET)).toEqual([ITEM]);
  });

  it.each([
    ['a negative output index', { outputIndex: -1 }],
    ['a fractional output index', { outputIndex: 1.5 }],
    ['a string output index', { outputIndex: '0' }],
    ['a short owner key hash', { ownerPkh: OWNER.slice(2) }],
    ['an upper-case owner key hash', { ownerPkh: OWNER.toUpperCase() }],
    ['a non-decimal lovelace', { lovelace: '1.5' }],
    ['a numeric lovelace', { lovelace: 1361960 }],
    ['a negative lovelace', { lovelace: '-1' }],
    ['assets that are not a list', { assets: { unit: UNIT, quantity: '1' } }],
    ['an asset with a non-hex unit', { assets: [{ unit: 'lovelace', quantity: '1' }] }],
    ['an asset with an empty unit', { assets: [{ unit: '', quantity: '1' }] }],
    ['an asset with a non-decimal quantity', { assets: [{ unit: UNIT, quantity: '1e3' }] }],
    ['an asset with a numeric quantity', { assets: [{ unit: UNIT, quantity: 1 }] }],
    ['an asset that is not an object', { assets: [null] }],
  ])('drops an item with %s', async (_, patch) => {
    expect(await fetchOne({ ...ITEM, ...patch })).toEqual([]);
  });

  it.each([null, 'x', 7, []])('drops an entry that is not an object (%j)', async (entry) => {
    expect(await fetchOne(entry)).toEqual([]);
  });

  it('keeps the good items around a bad one', async () => {
    const other = { ...ITEM, outputIndex: 3 };
    answer({ items: [ITEM, { ...ITEM, contract: 'x' }, other] });
    expect(await fetchLegacyListings([OWNER], Network.MAINNET)).toEqual([ITEM, other]);
  });

  it('copies only the contract fields of an item', async () => {
    const [kept] = await fetchOne({ ...ITEM, injected: 'x', assets: [{ unit: UNIT, quantity: '1', extra: 1 }] });
    expect(kept).toEqual(ITEM);
  });
});

describe('nexusTxApi.buildLegacyCancel', () => {
  const REQUEST: LegacyCancelBuildRequest = {
    listings: [{ txHash: TX, outputIndex: 0 }],
    feeInputs: [],
    returnAddress: 'addr1return',
    changeAddress: 'addr1change',
    allowSponsoredCollateral: true,
  };

  it('posts to the legacy-listing-cancel route with the Nexus slug in the query and the body', async () => {
    answer({ tx_cbor: 'aa', tx_hash: 'bb', estimated_fee: '180000', requiredSigners: [OWNER] });
    const built = await nexusTxApi.buildLegacyCancel(REQUEST, Network.MAINNET);
    expect(built).toEqual({ tx_cbor: 'aa', tx_hash: 'bb', estimated_fee: '180000', requiredSigners: [OWNER] });
    const sent = sentTo();
    expect(sent.method).toBe('post');
    expect(sent.url).toBe('/api/tx/build/legacy-listing-cancel?network=cardano-mainnet');
    expect(sent.body).toEqual({ ...REQUEST, network: 'cardano-mainnet' });
  });

  it('refuses a network Nexus has no slug for, without a request', async () => {
    await expect(nexusTxApi.buildLegacyCancel(REQUEST, 'Nowhere')).rejects.toThrow(/not supported/i);
    expect(adapter).not.toHaveBeenCalled();
  });

  it('passes a Nexus 422 errorCode through for the caller (LISTING_NOT_FOUND)', async () => {
    refuse(422, { errorCode: 'LISTING_NOT_FOUND', message: 'Listing already spent' });
    const failure = await nexusTxApi.buildLegacyCancel(REQUEST, Network.MAINNET).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Listing already spent');
    expect(nexusErrorCode(failure)).toBe('LISTING_NOT_FOUND');
  });
});

describe('legacyMarketScripts', () => {
  it('pins the two contracts', () => {
    expect(LEGACY_SCRIPTS).toEqual({
      legacy_v3: {
        scriptHash: 'c727443d77df6cff95dca383994f4c3024d03ff56b02ecc22b0f3f65',
        referenceScript: '1693c508b6132e89b932754d657d28b24068ff5ff1715fec36c010d4d6470b3d#0',
        cancelRedeemerCbor: 'd87a80',
      },
      legacy_v2: {
        scriptHash: '9068a7a3f008803edac87af1619860f2cdcde40c26987325ace138ad',
        referenceScript: '9a32459bd4ef6bbafdeb8cf3b909d0e3e2ec806e4cc6268529280b0fc1d06f5b#0',
        cancelRedeemerCbor: 'd87980',
      },
    });
  });

  it('pins the transaction limits', () => {
    expect(LEGACY_CANCEL_MAX).toBe(10);
    expect(LEGACY_CANCEL_MAX_FEE).toBe(2_000_000n);
    expect(LEGACY_CANCEL_MAX_COLLATERAL).toBe(5_000_000n);
  });

  it('allows no hardware wallet until one has signed a real rescue', () => {
    expect(LEGACY_RESCUE_HARDWARE_WALLET_TYPES).toEqual([]);
    for (const type of ['Ledger', 'Trezor', 'Keystone', 'Password', undefined]) {
      expect(isLegacyRescueHardware(type)).toBe(false);
    }
  });
});
