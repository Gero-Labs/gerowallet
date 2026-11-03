// The Koios read of a listing UTxO (ruling P28): the wallet's second source for what a listing
// holds. The row below has the shape Koios `utxo_info` returns with `_extended: true`; every
// departure from it must fail closed with a typed error, never return a partial answer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Network } from '@/models/types';
import { NFT_MARKET_DEPLOYMENTS_PREPROD } from '@/utils/nftMarketDeployments';
import { ListingUtxoError, fetchListingUtxoFromKoios, type ListingUtxoErrorCode } from './listingChainUtxo';

const TX = 'b1'.repeat(32);
const REF = { txHash: TX, outputIndex: 0 };
const POLICY = 'aa'.repeat(28);
const ASSET_NAME = `000de140${Buffer.from('Gero NFT').toString('hex')}`;
const DATUM_HEX = `d8799f581c${'2a'.repeat(28)}ff`;
// A real preprod base address with a script payment part (the v1 fee address stands in for a
// listing address: the helper only needs it to be a readable Cardano address).
const ADDRESS = NFT_MARKET_DEPLOYMENTS_PREPROD[0].feeAddress;

/** A row as Koios `utxo_info` answers it (extended), holding one NFT and an inline datum. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tx_hash: TX,
    tx_index: 0,
    address: ADDRESS,
    value: '2000000',
    stake_address: 'stake_test1uqehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw',
    payment_cred: '558802cc2e2f21e4e13662cdf73f979ce0140e7dbd7ce13911a9063d',
    epoch_no: 250,
    block_height: 3400000,
    block_time: 1793000000,
    datum_hash: 'f3a8c1d2e4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f40312213243546576879',
    inline_datum: { bytes: DATUM_HEX, value: { constructor: 0, fields: [] } },
    reference_script: null,
    asset_list: [
      { policy_id: POLICY, asset_name: ASSET_NAME, quantity: '1', decimals: 0, fingerprint: 'asset1abcdefghijklmnopqrstuvwxyz0123456789ab' },
    ],
    is_spent: false,
    ...over,
  };
}

const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function failure(promise: Promise<unknown>): Promise<ListingUtxoError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ListingUtxoError);
    return e as ListingUtxoError;
  }
  throw new Error('expected a ListingUtxoError, but the read succeeded');
}

async function expectCode(code: ListingUtxoErrorCode, body: unknown, network: string = Network.PREPROD) {
  fetchMock.mockResolvedValueOnce(json(body));
  expect((await failure(fetchListingUtxoFromKoios(REF, network))).code).toBe(code);
}

describe('fetchListingUtxoFromKoios', () => {
  it('asks Koios utxo_info for exactly that reference, extended, and reads the row', async () => {
    fetchMock.mockResolvedValueOnce(json([row()]));
    const utxo = await fetchListingUtxoFromKoios(REF, Network.PREPROD);
    expect(utxo).toEqual({
      address: ADDRESS,
      lovelace: 2_000_000n,
      assets: [{ unit: POLICY + ASSET_NAME, quantity: 1n }],
      inlineDatumCbor: DATUM_HEX,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://preprod.koios.rest/api/v1/utxo_info');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ _utxo_refs: [`${TX}#0`], _extended: true });
    // No cookies, no redirects to somewhere else, no cache.
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
  });

  it('uses the mainnet host for mainnet, and sends the index it was given', async () => {
    fetchMock.mockResolvedValueOnce(json([row({ tx_index: 3 })]));
    await fetchListingUtxoFromKoios({ txHash: TX.toUpperCase(), outputIndex: 3 }, Network.MAINNET);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.koios.rest/api/v1/utxo_info');
    expect(JSON.parse(init.body as string)._utxo_refs).toEqual([`${TX}#3`]);
  });

  it('reads an ADA-only UTxO with a null asset list entry name, and no inline datum, as null', async () => {
    fetchMock.mockResolvedValueOnce(json([row({ asset_list: [{ policy_id: POLICY, asset_name: null, quantity: '5' }], inline_datum: null })]));
    const utxo = await fetchListingUtxoFromKoios(REF, Network.PREPROD);
    expect(utxo.assets).toEqual([{ unit: POLICY, quantity: 5n }]);
    expect(utxo.inlineDatumCbor).toBeNull();
    fetchMock.mockResolvedValueOnce(json([row({ asset_list: [] })]));
    expect((await fetchListingUtxoFromKoios(REF, Network.PREPROD)).assets).toEqual([]);
  });

  it('lower-cases hex (datum bytes, policy id)', async () => {
    fetchMock.mockResolvedValueOnce(json([row({
      inline_datum: { bytes: DATUM_HEX.toUpperCase() },
      asset_list: [{ policy_id: POLICY.toUpperCase(), asset_name: ASSET_NAME.toUpperCase(), quantity: '1' }],
    })]));
    const utxo = await fetchListingUtxoFromKoios(REF, Network.PREPROD);
    expect(utxo.inlineDatumCbor).toBe(DATUM_HEX);
    expect(utxo.assets[0].unit).toBe(POLICY + ASSET_NAME);
  });

  describe('fails closed', () => {
    it('on a network the market does not run on, without asking anyone', async () => {
      expect((await failure(fetchListingUtxoFromKoios(REF, Network.PREVIEW))).code).toBe('UNSUPPORTED_NETWORK');
      expect((await failure(fetchListingUtxoFromKoios(REF, 'cardano-nowhere'))).code).toBe('UNSUPPORTED_NETWORK');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('on a reference that is not a transaction hash and an index, without asking anyone', async () => {
      for (const ref of [
        { txHash: 'b1', outputIndex: 0 },
        { txHash: TX, outputIndex: -1 },
        { txHash: TX, outputIndex: 1.5 },
        { txHash: undefined as unknown as string, outputIndex: 0 },
      ]) {
        expect((await failure(fetchListingUtxoFromKoios(ref, Network.PREPROD))).code).toBe('MALFORMED');
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('when Koios cannot be reached or answers an HTTP error', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      expect((await failure(fetchListingUtxoFromKoios(REF, Network.PREPROD))).code).toBe('UNREACHABLE');
      for (const status of [429, 500, 503, 404]) {
        fetchMock.mockResolvedValueOnce(json([row()], status));
        expect((await failure(fetchListingUtxoFromKoios(REF, Network.PREPROD))).code).toBe('UNREACHABLE');
      }
    });

    it('when Koios does not answer within the time allowed', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
      const pending = failure(fetchListingUtxoFromKoios(REF, Network.PREPROD));
      await vi.advanceTimersByTimeAsync(15_000);
      expect((await pending).code).toBe('UNREACHABLE');
    });

    it('when the answer is not JSON', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } } as unknown as Response);
      expect((await failure(fetchListingUtxoFromKoios(REF, Network.PREPROD))).code).toBe('MALFORMED');
    });

    it('when Koios does not know the UTxO (an empty list)', async () => {
      await expectCode('NOT_FOUND', []);
    });

    it('when the UTxO is spent', async () => {
      await expectCode('SPENT', [row({ is_spent: true })]);
    });

    it.each([
      ['an object instead of a list', { not: 'a list' }],
      ['a null body', null],
      ['two rows', [row(), row()]],
      ['a row that is not an object', ['x']],
      ['another transaction hash', [row({ tx_hash: 'c3'.repeat(32) })]],
      ['another output index', [row({ tx_index: 1 })]],
      ['an output index as a string', [row({ tx_index: '0' })]],
      ['no is_spent', [row({ is_spent: undefined })]],
      ['is_spent as a string', [row({ is_spent: 'false' })]],
      ['no address', [row({ address: undefined })]],
      ['an address that is not an address', [row({ address: 'not-an-address' })]],
      ['a numeric value', [row({ value: 2000000 })]],
      ['a negative value', [row({ value: '-1' })]],
      ['a fractional value', [row({ value: '1.5' })]],
      ['no value', [row({ value: undefined })]],
      ['no asset list', [row({ asset_list: undefined })]],
      ['a null asset list', [row({ asset_list: null })]],
      ['an asset that is not an object', [row({ asset_list: ['x'] })]],
      ['a short policy id', [row({ asset_list: [{ policy_id: 'aa', asset_name: '', quantity: '1' }] })]],
      ['a non-hex asset name', [row({ asset_list: [{ policy_id: POLICY, asset_name: 'zz', quantity: '1' }] })]],
      ['an odd-length asset name', [row({ asset_list: [{ policy_id: POLICY, asset_name: 'abc', quantity: '1' }] })]],
      ['an asset name over 32 bytes', [row({ asset_list: [{ policy_id: POLICY, asset_name: 'aa'.repeat(33), quantity: '1' }] })]],
      ['a zero quantity', [row({ asset_list: [{ policy_id: POLICY, asset_name: '', quantity: '0' }] })]],
      ['a numeric quantity', [row({ asset_list: [{ policy_id: POLICY, asset_name: '', quantity: 1 }] })]],
      ['the same asset twice', [row({ asset_list: [{ policy_id: POLICY, asset_name: '', quantity: '1' }, { policy_id: POLICY, asset_name: '', quantity: '1' }] })]],
      ['no inline_datum field', [row({ inline_datum: undefined })]],
      ['an inline datum with no bytes', [row({ inline_datum: { value: {} } })]],
      ['inline datum bytes that are not hex', [row({ inline_datum: { bytes: 'not hex' } })]],
      ['empty inline datum bytes', [row({ inline_datum: { bytes: '' } })]],
      ['an inline datum that is a string', [row({ inline_datum: DATUM_HEX })]],
    ])('on %s', async (_name, body) => {
      await expectCode('MALFORMED', body);
    });
  });
});
