import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { cardanoUtxoToNexusInput, NEXUS_MAX_INPUTS, nexusErrorCode, nexusErrorMessage, postWithRateLimitRetry, walletUtxosToNexusInputs } from './nexus-tx-api';
import { convertNexusUtxos } from '@/services/nexusUtxo';
import { HASH_ONLY_DATUM_UTXO, INLINE_DATUM_UTXOS } from '@/shared/utils/__fixtures__/mainnetDatumUtxos';

describe('cardanoUtxoToNexusInput: datums', () => {
  const [fixture] = INLINE_DATUM_UTXOS;
  const [[txIn, txOut]] = convertNexusUtxos([fixture.nexusRow]);

  it.each([
    ['as the wallet stores it', txOut.datum],
    ['as Nexus sent it', fixture.nexusRow.inlineDatum],
    ['as bare hex from a block', fixture.datumCbor],
  ])('sends an inline datum stored %s as its original CBOR hex, without a hash', (_, datum) => {
    const input = cardanoUtxoToNexusInput([
      txIn,
      { ...txOut, datum: datum as Cardano.PlutusData, datumHash: fixture.datumHash as Cardano.DatumHash },
    ]);
    expect(input.inlineDatum).toBe(fixture.datumCbor);
    expect(input.dataHash).toBeUndefined();
  });

  it('sends a hash-only datum as its hash', () => {
    const [utxo] = convertNexusUtxos([HASH_ONLY_DATUM_UTXO.nexusRow]);
    const input = cardanoUtxoToNexusInput(utxo);
    expect(input.dataHash).toBe(HASH_ONLY_DATUM_UTXO.datumHash);
    expect(input.inlineDatum).toBeUndefined();
  });
});

// Nexus refuses a build request carrying more than NEXUS_MAX_INPUTS UTxOs (HTTP 400
// "Validation failed", before coin selection runs), so the shared mapper is the
// one place every flow goes through to stay under it.
describe('walletUtxosToNexusInputs: Nexus input limit', () => {
  const many = (count: number): Cardano.Utxo[] => Array.from({ length: count }, (_, i) => ([
    { txId: 'd'.repeat(64), index: i },
    { address: 'addr1qtest', value: { coins: BigInt(1_000_000 + i) } },
  ] as unknown as Cardano.Utxo));

  it('never sends more inputs than Nexus accepts', () => {
    expect(walletUtxosToNexusInputs(many(NEXUS_MAX_INPUTS + 50))).toHaveLength(NEXUS_MAX_INPUTS);
  });

  it('keeps the largest UTxOs when it has to drop some', () => {
    const inputs = walletUtxosToNexusInputs(many(NEXUS_MAX_INPUTS + 50));
    const smallest = Math.min(...inputs.map((input) => Number(input.lovelace)));
    expect(smallest).toBe(1_000_000 + 50);
  });

  it('sends a small wallet untouched', () => {
    expect(walletUtxosToNexusInputs(many(3))).toHaveLength(3);
  });
});

describe('nexusErrorMessage', () => {
  it('appends the validation details Nexus puts beside its generic message', () => {
    expect(nexusErrorMessage({ message: 'Validation failed', validationErrors: ['utxos: Maximum 200 UTXOs allowed per request'] }))
      .toBe('Validation failed: utxos: Maximum 200 UTXOs allowed per request');
  });

  it('passes a plain message through untouched', () => {
    expect(nexusErrorMessage({ message: 'Insufficient input in transaction.' })).toBe('Insufficient input in transaction.');
  });

  it('returns undefined when the body carries no message', () => {
    expect(nexusErrorMessage({})).toBeUndefined();
    expect(nexusErrorMessage(undefined)).toBeUndefined();
  });
});

describe('nexusErrorCode', () => {
  it("reads a CIP-113 422's errorCode from the response the interceptor keeps", () => {
    const error = Object.assign(new Error('module not supported'), {
      response: { status: 422, data: { message: 'module not supported', errorCode: 'MODULE_UNSUPPORTED' } },
    });
    expect(nexusErrorCode(error)).toBe('MODULE_UNSUPPORTED');
  });

  it('is undefined without a well-formed code', () => {
    expect(nexusErrorCode(new Error('network down'))).toBeUndefined();
    expect(nexusErrorCode({ response: { data: { errorCode: '<script>' } } })).toBeUndefined();
    expect(nexusErrorCode(undefined)).toBeUndefined();
  });
});

// gero-backend's Nexus proxy limits /api/tx/* to 3 writes a second and 20 a minute per
// IP, answering 429 with `Retry-After: 1` even when it is the minute window that is
// spent. A sweep's merges are unsigned builds, so waiting and asking again is safe.
describe('postWithRateLimitRetry', () => {
  /** What the interceptor hands back for a 429: the body's message with the response kept on it. */
  const rateLimited = (retryAfter?: string) => Object.assign(new Error('Too many requests — slow down'), {
    response: {
      status: 429,
      headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter },
      data: { error: 'rate_limit_exceeded', message: 'Too many requests — slow down' },
    },
  });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits out one 429 and then returns the build, reporting the wait first', async () => {
    const send = vi.fn().mockRejectedValueOnce(rateLimited('1')).mockResolvedValueOnce('built');
    const onRateLimited = vi.fn();
    const result = postWithRateLimitRetry(send, { rateLimitRetry: true, onRateLimited });
    await vi.advanceTimersByTimeAsync(0);
    // Retry-After says 1 s; the first back-off step is 2 s, and the larger wins.
    expect(onRateLimited).toHaveBeenCalledTimes(1);
    expect(onRateLimited).toHaveBeenCalledWith(2000);
    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('built');
    expect(send).toHaveBeenCalledTimes(2);
    expect(onRateLimited).toHaveBeenCalledTimes(1);
  });

  it('honours a Retry-After longer than the back-off step', async () => {
    const send = vi.fn().mockRejectedValueOnce(rateLimited('5')).mockResolvedValueOnce('built');
    const onRateLimited = vi.fn();
    const result = postWithRateLimitRetry(send, { rateLimitRetry: true, onRateLimited });
    await vi.advanceTimersByTimeAsync(4999);
    expect(onRateLimited).toHaveBeenCalledWith(5000);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('built');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('gives up once the waits would pass 90 s and rethrows the last 429', async () => {
    const send = vi.fn().mockRejectedValue(rateLimited('1'));
    const onRateLimited = vi.fn();
    const result = postWithRateLimitRetry(send, { rateLimitRetry: true, onRateLimited });
    const failure = expect(result).rejects.toMatchObject({ response: { status: 429 } });
    // 2 + 4 + 8 + 15 + 15 + 15 + 15 + 15 = 89 s of waiting; a ninth 15 s wait would pass 90 s.
    await vi.advanceTimersByTimeAsync(89_000);
    await failure;
    expect(onRateLimited.mock.calls.map(([wait]) => wait)).toEqual([2000, 4000, 8000, 15_000, 15_000, 15_000, 15_000, 15_000]);
    expect(send).toHaveBeenCalledTimes(9);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(9);
  });

  it('stops at an abort during the wait, without another request', async () => {
    const controller = new AbortController();
    const send = vi.fn().mockRejectedValue(rateLimited('1'));
    const result = postWithRateLimitRetry(send, { rateLimitRetry: true, signal: controller.signal });
    const failure = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await failure;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not retry anything but a 429', async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('nexus down'), { response: { status: 500 } }));
    const onRateLimited = vi.fn();
    await expect(postWithRateLimitRetry(send, { rateLimitRetry: true, onRateLimited })).rejects.toThrow('nexus down');
    expect(send).toHaveBeenCalledTimes(1);
    expect(onRateLimited).not.toHaveBeenCalled();
  });

  it('does not retry a 429 unless asked to', async () => {
    const send = vi.fn().mockRejectedValue(rateLimited('1'));
    await expect(postWithRateLimitRetry(send, undefined)).rejects.toMatchObject({ response: { status: 429 } });
    await expect(postWithRateLimitRetry(send, { signal: new AbortController().signal })).rejects.toMatchObject({ response: { status: 429 } });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
