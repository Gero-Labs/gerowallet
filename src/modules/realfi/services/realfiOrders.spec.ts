import { AxiosError, AxiosHeaders, type AxiosInstance } from 'axios';
import type { Cardano } from '@cardano-sdk/core';
import { describe, expect, it, vi } from 'vitest';
import { REALFI_ASSETS } from '../assets';
import {
  buildOrder,
  classifyBuildError,
  MAX_BUILD_UTXOS,
  RealFiOrderError,
  selectBuildUtxos,
} from './realfiOrders';

const CTX = { network: 'Preprod', changeAddress: 'addr_test1qxyz', utxos: ['82aa', '82bb'] };
const TX = 'd26ab71e901bd3375a77e2674bd17fc487b5cf8be2ac0c33e0cf20a6e80690f6';

function http(post: ReturnType<typeof vi.fn>) {
  return { post } as unknown as AxiosInstance;
}

function nexusError(status: number, data: unknown): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  });
}

describe('buildOrder', () => {
  it('posts each order kind to its route, with the wallet UTxOs and network slug', async () => {
    const post = vi.fn().mockResolvedValue({ data: { txCbor: '84a4', txHash: TX } });
    const h = http(post);

    await buildOrder({ kind: 'stake', amount: '5000000' }, CTX, h);
    await buildOrder({ kind: 'unstake', amount: '1000000', unlockSlot: '132871930' }, CTX, h);
    await buildOrder(
      { kind: 'claim', resultUtxo: { txHash: TX, index: 1 }, unlockSlot: '132871930' },
      CTX,
      h,
    );
    await buildOrder({ kind: 'cancel', orderInputs: [{ txHash: TX, index: 0 }] }, CTX, h);

    const common = { changeAddress: CTX.changeAddress, utxos: CTX.utxos };
    const params = { params: { network: 'cardano-preprod' } };
    expect(post.mock.calls).toEqual([
      ['/api/realfi/build/stake', { ...common, amount: '5000000' }, params],
      ['/api/realfi/build/unstake', { ...common, amount: '1000000', unlockSlot: '132871930' }, params],
      [
        '/api/realfi/build/claim',
        { ...common, resultUtxo: { txHash: TX, index: 1 }, unlockSlot: '132871930' },
        params,
      ],
      ['/api/realfi/build/cancel', { ...common, orderInputs: [{ txHash: TX, index: 0 }] }, params],
    ]);
  });

  it('returns the unsigned transaction as given', async () => {
    const post = vi.fn().mockResolvedValue({ data: { txCbor: '84a4', txHash: TX } });
    await expect(buildOrder({ kind: 'stake', amount: '1' }, CTX, http(post))).resolves.toEqual({
      txCbor: '84a4',
      txHash: TX,
    });
  });

  it('refuses a response that is not a transaction, rather than asking anyone to sign it', async () => {
    const post = vi.fn().mockResolvedValue({ data: '<html>502 Bad Gateway</html>' });
    await expect(buildOrder({ kind: 'stake', amount: '1' }, CTX, http(post))).rejects.toMatchObject(
      { reason: 'build-failed' },
    );
  });

  it('never calls Nexus for a network RealFi is not on', async () => {
    const post = vi.fn();
    await expect(
      buildOrder({ kind: 'stake', amount: '1' }, { ...CTX, network: 'Bitcoin' }, http(post)),
    ).rejects.toBeInstanceOf(RealFiOrderError);
    expect(post).not.toHaveBeenCalled();
  });

  it('carries a compliance refusal through with its reference', async () => {
    const post = vi.fn().mockRejectedValue(
      nexusError(403, {
        errorCode: 'NOT_AUTHORIZED',
        providerErrors: { 'realfi.correlationId': 'srv-corr-1' },
      }),
    );
    await expect(buildOrder({ kind: 'stake', amount: '1' }, CTX, http(post))).rejects.toMatchObject(
      { reason: 'not-authorized', correlationId: 'srv-corr-1' },
    );
  });
});

describe('classifyBuildError', () => {
  it.each([
    ['NOT_AUTHORIZED', 403, 'not-authorized'],
    ['PENDING_REVIEW', 403, 'pending-review'],
    ['HANDSHAKE_UNAVAILABLE', 503, 'screening-unavailable'],
    ['UNSUPPORTED_OWNER', 400, 'unsupported-wallet'],
  ])('maps %s to %s', (code, status, reason) => {
    expect(classifyBuildError(nexusError(status, { errorCode: code })).reason).toBe(reason);
  });

  it('does not read a plain 400 as a refusal: only the code says that', () => {
    const err = classifyBuildError(
      nexusError(400, { message: 'amount must be greater than zero', validationErrors: ['amount'] }),
    );
    expect(err.reason).toBe('build-failed');
    expect(err.correlationId).toBeNull();
  });

  it('treats a network failure as a failed build', () => {
    expect(classifyBuildError(new Error('Network Error')).reason).toBe('build-failed');
  });
});

describe('selectBuildUtxos', () => {
  function utxo(i: number, coins: number, assets?: Record<string, string> | Map<string, bigint>) {
    return [
      { txId: TX, index: i },
      { address: 'addr_test1', value: { coins: BigInt(coins), assets } },
    ] as unknown as Cardano.Utxo;
  }

  it('sends every UTxO when under the cap', () => {
    const all = [utxo(0, 1), utxo(1, 2)];
    expect(selectBuildUtxos(all, [])).toEqual(all);
  });

  it('past the cap, keeps UTxOs holding RealFi assets first, then the largest by ADA', () => {
    const usdr = REALFI_ASSETS.preprod.usdr;
    const small = Array.from({ length: MAX_BUILD_UTXOS }, (_, i) => utxo(i, 1_000_000));
    const big = utxo(9001, 50_000_000);
    // One Map-shaped, one plain-object-shaped: chrome.storage flattens Maps.
    const withUsdrMap = utxo(9002, 1_000_000, new Map([[usdr, 5n]]));
    const withUsdrObj = utxo(9003, 1_000_000, { [usdr]: '7' });

    const picked = selectBuildUtxos([...small, big, withUsdrMap, withUsdrObj], [usdr]);

    expect(picked).toHaveLength(MAX_BUILD_UTXOS);
    expect(picked.slice(0, 3).map((u) => u[0].index)).toEqual([9002, 9003, 9001]);
  });
});
