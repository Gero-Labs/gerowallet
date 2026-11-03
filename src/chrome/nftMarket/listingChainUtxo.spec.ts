// The wallet's independent read of a listing UTxO: the bytes of the transaction
// that created it, fetched from Koios `tx_cbor` and kept only if their body hashes to the id of
// the listing's transaction. The transactions below are real serialized transactions; what Koios
// "serves" is whatever a test puts in the `tx_cbor` answer, and every departure from the genuine
// transaction must fail closed with a typed error, never return a partial answer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { Network } from '@/models/types';
import { inlineDatumFromCbor } from '@/shared/utils/utxoCbor';
import { NFT_MARKET_DEPLOYMENTS_PREPROD } from '@/utils/nftMarketDeployments';
import { ListingUtxoError, fetchListingUtxoProven, type ListingUtxoErrorCode } from './listingChainUtxo';

const POLICY = 'aa'.repeat(28);
const ASSET_NAME = `000de140${Buffer.from('Gero NFT').toString('hex')}`;
const UNIT = `${POLICY}${ASSET_NAME}`;
const DATUM_HEX = `d8799f581c${'2a'.repeat(28)}ff`;
// A real preprod base address (the v1 fee address stands in for a listing address: the read only
// needs a readable Shelley address) and a plain key address for the transaction's other output.
const ADDRESS = NFT_MARKET_DEPLOYMENTS_PREPROD[0].feeAddress;
const OTHER_ADDRESS = Cardano.BaseAddress.fromCredentials(
  Cardano.NetworkId.Testnet,
  { type: Cardano.CredentialType.KeyHash, hash: '11'.repeat(28) as Cardano.Credential['hash'] },
  { type: Cardano.CredentialType.KeyHash, hash: '22'.repeat(28) as Cardano.Credential['hash'] },
).toAddress().toBech32();

interface Creating {
  /** The listing output's inline datum (hex), `null` for none. Default: a Gero-shaped constructor. */
  datum?: string | null;
  datumHash?: string;
  lovelace?: bigint;
  assets?: Map<Cardano.AssetId, bigint>;
  address?: string;
  /** Distinguishes otherwise identical transactions. */
  seed?: string;
  /** A transaction whose scripts failed: no outputs, only a collateral return. */
  invalid?: boolean;
}

/**
 * A real transaction creating the listing at output 0 (and a 2 ADA payment at output 1), as bytes
 * and the id they hash to. An inline datum goes in as `{ cbor }`, which the SDK serializes byte
 * for byte, so a test can put a datum on chain in a form the SDK itself would not write.
 */
function creatingTx(opts: Creating = {}) {
  const datum = opts.datum === undefined ? DATUM_HEX : opts.datum;
  const listing: Record<string, unknown> = {
    address: opts.address ?? ADDRESS,
    value: {
      coins: opts.lovelace ?? 2_000_000n,
      assets: opts.assets ?? new Map([[Cardano.AssetId(UNIT), 1n]]),
    },
  };
  if (datum !== null) listing['datum'] = inlineDatumFromCbor(HexBlob(datum));
  if (opts.datumHash) listing['datumHash'] = opts.datumHash;
  const core = {
    id: '0'.repeat(64),
    body: {
      inputs: [{ txId: (opts.seed ?? '1').repeat(64), index: 0 }],
      outputs: [listing, { address: OTHER_ADDRESS, value: { coins: 2_000_000n } }],
      fee: 200_000n,
      ...(opts.invalid ? { collateralReturn: { address: OTHER_ADDRESS, value: { coins: 4_000_000n } } } : {}),
    },
    witness: { signatures: new Map() },
    ...(opts.invalid ? { isValid: false } : {}),
  } as unknown as Cardano.Tx;
  const tx = Serialization.Transaction.fromCore(core);
  return { cbor: String(tx.toCbor()), hash: String(tx.getId()) };
}

/** What Koios `tx_cbor` answers for the transactions it has. */
const koiosAnswer = (...txs: { cbor: string; hash: string }[]) => txs.map((t) => ({ tx_hash: t.hash, cbor: t.cbor }));

const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
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

/** Koios answers `body`; the read of `ref` on preprod must fail with `code`. */
async function expectCode(code: ListingUtxoErrorCode, body: unknown, index = 0, hash = REAL.hash) {
  fetchMock.mockResolvedValueOnce(json(body));
  const error = await failure(fetchListingUtxoProven({ txHash: hash, outputIndex: index }, Network.PREPROD));
  expect(error.code).toBe(code);
  return error;
}

const REAL = creatingTx();
const REF = { txHash: REAL.hash, outputIndex: 0 };

describe('fetchListingUtxoProven', () => {
  it('asks Koios tx_cbor for the creating transaction, proves it and reads output `index`', async () => {
    fetchMock.mockResolvedValueOnce(json(koiosAnswer(REAL)));
    const utxo = await fetchListingUtxoProven(REF, Network.PREPROD);
    expect(utxo).toEqual({
      ref: `${REAL.hash}#0`,
      address: ADDRESS,
      lovelace: 2_000_000n,
      assets: [{ unit: UNIT, quantity: 1n }],
      inlineDatumCbor: DATUM_HEX,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://preprod.koios.rest/api/v1/tx_cbor');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ _tx_hashes: [REAL.hash] });
    // No cookies, no redirects to somewhere else, and a deadline that also covers the body.
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.signal as AbortSignal).aborted).toBe(false);
  });

  it('reads the output at the index it was given, not output 0', async () => {
    fetchMock.mockResolvedValueOnce(json(koiosAnswer(REAL)));
    const utxo = await fetchListingUtxoProven({ txHash: REAL.hash, outputIndex: 1 }, Network.PREPROD);
    expect(utxo).toEqual({ ref: `${REAL.hash}#1`, address: OTHER_ADDRESS, lovelace: 2_000_000n, assets: [], inlineDatumCbor: null });
  });

  it('uses the mainnet host for mainnet, and lower-cases the hash it asks about and reports', async () => {
    fetchMock.mockResolvedValueOnce(json(koiosAnswer(REAL)));
    const utxo = await fetchListingUtxoProven({ txHash: REAL.hash.toUpperCase(), outputIndex: 0 }, Network.MAINNET);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.koios.rest/api/v1/tx_cbor');
    expect(JSON.parse(init.body as string)._tx_hashes).toEqual([REAL.hash]);
    expect(utxo.ref).toBe(`${REAL.hash}#0`);
  });

  it('accepts Koios naming the transaction in upper case', async () => {
    fetchMock.mockResolvedValueOnce(json([{ tx_hash: REAL.hash.toUpperCase(), cbor: REAL.cbor }]));
    expect((await fetchListingUtxoProven(REF, Network.PREPROD)).inlineDatumCbor).toBe(DATUM_HEX);
  });

  describe('the inline datum is the transaction\'s own bytes', () => {
    it.each([
      ['an indefinite-length constructor, as the Gero contract and Nexus write it', DATUM_HEX],
      // The SDK's own re-encoding of a list is indefinite-length (9f..ff), so a read through
      // Core's toCore() would hand back different bytes than the chain has.
      ['a definite-length list at the top', '83010203'],
      ['a definite-length list inside a constructor', 'd879820102'],
      ['a non-minimally encoded integer', '1805'],
      ['a byte string', '43aabbcc'],
    ])('returns %s unchanged', async (_name, datum) => {
      const tx = creatingTx({ datum });
      expect(tx.cbor).toContain(datum);
      fetchMock.mockResolvedValueOnce(json(koiosAnswer(tx)));
      const utxo = await fetchListingUtxoProven({ txHash: tx.hash, outputIndex: 0 }, Network.PREPROD);
      expect(utxo.inlineDatumCbor).toBe(datum);
    });

    it('reads an output with no datum, and one with only a datum hash, as having no inline datum', async () => {
      for (const tx of [creatingTx({ datum: null }), creatingTx({ datum: null, datumHash: 'f3'.repeat(32), seed: '2' })]) {
        fetchMock.mockResolvedValueOnce(json(koiosAnswer(tx)));
        const utxo = await fetchListingUtxoProven({ txHash: tx.hash, outputIndex: 0 }, Network.PREPROD);
        expect(utxo.inlineDatumCbor).toBeNull();
      }
    });
  });

  it('reads the value: an ADA-only output, and an output with several tokens', async () => {
    const adaOnly = creatingTx({ assets: new Map(), lovelace: 7_500_000n });
    fetchMock.mockResolvedValueOnce(json(koiosAnswer(adaOnly)));
    const a = await fetchListingUtxoProven({ txHash: adaOnly.hash, outputIndex: 0 }, Network.PREPROD);
    expect(a.lovelace).toBe(7_500_000n);
    expect(a.assets).toEqual([]);

    const other = `${'bb'.repeat(28)}`;
    const many = creatingTx({ assets: new Map([[Cardano.AssetId(UNIT), 1n], [Cardano.AssetId(other), 5n]]), seed: '3' });
    fetchMock.mockResolvedValueOnce(json(koiosAnswer(many)));
    const b = await fetchListingUtxoProven({ txHash: many.hash, outputIndex: 0 }, Network.PREPROD);
    expect(b.assets).toHaveLength(2);
    expect(b.assets).toEqual(expect.arrayContaining([{ unit: UNIT, quantity: 1n }, { unit: other, quantity: 5n }]));
  });

  describe('fails closed', () => {
    it('on a network the market does not run on, without asking anyone', async () => {
      for (const network of [Network.PREVIEW, 'cardano-nowhere', '__proto__', 'constructor', undefined as unknown as string]) {
        expect((await failure(fetchListingUtxoProven(REF, network))).code).toBe('UNSUPPORTED_NETWORK');
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('on a reference that is not a transaction hash and an index, without asking anyone', async () => {
      for (const ref of [
        { txHash: 'b1', outputIndex: 0 },
        { txHash: REAL.hash, outputIndex: -1 },
        { txHash: REAL.hash, outputIndex: 1.5 },
        { txHash: undefined as unknown as string, outputIndex: 0 },
        { txHash: `${REAL.hash}#0`, outputIndex: 0 },
      ]) {
        expect((await failure(fetchListingUtxoProven(ref, Network.PREPROD))).code).toBe('MALFORMED');
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('when the bytes Koios serves do not hash to the transaction asked for (the attack)', async () => {
      // A Koios that wants a buyer to believe the listing is something else serves another
      // transaction under the real id: here one whose listing output carries a different datum and
      // a different price. Its body hashes to another id, so nothing in it can be believed.
      const forged = creatingTx({ datum: `d8799f581c${'2a'.repeat(28)}1a05f5e100ff`, lovelace: 2_000_000n, seed: '1' });
      expect(forged.hash).not.toBe(REAL.hash);
      fetchMock.mockResolvedValueOnce(json([{ tx_hash: REAL.hash, cbor: forged.cbor }]));
      const error = await failure(fetchListingUtxoProven(REF, Network.PREPROD));
      expect(error.code).toBe('MALFORMED');
      expect(error.message).toMatch(/do not hash to the transaction id/);
    });

    it('when the forged transaction is a copy of the real one with one byte of the datum changed', async () => {
      const tampered = REAL.cbor.replace(DATUM_HEX, `d8799f581c${'2b'.repeat(28)}ff`);
      expect(tampered).not.toBe(REAL.cbor);
      await expectCode('MALFORMED', [{ tx_hash: REAL.hash, cbor: tampered }]);
    });

    it('when the output index is past the last output of the real transaction', async () => {
      await expectCode('NOT_FOUND', koiosAnswer(REAL), 2);
      await expectCode('NOT_FOUND', koiosAnswer(REAL), 1_000_000);
    });

    it('when the transaction\'s scripts failed: it created no listing, only a collateral return', async () => {
      const failed = creatingTx({ invalid: true, seed: '4' });
      await expectCode('NOT_FOUND', koiosAnswer(failed), 0, failed.hash);
      // The collateral return does exist on chain, at index = number of outputs.
      fetchMock.mockResolvedValueOnce(json(koiosAnswer(failed)));
      const utxo = await fetchListingUtxoProven({ txHash: failed.hash, outputIndex: 2 }, Network.PREPROD);
      expect(utxo.address).toBe(OTHER_ADDRESS);
      expect(utxo.lovelace).toBe(4_000_000n);
    });

    it('when Koios does not know the transaction (an empty list), or answers for another one', async () => {
      await expectCode('NOT_FOUND', []);
      await expectCode('NOT_FOUND', koiosAnswer(creatingTx({ seed: '5' })));
      await expectCode('NOT_FOUND', { not: 'a list' });
      await expectCode('NOT_FOUND', null);
    });

    it('when the bytes are not a transaction', async () => {
      await expectCode('MALFORMED', [{ tx_hash: REAL.hash, cbor: 'deadbeef' }]);
      await expectCode('MALFORMED', [{ tx_hash: REAL.hash, cbor: 'not hex' }]);
      await expectCode('MALFORMED', [{ tx_hash: REAL.hash, cbor: '00' }]);
    });

    it('when Koios cannot be reached or answers an HTTP error', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      expect((await failure(fetchListingUtxoProven(REF, Network.PREPROD))).code).toBe('UNREACHABLE');
      for (const status of [429, 500, 503, 404]) {
        fetchMock.mockResolvedValueOnce(json(koiosAnswer(REAL), status));
        expect((await failure(fetchListingUtxoProven(REF, Network.PREPROD))).code).toBe('UNREACHABLE');
      }
    });

    it('when Koios does not answer within the time allowed', async () => {
      fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
      expect((await failure(fetchListingUtxoProven(REF, Network.PREPROD))).code).toBe('UNREACHABLE');
      fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));
      expect((await failure(fetchListingUtxoProven(REF, Network.PREPROD))).code).toBe('UNREACHABLE');
    });

    it('when the deadline passes while the body is being read: Koios did not answer, the answer is not malformed', async () => {
      for (const reason of [new DOMException('The operation timed out.', 'TimeoutError'), new DOMException('The operation was aborted.', 'AbortError')]) {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => { throw reason; },
        } as unknown as Response);
        expect((await failure(fetchListingUtxoProven(REF, Network.PREPROD))).code).toBe('UNREACHABLE');
      }
    });

    it('when the answer is not JSON', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } } as unknown as Response);
      expect((await failure(fetchListingUtxoProven(REF, Network.PREPROD))).code).toBe('MALFORMED');
    });

    it('when an output holds a token with no quantity', async () => {
      const empty = creatingTx({ assets: new Map([[Cardano.AssetId(UNIT), 0n]]), seed: '6' });
      fetchMock.mockResolvedValueOnce(json(koiosAnswer(empty)));
      const error = await failure(fetchListingUtxoProven({ txHash: empty.hash, outputIndex: 0 }, Network.PREPROD));
      expect(error.code).toBe('MALFORMED');
    });
  });
});
