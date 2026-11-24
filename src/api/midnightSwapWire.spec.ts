// Nexus's token catalog, trades and open offers: strict readers, rows that do not read are dropped.
import { describe, expect, it } from 'vitest';
import {
  nexusErrorCode, readCatalogToken, readListedOffer, readOpenOffer, readOpenOffers, readSwapTrades, readTokenCatalogPage,
} from './midnightSwapWire';
import { encodeSwapOffer, swapOfferId } from '@/chains/midnight/midnightSwapOffer';

const TYPE_A = 'aa'.repeat(32);
const TYPE_B = 'bb'.repeat(32);

const token = (over: Record<string, unknown> = {}) => ({
  tokenType: TYPE_A, kind: 'UNSHIELDED', symbol: 'TTK', name: 'Test token', decimals: 6, imageUrl: null, imageSha256: null,
  metadataSource: 'CURATED', verified: true, issuerContract: null, firstSeenBlock: 10, holders: 3, supplyObserved: '1000', ...over,
});

describe('token catalog', () => {
  it('reads a TokenDto', () => {
    expect(readCatalogToken(token())).toEqual({
      tokenType: TYPE_A, kind: 'UNSHIELDED', symbol: 'TTK', name: 'Test token', decimals: 6, metadataSource: 'CURATED', verified: true, holders: 3,
    });
  });

  it('lower-cases the token type and keeps only verified === true as verified', () => {
    expect(readCatalogToken(token({ tokenType: TYPE_A.toUpperCase(), verified: 'true' }))).toMatchObject({ tokenType: TYPE_A, verified: false });
  });

  it('drops a row without a valid token type, kind or source, and blanks a ticker that is not plain', () => {
    expect(readCatalogToken(token({ tokenType: 'xyz' }))).toBeNull();
    expect(readCatalogToken(token({ kind: 'OTHER' }))).toBeNull();
    expect(readCatalogToken(token({ metadataSource: 'WHATEVER' }))).toBeNull();
    expect(readCatalogToken(token({ symbol: 'USDM <script>' }))?.symbol).toBeNull();
    expect(readCatalogToken(token({ decimals: 99 }))?.decimals).toBeNull();
  });

  it('reads a page, dropping unreadable rows', () => {
    const page = readTokenCatalogPage({ network: 'midnight-preprod', asOfBlock: 5, total: 2, tokens: [token(), { nope: true }] });
    expect(page.total).toBe(2);
    expect(page.tokens).toHaveLength(1);
    expect(() => readTokenCatalogPage({ tokens: 'no' })).toThrow();
  });
});

describe('swap trades', () => {
  it('reads trades and drops malformed ones', () => {
    const trades = readSwapTrades({
      trades: [
        { txHash: 'ff', block: 1, timestamp: '2026-11-24T12:00:00Z', tokenA: TYPE_A, amountA: '100', tokenB: TYPE_B, amountB: '2000' },
        { txHash: 'ee', tokenA: TYPE_A, amountA: '0', tokenB: TYPE_B, amountB: '1' },
        { txHash: 'dd', tokenA: 'x', amountA: '1', tokenB: TYPE_B, amountB: '1' },
      ],
    });
    expect(trades).toEqual([{ txHash: 'ff', timestamp: Date.parse('2026-11-24T12:00:00Z'), tokenA: TYPE_A, amountA: '100', tokenB: TYPE_B, amountB: '2000' }]);
  });
});

describe('open offers (MIP-0006 payload)', () => {
  const offerString = encodeSwapOffer(Uint8Array.from([1, 2, 3, 4]));
  const payload = (over: Record<string, unknown> = {}, computed: Record<string, unknown> = {}) => ({
    version: 1,
    offerId: 'cc'.repeat(32),
    computed: {
      gives: [{ token: TYPE_A, amount: '100', type: 'UNSHIELDED' }],
      wants: [{ token: TYPE_B, amount: '2000', type: 'UNSHIELDED' }],
      expiresAt: '2026-11-24T13:00:00Z',
      inputNullifiers: [],
      firstSeenAt: '2026-11-24T12:00:00Z',
      status: 'live',
      ...computed,
    },
    ...over,
  });

  it('reads a row; the string is optional in a list', () => {
    expect(readOpenOffer(payload())).toEqual({
      offerId: 'cc'.repeat(32), offerBech32: null,
      gives: [{ tokenType: TYPE_A, amount: '100' }], wants: [{ tokenType: TYPE_B, amount: '2000' }],
      expiresAt: Date.parse('2026-11-24T13:00:00Z'),
    });
  });

  it('derives the id from the string when only the string is given', () => {
    const row = readOpenOffer(payload({ offerId: undefined, offerBech32: offerString }));
    expect(row?.offerId).toBe(swapOfferId(Uint8Array.from([1, 2, 3, 4])));
  });

  it('drops a private leg, a give-only offer and a row with neither id nor string', () => {
    expect(readOpenOffer(payload({}, { wants: [{ token: TYPE_B, amount: '1', type: 'SHIELDED' }] }))).toBeNull();
    expect(readOpenOffer(payload({}, { wants: [] }))).toBeNull();
    expect(readOpenOffer(payload({ offerId: undefined }))).toBeNull();
  });

  it('reads the list and the listing answer', () => {
    expect(readOpenOffers({ offers: [payload(), { bad: 1 }], nextCursor: null })).toHaveLength(1);
    expect(readListedOffer({ offerId: 'CC'.repeat(32), gives: [], wants: [], expiresAt: 'x', status: 'live', published: true }))
      .toEqual({ offerId: 'cc'.repeat(32), status: 'live', published: true });
    expect(() => readListedOffer({ offerId: 'short' })).toThrow();
  });

  it('reads an error code, never its text', () => {
    expect(nexusErrorCode({ code: 'OFFER_EXPIRED', message: 'anything' })).toBe('OFFER_EXPIRED');
    expect(nexusErrorCode('oops')).toBeUndefined();
  });
});
